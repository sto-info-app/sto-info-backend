import { InternalServerErrorException } from '@nestjs/common';

import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import {
  AssetPublisher,
  AssetPublisherRegistry,
} from './asset-publisher.registry';

/**
 * Builds a publisher for one kind of record.
 *
 * @param subject - The kind of record.
 * @returns The publisher.
 */
const publisherFor = (subject: FileAssetSubject): AssetPublisher => ({
  subject,
  attach: jest.fn(() => Promise.resolve(null)),
});

describe('AssetPublisherRegistry', () => {
  let registry: AssetPublisherRegistry;

  beforeEach(() => {
    registry = new AssetPublisherRegistry();
  });

  it('returns the publisher registered for a kind of record', () => {
    const publisher = publisherFor(FileAssetSubject.USER_PROFILE);

    registry.register(publisher);

    expect(registry.require(FileAssetSubject.USER_PROFILE)).toBe(publisher);
    expect(registry.has(FileAssetSubject.USER_PROFILE)).toBe(true);
  });

  it('reports a kind of record nothing publishes for', () => {
    expect(registry.has(FileAssetSubject.ARMADA)).toBe(false);
  });

  // A missing publisher is a wiring mistake, and the difference between
  // finding it in a failing upload and finding it in an asset stuck at
  // CLEAN an hour later is whether anybody can tell what went wrong.
  it('refuses to answer for a kind of record nothing publishes for', () => {
    expect(() => registry.require(FileAssetSubject.FLEET)).toThrow(
      InternalServerErrorException,
    );
    expect(() => registry.require(FileAssetSubject.FLEET)).toThrow(
      'No publisher is registered for FLEET',
    );
  });

  // Two publishers for one table is two answers to which column to write,
  // and the second registration is the one that would win silently.
  it('refuses a second publisher for the same kind of record', () => {
    registry.register(publisherFor(FileAssetSubject.STORYTIME_ARC));

    expect(() =>
      registry.register(publisherFor(FileAssetSubject.STORYTIME_ARC)),
    ).toThrow('Two publishers registered for STORYTIME_ARC');
  });
});
