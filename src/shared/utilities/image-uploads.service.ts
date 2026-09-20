import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import FormData from 'form-data';

import {
  SAFE_FILENAME_PATTERN,
  UNSAFE_FILENAME_PATTERN,
} from '../constants/regex-patterns.constants';
import { SecretsService } from '../secrets/secrets.service';
import { stringifyError } from './error.utility';

/** One cleared picture, on its way to Cloudflare Images. */
export interface PublishImageInput {
  /** The person the image is recorded under, when one is known. */
  readonly userId: string | null;
  /** The bytes, read back out of quarantine. */
  readonly buffer: Buffer;
  /** The filename as uploaded, sanitised again here. */
  readonly filename: string | null;
  /** What reading the bytes found the image to be. */
  readonly contentType: string | null;
  /** What kind of thing it is, as Cloudflare records it. */
  readonly entityType: string | null;
  /** What it belongs to, as Cloudflare records it. */
  readonly entityId: string | null;
}

/**
 * What a file with no usable name is called in Cloudflare.
 *
 * A filename is user-supplied text and a missing one is ordinary: nothing
 * about an image needs it, and the registry keeps the original separately
 * for the features that show it back.
 */
const FALLBACK_IMAGE_FILENAME = 'upload';

@Injectable()
export class ImageUploadsService {
  private readonly _logger = new Logger(ImageUploadsService.name);
  private readonly _bucketName: string;
  private readonly _environment: string;
  private cloudflareImagesAccountId: string;
  private cloudflareImagesApiKey: string;

  /**
   * Creates an instance of ImageUploadsService.
   *
   * @param _secretsService - The secrets service.
   * @param _configService - The config service.
   * @param _s3Client - The s3 client.
   */
  constructor(
    private readonly _secretsService: SecretsService,
    private readonly _configService: ConfigService,
    private readonly _s3Client: S3Client,
  ) {
    this._bucketName = this._configService.get<string>(
      'CLOUDFLARE_R2_BUCKET_NAME',
    )!;
    this._environment = this._configService.get<string>('NODE_ENV')!;
  }

  /**
   * NestJS lifecycle hook called when the module is initialised.
   *
   * @returns A promise that resolves when the service is fully initialised.
   */
  async onModuleInit() {
    await this.init();
  }

  /**
   * Internal initialisation method that fetches secrets from AWS.
   *
   * @throws BadRequestException if the Cloudflare R2 secrets are missing.
   * @returns A promise that resolves when initialisation is complete.
   */
  private async init() {
    const secretObject = await this._secretsService.getSecret(
      process.env.AWS_SECRET_NAME!,
    );

    const errorMsgMissingCloudflareR2 =
      'Missing Cloudflare R2 access key or secret';

    if (!secretObject) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    if (!secretObject.cloudflareR2AccessKey) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    if (!secretObject.cloudflareR2Secret) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    // Set the variables from the AWS Secrets object
    this.cloudflareImagesAccountId = secretObject.cloudflareImagesAccountId;
    this.cloudflareImagesApiKey = secretObject.cloudflareImagesApiKey;
  }

  /**
   * Upload an image to Cloudflare R2 bucket.
   *
   * **Currently unused.** Every upload the site accepts goes to Cloudflare
   * Images through {@link publishImageToCloudflareImages}; the R2 bucket now
   * only serves Character portraits stored before that move. Kept because
   * document uploads are a likely future feature and Cloudflare Images cannot
   * serve a PDF.
   *
   * **Do not wire a new feature to this method.** It builds its key from the
   * uploaded filename, which is safe for an image that is scanned before it is
   * stored and unsafe for anything that is scanned afterwards: R2 has no
   * object versioning, so a reusable key lets a second upload overwrite the
   * first and inherit its clean verdict. New uploads belong in the asset
   * registry — see `docs/file-assets.md`, "Adding a new kind of upload later".
   *
   * @param userId - The ID of the user uploading the image.
   * @param file - The Multer file object containing the image.
   * @param characterId - Optional character ID to use in the storage path.
   * @returns A promise that resolves to the storage key of the uploaded image.
   */
  async uploadImageToCloudflareR2(
    userId: string,
    file: Express.Multer.File,
    characterId?: string,
  ) {
    this._logger.debug(
      `[uploadImageToCloudflareR2] Starting upload - UserId: ${userId}, CharacterId: ${characterId}, FileName: ${file?.originalname}, FileSize: ${file?.size} bytes`,
    );

    try {
      const { fileBuffer, safeFileName } = this.validateAndSanitiseFile(
        userId,
        file,
      );

      this._logger.debug(
        `[uploadImageToCloudflareR2] File validated - OriginalName: ${file.originalname}, SafeName: ${safeFileName}, BufferSize: ${fileBuffer.length} bytes`,
      );

      // Prepare the Cloudflare key (path and filename within the bucket)
      const folderPath = characterId ? `${userId}/${characterId}` : userId;
      const fileKey = `${this._environment}/${folderPath}/${safeFileName}`;

      this._logger.debug(
        `[uploadImageToCloudflareR2] Prepared for R2 - FileKey: ${fileKey}, Bucket: ${this._bucketName}`,
      );

      // Prepare the command to upload the file to R2
      const command = new PutObjectCommand({
        Bucket: this._bucketName,
        Key: fileKey,
        Body: fileBuffer,
        ContentType: file.mimetype,
      });

      // Upload to Cloudflare R2
      this._logger.debug('[uploadImageToCloudflareR2] Sending to R2...');
      await this._s3Client.send(command);

      this._logger.log(
        `[uploadImageToCloudflareR2] Successfully uploaded to R2 - FileKey: ${fileKey}`,
      );

      return fileKey;
    } catch (error: unknown) {
      const message = stringifyError(error);

      const stack = error instanceof Error ? error.stack : undefined;
      this._logger.error(
        `[uploadImageToCloudflareR2] Upload failed - UserId: ${userId}, CharacterId: ${characterId}, Error: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Delete an image from the Cloudflare R2 bucket.
   *
   * **Currently unused**, and kept for the same reason as
   * {@link uploadImageToCloudflareR2}. Note that deleting the object is only
   * half of withdrawing it: an object served through the CDN root may sit in
   * a cache, and the resized `cdn-cgi/image` variants of it are separate URLs.
   * A caller that needs the bytes to stop being reachable also needs a purge —
   * which is why the registry tracks `purgeRequiredAt` and `purgedAt`
   * separately rather than treating a delete as the whole job.
   *
   * @param userId - The user ID associated with the image.
   * @param imageUrl - The full URL or key of the image to delete.
   * @returns A promise that resolves to the key of the deleted image.
   */
  async deleteImageFromCloudflareR2(userId: string, imageUrl: string) {
    if (!userId) {
      throw new BadRequestException('User ID is missing');
    }

    if (!imageUrl) {
      throw new BadRequestException('Image URL is missing');
    }

    const fileKey = imageUrl.replaceAll(
      `${process.env.CLOUDFLARE_CDN_ROOT_URL}/`,
      '',
    );

    const command = new DeleteObjectCommand({
      Bucket: this._bucketName,
      Key: fileKey,
    });

    await this._s3Client.send(command);

    return fileKey;
  }

  /**
   * Publishes cleared bytes to the Cloudflare Images service.
   *
   * **This is publication, not upload.** Since FC-012 nothing reaches
   * Cloudflare until a scanner has cleared it and the registry has been
   * moved to `AVAILABLE`, so what arrives here is a buffer read back out of
   * quarantine rather than a file off a request. That is the whole of the
   * difference and it is why the parameter is no longer a Multer file: by
   * this point the request that carried it finished minutes ago, in another
   * process.
   *
   * Nothing is validated here. The bytes were checked against the slot's
   * rules at ingress, hashed, quarantined and scanned; re-deciding any of
   * that now would be a second opinion formed with less evidence.
   *
   * @param input - The bytes, and what Cloudflare records them against.
   * @returns A promise that resolves to the unique Cloudflare Image ID.
   */
  async publishImageToCloudflareImages(
    input: PublishImageInput,
  ): Promise<string> {
    const userId = input.userId ?? 'unknown';
    const safeFileName = this.sanitiseFilename(input.filename);

    this._logger.debug(
      `[publishImageToCloudflareImages] Starting publication - UserId: ${userId}, EntityType: ${input.entityType || 'none'}, EntityId: ${input.entityId || 'none'}, FileName: ${safeFileName}`,
    );

    const errorMsgFailedUpload = 'Failed to upload image to Cloudflare Images';

    // Create a FormData instance and append the file
    const formData = new FormData();
    formData.append('file', input.buffer, {
      filename: safeFileName,
      contentType: input.contentType ?? 'application/octet-stream',
    });

    const customId = this.buildCloudflareCustomId(
      userId,
      input.entityType ?? undefined,
      input.entityId ?? undefined,
    );

    this._logger.debug(
      `[publishImageToCloudflareImages] Generated custom ID: ${customId}`,
    );

    // Append the custom ID
    formData.append('id', customId);

    // Append metadata as a JSON string for additional context
    const metadata = {
      userId,
      originalFileName: safeFileName,
      env: this._environment,
      uploadedAt: new Date().toISOString(),
      ...(input.entityType && { entityType: input.entityType }),
      ...(input.entityId && { entityId: input.entityId }),
    };

    formData.append('metadata', JSON.stringify(metadata));

    this._logger.debug(
      `[publishImageToCloudflareImages] Metadata: ${JSON.stringify(metadata)}`,
    );

    try {
      // Upload the image to Cloudflare Images with metadata
      const response = await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareImagesAccountId}/images/v1`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${this.cloudflareImagesApiKey}`,
          },
        },
      );

      const imageId = this.extractCloudflareImageId(
        response,
        errorMsgFailedUpload,
      );

      this._logger.log(
        `[publishImageToCloudflareImages] Successfully published - ImageId: ${imageId}`,
      );

      return imageId;
    } catch (error: unknown) {
      const errorMessage = stringifyError(error);

      const errorDetails = this.getCloudflareUploadErrorDetails(error);

      this._logger.error(
        `[publishImageToCloudflareImages] Publication failed - Error: ${errorMessage}`,
        errorDetails,
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }
  }

  /**
   * Builds the Cloudflare custom identifier.
   *
   * @param userId - The user id.
   * @param entityType - The entity type.
   * @param entityId - The entity id.
   * @returns The result of the operation.
   */
  private buildCloudflareCustomId(
    userId: string,
    entityType?: string,
    entityId?: string,
  ): string {
    // Format: env-userId-entityType-entityId-timestamp
    const timestamp = Date.now();
    const parts = [this._environment, userId];
    if (entityType) {
      parts.push(entityType);
    }
    if (entityId) {
      parts.push(entityId);
    }
    parts.push(String(timestamp));
    return parts.join('-');
  }

  /**
   * Extracts the Cloudflare image identifier from a URL.
   *
   * @param response - The response.
   * @param errorMsgFailedUpload - The error msg failed upload.
   * @returns The result of the operation.
   */
  private extractCloudflareImageId(
    response: unknown,
    errorMsgFailedUpload: string,
  ): string {
    if (!response || typeof response !== 'object') {
      this._logger.error(
        '[publishImageToCloudflareImages] Response is missing or invalid',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    const status = (response as { status?: unknown }).status;
    if (status !== 200) {
      this._logger.error(
        `[publishImageToCloudflareImages] Upload failed with status ${stringifyError(status)}`,
      );

      throw new BadRequestException(errorMsgFailedUpload);
    }

    const data = (response as { data?: any }).data;
    if (!data) {
      this._logger.error(
        '[publishImageToCloudflareImages] Response data is missing',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    if (!data.result) {
      this._logger.error(
        '[publishImageToCloudflareImages] Response result is missing',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    const id = data.result.id as unknown;
    if (typeof id !== 'string' || id.length === 0) {
      this._logger.error(
        '[publishImageToCloudflareImages] Response result ID is missing',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    return id;
  }

  /**
   * Gets Cloudflare upload error details.
   *
   * @param error - The error.
   * @returns The result of the operation.
   */
  private getCloudflareUploadErrorDetails(error: unknown): unknown {
    if (axios.isAxiosError(error)) {
      return error.response?.data;
    }
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  }

  /**
   * Delete an image from Cloudflare Images.
   *
   * @param imageId - The unique ID of the image to delete.
   * @returns A promise that resolves to the ID of the deleted image.
   * @throws BadRequestException if the deletion fails.
   */
  async deleteImageFromCloudflareImages(imageId: string) {
    if (!imageId) {
      throw new BadRequestException('Image ID is missing');
    }

    const response = await axios.delete(
      `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareImagesAccountId}/images/v1/${imageId}`,
      {
        headers: {
          Authorization: `Bearer ${this.cloudflareImagesApiKey}`,
        },
      },
    );

    if (response.status !== 200) {
      throw new BadRequestException(
        'Failed to delete image from Cloudflare Images',
      );
    }

    return imageId;
  }

  /**
   * Checks an uploaded file over and gives its name a safe spelling.
   *
   * Everything a request can establish about a file without looking at what
   * the bytes are: that there is a user, that there is a file, that its
   * claimed type is one of the three the site accepts, that it is within the
   * configured ceiling and that its name can be written down. What the bytes
   * actually are is decided by the image reader at ingress and by the
   * scanner afterwards.
   *
   * **It no longer scans.** The synchronous Cloudmersive call that used to
   * sit at the end of this was removed with FC-012: ADR-0005 replaced that
   * engine with ClamAV in the worker, and a scan performed here looked at a
   * buffer in memory, left no durable record, and cleared bytes that were
   * then stored separately — which is the gap the registry exists to close.
   *
   * @param userId - The ID of the user owning the file.
   * @param file - The Multer file object to validate.
   * @returns The bytes and a filename safe to record.
   * @throws BadRequestException if the file is invalid or too large.
   */
  validateAndSanitiseFile(
    userId: string,
    file: Express.Multer.File,
  ): { fileBuffer: Buffer; safeFileName: string } {
    this._logger.debug(
      `[validateAndSanitiseFile] Starting validation - UserId: ${userId}, FileName: ${file?.originalname}, FileSize: ${file?.size} bytes, MimeType: ${file?.mimetype}`,
    );

    if (!userId) {
      this._logger.error('[validateAndSanitiseFile] User ID is missing');
      throw new BadRequestException('User ID is missing');
    }

    if (!file) {
      this._logger.error('[validateAndSanitiseFile] File is missing');
      throw new BadRequestException('File is missing');
    }

    if (!file.mimetype) {
      this._logger.error('[validateAndSanitiseFile] File mimetype is missing');
      throw new BadRequestException('File mimetype is missing');
    }

    // Validate file type and size (allow only jpeg, jpg, or png)
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)) {
      this._logger.error(
        `[validateAndSanitiseFile] Invalid mimetype - MimeType: ${file.mimetype}`,
      );
      throw new BadRequestException(
        'Invalid file type. Only jpeg, jpg, or png are allowed',
      );
    }

    const maxSize = +process.env.MAX_IMAGE_SIZE_IN_BYTES!;
    if (file.size > maxSize) {
      this._logger.error(
        `[validateAndSanitiseFile] File too large - Size: ${file.size} bytes, MaxSize: ${maxSize} bytes`,
      );
      throw new BadRequestException('File too large');
    }

    if (!file.buffer) {
      this._logger.error('[validateAndSanitiseFile] File buffer is missing');
      throw new BadRequestException('File buffer is missing');
    }

    if (!file.filename && !file.originalname) {
      this._logger.error('[validateAndSanitiseFile] File name is missing');
      throw new BadRequestException('File name is missing');
    }

    const fileBuffer = file.buffer;

    if (!fileBuffer || fileBuffer.length === 0) {
      this._logger.error('[validateAndSanitiseFile] No image data provided');
      throw new BadRequestException('No image data provided');
    }

    this._logger.debug(
      `[validateAndSanitiseFile] File structure validated - BufferSize: ${fileBuffer.length} bytes`,
    );

    // Sanitize the filename using the SAFE_FILENAME_PATTERN
    const originalFileName = file.filename ? file.filename : file.originalname;
    const safeFileName = originalFileName.replaceAll(
      UNSAFE_FILENAME_PATTERN,
      '_',
    );
    /* istanbul ignore next */
    if (!SAFE_FILENAME_PATTERN.test(safeFileName)) {
      this._logger.error(
        `[validateAndSanitiseFile] Invalid characters in filename - OriginalName: ${originalFileName}, SafeName: ${safeFileName}`,
      );
      throw new BadRequestException('Invalid characters in file name');
    }

    this._logger.debug(
      `[validateAndSanitiseFile] Validation complete - OriginalName: ${originalFileName}, SafeName: ${safeFileName}`,
    );

    return { fileBuffer, safeFileName };
  }

  /**
   * Gives a filename a spelling that is safe to send anywhere.
   *
   * The same substitution {@link validateAndSanitiseFile} applies, done
   * again at publication rather than carried across from ingress. What the
   * registry stored is the name as uploaded, deliberately — it is evidence
   * of what somebody sent — so the sanitised form is derived when it is
   * needed rather than stored beside it and trusted later.
   *
   * @param filename - The filename as uploaded, when there was one.
   * @returns A filename made of characters the pattern allows.
   */
  private sanitiseFilename(filename: string | null): string {
    if (filename === null || filename.length === 0) {
      return FALLBACK_IMAGE_FILENAME;
    }

    // No second check afterwards. UNSAFE_FILENAME_PATTERN is the exact
    // complement of SAFE_FILENAME_PATTERN, so a substitution that replaces
    // every character matching the first cannot leave one that fails the
    // second; a check here would be an unreachable branch pretending to be
    // a safeguard. The two patterns are defined next to each other for
    // precisely this reason.
    return filename.replaceAll(UNSAFE_FILENAME_PATTERN, '_');
  }
}
