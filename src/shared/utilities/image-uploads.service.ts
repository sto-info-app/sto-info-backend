import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, UploadedFile } from '@nestjs/common';
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
   * Initialize the image upload service.
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

    if (
      !secretObject?.cloudflareR2AccessKey ||
      !secretObject?.cloudflareR2Secret
    ) {
      throw new BadRequestException(
        'Missing Cloudflare R2 access key or secret',
      );
    }

    if (!secretObject?.cloudmersiveApiKey) {
      throw new BadRequestException('Missing Cloudmersive API key');
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
    const apiClient = cloudmersiveVirusApiClient.ApiClient.instance;
    const apiKey = apiClient.authentications['Apikey'];
    apiKey.apiKey = this.cloudmersiveApiKey;

    const virusApi = new cloudmersiveVirusApiClient.ScanApi();

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
      throw new BadRequestException(
        `File is infected with viruses: ${scanResult.FoundViruses.join(', ')}`,
      );
    }
  }

  /**
   * Upload an image to Cloudflare R2.
   * @param userId The user ID
   * @param file The image to upload
   * @returns The URL of the uploaded image
   */
  async uploadImageToCloudflareR2(
    userId: string,
    @UploadedFile() file: MulterFile,
  ) {
    const { fileBuffer, safeFileName } = await this.validateAndSanitiseFile(
      userId,
      file,
    );

    // Prepare the Cloudflare key (path and filename within the bucket)
    const fileKey = `${this.environment}/${userId}/${safeFileName}`;

    // Prepare the command to upload the file to R2
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: file.mimetype,
    });

    // Upload to Cloudflare R2
    await this.s3Client.send(command);

    const imageUrl = `${process.env.CLOUDFLARE_CDN_ROOT_URL}/${fileKey}`;
    return imageUrl;
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
   * @returns The URL of the uploaded image
   */
  async uploadImageToCloudflareImages(
    userId: string,
    @UploadedFile() file: MulterFile,
  ) {
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

    // Append metadata as a JSON string
    formData.append(
      'metadata',
      JSON.stringify({ userId, originalFileName: safeFileName }),
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
          params: {
            metadata: JSON.stringify({
              userId,
              originalFileName: safeFileName,
            }),
          },
        },
      );

      if (response.status !== 200) {
        throw new BadRequestException(
          'Failed to upload image to Cloudflare Images',
        );
      }

      const imageUrl = response.data.result.variants[0]; // Get the URL of the uploaded image
      const imageId = response.data.result.id; // Get the ID of the uploaded image
      const customImageUrl = imageUrl.replace(
        'https://imagedelivery.net',
        `${process.env.CLOUDFLARE_CDN_ROOT_URL}/cdn-cgi/imagedelivery`,
      );

      return { customImageUrl, imageId };
    } catch (error) {
      console.error(
        'Error uploading image to Cloudflare Images:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Failed to upload image to Cloudflare Images',
      );
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
    if (!userId) {
      throw new BadRequestException('User ID is missing');
    }

    if (!file?.mimetype) {
      throw new BadRequestException('File mimetype is missing');
    }

    // Validate file type and size (allow only jpeg, jpg, or png)
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only jpeg, jpg, or png are allowed',
      );
    }

    if (file.size > +process.env.MAX_IMAGE_SIZE_IN_BYTES) {
      throw new BadRequestException('File too large');
    }

    if (!file?.buffer) {
      throw new BadRequestException('File buffer is missing');
    }

    if (!file?.filename && !file?.originalname) {
      throw new BadRequestException('File name is missing');
    }

    const fileBuffer = file.buffer;

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No image data provided');
    }

    // Scan the file for viruses
    await this.scanFileForViruses(fileBuffer);

    // Sanitize the filename using the SAFE_FILENAME_PATTERN
    const safeFileName = (file.filename || file.originalname).replace(
      UNSAFE_FILENAME_PATTERN,
      '_',
    );
    if (!SAFE_FILENAME_PATTERN.test(safeFileName)) {
      throw new BadRequestException('Invalid characters in file name');
    }

    return { fileBuffer, safeFileName };
  }
}
