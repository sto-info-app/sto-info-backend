import { EntityManager, In } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

/**
 * Reads the STO Info usernames of some users.
 *
 * Recruitment names people by their username and by nothing else: not an
 * email address, and not a real name a profile may hold.
 *
 * @param manager - The manager to read through.
 * @param userIds - The users, nulls and repeats allowed.
 * @returns Each user's username, for those who have one.
 */
export async function usernamesFor(
  manager: EntityManager,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];

  if (ids.length === 0) {
    return new Map();
  }

  const profiles = await manager.find(UserProfileEntity, {
    where: { userId: In(ids) },
    select: { userId: true, username: true },
  });

  return new Map(profiles.map(profile => [profile.userId, profile.username]));
}
