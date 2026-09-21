import { Test, TestingModule } from '@nestjs/testing';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { StoArmadaMapper } from './sto-armada.mapper';

describe('StoArmadaMapper', () => {
  let mapper: StoArmadaMapper;

  const createdAt = new Date('2026-03-01T10:00:00.000Z');
  const updatedAt = new Date('2026-03-02T10:00:00.000Z');

  const buildArmada = (
    overrides: Partial<StoArmadaEntity> = {},
  ): StoArmadaEntity =>
    ({
      id: 'a0000000-0000-4000-8000-000000000001',
      communityId: 'a0000000-0000-4000-8000-000000000002',
      platformId: 'a0000000-0000-4000-8000-000000000003',
      platform: {
        id: 'a0000000-0000-4000-8000-000000000003',
        name: 'PlayStation',
      },
      community: {
        id: 'a0000000-0000-4000-8000-000000000002',
        name: 'Jupiter Force',
        slug: 'jupiter-force',
      } as FleetCommunityEntity,
      exactGameName: 'Sol Armada ',
      exactGameNameNormalized: 'sol armada ',
      displayName: 'The Sol Lot',
      slug: 'sol-armada',
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      revision: 2,
      createdAt,
      updatedAt,
      deletedAt: null,
      ...overrides,
    }) as StoArmadaEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StoArmadaMapper],
    }).compile();

    mapper = module.get<StoArmadaMapper>(StoArmadaMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  describe('toDto', () => {
    it('maps every field a caller is given', () => {
      expect(mapper.toDto(buildArmada())).toEqual({
        id: 'a0000000-0000-4000-8000-000000000001',
        communityId: 'a0000000-0000-4000-8000-000000000002',
        platformId: 'a0000000-0000-4000-8000-000000000003',
        platformName: 'PlayStation',
        platformSegment: 'playstation',
        exactGameName: 'Sol Armada ',
        displayName: 'The Sol Lot',
        slug: 'sol-armada',
        status: FleetScopeStatus.ACTIVE,
        closedAt: null,
        revision: 2,
        createdAt,
        updatedAt,
      });
    });

    /**
     * An Armada has no audience column, so there is nothing here for a
     * client to read one off. Emitting a field that does not exist would
     * invite a UI to make a visibility decision from it.
     */
    it('offers no audience, because an Armada has none of its own', () => {
      expect(mapper.toDto(buildArmada())).not.toHaveProperty('visibility');
    });

    it('keeps the duplicate-detection column and the deletion stamp private', () => {
      const dto = mapper.toDto(buildArmada());

      expect(dto).not.toHaveProperty('exactGameNameNormalized');
      expect(dto).not.toHaveProperty('deletedAt');
    });
  });

  describe('toDuplicateDto', () => {
    it('says whose the record is', () => {
      expect(mapper.toDuplicateDto(buildArmada())).toEqual({
        id: 'a0000000-0000-4000-8000-000000000001',
        exactGameName: 'Sol Armada ',
        communityId: 'a0000000-0000-4000-8000-000000000002',
        communityName: 'Jupiter Force',
        communitySlug: 'jupiter-force',
        platformId: 'a0000000-0000-4000-8000-000000000003',
        platformName: 'PlayStation',
        status: FleetScopeStatus.ACTIVE,
      });
    });

    /**
     * Nothing observes an Armada — STO roster exports carry no Armada
     * information at all — so unlike a Fleet there is no freshness to
     * report, and inventing one would be a claim with nothing behind it.
     */
    it('claims no freshness, because nothing observes an Armada', () => {
      expect(mapper.toDuplicateDto(buildArmada())).not.toHaveProperty(
        'lastEffectiveImportAt',
      );
    });
  });

  describe('toCardDto', () => {
    it('maps every field the directory card shows', () => {
      expect(
        mapper.toCardDto({ record: buildArmada(), duplicateCount: 1 }),
      ).toEqual({
        id: 'a0000000-0000-4000-8000-000000000001',
        slug: 'sol-armada',
        status: FleetScopeStatus.ACTIVE,
        createdAt,
        exactGameName: 'Sol Armada ',
        communityId: 'a0000000-0000-4000-8000-000000000002',
        communityName: 'Jupiter Force',
        communitySlug: 'jupiter-force',
        platformId: 'a0000000-0000-4000-8000-000000000003',
        platformName: 'PlayStation',
        platformSegment: 'playstation',
        duplicateCount: 1,
        displayName: 'The Sol Lot',
      });
    });

    it('keeps the trailing space the game gave the name', () => {
      const card = mapper.toCardDto({
        record: buildArmada(),
        duplicateCount: 0,
      });

      expect(card.exactGameName).toBe('Sol Armada ');
    });

    /**
     * Nothing observes an Armada, so there is no roster import to report and
     * no freshness on the card. A field that was always null would read as
     * "never imported" rather than "not a thing that is imported".
     */
    it('claims no freshness, nothing ever observing an Armada', () => {
      const card = mapper.toCardDto({
        record: buildArmada(),
        duplicateCount: 0,
      });

      expect(card).not.toHaveProperty('lastEffectiveImportAt');
      expect(card).not.toHaveProperty('recruitmentState');
      expect(card).not.toHaveProperty('revision');
    });
  });
});
