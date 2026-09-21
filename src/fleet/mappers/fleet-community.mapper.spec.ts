import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetCommunityMapper } from './fleet-community.mapper';

describe('FleetCommunityMapper', () => {
  const mapper = new FleetCommunityMapper();

  const community = {
    id: '00000000-0000-4000-8000-000000000000',
    ownerUserId: '22222222-2222-4222-8222-222222222222',
    name: 'Jupiter Force',
    slug: 'jupiter-force',
    description: 'A PC Community.',
    recruitmentState: FleetRecruitmentState.APPLICATION,
    visibility: FleetAudience.PUBLIC,
    preferredTimezone: 'Europe/London',
    status: FleetScopeStatus.ACTIVE,
    closedAt: null,
    revision: 3,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-02T10:00:00.000Z'),
    deletedAt: null,
  } as FleetCommunityEntity;

  it('maps every field the API states', () => {
    expect(mapper.toDto(community)).toEqual({
      id: community.id,
      ownerUserId: community.ownerUserId,
      name: 'Jupiter Force',
      slug: 'jupiter-force',
      description: 'A PC Community.',
      recruitmentState: FleetRecruitmentState.APPLICATION,
      visibility: FleetAudience.PUBLIC,
      preferredTimezone: 'Europe/London',
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      revision: 3,
      createdAt: community.createdAt,
      updatedAt: community.updatedAt,
    });
  });

  /**
   * Fields are listed rather than spread, so a column added to the entity
   * later stays private until somebody decides otherwise. `deletedAt` is the
   * one already present that must not travel.
   */
  it('leaves the soft-delete marker behind', () => {
    expect(mapper.toDto(community)).not.toHaveProperty('deletedAt');
  });

  describe('toCardDto', () => {
    it('maps every field the directory card shows', () => {
      expect(mapper.toCardDto(community)).toEqual({
        id: community.id,
        slug: 'jupiter-force',
        status: FleetScopeStatus.ACTIVE,
        createdAt: community.createdAt,
        name: 'Jupiter Force',
        description: 'A PC Community.',
        recruitmentState: FleetRecruitmentState.APPLICATION,
      });
    });

    /**
     * A directory page is a list long enough that one identifier per row
     * turns a browse into a harvest. Somebody who opens the Community itself
     * is told who owns it; somebody scrolling past it is not.
     */
    it('names no owner, a list being a list', () => {
      expect(mapper.toCardDto(community)).not.toHaveProperty('ownerUserId');
    });
  });
});
