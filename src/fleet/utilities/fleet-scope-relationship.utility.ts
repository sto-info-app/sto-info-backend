import { ScopeAuthorisation } from '../authorisation/scope-authorisation.interface';
import { FleetScopeRelationship } from '../enums/fleet-scope-relationship.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';

/** The parts of an authorisation a relationship is read from. */
export type RelationshipFacts = Pick<
  ScopeAuthorisation,
  'isApprovedMember' | 'membershipStatus'
>;

/**
 * Reduces the three records that describe a caller to the one a page shows.
 *
 * A function rather than a branch inside the viewer service, because the order
 * is the whole of it and an order is worth testing on its own. Every caller
 * gets the same answer, so a badge and a button cannot describe the same
 * person differently.
 *
 * Suspension is tested before membership. The two cannot both hold today — an
 * approved membership and a suspended one are the same column — but if that
 * ever stops being true, the safe reading of "approved and suspended" is
 * suspended, and putting the check second would quietly choose the other one.
 *
 * Following is last because it is the weakest thing anybody can be, never
 * because it is combined with the others: a member who follows is a member
 * here, and whether they also follow is reported separately.
 *
 * @param facts - What the authorisation concluded about their membership.
 * @param isFollowingCommunity - Whether they follow the owning Community.
 * @returns The relationship a page should state.
 */
export function toScopeRelationship(
  facts: RelationshipFacts,
  isFollowingCommunity: boolean,
): FleetScopeRelationship {
  if (facts.membershipStatus === ScopeMembershipStatus.SUSPENDED) {
    return FleetScopeRelationship.SUSPENDED;
  }

  if (facts.isApprovedMember) {
    return FleetScopeRelationship.MEMBER;
  }

  if (facts.membershipStatus === ScopeMembershipStatus.PENDING) {
    return FleetScopeRelationship.REQUESTED;
  }

  return isFollowingCommunity
    ? FleetScopeRelationship.FOLLOWER
    : FleetScopeRelationship.NONE;
}
