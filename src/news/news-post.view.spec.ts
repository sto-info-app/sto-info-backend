import { coverUrlsOf } from 'src/shared/constants/image.constants';

import { NewsPostEntity } from './entities/news-post.entity';
import { newsPageView, newsPostView } from './news-post.view';

describe('news post views', () => {
  it('adds a post’s cover addresses, keeping everything else', () => {
    const post = {
      id: 'p1',
      title: 'Release notes',
      coverImageId: 'cover-1',
    } as NewsPostEntity;

    expect(newsPostView(post)).toEqual({
      ...post,
      coverImageUrls: coverUrlsOf('cover-1'),
    });
  });

  it('gives a post with no cover no addresses', () => {
    const post = { id: 'p1', coverImageId: null } as NewsPostEntity;

    expect(newsPostView(post).coverImageUrls).toBeNull();
  });

  it('adds the addresses on every post of a page, and keeps the page', () => {
    const page = {
      items: [
        { id: 'p1', coverImageId: 'cover-1' },
        { id: 'p2', coverImageId: null },
      ] as NewsPostEntity[],
      total: 2,
      page: 1,
      pageSize: 10,
    };

    const view = newsPageView(page);

    expect(view.total).toBe(2);
    expect(view.items.map(post => post.coverImageUrls)).toEqual([
      coverUrlsOf('cover-1'),
      null,
    ]);
  });
});
