# Homepage extension

This compile-time extension can replace the public homepage with a configurable
showcase, a 404-style page, or a community homepage. It is disabled by default.

The extension owns the `extension_homepage_settings` table and mounts its
Root-only management API below `/api/extensions/homepage/admin`.

The frontend implementation lives in `web/src/extensions/homepage/`.
