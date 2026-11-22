// Teste E2E do sistema completo, pela porta da frente (gateway), contra a stack
// do docker compose: auth → upload → fila → worker (ffmpeg) → status → download
// do zip, e o caminho de falha até o e-mail no Mailpit.
//
//   make up && make e2e
//
// Sem dependências: node:test + fetch (Node 22).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, before } from 'node:test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const API = `${BASE}/api`;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const FIXTURE = new URL('../fixtures/sample-5s.mp4', import.meta.url);
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 90_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${what}`);
    await sleep(500);
  }
}

/** Cliente com "pote" de cookies mínimo (o refresh token vem em cookie HttpOnly). */
function client() {
  let cookie = '';
  let token = '';
  const call = async (path, { method = 'GET', json, form, auth = true } = {}) => {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: json ? JSON.stringify(json) : form,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) if (c.startsWith('refresh_token=')) cookie = c.split(';')[0];
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  };
  return {
    call,
    setToken: (t) => (token = t),
    get cookie() {
      return cookie;
    },
  };
}

async function signUp(c, prefix) {
  const email = `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.fiapx.local`;
  const password = 'SenhaE2E1234';
  const reg = await c.call('/auth/register', { method: 'POST', json: { name: 'E2E', email, password }, auth: false });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const login = await c.call('/auth/login', { method: 'POST', json: { email, password }, auth: false });
  assert.equal(login.status, 200);
  c.setToken(login.body.access_token);
  return email;
}

function videoForm(bytes, filename, type = 'video/mp4') {
  const form = new FormData();
  form.append('video', new Blob([bytes], { type }), filename);
  return form;
}

/** Conta os arquivos de um zip pelas entradas do diretório central (assinatura PK\x01\x02). */
function zipEntries(buf) {
  let n = 0;
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) n++;
  }
  return n;
}

const waitStatus = (c, id, statuses) =>
  until(async () => {
    const { body } = await c.call(`/videos/${id}`);
    return statuses.includes(body?.status) ? body : null;
  }, `vídeo ${id} em ${statuses.join('/')}`);

describe('FIAP X — sistema completo', () => {
  const ana = client();
  let anaEmail;
  let video;

  before(async () => {
    const health = await fetch(`${BASE}/`);
    assert.equal(health.status, 200, 'gateway/front no ar (rode make up)');
    anaEmail = await signUp(ana, 'ana');
  });

  it('autenticação: rotas protegidas, /me, refresh por cookie', async () => {
    assert.equal((await client().call('/videos')).status, 401);

    const me = await ana.call('/auth/me');
    assert.equal(me.body.email, anaEmail);

    assert.ok(ana.cookie, 'cookie de refresh recebido');
    const refreshed = await ana.call('/auth/refresh', { method: 'POST', auth: false });
    assert.equal(refreshed.status, 200);
    ana.setToken(refreshed.body.access_token);
  });

  it('upload de vídeo real → PENDING → DONE → zip com 1 frame por segundo', async () => {
    const bytes = await readFile(FIXTURE);
    const up = await ana.call('/videos', { method: 'POST', form: videoForm(bytes, 'aula e2e.mp4') });
    assert.equal(up.status, 202, JSON.stringify(up.body));
    assert.equal(up.body.status, 'PENDING');
    video = up.body;

    const done = await waitStatus(ana, video.id, ['DONE', 'FAILED']);
    assert.equal(done.status, 'DONE', done.error_message ?? '');
    assert.equal(done.frame_count, 5);

    const dl = await ana.call(`/videos/${video.id}/download`);
    assert.equal(dl.status, 200);
    const zip = await fetch(dl.body.url);
    assert.equal(zip.status, 200);
    assert.match(zip.headers.get('content-disposition') ?? '', /aula%20e2e_frames\.zip/);
    assert.equal(zipEntries(new Uint8Array(await zip.arrayBuffer())), 5);
  });

  it('vários vídeos ao mesmo tempo: todos aceitos e concluídos', async () => {
    const bytes = await readFile(FIXTURE);
    const ups = await Promise.all(
      Array.from({ length: 6 }, (_, i) => ana.call('/videos', { method: 'POST', form: videoForm(bytes, `lote-${i}.mp4`) })),
    );
    assert.deepEqual(ups.map((u) => u.status), [202, 202, 202, 202, 202, 202]);
    const results = await Promise.all(ups.map((u) => waitStatus(ana, u.body.id, ['DONE', 'FAILED'])));
    assert.ok(results.every((r) => r.status === 'DONE'));
  });

  it('arquivo inválido → FAILED com o motivo e e-mail para o usuário', async () => {
    const up = await ana.call('/videos', {
      method: 'POST',
      form: videoForm(new TextEncoder().encode('isto não é um vídeo'), 'corrompido.mkv', 'video/x-matroska'),
    });
    assert.equal(up.status, 202);

    const failed = await waitStatus(ana, up.body.id, ['DONE', 'FAILED']);
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.error_message, /ffmpeg/);

    const mail = await until(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${anaEmail}`)}`);
      const { messages = [] } = await res.json();
      return messages.find((m) => m.Subject.includes('corrompido.mkv'));
    }, 'e-mail de falha no Mailpit');
    assert.equal(mail.Subject, 'Falha ao processar o vídeo "corrompido.mkv"');
  });

  it('validações do upload: formato e ausência de arquivo', async () => {
    const pdf = await ana.call('/videos', { method: 'POST', form: videoForm(new Uint8Array(10), 'doc.pdf', 'application/pdf') });
    assert.equal(pdf.status, 400);
    assert.match(pdf.body.error, /Formato não suportado/);

    const empty = await ana.call('/videos', { method: 'POST', form: new FormData() });
    assert.equal(empty.status, 400);
  });

  it('listagem com totais por status e isolamento entre usuários', async () => {
    const list = await ana.call('/videos?page=1&page_size=50');
    assert.equal(list.status, 200);
    assert.equal(list.body.counts.DONE, 7);
    assert.equal(list.body.counts.FAILED, 1);

    const bia = client();
    await signUp(bia, 'bia');
    const other = await bia.call('/videos');
    assert.equal(other.body.total, 0);
    assert.equal((await bia.call(`/videos/${video.id}`)).status, 404);
    assert.equal((await bia.call(`/videos/${video.id}/download`)).status, 404);
  });

  it('logout revoga a sessão', async () => {
    assert.equal((await ana.call('/auth/logout', { method: 'POST', auth: false })).status, 204);
    assert.equal((await ana.call('/auth/refresh', { method: 'POST', auth: false })).status, 401);
  });
});
