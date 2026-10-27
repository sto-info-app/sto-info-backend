import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Opens a stream of an object's bytes in a private bucket, by its key alone.
 *
 * Never by version: R2 implements no object versioning, and refuses a
 * `GetObject` that names one, even the id its own `PutObject` returned. What
 * binds the bytes to their record is the key never being reused.
 *
 * @param client - The bucket's own client.
 * @param bucket - The bucket.
 * @param objectKey - The key to read.
 * @param what - What the object is, for the error: "Transcript".
 * @returns The object's bytes.
 * @throws Error when the provider returns no body.
 */
export async function streamBucketObject(
  client: S3Client,
  bucket: string,
  objectKey: string,
  what: string,
): Promise<Readable> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );

  if (!response.Body) {
    throw new Error(`${what} has no body: ${objectKey}`);
  }

  return response.Body as Readable;
}

/**
 * Deletes an object from a private bucket.
 *
 * @param client - The bucket's own client.
 * @param bucket - The bucket.
 * @param objectKey - The key to remove.
 */
export async function deleteBucketObject(
  client: S3Client,
  bucket: string,
  objectKey: string,
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
}
