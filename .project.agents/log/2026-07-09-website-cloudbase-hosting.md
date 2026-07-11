# Website CloudBase static hosting deployment

Date: 2026-07-09 16:45:35 CST

## Scope

- Target app: `apps/website`
- Target CloudBase env: `wenxue-d8gz76tacc3659f05`
- Static hosting domain: `https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com`

## Commands

- `pnpm -F website build`
- `pnpm -F website test`
- `npx --yes --package @cloudbase/cli cloudbase hosting deploy apps/website/dist --env-id wenxue-d8gz76tacc3659f05 --concurrency 3 --retry-count 5 --json`
- `npx --yes --package @cloudbase/cli cloudbase hosting list --env-id wenxue-d8gz76tacc3659f05 --json`
- `curl -I -L --max-time 30 https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/`

## Result

- Build passed.
- Tests passed: 4/4.
- CloudBase upload completed: 9 files uploaded, 0 failed.
- Hosting list confirms `index.html`, JS/CSS assets, logo/slogan assets, and both demo videos are present.

## Current blocker

Public reads from CloudBase static hosting return HTTP 451:

`Due to your account is arrears, it is unavailable until you recharge.`

The same HTTP 451 response also appears on the other available environment
`cloud1-d3ggq2x4738cdb09a`, so the blocker appears to be account-level billing
state rather than a missing website deploy.

After the Tencent Cloud account balance is restored, re-run the curl check above.
CDN cache may take a few minutes to refresh.
