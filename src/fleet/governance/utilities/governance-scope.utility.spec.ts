import { BadRequestException } from '@nestjs/common';

import { IsNull } from 'typeorm';

import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import {
  armadaScope,
  atExactly,
  communityScope,
  delegableAt,
  fleetScope,
  optionalReason,
  requireDelegable,
  requireReason,
  ScopedRow,
  scopeIdOf,
  toScopeRef,
} from './governance-scope.utility';

const COMMUNITY_ID = '20000000-0000-4000-8000-000000000001';
const FLEET_ID = '20000000-0000-4000-8000-000000000002';
const ARMADA_ID = '20000000-0000-4000-8000-000000000003';

describe('governance scope utilities', () => {
  it('names a Community, a Fleet and an Armada', () => {
    expect(communityScope(COMMUNITY_ID)).toEqual({
      kind: FleetScopeKind.COMMUNITY,
      communityId: COMMUNITY_ID,
      fleetId: null,
      armadaId: null,
    });
    expect(fleetScope(COMMUNITY_ID, FLEET_ID)).toEqual({
      kind: FleetScopeKind.FLEET,
      communityId: COMMUNITY_ID,
      fleetId: FLEET_ID,
      armadaId: null,
    });
    expect(armadaScope(COMMUNITY_ID, ARMADA_ID)).toEqual({
      kind: FleetScopeKind.ARMADA,
      communityId: COMMUNITY_ID,
      fleetId: null,
      armadaId: ARMADA_ID,
    });
  });

  it('reads each scope’s own ID', () => {
    expect(scopeIdOf(communityScope(COMMUNITY_ID))).toBe(COMMUNITY_ID);
    expect(scopeIdOf(fleetScope(COMMUNITY_ID, FLEET_ID))).toBe(FLEET_ID);
    expect(scopeIdOf(armadaScope(COMMUNITY_ID, ARMADA_ID))).toBe(ARMADA_ID);
  });

  // A Fleet is pinned to the Community in the path, so a Fleet another
  // Community holds does not resolve.
  it('pins a Fleet to its Community for the policy', () => {
    expect(toScopeRef(communityScope(COMMUNITY_ID))).toEqual({
      kind: FleetScopeKind.COMMUNITY,
      id: COMMUNITY_ID,
    });
    expect(toScopeRef(fleetScope(COMMUNITY_ID, FLEET_ID))).toEqual({
      kind: FleetScopeKind.FLEET,
      id: FLEET_ID,
      withinCommunityId: COMMUNITY_ID,
    });
    expect(toScopeRef(armadaScope(COMMUNITY_ID, ARMADA_ID))).toEqual({
      kind: FleetScopeKind.ARMADA,
      id: ARMADA_ID,
      withinCommunityId: COMMUNITY_ID,
    });
  });

  // A Community's own rows only: its Fleets' rows are theirs.
  it('matches rows held at exactly the scope', () => {
    expect(atExactly<ScopedRow>(communityScope(COMMUNITY_ID))).toEqual({
      communityId: COMMUNITY_ID,
      fleetId: IsNull(),
      armadaId: IsNull(),
    });
    expect(atExactly<ScopedRow>(fleetScope(COMMUNITY_ID, FLEET_ID))).toEqual({
      communityId: COMMUNITY_ID,
      fleetId: FLEET_ID,
      armadaId: IsNull(),
    });
    expect(atExactly<ScopedRow>(armadaScope(COMMUNITY_ID, ARMADA_ID))).toEqual({
      communityId: COMMUNITY_ID,
      fleetId: IsNull(),
      armadaId: ARMADA_ID,
    });
  });

  describe('the capability ceiling', () => {
    it('offers only delegable capabilities that mean something here', () => {
      const atFleet = delegableAt(FleetScopeKind.FLEET).map(
        definition => definition.code,
      );
      const atCommunity = delegableAt(FleetScopeKind.COMMUNITY).map(
        definition => definition.code,
      );

      expect(atFleet).toContain(FLEET_CAPABILITIES.NEWS_WRITE);
      expect(atFleet).not.toContain(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER);
      expect(atCommunity).toContain(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER);
      expect(
        delegableAt(FleetScopeKind.ARMADA).map(definition => definition.code),
      ).toContain(FLEET_CAPABILITIES.ARMADA_MANAGE);
      expect(atFleet).toContain(FLEET_CAPABILITIES.ARMADA_REQUEST);

      for (const ownerOnly of [
        FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
        FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
        FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
        FLEET_CAPABILITIES.SCOPE_CLOSE,
      ]) {
        expect(atFleet).not.toContain(ownerOnly);
        expect(atCommunity).not.toContain(ownerOnly);
      }
    });

    it('accepts a delegable capability', () => {
      expect(requireDelegable(FleetScopeKind.FLEET, 'news.write')).toBe(
        FLEET_CAPABILITIES.NEWS_WRITE,
      );
    });

    // Site ADMIN is not in this vocabulary at all, so it cannot be named.
    it.each([
      ['a site role', FleetScopeKind.FLEET, 'ADMIN'],
      ['a site permission', FleetScopeKind.FLEET, 'user.role.update'],
      ['an Owner power', FleetScopeKind.FLEET, 'scope.ownership.transfer'],
      ['role management', FleetScopeKind.COMMUNITY, 'scope.roles.manage'],
      [
        'a Community power at a Fleet',
        FleetScopeKind.FLEET,
        'scope.children.register',
      ],
    ])('refuses %s', (_label, kind, code) => {
      expect(() =>
        requireDelegable(kind as FleetScopeKind.FLEET, code),
      ).toThrow(new BadRequestException(`"${code}" cannot be delegated here.`));
    });
  });

  describe('reasons', () => {
    it('requires one that is not blank, and trims it', () => {
      expect(requireReason('  Inactive  ', 'Say why.')).toBe('Inactive');
      expect(() => requireReason('   ', 'Say why.')).toThrow(
        new BadRequestException('Say why.'),
      );
      expect(() => requireReason(undefined, 'Say why.')).toThrow(
        BadRequestException,
      );
    });

    it('keeps an optional one only when it says something', () => {
      expect(optionalReason(' Trusted ')).toBe('Trusted');
      expect(optionalReason('  ')).toBeNull();
      expect(optionalReason(undefined)).toBeNull();
    });
  });
});
