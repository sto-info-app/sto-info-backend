import { randomUUID } from 'node:crypto';

import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import { describe, expect, it } from '@jest/globals';

import { seededTags } from '../testing/seeded-tag-ids';
import { MAX_TAGS_PER_TARGET, SetTagsDto } from './create-tag.dto';

/** The options `main.ts` gives the global pipe. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  validationError: { target: false },
});

const BODY: ArgumentMetadata = { type: 'body', metatype: SetTagsDto };

/** Each seeded tag's id once `RekeySeededStorytimeTags` has run. */
const LIVE_SEEDED_IDS = seededTags().map(tag => tag.liveId);

/**
 * Runs a body through the global pipe and returns the messages it refused
 * with, or none.
 *
 * @param body - The request body.
 * @returns The validation messages.
 */
async function messagesFor(body: unknown): Promise<string[]> {
  try {
    await pipe.transform(body, BODY);

    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);

    return (error as BadRequestException).getResponse() as unknown as string[];
  }
}

/**
 * The body every "set the tags" route takes, through the same pipe as a real
 * request. The controller spec calls the methods directly and never runs it,
 * which is how seeded tags that no request could save went unnoticed
 * (sc-1517).
 */
describe('SetTagsDto', () => {
  it('accepts every seeded tag', async () => {
    expect(LIVE_SEEDED_IDS.length).toBeGreaterThan(0);

    for (
      let start = 0;
      start < LIVE_SEEDED_IDS.length;
      start += MAX_TAGS_PER_TARGET
    ) {
      const tagIds = LIVE_SEEDED_IDS.slice(start, start + MAX_TAGS_PER_TARGET);

      await expect(messagesFor({ tagIds })).resolves.toEqual([]);
    }
  });

  it('accepts a tag an administrator added', async () => {
    await expect(messagesFor({ tagIds: [randomUUID()] })).resolves.toEqual([]);
  });

  it('accepts an empty set, which clears the tags', async () => {
    await expect(messagesFor({ tagIds: [] })).resolves.toEqual([]);
  });

  it('refuses an id that is not a version 4 UUID', async () => {
    const response = await messagesFor({
      tagIds: ['2a9c4309-6802-e355-26e7-27fbb623babc'],
    });

    expect(JSON.stringify(response)).toContain(
      'each value in tagIds must be a UUID',
    );
  });

  it('refuses a tag name in place of an id', async () => {
    const response = await messagesFor({ tagIds: ['federation'] });

    expect(JSON.stringify(response)).toContain(
      'each value in tagIds must be a UUID',
    );
  });
});
