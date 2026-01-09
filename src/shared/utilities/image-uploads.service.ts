import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cloudmersiveVirusApiClient from 'cloudmersive-virus-api-client';
import * as FormData from 'form-data';
import { File as MulterFile } from 'multer';
import {
  SAFE_FILENAME_PATTERN,
  UNSAFE_FILENAME_PATTERN,
} from '../constants/regex-patterns.constants';
import { SecretsService } from '../secrets/secrets.service';

@Injectable()
export class ImageUploadsService {
  private readonly logger = new Logger(ImageUploadsService.name);
  private readonly bucketName: string;
  private readonly environment: string;
  private cloudmersiveApiKey: string;
  private cloudflareImagesAccountId: string;
  private cloudflareImagesApiKey: string;

  constructor(
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    private s3Client: S3Client,
  ) {
    this.bucketName = this.configService.get<string>(
      'CLOUDFLARE_R2_BUCKET_NAME',
    );
    this.environment = this.configService.get<string>('NODE_ENV');
  }

  /**
   * Initialise the image upload service.
   */
  async onModuleInit() {
    await this.init();
  }

  /**
   * Initialise the image uploads service.
   * @throws BadRequestException if the Cloudflare R2 access key or secret is missing
   * @throws BadRequestException if the Cloudmersive API key is missing
   */
  private async init() {
    const secretObject = await this.secretsService.getSecret(
      process.env.AWS_SECRET_NAME,
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

    // Initialise the S3 client with Cloudflare R2 endpoint and credentials
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
      credentials: {
        accessKeyId: secretObject.cloudflareR2AccessKey,
        secretAccessKey: secretObject.cloudflareR2Secret,
      },
    });

    // Set the variables from the AWS Secrets object
    this.cloudmersiveApiKey = secretObject.cloudmersiveApiKey;
    this.cloudflareImagesAccountId = secretObject.cloudflareImagesAccountId;
    this.cloudflareImagesApiKey = secretObject.cloudflareImagesApiKey;
  }

  /**
   * Scan the file for viruses using Cloudmersive.
   * @param fileBuffer The buffer of the file to scan
   * @throws BadRequestException if the file is infected
   */
  private async scanFileForViruses(fileBuffer: Buffer): Promise<void> {
    this.logger.debug(
      `[scanFileForViruses] Starting virus scan - BufferSize: ${fileBuffer.length} bytes`,
    );

    const apiClient = cloudmersiveVirusApiClient.ApiClient.instance;
    const apiKey = apiClient.authentications['Apikey'];
    apiKey.apiKey = this.cloudmersiveApiKey;

    const virusApi = new cloudmersiveVirusApiClient.ScanApi();

    try {
      const scanResult: { FoundViruses: string[] } = await new Promise(
        (resolve, reject) => {
          virusApi.scanFile(fileBuffer, (error, data) => {
            if (error) {
              reject(new Error(error));
            } else {
              resolve(data);
            }
          });
        },
      );

      if (scanResult.FoundViruses && scanResult.FoundViruses.length > 0) {
        this.logger.error(
          `[scanFileForViruses] Viruses detected: ${scanResult.FoundViruses.join(', ')}`,
        );
        throw new BadRequestException(
          `File is infected with viruses: ${scanResult.FoundViruses.join(', ')}`,
        );
      }

      this.logger.debug(
        '[scanFileForViruses] Virus scan passed - No threats found',
      );
    } catch (error) {
      this.logger.error(
        `[scanFileForViruses] Virus scan failed - Error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Upload an image to Cloudflare R2.
   * @param userId The user ID
   * @param file The image to upload
   * @param characterId The character ID (optional)
   * @returns The URL of the uploaded image
   */
  async uploadImageToCloudflareR2(
    userId: string,
    file: MulterFile,
    characterId?: string,
  ) {
    this.logger.debug(
      `[uploadImageToCloudflareR2] Starting upload - UserId: ${userId}, CharacterId: ${characterId}, FileName: ${file.originalname}, FileSize: ${file.size} bytes`,
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
    } catch (error) {
      this.logger.error(
        `[uploadImageToCloudflareR2] Upload failed - UserId: ${userId}, CharacterId: ${characterId}, Error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Delete an image from the Cloudflare R2 bucket.
   * @param userId The user ID
   * @param imageUrl The URL of the image to delete
   * @returns The key of the deleted image
   */
  async deleteImageFromCloudflareR2(userId: string, imageUrl: string) {
    if (!userId) {
      throw new BadRequestException('User ID is missing');
    }

    if (!imageUrl) {
      throw new BadRequestException('Image URL is missing');
    }

    const fileKey = imageUrl.replace(
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
   * Upload an image to Cloudflare Images.
   * @param userId The user ID
   * @param file The image to upload
   * @param entityType Optional entity type (e.g., 'user', 'character')
   * @param entityId Optional entity ID
   * @returns The URL of the uploaded image
   */
  async uploadImageToCloudflareImages(
    userId: string,
    file: MulterFile,
    entityType?: string,
    entityId?: string,
  ) {
    this.logger.debug(
      `[uploadImageToCloudflareImages] Starting upload - UserId: ${userId}, EntityType: ${entityType || 'none'}, EntityId: ${entityId || 'none'}`,
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

    // Create a custom ID that includes env, userId, and optionally entityType/entityId
    // This makes images searchable in Cloudflare dashboard
    // Format: env-userId-entityType-entityId-timestamp
    const timestamp = Date.now();
    let customId = `${this.environment}-${userId}`;
    if (entityType) {
      customId += `-${entityType}`;
    }
    if (entityId) {
      customId += `-${entityId}`;
    }
    customId += `-${timestamp}`;

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

      if (response?.status !== 200) {
        this.logger.error(
          `[uploadImageToCloudflareImages] Upload failed with status ${response?.status}`,
        );
        throw new BadRequestException(errorMsgFailedUpload);
      }

      if (!response.data) {
        this.logger.error(
          '[uploadImageToCloudflareImages] Response data is missing',
        );
        throw new BadRequestException(errorMsgFailedUpload);
      }

      if (!response.data.result) {
        this.logger.error(
          '[uploadImageToCloudflareImages] Response result is missing',
        );
        throw new BadRequestException(errorMsgFailedUpload);
      }

      if (!response.data.result.id) {
        this.logger.error(
          '[uploadImageToCloudflareImages] Response result ID is missing',
        );
        throw new BadRequestException(errorMsgFailedUpload);
      }

      this.logger.log(
        `[uploadImageToCloudflareImages] Successfully uploaded - ImageId: ${response.data.result.id}`,
      );

      return response.data.result.id as string; // Get the ID of the uploaded image
    } catch (error) {
      this.logger.error(
        `[uploadImageToCloudflareImages] Upload failed - Error: ${error.message}`,
        error.response?.data || error.stack,
      );
      throw new BadRequestException(errorMsgFailedUpload);
    }
  }

  /**
   * Delete an image from Cloudflare Images.
   * @param imageId The ID of the image to delete
   * @returns The ID of the deleted image
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
   * Validate and sanitise images to upload to Cloudflare R2 or Cloudflare Images.
   * @param userId The user ID
   * @param file The image to upload
   * @returns The URL of the uploaded image
   */
  private async validateAndSanitiseFile(
    userId: string,
    file: MulterFile,
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

    const maxSize = +process.env.MAX_IMAGE_SIZE_IN_BYTES;
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
    const safeFileName = originalFileName.replace(UNSAFE_FILENAME_PATTERN, '_');
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
