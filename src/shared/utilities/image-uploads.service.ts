import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as Cloudmersive from 'cloudmersive-virus-api-client';

import FormData from 'form-data';
import {
  SAFE_FILENAME_PATTERN,
  UNSAFE_FILENAME_PATTERN,
} from '../constants/regex-patterns.constants';
import { SecretsService } from '../secrets/secrets.service';
import { ensureError, stringifyError } from './error.utility';

@Injectable()
export class ImageUploadsService {
  private readonly logger = new Logger(ImageUploadsService.name);
  private readonly bucketName: string;
  private readonly environment: string;
  private cloudmersiveApiKey: string;
  private cloudflareImagesAccountId: string;
  private cloudflareImagesApiKey: string;

  /**
   * Creates an instance of ImageUploadsService.
   *
   * @param secretsService - The secrets service.
   * @param configService - The config service.
   * @param s3Client - The s3 client.
   */
  constructor(
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    private readonly s3Client: S3Client,
  ) {
    this.bucketName = this.configService.get<string>(
      'CLOUDFLARE_R2_BUCKET_NAME',
    )!;
    this.environment = this.configService.get<string>('NODE_ENV')!;
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
   * @throws BadRequestException if the Cloudflare R2 or Cloudmersive secrets are missing.
   * @returns A promise that resolves when initialisation is complete.
   */
  private async init() {
    const secretObject = await this.secretsService.getSecret(
      process.env.AWS_SECRET_NAME!,
    );

    const errorMsgMissingCloudflareR2 =
      'Missing Cloudflare R2 access key or secret';
    const errorMsgMissingCloudmersiveApiKey = 'Missing Cloudmersive API key';

    if (!secretObject) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    if (!secretObject.cloudflareR2AccessKey) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    if (!secretObject.cloudflareR2Secret) {
      throw new BadRequestException(errorMsgMissingCloudflareR2);
    }

    if (!secretObject.cloudmersiveApiKey) {
      throw new BadRequestException(errorMsgMissingCloudmersiveApiKey);
    }

    // Set the variables from the AWS Secrets object
    this.cloudmersiveApiKey = secretObject.cloudmersiveApiKey;
    this.cloudflareImagesAccountId = secretObject.cloudflareImagesAccountId;
    this.cloudflareImagesApiKey = secretObject.cloudflareImagesApiKey;
  }

  /**
   * Scan a file buffer for viruses using the Cloudmersive Scan API.
   *
   * @param fileBuffer - The buffer containing the raw file data to scan.
   * @throws BadRequestException if a virus is detected or the scan fails.
   * @returns A promise that resolves if the file is clean.
   */
  private async scanFileForViruses(fileBuffer: Buffer): Promise<void> {
    this.logger.debug(
      `[scanFileForViruses] Starting virus scan - BufferSize: ${fileBuffer.length} bytes`,
    );

    const apiClient = Cloudmersive.ApiClient.instance;

    const apiKey = apiClient.authentications['Apikey'];
    apiKey.apiKey = this.cloudmersiveApiKey;

    const virusApi = new Cloudmersive.ScanApi();

    try {
      const scanResult = await new Promise<Cloudmersive.VirusScanResult>(
        (resolve, reject) => {
          try {
            virusApi.scanFile(
              fileBuffer,
              (error: unknown, data: Cloudmersive.VirusScanResult) => {
                if (error) {
                  reject(ensureError(error));
                } else {
                  resolve(data);
                }
              },
            );
          } catch (error: unknown) {
            reject(ensureError(error));
          }
        },
      );

      if (scanResult.FoundViruses && scanResult.FoundViruses.length > 0) {
        const virusNames = scanResult.FoundViruses.map(
          (v: Cloudmersive.VirusFound) => v.VirusName,
        ).join(', ');

        this.logger.error(
          `[scanFileForViruses] Viruses detected: ${virusNames}`,
        );
        throw new BadRequestException(
          `File is infected with viruses: ${virusNames}`,
        );
      }

      this.logger.debug(
        '[scanFileForViruses] Virus scan passed - No threats found',
      );
    } catch (error: unknown) {
      this.logger.error(
        `[scanFileForViruses] Virus scan failed - Error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Upload an image to Cloudflare R2 bucket.
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
    this.logger.debug(
      `[uploadImageToCloudflareR2] Starting upload - UserId: ${userId}, CharacterId: ${characterId}, FileName: ${file?.originalname}, FileSize: ${file?.size} bytes`,
    );

    try {
      const { fileBuffer, safeFileName } = await this.validateAndSanitiseFile(
        userId,
        file,
      );

      this.logger.debug(
        `[uploadImageToCloudflareR2] File validated - OriginalName: ${file.originalname}, SafeName: ${safeFileName}, BufferSize: ${fileBuffer.length} bytes`,
      );

      // Prepare the Cloudflare key (path and filename within the bucket)
      const folderPath = characterId ? `${userId}/${characterId}` : userId;
      const fileKey = `${this.environment}/${folderPath}/${safeFileName}`;

      this.logger.debug(
        `[uploadImageToCloudflareR2] Prepared for R2 - FileKey: ${fileKey}, Bucket: ${this.bucketName}`,
      );

      // Prepare the command to upload the file to R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: fileBuffer,
        ContentType: file.mimetype,
      });

      // Upload to Cloudflare R2
      this.logger.debug('[uploadImageToCloudflareR2] Sending to R2...');
      await this.s3Client.send(command);

      this.logger.log(
        `[uploadImageToCloudflareR2] Successfully uploaded to R2 - FileKey: ${fileKey}`,
      );

      return fileKey;
    } catch (error: unknown) {
      const message = stringifyError(error);

      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[uploadImageToCloudflareR2] Upload failed - UserId: ${userId}, CharacterId: ${characterId}, Error: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Delete an image from the Cloudflare R2 bucket.
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
      Bucket: this.bucketName,
      Key: fileKey,
    });

    await this.s3Client.send(command);

    return fileKey;
  }

  /**
   * Upload an image to the Cloudflare Images service.
   *
   * @param userId - The ID of the uploading user.
   * @param file - The image file to upload.
   * @param entityType - Optional category for the image (e.g., 'user', 'character').
   * @param entityId - Optional ID of the related entity.
   * @returns A promise that resolves to the unique Cloudflare Image ID.
   */
  async uploadImageToCloudflareImages(
    userId: string,
    file: Express.Multer.File,
    entityType?: string,
    entityId?: string,
  ) {
    this.logger.debug(
      `[uploadImageToCloudflareImages] Starting upload - UserId: ${userId}, EntityType: ${entityType || 'none'}, EntityId: ${entityId || 'none'}, FileName: ${file?.originalname}`,
    );

    const errorMsgFailedUpload = 'Failed to upload image to Cloudflare Images';
    const { fileBuffer, safeFileName } = await this.validateAndSanitiseFile(
      userId,
      file,
    );

    // Create a FormData instance and append the file
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: safeFileName,
      contentType: file.mimetype,
    });

    const customId = this.buildCloudflareCustomId(userId, entityType, entityId);

    this.logger.debug(
      `[uploadImageToCloudflareImages] Generated custom ID: ${customId}`,
    );

    // Append the custom ID
    formData.append('id', customId);

    // Append metadata as a JSON string for additional context
    const metadata = {
      userId,
      originalFileName: safeFileName,
      env: this.environment,
      uploadedAt: new Date().toISOString(),
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
    };

    formData.append('metadata', JSON.stringify(metadata));

    this.logger.debug(
      `[uploadImageToCloudflareImages] Metadata: ${JSON.stringify(metadata)}`,
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

      this.logger.log(
        `[uploadImageToCloudflareImages] Successfully uploaded - ImageId: ${imageId}`,
      );

      return imageId;
    } catch (error: unknown) {
      const errorMessage = stringifyError(error);

      const errorDetails = this.getCloudflareUploadErrorDetails(error);

      this.logger.error(
        `[uploadImageToCloudflareImages] Upload failed - Error: ${errorMessage}`,
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
    const parts = [this.environment, userId];
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
      this.logger.error(
        '[uploadImageToCloudflareImages] Response is missing or invalid',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    const status = (response as { status?: unknown }).status;
    if (status !== 200) {
      this.logger.error(
        `[uploadImageToCloudflareImages] Upload failed with status ${stringifyError(status)}`,
      );

      throw new BadRequestException(errorMsgFailedUpload);
    }

    const data = (response as { data?: any }).data;
    if (!data) {
      this.logger.error(
        '[uploadImageToCloudflareImages] Response data is missing',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    if (!data.result) {
      this.logger.error(
        '[uploadImageToCloudflareImages] Response result is missing',
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }

    const id = data.result.id as unknown;
    if (typeof id !== 'string' || id.length === 0) {
      this.logger.error(
        '[uploadImageToCloudflareImages] Response result ID is missing',
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
   * Validates and sanitises a file before upload.
   *
   * Checks for valid mimetype, file size, virus presence, and sanitises the filename.
   *
   * @param userId - The ID of the user owning the file.
   * @param file - The Multer file object to validate.
   * @returns A promise that resolves to an object containing the cleaned buffer and safe filename.
   * @throws BadRequestException if the file is invalid, too large, or infected.
   */
  private async validateAndSanitiseFile(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ fileBuffer: Buffer; safeFileName: string }> {
    this.logger.debug(
      `[validateAndSanitiseFile] Starting validation - UserId: ${userId}, FileName: ${file?.originalname}, FileSize: ${file?.size} bytes, MimeType: ${file?.mimetype}`,
    );

    if (!userId) {
      this.logger.error('[validateAndSanitiseFile] User ID is missing');
      throw new BadRequestException('User ID is missing');
    }

    if (!file) {
      this.logger.error('[validateAndSanitiseFile] File is missing');
      throw new BadRequestException('File is missing');
    }

    if (!file.mimetype) {
      this.logger.error('[validateAndSanitiseFile] File mimetype is missing');
      throw new BadRequestException('File mimetype is missing');
    }

    // Validate file type and size (allow only jpeg, jpg, or png)
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)) {
      this.logger.error(
        `[validateAndSanitiseFile] Invalid mimetype - MimeType: ${file.mimetype}`,
      );
      throw new BadRequestException(
        'Invalid file type. Only jpeg, jpg, or png are allowed',
      );
    }

    const maxSize = +process.env.MAX_IMAGE_SIZE_IN_BYTES!;
    if (file.size > maxSize) {
      this.logger.error(
        `[validateAndSanitiseFile] File too large - Size: ${file.size} bytes, MaxSize: ${maxSize} bytes`,
      );
      throw new BadRequestException('File too large');
    }

    if (!file.buffer) {
      this.logger.error('[validateAndSanitiseFile] File buffer is missing');
      throw new BadRequestException('File buffer is missing');
    }

    if (!file.filename && !file.originalname) {
      this.logger.error('[validateAndSanitiseFile] File name is missing');
      throw new BadRequestException('File name is missing');
    }

    const fileBuffer = file.buffer;

    if (!fileBuffer || fileBuffer.length === 0) {
      this.logger.error('[validateAndSanitiseFile] No image data provided');
      throw new BadRequestException('No image data provided');
    }

    this.logger.debug(
      `[validateAndSanitiseFile] File structure validated - BufferSize: ${fileBuffer.length} bytes`,
    );

    // Scan the file for viruses
    await this.scanFileForViruses(fileBuffer);

    // Sanitize the filename using the SAFE_FILENAME_PATTERN
    const originalFileName = file.filename ? file.filename : file.originalname;
    const safeFileName = originalFileName.replaceAll(
      UNSAFE_FILENAME_PATTERN,
      '_',
    );
    /* istanbul ignore next */
    if (!SAFE_FILENAME_PATTERN.test(safeFileName)) {
      this.logger.error(
        `[validateAndSanitiseFile] Invalid characters in filename - OriginalName: ${originalFileName}, SafeName: ${safeFileName}`,
      );
      throw new BadRequestException('Invalid characters in file name');
    }

    this.logger.debug(
      `[validateAndSanitiseFile] Validation complete - OriginalName: ${originalFileName}, SafeName: ${safeFileName}`,
    );

    return { fileBuffer, safeFileName };
  }
}
