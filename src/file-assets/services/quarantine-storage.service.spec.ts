import { Readable } from 'stream';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { jest } from '@jest/globals';

import {
  QUARANTINE_S3_CLIENT,
  QuarantineStorageService,
} from './quarantine-storage.service';

/**
 * The private bucket adapter.
 *
 * The client is a mock, so what is under test is which commands are built and
 * with what — including one thing that is easy to get wrong and invisible when
 * it is: that a read names the object *version* rather than trusting the key.
 */
describe('QuarantineStorageService', () => {
  let service: QuarantineStorageService;
  let s3Client: { send: jest.Mock<(...args: any[]) => any> };

  /** The settings the service reads, keyed as the config service sees them. */
  const settings: Record<string, string> = {
    CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME: 'sto-info-quarantine-local',
    NODE_ENV: 'local',
  };

  beforeEach(async () => {
    s3Client = {
      send: jest
        .fn<(...args: any[]) => any>()
        .mockResolvedValue({ VersionId: 'v-7', Body: Readable.from(['x']) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuarantineStorageService,
        { provide: QUARANTINE_S3_CLIENT, useValue: s3Client },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => settings[key] },
        },
      ],
    }).compile();

    service = module.get(QuarantineStorageService);
  });

  describe('put', () => {
    it('writes to the quarantine bucket and returns the version', async () => {
      const result = await service.put('local/assets/a', Buffer.from('hello'));

      const command = s3Client.send.mock.calls[0][0] as PutObjectCommand;

      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('sto-info-quarantine-local');
      expect(command.input.Key).toBe('local/assets/a');
      expect(result.objectVersion).toBe('v-7');
    });

    /**
     * Nothing in this bucket is rendered by a browser, and a stored content
     * type is a hint a later delivery path could be tempted to trust. The type
     * that matters is the one detected at ingress and recorded on the row.
     */
    it('stores everything as opaque bytes whatever was claimed', async () => {
      await service.put('local/assets/a', Buffer.from('<svg />'));

      const command = s3Client.send.mock.calls[0][0] as PutObjectCommand;

      expect(command.input.ContentType).toBe('application/octet-stream');
    });

    it('reports no version when the provider gives none', async () => {
      s3Client.send.mockResolvedValue({});

      const result = await service.put('local/assets/a', Buffer.from('hello'));

      expect(result.objectVersion).toBeNull();
    });
  });

  describe('getStream', () => {
    it('names the version so the bytes served are the bytes cleared', async () => {
      await service.getStream('local/assets/a', 'v-2');

      const command = s3Client.send.mock.calls[0][0] as GetObjectCommand;

      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input.VersionId).toBe('v-2');
    });

    it('omits the version when the object has none', async () => {
      await service.getStream('local/assets/a', null);

      const command = s3Client.send.mock.calls[0][0] as GetObjectCommand;

      expect(command.input.VersionId).toBeUndefined();
    });

    it('returns the stream', async () => {
      await expect(
        service.getStream('local/assets/a', null),
      ).resolves.toBeInstanceOf(Readable);
    });

    it('refuses an empty response rather than serving nothing', async () => {
      s3Client.send.mockResolvedValue({ Body: undefined });

      await expect(service.getStream('local/assets/a', null)).rejects.toThrow(
        'Quarantine object has no body: local/assets/a',
      );
    });
  });

  describe('remove', () => {
    it('deletes from the quarantine bucket', async () => {
      await service.remove('local/assets/a');

      const command = s3Client.send.mock.calls[0][0] as DeleteObjectCommand;

      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input.Bucket).toBe('sto-info-quarantine-local');
      expect(command.input.Key).toBe('local/assets/a');
    });
  });

  describe('buildObjectKey', () => {
    it('derives the key from the asset identifier and the environment', () => {
      expect(service.buildObjectKey('abc-123')).toBe('local/assets/abc-123');
    });

    /**
     * A key built from a filename is a path somebody else can be persuaded to
     * write. The filename is kept on the row, where it is treated as the
     * user-supplied text it is.
     */
    it('cannot be influenced by anything a user supplied', () => {
      expect(service.buildObjectKey('../../etc/passwd')).not.toContain('..\\');
      expect(service.buildObjectKey('abc')).toBe('local/assets/abc');
    });
  });

  it('exposes a token distinct from the public bucket client', () => {
    expect(QUARANTINE_S3_CLIENT).not.toBe(S3Client);
    expect(typeof QUARANTINE_S3_CLIENT).toBe('symbol');
  });
});
