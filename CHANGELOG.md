# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
