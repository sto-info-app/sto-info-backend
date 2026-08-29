import { Test, TestingModule } from '@nestjs/testing';
import { PublicMemberService } from '../../community/public-member.service';
import { CommunityMemberDto } from '../../community/dto/community-member.dto';
import { StorytimeAuthorService } from './storytime-author.service';

describe('StorytimeAuthorService', () => {
  let service: StorytimeAuthorService;
  let memberService: { findMembersByUserIds: jest.Mock };

  const USER_ID = 'user-1';

  /**
   * Builds a member as the community service returns one.
   *
   * @param overrides - What differs from a plain listed member.
   * @returns The member.
   */
  const buildMember = (
    overrides: Partial<CommunityMemberDto> = {},
  ): CommunityMemberDto =>
    ({
      userId: USER_ID,
      username: 'captain.picard',
      publiclyVisible: true,
      ...overrides,
    }) as CommunityMemberDto;

  beforeEach(async () => {
    memberService = {
      findMembersByUserIds: jest
        .fn()
        .mockResolvedValue(new Map([[USER_ID, buildMember()]])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeAuthorService,
        { provide: PublicMemberService, useValue: memberService },
      ],
    }).compile();

    service = module.get<StorytimeAuthorService>(StorytimeAuthorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('names the member who owns the work', async () => {
    await expect(service.findAuthor(USER_ID)).resolves.toEqual({
      username: 'captain.picard',
      publiclyVisible: true,
    });
    expect(memberService.findMembersByUserIds).toHaveBeenCalledWith([USER_ID]);
  });

  // Publishing is itself a public act, so the registry's own listing setting
  // does not decide whether a work says who wrote it.
  it('names a member who has not chosen to be listed in the registry', async () => {
    memberService.findMembersByUserIds.mockResolvedValue(
      new Map([[USER_ID, buildMember({ publiclyVisible: false })]]),
    );

    await expect(service.findAuthor(USER_ID)).resolves.toEqual({
      username: 'captain.picard',
      publiclyVisible: false,
    });
  });

  // The work is still readable; it simply stops saying who wrote it.
  it('answers with nobody when the account has gone', async () => {
    memberService.findMembersByUserIds.mockResolvedValue(new Map());

    await expect(service.findAuthor(USER_ID)).resolves.toBeNull();
  });
});
