import { NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterIdentityCandidateState } from './enums/roster-identity-candidate-state.enum';
import { RosterIdentityDecisionAction } from './enums/roster-identity-decision-action.enum';
import { RosterIdentitiesController } from './roster-identities.controller';
import { RosterIdentityReviewService } from './services/roster-identity-review.service';

const FLEET_ID = '8038747f-fcc3-41b4-b37e-83569c8800a3';
const CANDIDATE_ID = '0b6d8e1c-8f53-4a4e-9f5e-2f8f0c1d9a01';
const USER_ID = 'user-1';

describe('RosterIdentitiesController', () => {
  let review: { list: jest.Mock; decide: jest.Mock };
  let feature: { assertFlagEnabled: jest.Mock };
  let controller: RosterIdentitiesController;

  beforeEach(() => {
    review = {
      list: jest.fn(() => Promise.resolve({ items: [] })),
      decide: jest.fn(() => Promise.resolve({ id: CANDIDATE_ID })),
    };
    feature = { assertFlagEnabled: jest.fn(() => Promise.resolve()) };
    controller = new RosterIdentitiesController(
      review as unknown as RosterIdentityReviewService,
      feature as unknown as FleetFeatureService,
    );
  });

  describe.each([['list'], ['decide']] as const)('%s', handler => {
    // The capability that already covers identity conflicts, for reading as
    // well as deciding: a candidate names Characters and handles.
    it('is for roster investigators of the Fleet', () => {
      const requirement = Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        RosterIdentitiesController.prototype[handler],
      ) as ScopeCapabilityRequirement;

      expect(requirement).toEqual({
        capability: FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
    });

    it('is hidden while imports are switched off', async () => {
      feature.assertFlagEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        handler === 'list'
          ? controller.list(FLEET_ID, {})
          : controller.decide(FLEET_ID, CANDIDATE_ID, USER_ID, {
              action: RosterIdentityDecisionAction.CONFIRM,
              revision: 0,
            }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(feature.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
      );
      expect(review[handler]).not.toHaveBeenCalled();
    });
  });

  it('lists the page and state it was asked for', async () => {
    const query = { page: 2, state: RosterIdentityCandidateState.OPEN };

    await expect(controller.list(FLEET_ID, query)).resolves.toEqual({
      items: [],
    });
    expect(review.list).toHaveBeenCalledWith(FLEET_ID, query);
  });

  it('hands the decision over with who made it', async () => {
    const body = {
      action: RosterIdentityDecisionAction.UNDO,
      revision: 1,
      reason: 'Two different people',
    };

    await expect(
      controller.decide(FLEET_ID, CANDIDATE_ID, USER_ID, body),
    ).resolves.toEqual({ id: CANDIDATE_ID });
    expect(review.decide).toHaveBeenCalledWith(
      FLEET_ID,
      CANDIDATE_ID,
      USER_ID,
      body,
    );
  });

  // A decision changes a candidate that already exists; nothing is created
  // at a location the client could fetch.
  it('answers a decision with 200', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        RosterIdentitiesController.prototype.decide,
      ),
    ).toBe(200);
  });
});
