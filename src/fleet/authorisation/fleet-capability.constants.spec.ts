import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import {
  ALL_FLEET_CAPABILITIES,
  DELEGABLE_FLEET_CAPABILITIES,
  FLEET_CAPABILITIES,
  FLEET_CAPABILITY_BY_CODE,
  FLEET_CAPABILITY_DEFINITIONS,
  MUTATING_FLEET_CAPABILITIES,
} from './fleet-capability.constants';
import {
  APPROVED_MEMBERSHIP_CAPABILITIES,
  ROLE_BASELINE_CAPABILITIES,
} from './fleet-role-capabilities.constants';

/**
 * Holds the capability vocabulary and the role baselines to plan section 4.3.
 *
 * The baselines are the part of this feature most likely to be widened by
 * accident, because widening one is a single line and reads like a
 * convenience. These tests are the plan text, written as assertions, so a
 * change to who may do what has to be a change to a test as well.
 */
describe('Fleet capability vocabulary', () => {
  it('lists every declared code exactly once', () => {
    const declared = Object.values(FLEET_CAPABILITIES);

    expect([...ALL_FLEET_CAPABILITIES].sort()).toEqual([...declared].sort());
    expect(new Set(ALL_FLEET_CAPABILITIES).size).toBe(
      ALL_FLEET_CAPABILITIES.length,
    );
  });

  it('defines every code and nothing that is not a code', () => {
    expect(FLEET_CAPABILITY_DEFINITIONS).toHaveLength(
      Object.keys(FLEET_CAPABILITIES).length,
    );

    for (const code of Object.values(FLEET_CAPABILITIES)) {
      expect(FLEET_CAPABILITY_BY_CODE.get(code)?.code).toBe(code);
    }
  });

  it('gives every capability a name, a description and at least one scope', () => {
    for (const definition of FLEET_CAPABILITY_DEFINITIONS) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.scopeKinds.length).toBeGreaterThan(0);
    }
  });

  it('keeps the mutating and delegable sets in step with the definitions', () => {
    for (const definition of FLEET_CAPABILITY_DEFINITIONS) {
      expect(MUTATING_FLEET_CAPABILITIES.has(definition.code)).toBe(
        definition.mutating,
      );
      expect(DELEGABLE_FLEET_CAPABILITIES.has(definition.code)).toBe(
        definition.delegable,
      );
    }
  });

  /**
   * Plan section 4.3: ownership transfer and closure "remain Owner or app-admin
   * dispute action", and delegating roles is how ownership is exercised. A
   * delegable version of any of the three would make Owner and Admin the same
   * label with extra steps.
   */
  it.each([
    FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
    FLEET_CAPABILITIES.SCOPE_CLOSE,
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
  ])('does not allow %s to be delegated', capability => {
    expect(DELEGABLE_FLEET_CAPABILITIES.has(capability)).toBe(false);
  });

  it('scopes Armada management away from Fleets', () => {
    expect(
      FLEET_CAPABILITY_BY_CODE.get(FLEET_CAPABILITIES.ARMADA_MANAGE)
        ?.scopeKinds,
    ).not.toContain(FleetScopeKind.FLEET);
  });

  /**
   * Registering a child belongs to the Community and nowhere else: a Fleet has
   * nothing under it, and an Armada groups Fleets rather than containing them.
   * Scoping it anywhere wider would let the code be claimed against a Fleet,
   * where it would mean nothing and still read as authority.
   */
  it('scopes registering children to the Community alone', () => {
    expect(
      FLEET_CAPABILITY_BY_CODE.get(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER)
        ?.scopeKinds,
    ).toEqual([FleetScopeKind.COMMUNITY]);
  });

  /**
   * Unlike the four capabilities ownership *is*, this one is delegable. A
   * Community large enough to need a second Fleet is large enough to have
   * somebody other than the Owner register it, and nothing about registering a
   * Fleet can be turned into ownership of the Community.
   */
  it('allows registering children to be delegated', () => {
    expect(
      DELEGABLE_FLEET_CAPABILITIES.has(
        FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
      ),
    ).toBe(true);
  });

  /**
   * Artwork is delegable where the name, the description and the visibility
   * are not. A banner is the scope's public face rather than a claim about
   * who owns it, and somebody handed it can change nothing else — which is
   * the whole reason it is a capability of its own instead of a fifth thing
   * SCOPE_SETTINGS_MANAGE lets through.
   */
  it('allows artwork to be delegated at every kind of scope', () => {
    expect(
      DELEGABLE_FLEET_CAPABILITIES.has(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE),
    ).toBe(true);
    expect(
      FLEET_CAPABILITY_BY_CODE.get(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE)
        ?.scopeKinds,
    ).toEqual([
      FleetScopeKind.COMMUNITY,
      FleetScopeKind.FLEET,
      FleetScopeKind.ARMADA,
    ]);
  });

  it('scopes roster capabilities away from Armadas', () => {
    for (const capability of [
      FLEET_CAPABILITIES.ROSTER_VIEW,
      FLEET_CAPABILITIES.ROSTER_IMPORT,
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      FLEET_CAPABILITIES.ROSTER_SOURCE_DOWNLOAD,
    ]) {
      expect(
        FLEET_CAPABILITY_BY_CODE.get(capability)?.scopeKinds,
      ).not.toContain(FleetScopeKind.ARMADA);
    }
  });
});

describe('Fleet role baselines', () => {
  /**
   * The whole point of the label. Plan section 4.3 requires "explicitly
   * delegated capabilities" with "sensitive powers default absent", and least
   * privilege is only real when the default is nothing at all.
   */
  it('gives the Officer label nothing at all', () => {
    expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.OFFICER]).toEqual([]);
  });

  it('gives the Owner every capability', () => {
    expect(
      [...ROLE_BASELINE_CAPABILITIES[FleetScopeRole.OWNER]].sort(),
    ).toEqual([...ALL_FLEET_CAPABILITIES].sort());
  });

  it.each([
    FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
    FLEET_CAPABILITIES.SCOPE_CLOSE,
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
  ])('withholds %s from an Admin', capability => {
    expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.ADMIN]).not.toContain(
      capability,
    );
  });

  it.each([
    FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
    FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
    FLEET_CAPABILITIES.APPLICATIONS_DECIDE,
    FLEET_CAPABILITIES.RECRUITMENT_MANAGE,
    FLEET_CAPABILITIES.ROSTER_IMPORT,
    FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    FLEET_CAPABILITIES.HOLDINGS_WRITE,
    FLEET_CAPABILITIES.NEWS_WRITE,
    FLEET_CAPABILITIES.EVENTS_MANAGE,
    FLEET_CAPABILITIES.CHAT_MODERATE,
    FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
  ])('gives an Admin %s', capability => {
    expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.ADMIN]).toContain(
      capability,
    );
  });

  /**
   * Plan section 4.3, the approved-member bullet: "No source download, import
   * investigation or role grants by default."
   */
  it.each([
    FLEET_CAPABILITIES.ROSTER_SOURCE_DOWNLOAD,
    FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    FLEET_CAPABILITIES.MEMBERS_MANAGE,
    FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
  ])('withholds %s from a member', capability => {
    expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.MEMBER]).not.toContain(
      capability,
    );
  });

  it.each([
    FLEET_CAPABILITIES.ROSTER_VIEW,
    FLEET_CAPABILITIES.CHAT_POST,
    FLEET_CAPABILITIES.EVENTS_RSVP,
    FLEET_CAPABILITIES.CONTENT_REPORT,
  ])('gives a member %s', capability => {
    expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.MEMBER]).toContain(
      capability,
    );
  });

  it('gives an Admin everything a member has', () => {
    for (const capability of ROLE_BASELINE_CAPABILITIES[
      FleetScopeRole.MEMBER
    ]) {
      expect(ROLE_BASELINE_CAPABILITIES[FleetScopeRole.ADMIN]).toContain(
        capability,
      );
    }
  });

  it('names a baseline for every role label', () => {
    for (const role of Object.values(FleetScopeRole)) {
      expect(ROLE_BASELINE_CAPABILITIES[role]).toBeDefined();
    }
  });

  it('confers the member baseline on an approved membership', () => {
    expect([...APPROVED_MEMBERSHIP_CAPABILITIES].sort()).toEqual(
      [...ROLE_BASELINE_CAPABILITIES[FleetScopeRole.MEMBER]].sort(),
    );
  });

  it('declares every baseline capability as a real capability', () => {
    for (const role of Object.values(FleetScopeRole)) {
      for (const capability of ROLE_BASELINE_CAPABILITIES[role]) {
        expect(FLEET_CAPABILITY_BY_CODE.has(capability)).toBe(true);
      }
    }
  });
});
