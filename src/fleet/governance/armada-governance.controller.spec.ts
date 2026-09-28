import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from '../authorisation/requires-scope-capability.decorator';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../enums/scope-capability-effect.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { ArmadaGovernanceController } from './armada-governance.controller';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';
import { armadaScope } from './utilities/governance-scope.utility';

const COMMUNITY_ID = '26000000-0000-4000-8000-000000000001';
const ARMADA_ID = '26000000-0000-4000-8000-000000000002';
const USER_ID = '26000000-0000-4000-8000-000000000003';
const OTHER_ID = '26000000-0000-4000-8000-000000000004';
const ITEM_ID = '26000000-0000-4000-8000-000000000005';

const SCOPE = armadaScope(COMMUNITY_ID, ARMADA_ID);

describe('ArmadaGovernanceController', () => {
  let assertEnabled: jest.Mock;
  let roles: Record<string, jest.Mock>;
  let log: Record<string, jest.Mock>;
  let controller: ArmadaGovernanceController;

  beforeEach(() => {
    assertEnabled = jest.fn(() => Promise.resolve());
    roles = {
      view: jest.fn(() => Promise.resolve('roles')),
      assign: jest.fn(() => Promise.resolve()),
      withdraw: jest.fn(() => Promise.resolve()),
      setOfficerCapabilities: jest.fn(() => Promise.resolve()),
      setPersonal: jest.fn(() => Promise.resolve()),
      clearPersonal: jest.fn(() => Promise.resolve()),
      assertMayRead: jest.fn(() => Promise.resolve()),
    };
    log = { list: jest.fn(() => Promise.resolve(['entry'])) };
    controller = new ArmadaGovernanceController(
      { assertEnabled } as unknown as FleetFeatureService,
      roles as unknown as ScopeRolesService,
      log as unknown as ScopeGovernanceLogService,
    );
  });

  it('passes each route to its service, at the Armada', async () => {
    const assign = { userId: OTHER_ID, role: FleetScopeRole.OFFICER } as const;
    const officers = { capabilities: ['news.write'], reason: 'Why' };
    const personal = {
      userId: OTHER_ID,
      capability: 'news.write',
      effect: ScopeCapabilityEffect.DENY,
      reason: 'Why',
    };

    await expect(
      controller.roles(COMMUNITY_ID, ARMADA_ID, USER_ID),
    ).resolves.toBe('roles');
    await controller.assign(COMMUNITY_ID, ARMADA_ID, assign, USER_ID);
    await controller.withdraw(
      COMMUNITY_ID,
      ARMADA_ID,
      ITEM_ID,
      { reason: 'Why' },
      USER_ID,
    );
    await controller.setOfficerCapabilities(
      COMMUNITY_ID,
      ARMADA_ID,
      officers,
      USER_ID,
    );
    await controller.setPersonal(COMMUNITY_ID, ARMADA_ID, personal, USER_ID);
    await controller.clearPersonal(
      COMMUNITY_ID,
      ARMADA_ID,
      ITEM_ID,
      { reason: 'Why' },
      USER_ID,
    );
    await expect(
      controller.history(COMMUNITY_ID, ARMADA_ID, USER_ID),
    ).resolves.toEqual(['entry']);

    expect(roles.view).toHaveBeenCalledWith(SCOPE, USER_ID);
    expect(roles.assign).toHaveBeenCalledWith(SCOPE, assign, USER_ID);
    expect(roles.withdraw).toHaveBeenCalledWith(SCOPE, ITEM_ID, 'Why', USER_ID);
    expect(roles.setOfficerCapabilities).toHaveBeenCalledWith(
      SCOPE,
      officers,
      USER_ID,
    );
    expect(roles.setPersonal).toHaveBeenCalledWith(SCOPE, personal, USER_ID);
    expect(roles.clearPersonal).toHaveBeenCalledWith(
      SCOPE,
      ITEM_ID,
      'Why',
      USER_ID,
    );
    expect(roles.assertMayRead).toHaveBeenCalledWith(SCOPE, USER_ID);
    expect(log.list).toHaveBeenCalledWith(SCOPE);
    expect(assertEnabled).toHaveBeenCalledTimes(7);
  });

  describe('the capabilities the routes require', () => {
    const requirementOf = (
      method: keyof ArmadaGovernanceController,
    ): ScopeCapabilityRequirement | undefined =>
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        ArmadaGovernanceController.prototype[method],
      );
    // The Community segment is a checked claim, so an Armada another
    // Community holds resolves to nothing.
    const at = (capability: string) => ({
      capability,
      source: {
        kind: FleetScopeKind.ARMADA,
        param: 'armadaId',
        communityParam: 'communityId',
      },
    });

    it.each([
      'assign',
      'withdraw',
      'setOfficerCapabilities',
      'setPersonal',
      'clearPersonal',
    ] as const)('requires role management at the Armada to %s', method => {
      expect(requirementOf(method)).toEqual(
        at(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE),
      );
    });

    it('has no route of its own to close', () => {
      expect('close' in ArmadaGovernanceController.prototype).toBe(false);
    });

    it.each(['roles', 'history'] as const)(
      'leaves reading %s to the service',
      method => {
        expect(requirementOf(method)).toBeUndefined();
      },
    );
  });
});
