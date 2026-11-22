/**
 * API simulada (MSW) para desenvolver e demonstrar o front sem backend.
 * Reproduz o contrato (contracts/openapi) e a máquina de estados do worker:
 * PENDING → PROCESSING → DONE | FAILED. Arquivos com "erro"/"corrompido" no nome falham.
 */
import { delay, http, HttpResponse } from 'msw';
import type { StatusCounts, User, Video, VideoStatus } from '@/api/types';

interface MockUser extends User {
  password: string;
}

interface MockState {
  users: MockUser[];
  videos: (Video & { userId: string; acceptedAt: number })[];
  /** Simula o cookie de refresh (o service worker não grava cookie HttpOnly). */
  sessionUserId: string | null;
}

const KEY = 'fiapx.mock.state';
const QUEUE_MS = 1500;
const PROCESS_MS = 6000;
const WORKERS = 2;

function load(): MockState {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved) as MockState;
  } catch {
    /* sem storage: estado só em memória */
  }
  return { users: [], videos: [], sessionUserId: null };
}

let state = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sem storage */
  }
};

/** Para os testes: começa de um estado limpo. */
export function resetMockState() {
  state = { users: [], videos: [], sessionUserId: null };
}

const uuid = () => crypto.randomUUID();
const publicUser = ({ password: _p, ...u }: MockUser): User => u;
const err = (status: number, error: string, details?: { field: string; message: string }[]) =>
  HttpResponse.json({ error, ...(details ? { details } : {}) }, { status });

function session(user: MockUser) {
  state.sessionUserId = user.id;
  save();
  return {
    access_token: `mock.${user.id}`,
    token_type: 'Bearer',
    expires_in: 900,
    user: publicUser(user),
  };
}

function currentUser(request: Request): MockUser | undefined {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return state.users.find((u) => token === `mock.${u.id}`);
}

/** Avança a "fila de processamento" com base no tempo, como N workers. */
function tick() {
  const now = Date.now();
  let changed = false;
  for (const v of state.videos) {
    if (v.status === 'PROCESSING' && now - Date.parse(v.updated_at) >= PROCESS_MS) {
      if (/erro|error|corrompido|invalid/i.test(v.original_filename)) {
        v.status = 'FAILED';
        v.error_message = 'ffmpeg: Invalid data found when processing input';
      } else {
        v.status = 'DONE';
        v.frame_count = 12 + Math.floor(Math.random() * 120);
      }
      v.updated_at = new Date().toISOString();
      changed = true;
    }
  }
  let busy = state.videos.filter((v) => v.status === 'PROCESSING').length;
  for (const v of [...state.videos].sort((a, b) => a.acceptedAt - b.acceptedAt)) {
    if (busy >= WORKERS) break;
    if (v.status === 'PENDING' && now - v.acceptedAt >= QUEUE_MS) {
      v.status = 'PROCESSING';
      v.updated_at = new Date().toISOString();
      busy++;
      changed = true;
    }
  }
  if (changed) save();
}

const strip = ({ userId: _u, acceptedAt: _a, ...v }: MockState['videos'][number]): Video => v;

export const handlers = [
  http.post('*/api/auth/register', async ({ request }) => {
    await delay(300);
    const { name, email, password } = (await request.json()) as Record<string, string>;
    const normalized = email.trim().toLowerCase();
    if (password.length < 8 || !/\d/.test(password) || !/\p{L}/u.test(password)) {
      return err(400, 'Dados inválidos', [
        { field: 'password', message: 'A senha deve conter ao menos uma letra e um número' },
      ]);
    }
    if (state.users.some((u) => u.email === normalized)) return err(409, 'E-mail já cadastrado');
    const user: MockUser = {
      id: uuid(),
      name: name.trim(),
      email: normalized,
      password,
      created_at: new Date().toISOString(),
    };
    state.users.push(user);
    save();
    return HttpResponse.json(publicUser(user), { status: 201 });
  }),

  http.post('*/api/auth/login', async ({ request }) => {
    await delay(300);
    const { email, password } = (await request.json()) as Record<string, string>;
    const user = state.users.find(
      (u) => u.email === email.trim().toLowerCase() && u.password === password,
    );
    return user ? HttpResponse.json(session(user)) : err(401, 'E-mail ou senha inválidos');
  }),

  http.post('*/api/auth/refresh', async () => {
    const user = state.users.find((u) => u.id === state.sessionUserId);
    return user ? HttpResponse.json(session(user)) : err(401, 'Sessão inválida ou expirada');
  }),

  http.post('*/api/auth/logout', () => {
    state.sessionUserId = null;
    save();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/videos', ({ request }) => {
    const user = currentUser(request);
    if (!user) return err(401, 'Não autenticado ou token inválido/expirado');
    tick();
    const url = new URL(request.url);
    const status = url.searchParams.get('status') as VideoStatus | null;
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('page_size') ?? 20);
    const mine = state.videos
      .filter((v) => v.userId === user.id)
      .sort((a, b) => b.acceptedAt - a.acceptedAt);
    const counts: StatusCounts = { PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0 };
    mine.forEach((v) => counts[v.status]++);
    const filtered = status ? mine.filter((v) => v.status === status) : mine;
    return HttpResponse.json({
      items: filtered.slice((page - 1) * pageSize, page * pageSize).map(strip),
      page,
      page_size: pageSize,
      total: filtered.length,
      counts,
    });
  }),

  http.post('*/api/videos', async ({ request }) => {
    const user = currentUser(request);
    if (!user) return err(401, 'Não autenticado ou token inválido/expirado');
    const file = (await request.formData()).get('video');
    if (!(file instanceof File))
      return err(400, 'Envie o arquivo no campo "video" (multipart/form-data)');
    await delay(400);
    const now = new Date().toISOString();
    const video = {
      id: uuid(),
      original_filename: file.name,
      size_bytes: file.size,
      status: 'PENDING' as const,
      frame_count: null,
      error_message: null,
      created_at: now,
      updated_at: now,
      userId: user.id,
      acceptedAt: Date.now(),
    };
    state.videos.push(video);
    save();
    return HttpResponse.json(strip(video), { status: 202 });
  }),

  http.get('*/api/videos/:id/download', ({ request, params }) => {
    const user = currentUser(request);
    if (!user) return err(401, 'Não autenticado ou token inválido/expirado');
    const video = state.videos.find((v) => v.id === params.id && v.userId === user.id);
    if (!video) return err(404, 'Vídeo não encontrado');
    if (video.status !== 'DONE')
      return err(409, `O vídeo ainda não está pronto para download (status: ${video.status})`);
    const text = `FIAP X — modo demonstração\nVídeo: ${video.original_filename}\nFrames: ${video.frame_count}\n`;
    return HttpResponse.json({
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
      expires_in: 300,
    });
  }),
];
