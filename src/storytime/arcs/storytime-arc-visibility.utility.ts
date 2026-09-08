import { FindOptionsWhere, In } from 'typeorm';

import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';

/** Statuses an Arc can hold and still be reachable by the public. */
export const PUBLICLY_READABLE_ARC_STATUSES = [ArcStatus.PUBLISHED];

/**
 * Visibilities that allow a published Arc to be opened by anyone with a link.
 */
export const PUBLICLY_READABLE_ARC_VISIBILITIES = [
  StorytimeVisibility.PUBLIC,
  StorytimeVisibility.UNLISTED,
];

/**
 * The conditions an Arc must meet to be named in a listing anybody may browse.
 *
 * Narrower than "reachable by a link": an unlisted Arc is one its curator has
 * chosen not to advertise, so it may be opened by somebody who was given the
 * address but must never be offered by a listing that goes looking.
 *
 * Built fresh on each call rather than shared as a constant, because a where
 * clause handed to TypeORM is the caller's to spread into and extend.
 *
 * @returns The where-clause fragment every discoverable Arc satisfies.
 */
export function discoverableArcConditions(): FindOptionsWhere<StorytimeArcEntity> {
  return {
    status: In(PUBLICLY_READABLE_ARC_STATUSES),
    visibility: StorytimeVisibility.PUBLIC,
    moderationStatus: StorytimeModerationStatus.ACTIVE,
  };
}
