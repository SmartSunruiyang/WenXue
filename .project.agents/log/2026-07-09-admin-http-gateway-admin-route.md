# 2026-07-09 Admin HTTP gateway `/admin` route

## Scope

- Published the admin console under the CloudBase HTTP service default domain:
  `https://wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com/admin`.
- Kept the CloudBase Run services as the underlying compute:
  - `wenxue-admin-web`
  - `wenxue-admin-api`

## Changes

- `apps/admin/server.mjs` now strips the `/admin` base path before resolving files from `dist`, so gateway path transmission can serve `/admin` and `/admin/assets/*`.
- `apps/admin` was built with:
  - `VITE_BASE_PATH=/admin/`
  - `VITE_WENXUE_ADMIN_API_BASE_URL=https://wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com`
- Admin frontend API calls now use precise same-origin gateway paths:
  - `GET /api/admin/v1/me`
  - `GET /api/admin/v1/usage/summary`
  - `GET /api/admin/v1/users`
  - `PATCH /api/admin/v1/user-status`
- `apps/admin-api/cloudbase-functions.json` includes matching gateway trigger paths while keeping the original `/admin/v1/*` compatibility triggers.

## Gateway routes

CloudBase HTTP service default domain:
`wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com`

- `/admin` -> CBR `wenxue-admin-web`
- `/admin/` -> CBR `wenxue-admin-web`
- `/admin/assets/*` -> CBR `wenxue-admin-web`
- `/api/admin/v1/me` -> CBR `wenxue-admin-api`
- `/api/admin/v1/usage/summary` -> CBR `wenxue-admin-api`
- `/api/admin/v1/users` -> CBR `wenxue-admin-api`
- `/api/admin/v1/user-status` -> CBR `wenxue-admin-api`

Avoid routing AdminApi as `/admin/v1/*` on the default domain: CloudBase HTTP routes match the `/admin` page route by prefix, so `/admin/v1/*` is captured by the web service.

## Deployment

- Deployed `wenxue-admin-api`; final online version observed: `wenxue-admin-api-007`, 100% traffic.
- Deployed `wenxue-admin-web`; final online version observed: `wenxue-admin-web-005`, 100% traffic.

## Verification

- `pnpm -F admin-api test -- --runInBand`: 13 tests passed.
- `VITE_BASE_PATH=/admin/ VITE_WENXUE_ADMIN_API_BASE_URL=https://wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.app.tcloudbase.com pnpm -F admin build`: passed; Vite emitted only the existing large chunk warning.
- `GET /admin`: 200 `text/html`, title `问学后台管理`, script `/admin/assets/index-DAabuiMV.js`.
- `GET /admin/assets/index-DAabuiMV.js`: 200.
- Unauthenticated AdminApi smoke tests through the default domain all returned 401 from CloudBase Run upstream:
  - `/api/admin/v1/me`
  - `/api/admin/v1/usage/summary`
  - `/api/admin/v1/users`
  - `/api/admin/v1/user-status`
