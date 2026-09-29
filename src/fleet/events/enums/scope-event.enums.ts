/**
 * Who an event is shown to (FC-028).
 *
 * Steve's decision of 28 September 2026 offers all of these. Matched by name
 * at every site, never compared as an ordering, as {@link FleetAudience} is.
 */
export enum ScopeEventAudience {
  /** Anyone, including signed-out visitors. */
  PUBLIC = 'PUBLIC',
  /** The Community's followers and members. */
  COMMUNITY = 'COMMUNITY',
  /** The scope's own members. */
  MEMBERS = 'MEMBERS',
  /** The scope's Owner, Admins and Officers. */
  OFFICERS = 'OFFICERS',
  /** The members of chosen Fleets, and holders of chosen roles. */
  SELECTED = 'SELECTED',
}

/** Whether an event is still running. */
export enum ScopeEventStatus {
  /** Running. */
  ACTIVE = 'ACTIVE',
  /** Cancelled: nothing of it lies ahead. */
  CANCELLED = 'CANCELLED',
}

/** Whether an occurrence is still going ahead. */
export enum OccurrenceStatus {
  /** Going ahead, or held. */
  SCHEDULED = 'SCHEDULED',
  /** Cancelled, on its own, with its event, or with its scope. */
  CANCELLED = 'CANCELLED',
}

/** How somebody answered an occurrence. */
export enum RsvpResponse {
  /** Going, or waiting for a place if it is full. */
  GOING = 'GOING',
  /** Perhaps. Takes no place. */
  MAYBE = 'MAYBE',
  /** Can't go. */
  NOT_GOING = 'NOT_GOING',
}

/** What a manager, or the site, did to an event. */
export enum ScopeEventActionKind {
  CREATED = 'CREATED',
  EDITED = 'EDITED',
  CANCELLED = 'CANCELLED',
  OCCURRENCE_CANCELLED = 'OCCURRENCE_CANCELLED',
  OCCURRENCE_MOVED = 'OCCURRENCE_MOVED',
  ATTENDANCE_RECORDED = 'ATTENDANCE_RECORDED',
  /** Its scope was closed, which cancelled what lay ahead. */
  CLOSED_WITH_SCOPE = 'CLOSED_WITH_SCOPE',
}

/** How long before an occurrence a reminder may be sent, in minutes. */
export const REMINDER_LEADS: readonly number[] = [15, 60, 1440];
