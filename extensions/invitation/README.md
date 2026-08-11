# Invitation registration extension

This compile-time extension requires an invitation code for password registration when enabled.

Owned backend data and routes live in this directory. The frontend implementation
lives in `web/src/extensions/invitation/`.

The extension is connected to upstream code only through `extensions/registry.go`, the registration transaction, public status, API route registration, and frontend navigation entries. OAuth registration is intentionally unchanged because current OAuth flows do not collect an invitation code.
