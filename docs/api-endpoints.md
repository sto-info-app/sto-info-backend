# API Endpoints Reference

This document lists the HTTP endpoints exposed by the STO Info backend application.

## Conventions

- Base URL is environment-specific (for example, `http://localhost:3000`).
- Authenticated endpoints require `Authorization: Bearer <access_token>`.
- Token payload fields use snake_case (for example, `access_token`).

## Domains

A list of domains can be found in the [Infrastructure](infrastructure.md) documentation.

## Core Endpoints

### GET /

Returns a greeting string including the current environment name.

**No Authentication Required**

### GET /version

Returns the current API app version.

**No Authentication Required**

## Authentication Endpoints

These endpoints are under `/auth/*`.

### POST /auth/register

Register a new user account and send an email verification token.

**Request:**

```json
{
  "firstName": "Jean-Luc",
  "lastName": "Picard",
  "username": "captain.picard",
  "email": "captain.picard@starfleet.example",
  "password": "CorrectHorseBatteryStaple",
  "confirmPassword": "CorrectHorseBatteryStaple"
}
```

**Response:** `200 OK` (shape is implementation-defined)

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/login

Authenticate a user and return an access token plus refresh token.

**Request:**

```json
{
  "email": "captain.picard@starfleet.example",
  "password": "CorrectHorseBatteryStaple"
}
```

**Response:**

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 3600,
  "user_id": "67f8ce9a-283c-4aaa-8e47-e7b8b2c0d217"
}
```

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/refresh

Exchange a refresh token for a new access token and a new refresh token.

**Request:**

```json
{
  "refresh_token": "<jwt>"
}
```

**Response:**

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 3600
}
```

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/logout

Revoke a supplied refresh token.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**

```json
{
  "tokenId": "<refresh_token>"
}
```

**Response:** `200 OK` (no body)

### POST /auth/revoke

Revoke the refresh token associated with the current authenticated context.

**Headers:** `Authorization: Bearer <access_token>`

**Response:** `200 OK` (no body)

### POST /auth/verify-email

Verify an email address using a verification token.

**Request:**

```json
{
  "token": "<64-hex-token>"
}
```

**Response:** `200 OK` (shape is implementation-defined)

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/resend-verification-email

Resend a verification email (generates a new token if still unverified).

**Request:**

```json
{
  "token": "<64-hex-token>"
}
```

**Response:** `200 OK` (shape is implementation-defined)

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/request-password-reset

Request a password reset email.

**Request:**

```json
{
  "email": "captain.picard@starfleet.example"
}
```

**Response:** `200 OK` (no body)

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

### POST /auth/reset-password

Reset a password using a password reset token.

**Request:**

```json
{
  "token": "<64-hex-token>",
  "password": "EvenMoreSecurePassword123"
}
```

**Response:** `200 OK` (no body)

**Rate Limit:** Authentication endpoints are limited to 20 requests per 15 minutes

## Access Control Endpoints

### GET /access-control/me

List the permission codes the calling user currently holds, alphabetically ordered.

**Headers:** `Authorization: Bearer <access_token>`

Intended for client presentation only — every capability reported is independently enforced on the endpoint that performs the action.

### Administration

All routes below are under `/admin/access-control/*` and require the `ADMIN` role.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/access-control/permissions` | List every permission the application recognises |
| GET | `/admin/access-control/users/:userId` | A user's effective permissions and active overrides |
| POST | `/admin/access-control/users/:userId/permission-overrides` | Grant or withhold a permission for a user |
| DELETE | `/admin/access-control/users/:userId/permission-overrides/:permissionCode` | Withdraw a permission override |
| GET | `/admin/access-control/users/:userId/limit-overrides` | A user's limit exemptions |
| POST | `/admin/access-control/users/:userId/limit-overrides` | Allow a user to exceed a configured limit |
| DELETE | `/admin/access-control/users/:userId/limit-overrides/:limitKey` | Withdraw a limit exemption |

Applying the same permission code or limit key twice updates the existing override rather than creating a second, so the write endpoints are safe to repeat. Withdrawal soft-deletes, leaving the pair free to be granted again.

## Storytime Endpoints

### GET /storytime/configuration

The Storytime client configuration: which parts of the feature are switched on, the languages a creator may choose, and the content ratings a Story may carry.

Unauthenticated, and deliberately still answers while Storytime is switched off — it is how the client learns to hide the feature.

Served rather than duplicated in the frontend so the language list, ratings and switches cannot drift between the two.

### Stories

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/storytime/stories` | List published, public Stories (paginated, filterable) |
| GET | `/storytime/stories/:slug` | Retrieve a published Story |
| GET | `/storytime/manage/stories` | List the Stories you own |
| GET | `/storytime/manage/stories/:storyId` | Retrieve a Story you own |
| POST | `/storytime/manage/stories` | Create a Story |
| PATCH | `/storytime/manage/stories/:storyId` | Update a Story you own |
| POST | `/storytime/manage/stories/:storyId/publish` | Publish |
| POST | `/storytime/manage/stories/:storyId/unpublish` | Withdraw from publication |
| POST | `/storytime/manage/stories/:storyId/archive` | Archive |
| POST | `/storytime/manage/stories/:storyId/content-policy` | Accept the publishing terms for this Story |
| POST | `/storytime/manage/stories/reorder` | Reorder your Stories |
| DELETE | `/storytime/manage/stories/:storyId` | Soft-delete a Story |

`GET /storytime/stories/:slug` answers **301** when the slug is one the Story used to have, redirecting to its current URL. Links shared before a rename keep working, and search engines consolidate rather than treating the two addresses as duplicates.

**Unlisted** Stories are readable through `:slug` but excluded from the listing — that is the entire difference between unlisted and public.

The `manage` routes require the relevant `storytime.story.*` permission *and* ownership of the Story, checked against the stored row. `PATCH` accepts the `version` the client last saw and answers **409** if it is stale.

#### Publishing terms

A Story cannot be published until its owner has accepted the current Storytime publishing terms — the Content Policy, the Terms of Use and the Fan Content & Intellectual Property Notice, which are accepted together as one act.

`POST .../content-policy` records the acceptance. It is idempotent while the terms are unchanged: accepting an already-current Story returns it untouched, so a creator who clicks twice has not agreed twice.

The Story carries `contentPolicyAcceptedAt`, `contentPolicyVersion` and a derived `contentPolicyCurrent`. Clients decide what to show from `contentPolicyCurrent` rather than comparing versions themselves, because a stale bundle carrying an old version constant would otherwise tell a creator they were ready to publish when the server disagrees.

When the terms are materially revised, `STORYTIME_POLICY_VERSION` is raised. Every Story whose recorded version is lower becomes unpublishable until its owner accepts again, and the publish error says the terms have changed rather than that they were never accepted.

### Chapters

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/storytime/stories/:storySlug/chapters` | List a published Story's readable Chapters |
| GET | `/storytime/stories/:storySlug/chapters/:chapterSlug` | Read a Chapter, with previous/next links |
| GET | `/storytime/manage/stories/:storyId/chapters` | List every Chapter of a Story you own |
| POST | `/storytime/manage/stories/:storyId/chapters` | Create a Chapter |
| GET | `/storytime/manage/chapters/:chapterId` | Retrieve a Chapter for editing |
| PATCH | `/storytime/manage/chapters/:chapterId` | Update a Chapter |
| POST | `/storytime/manage/chapters/:chapterId/publish` | Publish |
| POST | `/storytime/manage/chapters/:chapterId/unpublish` | Withdraw from publication |
| POST | `/storytime/manage/chapters/:chapterId/schedule` | Schedule automatic publication |
| POST | `/storytime/manage/stories/:storyId/chapters/reorder` | Reorder a Story's Chapters |
| DELETE | `/storytime/manage/chapters/:chapterId` | Soft-delete a Chapter |

Public Chapter routes resolve the **Story first** and refuse if it is not publicly readable. That single check is what keeps a published Chapter inside a private Story unreachable.

Previous/next links are built from readable Chapters only, so navigation steps over a draft, a scheduled instalment or one an administrator has removed.

`languageCode` on a Chapter response is the **resolved** language, falling back to the Story's — it is what belongs in a `lang` attribute. The creator-facing shape additionally carries `ownLanguageCode`, the creator's own setting or `null` when the Chapter follows its Story. An editor must bind to `ownLanguageCode`; binding to the resolved value silently pins an inherited language on the next save.

Publishing or unpublishing a Chapter updates its Story's `publishedChapterCount` **in the same transaction**, because that count decides whether the Story itself may be published.

`schedule` takes a UTC instant and must be in the future. A job publishes due Chapters every five minutes, so a Chapter goes out within five minutes of its scheduled time. The job does nothing while Storytime is switched off.

### PATCH /admin/storytime/configuration

Switch Storytime on or off at runtime. `GET` on the same path reports the current state. Both require the `ADMIN` role.

Gated by the role rather than a Storytime permission: those permissions are only meaningful while Storytime is on, so gating the switch behind one would let the control that recovers the feature become unreachable.

## User Endpoints

All user endpoints are under `/user/*` and require authentication.

### GET /user

Get the current user.

**Headers:** `Authorization: Bearer <access_token>`

### POST /user/update-profile

Update the current user's profile.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**

```json
{
  "userId": "67f8ce9a-283c-4aaa-8e47-e7b8b2c0d217",
  "firstName": "Jean-Luc",
  "lastName": "Picard",
  "username": "captain.picard",
  "publiclyVisible": false
}
```

### POST /user/update-profile-pic

Upload a new user profile picture.

**Headers:** `Authorization: Bearer <access_token>`

**Content-Type:** `multipart/form-data`

**Request:**

- `profilePicture`: Image file (PNG/JPG/JPEG only, max size controlled by `MAX_IMAGE_SIZE_IN_BYTES`)

### DELETE /user/close-account

Close the current authenticated user account.

**Headers:** `Authorization: Bearer <access_token>`

**Response:**

```json
{
  "success": true
}
```

**Behavior:**

- Revokes active refresh tokens for the user.
- Marks user-linked records as deleted (soft delete): `user`, `user_profile`, `account`, and `character`.
- Permanent deletion of closed-account data is handled later by the scheduled retention cleanup job.

## STO Reference Data Endpoints

These endpoints return lookup/reference data.

### GET /platform

List all STO platforms.

**No Authentication Required**

### GET /launcher

List all STO launchers.

**No Authentication Required**

### GET /platform-launcher

List platform/launcher mappings.

Response includes optional `backgroundImageUrl` mapping values.
Invalid Cloudflare image URLs are sanitised to `null` before returning.

**No Authentication Required**

## Account Endpoints

All account endpoints are under `/account/*` and require authentication.

### POST /account

Create a new account for the current user.

**Headers:** `Authorization: Bearer <access_token>`

### GET /account

List all accounts for the current user.

Response includes `accountTypeImageUrl`, resolved from `platform_launcher`
mapping rows (exact match -> platform default -> launcher default -> global default).
Returned URL values are verified as valid Cloudflare Images delivery URLs.

**Headers:** `Authorization: Bearer <access_token>`

### GET /account/:id

Get a single account by id.

**Headers:** `Authorization: Bearer <access_token>`

### PUT /account/:id

Update an account by id.

**Headers:** `Authorization: Bearer <access_token>`

### DELETE /account/:id

Soft-delete an account by id.

**Headers:** `Authorization: Bearer <access_token>`

## Character Endpoints

All character endpoints are under `/character/*` and require authentication.

### POST /character

Create a new character under an account owned by the current user.

**Headers:** `Authorization: Bearer <access_token>`

### GET /character?accountId=<uuid>

List all characters for an account owned by the current user.

**Headers:** `Authorization: Bearer <access_token>`

### GET /character/:id

Get a single character by id.

**Headers:** `Authorization: Bearer <access_token>`

### PUT /character/:id

Update a character by id.

**Headers:** `Authorization: Bearer <access_token>`

### DELETE /character/:id

Soft-delete a character by id.

**Headers:** `Authorization: Bearer <access_token>`

### POST /character/:id/profile-image

Upload a character profile image.

**Headers:** `Authorization: Bearer <access_token>`

**Content-Type:** `multipart/form-data`

**Request:**

- `profilePicture`: Image file (PNG/JPG/JPEG only, max size controlled by `MAX_IMAGE_SIZE_IN_BYTES`)

### GET /character/lookup/general-factions

List general factions (e.g. Federation, Klingon).

`iconUrl` fields are validated as Cloudflare Images URLs; invalid values are returned as `null`.

**Query (optional):** `factionId=<uuid>` — when supplied, returns only general factions associated with that specific faction.

### GET /character/lookup/factions

List specific factions (e.g. Starfleet (2409), TOS Starfleet, KDF).

`iconUrl` fields are validated as Cloudflare Images URLs; invalid values are returned as `null`.

**Query (optional):** `generalFactionId=<uuid>` — when supplied, returns only factions associated with that general faction.

### GET /character/lookup/sexes

List sexes.

### GET /character/lookup/classes

List character classes.

### GET /character/lookup/recruit-types

List recruit types.

`iconUrl` fields are validated as Cloudflare Images URLs; invalid values are returned as `null`.

**Query (optional):** `factionId=<uuid>` — when supplied, returns only recruit types available for that faction.

### GET /character/lookup/species

List species.

**Query (optional):** `factionId=<uuid>`, `recruitTypeId=<uuid>`

## Contact Endpoint

### POST /contact

Submit a contact request. Rate-limited to prevent spam.

**No Authentication Required**

**Request:**

```json
{
  "name": "Jean-Luc Picard",
  "email": "captain.picard@starfleet.example",
  "message": "I need assistance."
}
```

**Response:** `200 OK` (no body)

**Rate Limit:** Expensive operations limit (50 requests per 15 minutes)

## Webhook Endpoints

### POST /webhooks/ses

Receives SNS HTTP notifications for SES bounce, complaint, and delivery events.

**No Authentication Required** (secured by `TopicArn` validation against `AWS_SNS_TOPIC_ARN`)

**Content-Type:** `application/json` or `text/plain; charset=UTF-8` (SNS sends both)

**SNS Subscription Confirmation Request:**

```json
{
  "Type": "SubscriptionConfirmation",
  "MessageId": "<uuid>",
  "TopicArn": "arn:aws:sns:eu-west-2:...:sto-info-ses-bounces",
  "SubscribeURL": "https://sns.amazonaws.com/...",
  "Timestamp": "2025-01-01T00:00:00.000Z",
  "SignatureVersion": "1",
  "Signature": "...",
  "SigningCertURL": "https://..."
}
```

The application automatically confirms the subscription by performing an HTTPS GET on `SubscribeURL`.

**SES Notification Request:**

```json
{
  "Type": "Notification",
  "MessageId": "<uuid>",
  "TopicArn": "arn:aws:sns:eu-west-2:...:sto-info-ses-bounces",
  "Message": "{\"notificationType\":\"Bounce\",\"mail\":{...},\"bounce\":{...}}",
  "Timestamp": "2025-01-01T00:00:00.000Z",
  "SignatureVersion": "1",
  "Signature": "...",
  "SigningCertURL": "https://..."
}
```

`Message` is a JSON-encoded string containing the SES event payload.

**Supported `notificationType` values:**

| Type                              | Effect                               |
| --------------------------------- | ------------------------------------ |
| `Bounce` (Permanent)              | Persists event with `suppress=true`  |
| `Bounce` (Transient/Undetermined) | Persists event with `suppress=false` |
| `Complaint`                       | Persists event with `suppress=true`  |
| `Delivery`                        | Persists event with `suppress=false` |

**Response:** `200 OK` (no body — SNS requires a 2xx to avoid retries)

**Security:** Requests with a `TopicArn` that does not match `AWS_SNS_TOPIC_ARN` are rejected with `403 Forbidden`.

**Idempotency:** Duplicate SNS messages (same `MessageId`) are silently skipped.

**Rate Limiting:** This endpoint is excluded from rate limiting (it receives server-to-server calls from AWS).

## Health Check Endpoints

### GET /health/ready

Application readiness check.

**No Authentication Required**

### GET /health/live

Application liveness check.

**No Authentication Required**

## Error Responses

### 400 Bad Request

```json
{
  "statusCode": 400,
  "message": ["Validation error message"],
  "error": "Bad Request"
}
```

### 401 Unauthorised

```json
{
  "statusCode": 401,
  "message": "Unauthorised",
  "error": "Unauthorised"
}
```

### 403 Forbidden

```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}
```

### 413 Payload Too Large

```json
{
  "statusCode": 413,
  "message": "Payload too large. Maximum allowed size is X bytes.",
  "error": "Payload Too Large"
}
```

### 429 Too Many Requests

```json
{
  "status": 429,
  "error": "Too many requests",
  "message": "Too many requests, please try again after X minutes",
  "retryAfter": 900
}
```

**Headers:**

- `Retry-After`: Seconds until rate limit resets

### 500 Internal Server Error

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

## Rate Limiting

### Global Rate Limits

- **Read Operations (GET, HEAD):** 1500 requests per 15 minutes (counts failed requests only)
- **Write Operations (POST, PUT, PATCH, DELETE):** 200 requests per 15 minutes

### Endpoint-Specific Rate Limits

- **Authentication endpoints:** 20 requests per 15 minutes
- **Expensive operations:** 50 requests per 15 minutes

**Excluded Paths:** Requests where the path starts with `/health/` are excluded from rate limiting.

### Rate Limit Headers

All responses include:

- `RateLimit-Limit`: Maximum requests allowed
- `RateLimit-Remaining`: Requests remaining in current window
- `RateLimit-Reset`: Timestamp when limit resets

## Swagger Documentation

Interactive API documentation available at:

- **Development:** `http://localhost:3000/swagger`
- **Development (Render):** `https://dev-api.startrekonline.info/swagger`
- **Production:** Swagger disabled for security
