# Homepage extension

This compile-time extension can replace the public homepage with either a
configurable brand showcase or a 404-style page. It is disabled by default.

The extension owns the `extension_homepage_settings` table and mounts its
Root-only management API below `/api/extensions/homepage/admin`.

Frontend adapters live in:

- `web/default/src/extensions/homepage/`
- `web/classic/src/extensions/homepage/`
