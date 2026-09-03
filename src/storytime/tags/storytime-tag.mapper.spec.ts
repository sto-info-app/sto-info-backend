import { Test, TestingModule } from '@nestjs/testing';

import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagMapper } from './storytime-tag.mapper';

describe('StorytimeTagMapper', () => {
  let mapper: StorytimeTagMapper;

  const tag = Object.assign(new StorytimeTagEntity(), {
    id: 'tag-1',
    slug: 'klingon',
    name: 'Klingon',
    description: 'The Empire.',
    category: StorytimeTagCategory.FACTION,
    displayOrder: 2,
    isAdminManaged: true,
    createdByUserId: 'admin-1',
    updatedByUserId: 'admin-1',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeTagMapper],
    }).compile();

    mapper = module.get<StorytimeTagMapper>(StorytimeTagMapper);
  });

  it('maps a tag', () => {
    const mapped = mapper.toTag(tag);

    expect(mapped.name).toBe('Klingon');
    expect(mapped.slug).toBe('klingon');
    expect(mapped.category).toBe(StorytimeTagCategory.FACTION);
    expect(mapped.displayOrder).toBe(2);
  });

  // Who added a tag matters to an administrator reading the audit trail, not
  // to anything that renders a filter link.
  it.each(['createdByUserId', 'updatedByUserId', 'isAdminManaged'])(
    'leaves %s out',
    field => {
      expect(
        mapper.toTag(tag) as unknown as Record<string, unknown>,
      ).not.toHaveProperty(field);
    },
  );

  it('maps lists', () => {
    expect(mapper.toList([tag])).toHaveLength(1);
  });
});
