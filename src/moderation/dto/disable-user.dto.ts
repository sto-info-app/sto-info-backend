import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

/**
 * Disables a member's account.
 *
 * The reason is required (FC-039): it is the only record of why an account
 * was locked, the next administrator to look has nothing else to go on, and
 * the site admin log keeps it. Internal to the admin section — never shown
 * to the user.
 */
export class DisableUserDto extends AdminReasonDto {}
