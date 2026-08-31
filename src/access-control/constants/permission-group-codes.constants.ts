import { UserRole } from '../../user/enums/user-role.enum';
import { PERMISSION_CODES, PermissionCode } from './permission-codes.constants';

/**
 * Codes for the permission groups seeded with the application.
 */
export const PERMISSION_GROUP_CODES = {
  /** Everything an ordinary reader may do. */
  STORYTIME_READER: 'storytime.reader',
  /** Everything a creator may do with their own content. */
  STORYTIME_CREATOR: 'storytime.creator',
  /** Moderation and curation, without site-wide configuration. */
  STORYTIME_CURATOR: 'storytime.curator',
  /** Moderation, curation and configuration. */
  STORYTIME_ADMINISTRATOR: 'storytime.administrator',
} as const;

/**
 * A recognised permission group code.
 */
export type PermissionGroupCode =
  (typeof PERMISSION_GROUP_CODES)[keyof typeof PERMISSION_GROUP_CODES];

/**
 * The seedable description of a permission group.
 */
export interface PermissionGroupDefinition {
  /** The stable code stored in the database. */
  readonly code: PermissionGroupCode;
  /** Short human-readable name shown in the administration UI. */
  readonly name: string;
  /** Explanation of who the group is intended for. */
  readonly description: string;
  /**
   * Whether the group is part of the application's definition of itself.
   *
   * System groups cannot be renamed or deleted through the administration API,
   * only have their membership adjusted. Without this, removing the
   * administrator group would lock every user out of the permission system that
   * governs it.
   */
  readonly isSystem: boolean;
  /** The permissions the group confers. */
  readonly permissions: readonly PermissionCode[];
  /** The roles that receive this group by default. */
  readonly roles: readonly UserRole[];
}

/**
 * The authoritative list of permission groups and their default role grants.
 *
 * These deliberately reproduce the behaviour the application had before the
 * permission framework existed: every authenticated user may read and create
 * Storytime content (plan §31.2) and administrators additionally moderate and
 * curate (plan §31.24). The framework's value is not a change of defaults but
 * the ability to vary them per user afterwards.
 *
 * The curator sits between the two: everything a member may do, plus running
 * Storytime — the moderation queue and the Spotlight — but not
 * `storytime.configure`. That one permission is the line between the two
 * roles: feature flags and limit exemptions change the rules everyone plays by,
 * which is an administrator's decision rather than a curator's. The Storytime
 * master switch is stricter still and is gated by the ADMIN role itself, since
 * a switch that turns Storytime off cannot be gated by a Storytime permission.
 */
export const PERMISSION_GROUP_DEFINITIONS: readonly PermissionGroupDefinition[] =
  [
    {
      code: PERMISSION_GROUP_CODES.STORYTIME_READER,
      name: 'Storytime Reader',
      description:
        'Read Storytime content, comment, react and report. Granted to every authenticated user.',
      isSystem: true,
      permissions: [
        PERMISSION_CODES.STORYTIME_VIEW,
        PERMISSION_CODES.STORYTIME_COMMENT_CREATE,
        PERMISSION_CODES.STORYTIME_REACTION_CREATE,
        PERMISSION_CODES.STORYTIME_REPORT_CREATE,
      ],
      roles: [UserRole.USER, UserRole.ADMIN, UserRole.STORYTIME_CURATOR],
    },
    {
      code: PERMISSION_GROUP_CODES.STORYTIME_CREATOR,
      name: 'Storytime Creator',
      description:
        'Create and publish own Stories and Arcs, and collaborate on others. Granted to every authenticated user.',
      isSystem: true,
      permissions: [
        PERMISSION_CODES.STORYTIME_STORY_CREATE,
        PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN,
        PERMISSION_CODES.STORYTIME_STORY_PUBLISH_OWN,
        PERMISSION_CODES.STORYTIME_COLLABORATE,
        PERMISSION_CODES.STORYTIME_ARC_CREATE,
        PERMISSION_CODES.STORYTIME_ARC_MANAGE_OWN,
      ],
      roles: [UserRole.USER, UserRole.ADMIN, UserRole.STORYTIME_CURATOR],
    },
    {
      code: PERMISSION_GROUP_CODES.STORYTIME_CURATOR,
      name: 'Storytime Curator',
      description:
        'Moderate reported content and curate the Spotlight. Granted to Storytime curators.',
      isSystem: true,
      permissions: [
        PERMISSION_CODES.STORYTIME_MODERATE,
        PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE,
      ],
      roles: [UserRole.STORYTIME_CURATOR],
    },
    {
      code: PERMISSION_GROUP_CODES.STORYTIME_ADMINISTRATOR,
      name: 'Storytime Administrator',
      description:
        'Moderate reported content, curate the Spotlight and configure Storytime.',
      isSystem: true,
      permissions: [
        PERMISSION_CODES.STORYTIME_MODERATE,
        PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE,
        PERMISSION_CODES.STORYTIME_CONFIGURE,
      ],
      roles: [UserRole.ADMIN],
    },
  ];
