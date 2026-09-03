import { Module } from '@nestjs/common';

import { CommunityModule } from '../../community/community.module';
import { StorytimeAuthorService } from './storytime-author.service';

/**
 * Naming the members behind the identifiers Storytime stores.
 *
 * A module of its own because both halves of the feature need it and they
 * cannot reach each other: Stories already depends on Social, so Social naming
 * the author of a comment through Stories would close a circle. Both depend on
 * this instead, and it depends only on the community it asks.
 */
@Module({
  imports: [CommunityModule],
  providers: [StorytimeAuthorService],
  exports: [StorytimeAuthorService],
})
export class StorytimeAuthorModule {}
