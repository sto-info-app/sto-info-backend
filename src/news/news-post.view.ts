import {
  CoverImageUrls,
  coverUrlsOf,
} from 'src/shared/constants/image.constants';

import { NewsPostEntity } from './entities/news-post.entity';

/** A post as the API hands it out: with its cover's addresses, by size. */
export type NewsPostView<T extends NewsPostEntity = NewsPostEntity> = T & {
  /** Its cover's addresses, or null when it has none (sc-1447). */
  coverImageUrls: CoverImageUrls | null;
};

/** A page of posts, each with its cover's addresses. */
export type NewsPageView<T extends { items: NewsPostEntity[] }> = Omit<
  T,
  'items'
> & { items: NewsPostView[] };

/**
 * Adds a post's cover addresses, so no client builds one itself.
 *
 * @param post - The post.
 * @returns The post and its cover's addresses.
 */
export function newsPostView<T extends NewsPostEntity>(
  post: T,
): NewsPostView<T> {
  return { ...post, coverImageUrls: coverUrlsOf(post.coverImageId) };
}

/**
 * Adds the cover addresses of every post on a page.
 *
 * @param page - The page.
 * @returns The page, its posts with their cover's addresses.
 */
export function newsPageView<T extends { items: NewsPostEntity[] }>(
  page: T,
): NewsPageView<T> {
  return { ...page, items: page.items.map(post => newsPostView(post)) };
}
