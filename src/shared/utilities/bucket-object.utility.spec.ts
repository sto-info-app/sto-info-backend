import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  deleteBucketObject,
  streamBucketObject,
} from './bucket-object.utility';

describe('bucket-object.utility', () => {
  let send: jest.Mock<Promise<unknown>, [unknown]>;
  let client: S3Client;

  beforeEach(() => {
    send = jest.fn<Promise<unknown>, [unknown]>();
    client = { send } as unknown as S3Client;
  });

  describe('streamBucketObject', () => {
    it('reads the object by bucket and key, and never by version', async () => {
      const body = Readable.from(['bytes']);
      send.mockResolvedValue({ Body: body });

      await expect(
        streamBucketObject(
          client,
          'private-bucket',
          'dev/key.txt',
          'Transcript',
        ),
      ).resolves.toBe(body);

      const [command] = send.mock.calls[0] as [GetObjectCommand];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'private-bucket',
        Key: 'dev/key.txt',
      });
    });

    it('says what had no body when the provider returns none', async () => {
      send.mockResolvedValue({});

      await expect(
        streamBucketObject(
          client,
          'private-bucket',
          'dev/key.txt',
          'Transcript',
        ),
      ).rejects.toThrow('Transcript has no body: dev/key.txt');
    });
  });

  describe('deleteBucketObject', () => {
    it('deletes the object by bucket and key', async () => {
      send.mockResolvedValue({});

      await deleteBucketObject(client, 'private-bucket', 'dev/key.txt');

      const [command] = send.mock.calls[0] as [DeleteObjectCommand];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'private-bucket',
        Key: 'dev/key.txt',
      });
    });
  });
});
