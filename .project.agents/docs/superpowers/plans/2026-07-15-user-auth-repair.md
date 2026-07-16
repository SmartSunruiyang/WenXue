# Desktop CloudBase Auth Repair Plan

**Source spec:** [2026-07-02-user-session-auth-design.md](../specs/2026-07-02-user-session-auth-design.md)

**Goal:** Restore reliable username/password registration and login through the required CloudBase Run registration gateway, harden retries and failure feedback, and enforce credential rules before any network request.

## Acceptance

- When a user submits login or registration, the desktop validates a 5–24 character username that starts with an English letter and otherwise contains only English letters or digits.
- When a user submits login or registration, the desktop requires a 9–32 character password that starts with a letter or digit and contains at least three character classes, satisfying both the user's minimum and CloudBase `CreateUser`.
- Invalid credentials produce a specific inline Chinese error and no SDK or gateway request.
- Registration calls `/v1/auth/register`, then uses Web Auth `signInWithPassword` to return a real session; no email, phone, OTP, or captcha is introduced.
- After SDK login proves the submitted password, the desktop calls `/v1/auth/activate` with the access token and no password body; the gateway reads `/auth/v1/user/me`, requires the real uid plus exact `status=ACTIVE`, and performs no database activation write.
- Activation has a 10-second gateway deadline. The same Auth-native profile check runs before every protected gateway route; `BLOCKED` fails before DashScope or usage access.
- Registration timeout and network failures are translated into actionable messages instead of raw `Failed to fetch`.
- `/healthz` provides a credential-free CloudRun readiness probe.

## Tasks

- [x] 1. Desktop auth adapter and form validation
  - Add credential validation codes and tests.
  - Keep the required registration gateway request, add a bounded client timeout, then obtain the session with `signInWithPassword`.
  - Wire validation hints and inline errors into the existing AuthScreen.
  - _Requirements: R1_

- [x] 2. Gateway registration, authenticated activation, and health
  - Validate credentials defensively before calling Tencent Cloud TCB `CreateUser`.
  - Accept CreateUser success without requiring a returned uid; keep duplicate registration separate from authorization.
  - Add a bearer-authenticated activation target that reads the real uid and native status from `/auth/v1/user/me` without writing NoSQL.
  - Enforce a 10-second activation deadline and require exact `ACTIVE`; reject `BLOCKED` before any protected upstream call.
  - Use the same profile check for chat and usage routes so authorization does not depend on exhausted NoSQL resource points.
  - Add and test `/healthz`.
  - _Requirements: R4, R5_

- [x] 3. Source-of-truth synchronization
  - Update current-runtime ARCHITECTURE, TECH-INFRA, UIUX, ROADMAP, and the execution log.
  - _Requirements: R1, R4, R5_

- [x] 4. Verification and deployment
  - Run desktop and gateway unit tests, type checks, and build checks without overwriting the pre-existing `apps/desktop/out/main/index.js` change.
  - Exercise the desktop form in a real Electron renderer and verify invalid, valid-login, and registration paths as far as safe test credentials allow.
  - Deploy `apps/llm-gateway`, verify `/healthz`, and perform a disposable real registration/login smoke test with cleanup where supported.
  - _Requirements: R1, R4, R5_
