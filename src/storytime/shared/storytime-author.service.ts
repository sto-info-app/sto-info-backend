import { Injectable } from '@nestjs/common';
import { PublicMemberService } from '../../community/public-member.service';
import { StorytimeAuthorDto } from '../dto/storytime-author.dto';

/**
 * Names the member who published a work.
 *
 * A Story carries its owner as an identifier, which is no use to a reader:
 * somebody arriving at a Chapter wants to know whose it is. The name is their
 * registry username, shown whether or not they have chosen to be listed in the
 * registry — publishing a Story is itself a public act, and that setting is a
 * choice about being found, not about being credited for what you put out.
 *
 * Whether they are listed comes back with it, because it decides whether the
 * name can lead anywhere: a profile that is not listed has no page to open.
 *
 * Both a Story page and a Chapter page need exactly this, so the lookup lives
 * here rather than in each of them.
 */
@Injectable()
export class StorytimeAuthorService {
  /**
   * Creates an instance of StorytimeAuthorService.
   *
   * @param _memberService - Resolves members from their user IDs.
   */
  constructor(private readonly _memberService: PublicMemberService) {}

  /**
   * Names the member who owns a work.
   *
   * A member who has closed or disabled their account since publishing drops
   * out, which is answered as nobody rather than as an error: the work is
   * still readable, and it simply no longer says who wrote it.
   *
   * @param userId - The owner.
   * @returns The author, or null when there is no longer an account.
   */
  async findAuthor(userId: string): Promise<StorytimeAuthorDto | null> {
    const members = await this._memberService.findMembersByUserIds([userId]);
    const member = members.get(userId);

    if (!member) {
      return null;
    }

    return {
      username: member.username,
      publiclyVisible: member.publiclyVisible,
    };
  }
}
