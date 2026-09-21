import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import {
  ALL_FLEET_CAPABILITIES,
  FLEET_CAPABILITIES,
  FleetCapability,
} from './fleet-capability.constants';

/**
 * What an approved member may do purely by being approved.
 *
 * Plan section 4.3: "private own-Fleet roster/handles/comments/Last Active,
 * eligible content/chat, RSVP and reporting. No source download, import
 * investigation or role grants by default." Everything beyond this list has to
 * come from a role or an explicit delegation.
 *
 * This baseline attaches to the **approved membership**, not to the `MEMBER`
 * role label, so somebody with an approved membership and no role row is still
 * an ordinary member. The label exists for the delegation surface to name.
 */
const MEMBER_CAPABILITIES: readonly FleetCapability[] = [
  FLEET_CAPABILITIES.ROSTER_VIEW,
  FLEET_CAPABILITIES.MEMBERS_VIEW,
  FLEET_CAPABILITIES.EVENTS_RSVP,
  FLEET_CAPABILITIES.CHAT_POST,
  FLEET_CAPABILITIES.CONTENT_REPORT,
];

/**
 * What an Admin may do.
 *
 * Plan section 4.3: "manage recruitment/applications, content/events,
 * imports/exclusions, manual holdings, scoped moderation and configured
 * transcript export. Ownership transfer/closure remains Owner or app-admin
 * dispute action."
 *
 * Settings and role management are absent deliberately. The Owner bullet lists
 * them alongside transfer and closure as the things ownership *is*; an Admin
 * who could grant roles could grant themselves Owner, which would make the two
 * labels the same label.
 */
const ADMIN_CAPABILITIES: readonly FleetCapability[] = [
  ...MEMBER_CAPABILITIES,
  FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
  // Artwork sits with news and events rather than with settings. All three
  // are the scope's public face, which an Admin is trusted with; the name,
  // the visibility and the description are what ownership is.
  FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
  FLEET_CAPABILITIES.MEMBERS_MANAGE,
  FLEET_CAPABILITIES.APPLICATIONS_VIEW,
  FLEET_CAPABILITIES.APPLICATIONS_DECIDE,
  FLEET_CAPABILITIES.RECRUITMENT_MANAGE,
  FLEET_CAPABILITIES.ROSTER_IMPORT,
  FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
  FLEET_CAPABILITIES.ROSTER_SOURCE_DOWNLOAD,
  FLEET_CAPABILITIES.REPORTS_VIEW,
  FLEET_CAPABILITIES.NEWS_WRITE,
  FLEET_CAPABILITIES.EVENTS_MANAGE,
  FLEET_CAPABILITIES.HOLDINGS_WRITE,
  FLEET_CAPABILITIES.CHAT_MODERATE,
  FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
  FLEET_CAPABILITIES.ARMADA_MANAGE,
];

/**
 * The capabilities each fixed role label confers before any delegation.
 *
 * `OFFICER` is **empty, and that is the whole point of the label**. Plan
 * section 4.3 requires Officer abilities to be "explicitly delegated" with
 * "sensitive powers default absent", and least privilege is only real if the
 * default is nothing rather than a short list somebody later argues about. An
 * Officer who is also an approved member still gets the member baseline, so in
 * practice a freshly appointed Officer can read the roster and talk — and can
 * do nothing administrative until an Owner says which thing.
 *
 * This is also what makes FC-005's third acceptance criterion testable: if the
 * Officer baseline were non-empty, "Officer capabilities are delegated" would
 * be a claim about intent rather than a property of the data.
 */
export const ROLE_BASELINE_CAPABILITIES: Readonly<
  Record<FleetScopeRole, readonly FleetCapability[]>
> = {
  [FleetScopeRole.OWNER]: ALL_FLEET_CAPABILITIES,
  [FleetScopeRole.ADMIN]: ADMIN_CAPABILITIES,
  [FleetScopeRole.OFFICER]: [],
  [FleetScopeRole.MEMBER]: MEMBER_CAPABILITIES,
};

/**
 * The capabilities an approved membership confers on its own.
 *
 * Exported separately from the `MEMBER` baseline it happens to equal, because
 * the two answer different questions and may diverge: this one is "what does
 * approval get you", the other is "what does the label mean".
 */
export const APPROVED_MEMBERSHIP_CAPABILITIES: readonly FleetCapability[] =
  MEMBER_CAPABILITIES;
