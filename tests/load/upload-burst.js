// Teste de carga: rajada de uploads simultâneos para demonstrar que, em pico,
// nenhuma requisição se perde — todos os vídeos aceitos terminam processados.
//
//   make load                     (30 vídeos, 15 usuários virtuais)
//   make load VIDEOS=100 VUS=30
//
// Acompanhe ao vivo no Grafana (http://localhost:3000): fila cresce, workers
// drenam, nada fica para trás. Escale os workers antes para ver a diferença:
// make scale n=3
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080/api';
const VIDEOS = Number(__ENV.VIDEOS || 30);
const VUS = Number(__ENV.VUS || 15);
const DRAIN_TIMEOUT_S = Number(__ENV.DRAIN_TIMEOUT_S || 300);

const video = open('../fixtures/sample-5s.mp4', 'b');
const accepted = new Counter('videos_accepted');

export const options = {
  scenarios: {
    burst: { executor: 'shared-iterations', vus: VUS, iterations: VIDEOS, maxDuration: '5m' },
  },
  // Toda requisição de upload precisa ser aceita: nenhuma rejeitada por sobrecarga
  thresholds: {
    'checks{check:upload aceito (202)}': ['rate==1'],
    'http_req_duration{name:upload}': ['p(95)<5000'],
  },
  setupTimeout: '30s',
  teardownTimeout: `${DRAIN_TIMEOUT_S + 30}s`,
};

const json = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const email = `carga.${Date.now()}@fiapx.local`;
  const password = 'SenhaCarga123';
  const reg = http.post(`${BASE}/auth/register`, JSON.stringify({ name: 'Teste de Carga', email, password }), json);
  if (reg.status !== 201) fail(`cadastro falhou: ${reg.status} ${reg.body}`);
  const login = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password }), json);
  if (login.status !== 200) fail(`login falhou: ${login.status}`);
  return { token: login.json('access_token') };
}

export default function (data) {
  const res = http.post(
    `${BASE}/videos`,
    { video: http.file(video, `carga-${__VU}-${__ITER}.mp4`, 'video/mp4') },
    { headers: { Authorization: `Bearer ${data.token}` }, tags: { name: 'upload' } },
  );
  if (check(res, { 'upload aceito (202)': (r) => r.status === 202 })) accepted.add(1);
}

// Espera a fila drenar e confere que todos os vídeos aceitos foram processados.
export function teardown(data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };
  const start = Date.now();
  let counts;
  for (;;) {
    counts = http.get(`${BASE}/videos?page_size=1`, auth).json('counts');
    const active = counts.PENDING + counts.PROCESSING;
    console.log(`fila: ${counts.PENDING} aguardando · ${counts.PROCESSING} processando · ${counts.DONE} concluídos · ${counts.FAILED} falhas`);
    if (active === 0) break;
    if ((Date.now() - start) / 1000 > DRAIN_TIMEOUT_S) fail(`fila não drenou em ${DRAIN_TIMEOUT_S}s`);
    sleep(2);
  }
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`drenou em ${seconds}s após a rajada`);
  check(counts, {
    'nenhum vídeo perdido (todos concluídos)': (c) => c.DONE === VIDEOS,
    'nenhuma falha': (c) => c.FAILED === 0,
  });
}
