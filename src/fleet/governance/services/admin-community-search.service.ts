import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, FindOptionsWhere, ILike, IsNull } from 'typeorm';

import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  resolveDirectoryPage,
  resolveDirectoryPageSize,
} from '../../utilities/directory-query.utility';
import { AdminCommunityPageDto } from '../dto/admin-community-search.dto';

/**
 * Finds Communities for a site administrator's dispute page (FC-050).
 *
 * Steve's decision of 30 September 2026: a site administrator reaches every
 * Community's dispute page, members-only and private ones included, and a
 * members-only or private Community is on no directory. So this lists every
 * live Community, whoever may see it and whatever its state, by name or web
 * address; only a site administrator reaches it.
 */
@Injectable()
export class AdminCommunitySearchService {
  /**
   * Creates an instance of AdminCommunitySearchService.
   *
   * @param _dataSource - The database.
   */
  constructor(@InjectDataSource() private readonly _dataSource: DataSource) {}

  /**
   * Lists the live Communities whose name or web address holds the term,
   * by name.
   *
   * @param search - What to look for, if anything; every one without it.
   * @param page - Which page.
   * @param pageSize - How many a page.
   * @returns The page.
   */
  async search(
    search?: string,
    page?: number,
    pageSize?: number,
  ): Promise<AdminCommunityPageDto> {
    const pageNumber = resolveDirectoryPage(page);
    const size = resolveDirectoryPageSize(pageSize);
    const term = search?.trim();
    const live: FindOptionsWhere<FleetCommunityEntity> = {
      deletedAt: IsNull(),
    };
    const pattern = term ? `%${escapeSqlLikeTerm(term)}%` : null;
    const manager = this._dataSource.manager;
    const [communities, total] = await manager.findAndCount(
      FleetCommunityEntity,
      {
        where:
          pattern === null
            ? live
            : [
                { ...live, name: ILike(pattern) },
                { ...live, slug: ILike(pattern) },
              ],
        // The identifier breaks ties, so a page boundary never repeats one.
        order: { name: 'ASC', id: 'ASC' },
        skip: (pageNumber - 1) * size,
        take: size,
      },
    );
    const owners = await usernamesFor(
      manager,
      communities.map(community => community.ownerUserId),
    );

    return {
      items: communities.map(community => ({
        id: community.id,
        name: community.name,
        slug: community.slug,
        visibility: community.visibility,
        status: community.status,
        ownerUsername:
          community.ownerUserId === null
            ? null
            : (owners.get(community.ownerUserId) ?? null),
      })),
      total,
      page: pageNumber,
      pageSize: size,
    };
  }
}
