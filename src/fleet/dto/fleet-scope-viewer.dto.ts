import { ApiProperty } from '@nestjs/swagger';

import {
  ALL_FLEET_CAPABILITIES,
  FleetCapability,
} from '../authorisation/fleet-capability.constants';

/**
 * What the caller looking at a scope may do to it.
 *
 * Answered with the record rather than asked for separately, because a scope
 * page is one request by design — the same reason the address resolves in
 * one call rather than three. A second round trip to find out whether to
 * draw a button would put a control on the page after the reader had
 * already decided there was not one.
 *
 * **Nothing here is an access decision.** It says what the page should
 * offer; the guard on each route still says what may happen. The two can
 * disagree — a role withdrawn while somebody had the page open — and when
 * they do the route wins and the reader is told why. This exists so that
 * the ordinary case does not look like a permission error.
 *
 * Empty for a signed-out caller without anything being resolved. Nobody who
 * is not signed in may change any of it, and that is knowable without a
 * query.
 */
export class FleetScopeViewerDto {
  @ApiProperty({
    isArray: true,
    enum: ALL_FLEET_CAPABILITIES,
    description:
      'The scoped capabilities this caller holds here, after delegation, ' +
      'denial and suspension. Empty when signed out, when the scope admits ' +
      'them nothing, or when the scope is one nobody can hold a capability ' +
      'at — an unregistered Fleet has no Community, so there is no scope to ' +
      'hold one at.',
  })
  capabilities: FleetCapability[];

  /**
   * Whether to offer setting or replacing the wide banner.
   *
   * Separate from the emblem because the two are not always the same answer.
   * At a registered scope they are: one capability covers the artwork. At an
   * unregistered Fleet they are per slot, since an empty slot is open to
   * anybody signed in and a filled one belongs to whoever filled it — so the
   * banner may be free while the emblem is somebody else's work.
   */
  @ApiProperty({
    description: 'Whether this caller may set or replace the banner.',
  })
  mayManageBanner: boolean;

  @ApiProperty({
    description: 'Whether this caller may set or replace the emblem.',
  })
  mayManageEmblem: boolean;
}
