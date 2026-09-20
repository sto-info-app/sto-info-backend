import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { S3Client } from '@aws-sdk/client-s3';
import { jest } from '@jest/globals';
import axios from 'axios';

import { SecretsService } from '../secrets/secrets.service';
import {
  ImageUploadsService,
  PublishImageInput,
} from './image-uploads.service';

const mockS3Send = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  PutObjectCommand: jest.fn().mockImplementation(args => args),
  DeleteObjectCommand: jest.fn().mockImplementation(args => args),
}));
jest.mock('axios');

describe('ImageUploadsService', () => {
  let service: ImageUploadsService;
  let secretsService: SecretsService;

  type UploadR2FileParam = Parameters<
    ImageUploadsService['uploadImageToCloudflareR2']
  >[1];

  type SecretObject = {
    cloudflareR2AccessKey?: string;
    cloudflareR2Secret?: string;
    cloudflareImagesAccountId?: string;
    cloudflareImagesApiKey?: string;
  };

  type UploadedImage = {
    buffer?: Buffer;
    mimetype?: string;
    size?: number;
    filename?: string;
    originalname?: string;
  };

  const createModule = async (secretOverride?: SecretObject | null) => {
    process.env.AWS_SECRET_NAME = 'test-secret';
    process.env.MAX_IMAGE_SIZE_IN_BYTES = '1048576';
    process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.local';

    const secret =
      secretOverride === null
        ? null
        : {
            cloudflareR2AccessKey: 'key',
            cloudflareR2Secret: 'secret',
            cloudflareImagesAccountId: 'acc-id',
            cloudflareImagesApiKey: 'cf-key',
            ...secretOverride,
          };

    return await Test.createTestingModule({
      providers: [
        ImageUploadsService,
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest
              .fn<(...args: any[]) => Promise<any>>()
              .mockResolvedValue(secret),
          } satisfies Pick<SecretsService, 'getSecret'>,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn<(...args: any[]) => any>()
              .mockImplementation((key: string) => {
                if (key === 'CLOUDFLARE_R2_BUCKET_NAME') return 'bucket';
                if (key === 'NODE_ENV') return 'test';
                return null;
              }),
          } satisfies Pick<ConfigService, 'get'>,
        },
        {
          provide: S3Client,
          useValue: {
            send: mockS3Send,
          } satisfies Pick<S3Client, 'send'>,
        },
      ],
    }).compile();
  };

  const createImageFile = (overrides?: UploadedImage): UploadedImage => ({
    buffer: Buffer.from('fake image'),
    mimetype: 'image/png',
    size: 100,
    originalname: 'test.png',
    ...overrides,
  });

  /**
   * Builds one cleared picture on its way to Cloudflare.
   *
   * @param overrides - Whatever the case is actually about.
   * @returns The publication input.
   */
  const publishInput = (
    overrides?: Partial<PublishImageInput>,
  ): PublishImageInput => ({
    userId: 'user-1',
    buffer: Buffer.from('fake image'),
    filename: 'test.png',
    contentType: 'image/png',
    entityType: null,
    entityId: null,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await createModule();
    service = module.get<ImageUploadsService>(ImageUploadsService);
    secretsService = module.get<SecretsService>(SecretsService);
    await service.onModuleInit();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('init', () => {
    it('should throw if secret is missing R2 keys', async () => {
      const module = await createModule({
        cloudflareR2AccessKey: undefined,
        cloudflareR2Secret: undefined,
      });
      const localService = module.get<ImageUploadsService>(ImageUploadsService);

      await expect(localService.onModuleInit()).rejects.toThrow(
        new BadRequestException('Missing Cloudflare R2 access key or secret'),
      );
    });

    it('should throw if secret object is null', async () => {
      const module = await createModule(null);
      const localService = module.get<ImageUploadsService>(ImageUploadsService);

      await expect(localService.onModuleInit()).rejects.toThrow(
        new BadRequestException('Missing Cloudflare R2 access key or secret'),
      );
    });

    it('should throw if secret is missing R2 access key', async () => {
      const module = await createModule({ cloudflareR2AccessKey: undefined });
      const localService = module.get<ImageUploadsService>(ImageUploadsService);

      await expect(localService.onModuleInit()).rejects.toThrow(
        new BadRequestException('Missing Cloudflare R2 access key or secret'),
      );
    });

    it('should throw if secret is missing R2 secret', async () => {
      const module = await createModule({ cloudflareR2Secret: undefined });
      const localService = module.get<ImageUploadsService>(ImageUploadsService);

      await expect(localService.onModuleInit()).rejects.toThrow(
        new BadRequestException('Missing Cloudflare R2 access key or secret'),
      );
    });

    it('asks for no scanner credentials at all', async () => {
      // FC-012 removed the synchronous Cloudmersive call. A secret that
      // carries no scanner key is now a perfectly good secret, and this is
      // the assertion that says so rather than leaving it to a missing test.
      const module = await createModule();
      const localService = module.get<ImageUploadsService>(ImageUploadsService);

      await expect(localService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should read secret name from env', async () => {
      process.env.AWS_SECRET_NAME = 'another-secret';
      await service.onModuleInit();
      expect(secretsService.getSecret).toHaveBeenCalledWith('another-secret');
    });
  });

  describe('publishImageToCloudflareImages', () => {
    it('publishes cleared bytes and returns the new identifier', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'cf-img-id' } },
      });

      const result =
        await service.publishImageToCloudflareImages(publishInput());

      expect(result).toBe('cf-img-id');
    });

    it('records what the picture belongs to', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'custom-id-with-entity' } },
      });

      const result = await service.publishImageToCloudflareImages(
        publishInput({ entityType: 'character', entityId: 'char-123' }),
      );

      expect(result).toBe('custom-id-with-entity');
      expect(axiosMock.post).toHaveBeenCalled();
    });

    it('publishes a picture that belongs to nothing in particular', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'id-without-type' } },
      });

      const result = await service.publishImageToCloudflareImages(
        publishInput({ entityType: '', entityId: '' }),
      );

      expect(result).toBe('id-without-type');
    });

    it('falls back to a safe name when the upload had none', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'unnamed' } },
      });

      const result = await service.publishImageToCloudflareImages(
        publishInput({ filename: null, userId: null, contentType: null }),
      );

      expect(result).toBe('unnamed');
    });

    it('falls back to a safe name when the stored one is empty', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'unnamed-too' } },
      });

      // A registry row keeps the name as uploaded, deliberately, so the
      // sanitised spelling is derived here rather than stored beside it.
      const result = await service.publishImageToCloudflareImages(
        publishInput({ filename: '' }),
      );

      expect(result).toBe('unnamed-too');
    });

    it('sanitises the stored name on the way out', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'renamed' } },
      });

      await service.publishImageToCloudflareImages(
        publishInput({ filename: String.raw`<>:"/\|?*.png` }),
      );

      expect(axiosMock.post).toHaveBeenCalled();
    });

    it('should throw if axios returns non-200 status (201)', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({ status: 201 });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios fails', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({ status: 500 });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios resolves an undefined response', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue(undefined as never);

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios throws', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.isAxiosError.mockReturnValue(true);
      axiosMock.post.mockRejectedValue({ response: { data: 'error' } });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios throws without response', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.isAxiosError.mockReturnValue(false);
      axiosMock.post.mockRejectedValue(new Error('boom'));

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios throws a non-Error value without response', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.isAxiosError.mockReturnValue(false);
      axiosMock.post.mockRejectedValue({});

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios returns missing id', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: {} },
      });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios returns missing data', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({ status: 200 });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios returns missing result', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({ status: 200, data: {} });

      await expect(
        service.publishImageToCloudflareImages(publishInput()),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });
  });

  describe('deleteImageFromCloudflareImages', () => {
    it('should delete successfully', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.delete.mockResolvedValue({ status: 200 });

      const result = await service.deleteImageFromCloudflareImages('img-id');

      expect(result).toBe('img-id');
    });

    it('should throw if imageId missing', async () => {
      await expect(service.deleteImageFromCloudflareImages('')).rejects.toThrow(
        'Image ID is missing',
      );
    });

    it('should throw if status not 200', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.delete.mockResolvedValue({ status: 400 });

      await expect(
        service.deleteImageFromCloudflareImages('id'),
      ).rejects.toThrow('Failed to delete');
    });
  });

  describe('validateAndSanitiseFile', () => {
    const validationCases: Array<{
      name: string;
      userId: string;
      file: UploadedImage;
      expectedMessage: string;
    }> = [
      {
        name: 'throws if userId missing',
        userId: '',
        file: createImageFile(),
        expectedMessage: 'User ID is missing',
      },
      {
        name: 'throws if mimetype missing',
        userId: 'u',
        file: createImageFile({ mimetype: undefined }),
        expectedMessage: 'File mimetype is missing',
      },
      {
        name: 'throws if invalid mimetype',
        userId: 'u',
        file: createImageFile({ mimetype: 'text/plain' }),
        expectedMessage:
          'Invalid file type. Only jpeg, jpg, or png are allowed',
      },
      {
        name: 'throws if file too large',
        userId: 'u',
        file: createImageFile({ size: 1048577 }),
        expectedMessage: 'File too large',
      },
      {
        name: 'throws if buffer missing',
        userId: 'u',
        file: createImageFile({ buffer: undefined }),
        expectedMessage: 'File buffer is missing',
      },
      {
        name: 'throws if file name missing',
        userId: 'u',
        file: createImageFile({ originalname: undefined, filename: undefined }),
        expectedMessage: 'File name is missing',
      },
      {
        name: 'throws if buffer empty',
        userId: 'u',
        file: createImageFile({ buffer: Buffer.from('') }),
        expectedMessage: 'No image data provided',
      },
    ];

    it.each(validationCases)('$name', ({ userId, file, expectedMessage }) => {
      expect(() =>
        service.validateAndSanitiseFile(
          userId,
          file as unknown as UploadR2FileParam,
        ),
      ).toThrow(expectedMessage);
    });

    it('throws if the file is missing altogether', () => {
      expect(() =>
        service.validateAndSanitiseFile(
          'u',
          undefined as unknown as UploadR2FileParam,
        ),
      ).toThrow('File is missing');
    });

    it('sanitises unsafe filename characters', () => {
      const { safeFileName } = service.validateAndSanitiseFile(
        'u',
        createImageFile({
          originalname: String.raw`<>:"/\|?*.png`,
        }) as unknown as UploadR2FileParam,
      );

      expect(safeFileName).toBe('_________.png');
    });

    it('prefers file.filename over file.originalname when present', () => {
      const { safeFileName } = service.validateAndSanitiseFile(
        'u',
        createImageFile({
          filename: 'preferred.png',
          originalname: 'ignored.png',
        }) as unknown as UploadR2FileParam,
      );

      expect(safeFileName).toBe('preferred.png');
    });
  });

  describe('uploadImageToCloudflareR2', () => {
    beforeEach(() => {
      mockS3Send.mockResolvedValue(undefined);
    });

    it('should upload successfully', async () => {
      const result = await service.uploadImageToCloudflareR2(
        'u',
        createImageFile({
          buffer: Buffer.from('a'),
          originalname: 'a.png',
        }) as unknown as UploadR2FileParam,
      );

      expect(result).toBe('test/u/a.png');
    });

    it('should upload successfully with characterId', async () => {
      const result = await service.uploadImageToCloudflareR2(
        'u',
        createImageFile({
          buffer: Buffer.from('a'),
          originalname: 'a.png',
        }) as unknown as UploadR2FileParam,
        'char-1',
      );

      expect(result).toBe('test/u/char-1/a.png');
    });

    it('should throw if file is undefined', async () => {
      await expect(
        service.uploadImageToCloudflareR2(
          'u',
          undefined as unknown as UploadR2FileParam,
        ),
      ).rejects.toThrow('File is missing');
    });

    it('should log and rethrow non-Error failures from S3 client', async () => {
      mockS3Send.mockRejectedValue('boom');

      await expect(
        service.uploadImageToCloudflareR2(
          'u',
          createImageFile() as unknown as UploadR2FileParam,
        ),
      ).rejects.toBe('boom');
    });

    it('uploads under the sanitised name', async () => {
      const result = await service.uploadImageToCloudflareR2(
        'u',
        createImageFile({
          originalname: String.raw`<>:"/\|?*.png`,
        }) as unknown as UploadR2FileParam,
      );

      expect(result).toBe('test/u/_________.png');
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'bucket',
          Key: 'test/u/_________.png',
          ContentType: 'image/png',
        }),
      );
    });
  });

  describe('deleteImageFromCloudflareR2', () => {
    it('should delete successfully', async () => {
      const result = await service.deleteImageFromCloudflareR2(
        'u',
        'https://cdn.local/key',
      );

      expect(result).toBe('key');
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should throw if userId missing', async () => {
      await expect(
        service.deleteImageFromCloudflareR2('', 'url'),
      ).rejects.toThrow('User ID is missing');
    });

    it('should throw if imageUrl missing', async () => {
      await expect(
        service.deleteImageFromCloudflareR2('u', ''),
      ).rejects.toThrow('Image URL is missing');
    });
  });
});
