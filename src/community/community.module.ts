import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from '../notification/notification.module';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { BlockService } from './block.service';
import { CommunityController } from './community.controller';
import { FriendshipEntity } from './entities/friendship.entity';
import { UserBlockEntity } from './entities/user-block.entity';
import { FriendshipService } from './friendship.service';
import { PublicMemberService } from './public-member.service';

/**
 * Friendships and blocking between members.
 *
 * Exports its services because the registry has to honour both: a block hides
 * a member's public record, and a profile view reports how the caller relates
 * to the member they are looking at. The dependency runs one way only —
 * community knows nothing about the registry.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FriendshipEntity,
      UserBlockEntity,
      UserProfileEntity,
      AccountEntity,
    ]),
    NotificationModule,
  ],
  controllers: [CommunityController],
  providers: [PublicMemberService, BlockService, FriendshipService],
  exports: [PublicMemberService, BlockService, FriendshipService],
})
export class CommunityModule {}
