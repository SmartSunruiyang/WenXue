# Page Agent Extension API

This WenXue build does not expose `window.PAGE_AGENT_EXT` to arbitrary web pages.

The former `PageAgentExtUserAuthToken` page-side authorization flow was removed because
it generated per-browser-profile credentials. The current flow accepts only the desktop
launcher's localhost external-message handoff. That handoff stores a CloudBase user
session in extension storage, and built-in model calls use the session access token as
the gateway bearer credential.
