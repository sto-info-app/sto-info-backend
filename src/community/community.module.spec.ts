import { BlockService } from './block.service';
import { CommunityController } from './community.controller';
import { CommunityModule } from './community.module';
import { FriendshipService } from './friendship.service';
import { PublicMemberService } from './public-member.service';

describe('CommunityModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata('controllers', CommunityModule) as
      unknown[] | undefined;
    const providers = Reflect.getMetadata('providers', CommunityModule) as
      unknown[] | undefined;
    const exportsList = Reflect.getMetadata('exports', CommunityModule) as
      unknown[] | undefined;

    expect(controllers).toContain(CommunityController);
    expect(providers).toEqual(
      expect.arrayContaining([
        PublicMemberService,
        BlockService,
        FriendshipService,
      ]),
    );
    // The registry depends on all three, so each has to leave the module.
    expect(exportsList).toEqual(
      expect.arrayContaining([
        PublicMemberService,
        BlockService,
        FriendshipService,
      ]),
    );
  });
});
