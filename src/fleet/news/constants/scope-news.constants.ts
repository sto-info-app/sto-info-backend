import { ImageSlotSpec } from 'src/shared/images/image-slot.service';

import { FleetAudience } from '../../enums/fleet-audience.enum';

/**
 * Who a Community's, a Fleet's or an Armada's post may be published to
 * (FC-027).
 *
 * Anyone; the Community's followers and members; or the scope's own members.
 * Never {@link FleetAudience.PRIVATE}, which means the Community's Owner alone
 * and is no audience for news. Steve's decision of 28 September 2026, which
 * also made {@link FleetAudience.PUBLIC} the default.
 */
export const SCOPE_NEWS_AUDIENCES: readonly FleetAudience[] = [
  FleetAudience.PUBLIC,
  FleetAudience.COMMUNITY,
  FleetAudience.FLEET_MEMBERS,
];

/** The audience a new post has until its author chooses another. */
export const DEFAULT_SCOPE_NEWS_AUDIENCE = FleetAudience.PUBLIC;

/** The most posts one page of a scope's news holds. */
export const SCOPE_NEWS_MAX_PAGE_SIZE = 50;

/** How many posts a page holds when the caller does not say. */
export const SCOPE_NEWS_DEFAULT_PAGE_SIZE = 10;

/** The longest search a scope's News tab accepts. */
export const SCOPE_NEWS_SEARCH_MAX_LENGTH = 100;

/**
 * The longest readable stem a post's slug uses, leaving room for the suffix
 * that keeps it unique within its scope. The same as the site's news.
 */
export const SCOPE_NEWS_SLUG_MAX_LENGTH = 240;

/**
 * The cover a scoped post may carry.
 *
 * The shape of a Storytime chapter cover, which is the same job: one picture
 * heading one piece of writing. Published to Cloudflare Images like a Fleet's
 * banner, by Steve's decision of 28 September 2026; what gates it is that the
 * post naming it is only handed to its audience.
 */
export const SCOPE_NEWS_COVER_SPEC: ImageSlotSpec = {
  label: 'News cover',
  aspectRatio: [16, 9],
  minimumWidth: 640,
  minimumHeight: 360,
  recommendedWidth: 1920,
  recommendedHeight: 1080,
  outputFormat: 'jpeg',
  entityTag: 'fleet-news-cover',
};
