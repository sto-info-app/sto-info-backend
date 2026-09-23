import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FLEET_CAPABILITIES } from './fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  RequiresScopeCapability,
  ScopeCapabilityRequirement,
} from './requires-scope-capability.decorator';

describe('RequiresScopeCapability', () => {
  it('records the capability and where to find the scope', () => {
    class Controller {
      @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_IMPORT, {
        kind: FleetScopeKind.FLEET,
        param: 'id',
      })
      handler(): void {
        return undefined;
      }
    }

    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        Controller.prototype.handler,
      ),
    ).toEqual<ScopeCapabilityRequirement>({
      capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
      source: { kind: FleetScopeKind.FLEET, param: 'id' },
    });
  });

  it('records the Community parameter of a nested route', () => {
    class Controller {
      @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      })
      handler(): void {
        return undefined;
      }
    }

    const requirement = Reflect.getMetadata(
      REQUIRES_SCOPE_CAPABILITY_KEY,
      Controller.prototype.handler,
    ) as ScopeCapabilityRequirement;

    expect(requirement.source.communityParam).toBe('communityId');
  });

  it('records alternatives, any one of which will do', () => {
    class Controller {
      @RequiresScopeCapability(
        [
          FLEET_CAPABILITIES.ROSTER_IMPORT,
          FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
        ],
        { kind: FleetScopeKind.FLEET, param: 'fleetId' },
      )
      handler(): void {
        return undefined;
      }
    }

    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        Controller.prototype.handler,
      ),
    ).toMatchObject({
      capability: [
        FLEET_CAPABILITIES.ROSTER_IMPORT,
        FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      ],
    });
  });

  it('can be applied to a whole controller', () => {
    @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, {
      kind: FleetScopeKind.ARMADA,
      param: 'id',
    })
    class Controller {}

    expect(
      Reflect.getMetadata(REQUIRES_SCOPE_CAPABILITY_KEY, Controller),
    ).toMatchObject({ capability: FLEET_CAPABILITIES.ARMADA_MANAGE });
  });
});
