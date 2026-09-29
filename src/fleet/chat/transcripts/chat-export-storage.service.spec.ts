import { Readable } from 'stream';

import { ConfigService } from '@nestjs/config';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  CHAT_EXPORTS_S3_CLIENT,
  ChatExportStorageService,
} from './chat-export-storage.service';

/**
 * The private exports bucket (FC-035). The client is a mock, so what is under
 * test is which commands are built, and that nothing is left to be cached.
 */
describe('ChatExportStorageService', () => {
  let service: ChatExportStorageService;
  let s3Client: { send: jest.Mock<(...args: any[]) => any> };

  /** The settings the service reads. */
  const settings: Record<string, string> = {
    CLOUDFLARE_R2_EXPORTS_BUCKET_NAME: 'sto-info-exports-test',
    NODE_ENV: 'test',
  };

  beforeEach(() => {
    s3Client = {
      send: jest
        .fn<(...args: any[]) => any>()
        .mockResolvedValue({ Body: Readable.from(['x']) }),
    };
    service = new ChatExportStorageService(
      s3Client as unknown as S3Client,
      { get: (key: string) => settings[key] } as ConfigService,
    );
  });

  it('writes a transcript as uncached UTF-8 text, and counts its bytes', async () => {
    await expect(service.put('test/key.txt', 'Café')).resolves.toBe(5);

    const command = s3Client.send.mock.calls[0][0] as PutObjectCommand;

    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual(
      expect.objectContaining({
        Bucket: 'sto-info-exports-test',
        Key: 'test/key.txt',
        ContentType: 'text/plain; charset=utf-8',
        CacheControl: 'no-store',
      }),
    );
  });

  it('reads a transcript', async () => {
    await expect(service.getStream('test/key.txt')).resolves.toBeInstanceOf(
      Readable,
    );

    const command = s3Client.send.mock.calls[0][0] as GetObjectCommand;

    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Bucket).toBe('sto-info-exports-test');
  });

  it('refuses an empty response rather than serving nothing', async () => {
    s3Client.send.mockResolvedValue({});

    await expect(service.getStream('test/key.txt')).rejects.toThrow(
      'Transcript has no body: test/key.txt',
    );
  });

  it('deletes a transcript', async () => {
    await service.remove('test/key.txt');

    const command = s3Client.send.mock.calls[0][0] as DeleteObjectCommand;

    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input.Key).toBe('test/key.txt');
  });

  it('keys a transcript by environment and ID alone', () => {
    expect(service.buildObjectKey('abc')).toBe('test/chat-transcripts/abc.txt');
  });

  it('has a token of its own', () => {
    expect(typeof CHAT_EXPORTS_S3_CLIENT).toBe('symbol');
  });
});
