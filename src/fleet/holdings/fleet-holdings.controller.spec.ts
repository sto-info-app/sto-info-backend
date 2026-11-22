import { NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import { RecordFleetHoldingDto } from './dto/fleet-holdings.dto';
import { FleetHoldingsController } from './fleet-holdings.controller';
import { FleetHoldingsService } from './services/fleet-holdings.service';

const FLEET = {
  id: 'fleet-1',
  visibility: FleetAudience.PUBLIC,
} as StoFleetEntity;

describe('FleetHoldingsController', () => {
  let feature: { assertEnabled: jest.Mock };
  let fleets: { findByIdOrFail: jest.Mock };
  let audience: { assertCanViewFleet: jest.Mock };
  let holdings: { view: jest.Mock; history: jest.Mock; record: jest.Mock };
  let controller: FleetHoldingsController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(() => Promise.resolve()) };
    fleets = { findByIdOrFail: jest.fn(() => Promise.resolve(FLEET)) };
    audience = { assertCanViewFleet: jest.fn(() => Promise.resolve()) };
    holdings = {
      view: jest.fn(() => Promise.resolve({ holdings: [] })),
      history: jest.fn(() => Promise.resolve({ items: [] })),
      record: jest.fn(() => Promise.resolve()),
    };
    controller = new FleetHoldingsController(
      feature as unknown as FleetFeatureService,
      fleets as unknown as StoFleetService,
      audience as unknown as FleetAudienceService,
      holdings as unknown as FleetHoldingsService,
    );
  });

  it('keeps recording to holders of holdings.write at the Fleet', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetHoldingsController.prototype.record,
      ),
    ).toEqual({
      capability: FLEET_CAPABILITIES.HOLDINGS_WRITE,
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });
  });

  it('shows the holdings to whoever may see the Fleet', async () => {
    await expect(
      controller.view('community-1', 'fleet-1', null),
    ).resolves.toEqual({ holdings: [] });

    expect(feature.assertEnabled).toHaveBeenCalled();
    expect(fleets.findByIdOrFail).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
    );
    expect(audience.assertCanViewFleet).toHaveBeenCalledWith(FLEET, null);
    expect(holdings.view).toHaveBeenCalledWith(FLEET, null);
  });

  it('shows the history to whoever may see the Fleet', async () => {
    await expect(
      controller.history('community-1', 'fleet-1', 'user-1', { page: 2 }),
    ).resolves.toEqual({ items: [] });

    expect(audience.assertCanViewFleet).toHaveBeenCalledWith(FLEET, 'user-1');
    expect(holdings.history).toHaveBeenCalledWith(FLEET, 'user-1', {
      page: 2,
    });
  });

  it('hides both from somebody who may not see the Fleet', async () => {
    audience.assertCanViewFleet.mockRejectedValue(new NotFoundException());

    await expect(
      controller.view('community-1', 'fleet-1', null),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.history('community-1', 'fleet-1', null, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(holdings.view).not.toHaveBeenCalled();
    expect(holdings.history).not.toHaveBeenCalled();
  });

  it('records, then answers with where the holdings now stand', async () => {
    const dto = {
      tiers: [{ track: 'STARBASE', tier: 2 }],
    } as RecordFleetHoldingDto;

    await expect(
      controller.record('community-1', 'fleet-1', 'STARBASE', 'user-1', dto),
    ).resolves.toEqual({ holdings: [] });

    expect(feature.assertEnabled).toHaveBeenCalled();
    expect(holdings.record).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'STARBASE',
      dto,
      'user-1',
    );
    expect(holdings.view).toHaveBeenCalledWith(FLEET, 'user-1');
  });
});
