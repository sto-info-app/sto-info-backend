/**
 * What happened, for an activity feed (FC-029).
 *
 * Steve's decision of 28 September 2026: news and events; membership;
 * roster imports and holdings; Armada placements and governance. Routine
 * activity is feed, never inbox: none of these sends a notification.
 */
export enum ActivityType {
  /** A scope's news post was published. */
  NEWS_PUBLISHED = 'NEWS_PUBLISHED',
  /** An event was created. */
  EVENT_CREATED = 'EVENT_CREATED',
  /** An event was cancelled: everything of it still to come. */
  EVENT_CANCELLED = 'EVENT_CANCELLED',
  /** One occurrence of an event was cancelled. */
  OCCURRENCE_CANCELLED = 'OCCURRENCE_CANCELLED',
  /** One occurrence of an event was moved. */
  OCCURRENCE_MOVED = 'OCCURRENCE_MOVED',
  /** Somebody joined the Fleet. */
  MEMBER_JOINED = 'MEMBER_JOINED',
  /** Somebody left the Fleet. */
  MEMBER_LEFT = 'MEMBER_LEFT',
  /** Somebody was removed from the Fleet. */
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  /** A roster export was imported. Counts only, never names. */
  ROSTER_IMPORTED = 'ROSTER_IMPORTED',
  /** A holding's tiers were recorded. */
  HOLDINGS_RECORDED = 'HOLDINGS_RECORDED',
  /** A Fleet was placed in an Armada. */
  ARMADA_FLEET_PLACED = 'ARMADA_FLEET_PLACED',
  /** A Fleet moved within an Armada. */
  ARMADA_FLEET_MOVED = 'ARMADA_FLEET_MOVED',
  /** A Fleet left an Armada, or was taken out. */
  ARMADA_FLEET_LEFT = 'ARMADA_FLEET_LEFT',
  /** Somebody was given a role. */
  ROLE_APPOINTED = 'ROLE_APPOINTED',
  /** Somebody's role was taken away, or ended. */
  ROLE_WITHDRAWN = 'ROLE_WITHDRAWN',
  /** A Community's ownership passed to somebody else. */
  OWNERSHIP_TRANSFERRED = 'OWNERSHIP_TRANSFERRED',
  /** The scope was closed. */
  SCOPE_CLOSED = 'SCOPE_CLOSED',
}

/**
 * Who may see an activity item, asked afresh at every read (FC-029).
 *
 * Steve's decision: the item follows its source. Every item also needs the
 * reader to see its scope at all.
 */
export enum ActivityVisibility {
  /** Whoever may see the scope: holdings, Armada placements. */
  SCOPE = 'SCOPE',
  /**
   * The scope's members: membership, roster imports, governance. R15 keeps
   * roster-derived activity member-only.
   */
  MEMBERS = 'MEMBERS',
  /** Whoever may see its source now: a news post, an event. */
  SOURCE = 'SOURCE',
}

/** Where each type of item finds its audience. */
export const ACTIVITY_VISIBILITY: Readonly<
  Record<ActivityType, ActivityVisibility>
> = {
  [ActivityType.NEWS_PUBLISHED]: ActivityVisibility.SOURCE,
  [ActivityType.EVENT_CREATED]: ActivityVisibility.SOURCE,
  [ActivityType.EVENT_CANCELLED]: ActivityVisibility.SOURCE,
  [ActivityType.OCCURRENCE_CANCELLED]: ActivityVisibility.SOURCE,
  [ActivityType.OCCURRENCE_MOVED]: ActivityVisibility.SOURCE,
  [ActivityType.MEMBER_JOINED]: ActivityVisibility.MEMBERS,
  [ActivityType.MEMBER_LEFT]: ActivityVisibility.MEMBERS,
  [ActivityType.MEMBER_REMOVED]: ActivityVisibility.MEMBERS,
  [ActivityType.ROSTER_IMPORTED]: ActivityVisibility.MEMBERS,
  [ActivityType.HOLDINGS_RECORDED]: ActivityVisibility.SCOPE,
  [ActivityType.ARMADA_FLEET_PLACED]: ActivityVisibility.SCOPE,
  [ActivityType.ARMADA_FLEET_MOVED]: ActivityVisibility.SCOPE,
  [ActivityType.ARMADA_FLEET_LEFT]: ActivityVisibility.SCOPE,
  [ActivityType.ROLE_APPOINTED]: ActivityVisibility.MEMBERS,
  [ActivityType.ROLE_WITHDRAWN]: ActivityVisibility.MEMBERS,
  [ActivityType.OWNERSHIP_TRANSFERRED]: ActivityVisibility.MEMBERS,
  [ActivityType.SCOPE_CLOSED]: ActivityVisibility.MEMBERS,
};

/** How long an item is kept, in months. Steve's decision: twelve. */
export const ACTIVITY_RETENTION_MONTHS = 12;
