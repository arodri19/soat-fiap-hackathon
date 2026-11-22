import type {
  ListFilter,
  OutboxMessage,
  StatusCounts,
  StatusUpdate,
  VideoRepository,
} from '../../application/ports';
import { VIDEO_STATUSES, type Video, type VideoStatus } from '../../domain/video';
import type { Database } from './database';

interface VideoRow {
  id: string;
  user_id: string;
  user_email: string;
  original_filename: string;
  size_bytes: string; // BIGINT chega como string no pg
  storage_key: string;
  zip_key: string | null;
  status: VideoStatus;
  frame_count: number | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, user_id, user_email, original_filename, size_bytes, storage_key, zip_key,
                 status, frame_count, error_message, created_at, updated_at`;

const toDomain = (r: VideoRow): Video => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.user_email,
  originalFilename: r.original_filename,
  sizeBytes: Number(r.size_bytes),
  storageKey: r.storage_key,
  zipKey: r.zip_key,
  status: r.status,
  frameCount: r.frame_count,
  errorMessage: r.error_message,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class PgVideoRepository implements VideoRepository {
  constructor(private readonly db: Database) {}

  async createWithMessage(video: Video, message: OutboxMessage): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO videos (id, user_id, user_email, original_filename, size_bytes, storage_key,
                             status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          video.id,
          video.userId,
          video.userEmail,
          video.originalFilename,
          video.sizeBytes,
          video.storageKey,
          video.status,
          video.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO outbox (exchange, routing_key, message_id, payload, headers)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          message.exchange,
          message.routingKey,
          message.messageId,
          JSON.stringify(message.payload),
          JSON.stringify(message.headers),
        ],
      );
    });
  }

  async findByIdForUser(id: string, userId: string): Promise<Video | null> {
    const { rows } = await this.db.pool.query<VideoRow>(
      `SELECT ${COLUMNS} FROM videos WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(userId: string, filter: ListFilter): Promise<{ items: Video[]; total: number }> {
    const params: unknown[] = [userId];
    let where = 'user_id = $1';
    if (filter.status) {
      params.push(filter.status);
      where += ` AND status = $${params.length}`;
    }
    const [items, count] = await Promise.all([
      this.db.pool.query<VideoRow>(
        `SELECT ${COLUMNS} FROM videos WHERE ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, filter.pageSize, (filter.page - 1) * filter.pageSize],
      ),
      this.db.pool.query<{ total: string }>(
        `SELECT count(*) AS total FROM videos WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows.map(toDomain), total: Number(count.rows[0].total) };
  }

  async countByStatus(userId: string): Promise<StatusCounts> {
    const { rows } = await this.db.pool.query<{ status: VideoStatus; total: string }>(
      `SELECT status, count(*) AS total FROM videos WHERE user_id = $1 GROUP BY status`,
      [userId],
    );
    const counts = Object.fromEntries(VIDEO_STATUSES.map((s) => [s, 0])) as StatusCounts;
    for (const r of rows) counts[r.status] = Number(r.total);
    return counts;
  }

  async applyStatus(
    id: string,
    update: StatusUpdate,
    from: VideoStatus[],
    at: Date,
  ): Promise<boolean> {
    const zipKey = update.status === 'DONE' ? update.zipKey : null;
    const frameCount = update.status === 'DONE' ? update.frameCount : null;
    const errorMessage = update.status === 'FAILED' ? update.errorMessage : null;
    // A condição no WHERE torna a transição atômica e idempotente.
    const { rowCount } = await this.db.pool.query(
      `UPDATE videos
          SET status = $2,
              zip_key = COALESCE($3, zip_key),
              frame_count = COALESCE($4, frame_count),
              error_message = COALESCE($5, error_message),
              updated_at = $6
        WHERE id = $1 AND status = ANY($7::video_status[])`,
      [id, update.status, zipKey, frameCount, errorMessage, at, from],
    );
    return rowCount === 1;
  }
}
