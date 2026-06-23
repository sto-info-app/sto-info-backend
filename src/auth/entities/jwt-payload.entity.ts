import { UserRole } from 'src/user/enums/user-role.enum';

export interface JwtPayloadInterface {
  sub: string; // User UUID
  email: string;
  role?: UserRole; // Authorization role (advisory for clients; the server re-checks via the DB)
  iat?: number; // Issued at
  exp?: number; // Expiration time
}
