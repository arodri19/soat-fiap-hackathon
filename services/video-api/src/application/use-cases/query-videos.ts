import { VideoNotFoundError, VideoNotReadyError } from '../../domain/errors';
import { zipDownloadName, type Video, type VideoStatus } from '../../domain/video';
import type { StatusCounts, VideoRepository, VideoStorage } from '../ports';

export interface VideoPage {
  items: Video[];
  page: number;
  pageSize: number;
  total: number;
  counts: StatusCounts;
}

export class ListVideos {
  constructor(private readonly videos: VideoRepository) {}

  async execute(
    userId: string,
    filter: { status?: VideoStatus; page: number; pageSize: number },
  ): Promise<VideoPage> {
    const [{ items, total }, counts] = await Promise.all([
      this.videos.list(userId, filter),
      this.videos.countByStatus(userId),
    ]);
    return { items, total, counts, page: filter.page, pageSize: filter.pageSize };
  }
}

export class GetVideo {
  constructor(private readonly videos: VideoRepository) {}

  async execute(userId: string, videoId: string): Promise<Video> {
    const video = await this.videos.findByIdForUser(videoId, userId);
    if (!video) throw new VideoNotFoundError();
    return video;
  }
}

export class GetDownloadUrl {
  constructor(
    private readonly videos: VideoRepository,
    private readonly storage: VideoStorage,
    private readonly ttlSeconds: number,
  ) {}

  async execute(userId: string, videoId: string): Promise<{ url: string; expiresIn: number }> {
    const video = await this.videos.findByIdForUser(videoId, userId);
    if (!video) throw new VideoNotFoundError();
    if (video.status !== 'DONE' || !video.zipKey) throw new VideoNotReadyError(video.status);

    const url = await this.storage.presignZipDownload(
      video.zipKey,
      zipDownloadName(video.originalFilename),
      this.ttlSeconds,
    );
    return { url, expiresIn: this.ttlSeconds };
  }
}
