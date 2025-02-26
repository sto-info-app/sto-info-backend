import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, UploadedFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { File as MulterFile } from 'multer';
import * as path from 'path';
import { SecretsService } from '../secrets/secrets.service';

@Injectable()
export class ImageUploadsService {
  private readonly bucketName: string;
  private readonly environment: string;

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
   * Initialise the mail service.
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

    // Initialise the S3 client with Cloudflare R2 endpoint and credentials
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
      credentials: {
        accessKeyId: secretObject.cloudflareR2AccessKey,
        secretAccessKey: secretObject.cloudflareR2Secret,
      },
    });
  }

  /**
   * Upload a image to Cloudflare R2.
   * @param userId The user ID
   * @param file The image to upload
   * @returns The key of the uploaded image
   */
  async uploadImage(userId: string, @UploadedFile() file: MulterFile) {
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

    if (!file?.path) {
      throw new BadRequestException('File path is missing');
    }

    if (!file?.filename) {
      throw new BadRequestException('File name is missing');
    }

    const imagePath = path.join(process.cwd(), file.path);
    try {
      await fs.access(imagePath);
    } catch (error) {
      throw new BadRequestException(
        'File does not exist at the specified path',
      );
    }

    let fileBuffer: Buffer;

    try {
      const fullPath = path.resolve(imagePath);

      try {
        await fs.access(fullPath);
      } catch (error) {
        console.error(`File does not exist at path: ${fullPath}`);
        throw new BadRequestException('File not found or could not be read');
      }

      fileBuffer = await fs.readFile(fullPath);
    } catch (error) {
      console.error(`Error reading file: ${error.message}`);
      throw new BadRequestException('File not found or could not be read');
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No image data provided');
    }

    // Prepare the Cloudflare key (path and filename within the bucket)
    const fileKey = `${this.environment}/${userId}/${file.filename}`;

    // Prepare the command to upload the file to R2
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: file.mimetype,
    });

    // Upload to Cloudflare R2
    await this.s3Client.send(command);

    const imageUrl = `${process.env.CLOUDFLARE_CDN_ROOT_URL}/${this.bucketName}/${fileKey}`;
    return imageUrl;
  }
}
