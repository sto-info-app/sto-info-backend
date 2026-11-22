/**
 * What became of one attempt to put a picture in a slot.
 *
 * A placement is the answer to "what is this slot showing, and is something
 * on its way to it", and those are two different questions that the owning
 * row cannot answer together: a Story's `bannerImageId` says what is on the
 * page and says nothing at all about the upload being scanned right now.
 *
 * Only two of these are live. At most one `PENDING` and at most one
 * `ACTIVE` placement may exist for a slot, enforced by two partial unique
 * indexes rather than by service code, for the same reason the asset's own
 * transitions are enforced by a trigger.
 */
export enum FileAssetPlacementState {
  /**
   * An upload is on its way to the slot.
   *
   * Written at ingress, before the scanner has been asked anything. It is
   * what makes the scan strip survive a page reload: the entity's own
   * endpoint reports that a replacement is being checked, rather than the
   * state living only in whichever dialog happened to be open.
   */
  PENDING = 'PENDING',

  /** The picture the slot is showing. */
  ACTIVE = 'ACTIVE',

  /**
   * The scanner refused it, and the reader has not yet replaced it.
   *
   * Sticky on purpose. A refusal that vanished overnight would leave
   * somebody looking at their old picture with no indication that the new one
   * was ever refused, and the conclusion to draw from that is that the site
   * ignored them. Cleared by the next upload to the same slot.
   */
  REJECTED = 'REJECTED',

  /**
   * A newer upload took the slot before this one finished.
   *
   * The last thing a person sent is the thing they get. When the superseded
   * upload's verdict eventually arrives it publishes nothing, and its
   * quarantined bytes are dropped.
   */
  SUPERSEDED = 'SUPERSEDED',

  /**
   * The picture was taken down and nothing replaced it.
   *
   * What a delete leaves behind. Distinct from `SUPERSEDED`, which is a slot
   * that went on to show something else: the difference is whether the
   * reader chose a new picture or chose none, and only the second is a thing
   * somebody might have done by accident.
   */
  WITHDRAWN = 'WITHDRAWN',

  /**
   * Nothing ever came back for it.
   *
   * Set by the nightly sweep for a placement left pending far longer than any
   * scan takes — a worker that was never deployed, a queue that lost a
   * message, a person who closed the tab during an outage. The bytes are
   * dropped with it, which is the only way an abandoned upload leaves
   * quarantine.
   */
  ABANDONED = 'ABANDONED',

  /**
   * Cleared and read, and waiting on a decision before it may be in force.
   *
   * Only a restricted asset's publisher asks for this, when the file is sound
   * but something about it needs a person — a roster export that claims
   * the same moment as a different export of the same Fleet. Settled as far
   * as the nightly sweep is concerned, because nothing is waiting for a
   * scanner, so a decision that takes longer than a day does not cost the
   * file. Only a pending placement can be held, which the database enforces.
   */
  HELD = 'HELD',
}

/** The placement states that still expect something to happen. */
export const LIVE_FILE_ASSET_PLACEMENT_STATES: readonly FileAssetPlacementState[] =
  [FileAssetPlacementState.PENDING];
