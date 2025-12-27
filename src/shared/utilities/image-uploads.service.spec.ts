import { ImageUploadsService } from './image-uploads.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
}));

describe('ImageUploadsService', () => {
  it('should be defined', () => {
    const configMock = { get: jest.fn() } as any;
    const s3Mock = { send: jest.fn() } as any;
    const loggerMock = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    expect(
      new ImageUploadsService(s3Mock, configMock, loggerMock),
    ).toBeDefined();
  });
});
