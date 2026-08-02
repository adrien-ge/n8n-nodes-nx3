# n8n-nodes-nx3

This is an n8n community node. It lets you query and update **Sage X3** from your
n8n workflows — read, list, create, modify and describe objects, and run SQL
SELECT queries.

**IntellX for Sage X3** talks to Sage X3's `CAdxWebServiceXmlCC` SOAP web service
through the `XCHATX3OBJ` sub-program (ChatX3 patch). You work entirely with JSON —
the node builds the SOAP request, asks X3 to answer in native JSON, and returns a
clean, ready-to-use object. No XML wrangling required.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Object parameters](#object-parameters)
[SQL operations](#sql-operations)
[Output](#output)
[Advanced options](#advanced-options)
[Use as an AI Agent tool](#use-as-an-ai-agent-tool)
[Compatibility](#compatibility)
[Usage examples](#usage-examples)
[Troubleshooting](#troubleshooting)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short, from your n8n instance: **Settings → Community Nodes → Install**, then enter `n8n-nodes-nx3`.

### Self-hosted (Docker) manual install

If you run n8n in Docker and want to load this package directly, mount the built package into the container's custom extensions folder:

```bash
docker run -d --name n8n -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -v /path/to/n8n-nodes-nx3:/home/node/.n8n/custom/n8n-nodes-nx3:ro \
  n8nio/n8n
```

Build the package first with `npm install && npm run build`, then restart the container.

## Operations

| Operation | X3 action | Description |
| --- | --- | --- |
| **Read Sage X3 Object** | `READ` | Read an object by its identifier and return its full field tree |
| **List Sage X3 Objects** | `LIST` | List records of an object, with optional selection criteria |
| **Create Sage X3 Object** | `CREATE` | Create a new object from a JSON payload |
| **Modify Sage X3 Object** | `MODIFY` | Update fields of an existing object |
| **Describe Sage X3 Object** | `DESC` | Get the local-menus and field metadata of an object class |
| **Custom Sage X3 Action** | *(free text)* | Send any `XACTION` the patch exposes, including future ones |
| **SQL Analyse** | `ANALYSE` | Check that a SQL query is valid, without returning rows |
| **SQL Select** | `SELECT` | Execute a SQL SELECT and return the rows |
| **Run Sub-Program (Advanced)** | *(raw XML)* | Call any X3 sub-program with a raw input payload (escape hatch) |

The **Action Code** field is always visible and pre-filled from the operation you
pick, so you can see exactly which `XACTION` is sent — and override it if needed.

> Table-type objects are not handled by the ChatX3 patch yet.

## Credentials

You authenticate with your **Syracuse** user (the same credentials you use to log into Sage X3), via HTTP Basic Authentication.

**Prerequisites**

- A reachable Sage X3 server exposing the SOAP endpoint
- A Syracuse user with the required function rights on the objects you intend to read/create/modify
- The `XCHATX3OBJ` sub-program published in your X3 environment (ChatX3 patch)

**Credential fields (`IntellX for Sage X3 API`)**

| Field | Required | Description |
| --- | --- | --- |
| Base URL | ✅ | Scheme + host (+ port) of the X3 server, e.g. `https://my-x3-host:8124`. The SOAP path is appended automatically. |
| Username | ✅ | Syracuse user |
| Password | ✅ | Syracuse password |
| Code Language | | Default `codeLang` for the SOAP call context (e.g. `FRA`, `ENG`). Defaults to `FRA`. |
| Pool Alias | | Default `poolAlias` (e.g. `POOL_SEED`). Must match an existing, **started** X3 connection pool. |
| Pool ID | | Default `poolId` (usually left empty). |
| Request Config | | Default `requestConfig`. The node adds the JSON-mode flags automatically. |
| Allow Self-Signed Certificates | | Skip TLS validation. Useful for on-prem X3 with a self-signed certificate; do not enable for production over the Internet. |

The credential **Test** button calls the WSDL endpoint with your credentials to confirm connectivity.

## Object parameters

Shown for Read, List, Create, Modify, Describe and Custom:

- **Sage X3 Object Code** — the object code, e.g. `ITM` (items), `BPC` (customers), `SOH` (sales orders).
- **Transaction Code** — X3 transaction (`XTRANSACTION`); leave empty for the default.
- **Identifier** — the object's primary key (`XIDENT`). Required for Read and Modify. For Create it must usually match the key field in the data (e.g. `ITM0.ITMREF`) unless X3 generates it. Optional for Custom, hidden for List and Describe.
- **Data (JSON)** — the payload sent as `XDATAJSON`. Shown for Create, Modify, List (selection criteria) and Custom.

### Data JSON conventions (from the ChatX3 patch)

- All fields are dimensioned, so values are arrays: `"TSICOD": ["20"]` or `"TSICOD": ["20","21","99"]`.
- Target a specific index by adding `(n)` to the field name: `"TSICOD(1)": "21"`.
- Don't fill table footer/count variables — `NBLIG` and friends are filled automatically.
- Dates use `"YYYY-MM-DD"`, e.g. `"SBSDAT": ["2026-05-01"]`.
- Clear a field with an empty string `""`, a `0` integer, or a `"0000-00-00"` date.

Example Create payload:

```json
{
  "ITM0": {
    "DES1AXX": ["Test item"],
    "ITMREF": ["ASS001C"],
    "TCLCOD": ["BMSOL"]
  }
}
```

### Context (Optional)

An optional envelope merged into `XDATAJSON` as a top-level `context` key. Leave
it untouched and nothing is added — the payload stays exactly as it was.

| Option | Effect |
| --- | --- |
| Language | Override the XCHATX3OBJ language for this call (e.g. `ITA`). Independent from the SOAP-level `codeLang` in Advanced Options — different layer. |
| User | Run the call as another user (e.g. `FU01`). Only honored when the caller has `GPROFIL=ADMIN`. |
| Response Screens | Return only these screens, e.g. `ITM0`, `ITM1`. |
| Response Fields | Return only these fields, e.g. `DES1AXX`. |
| Include Hidden Fields | Include hidden and technical fields, which are excluded by default. |

Resulting payload:

```json
{
  "context": {
    "language": "ITA",
    "user": "FU01",
    "response": { "screens": ["ITM0"], "fields": ["DES1AXX"], "hidden_fields": true }
  },
  "ITM0": { "DES1AXX": ["Nouvelle designation"] }
}
```

## SQL operations

**SQL Analyse** validates a query without running it; **SQL Select** runs it and
returns the rows. Both accept optional `Max Lines` and `Max Time (Seconds)` caps,
sent to X3 as `context.max_lines` and `context.max_time`.

> `Max Time` caps the execution *inside X3*, while `Request Timeout` in Advanced
> Options caps the HTTP call (30 s by default). Keep the former below the latter,
> or the request gives up before X3 does.

### Query parameters

Rather than concatenating values into the query — unsafe, especially when an AI
Agent supplies them — declare them under **Query Parameters** and reference them
with `{{name}}`:

```sql
SELECT TOP (100) [USR_0], [CREUSR_0], [CREDAT_0]
FROM   [AUTILIS]
WHERE  USR_0 IN ({{logins}})
  AND  CREDAT_0 BETWEEN {{from}} AND {{to}}
[[AND  CREUSR_0 = {{creator}}]]
```

- Each value is escaped according to its **Type** and produces a *complete*
  literal — so never wrap `{{name}}` in quotes yourself.
- `[[ ... ]]` marks an **optional clause**: it is dropped entirely when its
  parameters are empty, and kept otherwise. Ideal for filters an agent may or
  may not fill in.
- A `{{name}}` used outside an optional clause with no value raises a clear
  error rather than silently changing the query.
- **Comments disable parameters.** Markers sitting in a `--` line comment, a
  `/* ... */` block, or a string literal are left untouched — so commenting a
  filter line out while you iterate works exactly as a SQL reader expects.

| Type | Rendering | Use for |
| --- | --- | --- |
| Text | `'value'`, embedded quotes doubled | `=`, `LIKE` (pass `%foo%` as the value) |
| Number | bare, validated numeric | `>`, `<`, `>=` |
| Date | quoted, `YYYY-MM-DD` or ISO-8601 | `BETWEEN`, comparisons |
| Boolean | `1` / `0` | flags |
| List | `'a','b','c'` — comma-split, each quoted | `IN ({{name}})` |

> Use **List** — not Text — for `IN ({{name}})`. A Text value holding `a,b`
> becomes the single literal `'a,b'` and matches nothing; the node detects that
> case and tells you to switch type. A List value cannot itself contain a comma,
> since the comma is the separator.

### Simplify

Sage X3 returns SQL rows with generic keys — `Col_1`, `Col_2`, … — losing the
link to the selected columns. Turn on **Simplify** (SQL Select only) to get the
rows with their real names restored from your query:

```json
{
  "success": true,
  "rowCount": 3,
  "columns": ["USR_0", "CREUSR_0", "CREDAT_0"],
  "rows": [{ "USR_0": "ADMCA", "CREUSR_0": "ADMIN", "CREDAT_0": "2015-08-14T00:00:00Z" }],
  "trace": "F38585"
}
```

**Row Format** then chooses the row shape:

- **Objects** (default) — one key per column, easiest for expressions such as
  `{{ $json.rows[0].USR_0 }}` and rendered natively by the n8n Table view.
- **Arrays** — values only, ordered like `columns`. Far more compact, which
  matters when the rows are fed to an AI Agent.

The renaming is best-effort and never reorders or drops data: with `SELECT *`,
an unresolvable expression, or any count mismatch, the original `Col_N` keys are
kept as-is. Leave Simplify off to get the full envelope (`data`, `status`,
`sessionId`, `technicalInfos`).

## Output

Object operations return a clean JSON object:

```json
{
  "success": true,
  "status": 1,
  "action": "READ",
  "object": "ITM",
  "ident": "ASS001",
  "transaction": "",
  "data": {
    "ITM0": { "ITMREF": "ASS001", "DES1AXX": "Computer server", "TCLCOD": "BMSOL" },
    "ITM1": { "EANCOD": "3782940199614", "TSICOD": ["10", "12", "122"] }
  },
  "messages": [{ "trace": "F1730" }, { "info": "Object created: ASS001" }],
  "trace": "F1730",
  "sessionId": "6784",
  "technicalInfos": { "poolEntryIdx": 6784, "totalDuration": 611 }
}
```

| Field | Description |
| --- | --- |
| `success` | `true` when X3 reports the action succeeded (`XRETURNJSON.success`, fallback `status === 1`). |
| `status` | Raw X3 status (`1` = OK, `0` = failure). |
| `action` / `object` / `ident` / `transaction` | Echo of the request for traceability. |
| `data` | The object payload (X3 `XDATAJSON`), parsed into a navigable object. |
| `messages` | X3 user messages: `info`, `error`, `alert`, and the `trace` entry. |
| `trace` | The X3 trace name, surfaced for convenience (also present in `messages`). |
| `sessionId` | The X3 pool entry that handled the call. Pass it back as **Pool ID Override** to chain calls on the same session. |
| `technicalInfos` | Pool/performance metrics returned by X3. |

> X3 may report `success: true` while still including an `error` message (e.g. an access-level check). To gate a workflow strictly, test for errors with an IF node:
> `{{ !($json.messages || []).some(m => m.error) }}`

SQL Select with **Simplify** on returns the reduced shape shown above instead.

## Advanced options

All optional. The output-shaping options default to **on**; debug and override
options default to **off**.

| Option | Default | Purpose |
| --- | --- | --- |
| Compact Single-Value Arrays | on | Unwrap single-element arrays: `["Iconext"]` → `"Iconext"`. Multi-value arrays stay arrays. |
| Trim Trailing Empty Values | on | Drop trailing empty values X3 pads dimensioned fields with: `["A","",""]` → `["A"]`. |
| Request Timeout (Seconds) | 30 | Abort the SOAP call when X3 does not answer, instead of hanging. Surfaces a clear timeout error. |
| Code Language Override | — | Override the credential `codeLang` (SOAP call context) for this call. |
| Pool Alias Override | — | Override the credential `poolAlias` for this call. |
| Pool ID Override | — | Pin the call to a specific X3 session (e.g. `={{$json.sessionId}}` from a previous step) to preserve object locks across Read → Modify. |
| Public Name Override | — | Call a different sub-program than `XCHATX3OBJ`. |
| Include Request in Output | off | Add `request` (the JSON payload sent + the SOAP envelope) for debugging. |
| Include Result in Output | off | Add `result` (the parsed X3 result payload, navigable) for debugging. |
| Include Raw SOAP Response | off | Add `raw` (the full SOAP envelope as XML) for low-level transport debugging. |

## Use as an AI Agent tool

This node has `usableAsTool` enabled, so it can be attached to an **AI Agent**
node — for object operations ("find item BMS009", "create a customer") as well as
SQL Select.

Two ways to wire a SQL tool, with very different safety profiles:

- **The agent writes the query** — put `$fromAI` on **SQL Query**. Flexible, but
  the model composes the SQL itself and can reach any table.
- **The query is fixed, the agent only fills values** — write the query once with
  `[[ ... ]]` optional clauses and put `$fromAI` on the **Value** of each entry in
  Query Parameters. The model cannot write SQL, values are escaped by the node,
  and unfilled filters disappear on their own. Prefer this one.

Network failures (timeout, connection refused, unknown host, unreachable network)
are turned into one-sentence actionable messages, so the agent can decide whether
to retry, ask the user, or report the failure instead of hanging.

## Compatibility

- Requires **n8n 1.x** (Nodes API v1).
- No runtime dependencies — response parsing is done without external libraries, so the node is compatible with n8n Cloud's verification requirements.
- Tested against **Sage X3 V12** (`CAdxWebServiceXmlCC`, Apache Axis 1.4 SOAP stack) with the ChatX3 `XCHATX3OBJ` sub-program.

## Usage examples

**Read an item**

- Operation: `Read Sage X3 Object`
- Sage X3 Object Code: `ITM`
- Identifier: `ASS001`

**Modify an item description**

- Operation: `Modify Sage X3 Object`
- Sage X3 Object Code: `ITM`
- Identifier: `ASS001`
- Data (JSON): `{ "ITM0": { "DES1AXX": ["New description"] } }`

**Read → modify on the same X3 session (preserve the lock)**

1. A `Read Sage X3 Object` node returns `sessionId`.
2. In the following `Modify Sage X3 Object` node, set **Advanced Options → Pool ID Override** to `={{ $('Read Sage X3 Object').item.json.sessionId }}`.

**Filtered SQL Select**

- Operation: `SQL Select`, Simplify on
- SQL Query:
  ```sql
  SELECT TOP (200) [SOHNUM_0], [BPCORD_0], [ORDDAT_0]
  FROM   [SORDER]
  WHERE  1 = 1
  [[AND  [BPCORD_0] = {{customer}}]]
  [[AND  [ORDDAT_0] >= {{from}}]]
  ```
- Query Parameters: `customer` (Text), `from` (Date) — leave either empty to drop its clause.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `self-signed certificate` error | Enable **Allow Self-Signed Certificates** in the credential. |
| Timed out / connection refused / host not found | The X3 server is unreachable — check the credential Base URL, the network, and raise **Request Timeout** if the server is merely slow. |
| `No Pool: <alias>` | The X3 pool isn't started or the alias is wrong. Start the pool in X3 (Administration → Web services) or fix **Pool Alias**. |
| `Niveau d'accès insuffisant` / `Insufficient access level` | The Syracuse user lacks rights on the object. Grant the function rights in X3. |
| `Modification en cours sur un autre poste` | A previous READ still holds the object lock. Chain calls with **Pool ID Override**, or skip the READ and MODIFY directly. |
| `Erreur zone [M:...]<field>` | Field validation failed — check that `Identifier` matches the key field in the data, value formats, and category counters. |
| SQL Select returns 0 rows with an `IN` filter | The parameter is typed Text instead of **List**, so the values were sent as one single literal. |

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Sage X3 SOAP web services guide](https://online-help.sageerpx3.com/erp/12/wp-static-content/static-pages/en_US/web-services/Configuration_management.html)

## Version history

### 0.3.0

- **Describe Sage X3 Object** operation (`DESC`).
- **Context (Optional)** envelope: per-call language and user override, response
  screen/field filtering, and hidden fields.
- **SQL Analyse** and **SQL Select** operations, with `Max Lines` / `Max Time`
  caps.
- **Query Parameters** for SQL: Metabase-style `{{name}}` placeholders and
  `[[ ... ]]` optional clauses, with typed escaping (Text, Number, Date, Boolean,
  List).
- **Simplify** on SQL Select: real column names recovered from the query, with a
  **Row Format** switch between Objects and Arrays.
- **Request Timeout** and readable network error messages, so an AI Agent no
  longer hangs when X3 is unreachable.

### 0.2.0

- **List Sage X3 Objects** and **Custom Sage X3 Action** operations.
- **Action Code** always visible and pre-filled from the chosen operation.
- Renamed the node to **IntellX for Sage X3**.

### 0.1.0

- Initial release.
- Read / Create / Modify X3 objects via `XCHATX3OBJ`, plus an advanced raw Run Sub-Program mode.
- Native X3 JSON mode (JSON in, JSON out) with clean, navigable output.
- Output shaping (single-value array compaction, trailing-empty trimming).
- Session affinity via `sessionId` / Pool ID Override.
- `usableAsTool` for AI Agent integration.
