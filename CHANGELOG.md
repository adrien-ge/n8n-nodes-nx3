# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by hand. `auto-changelog` is redirected to
`CHANGELOG.auto.md` (git-ignored) so releases never overwrite it.

## [Unreleased]

### Fixed

- The credential test now exercises what the node actually calls: a **POST** on
  `/soap-generic/…`. It previously issued a **GET** on `/soap-wsdl/…?wsdl` —
  a different path *and* a different method — so it reported success against any
  web server answering 200 to a GET, such as a reverse proxy or a SPA front-end
  sitting in front of X3, while the node's POST was refused with 405. The
  credential looked healthy and the failure only surfaced at execution time,
  pointing the user at the node instead of at the Base URL.

### Added

- Actionable messages for HTTP failures, naming the URL that was called. A bare
  "Request failed with status code 405" reads like a node defect; the node now
  explains that the Base URL is not the SOAP endpoint and that a missing port is
  the usual cause (Syracuse listens on 8124 or 8443, rarely on 443). Covers 401,
  403, 404, 405, 407 and 502/503/504, and the credential test carries the same
  wording. `httpStatus` and `url` are included in the item output when
  "Continue on Fail" is enabled.
- **Include Technical Infos** advanced option. The X3 `technicalInfos` block
  (pool and timing metrics) is now opt-in. On a typical READ it was about a
  quarter of every item — 375 of 1,600 characters — and nothing in it is
  actionable by a workflow or by an AI Agent, which paid for it in tokens on
  every tool call. Turn it on to diagnose pool contention or slow calls.
- **Include Request in Output** now also carries `url`, the SOAP endpoint that
  was actually called. The envelope cannot show it, and it is what separates
  "same call, different server" from "same server, different folder" when two
  n8n instances disagree.

### Changed

- `technicalInfos` is no longer in the output by default (see above). Workflows
  that read `$json.technicalInfos.…` must enable **Include Technical Infos** on
  the node. `sessionId` is unaffected and still present for session chaining.

### Documentation

- README: new **Sage X3 prerequisites** section (ChatX3 patch, SOAP pool,
  license endpoint, Syracuse and X3 user rights), condensed from the
  installation guide at github.com/chatx3/n8n-nodes-nx3.
- README: the List payload keys (`list_nb`, `list_filters`) and the List and
  Describe output shapes, composite identifiers with `~`, the `nx3SoapTool`
  type and MCP Server Trigger wiring, the `CUSTOM.` type prefix of a package
  loaded from the `custom` folder, and three new troubleshooting rows (405,
  `?` nodes after import, `$fromAI` schema error).
- README: the credential test description matched the old GET on the WSDL; it
  now describes the POST.
- README: version history synced with this changelog (it stopped at 0.3.0).
- `examples/`: the *Query Sage X3 in natural language* agent + MCP workflow,
  sanitised (no credential ids, no API key, placeholder X3 user), plus the
  ChatX3 agent and a Test_nX3 object-operations workflow.

## [0.5.1] - 2026-08-07

### Fixed

- Simplify now recovers the column names of a query that opens with a comment.
  The SELECT list parser expected `SELECT` to be the very first token, so a
  query introduced by a `/* ... */ ` documentation header — the usual shape for
  a documented AI Agent tool — silently fell back to X3's generic `Col_1`,
  `Col_2` keys. Comments are stripped before parsing, which also fixes inline
  comments between two select items when they contain a comma or an unbalanced
  parenthesis. String literals are left untouched, so a `--` inside a quoted
  value is still data.

## [0.5.0] - 2026-08-03

### Added

- **Contains** parameter type: the value is wrapped in `%` for a `LIKE` search,
  and any `%`, `_` or `[` it contains is escaped so it stays a literal
  character. Searching for `remise 50%` no longer matches everything starting
  with `remise 50`.

### Changed

- Simplify output is now just `{ rowCount, columns, rows }`. `success`,
  `messages` and `trace` reappear only when the call failed, so failures stay
  visible while the happy path stays cheap to read for an AI Agent.
- SQL dates are returned as plain `YYYY-MM-DD`, and X3's `0000-00-00` "not set"
  sentinel becomes `null`. The time part is dropped only when it is exactly
  midnight UTC, so a genuine timestamp is never truncated.

### Documentation

- Warn, in the node fields and the README, that a `$fromAI` call needs a fourth
  argument (an empty default) for an optional filter — without it n8n makes the
  field mandatory and the model can never skip the filter.

## [0.4.0] - 2026-08-02

First release published automatically by GitHub Actions with npm provenance.
Supersedes 0.3.0, which was prepared but never reached the registry — its
changes are listed below and are all included here.

### Added

- **SQL Analyse** and **SQL Select** operations, `XOBJECT='SQL'`, with
  `Max Lines` and `Max Time (Seconds)` caps.
- **Query Parameters** for SQL: Metabase-style `{{name}}` placeholders and
  `[[ ... ]]` optional clauses, with typed escaping (Text, Number, Date,
  Boolean, List). Markers inside comments or string literals are ignored, and a
  comma-bearing Text value used in an `IN (...)` is rejected with a message
  pointing to the List type.
- **Simplify** on SQL Select, returning `{ success, rowCount, columns, rows }`
  with the real column names recovered from the query instead of X3's generic
  `Col_1`, `Col_2` keys, plus a **Row Format** switch between Objects and Arrays.
- **Describe Sage X3 Object** operation (`DESC`).
- **Context (Optional)** envelope: per-call language and user override, response
  screen/field filtering, and hidden fields.
- **Request Timeout** (default 30 s) and readable network error messages, so an
  AI Agent no longer hangs when X3 is unreachable.

### Changed

- Node subtitle now shows the real `XACTION` and stays readable on nodes used as
  AI tools, where model-driven fields have no design-time value.
- README rewritten to match the node: every operation, the Context envelope, the
  SQL section, and the AI Agent wiring options.

### Fixed

- `Max Time` is in **seconds**, not milliseconds — it was labelled and
  documented wrong, so a value of 10000 meant nearly three hours.

## [0.3.0] - 2026-06-08 (unreleased)

### Added

- **Describe Sage X3 Object** operation (`XACTION=DESC`) — get the local-menus
  and field metadata description of an object class, matching the new method
  exposed by the ChatX3 patch.
- **Context (Optional)** collection on every X3 object operation, merged as a
  top-level `context` key inside XDATAJSON when at least one sub-option is
  filled. Fields:
  - `Language` — override the XCHATX3OBJ language for the call (e.g. ITA).
    Independent from the SOAP-level `codeLang` in Advanced Options.
  - `User` — override the target user (only honored when GPROFIL=ADMIN).
  - `Response Screens` — restrict the response to these screen codes.
  - `Response Fields` — restrict the response to these field codes.
  - `Include Hidden Fields` — include hidden/technical fields in the
    response (off by default).
- **SQL Analyse** and **SQL Select** operations. These hardcode
  `XOBJECT='SQL'` and send `XACTION=ANALYSE` (syntax check, no rows) or
  `XACTION=SELECT` (execute a SELECT and return rows). The payload is
  built from a dedicated `SQL Query` field and an optional
  `SQL Options` collection carrying `max_lines` and `max_time` caps,
  matching the shape expected by the ChatX3 patch.
- **Query Parameters** for SQL, with Metabase-style syntax: `{{name}}`
  placeholders and `[[ ... ]]` optional clauses that vanish when their
  parameter is empty. Values are escaped per type — Text (quotes doubled),
  Number (validated numeric), Date (ISO-8601), Boolean, and List (comma-split,
  each element quoted, for `IN ({{name}})`). Values are never concatenated
  raw, which matters because an AI Agent supplies them. Markers inside a
  `--` comment, a `/* ... */` block or a string literal are ignored, so
  commenting a filter line out disables it as expected.
- **Simplify** option on SQL Select, returning `{ success, rowCount, columns,
  rows }`. Sage X3 answers with generic `Col_1`, `Col_2`, … keys; Simplify
  recovers the real column names by parsing the SELECT list of the query.
  The renaming is best-effort and conservative — with `SELECT *`, an
  unresolvable expression, or any count mismatch, the original keys are kept.
  A **Row Format** option switches rows between `Objects` (one key per column)
  and `Arrays` (values only — far more compact for an AI Agent).
- **Request Timeout (Seconds)** advanced option (default 30 s), applied to
  every SOAP request. Prevents AI Agent runs from hanging forever when the
  Sage X3 server is unreachable.
- LLM-friendly network error messages: timeouts, `ECONNREFUSED`,
  `ENOTFOUND`, `EHOSTUNREACH`, `ENETUNREACH` and `ECONNRESET` are now
  translated into one-sentence actionable messages, so an AI Agent can
  decide whether to retry, ask the user, or report the failure. Raw error
  code and message are preserved alongside for debugging.

### Notes

- Backward compatible: workflows saved on 0.2.0 that don't touch Context
  produce the same XDATAJSON as before (no `context` key injected). The
  server-side ChatX3 fixes shipped by the associate (no more false
  `success=true`, LIST advanced selections, non-French compile crash) need
  no client change.

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
