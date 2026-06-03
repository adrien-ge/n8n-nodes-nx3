# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-03

### Added

- **List Sage X3 Objects** operation (maps to `XACTION=LIST`) for the ChatX3
  patch that now exposes the LIST action with advanced selection.
- **Custom Sage X3 Action** operation: a free-text *Action Code* field where
  the user can send any `XACTION` value the X3 patch exposes — useful for
  future actions without waiting for a node update.
- **Always-visible Action Code** field on Read / List / Create / Modify,
  pre-filled with the matching `XACTION` (`READ` / `LIST` / `CREATE` /
  `MODIFY`). The Operation dropdown acts as a shortcut; the field is still
  editable to override.

### Changed

- Rebranded the node display name to **"IntellX for Sage X3"** (was
  *nX3 by IntellX*) and aligned the credential display name accordingly.
- Prefixed user-facing references to *X3* with *Sage X3* across operation
  names, field labels and descriptions for unambiguous branding.
- Internal cleanup: lifted repeated `displayOptions` operation arrays into
  module-level constants (`X3_OBJECT_OPS`, `X3_OPS_WITH_DATA`) and made the
  per-operation Action Code fields auto-generated from `ACTION_MAP`.

### Fixed

- Disabled TypeScript incremental compilation so `n8n-node build` always
  emits the full `dist/` output (a relocated `tsBuildInfoFile` previously
  caused the compiler to skip emit after dist had been cleaned).

## [0.1.0] - 2026-05-28

### Added

- Initial release of **nX3 by IntellX**.
- `nX3 by IntellX API` credential: HTTP Basic Auth with the Syracuse user, plus the X3
  call context (codeLang, poolAlias, poolId, requestConfig) and a self-signed certificate toggle.
- `nX3 by IntellX` node with Read / Create / Modify operations on X3 objects via the
  `XCHATX3OBJ` sub-program, plus an advanced raw Run Sub-Program mode.
- Native X3 JSON mode: the node sends a JSON payload and requests a JSON response
  (`adxwss.optreturn=JSON`), then returns a clean, navigable object.
- Output shaping options: compact single-value arrays and trim trailing empty values.
- Session affinity: the X3 pool entry is surfaced as `sessionId` and can be passed back
  via the Pool ID Override to chain Read → Modify on the same X3 session.
- Debug options: include request, parsed result, and raw SOAP response.
- `usableAsTool` enabled for AI Agent integration.
