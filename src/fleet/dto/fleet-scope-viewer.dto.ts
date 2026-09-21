import { ApiProperty } from '@nestjs/swagger';

import {
  ALL_FLEET_CAPABILITIES,
  FleetCapability,
} from '../authorisation/fleet-capability.constants';
import { FleetScopeRelationship } from '../enums/fleet-scope-relationship.enum';

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
  /**
   * How this caller stands to the scope, for the page to say so plainly.
   *
   * The strongest of the three records that answer it, because a badge has
   * room for one: an approved member who also follows the Community is shown
   * as a member. **Nothing is authorised from this.** It is what the page
   * should say, not what the caller may do — the capabilities above are for
   * that, and the route decides in any case.
   */
  @ApiProperty({
    enum: FleetScopeRelationship,
    description:
      'How this caller stands to the scope: following, an unanswered ' +
      'request, an approved membership, a suspended one, or nothing. ' +
      'Display only — following grants no access anywhere.',
  })
  relationship: FleetScopeRelationship;

  /**
   * Whether this caller follows the owning Community.
   *
   * Separate from {@link relationship} because it is a different question and
   * both can be true at once. A Fleet's approved member may follow the
   * Community that owns it or not, and the follow control has to know which
   * — a badge saying "member" cannot tell it.
   */
  @ApiProperty({
    description: 'Whether this caller follows the owning Community.',
  })
  isFollowingCommunity: boolean;

  /**
   * How many follow the owning Community, or null when there is none.
   *
   * Everything anybody is told about a Community's followers. Null is not
   * zero: an unregistered Fleet has no Community, so there is nobody to
   * follow rather than nobody following, and the page says so instead of
   * offering a control that could not work.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Live followers of the owning Community, or null when the scope has ' +
      'no Community to follow.',
  })
  followerCount: number | null;
}
