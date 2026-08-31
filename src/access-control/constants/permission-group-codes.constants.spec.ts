import { UserRole } from '../../user/enums/user-role.enum';
import {
  PERMISSION_CODES,
  PERMISSION_DEFINITIONS,
} from './permission-codes.constants';
import { PERMISSION_GROUP_DEFINITIONS } from './permission-group-codes.constants';

/**
 * Every permission a role receives, resolved the way
 * {@link AccessControlService} resolves it: the union of every group mapped to
 * the role, before per-user overrides.
 *
 * @param role - The role to resolve.
 * @returns The permission codes the role confers.
 */
function permissionsFor(role: UserRole): Set<string> {
  return new Set(
    PERMISSION_GROUP_DEFINITIONS.filter(group =>
      group.roles.includes(role),
    ).flatMap(group => [...group.permissions]),
  );
}

describe('Permission group definitions', () => {
  // The seeded groups are the only description of what a role means, and
  // nothing else in the application reads them — so a mistake here is invisible
  // until somebody is refused a screen they should have, or given one they
  // should not.
  describe('the three roles', () => {
    it('gives an ordinary member the reader and creator permissions', () => {
      const user = permissionsFor(UserRole.USER);

      expect(user).toContain(PERMISSION_CODES.STORYTIME_VIEW);
      expect(user).toContain(PERMISSION_CODES.STORYTIME_STORY_CREATE);
      expect(user).not.toContain(PERMISSION_CODES.STORYTIME_MODERATE);
    });

    it('gives a curator every member permission as well as their own', () => {
      const user = permissionsFor(UserRole.USER);
      const curator = permissionsFor(UserRole.STORYTIME_CURATOR);

      for (const code of user) {
        expect(curator).toContain(code);
      }
    });

    it('lets a curator run the whole of Storytime', () => {
      const curator = permissionsFor(UserRole.STORYTIME_CURATOR);

      expect(curator).toContain(PERMISSION_CODES.STORYTIME_MODERATE);
      expect(curator).toContain(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE);
      expect(curator).toContain(PERMISSION_CODES.STORYTIME_TAG_MANAGE);
    });

    // The line between the two roles. Feature flags and limit exemptions change
    // the rules everyone plays by, so they stay with administrators.
    it('withholds Storytime configuration from a curator', () => {
      expect(permissionsFor(UserRole.STORYTIME_CURATOR)).not.toContain(
        PERMISSION_CODES.STORYTIME_CONFIGURE,
      );
    });

    it('gives an administrator everything a curator has, and configuration', () => {
      const curator = permissionsFor(UserRole.STORYTIME_CURATOR);
      const admin = permissionsFor(UserRole.ADMIN);

      for (const code of curator) {
        expect(admin).toContain(code);
      }
      expect(admin).toContain(PERMISSION_CODES.STORYTIME_CONFIGURE);
    });
  });

  describe('consistency with the permission registry', () => {
    it('describes every permission code it recognises', () => {
      expect(
        PERMISSION_DEFINITIONS.map(definition => definition.code).sort(),
      ).toEqual(Object.values(PERMISSION_CODES).sort());
    });

    it('confers only permissions the registry knows about', () => {
      const known = new Set<string>(Object.values(PERMISSION_CODES));

      for (const group of PERMISSION_GROUP_DEFINITIONS) {
        for (const code of group.permissions) {
          expect(known).toContain(code);
        }
      }
    });

    it('maps every group onto at least one role', () => {
      for (const group of PERMISSION_GROUP_DEFINITIONS) {
        expect(group.roles.length).toBeGreaterThan(0);
      }
    });
  });
});
