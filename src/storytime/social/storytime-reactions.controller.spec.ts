import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeReaction } from '../enums/storytime-reaction.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeReactionService } from './storytime-reaction.service';
import { StorytimeReactionsController } from './storytime-reactions.controller';

describe('StorytimeReactionsController', () => {
  let controller: StorytimeReactionsController;
  let reactionService: {
    react: jest.Mock;
    remove: jest.Mock;
    summarise: jest.Mock;
  };

  const readerId = 'reader-1';
  const storyId = 'story-1';

  const summary = {
    targetId: storyId,
    upVotes: 2,
    downVotes: 1,
    rating: 1,
    mine: StorytimeReaction.THUMBS_UP,
  };

  beforeEach(async () => {
    reactionService = {
      react: jest.fn().mockResolvedValue(summary),
      remove: jest.fn().mockResolvedValue({ ...summary, mine: null }),
      summarise: jest.fn().mockResolvedValue(summary),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeReactionsController],
      providers: [
        { provide: StorytimeReactionService, useValue: reactionService },
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<StorytimeReactionsController>(
      StorytimeReactionsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('reads how something stands', async () => {
    const result = await controller.findOne(
      StorytimeTargetType.STORY,
      storyId,
      readerId,
    );

    expect(result.rating).toBe(1);
    expect(reactionService.summarise).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
      readerId,
    );
  });

  // The rating is on every card already, so reading it needs no account. The
  // reader arrives as null rather than absent, because that is what
  // `OptionalUserId` hands a route when nobody is signed in.
  it('reads how something stands for a signed-out reader', async () => {
    await controller.findOne(StorytimeTargetType.STORY, storyId, null);

    expect(reactionService.summarise).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
      null,
    );
  });

  it('records a reaction', async () => {
    await controller.react(
      {
        targetType: StorytimeTargetType.STORY,
        targetId: storyId,
        reaction: StorytimeReaction.THUMBS_UP,
      },
      readerId,
    );

    expect(reactionService.react).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
      StorytimeReaction.THUMBS_UP,
      readerId,
    );
  });

  it('takes a reaction back', async () => {
    const result = await controller.remove(
      StorytimeTargetType.STORY,
      storyId,
      readerId,
    );

    expect(result.mine).toBeNull();
    expect(reactionService.remove).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
      readerId,
    );
  });

  it('passes on a refusal to react to something unreactable', async () => {
    reactionService.react.mockRejectedValue(new BadRequestException());

    await expect(
      controller.react(
        {
          targetType: StorytimeTargetType.CHARACTER,
          targetId: 'character-1',
          reaction: StorytimeReaction.THUMBS_UP,
        },
        readerId,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
