import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Transform, type Readable } from 'node:stream';
import type { VideoStorage } from '../../application/ports';

export interface S3Settings {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  rawBucket: string;
  zipBucket: string;
}

/**
 * Storage S3 (MinIO no ambiente local). Usa o SDK oficial da AWS, então trocar
 * por S3/R2/SeaweedFS é só configuração.
 */
export class S3VideoStorage implements VideoStorage {
  private readonly client: S3Client;
  /** Cliente só para assinar URLs com o endereço que o navegador enxerga. */
  private readonly signer: S3Client;

  constructor(private readonly settings: S3Settings) {
    const base: S3ClientConfig = {
      region: settings.region,
      forcePathStyle: true,
      // Checksums extras só quando a API exige: o padrão novo do SDK (CRC32 em todo
      // upload) não é suportado por todos os S3 compatíveis (MinIO, SeaweedFS...).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    };
    this.client = new S3Client({ ...base, endpoint: settings.endpoint });
    this.signer = new S3Client({ ...base, endpoint: settings.publicEndpoint });
  }

  async uploadRaw(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<{ sizeBytes: number }> {
    let sizeBytes = 0;
    // Conta os bytes sem consumir o stream (um listener 'data' perderia os primeiros chunks)
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        sizeBytes += chunk.length;
        done(null, chunk);
      },
    });
    // Erros do stream de origem (ex.: limite de tamanho) interrompem o upload
    body.on('error', (error) => counter.destroy(error));
    body.pipe(counter);

    // Upload multipart: envia em partes de 8 MB enquanto recebe, sem carregar o vídeo em memória
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.settings.rawBucket,
        Key: key,
        Body: counter,
        ContentType: contentType,
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
    });
    const aborted = new Promise<never>((_, reject) => counter.once('error', reject));
    try {
      await Promise.race([upload.done(), aborted]);
    } catch (error) {
      await upload.abort().catch(() => undefined);
      throw error;
    }
    return { sizeBytes };
  }

  async deleteRaw(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.rawBucket, Key: key }));
  }

  async presignZipDownload(key: string, downloadName: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.settings.zipBucket,
      Key: key,
      ResponseContentType: 'application/zip',
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    });
    return getSignedUrl(this.signer, command, { expiresIn: ttlSeconds });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.rawBucket }));
      return true;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.client.destroy();
    this.signer.destroy();
  }
}
