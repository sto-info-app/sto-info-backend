import { SCOPE_NEWS_COVER_SPEC } from 'src/fleet/news/constants/scope-news.constants';
import { ImageSlotSpec } from 'src/shared/images/image-slot.service';

/**
 * The cover one of the site's own news posts may carry (sc-1447).
 *
 * The shape and sizes of a Fleet news cover, which is the same job and is
 * delivered through the same Cloudflare variants; only what Cloudflare
 * records it as differs, so the two can be told apart there.
 */
export const NEWS_COVER_SPEC: ImageSlotSpec = {
  ...SCOPE_NEWS_COVER_SPEC,
  entityTag: 'news-cover',
};
