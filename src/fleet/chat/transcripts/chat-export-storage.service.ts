import { Readable } from 'stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** The S3 client for the private exports bucket (FC-035). */
export const CHAT_EXPORTS_S3_CLIENT = Symbol('CHAT_EXPORTS_S3_CLIENT');

/**
 * Keeps chat transcripts in the private exports bucket until their link
 * expires (FC-035).
 *
 * Steve's decisions of 29 September 2026: a bucket of its own, since the
 * delivery bucket is served publicly through the CDN and a prefix in it would
 * be private only for as long as nobody pointed a rule at it; with its own
 * credentials, as the quarantine bucket has. It must have no public access,
 * no custom domain and no `r2.dev` subdomain. Nothing here can check that —
 * FC-052 does, live.
 */
@Injectable()
export class ChatExportStorageService {
  private readonly _logger = new Logger(ChatExportStorageService.name);
  private readonly _bucketName: string;

  /**
   * Creates an instance of ChatExportStorageService.
   *
   * @param _s3Client - The exports bucket's own client.
   * @param _configService - Names the bucket and the environment.
   */
  constructor(
    @Inject(CHAT_EXPORTS_S3_CLIENT) private readonly _s3Client: S3Client,
    private readonly _configService: ConfigService,
  ) {
    this._bucketName = this._configService.get<string>(
      'CLOUDFLARE_R2_EXPORTS_BUCKET_NAME',
    )!;
  }

  /**
   * Writes a transcript.
   *
   * @param objectKey - Its key, from {@link buildObjectKey}.
   * @param text - The transcript.
   * @returns How many bytes were written.
   */
  async put(objectKey: string, text: string): Promise<number> {
    const body = Buffer.from(text, 'utf-8');

    await this._s3Client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: objectKey,
        Body: body,
        ContentType: 'text/plain; charset=utf-8',
        CacheControl: 'no-store',
      }),
    );

    this._logger.log(
      `[put] Transcript stored - Key: ${objectKey}, Bytes: ${body.length}`,
    );

    return body.length;
  }

  /**
   * Reads a transcript.
   *
   * @param objectKey - Its key.
   * @returns Its bytes, as a stream.
   * @throws Error when the object has no body.
   */
  async getStream(objectKey: string): Promise<Readable> {
    const response = await this._s3Client.send(
      new GetObjectCommand({ Bucket: this._bucketName, Key: objectKey }),
    );

    if (!response.Body) {
      throw new Error(`Transcript has no body: ${objectKey}`);
    }

    return response.Body as Readable;
  }

  /**
   * Deletes a transcript.
   *
   * @param objectKey - Its key.
   */
  async remove(objectKey: string): Promise<void> {
    await this._s3Client.send(
      new DeleteObjectCommand({ Bucket: this._bucketName, Key: objectKey }),
    );

    this._logger.log(`[remove] Transcript deleted - Key: ${objectKey}`);
  }

  /**
   * The key a transcript is kept under: the environment, then the
   * transcript's own ID — never anything a person typed.
   *
   * @param transcriptId - The transcript.
   * @returns The key.
   */
  buildObjectKey(transcriptId: string): string {
    const environment = this._configService.get<string>('NODE_ENV')!;

    return `${environment}/chat-transcripts/${transcriptId}.txt`;
  }
}
