import { SetMetadata } from '@nestjs/common';

import { PermissionCode } from './constants/permission-codes.constants';

export const REQUIRES_PERMISSION_KEY = 'requiresPermission';

/**
 * Restricts a route handler (or controller) to users holding every listed
 * permission.
 *
 * Must be combined with the authentication guard so the user is populated on
 * the request, for example
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
 *
 * This is a coarse gate only. It answers "may this kind of user reach this
 * endpoint at all", never "may this user act on this particular Story" —
 * resource-level authorisation stays in the service, because ownership and
 * collaboration cannot be known before the target has been loaded.
 *
 * @param permissions - The permission codes required. All must be held.
 * @returns The metadata decorator.
 */
export const RequiresPermission = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRES_PERMISSION_KEY, permissions);
