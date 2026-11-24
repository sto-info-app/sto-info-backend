import {
  CoverImageUrls,
  coverUrlsOf,
} from 'src/shared/constants/image.constants';
import { formatStardate } from 'src/shared/utilities/stardate.utility';

import { LogEntryType } from './captains-log.constants';
import { LogEntryEntity } from './entities/log-entry.entity';

/** What each type of entry is called in a stardate headline. */
const LOG_NAMES: Readonly<Record<LogEntryType, string>> = {
  [LogEntryType.CAPTAIN]: "Captain's Log",
  [LogEntryType.PERSONAL]: 'Personal Log',
};

/**
 * The headline an entry has when its author gave it none (sc-1450).
 *
 * @param type - Captain's or Personal.
 * @param stardate - The stardate it was written on.
 * @returns e.g. "Captain's Log stardate 104502.6".
 */
export function defaultLogHeadline(
  type: LogEntryType,
  stardate: number,
): string {
  return `${LOG_NAMES[type]} stardate ${formatStardate(stardate)}`;
}

/** An entry as anybody reading a public profile sees it. */
export interface PublicLogEntryView {
  readonly id: string;
  /** The author's headline, or the stardate one. */
  readonly headline: string;
  readonly body: string;
  readonly stardate: number;
  /** The picture's addresses by size, or null. */
  readonly pictureUrls: CoverImageUrls | null;
  readonly pictureAlt: string | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

/** An entry as its author sees it. */
export interface LogEntryView extends PublicLogEntryView {
  readonly type: LogEntryType;
  /** The headline the author typed, or null when it is the stardate one. */
  readonly customHeadline: string | null;
  readonly removedAt: Date | null;
  readonly removedReason: string | null;
}

/** An entry as a site admin sees it, with its author. */
export interface AdminLogEntryView extends LogEntryView {
  readonly userId: string;
}

/** A page of entries. */
export interface LogEntryPage<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Shapes an entry for a public profile.
 *
 * @param entry - The entry.
 * @returns What a reader may see of it.
 */
export function publicLogEntryView(entry: LogEntryEntity): PublicLogEntryView {
  return {
    id: entry.id,
    headline: entry.headline ?? defaultLogHeadline(entry.type, entry.stardate),
    body: entry.body,
    stardate: entry.stardate,
    pictureUrls: coverUrlsOf(entry.pictureId),
    pictureAlt: entry.pictureAlt,
    createdAt: entry.createdAt,
    editedAt: entry.editedAt,
  };
}

/**
 * Shapes an entry for its author.
 *
 * @param entry - The entry.
 * @returns All of it, with its headline worked out.
 */
export function logEntryView(entry: LogEntryEntity): LogEntryView {
  return {
    ...publicLogEntryView(entry),
    type: entry.type,
    customHeadline: entry.headline,
    removedAt: entry.removedAt,
    removedReason: entry.removedReason,
  };
}

/**
 * Shapes an entry for a site admin.
 *
 * @param entry - The entry.
 * @returns All of it, and who wrote it.
 */
export function adminLogEntryView(entry: LogEntryEntity): AdminLogEntryView {
  return { ...logEntryView(entry), userId: entry.userId };
}
