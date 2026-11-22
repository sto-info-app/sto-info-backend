import { NotFoundException } from '@nestjs/common';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from '../authorisation/requires-scope-capability.decorator';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../enums/scope-capability-effect.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { CommunityGovernanceController } from './community-governance.controller';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';
import { communityScope } from './utilities/governance-scope.utility';

const COMMUNITY_ID = '25000000-0000-4000-8000-000000000001';
const USER_ID = '25000000-0000-4000-8000-000000000002';
const OTHER_ID = '25000000-0000-4000-8000-000000000003';
const ITEM_ID = '25000000-0000-4000-8000-000000000004';

const SCOPE = communityScope(COMMUNITY_ID);

describe('CommunityGovernanceController', () => {
  let assertEnabled: jest.Mock;
  let roles: Record<string, jest.Mock>;
  let transfers: Record<string, jest.Mock>;
  let closure: Record<string, jest.Mock>;
  let log: Record<string, jest.Mock>;
  let controller: CommunityGovernanceController;

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
    transfers = {
      standing: jest.fn(() => Promise.resolve('standing')),
      offer: jest.fn(() => Promise.resolve('offer')),
      cancel: jest.fn(() => Promise.resolve()),
      accept: jest.fn(() => Promise.resolve()),
      decline: jest.fn(() => Promise.resolve()),
    };
    closure = { closeCommunity: jest.fn(() => Promise.resolve()) };
    log = { list: jest.fn(() => Promise.resolve(['entry'])) };
    controller = new CommunityGovernanceController(
      { assertEnabled } as unknown as FleetFeatureService,
      roles as unknown as ScopeRolesService,
      transfers as unknown as OwnershipTransferService,
      closure as unknown as ScopeClosureService,
      log as unknown as ScopeGovernanceLogService,
    );
  });

  it('passes each route to its service, at the Community', async () => {
    const assign = { userId: OTHER_ID, role: FleetScopeRole.ADMIN } as const;
    const officers = { capabilities: ['news.write'] };
    const personal = {
      userId: OTHER_ID,
      capability: 'news.write',
      effect: ScopeCapabilityEffect.GRANT,
    };

    await expect(controller.roles(COMMUNITY_ID, USER_ID)).resolves.toBe(
      'roles',
    );
    await controller.assign(COMMUNITY_ID, assign, USER_ID);
    await controller.withdraw(
      COMMUNITY_ID,
      ITEM_ID,
      { reason: 'Why' },
      USER_ID,
    );
    await controller.setOfficerCapabilities(COMMUNITY_ID, officers, USER_ID);
    await controller.setPersonal(COMMUNITY_ID, personal, USER_ID);
    await controller.clearPersonal(COMMUNITY_ID, ITEM_ID, {}, USER_ID);
    await expect(controller.ownership(COMMUNITY_ID, USER_ID)).resolves.toBe(
      'standing',
    );
    await expect(
      controller.offer(COMMUNITY_ID, { toUserId: OTHER_ID }, USER_ID),
    ).resolves.toBe('offer');
    await controller.cancel(COMMUNITY_ID, ITEM_ID, USER_ID);
    await controller.accept(COMMUNITY_ID, ITEM_ID, USER_ID);
    await controller.decline(COMMUNITY_ID, ITEM_ID, USER_ID);
    await controller.close(COMMUNITY_ID, { reason: 'Done' }, USER_ID);

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
      undefined,
      USER_ID,
    );
    expect(transfers.standing).toHaveBeenCalledWith(COMMUNITY_ID, USER_ID);
    expect(transfers.offer).toHaveBeenCalledWith(
      COMMUNITY_ID,
      OTHER_ID,
      USER_ID,
    );
    for (const answer of ['cancel', 'accept', 'decline']) {
      expect(transfers[answer]).toHaveBeenCalledWith(
        COMMUNITY_ID,
        ITEM_ID,
        USER_ID,
      );
    }
    expect(closure.closeCommunity).toHaveBeenCalledWith(COMMUNITY_ID, {
      reason: 'Done',
      actorUserId: USER_ID,
    });
    expect(assertEnabled).toHaveBeenCalledTimes(12);
  });

  it('shows the history only to somebody who may read it', async () => {
    await expect(controller.history(COMMUNITY_ID, USER_ID)).resolves.toEqual([
      'entry',
    ]);
    expect(roles.assertMayRead).toHaveBeenCalledWith(SCOPE, USER_ID);
    expect(log.list).toHaveBeenCalledWith(SCOPE);

    roles.assertMayRead.mockRejectedValueOnce(new NotFoundException());

    await expect(
      controller.history(COMMUNITY_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(log.list).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the feature is off', async () => {
    assertEnabled.mockRejectedValue(new NotFoundException());

    await expect(
      controller.close(COMMUNITY_ID, { reason: 'Done' }, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(closure.closeCommunity).not.toHaveBeenCalled();
  });

  /**
   * A mistyped capability denies quietly and looks exactly like a working
   * restriction, so the wiring is read back rather than reviewed.
   */
  describe('the capabilities the routes require', () => {
    const requirementOf = (
      method: keyof CommunityGovernanceController,
    ): ScopeCapabilityRequirement | undefined =>
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        CommunityGovernanceController.prototype[method],
      );
    const at = (capability: string) => ({
      capability,
      source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
    });

    it.each([
      'assign',
      'withdraw',
      'setOfficerCapabilities',
      'setPersonal',
      'clearPersonal',
    ] as const)('requires role management, the Owner’s, to %s', method => {
      expect(requirementOf(method)).toEqual(
        at(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE),
      );
    });

    it.each(['offer', 'cancel'] as const)(
      'requires the transfer capability to %s',
      method => {
        expect(requirementOf(method)).toEqual(
          at(FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER),
        );
      },
    );

    it('requires the closure capability to close', () => {
      expect(requirementOf('close')).toEqual(
        at(FLEET_CAPABILITIES.SCOPE_CLOSE),
      );
    });

    // The Admin offered holds no transfer capability; the service checks
    // that it is them. Reading is checked by the service too.
    it.each(['accept', 'decline', 'roles', 'history', 'ownership'] as const)(
      'leaves %s to the service',
      method => {
        expect(requirementOf(method)).toBeUndefined();
      },
    );
  });
});
