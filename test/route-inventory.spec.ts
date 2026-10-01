import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { REQUIRES_PERMISSION_KEY } from 'src/access-control/requires-permission.decorator';
import { ROLES_KEY } from 'src/auth/roles.decorator';
import { FLEET_CAPABILITIES } from 'src/fleet/authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from 'src/fleet/authorisation/requires-scope-capability.decorator';
import { FleetScopeKind } from 'src/fleet/enums/fleet-scope-kind.enum';

/**
 * How a route is protected.
 *
 * - `SCOPED`, `ROLE` and `PERMISSION`: a guard checks a declared requirement
 *   before the handler runs.
 * - `SIGNED_IN`: anybody signed in reaches the handler, which decides from
 *   who is asking — the caller's own data, or a service-level check.
 * - `PUBLIC`: anybody at all reaches the handler.
 */
type Protection = 'SCOPED' | 'ROLE' | 'PERMISSION' | 'SIGNED_IN' | 'PUBLIC';

/** One route, as Nest will serve it. */
interface Route {
  readonly key: string;
  readonly controller: string;
  readonly verb: string;
  readonly path: string;
  readonly guards: readonly string[];
  readonly protection: Protection;
  readonly scope: ScopeCapabilityRequirement | undefined;
}

/** HTTP verbs, in the order Nest's `RequestMethod` numbers them. */
const VERBS = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'ALL',
  'OPTIONS',
  'HEAD',
  'SEARCH',
];

/** Guards that check a declared requirement, and the requirement each reads. */
const REQUIREMENT_GUARDS: Readonly<Record<string, string>> = {
  ScopeCapabilityGuard: REQUIRES_SCOPE_CAPABILITY_KEY,
  RolesGuard: ROLES_KEY,
  PermissionsGuard: REQUIRES_PERMISSION_KEY,
};

/** Guards that establish who is asking. */
const SIGNED_IN_GUARDS = ['JwtAuthGuard', 'AuthGuard(jwt)'];

// ----- What each signed-in-only and public route relies on -----

const OWN_DATA =
  'Acts only on the caller’s own records: every query is keyed by the ' +
  'signed-in user, and another user’s identifier reads as not found.';
const OWN_CHARACTER_PROGRESS =
  'Reads or writes progress on a Character the service first proves is the ' +
  'caller’s own; the lists are reference data.';
const STORYTIME_CREATOR =
  'Storytime authoring: the service checks the caller owns, or collaborates ' +
  'on, the Arc or Story before reading or changing it.';
const STORYTIME_READER =
  'A reader’s own library, follows, reactions and comments, keyed by the ' +
  'caller; changing a comment checks it is theirs or they moderate it.';
const CUSTOM_TRACKING =
  'Custom Tracking definitions and values: the caller’s own, keyed by them. ' +
  'Its editing guards are feature switches and the agreement, not access.';
const FRIENDS =
  'The caller’s own friends, requests and blocks; the service refuses a ' +
  'friendship or block the caller is not party to.';
const CHAT =
  'Chat: ChatAccessService admits a channel or conversation only to a ' +
  'current member or friend, re-checked on every read and post (FC-031).';
const GOVERNANCE_READ =
  'Role and history reads: GovernanceRoleService.view/assertMayRead admits ' +
  'only those the scope’s audience allows (FC-021).';
const OWN_FLEET_STANDING =
  'The caller’s own follows, applications, invitations, memberships and ' +
  'proposals; each action names one the service proves is theirs.';
const APPEALS =
  'A creator’s own appeals against a removal: the service refuses content ' +
  'that is not theirs. The class-level PermissionsGuard asks nothing of ' +
  'these three.';
const NOTIFICATIONS =
  'The caller’s own notifications; another’s identifier reads as not found.';

/**
 * Routes anybody signed in reaches, keyed by controller (every such route in
 * it) or by `Controller.handler`, with what each relies on instead.
 */
const SIGNED_IN_ROUTES: Readonly<Record<string, string>> = {
  AccountController: OWN_DATA,
  UserController: OWN_DATA,
  CharacterController:
    `${OWN_DATA} The lookups are reference data. A portrait goes through ` +
    'image ingress, checked and re-encoded (FC-043).',
  AccessControlController: 'The caller’s own permissions.',
  StatsController: `${OWN_DATA} An account filter must be the caller’s own.`,
  EndeavourController: `${OWN_DATA} The account must be the caller’s own.`,
  CharacterAdmiraltyController: OWN_CHARACTER_PROGRESS,
  CharacterCommendationController: OWN_CHARACTER_PROGRESS,
  CharacterRdController: OWN_CHARACTER_PROGRESS,
  CharacterReputationController: OWN_CHARACTER_PROGRESS,
  CharacterSpecializationController: OWN_CHARACTER_PROGRESS,
  StorytimeCreatorArcsController: STORYTIME_CREATOR,
  StorytimeArcCollaboratorsController: STORYTIME_CREATOR,
  StorytimeArcMembershipsController: STORYTIME_CREATOR,
  StorytimeTagsController: STORYTIME_CREATOR,
  StorytimeContentPreviewController:
    'Renders the caller’s own draft Markdown; stores and reads nothing.',
  'StorytimeModerationController.appeal': APPEALS,
  'StorytimeModerationController.findMyAppeals': APPEALS,
  'StorytimeModerationController.withdrawAppeal': APPEALS,
  'AuthController.revoke': 'Revokes the caller’s own sessions.',
  StorytimeReadingListsController: STORYTIME_READER,
  StorytimeProgressController: STORYTIME_READER,
  StorytimeFollowsController: STORYTIME_READER,
  StorytimeCommentsController: STORYTIME_READER,
  StorytimeReactionsController: STORYTIME_READER,
  'PublicStorytimeArcsController.findProgress': STORYTIME_READER,
  CustomTrackingPolicyController: CUSTOM_TRACKING,
  CustomTrackingSectionsController: CUSTOM_TRACKING,
  CustomTrackingTabsController: CUSTOM_TRACKING,
  CustomTrackingFieldsController: CUSTOM_TRACKING,
  CustomTrackingOptionsController: CUSTOM_TRACKING,
  CustomTrackingValuesController: CUSTOM_TRACKING,
  CustomTrackingImagesController: CUSTOM_TRACKING,
  CommunityController: FRIENDS,
  ModerationController:
    'Reporting a member to the site’s administrators; changes nothing until ' +
    'one decides it (FC-036).',
  NotificationController: NOTIFICATIONS,
  ChatController: CHAT,
  ChatSafetyController: `${CHAT} A transcript is the requester’s alone and expires (FC-033).`,
  AssetStatusController:
    'An upload’s scan status, answered only to the person who uploaded it.',
  CommunityGovernanceController:
    `${GOVERNANCE_READ} Accepting or declining an ownership offer is the ` +
    'offeree’s alone.',
  FleetGovernanceController: GOVERNANCE_READ,
  ArmadaGovernanceController: GOVERNANCE_READ,
  FleetCommunitiesController:
    'Registering a Community, and the caller’s own follows; following ' +
    'grants nothing (FC-015).',
  FleetRecruitmentController:
    'Applying, joining and leaving as oneself; the service applies the ' +
    'Fleet’s recruitment rules and the caller’s Character ownership.',
  MyFleetRecruitmentController: OWN_FLEET_STANDING,
  CharacterFleetsController: OWN_FLEET_STANDING,
  PersonalActivityController: OWN_DATA,
  PersonalEventsController: OWN_DATA,
  UnregisteredFleetsController:
    'Confirms an unregistered Fleet record; anybody signed in may, and it ' +
    'grants nothing (FC-016).',
  FleetImagesController:
    'An unregistered Fleet’s artwork: an empty slot is anybody’s to fill, a ' +
    'filled one only its uploader’s or a site admin’s. The class-level ' +
    'ScopeCapabilityGuard asks nothing of these four.',
};

const PUBLIC_READ =
  'Public reading: the service shows only what the item’s own audience ' +
  'allows the caller, signed in or not, and hides the rest as not found.';
const STORYTIME_PUBLIC =
  'Published Storytime only; drafts and removed work read as not found.';
const REFERENCE =
  'Configuration or reference data with nothing personal in it.';

/**
 * Routes anybody reaches, signed in or not. A route that changes anything
 * must be named on its own, never by its controller.
 */
const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  AppController: 'The API’s own greeting and version.',
  HealthController: 'Liveness and readiness, for Render.',
  AppStateController: REFERENCE,
  CustomTrackingConfigurationController: REFERENCE,
  FleetConfigurationController: REFERENCE,
  StorytimeConfigurationController: REFERENCE,
  LauncherController: REFERENCE,
  PlatformController: REFERENCE,
  PlatformLauncherController: REFERENCE,
  NewsController:
    'The site’s own news: published posts with no Community only (FC-027).',
  'NotificationController.findActiveBanners': 'Site-wide banners.',
  FleetDirectoryController: `${PUBLIC_READ} Private Communities and their Fleets are left out.`,
  FleetCommunitiesController: PUBLIC_READ,
  CommunityFleetsController: PUBLIC_READ,
  CommunityArmadasController: PUBLIC_READ,
  FleetScopeResolutionController: PUBLIC_READ,
  ArmadaTopologyController: PUBLIC_READ,
  FleetHoldingsController: PUBLIC_READ,
  FleetRecruitmentController: PUBLIC_READ,
  FleetReportsController:
    'FleetReportAccessService: the full view for those the Fleet allows, ' +
    'aggregates with small counts suppressed for the rest, and a hidden ' +
    'report reads as not found (FC-022).',
  FileAssetDeliveryController:
    'Serves an asset only to the audience it was published for, and ' +
    'nothing not AVAILABLE (FC-008).',
  RegistryController:
    'Public profiles, as each owner’s privacy settings allow.',
  PublicStorytimeArcsController: STORYTIME_PUBLIC,
  PublicStorytimeStoriesController: STORYTIME_PUBLIC,
  PublicStorytimeChaptersController: STORYTIME_PUBLIC,
  PublicStorytimeCharactersController: STORYTIME_PUBLIC,
  PublicStorytimeCrewController: STORYTIME_PUBLIC,
  PublicStorytimeMediaController: STORYTIME_PUBLIC,
  PublicStorytimeCreatorsController: STORYTIME_PUBLIC,
  PublicStorytimeReadingListsController:
    'Reading lists their owners made public.',
  PublicStorytimeSearchController: STORYTIME_PUBLIC,
  PublicStorytimeSpotlightController: STORYTIME_PUBLIC,
  StorytimeTagsController: REFERENCE,
  StorytimeCommentsController:
    'Visible comments on published work; hidden ones read as absent.',
  StorytimeReactionsController: 'Counts of reactions on published work.',
  'AuthController.login': 'Signing in.',
  'AuthController.register': 'Registering.',
  'AuthController.refresh': 'Refreshing with the refresh cookie it checks.',
  'AuthController.logout': 'Signing out the session the cookie names.',
  'AuthController.requestPasswordReset':
    'Answers the same whether or not the address exists.',
  'AuthController.resetPassword': 'Needs the single-use token emailed.',
  'AuthController.resendVerificationEmail':
    'Answers the same whether or not the address exists.',
  'AuthController.verifyEmail': 'Needs the single-use token emailed.',
  ContactController: 'The contact form; rate limited.',
  SesWebhookController:
    'Amazon SNS notifications; each message’s signature is verified.',
};

const SRC = join(__dirname, '..', 'src');

/**
 * Lists every controller source file under a directory.
 *
 * @param directory - Where to start.
 * @returns The files.
 */
function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return controllerFiles(path);
    }

    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      readFileSync(path, 'utf8').includes('@Controller(')
      ? [path]
      : [];
  });
}

/**
 * Names a guard. `AuthGuard('jwt')` is a class with a generated name; it is
 * memoised, so it is recognised by identity.
 *
 * @param guard - The guard, a class or an instance.
 * @returns Its name.
 */
function guardName(guard: unknown): string {
  if (guard === AuthGuard('jwt')) {
    return 'AuthGuard(jwt)';
  }

  return typeof guard === 'function'
    ? guard.name
    : (guard as { constructor: { name: string } }).constructor.name;
}

/**
 * Says whether a route declares a guard's requirement.
 *
 * @param requirement - What the route declared, if anything.
 * @returns True when there is something to check.
 */
function declared(requirement: unknown): boolean {
  return Array.isArray(requirement)
    ? requirement.length > 0
    : requirement !== undefined && requirement !== null;
}

/**
 * Finds the reason a route is allowed to be as open as it is.
 *
 * @param list - The allowlist.
 * @param route - The route.
 * @returns The entry's key, or undefined.
 */
function entryFor(
  list: Readonly<Record<string, string>>,
  route: Route,
): string | undefined {
  return [route.key, route.controller].find(key => key in list);
}

let routes: Route[] = [];
/** Routes that carry a guard whose requirement they never declared. */
let inert: string[] = [];

beforeAll(async () => {
  routes = [];
  inert = [];

  for (const file of controllerFiles(SRC)) {
    const exported = (await import(file)) as Record<string, unknown>;

    for (const value of Object.values(exported)) {
      if (
        typeof value !== 'function' ||
        Reflect.getMetadata(PATH_METADATA, value) === undefined
      ) {
        continue;
      }

      const controller = value as { name: string; prototype: object };
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ??
        []) as unknown[];
      const base = String(Reflect.getMetadata(PATH_METADATA, controller));

      for (const handler of Object.getOwnPropertyNames(controller.prototype)) {
        const method = (controller.prototype as Record<string, unknown>)[
          handler
        ];

        if (
          typeof method !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, method) === undefined
        ) {
          continue;
        }

        const key = `${controller.name}.${handler}`;
        const guards = [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, method) ??
            []) as unknown[]),
        ].map(guardName);
        const read = (metadata: string): unknown =>
          Reflect.getMetadata(metadata, method) ??
          Reflect.getMetadata(metadata, controller);
        const enforced = Object.entries(REQUIREMENT_GUARDS)
          .filter(([guard]) => guards.includes(guard))
          .filter(([, metadata]) => declared(read(metadata)))
          .map(([guard]) => guard);

        for (const guard of Object.keys(REQUIREMENT_GUARDS)) {
          if (guards.includes(guard) && !enforced.includes(guard)) {
            inert.push(`${key} (${guard})`);
          }
        }

        let protection: Protection;

        if (enforced.includes('ScopeCapabilityGuard')) {
          protection = 'SCOPED';
        } else if (enforced.includes('RolesGuard')) {
          protection = 'ROLE';
        } else if (enforced.includes('PermissionsGuard')) {
          protection = 'PERMISSION';
        } else if (guards.some(guard => SIGNED_IN_GUARDS.includes(guard))) {
          protection = 'SIGNED_IN';
        } else {
          protection = 'PUBLIC';
        }

        routes.push({
          key,
          controller: controller.name,
          verb: VERBS[Reflect.getMetadata(METHOD_METADATA, method) as number],
          path: `/${base}/${String(Reflect.getMetadata(PATH_METADATA, method))}`
            .replace(/\/+/g, '/')
            .replace(/(.)\/$/, '$1'),
          guards,
          protection,
          scope: read(REQUIRES_SCOPE_CAPABILITY_KEY) as
            ScopeCapabilityRequirement | undefined,
        });
      }
    }
  }
}, 180_000);

/**
 * Every backend route declares who may call it (FC-043, plan §11.5).
 *
 * There is no global guard, so a route is open unless its controller says
 * otherwise, and a guard that checks a declared requirement lets everything
 * through when the requirement is missing. This walks every controller Nest
 * would serve and holds each route to one of three things: a requirement a
 * guard checks; a place on the signed-in list, saying what the handler
 * relies on instead; or a place on the public list, saying why anybody may.
 * A route added without one of them fails here.
 */
describe('route inventory (FC-043)', () => {
  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(500);
    expect(new Set(routes.map(route => route.key)).size).toBe(routes.length);
  });

  it('gives every signed-in-only route a reason', () => {
    expect(
      routes
        .filter(route => route.protection === 'SIGNED_IN')
        .filter(route => entryFor(SIGNED_IN_ROUTES, route) === undefined)
        .map(route => `${route.key} ${route.verb} ${route.path}`),
    ).toEqual([]);
  });

  it('gives every public route a reason', () => {
    expect(
      routes
        .filter(route => route.protection === 'PUBLIC')
        .filter(route => entryFor(PUBLIC_ROUTES, route) === undefined)
        .map(route => `${route.key} ${route.verb} ${route.path}`),
    ).toEqual([]);
  });

  // A public route that changes something is a decision about that route,
  // never a consequence of which controller it was written in.
  it('names every public route that changes anything on its own', () => {
    expect(
      routes
        .filter(route => route.protection === 'PUBLIC' && route.verb !== 'GET')
        .filter(route => !(route.key in PUBLIC_ROUTES))
        .filter(
          route =>
            !['ContactController', 'SesWebhookController'].includes(
              route.controller,
            ),
        )
        .map(route => route.key),
    ).toEqual([]);
  });

  it('carries no reason that no longer matches a route', () => {
    const used = (
      list: Readonly<Record<string, string>>,
      protection: Protection,
    ): string[] =>
      Object.keys(list).filter(
        key =>
          !routes.some(
            route =>
              route.protection === protection &&
              (route.key === key || route.controller === key),
          ),
      );

    expect(used(SIGNED_IN_ROUTES, 'SIGNED_IN')).toEqual([]);
    expect(used(PUBLIC_ROUTES, 'PUBLIC')).toEqual([]);
  });

  // A guard with nothing declared lets everything through; only the routes
  // whose reasons say so may carry one.
  it('allows a guard with nothing to check only where its reason says so', () => {
    expect(
      inert.filter(entry => {
        const key = entry.split(' ')[0];
        const reason =
          SIGNED_IN_ROUTES[key] ?? SIGNED_IN_ROUTES[key.split('.')[0]];

        return (
          reason === undefined ||
          !reason.includes(entry.split('(')[1].replace(')', ''))
        );
      }),
    ).toEqual([]);
  });

  // The guard refuses a route whose declared parameter is not in its path,
  // but only when it is called; this catches the typo before then.
  it('finds every declared scope parameter in its route’s path', () => {
    expect(
      routes
        .filter(route => route.scope !== undefined)
        .flatMap(route =>
          [route.scope!.source.param, route.scope!.source.communityParam]
            .filter((param): param is string => param !== undefined)
            .filter(param => !route.path.split('/').includes(`:${param}`))
            .map(param => `${route.key} :${param} ${route.path}`),
        ),
    ).toEqual([]);
  });

  // A Fleet or Armada under a Community's path is only checked against
  // that Community when the route names it; otherwise the Community segment
  // is decorative, which is the shape of most cross-tenant bugs (FC-005).
  it('ties every nested Fleet or Armada to the Community in its path', () => {
    expect(
      routes
        .filter(route => route.scope !== undefined)
        .filter(route => route.scope!.source.kind !== FleetScopeKind.COMMUNITY)
        .filter(route => route.path.includes('/:communityId/'))
        .filter(route => route.scope!.source.communityParam !== 'communityId')
        .map(route => `${route.key} ${route.path}`),
    ).toEqual([]);
  });

  it('signs in everyone a guard checks a requirement for', () => {
    expect(
      routes
        .filter(route =>
          ['SCOPED', 'ROLE', 'PERMISSION'].includes(route.protection),
        )
        .filter(
          route =>
            !route.guards.some(guard => SIGNED_IN_GUARDS.includes(guard)),
        )
        .map(route => route.key),
    ).toEqual([]);
  });

  // Plan R10 and §11.5 (FC-043): a roster's public comments, handles and
  // Last Active are for the Fleet's approved members, and the reports only
  // ever aggregate them. Rows carrying them are served by RosterController
  // alone, and only behind the roster capabilities no follower holds.
  it('serves roster rows only behind the roster capabilities', () => {
    const allowed: readonly string[] = [
      FLEET_CAPABILITIES.ROSTER_VIEW,
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE_READ,
    ];
    const roster = routes.filter(
      route => route.controller === 'RosterController',
    );

    expect(roster.length).toBeGreaterThan(0);
    expect(
      roster
        .filter(
          route =>
            route.protection !== 'SCOPED' ||
            !([] as string[])
              .concat(route.scope!.capability as string | string[])
              .every(capability => allowed.includes(capability)),
        )
        .map(route => route.key),
    ).toEqual([]);
    expect(
      controllerFiles(SRC)
        .filter(file => !file.endsWith('roster.controller.ts'))
        .filter(file =>
          /\bRoster(Page|Row|Change|Interval)Dto\b/.test(
            readFileSync(file, 'utf8'),
          ),
        ),
    ).toEqual([]);
  });
});
