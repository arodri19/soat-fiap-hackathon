/* Dublês em memória das portas, usados nos testes unitários. */
import { Readable } from 'node:stream';
import { VIDEO_STATUSES, type Video, type VideoStatus } from '../../domain/video';
import type {
  Clock,
  IdGenerator,
  ListFilter,
  OutboxMessage,
  StatusCounts,
  StatusUpdate,
  VideoRepository,
  VideoStorage,
} from '../ports';

export class InMemoryVideoRepository implements VideoRepository {
  readonly videos: Video[] = [];
  readonly outbox: OutboxMessage[] = [];
  failNextCreate = false;

  async createWithMessage(video: Video, message: OutboxMessage) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('banco indisponível');
    }
    this.videos.push({ ...video });
    this.outbox.push(message);
  }

  async findByIdForUser(id: string, userId: string) {
    return this.videos.find((v) => v.id === id && v.userId === userId) ?? null;
  }

  async list(userId: string, filter: ListFilter) {
    const all = this.videos
      .filter((v) => v.userId === userId && (!filter.status || v.status === filter.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  async countByStatus(userId: string) {
    const counts = Object.fromEntries(VIDEO_STATUSES.map((s) => [s, 0])) as StatusCounts;
    for (const v of this.videos) if (v.userId === userId) counts[v.status]++;
    return counts;
  }

  async applyStatus(id: string, update: StatusUpdate, from: VideoStatus[], at: Date) {
    const video = this.videos.find((v) => v.id === id);
    if (!video || !from.includes(video.status)) return false;
    video.status = update.status;
    if (update.status === 'DONE') {
      video.zipKey = update.zipKey;
      video.frameCount = update.frameCount;
    }
    if (update.status === 'FAILED') video.errorMessage = update.errorMessage;
    video.updatedAt = at;
    return true;
  }
}

export class InMemoryVideoStorage implements VideoStorage {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  failUpload: Error | null = null;

  async uploadRaw(key: string, body: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    if (this.failUpload) throw this.failUpload;
    const data = Buffer.concat(chunks);
    this.objects.set(key, data);
    return { sizeBytes: data.length };
  }

  async deleteRaw(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }

  async presignZipDownload(key: string, downloadName: string, ttlSeconds: number) {
    return `https://storage.test/${key}?name=${encodeURIComponent(downloadName)}&ttl=${ttlSeconds}`;
  }
}

export class SequentialIds implements IdGenerator {
  private seq = 0;
  newId() {
    return `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
  }
}

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-11-22T10:00:00Z')) {}
  now() {
    return this.current;
  }
  advanceSeconds(s: number) {
    this.current = new Date(this.current.getTime() + s * 1000);
  }
}

export const streamOf = (content: string | Buffer) => Readable.from([Buffer.from(content)]);

export const USER = { id: 'user-a', email: 'ana@exemplo.com' };
export const OTHER_USER = { id: 'user-b', email: 'bia@exemplo.com' };
