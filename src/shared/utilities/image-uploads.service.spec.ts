import { S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { SecretsService } from '../secrets/secrets.service';
import { ImageUploadsService } from './image-uploads.service';

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  PutObjectCommand: jest.fn().mockImplementation(args => args),
  DeleteObjectCommand: jest.fn().mockImplementation(args => args),
}));
jest.mock('axios');
const mockScanFile = jest.fn();
jest.mock('cloudmersive-virus-api-client', () => {
  const ApiClient = {
    instance: {
      authentications: {
        Apikey: { apiKey: '' },
      },
    },
  };
  return {
    ScanApi: jest.fn().mockImplementation(() => ({
      scanFile: mockScanFile,
    })),
    ApiClient,
  };
});

describe('ImageUploadsService', () => {
  let service: ImageUploadsService;
  let secretsService: SecretsService;

  type UploadR2FileParam = Parameters<
    ImageUploadsService['uploadImageToCloudflareR2']
  >[1];
  type UploadImagesFileParam = Parameters<
    ImageUploadsService['uploadImageToCloudflareImages']
  >[1];

  type SecretObject = {
    cloudflareR2AccessKey?: string;
    cloudflareR2Secret?: string;
    cloudmersiveApiKey?: string;
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
            cloudmersiveApiKey: 'cv-key',
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
            getSecret: jest.fn().mockResolvedValue(secret),
          } satisfies Pick<SecretsService, 'getSecret'>,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await createModule();
    service = module.get<ImageUploadsService>(ImageUploadsService);
    secretsService = module.get<SecretsService>(SecretsService);
    await service.onModuleInit();
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

    it('should throw if secret is missing cloudmersiveApiKey', async () => {
      const module = await createModule({ cloudmersiveApiKey: undefined });
      const localService = module.get<ImageUploadsService>(ImageUploadsService);
      await expect(localService.onModuleInit()).rejects.toThrow(
        new BadRequestException('Missing Cloudmersive API key'),
      );
    });

    it('should read secret name from env', async () => {
      const getSecretMock = jest.spyOn(secretsService, 'getSecret');
      await service.onModuleInit();
      expect(getSecretMock).toHaveBeenCalledWith('test-secret');
    });
  });

  describe('uploadImageToCloudflareImages', () => {
    let loggerErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerErrorSpy = jest
        .spyOn(Logger, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      loggerErrorSpy.mockRestore();
    });

    it('should upload successfully', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'cf-img-id' } },
      });

      const result = await service.uploadImageToCloudflareImages(
        'user-1',
        createImageFile() as unknown as UploadImagesFileParam,
      );
      expect(result).toBe('cf-img-id');
    });

    it('should treat missing FoundViruses as clean', async () => {
      mockScanFile.mockImplementation((_buf, cb) => cb(null, {}));

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'cf-img-id' } },
      });

      const result = await service.uploadImageToCloudflareImages(
        'user-1',
        createImageFile() as unknown as UploadImagesFileParam,
      );
      expect(result).toBe('cf-img-id');
    });

    it('should throw if virus found', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: ['EICAR'] }),
      );

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('File is infected');
    });

    it('should throw if scan fails', async () => {
      mockScanFile.mockImplementation((_buf, cb) => cb('Scan error', null));

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('Scan error');
    });

    it('should throw if axios fails', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 500,
      });

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios resolves an undefined response', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue(undefined as never);

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios throws', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockRejectedValue({
        response: { data: 'error' },
      });

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios throws without response', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockRejectedValue(new Error('boom'));

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if axios returns missing id', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: {} },
      });

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios returns missing data', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
      });

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should throw if axios returns missing result', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: {},
      });

      await expect(
        service.uploadImageToCloudflareImages(
          'user-1',
          createImageFile() as unknown as UploadImagesFileParam,
        ),
      ).rejects.toThrow('Failed to upload image to Cloudflare Images');
    });

    it('should upload with entityType parameter', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'custom-id' } },
      });

      const result = await service.uploadImageToCloudflareImages(
        'user-1',
        createImageFile() as unknown as UploadImagesFileParam,
        'character',
      );

      expect(result).toBe('custom-id');
      expect(axiosMock.post).toHaveBeenCalled();
      const callArgs = axiosMock.post.mock.calls[0];
      const formData = callArgs[1];
      expect(formData).toBeDefined();
    });

    it('should upload with entityType and entityId parameters', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'custom-id-with-entity' } },
      });

      const result = await service.uploadImageToCloudflareImages(
        'user-1',
        createImageFile() as unknown as UploadImagesFileParam,
        'character',
        'char-123',
      );

      expect(result).toBe('custom-id-with-entity');
      expect(axiosMock.post).toHaveBeenCalled();
    });

    it('should upload with only entityId parameter (entityType undefined)', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );

      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.post.mockResolvedValue({
        status: 200,
        data: { result: { id: 'id-without-type' } },
      });

      const result = await service.uploadImageToCloudflareImages(
        'user-1',
        createImageFile() as unknown as UploadImagesFileParam,
        undefined,
        'entity-456',
      );

      expect(result).toBe('id-without-type');
    });
  });

  describe('uploadImageToCloudflareR2', () => {
    it('should throw if file is undefined', async () => {
      await expect(
        service.uploadImageToCloudflareR2(
          'user-1',
          undefined as unknown as UploadR2FileParam,
        ),
      ).rejects.toThrow(TypeError);
    });

    it('should prefer file.filename over file.originalname when present', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      mockS3Send.mockResolvedValue(undefined);

      const fileKey = await service.uploadImageToCloudflareR2(
        'u',
        createImageFile({
          filename: 'preferred.png',
          originalname: 'ignored.png',
        }) as unknown as UploadR2FileParam,
      );

      expect(fileKey).toBe('test/u/preferred.png');
    });
  });

  describe('deleteImageFromCloudflareImages', () => {
    it('should delete successfully', async () => {
      const axiosMock = axios as jest.Mocked<typeof axios>;
      axiosMock.delete.mockResolvedValue({
        status: 200,
      });
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
      axiosMock.delete.mockResolvedValue({
        status: 400,
      });
      await expect(
        service.deleteImageFromCloudflareImages('id'),
      ).rejects.toThrow('Failed to delete');
    });
  });

  describe('file validation (via uploadImageToCloudflareR2)', () => {
    beforeEach(() => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      mockS3Send.mockResolvedValue(undefined);
    });

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

    it.each(validationCases)(
      '$name',
      async ({ userId, file, expectedMessage }) => {
        await expect(
          service.uploadImageToCloudflareR2(
            userId,
            file as unknown as UploadR2FileParam,
          ),
        ).rejects.toThrow(expectedMessage);
      },
    );

    it('sanitises unsafe filename characters and uploads using the safe name', async () => {
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

  describe('uploadImageToCloudflareR2', () => {
    it('should upload successfully', async () => {
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      mockS3Send.mockResolvedValue(undefined);

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
      mockScanFile.mockImplementation((_buf, cb) =>
        cb(null, { FoundViruses: [] }),
      );
      mockS3Send.mockResolvedValue(undefined);

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
