import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';

/**
 * Every scoped capability the Fleet Community feature recognises.
 *
 * These are **not** site-wide permission codes and they never appear in the
 * `permission` table. A site-wide permission answers "may this kind of user
 * reach this feature at all"; a capability here answers "may this user do this
 * to *this* Fleet". Keeping the two vocabularies apart is what makes FC-005's
 * first acceptance criterion structural rather than a rule somebody has to
 * remember: there is no site-wide code that could be mistyped into a scope
 * check and quietly confer access to every Fleet, because the scope resolver
 * never reads {@link PermissionCode} at all.
 *
 * Declared as literals for the same reason as the site-wide codes: a typo in a
 * guard becomes a compile error rather than a capability that silently never
 * matches. That failure mode is especially dangerous in authorisation, because
 * an unmatched code denies quietly and looks exactly like a working
 * restriction.
 */
export const FLEET_CAPABILITIES = {
  /** Change the scope's own settings, description and visibility. */
  SCOPE_SETTINGS_MANAGE: 'scope.settings.manage',
  /** Assign and withdraw the fixed role labels, and delegate capabilities. */
  SCOPE_ROLES_MANAGE: 'scope.roles.manage',
  /** Hand ownership of the scope to another user. */
  SCOPE_OWNERSHIP_TRANSFER: 'scope.ownership.transfer',
  /** Close the scope. */
  SCOPE_CLOSE: 'scope.close',

  /** See who the approved members of the scope are. */
  MEMBERS_VIEW: 'members.view',
  /** Suspend, reinstate and remove approved members. */
  MEMBERS_MANAGE: 'members.manage',

  /** Read submitted applications, including their answers. */
  APPLICATIONS_VIEW: 'applications.view',
  /** Accept or reject an application. */
  APPLICATIONS_DECIDE: 'applications.decide',
  /** Change the recruitment state and the application form. */
  RECRUITMENT_MANAGE: 'recruitment.manage',

  /** Read the private roster, including handles and Last Active. */
  ROSTER_VIEW: 'roster.view',
  /** Upload a roster export and have it imported. */
  ROSTER_IMPORT: 'roster.import',
  /** Inspect an import's processing detail, exclusions and conflicts. */
  ROSTER_INVESTIGATE: 'roster.investigate',
  /** Retrieve the stored source file of an import. */
  ROSTER_SOURCE_DOWNLOAD: 'roster.source.download',
  /** Read the scope's reports and aggregates. */
  REPORTS_VIEW: 'reports.view',

  /** Write and publish news at the scope. */
  NEWS_WRITE: 'news.write',
  /** Create and change events, occurrences and their audiences. */
  EVENTS_MANAGE: 'events.manage',
  /** Respond to an event invitation. */
  EVENTS_RSVP: 'events.rsvp',
  /** Record manual holding tiers. */
  HOLDINGS_WRITE: 'holdings.write',

  /** Post in the scope's channels. */
  CHAT_POST: 'chat.post',
  /** Remove messages and act on reports within the scope. */
  CHAT_MODERATE: 'chat.moderate',
  /** Export a channel transcript under an audited reason. */
  CHAT_TRANSCRIPT_EXPORT: 'chat.transcript.export',

  /** Report content or a user to the site administrators. */
  CONTENT_REPORT: 'content.report',

  /** Decide Fleet join requests and restructure Armada placement. */
  ARMADA_MANAGE: 'armada.manage',
} as const;

/** A recognised scoped capability. */
export type FleetCapability =
  (typeof FLEET_CAPABILITIES)[keyof typeof FLEET_CAPABILITIES];

/** What is known about a capability beyond its code. */
export interface FleetCapabilityDefinition {
  /** The stable code used in guards and stored in a grant row. */
  readonly code: FleetCapability;
  /** Short human-readable name for the delegation settings surface. */
  readonly name: string;
  /** Explanation of what holding the capability allows. */
  readonly description: string;
  /**
   * Whether exercising it changes something.
   *
   * A scope that is `SUSPENDED` or `CLOSED` stays readable and accepts no new
   * activity — plan section 4.1 — so the resolver withdraws every mutating
   * capability there and leaves the reading ones alone. Marking this on the
   * capability rather than testing the status at each call site means a new
   * endpoint cannot forget the rule.
   */
  readonly mutating: boolean;
  /**
   * Whether an Owner may delegate it to an individual or to a role label.
   *
   * Ownership transfer, closure and role management are not delegable: they
   * are how ownership is exercised, so delegating them would make the
   * distinction between Owner and Admin meaningless.
   */
  readonly delegable: boolean;
  /** The scope kinds the capability means anything at. */
  readonly scopeKinds: readonly FleetScopeKind[];
}

const EVERY_SCOPE = [
  FleetScopeKind.COMMUNITY,
  FleetScopeKind.FLEET,
  FleetScopeKind.ARMADA,
] as const;

/**
 * The authoritative description of every capability.
 *
 * Read by the delegation settings surface and by the tests that hold the role
 * baselines to plan section 4.3. Nothing seeds it into the database: unlike
 * site-wide permissions, a capability is a constant in the code and a grant row
 * names it by code, so adding one here is enough to make it usable.
 */
export const FLEET_CAPABILITY_DEFINITIONS: readonly FleetCapabilityDefinition[] =
  [
    {
      code: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
      name: 'Manage settings',
      description:
        "Change the scope's name, description, visibility and preferences.",
      mutating: true,
      delegable: false,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
      name: 'Manage roles',
      description:
        'Assign and withdraw Admin, Officer and Member, and delegate individual capabilities.',
      mutating: true,
      delegable: false,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
      name: 'Transfer ownership',
      description: 'Hand ownership of the scope to another user.',
      mutating: true,
      delegable: false,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.SCOPE_CLOSE,
      name: 'Close the scope',
      description:
        'Close the scope, keeping its history readable and accepting nothing new.',
      mutating: true,
      delegable: false,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.MEMBERS_VIEW,
      name: 'View members',
      description: 'See the approved members of the scope and their roles.',
      mutating: false,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.MEMBERS_MANAGE,
      name: 'Manage members',
      description: 'Suspend, reinstate and remove approved members.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.APPLICATIONS_VIEW,
      name: 'View applications',
      description: 'Read submitted applications and their answers.',
      mutating: false,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.APPLICATIONS_DECIDE,
      name: 'Decide applications',
      description: 'Accept or reject an application to join a Fleet.',
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.RECRUITMENT_MANAGE,
      name: 'Manage recruitment',
      description: 'Change the recruitment state and the application form.',
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.ROSTER_VIEW,
      name: 'View the roster',
      description:
        'Read the private roster, including account handles and Last Active.',
      mutating: false,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.ROSTER_IMPORT,
      name: 'Import rosters',
      description: 'Upload a roster export and have it imported.',
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      name: 'Investigate imports',
      description:
        "Inspect an import's processing detail, exclusions and identity conflicts.",
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.ROSTER_SOURCE_DOWNLOAD,
      name: 'Download import sources',
      description: 'Retrieve the stored source file of a roster import.',
      mutating: false,
      delegable: false,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.REPORTS_VIEW,
      name: 'View reports',
      description: "Read the scope's reports and aggregates.",
      mutating: false,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.NEWS_WRITE,
      name: 'Write news',
      description: 'Write, publish and withdraw news at the scope.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.EVENTS_MANAGE,
      name: 'Manage events',
      description: 'Create and change events, occurrences and their audiences.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.EVENTS_RSVP,
      name: 'Respond to events',
      description: 'Respond to an event invitation, optionally as a Character.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.HOLDINGS_WRITE,
      name: 'Record holdings',
      description: 'Record the manual tier of a Fleet holding.',
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.FLEET],
    },
    {
      code: FLEET_CAPABILITIES.CHAT_POST,
      name: 'Post in chat',
      description: "Post in the scope's channels.",
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.CHAT_MODERATE,
      name: 'Moderate chat',
      description: 'Remove messages and act on reports within the scope.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
      name: 'Export transcripts',
      description:
        'Export a channel transcript for a bounded window under an audited reason.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.CONTENT_REPORT,
      name: 'Report content',
      description: 'Report a message or a user to the site administrators.',
      mutating: true,
      delegable: true,
      scopeKinds: EVERY_SCOPE,
    },
    {
      code: FLEET_CAPABILITIES.ARMADA_MANAGE,
      name: 'Manage the Armada',
      description:
        'Decide Fleet join requests and restructure Alpha, Beta and Gamma placement.',
      mutating: true,
      delegable: true,
      scopeKinds: [FleetScopeKind.COMMUNITY, FleetScopeKind.ARMADA],
    },
  ];

/** Every capability code, in declaration order. */
export const ALL_FLEET_CAPABILITIES: readonly FleetCapability[] =
  FLEET_CAPABILITY_DEFINITIONS.map(definition => definition.code);

/** The capabilities that change something, as a set for cheap lookup. */
export const MUTATING_FLEET_CAPABILITIES: ReadonlySet<FleetCapability> =
  new Set(
    FLEET_CAPABILITY_DEFINITIONS.filter(definition => definition.mutating).map(
      definition => definition.code,
    ),
  );

/** The capabilities an Owner may hand to somebody else. */
export const DELEGABLE_FLEET_CAPABILITIES: ReadonlySet<FleetCapability> =
  new Set(
    FLEET_CAPABILITY_DEFINITIONS.filter(definition => definition.delegable).map(
      definition => definition.code,
    ),
  );

/** Looks a capability's definition up by code. */
export const FLEET_CAPABILITY_BY_CODE: ReadonlyMap<
  FleetCapability,
  FleetCapabilityDefinition
> = new Map(
  FLEET_CAPABILITY_DEFINITIONS.map(definition => [definition.code, definition]),
);
