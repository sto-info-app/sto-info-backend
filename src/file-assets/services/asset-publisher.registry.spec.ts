import { InternalServerErrorException } from '@nestjs/common';

import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import {
  AssetPublisher,
  AssetPublisherRegistry,
  RestrictedAssetPublisher,
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

/**
 * Builds a restricted publisher for one kind of record.
 *
 * @param subject - The kind of record.
 * @returns The publisher.
 */
const restrictedPublisherFor = (
  subject: FileAssetSubject,
): RestrictedAssetPublisher => ({
  subject,
  receive: jest.fn(() => Promise.resolve({ outcome: 'ACCEPTED' as const })),
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

  describe('restricted publishers', () => {
    it('returns the restricted publisher registered for a kind of record', () => {
      const publisher = restrictedPublisherFor(FileAssetSubject.ROSTER_IMPORT);

      registry.registerRestricted(publisher);

      expect(registry.requireRestricted(FileAssetSubject.ROSTER_IMPORT)).toBe(
        publisher,
      );
      expect(registry.has(FileAssetSubject.ROSTER_IMPORT)).toBe(true);
    });

    // Which kind applies is the asset's audience. A subject answering to both
    // would let the audience decide which table got written.
    it('does not answer for a restricted record as though it were a picture', () => {
      registry.registerRestricted(
        restrictedPublisherFor(FileAssetSubject.ROSTER_IMPORT),
      );

      expect(() => registry.require(FileAssetSubject.ROSTER_IMPORT)).toThrow(
        'No publisher is registered for ROSTER_IMPORT',
      );
    });

    it('refuses to answer for a restricted record nothing publishes for', () => {
      registry.register(publisherFor(FileAssetSubject.FLEET));

      expect(() => registry.requireRestricted(FileAssetSubject.FLEET)).toThrow(
        'No restricted publisher is registered for FLEET',
      );
    });

    it.each([
      [
        'a picture publisher already holds it',
        (target: AssetPublisherRegistry) =>
          target.register(publisherFor(FileAssetSubject.ROSTER_IMPORT)),
      ],
      [
        'a restricted publisher already holds it',
        (target: AssetPublisherRegistry) =>
          target.registerRestricted(
            restrictedPublisherFor(FileAssetSubject.ROSTER_IMPORT),
          ),
      ],
    ])('refuses a restricted publisher when %s', (_case, first) => {
      first(registry);

      expect(() =>
        registry.registerRestricted(
          restrictedPublisherFor(FileAssetSubject.ROSTER_IMPORT),
        ),
      ).toThrow('Two publishers registered for ROSTER_IMPORT');
    });

    it('refuses a picture publisher for a subject a restricted one holds', () => {
      registry.registerRestricted(
        restrictedPublisherFor(FileAssetSubject.ROSTER_IMPORT),
      );

      expect(() =>
        registry.register(publisherFor(FileAssetSubject.ROSTER_IMPORT)),
      ).toThrow('Two publishers registered for ROSTER_IMPORT');
    });
  });
});
