import { NewsCategory } from '../enums/news-category.enum';
import { NewsStatus } from '../enums/news-status.enum';
import { NewsPostEntity } from './news-post.entity';

describe('NewsPostEntity', () => {
  it('stores assigned post fields', () => {
    const entity = new NewsPostEntity();
    entity.title = 'Release 1.2.3';
    entity.slug = 'release-1-2-3';
    entity.category = NewsCategory.RELEASE_NOTES;
    entity.status = NewsStatus.PUBLISHED;

    expect(entity.title).toBe('Release 1.2.3');
    expect(entity.slug).toBe('release-1-2-3');
    expect(entity.category).toBe(NewsCategory.RELEASE_NOTES);
    expect(entity.status).toBe(NewsStatus.PUBLISHED);
  });
});
