# Frontend Integration Guide (Backend Expectations)

This document describes what any client application (web, mobile, desktop) must do to integrate with the `sto-info-backend` API.

It intentionally does **not** document any specific frontend framework or UI implementation.

## Base URL

- The API base URL is environment-specific.
- Local development default is typically `http://localhost:3000`.
- Swagger UI is available at `/swagger` in non-production environments.

## Authentication

### Access token (JWT)

- Most endpoints require an `Authorization` header:

  `Authorization: Bearer <access_token>`

- When an access token is missing/invalid/expired, the API returns `401 Unauthorized`.

### Login

- Clients authenticate by calling `POST /auth/login` with credentials.
- On success, the API returns an `access_token`, `refresh_token`, and `expires_in`.

Recommended client behaviour:

- Store tokens securely and avoid persisting them where they are easily exfiltrated.
- Include the access token on all authenticated requests.
- Treat `expires_in` as advisory for proactive refresh; always handle `401` as the source of truth.

### Refresh

- Clients call `POST /auth/refresh` to exchange a refresh token for a new access token (and typically a new refresh token).

Recommended client behaviour:

- Attempt refresh once when receiving `401` from an authenticated request.
- If refresh fails (e.g. `401`/`403`), clear session state and require the user to re-authenticate.

### Logout / revoke

- Clients should call `POST /auth/logout` (or other revoke endpoints) to invalidate refresh tokens.
- After logout, clients should clear any stored tokens and cached user state.

## CORS (browser clients)

- CORS is enforced by the backend and configured in `src/main.ts`.
- Only requests from allowed origins will receive the appropriate CORS response headers.

Notes:

- The backend currently authenticates via bearer tokens (Authorization header), not cookies.
- If a browser client ever uses cookie-based authentication in future, it must send requests with credentials enabled and ensure the backend’s allowed origins and credential settings remain correct.

## Rate limiting

The API enforces rate limiting (see `src/main.ts`), including stricter limits for:

- Authentication routes
- Expensive operations (e.g. uploads/searches)

Client expectations:

- Handle `429 Too Many Requests` by respecting the `Retry-After` header.
- Avoid retry storms; apply backoff and jitter.

## Error handling (recommended client behaviour)

- `400 Bad Request`: request validation failed; display field-level errors where possible.
- `401 Unauthorized`: access token missing/expired/invalid; attempt refresh (once) then re-authenticate.
- `403 Forbidden`: authenticated but not permitted; show an access denied UI.
- `413 Payload Too Large`: reduce upload size; show max size guidance.
- `429 Too Many Requests`: respect `Retry-After`.
- `5xx`: treat as transient; show a generic error and allow retry.

## File uploads (images)

### Endpoints

- `POST /user/update-profile-pic` (multipart/form-data)
- `POST /character/:id/profile-image` (multipart/form-data)

### Requirements

- Auth required (`Authorization: Bearer ...`).
- `Content-Type` must be `multipart/form-data`.
- Allowed MIME types:
  - `image/png`
  - `image/jpg`
  - `image/jpeg`
- Maximum upload size is controlled by `MAX_IMAGE_SIZE_IN_BYTES` (defaults to 10 MB).

Client expectations:

- Validate file type and size client-side for fast feedback.
- Still expect server-side validation to reject invalid files.

## Image rendering (Cloudflare Images)

When the backend returns a Cloudflare Images ID for a user/character image, clients should construct an image URL using the configured delivery root and hash.

Format:

`<CLOUDFLARE_CDN_ROOT_URL>/cdn-cgi/imagedelivery/<CLOUDFLARE_IMAGES_HASH>/<IMAGE_ID>/<VARIANT>`

Notes:

- `CLOUDFLARE_CDN_ROOT_URL` and `CLOUDFLARE_IMAGES_HASH` are backend configuration values.
- `VARIANT` is a Cloudflare Images variant name (for example `public`).

If an image ID is not present, clients should fall back to whatever “no image” UX they choose (placeholder avatar, silhouette, etc.).

## API surface area

For the authoritative endpoint list and request/response examples, see:

- [docs/api-endpoints.md](api-endpoints.md)
- Swagger UI at `/swagger` in non-production environments
