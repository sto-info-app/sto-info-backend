import { FleetScopeRelationship } from '../enums/fleet-scope-relationship.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import { toScopeRelationship } from './fleet-scope-relationship.utility';

/**
 * Builds the membership facts a relationship is read from.
 *
 * @param membershipStatus - The membership at the scope, if any.
 * @returns The facts.
 */
function facts(membershipStatus: ScopeMembershipStatus | null) {
  return {
    membershipStatus,
    isApprovedMember: membershipStatus === ScopeMembershipStatus.APPROVED,
  };
}

describe('toScopeRelationship', () => {
  it('reports nothing for somebody with no record anywhere', () => {
    expect(toScopeRelationship(facts(null), false)).toBe(
      FleetScopeRelationship.NONE,
    );
  });

  it('reports a follower who is nothing else as a follower', () => {
    expect(toScopeRelationship(facts(null), true)).toBe(
      FleetScopeRelationship.FOLLOWER,
    );
  });

  it('reports an unanswered request as a request', () => {
    expect(
      toScopeRelationship(facts(ScopeMembershipStatus.PENDING), false),
    ).toBe(FleetScopeRelationship.REQUESTED);
  });

  it('reports an approved membership as membership', () => {
    expect(
      toScopeRelationship(facts(ScopeMembershipStatus.APPROVED), false),
    ).toBe(FleetScopeRelationship.MEMBER);
  });

  it('reports a suspended membership as suspended', () => {
    expect(
      toScopeRelationship(facts(ScopeMembershipStatus.SUSPENDED), false),
    ).toBe(FleetScopeRelationship.SUSPENDED);
  });

  /*
   * Membership is the stronger statement and a badge has room for one. Which
   * it is does not change whether they follow — that is reported separately,
   * because both are true at once and a control has to know.
   */
  it('calls a member who also follows a member', () => {
    expect(
      toScopeRelationship(facts(ScopeMembershipStatus.APPROVED), true),
    ).toBe(FleetScopeRelationship.MEMBER);
  });

  it('calls a requester who also follows a requester', () => {
    expect(
      toScopeRelationship(facts(ScopeMembershipStatus.PENDING), true),
    ).toBe(FleetScopeRelationship.REQUESTED);
  });

  /*
   * The two cannot both hold today — an approved membership and a suspended
   * one are the same column. If that ever stops being true, the safe reading
   * of "approved and suspended" is suspended.
   */
  it('prefers suspension over an approval claimed alongside it', () => {
    expect(
      toScopeRelationship(
        {
          membershipStatus: ScopeMembershipStatus.SUSPENDED,
          isApprovedMember: true,
        },
        true,
      ),
    ).toBe(FleetScopeRelationship.SUSPENDED);
  });

  /*
   * A membership that ended is history. The record stays for the audit
   * trail; the page says what is true now.
   */
  it.each([
    ScopeMembershipStatus.LEFT,
    ScopeMembershipStatus.REJECTED,
    ScopeMembershipStatus.REVOKED,
  ])('treats a %s membership as over', status => {
    expect(toScopeRelationship(facts(status), false)).toBe(
      FleetScopeRelationship.NONE,
    );
  });

  it('still reports the following of somebody whose membership ended', () => {
    expect(toScopeRelationship(facts(ScopeMembershipStatus.LEFT), true)).toBe(
      FleetScopeRelationship.FOLLOWER,
    );
  });
});
