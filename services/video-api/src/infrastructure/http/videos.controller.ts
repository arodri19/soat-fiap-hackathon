import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type {
  GetDownloadUrl,
  GetVideo,
  ListVideos,
} from '../../application/use-cases/query-videos';
import type { UploadVideo } from '../../application/use-cases/upload-video';
import { ENV, maxUploadBytes, type Env } from '../../config/env';
import { DomainError, VideoNotFoundError } from '../../domain/errors';
import { VIDEO_STATUSES, type Video } from '../../domain/video';
import { uploadBytes, uploads } from '../observability/metrics';
import { JwtAuthGuard, type AuthenticatedRequest } from '../security/jwt-auth.guard';
import { ValidationFailedException } from './error.filter';
import { handleSingleFileUpload } from './multipart';

export const USE_CASES = {
  upload: Symbol('UploadVideo'),
  list: Symbol('ListVideos'),
  get: Symbol('GetVideo'),
  download: Symbol('GetDownloadUrl'),
  applyStatus: Symbol('ApplyStatusEvent'),
};

export interface VideoResponse {
  id: string;
  original_filename: string;
  size_bytes: number;
  status: Video['status'];
  frame_count: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const toResponse = (v: Video): VideoResponse => ({
  id: v.id,
  original_filename: v.originalFilename,
  size_bytes: v.sizeBytes,
  status: v.status,
  frame_count: v.frameCount,
  error_message: v.errorMessage,
  created_at: v.createdAt.toISOString(),
  updated_at: v.updatedAt.toISOString(),
});

const listQuery = z.object({
  status: z.enum(VIDEO_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID mal formado responde 404 (como um vídeo inexistente), sem chegar ao banco. */
function assertUuid(id: string): void {
  if (!UUID.test(id)) throw new VideoNotFoundError();
}

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(USE_CASES.upload) private readonly uploadVideo: UploadVideo,
    @Inject(USE_CASES.list) private readonly listVideos: ListVideos,
    @Inject(USE_CASES.get) private readonly getVideo: GetVideo,
    @Inject(USE_CASES.download) private readonly getDownloadUrl: GetDownloadUrl,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async upload(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VideoResponse> {
    try {
      const video = await handleSingleFileUpload(req, 'video', maxUploadBytes(this.env), (file) =>
        this.uploadVideo.execute({
          user: req.user,
          filename: file.filename,
          contentType: file.mimeType || 'application/octet-stream',
          stream: file.stream,
          requestId: req.headers['x-request-id'] as string | undefined,
        }),
      );
      uploads.inc({ result: 'accepted' });
      uploadBytes.inc(video.sizeBytes);
      res.setHeader('Location', `/videos/${video.id}`);
      return toResponse(video);
    } catch (error) {
      uploads.inc({ result: error instanceof DomainError ? 'rejected' : 'failed' });
      // Erro antes de ler o corpo inteiro: fecha a conexão para o cliente não ficar enviando
      res.setHeader('Connection', 'close');
      throw error;
    }
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = listQuery.safeParse(query);
    if (!parsed.success) {
      throw new ValidationFailedException(
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    const { status, page, page_size } = parsed.data;
    const result = await this.listVideos.execute(req.user.id, {
      status,
      page,
      pageSize: page_size,
    });
    return {
      items: result.items.map(toResponse),
      page: result.page,
      page_size: result.pageSize,
      total: result.total,
      counts: result.counts,
    };
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<VideoResponse> {
    assertUuid(id);
    return toResponse(await this.getVideo.execute(req.user.id, id));
  }

  @Get(':id/download')
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertUuid(id);
    const { url, expiresIn } = await this.getDownloadUrl.execute(req.user.id, id);
    res.setHeader('Cache-Control', 'no-store');
    return { url, expires_in: expiresIn };
  }
}
