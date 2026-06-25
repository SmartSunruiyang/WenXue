# 2026-06-23 Website Floating Navbar

## Context

User asked to change the website taskbar back into a floating window while keeping the latest GlassSurface material direction.

## Changes

- Reworked `apps/website` top information bar positioning into a centered floating window with responsive desktop/mobile dimensions.
- Kept React Bits `GlassSurface` as the navigation material and preserved slogan hover, docs, GitHub, and language controls.
- Updated PRD, architecture context, and design QA records to describe the current floating GlassSurface navigation.

## Verification

- `pnpm -F website build` passed.
- Playwright screenshots captured desktop and mobile floating navbar states:
  - `.project.agents/screenshots/website-home-glasssurface-floating-desktop.png`
  - `.project.agents/screenshots/website-home-glasssurface-floating-mobile.png`
