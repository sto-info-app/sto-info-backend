export interface JwtPayloadInterface {
  sub: string; // User UUID
  email: string;
  iat?: number; // Issued at
  exp?: number; // Expiration time
}
