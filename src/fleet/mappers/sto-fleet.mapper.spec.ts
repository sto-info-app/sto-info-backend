import { Test, TestingModule } from '@nestjs/testing';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { StoFleetMapper } from './sto-fleet.mapper';

describe('StoFleetMapper', () => {
  let mapper: StoFleetMapper;

  const createdAt = new Date('2026-02-01T10:00:00.000Z');
  const updatedAt = new Date('2026-02-02T10:00:00.000Z');
  const importedAt = new Date('2026-02-03T10:00:00.000Z');

  const buildFleet = (
    overrides: Partial<StoFleetEntity> = {},
  ): StoFleetEntity =>
    ({
      id: 'd0000000-0000-4000-8000-000000000001',
      communityId: 'd0000000-0000-4000-8000-000000000002',
      platformId: 'd0000000-0000-4000-8000-000000000003',
      platform: {
        id: 'd0000000-0000-4000-8000-000000000003',
        name: 'Windows',
        providesRosterExport: true,
      },
      allegianceFactionId: 'd0000000-0000-4000-8000-000000000004',
      exactGameName: ' Omega Command',
      exactGameNameNormalized: ' omega command',
      slug: 'omega-command',
      recruitmentState: FleetRecruitmentState.OPEN,
      visibility: FleetAudience.PUBLIC,
      lastEffectiveImportAt: importedAt,
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      bannerImageId: 'banner-ref',
      bannerImageAlt: 'A fleet yard at dusk',
      emblemImageId: 'emblem-ref',
      emblemImageAlt: 'A crossed-sabres badge',
      revision: 3,
      createdAt,
      updatedAt,
      deletedAt: null,
      ...overrides,
    }) as StoFleetEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StoFleetMapper],
    }).compile();

    mapper = module.get<StoFleetMapper>(StoFleetMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  describe('toDto', () => {
    it('maps every field a caller is given', () => {
      expect(mapper.toDto(buildFleet())).toEqual({
        id: 'd0000000-0000-4000-8000-000000000001',
        communityId: 'd0000000-0000-4000-8000-000000000002',
        platformId: 'd0000000-0000-4000-8000-000000000003',
        platformName: 'Windows',
        platformSegment: 'windows',
        platformProvidesRosterExport: true,
        exactGameName: ' Omega Command',
        allegianceFactionId: 'd0000000-0000-4000-8000-000000000004',
        slug: 'omega-command',
        recruitmentState: FleetRecruitmentState.OPEN,
        visibility: FleetAudience.PUBLIC,
        lastEffectiveImportAt: importedAt,
        status: FleetScopeStatus.ACTIVE,
        closedAt: null,
        bannerImageId: 'banner-ref',
        bannerImageAlt: 'A fleet yard at dusk',
        emblemImageId: 'emblem-ref',
        emblemImageAlt: 'A crossed-sabres badge',
        revision: 3,
        createdAt,
        updatedAt,
      });
    });

    /*
     * A Fleet on a console can never have a roster, because the game gives
     * nobody there a file to import. Carried on the Fleet so the page saying
     * so does not have to fetch the catalogue and match a platform by name.
     */
    it('says when the Fleet is on a platform with no export facility', () => {
      const fleet = buildFleet();

      fleet.platform = {
        ...fleet.platform,
        name: 'Xbox',
        providesRosterExport: false,
      };

      expect(mapper.toDto(fleet).platformProvidesRosterExport).toBe(false);
    });

    /**
     * The URL segment is derived rather than stored — ADR-0022 decision 3 —
     * so a renamed platform cannot leave a stale segment behind in a column
     * that disagrees with the catalogue.
     */
    it('derives the platform segment from the catalogue name', () => {
      const fleet = buildFleet();
      fleet.platform = {
        ...fleet.platform,
        name: 'Nintendo Switch',
      } as StoFleetEntity['platform'];

      expect(mapper.toDto(fleet).platformSegment).toBe('nintendo-switch');
    });

    /**
     * ADR-0003's display obligation. Where two Fleets differ only by an edge
     * space, that space is the only thing telling them apart, so it has to
     * survive every hop out to a client.
     */
    it('carries an edge space out to the caller untouched', () => {
      expect(mapper.toDto(buildFleet()).exactGameName).toBe(' Omega Command');
    });

    it('keeps the duplicate-detection column and the deletion stamp private', () => {
      const dto = mapper.toDto(buildFleet());

      expect(dto).not.toHaveProperty('exactGameNameNormalized');
      expect(dto).not.toHaveProperty('deletedAt');
    });
  });

  describe('toDuplicateDto', () => {
    it('says whose the record is and how current it is', () => {
      const fleet = buildFleet();
      fleet.community = {
        id: 'd0000000-0000-4000-8000-000000000002',
        name: 'Jupiter Force',
        slug: 'jupiter-force',
      } as FleetCommunityEntity;

      expect(mapper.toDuplicateDto(fleet)).toEqual({
        id: 'd0000000-0000-4000-8000-000000000001',
        exactGameName: ' Omega Command',
        communityId: 'd0000000-0000-4000-8000-000000000002',
        communityName: 'Jupiter Force',
        communitySlug: 'jupiter-force',
        platformId: 'd0000000-0000-4000-8000-000000000003',
        platformName: 'Windows',
        lastEffectiveImportAt: importedAt,
        status: FleetScopeStatus.ACTIVE,
      });
    });

    /**
     * An unregistered record has no Community, which is a fact about it
     * rather than a gap: it is an observation target somebody confirmed, and
     * saying so is exactly what tells it apart from a Community's own record.
     */
    it('reports an unregistered record as belonging to nobody', () => {
      const fleet = buildFleet({ communityId: null, community: null });

      const duplicate = mapper.toDuplicateDto(fleet);

      expect(duplicate.communityId).toBeNull();
      expect(duplicate.communityName).toBeNull();
      expect(duplicate.communitySlug).toBeNull();
    });

    /**
     * A duplicate summary describes somebody else's record. Its recruitment
     * posture, its audience and its allegiance are none of the registrant's
     * business, and none of them helps tell two records apart.
     */
    it('tells the registrant nothing else about somebody else’s record', () => {
      const fleet = buildFleet();
      fleet.community = {
        name: 'Jupiter Force',
        slug: 'jupiter-force',
      } as FleetCommunityEntity;

      const duplicate = mapper.toDuplicateDto(fleet);

      expect(duplicate).not.toHaveProperty('visibility');
      expect(duplicate).not.toHaveProperty('recruitmentState');
      expect(duplicate).not.toHaveProperty('allegianceFactionId');
    });
  });

  describe('toCardDto', () => {
    it('maps every field the directory card shows', () => {
      const fleet = buildFleet();
      fleet.community = {
        id: 'd0000000-0000-4000-8000-000000000002',
        name: 'Jupiter Force',
        slug: 'jupiter-force',
      } as FleetCommunityEntity;

      expect(mapper.toCardDto({ record: fleet, duplicateCount: 2 })).toEqual({
        id: 'd0000000-0000-4000-8000-000000000001',
        slug: 'omega-command',
        status: FleetScopeStatus.ACTIVE,
        createdAt,
        emblemImageId: 'emblem-ref',
        emblemImageAlt: 'A crossed-sabres badge',
        exactGameName: ' Omega Command',
        communityId: 'd0000000-0000-4000-8000-000000000002',
        communityName: 'Jupiter Force',
        communitySlug: 'jupiter-force',
        platformId: 'd0000000-0000-4000-8000-000000000003',
        platformName: 'Windows',
        platformSegment: 'windows',
        duplicateCount: 2,
        recruitmentState: FleetRecruitmentState.OPEN,
        allegianceFactionId: 'd0000000-0000-4000-8000-000000000004',
        lastEffectiveImportAt: importedAt,
      });
    });

    /**
     * ADR-0003's display obligation reaches the directory too. Where an edge
     * space is the only difference between two names, it is the only thing
     * telling two Fleets apart, so a card that trimmed it would be showing
     * two records that look identical and are not.
     */
    it('keeps the leading space the game gave the name', () => {
      const card = mapper.toCardDto({
        record: buildFleet(),
        duplicateCount: 0,
      });

      expect(card.exactGameName).toBe(' Omega Command');
    });

    it('says nobody holds an unregistered Fleet, rather than nothing', () => {
      const card = mapper.toCardDto({
        record: buildFleet({ communityId: null, community: null }),
        duplicateCount: 0,
      });

      expect(card.communityId).toBeNull();
      expect(card.communityName).toBeNull();
      expect(card.communitySlug).toBeNull();
    });

    /**
     * A card is a row in a list, and a list is long. The audience and the
     * revision are machinery the browse surface has no use for, and leaving
     * them off is what keeps the shape a card rather than a record.
     */
    it('carries nothing the browse surface has no use for', () => {
      const card = mapper.toCardDto({
        record: buildFleet(),
        duplicateCount: 0,
      });

      expect(card).not.toHaveProperty('visibility');
      expect(card).not.toHaveProperty('revision');
      expect(card).not.toHaveProperty('updatedAt');
      expect(card).not.toHaveProperty('deletedAt');
    });

    /**
     * The emblem and no banner. A card is a row in a list and the emblem is
     * what a list draws; a banner is five times as wide as it is tall and
     * belongs across the top of the scope's own page. Somebody who opens
     * the scope is served both.
     */
    it('carries the emblem and leaves the banner off', () => {
      const card = mapper.toCardDto({
        record: buildFleet(),
        duplicateCount: 0,
      });

      expect(card.emblemImageId).toBe('emblem-ref');
      expect(card.emblemImageAlt).toBe('A crossed-sabres badge');
      expect(card).not.toHaveProperty('bannerImageId');
      expect(card).not.toHaveProperty('bannerImageAlt');
    });
  });
});
