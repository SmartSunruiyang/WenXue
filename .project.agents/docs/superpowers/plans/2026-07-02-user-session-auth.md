# User Session Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WenXue's machine-token auth chain with CloudBase username/password user sessions across desktop, extension, gateway, usage, and admin.

**Architecture:** Desktop renderer validates credentials, calls the gateway to create an `ACTIVE` CloudBase Auth identity, proves the password through CloudBase Web Auth, and calls the bearer-authenticated activation target before syncing the current session to main. Activation and every protected gateway request read `/auth/v1/user/me` and require `status=ACTIVE`; no NoSQL account row participates in authorization. Main gates browser launches and usage calls, and hands the user session to the extension through the existing localhost external-message mechanism. The extension stores/refreshes the user session.

**Tech Stack:** Electron + React + TypeScript, WXT MV3, CloudBase Web Auth SDK, CloudBase Auth HTTP / Tencent Cloud TCB API, CloudBase Run container with Functions Framework targets, Vitest.

---

## File Map

- Create `apps/desktop/src/main/UserSessionStore.ts`: main-process in-memory user session validation and access.
- Create `apps/desktop/src/main/UserSessionHandoff.ts`: one-shot localhost page for `WENXUE_USER_SESSION`.
- Create `apps/desktop/src/renderer/src/cloudbase.ts`: desktop username/password validation, gateway register/activate, Web Auth login/session/signout wrapper.
- Replace `apps/extension/src/lib/machineTokenSession.ts` with `apps/extension/src/lib/userSession.ts`.
- Modify `apps/extension/src/lib/runtimeModelConfig.ts`: load/refresh user session for built-in model auth.
- Modify `apps/extension/src/entrypoints/background.ts`: handle `WENXUE_USER_SESSION` external message and session load/clear messages.
- Modify `apps/llm-gateway/src/gateway.mjs`: replace machine token auth with CloudBase Auth user-profile validation; add TCB identity creation and a no-write activation readiness check.
- Modify `apps/admin-api/src/adminApi.mjs`: replace machine APIs with user APIs.
- Modify `apps/admin/src/*`: replace machine console with user console.
- Modify docs in `.project.agents/docs/context/`: PRD, ARCHITECTURE, ROADMAP, TECH-INFRA, UIUX.

## Tasks

- [x] 1. Write spec artifacts and update source-of-truth docs.
  - Add this plan and the sibling design spec.
  - Update PRD F4/F8/F9/F10, architecture module cards, IPC/API contracts, persistence table, roadmap, infra notes, and UIUX settings rule.
  - _Requirements: R1-R6_

- [x] 2. Desktop session and handoff TDD.
  - Write failing tests for `UserSessionStore`, `UserSessionHandoff`, `UsageCloudClient`, and `DesktopBridge`.
  - Implement user session storage, browser-launch gating, automatic handoff during launch/focus, and user-scoped usage summary cache.
  - Remove `machine-token:*` IPC and machine token UI.
  - _Requirements: R1, R2, R5_

- [x] 3. Desktop auth UI.
  - Add a username/password adapter using gateway `/v1/auth/register`, Web Auth `auth.getSession()` / `signInWithPassword` / `signOut`, and bearer `/v1/auth/activate`; do not use public `signUp` for username-only registration.
  - Render login/register pages when no session exists.
  - Sync session to main after login/startup and clear it on logout.
  - Gate main workbench and launch actions behind a synced session.
  - _Requirements: R1_

- [x] 4. Extension user session TDD.
  - Write failing tests for session validation/save/load/refresh and runtime model auth.
  - Replace machine session storage key with `WenXueUserSession`.
  - Update background external messages to accept only localhost `WENXUE_USER_SESSION`.
  - Keep built-in chat initialization possible with no session so the gateway error appears in-chat.
  - _Requirements: R2, R3_

- [x] 5. Gateway user authorization TDD.
  - Rewrite gateway tests from `resolveMachineTokenUser/authorizeMachineRequest` to `resolveCloudBaseUser/authorizeUserRequest`.
  - Create `ACTIVE` identities with TCB `CreateUser`; make activation and every protected route read `/auth/v1/user/me`, extract the real uid, and require exact `status=ACTIVE`.
  - Keep activation under a 10-second deadline with no NoSQL write; reject `BLOCKED` before DashScope and write `token_usage.uid` as the Auth user id.
  - Keep DashScope passthrough, SSE usage extraction, no-sensitive-record assertions, and summary aggregation.
  - _Requirements: R4, R5_

- [x] 6. Admin user management.
  - Update Admin API tests/types/routes from machines to users.
  - Implement `GET /admin/v1/users` and `PATCH /admin/v1/users/status`.
  - Update Admin Console labels, tables, filters, inspector, and API client.
  - Current caveat after the Auth-native gateway cutover: these routes still operate on legacy `user_accounts` and no longer enforce gateway access. Migrating them to TCB `ModifyUser ACTIVE/BLOCKED` remains a separate follow-up.
  - _Requirements: R5, R6_

- [x] 7. Verification and log.
  - Run targeted tests for desktop, extension, llm-gateway, admin-api, and admin build/typecheck where feasible.
  - Fix failures without weakening tests.
  - Write `.project.agents/log/2026-07-02-user-session-auth.md`.
  - _Requirements: R1-R6_
