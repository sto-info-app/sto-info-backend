import { SetMetadata } from '@nestjs/common';

import { UserRole } from 'src/user/enums/user-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route handler (or controller) to the supplied roles.
 *
 * Must be combined with the authentication guard so that the user is populated
 * on the request, e.g. `@UseGuards(JwtAuthGuard, RolesGuard)`.
 *
 * @param roles - The roles allowed to access the decorated handler.
 * @returns The metadata decorator.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
