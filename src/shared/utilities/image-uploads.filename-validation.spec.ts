import type { File as MulterFile } from 'multer';

describe('ImageUploadsService SAFE_FILENAME_PATTERN branch', () => {
  it('should throw when sanitised filename fails SAFE_FILENAME_PATTERN', async () => {
    jest.resetModules();

    const mockS3Send = jest.fn();
    const mockScanFile = jest.fn();

    jest.doMock('../constants/regex-patterns.constants', () => {
      const actual: typeof import('../constants/regex-patterns.constants') =
        jest.requireActual('../constants/regex-patterns.constants');

      return {
        ...actual,
        // Make the validation intentionally stricter so we can exercise the
        // "Invalid characters in file name" branch.
        SAFE_FILENAME_PATTERN: /^a$/,
      };
    });

    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({
        send: mockS3Send,
      })),
      PutObjectCommand: jest.fn().mockImplementation((args: unknown) => args),
      DeleteObjectCommand: jest
        .fn()
        .mockImplementation((args: unknown) => args),
    }));

    jest.doMock('axios', () => ({}));

    jest.doMock('cloudmersive-virus-api-client', () => {
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

    const { Test } = await import('@nestjs/testing');
    const { ConfigService } = await import('@nestjs/config');
    const { SecretsService } = await import('../secrets/secrets.service');
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { ImageUploadsService } = await import('./image-uploads.service');

    process.env.AWS_SECRET_NAME = 'test-secret';
    process.env.MAX_IMAGE_SIZE_IN_BYTES = '1048576';
    process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.local';

    mockScanFile.mockImplementation(
      (
        _buf: unknown,
        cb: (err: unknown, data: { FoundViruses: string[] }) => void,
      ) => cb(null, { FoundViruses: [] }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImageUploadsService,
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest.fn().mockResolvedValue({
              cloudflareR2AccessKey: 'key',
              cloudflareR2Secret: 'secret',
              cloudmersiveApiKey: 'cv-key',
              cloudflareImagesAccountId: 'acc-id',
              cloudflareImagesApiKey: 'cf-key',
            }),
          } satisfies { getSecret: (name: string) => Promise<unknown> },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'CLOUDFLARE_R2_BUCKET_NAME') return 'bucket';
              if (key === 'NODE_ENV') return 'test';
              return null;
            }),
          } satisfies { get: (key: string) => string | null },
        },
        {
          provide: S3Client,
          useValue: {
            send: mockS3Send,
          } satisfies { send: (...args: unknown[]) => unknown },
        },
      ],
    }).compile();

    const service = moduleRef.get(ImageUploadsService);
    await service.onModuleInit();

    const file: MulterFile = {
      buffer: Buffer.from('fake image'),
      mimetype: 'image/png',
      size: 100,
      originalname: 'test.png',
    } as unknown as MulterFile;

    const uploadPromise = service.uploadImageToCloudflareR2('user-1', file);

    const error = await uploadPromise.catch(err => err);

    const httpError = error as unknown as {
      name?: string;
      getResponse: () => unknown;
    };

    expect(httpError.name).toBe('BadRequestException');
    expect(httpError.getResponse()).toEqual(
      expect.objectContaining({ message: 'Invalid characters in file name' }),
    );
  });
});
