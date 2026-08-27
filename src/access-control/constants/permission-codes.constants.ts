import { PermissionModule } from '../enums/permission-module.enum';

/**
 * Every permission code the application recognises.
 *
 * Codes are the contract between the database, the {@link RequiresPermission}
 * decorator and the frontend. They are declared here as literals so a typo in a
 * guard is a compile error rather than a permission that silently never
 * matches — the most dangerous failure mode for an authorisation check, because
 * an unmatched code denies access quietly in development and can be mistaken
 * for a working restriction.
 *
 * Adding a code here is not enough to make it usable: it must also be seeded
 * into the `permission` table by a migration, and
 * {@link PERMISSION_DEFINITIONS} is what the seed reads.
 */
export const PERMISSION_CODES = {
  /** Read published Storytime content. */
  STORYTIME_VIEW: 'storytime.view',
  /** Create a Story. */
  STORYTIME_STORY_CREATE: 'storytime.story.create',
  /** Edit a Story the user owns. */
  STORYTIME_STORY_EDIT_OWN: 'storytime.story.edit.own',
  /** Publish a Story the user owns. */
  STORYTIME_STORY_PUBLISH_OWN: 'storytime.story.publish.own',
  /** Accept and act on Story collaboration invitations. */
  STORYTIME_COLLABORATE: 'storytime.collaborate',
  /** Create an Arc. */
  STORYTIME_ARC_CREATE: 'storytime.arc.create',
  /** Manage an Arc the user owns. */
  STORYTIME_ARC_MANAGE_OWN: 'storytime.arc.manage.own',
  /** Post comments on Storytime content. */
  STORYTIME_COMMENT_CREATE: 'storytime.comment.create',
  /** React to Storytime content. */
  STORYTIME_REACTION_CREATE: 'storytime.reaction.create',
  /** Report Storytime content. */
  STORYTIME_REPORT_CREATE: 'storytime.report.create',
  /** Review reports and remove or restore Storytime content. */
  STORYTIME_MODERATE: 'storytime.moderate',
  /** Manage Storytime Spotlight entries. */
  STORYTIME_SPOTLIGHT_MANAGE: 'storytime.spotlight.manage',
  /** Configure Storytime, including feature flags and per-user limits. */
  STORYTIME_CONFIGURE: 'storytime.configure',
} as const;

/**
 * A recognised permission code.
 */
export type PermissionCode =
  (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES];

/**
 * The seedable description of a permission.
 */
export interface PermissionDefinition {
  /** The stable code used in guards and stored in the database. */
  readonly code: PermissionCode;
  /** Short human-readable name shown in the administration UI. */
  readonly name: string;
  /** Explanation of what holding the permission allows. */
  readonly description: string;
  /** The application area the permission belongs to. */
  readonly module: PermissionModule;
}

/**
 * The authoritative list of permissions, used by the seeding migration and by
 * the administration API when listing what can be granted.
 */
export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    code: PERMISSION_CODES.STORYTIME_VIEW,
    name: 'View Storytime',
    description: 'Read published Stories, Chapters, Characters and Arcs.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_STORY_CREATE,
    name: 'Create Stories',
    description: 'Create new Storytime Stories.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN,
    name: 'Edit own Stories',
    description:
      'Edit Stories the user owns, including metadata, Chapters and artwork.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_STORY_PUBLISH_OWN,
    name: 'Publish own Stories',
    description:
      'Publish and unpublish Stories the user owns. Collaborators never receive this.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_COLLABORATE,
    name: 'Collaborate on Stories',
    description:
      'Accept collaboration invitations and edit Stories owned by other users.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_ARC_CREATE,
    name: 'Create Arcs',
    description: 'Create multi-author Storytime Arcs.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_ARC_MANAGE_OWN,
    name: 'Manage own Arcs',
    description:
      'Edit Arcs the user owns, including membership requests and Story ordering.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_COMMENT_CREATE,
    name: 'Comment',
    description: 'Post comments on Stories, Chapters and Arcs.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_REACTION_CREATE,
    name: 'React',
    description: 'Add Thumbs Up and Thumbs Down reactions.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_REPORT_CREATE,
    name: 'Report content',
    description: 'Report Storytime content for moderator review.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_MODERATE,
    name: 'Moderate Storytime',
    description:
      'Review reports, remove and restore content, and decide appeals.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE,
    name: 'Manage Spotlight',
    description: 'Create, schedule and withdraw Storytime Spotlight entries.',
    module: PermissionModule.STORYTIME,
  },
  {
    code: PERMISSION_CODES.STORYTIME_CONFIGURE,
    name: 'Configure Storytime',
    description:
      'Change Storytime feature flags and grant per-user limit exemptions.',
    module: PermissionModule.STORYTIME,
  },
];
