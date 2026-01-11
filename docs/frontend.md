# Frontend Documentation (Angular)

## Authentication Flow

### Login Process

1. User submits credentials via login form
2. Frontend sends POST request to `/auth/login` endpoint
3. Backend validates credentials and returns JWT token
4. Frontend stores token (typically in memory or session storage, **not** localStorage for security)
5. Token is included in `Authorization: Bearer <token>` header for all subsequent API requests

### JWT Token Handling

**Storage:**

- Store token in memory for better security (prevents XSS theft)
- Alternative: httpOnly cookie (requires backend changes)
- Avoid localStorage (vulnerable to XSS attacks)

> TODO: Document the chosen access/refresh token storage strategy for this app (and any CSRF considerations if using cookies).

**Injection:**

- Use HTTP interceptor to automatically add `Authorization` header
- Interceptor should check if token exists before adding header

**Expiry Handling:**

- Monitor token expiry time
- Implement token refresh flow or forced logout before expiry
- Handle 401 responses by redirecting to login

> TODO: Document the refresh-token flow used by the frontend (if implemented) and the expected behaviour on 401/refresh failure.

### Session Expiry and Auto-Logout

**Inactivity Timer:**

- Frontend tracks user inactivity
- When timer reaches zero, user is automatically logged out
- Timer is reset on user interaction (clicks, keyboard events)

**Session Expired Page:**

- User is redirected to a session expired page
- All open Material Dialogs are closed on logout
- User must re-authenticate to continue

**Implementation:**

- Service monitors activity (e.g., `AuthService` or `SessionService`)
- Guards prevent access to protected routes when session expired
- Cleanup on logout: clear token, close dialogs, reset state

## Environment Configuration

### Environment Files

- `environment.ts`: Development configuration
- `environment.prod.ts`: Production configuration
- Other environments as needed (e.g., `environment.staging.ts`)

**Key Configuration:**

- `apiUrl`: Backend API base URL
- `production`: Boolean flag for production mode
- `cloudflareImagesBaseUrl`: Base URL for Cloudflare Images CDN
- Any feature flags or API keys

> TODO: Fill in the real `apiUrl` and `cloudflareImagesBaseUrl` values used in each environment (dev/prod/staging).

### Environment-Specific Behaviour

- API endpoints may differ between dev and prod
- Logging verbosity may be reduced in production
- Analytics or monitoring may only run in production

## Image Handling

### User Profile Images

**Display Logic:**

1. Check if user has a Cloudflare Image ID
2. If yes, construct Cloudflare Images URL using account hash and image ID
3. If no, check for R2 public URL
4. If neither, display default placeholder image

**Cloudflare Images URL Format:**

```
<CLOUDFLARE_CDN_ROOT_URL>/cdn-cgi/imagedelivery/<CLOUDFLARE_IMAGES_HASH>/<IMAGE_ID>/public
```

### Character Images

**Display Logic:**

Character images now use the same logic as user profile images:

1. Check for Cloudflare Image ID
2. Construct Cloudflare Images URL if ID exists
3. Fall back to R2 public URL if available
4. Display default placeholder if no image

**Standardisation:**

- Both user and character images use Cloudflare Images
- Consistent URL construction across the application
- Unified image component or service recommended

### Image Upload Workflow

**User Profile Image Upload:**

1. User selects image file via file input
2. Frontend validates file (type, size) before upload
3. Image may be cropped using image cropper component
4. Cropped blob sent to backend `/user/update-profile-pic` endpoint
5. Backend uploads to Cloudflare Images and returns image ID
6. Frontend updates user object with new image ID
7. UI displays new image from Cloudflare CDN

**Character Image Upload:**

Similar flow to profile images, using `/character/:id/profile-image` endpoint.

> TODO: Confirm whether the frontend should call these endpoints directly or via a dedicated upload service (and document required auth headers/interceptor behaviour).

### File Upload Validation (Frontend)

**Allowed MIME Types:**

- `image/png`
- `image/jpg`
- `image/jpeg`

**File Size Limit:**

- Controlled by the backend setting `MAX_IMAGE_SIZE_IN_BYTES` (defaults to 10 MB)
- Validate before upload to provide immediate feedback
- Backend also validates (defence in depth)

**Validation Implementation:**

- Check `file.type` against allowed MIME types
- Check `file.size` against maximum bytes
- Display error message if validation fails

### Image Cropper Component

**CharacterPicComponent:**

- Allows users to crop images before upload
- Uses image cropper library (check `package.json` for exact package)

> TODO: Document the exact image cropper package/version in use and any cropping presets/aspect ratios.

- Outputs cropped image as blob for upload
- Validates file type and size before and after cropping

## Material Dialog Management

### Dialog Strategy

**Opening Dialogs:**

- Use `MatDialog.open()` to create dialog instances
- Store reference to `MatDialogRef` if you need to close programmatically

**Closing Dialogs:**

- User can close via UI (close button, backdrop click, escape key)
- Application can close programmatically via `dialogRef.close()`

### Dialog Cleanup on Logout

**Critical Implementation:**

When user logs out or session expires, **all open dialogs must be closed**.

**Implementation:**

```typescript
// In logout method or session expiry handler:
this.dialog.closeAll();
```

**Why This Matters:**

- Prevents dialogs from remaining open after logout
- Ensures clean state when navigating to login page
- Avoids errors from components with stale authentication context

## Custom Guards

### AuthGuard

- Checks if user is authenticated (has valid token)
- Redirects to login page if not authenticated
- Applied to all protected routes

### RoleGuard

- Checks if authenticated user has required role(s)
- Returns 403 Forbidden or redirects if user lacks permissions
- Used for admin-only or restricted routes

## Browser-Specific Workarounds

### Font Rendering (Firefox vs. Chrome)

**Issue:**

Condensed fonts may render differently between Firefox and Chrome, affecting line height and letter spacing.

**Solution:**

- Browser-specific CSS using `@-moz-document` or CSS feature detection
- May need different font weights or fallbacks
- Test fonts in both browsers before finalising design

**Current Workarounds:**

Check `styles.css` or component stylesheets for browser-specific rules.

## NPM Scripts

### Development

- `npm start`: Start development server (usually `ng serve`)
- `npm run build`: Build for production
- `npm run build:dev`: Build with development configuration
- `npm run watch`: Build and watch for changes

### Testing

- `npm test`: Run unit tests (Jest)
- `npm run test:watch`: Run tests in watch mode
- `npm run test:cov`: Generate test coverage report
- `npm run test:mutation`: Run Stryker mutation tests
- `npm run test:mutation:dry`: Dry run mutation tests

### Code Quality

- `npm run lint`: Run ESLint
- `npm run format`: Format code with Prettier

### Angular CLI

- `ng generate component <name>`: Generate new component
- `ng generate service <name>`: Generate new service
- `ng generate guard <name>`: Generate new guard

## Testing Strategy

### Unit Tests (Jest)

- All components, services, guards, and pipes should have corresponding `.spec.ts` files
- Tests run in isolation using mocks and stubs
- Aim for high code coverage (check coverage report for current %)

### Mocking Strategies

**Logger Mocking:**

- Mock `Logger` in tests to suppress console output during test runs
- Prevents error messages from cluttering test output
- Example: Mock `Logger.error()` to do nothing in tests that intentionally trigger errors

**Service Mocking:**

- Mock HTTP calls using `HttpClientTestingModule`
- Mock `MatDialog` using `MatDialogMock` or jasmine spies
- Mock `Router` for navigation testing

### Mutation Testing (Stryker)

- Stryker introduces mutations (small code changes) to verify test quality
- High mutation score indicates strong tests that catch bugs
- Run `npm run test:mutation` to execute mutation tests
- Review HTML report for detailed results

### Coverage Requirements

Document target coverage percentage here (e.g., 80% line coverage).
