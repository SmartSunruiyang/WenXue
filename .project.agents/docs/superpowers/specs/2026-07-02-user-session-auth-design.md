# User Session Auth Refactor Design

## Problem

The current M4.5 auth chain uses locally generated `wxm_` machine tokens, manual token display/copy/sync, `machine_accounts`, `machineId`, and `tokenHash` for LLM gateway authorization. This conflicts with the next product direction: WenXue desktop should be an account-based launcher, the extension should receive and refresh a user session automatically, and gateway/admin/tokens should all be user scoped.

## Scope

- Remove product and runtime dependence on generated machine tokens.
- Add desktop username/password login and registration with CloudBase Auth.
- Gate the desktop workbench and browser launch behind a real CloudBase session.
- Handoff user session data to the extension through the existing one-shot localhost + Chrome external messaging mechanism.
- Store and refresh the session in the extension so built-in model calls use `Authorization: Bearer <CloudBase accessToken>`.
- Change the LLM gateway to read the CloudBase Auth user profile for every protected request, require native `status=ACTIVE`, and write `token_usage.uid` as the CloudBase user id.
- Change admin API/console and desktop token usage summary from machine scope to user scope.

## Non-Goals

- Subscription billing, quotas, payments, or per-plan entitlements.
- End-user email/phone/OTP flows.
- Admin-created end-user registration workflows beyond CloudBase Auth `ACTIVE/BLOCKED` status management.
- Persisting prompts, completions, API keys, bearer tokens, or refresh tokens in logs.
- CloudBase console/MCP configuration changes in this code task; CloudBase username/password provider and publishable key remain deployment prerequisites.

## Requirements

### R1 Desktop Account Entry

User story: as a WenXue user, I sign in with a user id and password before reaching the launcher workbench.

Acceptance criteria:

- When no real CloudBase session exists, the desktop app shall show an independent login page and a register page instead of the main workbench.
- When the user registers, the desktop app shall use the gateway-backed CloudBase Auth username/password registration path without SMS, email OTP, or captcha.
- Before login or registration sends a request, the desktop app shall require a 5–24 character username matching `^[A-Za-z][A-Za-z0-9]*$` and a password longer than eight characters (at least nine characters).
- The password shall also satisfy the CloudBase `CreateUser` boundary: at most 32 characters, start with a letter or digit, contain only ASCII letters/digits or `()!@#$%^&*|?><_-`, and include at least three of lowercase letters, uppercase letters, digits, and allowed special characters.
- When credentials are invalid, the desktop app shall keep the form interactive, shall not enter the busy state, and shall explain the exact correction in Chinese.
- Because CloudBase Web Auth does not support username/password-only public sign-up, registration identity creation shall call the gateway `/v1/auth/register`; the gateway shall use Tencent Cloud TCB `CreateUser(UserStatus=ACTIVE)` and shall not depend on that API returning a uid.
- After registration returns either success or duplicate, the desktop shall use `auth.signInWithPassword` to prove knowledge of the password, then call `/v1/auth/activate` with the resulting access token and no password in the body. The gateway shall call `/auth/v1/user/me`, obtain the real uid, and require exact `status=ACTIVE`; activation is a compatibility readiness check and shall not write an account row.
- The activation user-profile request shall have a 10-second deadline. A missing or invalid token shall return 401, `BLOCKED` or any other non-ACTIVE status shall return 403, and failures shall not reflect the token, upstream body, or credentials.
- When the user signs in, the desktop app shall call CloudBase Auth username/password login and sync `{ userId, accessToken, refreshToken, expiresAt }` to the Electron main process.
- When the user signs out, the desktop app shall clear the CloudBase session and main-process session, then return to the login page.
- While no synced user session exists, the main process shall reject browser launch and cloud usage summary requests.

### R2 Automatic Extension Handoff

User story: as a signed-in user, I launch a browser profile and the extension receives my session automatically.

Acceptance criteria:

- When the desktop launches or focuses a target browser profile, the main process shall open a one-time `127.0.0.1` handoff page as the browser start URL.
- The handoff page shall send `WENXUE_USER_SESSION` to the fixed extension id through `chrome.runtime.sendMessage`.
- The handoff payload shall include `userId`, `accessToken`, `refreshToken`, `expiresAt`, and `gatewayBaseUrl`.
- The desktop UI shall not expose, copy, or manually sync any machine token.
- The handoff path shall not send Agent control commands to the extension.

### R3 Extension Session Ownership

User story: as a user, I can keep using the browser after handoff without returning to the desktop for every token refresh.

Acceptance criteria:

- When the extension receives `WENXUE_USER_SESSION`, it shall validate and save it in `chrome.storage.local`.
- When a built-in model is selected, the extension shall configure the OpenAI-compatible client with the gateway base URL and the current access token.
- When the access token is near expiry or expired, the extension shall refresh the session using the refresh token before using it when possible.
- When no valid session is available, the chat UI shall still initialize and let the user send a message; the gateway 401/403 error is surfaced in-chat as login expired/no permission guidance.
- Custom BYO-Key models shall remain direct and shall not use the WenXue user session.

### R4 Gateway User Authorization

User story: as an operator, I authorize LLM access per user, not per machine.

Acceptance criteria:

- When the gateway receives `/v1/chat/completions` or `/v1/usage/summary`, it shall require `Authorization: Bearer <CloudBase accessToken>`.
- The gateway shall call official `/auth/v1/user/me` with the bearer token and extract the CloudBase user id from the profile.
- Before calling DashScope or reading the current usage summary, the gateway shall require the profile's exact `status=ACTIVE`.
- When the profile is `BLOCKED` or any other non-ACTIVE state, the gateway shall return no-permission before calling DashScope. Token introspection alone is insufficient because its response does not carry the authoritative user status.
- Successful usage records shall use `uid=<CloudBase user id>` and shall contain no prompt, content, API key, Authorization, Bearer value, refresh token, machine token, machine id, or token hash.

### R5 User-Scoped Usage

User story: as a user, I see my own token usage, and admins see user usage.

Acceptance criteria:

- The desktop tokens page shall request `/v1/usage/summary` with the current user access token.
- The desktop cloud summary cache shall be keyed by user id, not machine id.
- If cloud usage is unavailable, the desktop tokens page shall fall back to local sanitized telemetry/cache.
- Admin usage summary shall aggregate by user, model, and date.
- Admin recent usage rows shall display user id, not machine id.

### R6 Admin User Management

User story: as an admin, I can see users, token consumption, and enable or disable users.

Acceptance criteria:

- Admin API shall keep CloudBase Auth + `admin_users` for administrator authorization.
- Admin API shall expose user-list and user-status update endpoints backed by CloudBase Auth users; enable/disable shall call TCB `ModifyUser(UserStatus=ACTIVE|BLOCKED)`.
- Admin Console shall replace machine list/permissions with user list/status.
- Admin users with `role=viewer` shall read dashboards and users but shall not mutate user status.
- Every status change shall write an audit record with admin uid, user id, before/after status, reason, and timestamp.

## Data Model

### CloudBase Auth User Status

```ts
interface CloudBaseAuthUserProfile {
	sub: string // CloudBase Auth uid
	status: 'ACTIVE' | 'BLOCKED'
}
```

The gateway obtains the uid only from `/auth/v1/user/me` after a successful password login; it never trusts the submitted username or recovers a uid through username lookup. `ACTIVE` is the only allowed status. Operators can set `BLOCKED` or restore `ACTIVE` through CloudBase user management or TCB `ModifyUser`.

The existing AdminApi still reads and writes the legacy NoSQL `user_accounts` collection. After the Auth-native gateway cutover, that collection is not an authorization source and its status page does not block model access. Migrating AdminApi to TCB `ModifyUser` and cleaning the legacy collection are explicit follow-up work.

### CloudBase `user_permission_audit`

```ts
interface UserPermissionAudit {
	_id: string
	uid: string
	adminUid: string
	before: { status: 'active' | 'disabled'; note?: string }
	after: { status: 'active' | 'disabled'; note?: string }
	reason?: string
	createdAt: string
}
```

### Local `WenXueUserSession`

```ts
interface WenXueUserSession {
	userId: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
}
```

## Architecture

```mermaid
sequenceDiagram
	actor U as User
	participant D as Desktop Renderer
	participant M as Desktop Main
	participant B as CfT Browser
	participant E as Extension Background
	participant G as CloudBase LLM Gateway
	participant C as CloudBase Auth
	participant DB as CloudBase NoSQL
	participant Q as DashScope

	U->>D: username/password register or login
	D->>D: validate username and password
	alt register
		D->>G: POST /v1/auth/register
		G->>C: TCB CreateUser(UserStatus=ACTIVE)
		G-->>D: created or duplicate
	end
	D->>C: signInWithPassword
	C-->>D: user + session
	opt newly registered or registration retry
		D->>G: POST /v1/auth/activate + Bearer accessToken
		G->>C: GET /auth/v1/user/me
		C-->>G: uid + status ACTIVE
		G-->>D: activation ready (no DB write)
	end
	D->>M: auth:setSession(userId, access, refresh, expiresAt)
	U->>D: launch profile
	D->>M: browser:launchProfile(profileId)
	M->>B: open localhost handoff URL
	B->>E: WENXUE_USER_SESSION
	E->>E: save + refresh when needed
	E->>G: Authorization: Bearer accessToken
	G->>C: GET /auth/v1/user/me
	C-->>G: uid + status ACTIVE/BLOCKED
	G->>Q: OpenAI-compatible request
	Q-->>G: response + usage
	G->>DB: write token_usage(uid=userId)
	G-->>E: response
```

## Security Notes

- Refresh tokens are only persisted in CloudBase SDK/session storage and extension storage; they are never written to launcher logs, token usage records, gateway logs, admin responses, or exported telemetry.
- The desktop main process holds only the current synced session needed for launch handoff and cloud usage calls.
- The gateway trusts only the uid and exact `ACTIVE` status returned by `/auth/v1/user/me`; client-supplied user ids and token-introspection responses without status are ignored for authorization.
- The desktop sends the registration password only to the gateway registration endpoint and CloudBase SDK password login. The gateway forwards it only to Tencent Cloud TCB `CreateUser`; it is never logged, persisted by the gateway, returned, included in activation, or written to a business database.
- Registration retries do not recover or trust a uid by username. Only the access token obtained after successful password verification can read the authoritative CloudBase Auth profile.
- Activation and protected-request authorization do not use NoSQL, so exhausted database resource points cannot bypass or block identity status checks. `BLOCKED` must fail before DashScope or usage access.
- `getLoginState()` is not used for route guards; desktop/admin use `auth.getSession()`.

## CloudBase Preconditions

- CloudBase Auth username/password login is enabled.
- A valid publishable key is configured for desktop/admin web auth builds.
- The gateway has server-side Tencent Cloud TCB management credentials for `CreateUser`; these credentials are never exposed to the desktop build.
- The CloudBase Auth user-profile endpoint is reachable with the configured publishable client id and returns `sub` plus `status`.
- `admin_users`, `token_usage`, and `user_permission_audit` exist with appropriate CloudBase database permissions; their NoSQL availability is not a prerequisite for registration/login/activation authorization.
- Until AdminApi is migrated, operators control real access through CloudBase user management or TCB `ModifyUser ACTIVE/BLOCKED`; the legacy `user_accounts` UI is informational only and is not gateway-authoritative.
