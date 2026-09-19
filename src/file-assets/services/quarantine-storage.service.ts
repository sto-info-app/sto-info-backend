import { Readable } from 'stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * The injection token for the quarantine bucket's own S3 client.
 *
 * A distinct token, and behind it a distinct client with distinct credentials,
 * because the point of the separation is that the key which writes the public
 * bucket cannot read the private one and the key which reads the private one
 * cannot publish anything. Two clients sharing one credential would put that
 * back.
 */
export const QUARANTINE_S3_CLIENT = Symbol('QUARANTINE_S3_CLIENT');

/** What is known about an object being put into quarantine. */
export interface QuarantinePutResult {
  /** The key the object was written under. */
  readonly objectKey: string;
  /** The storage provider's version of the written object, when it gave one. */
  readonly objectVersion: string | null;
}

/**
 * The private bucket that uploaded bytes land in and mostly stay in.
 *
 * Separate from the bucket the site delivers from, and that separation is the
 * second acceptance criterion rather than a tidiness preference. The existing
 * bucket is already reachable through `cdn.startrekonline.info`; a key prefix
 * inside it would be quarantined only for as long as nobody added a rule, a
 * redirect or a Worker that reached the prefix, and proving the absence of
 * such a thing is a proof that has to be redone after every configuration
 * change. Which bucket an object is in is a property that cannot drift.
 *
 * One bucket serves every environment, with the environment as the first
 * segment of the key, matching how the delivery bucket is already laid out —
 * ADR-0017. R2 cannot scope a token to a key prefix, only to a bucket, so a
 * credential for one environment's quarantine reaches them all. Every
 * quarantine credential is therefore a production credential whichever
 * environment issued it.
 *
 * The bucket has no public access, no custom domain, no `r2.dev` subdomain and
 * no Cloudflare Images variant. Nothing here mints a presigned URL, and that
 * is deliberate: a signed URL is a bearer token with a lifetime, and the third
 * acceptance criterion asks for a later quarantine to deny *new fetches*,
 * which a token already in somebody's hands cannot be made to do. Bytes leave
 * this bucket through the delivery endpoint, which rechecks state and audience
 * on every request, or they do not leave it at all.
 */
@Injectable()
export class QuarantineStorageService {
  private readonly _logger = new Logger(QuarantineStorageService.name);
  private readonly _bucketName: string;

  /**
   * Creates an instance of QuarantineStorageService.
   *
   * @param _s3Client - The quarantine bucket's own S3 client.
   * @param _configService - The config service.
   */
  constructor(
    @Inject(QUARANTINE_S3_CLIENT) private readonly _s3Client: S3Client,
    private readonly _configService: ConfigService,
  ) {
    this._bucketName = this._configService.get<string>(
      'CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME',
    )!;
  }

  /**
   * Writes bytes into quarantine.
   *
   * The content type is recorded as `application/octet-stream` whatever the
   * uploader claimed. Nothing in this bucket is rendered by a browser, and a
   * stored type is a hint a later delivery path could be tempted to trust.
   *
   * @param objectKey - The key to write under, derived by the caller from the
   *   asset's own identifier rather than from anything a user supplied.
   * @param body - The bytes.
   * @returns The key and, when the provider supplies one, the object version.
   */
  async put(objectKey: string, body: Buffer): Promise<QuarantinePutResult> {
    const response = await this._s3Client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: objectKey,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );

    this._logger.debug(
      `[put] Stored in quarantine - Key: ${objectKey}, Bytes: ${body.length}`,
    );

    return { objectKey, objectVersion: response.VersionId ?? null };
  }

  /**
   * Opens a stream of an object's bytes.
   *
   * Streamed rather than buffered: the delivery endpoint hands these straight
   * to a response, and reading a whole file into the process to do that would
   * make the size of an upload the size of a spike in memory.
   *
   * @param objectKey - The key to read.
   * @param objectVersion - The version to read, when the object has one.
   *   **R2 has none** — it does not implement bucket versioning, so this is
   *   null for every object in this bucket and the guarantee that the bytes
   *   served are the bytes a scanner cleared rests instead on the key never
   *   being reused and on the hash being write-once. The parameter stays
   *   because the registry is not R2-specific and a store that does version
   *   objects would fill it in. ADR-0017.
   * @returns The object's bytes.
   * @throws Error when the provider returns no body.
   */
  async getStream(
    objectKey: string,
    objectVersion: string | null,
  ): Promise<Readable> {
    const response = await this._s3Client.send(
      new GetObjectCommand({
        Bucket: this._bucketName,
        Key: objectKey,
        ...(objectVersion === null ? {} : { VersionId: objectVersion }),
      }),
    );

    if (!response.Body) {
      throw new Error(`Quarantine object has no body: ${objectKey}`);
    }

    return response.Body as Readable;
  }

  /**
   * Removes an object from quarantine.
   *
   * @param objectKey - The key to remove.
   */
  async remove(objectKey: string): Promise<void> {
    await this._s3Client.send(
      new DeleteObjectCommand({ Bucket: this._bucketName, Key: objectKey }),
    );

    this._logger.log(`[remove] Removed from quarantine - Key: ${objectKey}`);
  }

  /**
   * Builds the key an asset's bytes are stored under.
   *
   * Derived entirely from the asset's own identifier and never from the
   * filename somebody uploaded. A key built from user text is a path somebody
   * else can be persuaded to write, and the filename is kept on the row where
   * it is treated as the user-supplied text it is.
   *
   * **This is the only place a quarantine key is constructed, and it has to
   * stay that way.** R2 has no object versioning, so a verdict is bound to its
   * bytes by the key never being reused: every upload is a new asset with a
   * new UUID, so no key is ever written twice. A caller that invented its own
   * key scheme could break that without anything failing visibly. ADR-0017.
   *
   * The environment leads the key because one bucket serves all of them, the
   * way the delivery bucket already does.
   *
   * @param assetId - The asset the bytes belong to.
   * @returns The object key.
   */
  buildObjectKey(assetId: string): string {
    const environment = this._configService.get<string>('NODE_ENV')!;

    return `${environment}/assets/${assetId}`;
  }
}
