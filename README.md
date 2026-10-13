# n8n-nodes-nx3 — IntellX for Sage X3

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-FF6D5A)](https://docs.n8n.io/integrations/community-nodes/)

**🇬🇧 English** · [🇫🇷 Français](README.fr.md)

An [n8n](https://n8n.io/) community node to read, list, create, modify and
describe **Sage X3** objects, and to run SQL `SELECT` queries on the X3
database — from a workflow or from an AI Agent.

The node talks to Sage X3's `CAdxWebServiceXmlCC` SOAP web service through the
`XCHATX3OBJ` sub-program delivered by the **ChatX3 patch**. You work entirely
with JSON: the node builds the SOAP request, asks X3 to answer in native JSON,
and returns a clean, ready-to-use object. No XML wrangling required.

## Contents

1. [How it works](#1-how-it-works)
2. [Requirements](#2-requirements)
3. [Sage X3 setup](#3-sage-x3-setup)
4. [Installing the node in n8n](#4-installing-the-node-in-n8n)
5. [Credentials](#5-credentials)
6. [Operations](#6-operations)
7. [Object operations](#7-object-operations)
8. [SQL operations](#8-sql-operations)
9. [Output](#9-output)
10. [Advanced options](#10-advanced-options)
11. [AI Agent and MCP](#11-ai-agent-and-mcp)
12. [Workflow recipes](#12-workflow-recipes)
13. [Troubleshooting](#13-troubleshooting)
14. [Compatibility](#14-compatibility)
15. [Support and resources](#15-support-and-resources)
16. [Version history](#16-version-history)

---

## 1. How it works

| | |
|---|---|
| npm package | `n8n-nodes-nx3` |
| n8n nodes | **IntellX for Sage X3** (credential: *IntellX for Sage X3 API*) and **IntellX Query Interpreter for Sage X3** (same credential, see [§8.3](#83-query-interpreter-an-x3-graphical-query-as-sql)) |
| Protocol | Sage X3 SOAP web services (Syracuse), `CAdxWebServiceXmlCC` |
| X3 side | `XCHATX3OBJ` sub-program, installed by the ChatX3 patch |
| Scope | Standard, vertical and custom objects and actions |
| Security | The Syracuse user's and the folder's function rights are enforced on every call |

Data flows **directly between your n8n instance and your Sage X3 server**. The
ChatX3 gateway is only contacted for license control (see
[§3.3](#33-license-endpoint)): no business data and no credential ever
transits through it.

Every call reproduces what an X3 user would do on screen. X3 runs it with
`GXCHATX3OBJ=1`, `GWEBSERV=1`, `GSERVEUR=0`, `GBATCH=0` and `GIMPORT=0`, so
standard, vertical and custom processes execute as if the user had typed the
values — with their rights, their default values and their validations.

Two limits follow from that:

- An object or action that opens **an extra window** beyond the base screen
  cannot be driven this way.
- **Table-type objects** are not handled by the ChatX3 patch yet.

## 2. Requirements

Tick every box before the first call. Sections 3 and 4 walk through each one.

- [ ] The **ChatX3 patch** is integrated on the X3 folder ([§3.1](#31-chatx3-patch))
- [ ] A **web services pool** is created, started and reachable from n8n ([§3.2](#32-soap-web-services-pool))
- [ ] The X3 runtime server can **reach the ChatX3 license endpoint** ([§3.3](#33-license-endpoint))
- [ ] The Syracuse user has the `statusAndUsage → Read` right ([§3.4](#34-syracuse-user-rights))
- [ ] The folder's X3 user has **Web services connection = Yes** ([§3.5](#35-x3-user-web-services-right))
- [ ] The `n8n-nodes-nx3` package is installed on the n8n instance ([§4](#4-installing-the-node-in-n8n))

## 3. Sage X3 setup

### 3.1 ChatX3 patch

1. Download the ChatX3 patch from [intellx.chat](https://intellx.chat/).
2. In Sage X3, open **Development → Utilities → Patches → Patch integration**.
3. Reproduce the checkboxes shown below, then run the integration.

![ChatX3 patch integration screen in Sage X3](docs/images/1_param_patch_chatx3.png)

> [!TIP]
> Integrate on a test folder first, and keep a backup of the folder before any
> patch operation.

### 3.2 SOAP web services pool

The pool must be reachable from the n8n instance (publicly, or through your
network).

**a.** Check that the Syracuse web server has **at least one SOAP child
process**:

![SOAP child process configuration on Syracuse](docs/images/3_Syracuse_SOAP.png)

**b.** Create and **start** a web services pool on the folder. Its alias is
what goes into the credential's *Pool Alias*:

![Web services SOAP pool created and started](docs/images/4_Pool-SOAP.png)

### 3.3 License endpoint

To verify the ChatX3 license, the **X3 runtime server** connects randomly once
or twice a week to:

```
https://akfcgzazfvqipbjvdemn.supabase.co
```

> [!IMPORTANT]
> Behind a proxy or a firewall, allow that URL outbound from the X3 runtime
> server. Without it the license check fails. Nothing else goes through it.

### 3.4 Syracuse user rights

The Syracuse user used by the credential needs, in its security profile:

> `statusAndUsage` → **Read**

![Syracuse security profile with the statusAndUsage read right](docs/images/5_profil-securite.png)

### 3.5 X3 user web services right

The folder's X3 user linked to that Syracuse user must have:

> **Web services connection** → **Yes**

![X3 user record with web services connection enabled](docs/images/6_Utilisateur-web-serv.png)

## 4. Installing the node in n8n

### 4.1 From the n8n interface (community nodes)

**1.** Open **Settings → Community nodes**.

![Settings → Community nodes menu in n8n](docs/images/7_n8n_1.png)

**2.** Click **Install**.

![Community nodes Install button](docs/images/8_n8n_2.png)

**3.** Enter `n8n-nodes-nx3`, tick the acknowledgement box, then click
**Install**.

![Entering the n8n-nodes-nx3 package name](docs/images/9_n8n_3.png)

**4.** In a new workflow, search for **"sage"** in the nodes panel.

![Searching for the Sage node in a new workflow](docs/images/10_n8n_4.png)

**5.** The **IntellX for Sage X3** node appears with its actions.

![IntellX for Sage X3 node and its actions](docs/images/11_n8n_5.png)

> [!NOTE]
> Installing community nodes requires an owner or admin account. On n8n Cloud,
> make sure community nodes are allowed on your plan. See the
> [n8n documentation](https://docs.n8n.io/integrations/community-nodes/installation/).

### 4.2 Self-hosted Docker, from source

To load the package straight from a checkout, build it and mount it into the
container's custom extensions folder:

```bash
npm install && npm run build
```

```bash
docker run -d --name n8n -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -v /path/to/n8n-nodes-nx3:/home/node/.n8n/custom/n8n-nodes-nx3:ro \
  n8nio/n8n
```

Restart the container after every rebuild.

> A package loaded from the `custom` folder is registered by n8n under the type
> `CUSTOM.nx3Soap` (and `CUSTOM.nx3SoapTool`). Recent n8n versions (2.x) also
> resolve `n8n-nodes-nx3.nx3Soap` to that same package; on an older version, a
> workflow exported from an instance where the package came from npm shows its
> nodes with a `?` icon and asks to install the package: edit the `type` of the
> nodes in the JSON before importing, or install from npm instead.

## 5. Credentials

You authenticate with your **Syracuse** user — the one you log into Sage X3
with — over HTTP Basic authentication.

| Field | Required | Description |
| --- | --- | --- |
| Base URL | ✅ | Scheme + host + port of the Syracuse server, e.g. `https://my-x3-host:8124`. The SOAP path is appended automatically. |
| Username | ✅ | Syracuse user ([§3.4](#34-syracuse-user-rights)) |
| Password | ✅ | Syracuse password |
| Code Language | | Default `codeLang` of the SOAP call context (`FRA`, `ENG`…). Defaults to `FRA`. |
| Pool Alias | | Default `poolAlias`, e.g. `POOL_SEED`. Must match an existing, **started** pool ([§3.2](#32-soap-web-services-pool)). |
| Pool ID | | Default `poolId`. Usually left empty. |
| Request Config | | Default `requestConfig`. The node adds the JSON-mode flags on its own. |
| Allow Self-Signed Certificates | | Skip TLS validation. For on-premise X3 with a self-signed certificate only; never for production over the Internet. |

The **Test** button sends a real `POST` to the SOAP endpoint the node calls,
with an empty `XCHATX3OBJ` payload. Reaching X3's answer proves the URL, the
port, the authentication and the pool all work; nothing is read or written. A
405 at this point means the Base URL is not the SOAP service — most often a
missing port (Syracuse listens on 8124 or 8443, rarely on 443).

## 6. Operations

| Operation | X3 action | What it does |
| --- | --- | --- |
| **Read Sage X3 Object** | `READ` | Read a record by its identifier and return its full field tree |
| **List Sage X3 Objects** | `LIST` | List the records of an object, with optional selection criteria |
| **Create Sage X3 Object** | `CREATE` | Create a record from a JSON payload |
| **Modify Sage X3 Object** | `MODIFY` | Update fields of an existing record |
| **Describe Sage X3 Object** | `DESC` | Get the screens, fields and local menus of an object class |
| **Custom Sage X3 Action** | *(free text)* | Send any `XACTION` the patch exposes, including future ones |
| **SQL Analyse** | `ANALYSE` | Check that a SQL query is valid, without returning rows |
| **SQL Select** | `SELECT` | Execute a SQL `SELECT` and return the rows |
| **Run Sub-Program (Advanced)** | *(raw XML)* | Call any X3 sub-program with a raw input payload — the escape hatch |

The **Action Code** field is always visible and pre-filled from the operation,
so you can see exactly which `XACTION` is sent, and override it if needed.

## 7. Object operations

### 7.1 Parameters

Shown for Read, List, Create, Modify, Describe and Custom:

- **Sage X3 Object Code** — the object code: `ITM` (items), `BPC` (customers),
  `SOH` (sales orders)…
- **Transaction Code** — the X3 entry transaction (`XTRANSACTION`). Leave
  empty for the default one.
- **Identifier** — the record's primary key (`XIDENT`). Required for Read and
  Modify. For Create it must match the key field in the data (e.g.
  `ITM0.ITMREF`) unless X3 generates the key. Optional for Custom, hidden for
  List and Describe. A **composite key** is written with `~` between its parts,
  in the order of the object's key: `FIN311~NA021` for an item-site record,
  `SMDIV~FR0120104SMDIV000001` for a journal entry, `FR012~BMS001~1~8` for a
  standard cost (site, item, version, fiscal year).
- **Data (JSON)** — the payload sent as `XDATAJSON`. Shown for Create, Modify,
  List and Custom.

### 7.2 Data JSON conventions

The payload mirrors the X3 screens: one key per **screen abbreviation**, and
inside it one key per field.

- Every field is dimensioned, so values are **arrays**: `"TSICOD": ["20"]` or
  `"TSICOD": ["20", "21", "99"]`.
- Target one index by adding `(n)` to the field name: `"TSICOD(1)": "21"`.
- Do not fill table footer and count variables (`NBLIG` and friends): X3 fills
  them.
- Dates are `"YYYY-MM-DD"`: `"SBSDAT": ["2026-05-01"]`.
- Clear a field with `""`, the integer `0`, or the date `"0000-00-00"`.

In the **output**, single-value arrays are unwrapped to scalars by default
(*Compact Single-Value Arrays*, [§10](#10-advanced-options)) — `["FR001"]`
comes back as `"FR001"`, while multi-value arrays stay arrays.

### 7.3 Context (optional)

An optional envelope merged into `XDATAJSON` as a top-level `context` key.
Leave it untouched and the payload is sent exactly as written.

| Option | Effect |
| --- | --- |
| Language | Override the XCHATX3OBJ language for this call (e.g. `ITA`). A different layer from the SOAP-level `codeLang` of the credential. |
| User | Run the call as another user (e.g. `FU01`). Only honored when the caller has `GPROFIL=ADMIN`. |
| Response Screens | Return only these screens, e.g. `ITM0`, `ITM1`. |
| Response Fields | Return only these fields, e.g. `DES1AXX`. |
| Include Hidden Fields | Include hidden and technical fields, excluded by default. |

Resulting payload:

```json
{
  "context": {
    "language": "ITA",
    "user": "FU01",
    "response": { "screens": ["ITM0"], "fields": ["DES1AXX"], "hidden_fields": true }
  },
  "ITM0": { "DES1AXX": ["New description"] }
}
```

### 7.4 Read

Reads one record. Example on the SEED folder — object `GAS`, transaction
`1PAGE`, identifier `SMDIV~FR0120104SMDIV000001`, no data:

```json
{
  "success": true,
  "action": "READ",
  "object": "GAS",
  "ident": "SMDIV~FR0120104SMDIV000001",
  "transaction": "1PAGE",
  "data": {
    "HAE1": {
      "TYP": "SMDIV",
      "NUM": "FR0120104SMDIV000001",
      "CPY": "FR10",
      "FCY": "FR012",
      "JOU": "ODDIV",
      "ACCDAT": "2024-04-01",
      "CUR": "EUR",
      "NUMLIG": [1, 2],
      "ACC1": ["608801", "486000"],
      "ACCDES": ["Insurance invoiced", "Prepaid expenses"],
      "AMT1": [1000, 1000],
      "TOTDEB": 1000,
      "TOTCDT": 1000,
      "NBLIG": 2
    }
  },
  "messages": [{ "trace": "F64843" }],
  "trace": "F64843",
  "sessionId": "6784"
}
```

### 7.5 List

Reads the object's main left list through an advanced selection. The payload
takes two optional keys:

```json
{
  "list_nb": 10,
  "list_filters": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
}
```

- `list_nb` — number of rows to return. Default: the folder's `GNBGAUCHE`
  parameter, or 100.
- `list_filters` — an X3 selection expression on any field of the main table,
  in `[F:TABLE]FIELD` syntax. It is added to the object's own filters, which
  are echoed back under `filters`.

The output carries the column codes and titles once, and the rows as arrays:

```json
{
  "table_count": 1193,
  "list_count": 10,
  "filters": {
    "CRITERE(0)": "1=1",
    "FILTSUP(0)": "SOHCAT < 4",
    "FILRAP(0)": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
  },
  "codes":  ["[F:SOH]SOHNUM", "[F:SOH]BPCORD", "[F:SOH]ORDDAT", "[F:SOH]CUSORDREF", "[F:SOH]DLVSTA"],
  "titles": ["Order no.", "Order customer", "Order date", "Reference", "Delivery status"],
  "values": [
    ["SOWDE0120012", "DE001", "2025-07-21", "WEB015182112", 1],
    ["SOWDE0120011", "DE001", "2025-12-21", "WEB015182112", 2]
  ]
}
```

`table_count` is the size of the whole table, `list_count` the number of rows
returned. To get one n8n item per row, split on `data.values` and map the
positions through `data.codes`.

### 7.6 Create

Creates a record. Example on SEED — a sales quote, object `SQH`:

```json
{
  "SQH0": { "BPCORD": ["FR001"], "SALFCY": ["FR021"], "SQHTYP": ["SQN"] },
  "SQH1": { "STOFCY": ["FR021"], "VACBPR": ["FRA"] },
  "SQH2": { "GROPRI": [1000], "ITMREF": ["ASS001"], "QTY": [1] }
}
```

X3 answers with the record as saved — including the fields it computed, such
as the generated number — and its user messages:

```json
{
  "success": true,
  "action": "CREATE",
  "object": "SQH",
  "data": {
    "SQH0": {
      "SQHNUM": "FR0212605SQN00000001",
      "SQHTYP": "SQN",
      "BPCORD": "FR001",
      "BPCNAM": "Urban Cycle",
      "SALFCY": "FR021",
      "CUR": "AED",
      "QUODAT": "2026-05-28"
    }
  },
  "messages": [
    { "trace": "F64842" },
    { "info": "Object created: FR0212605SQN00000001" },
    { "alert": "Access not allowed on this item (Elaboration)" }
  ],
  "trace": "F64842",
  "sessionId": "6784"
}
```

Note the `alert`: X3 can report `success: true` and still carry warnings, or
even an `error`. See [§9](#9-output) for how to gate on them.

### 7.7 Modify

Updates fields of an existing record. Example on SEED — object `SOH`,
transaction `STD`, identifier `SOWFR0110003`, quantity of line 1 set to 7:

```json
{
  "SOH4": { "QTY(1)": [7] }
}
```

```json
{
  "success": true,
  "action": "MODIFY",
  "object": "SOH",
  "ident": "SOWFR0110003",
  "data": {
    "SOH0": { "SOHNUM": "SOWFR0110003", "SOHTYP": "WEB", "BPCORD": "FR004", "BPCNAM": "Micro Systems", "SALFCY": "FR011", "CUR": "EUR", "ORDDAT": "2026-05-22" },
    "SOH4": { "ITMREF": ["DIS009", "DIS007"], "QTY": [1, 7], "GROPRI": [220, 250], "NBLIG": 2 }
  },
  "messages": [
    { "trace": "F64844" },
    { "alert": "Do you want to recalculate prices and discounts?   (No)" }
  ],
  "trace": "F64844",
  "sessionId": "6784"
}
```

A question X3 would ask on screen is answered with its default and reported as
an `alert`, as above.

> X3 keeps a lock on a record read through the same session. To chain a Read
> and a Modify on one record, pass the Read's `sessionId` to the Modify's
> **Pool ID Override** ([§12](#12-workflow-recipes)), or skip the Read.

### 7.8 Describe

Returns the metadata of the object class: its screens, each with the fields
(name, type, length, dimension, required flag, description, local menu number)
and blocks, then the local menus used, with their lines. It is what an AI Agent
should call before a Create to learn the payload shape.

```json
{
  "screens": {
    "screen_code": "ACV2",
    "screen_name": "Activity codes",
    "fields": [
      { "name": "CODACT", "system_type": "Char", "length": 5, "dimension": 1, "required": true, "description": "Activity code", "type": "ACV" },
      { "name": "FLACT", "menu_number": 1, "system_type": "Integer", "description": "Active", "type": "M" }
    ],
    "blocks": [{ "code": "10", "description": "Identifier", "type": "List" }]
  },
  "local_menus": [
    { "menu_number": 1, "menu_name": "No/Yes", "lines": [{ "line_number": 1, "message": "No" }, { "line_number": 2, "message": "Yes" }] }
  ]
}
```

### 7.9 Custom action and Run Sub-Program

**Custom Sage X3 Action** sends the object code, identifier and data with any
`XACTION` you type — for actions the ChatX3 patch exposes beyond the five
above, including ones added by a later patch version.

**Run Sub-Program (Advanced)** bypasses `XCHATX3OBJ` altogether: you name the
public sub-program and pass its raw input XML (wrapped in CDATA for you). The
output is the generic envelope of [§9](#9-output) with the sub-program's
result, for anything the object layer does not cover.

## 8. SQL operations

**SQL Analyse** validates a query without running it; **SQL Select** runs it
and returns the rows. Both accept optional **Max Lines** and **Max Time
(Seconds)** caps, sent to X3 as `context.max_lines` and `context.max_time`.

> `Max Time` caps the execution *inside X3*; **Request Timeout** in Advanced
> Options caps the HTTP call (30 s by default). Keep the former below the
> latter, or the request gives up before X3 does.

Queries are written in the dialect of the database behind X3 — T-SQL on
Microsoft SQL Server, PL/SQL on Oracle.

### 8.1 Query parameters

Rather than concatenating values into the query — unsafe, above all when an AI
Agent supplies them — declare them under **Query Parameters** and reference
them with `{{name}}`:

```sql
SELECT TOP (100) [USR_0], [CREUSR_0], [CREDAT_0]
FROM   [AUTILIS]
WHERE  USR_0 IN ({{logins}})
  AND  CREDAT_0 BETWEEN {{from}} AND {{to}}
[[AND  CREUSR_0 = {{creator}}]]
```

- Each value is escaped according to its **Type** and produces a *complete*
  literal: never wrap `{{name}}` in quotes yourself.
- `[[ ... ]]` marks an **optional clause**: dropped entirely when its
  parameters are empty, kept otherwise. Ideal for filters an agent may or may
  not fill in.
- A `{{name}}` used outside an optional clause with no value raises a clear
  error rather than silently changing the query.
- **Comments disable parameters.** Markers inside a `--` line comment, a
  `/* ... */` block or a string literal are left untouched, so commenting a
  filter line out works exactly as a SQL reader expects.

| Type | Rendering | Use for |
| --- | --- | --- |
| Text | `'value'`, embedded quotes doubled | `=`, or a `LIKE` where you write the pattern yourself |
| Contains | `'%value%'`, with `%` `_` `[` inside the value escaped | `LIKE {{name}}` — type `dupont`, not `%dupont%` |
| Number | bare, validated numeric | `>`, `<`, `>=` |
| Date | quoted, `YYYY-MM-DD` or ISO-8601 | `BETWEEN`, comparisons |
| Boolean | `1` / `0` | flags |
| List | `'a','b','c'` — comma-split, each quoted | `IN ({{name}})` |

> **Contains** escapes the LIKE wildcards inside the value: searching for
> `remise 50%` looks for that exact text instead of everything starting with
> `remise 50`.

> Use **List**, not Text, for `IN ({{name}})`. A Text value holding `a,b`
> becomes the single literal `'a,b'` and matches nothing; the node detects that
> case and tells you to switch type. A List value cannot itself contain a
> comma, since the comma is the separator.

#### Parameters as JSON

**Parameters Mode** picks where the values come from. **Fields** is the list
above. **JSON** takes the whole list in one field, as an array of
`{ "name", "type", "value" }` objects, which is what you want when the query
*and* its parameters are decided upstream — a catalogue of queries, a generic
sub-workflow, a Code node that builds the filters:

```
SQL Query:               ={{ $json.sqlQuery }}
Parameters Mode:         JSON
Query Parameters (JSON): ={{ $json.params }}
```

with, on the incoming item:

```json
{
  "sqlQuery": "SELECT … WHERE 1 = 1 [[AND BPCNUM_0 IN ({{customer}})]] [[AND CREDAT_0 >= {{from}}]]",
  "params": [
    { "name": "customer", "type": "list", "value": ["FR001", "FR002"] },
    { "name": "from",     "type": "date", "value": "2025-01-01" }
  ]
}
```

`value` may be a string, a number, a boolean, `null` or an array (joined with
commas for a List). The same escaping and `[[ ... ]]` rules apply; an unknown
`type` is an error rather than a silent fallback to Text. The template in
[§12](#12-workflow-recipes) builds a whole MCP server on this mode.

### 8.2 Simplify and Row Format

Sage X3 returns SQL rows with generic keys — `Col_1`, `Col_2`… — losing the
link to the selected columns. Turn on **Simplify** (SQL Select only) to get the
rows with their real names restored from the query:

```json
{
  "rowCount": 3,
  "columns": ["USR_0", "CREUSR_0", "CREDAT_0"],
  "rows": [{ "USR_0": "ADMCA", "CREUSR_0": "ADMIN", "CREDAT_0": "2015-08-14" }]
}
```

The envelope shrinks to the data itself: `success`, `messages` and `trace`
only appear when something went wrong, so a failure is never silent while the
happy path stays cheap to read — which matters when the rows feed an AI Agent.
When the row count reaches **Max Lines**, `truncated: true` is added: Sage X3
stops at the cap without saying so, and the flag is how a workflow or an agent
tells a complete result from a slice.

Dates come back as plain `YYYY-MM-DD`, and X3's `0000-00-00` "not set"
sentinel becomes `null`. The time part is dropped only when it is exactly
midnight UTC, so a genuine timestamp keeps its full value.

**Row Format** then picks the row shape:

- **Objects** (default) — one key per column, easiest for expressions such as
  `{{ $json.rows[0].USR_0 }}`, and rendered natively by the n8n Table view.
- **Arrays** — values only, ordered like `columns`. Far more compact: the
  right choice when the rows go to an AI Agent.

Column names are read after SQL comments are stripped, so a query may open with
a `/* ... */` documentation header and carry comments between select items;
string literals are left alone. The renaming is best-effort and never reorders
or drops data: with `SELECT *`, an unresolvable expression or any count
mismatch, the original `Col_N` keys are kept. Leave Simplify off to get the
full envelope of [§9](#9-output).

### 8.3 Query Interpreter: an X3 graphical query as SQL

The package ships a second node, **IntellX Query Interpreter for Sage X3**, on
the same credential. Give it the code of a Sage X3 graphical query (object
`ALT`, the *Requêteur graphique*): it reads the definition from X3, renders it
as a SQL `SELECT`, runs it through the same path as `SQL Select` and returns
the rows. A query a key user designed in X3 thus becomes one n8n node, with
the X3 bounds screen as parameters, ready to be scheduled or handed to an AI
Agent without rewriting it by hand.

A query is stored as an X3PORTAL XML document in `ALT1.CLBFL`: the tables and
their aliases, the links between them, and the columns dropped on the grid.
The selection criteria sit next to it in `ALT2.SEL`, written in the X3 4GL
expression language. The node turns all of it into SQL:

| X3 | SQL |
| --- | --- |
| `<Table Id="SQH" Name="SQUOTE">` | `FROM [SQUOTE] SQH` |
| `<Link Sid="[ITP]BPSNUM" Tid="[BPS]BPSNUM" Join="L">` | `LEFT JOIN [BPSUPPLIER] BPS ON ITP.BPSNUM_0 = BPS.BPSNUM_0` (`I` inner, `R` right; several links on the same pair merge into one `ON`) |
| `[F:SQH]BPCNAM(1)` | `SQH.BPCNAM_1` |
| `<DroppedField Expr="[SQH]BPCORD" Lbl="Customer">` | `SQH.BPCORD_0 AS [Customer]` |
| `Expr="=+1"` | `1 AS [Nombre]` (formula column) |
| `&`, `\|`, `!` | `AND`, `OR`, `NOT` |
| `"text"`, `'text'` | `'text'` |
| `[0/0/0]`, `[31/12/2025]` | `'1753-01-01'`, `'2025-12-31'` (Oracle: `DATE '1599-12-31'`) |
| `date$`, `datetime$` | `CAST(GETDATE() AS date)`, `GETDATE()` (Oracle: `TRUNC(SYSDATE)`, `SYSDATE`) |
| `left$`, `right$`, `mid$`, `len`, `toupper`, `tolower`, `num$`, `val`, `int`, `abs`, `year`, `month`, `day`, `gdat$`, `string$`, `instr`, `pat` | the matching SQL Server or Oracle function |
| `Sort="A"` / `"D"` | `ORDER BY`, by break level then column order |
| `MAXLIG` (Max lines) | `TOP (n)` (Oracle: `FETCH FIRST n ROWS ONLY`) |

Anything the node cannot translate (an X3 global variable such as `GUSER`, a
`func` call, an unknown function) is left as-is in the SQL and listed in
`warnings`, so the result is never silently wrong.

**Parameters**

- **Query Source** — *Query Code* (default) reads the `ALT` record from Sage
  X3. *Incoming Item* takes the definition from the incoming item, as produced
  by `Read Sage X3 Object` on `ALT` (it looks for `data.ALT1.CLBFL`, the bare
  `ALT1.CLBFL`, or a `CLBFL` string). *Manual* takes the XML and the criteria
  as fields.
- **Execute** — on by default: the SQL is run on Sage X3 and the rows come
  back. Off: the node returns the SQL and the query structure only.
- **Bounds** — the X3 bounds screen: one row per column with a *From* and a
  *To* value, both inclusive, either side may stay empty. Name the column by
  its field (`BPCORD`), by alias and field (`SQH_BPCORD`) or by its grid label
  (`Customer`). Only the columns the query marks as bounded (`Bounds="Y"`) are
  accepted; an unknown name fails with the list of bounded columns. Values are
  escaped by type (`date`, `number`, `text`, from the X3 data types), never
  concatenated raw.
- **Options**
  - *Bounds as Parameters* — when Execute is off, keep an optional
    `[[AND col >= {{ALIAS_FIELD_from}}]]` / `[[AND col <= {{ALIAS_FIELD_to}}]]`
    clause per bounded column, in the syntax of [§8.1](#81-query-parameters),
    with the typed parameter list under `parameters`. Always on when Execute
    is on.
  - *Column Aliases* — `Label` (the grid label, `[Customer name]`), `Code`
    (`SQH_BPCNAM`, formulas as `EXPR_n`) or `None`.
  - *Include Hidden Columns* — keep the `Vis="N"` columns in the `SELECT`.
  - *Include Query Structure* — add tables, joins, columns, criteria and
    order by next to the rows.
  - *Include Table Fields* — add every field and index of each table.
  - *Max Lines* — `-1` keeps the query's own cap, `0` removes it, any other
    value replaces it; also sent to X3 as `max_lines`.
  - *Max Time (Seconds)* — the X3 `max_time` cap.
  - *Row Format* — `Objects` (default) or `Arrays`, as in
    [§8.2](#82-simplify-and-row-format).
  - *Schema* — folder prefix for table names, e.g. `SEED` or `basex3.SEED`.
    Not needed when the SQL runs through X3, which is already in the folder.
  - *SQL Dialect* — SQL Server (default) or Oracle.
- **Advanced Options** — the same call overrides as the main node: code
  language, pool alias and id, public name, request timeout, and *Include
  Request in Output* for the SQL call.

**Output**

With Execute on, the same shape as `SQL Select` with Simplify, plus the query
identity and the SQL that was run:

```json
{
  "code": "FRVEN055",
  "title": "Open Quotes",
  "rowCount": 12,
  "columns": ["Customer", "Customer name", "Sales site", "Quote date", "Quote no."],
  "rows": [{ "Customer": "FR001", "Customer name": "Urban Cycle", "Sales site": "FR011", "Quote date": "2026-09-02", "Quote no.": "SQHFR0110042" }],
  "sql": "SELECT\n  SQH.BPCORD_0 AS [Customer],\n  ...\nFROM [SQUOTE] SQH\nWHERE (SQH.QUOSTA_0 = 1)\n  AND SQH.BPCORD_0 >= 'FR'\nORDER BY SQH.BPCORD_0 ASC"
}
```

`truncated: true` appears when the row count reaches the cap, `warnings` when
part of the query could not be translated. With Execute off, the structure:

```json
{
  "code": "FRVEN055",
  "title": "Open Quotes",
  "objectLink": "SQH",
  "functionLink": "EXEALH",
  "tables": [{ "alias": "SQH", "name": "SQUOTE", "label": "Quote header", "sql": "[SQUOTE]" }],
  "joins": [],
  "columns": [
    { "position": 1, "label": "Customer", "expression": "[SQH]BPCORD", "sql": "SQH.BPCORD_0",
      "alias": "Customer", "visible": true, "sort": "asc", "level": 1, "sum": false, "bounds": true, "type": "BPR" }
  ],
  "criteria": [{ "x3": "[F:SQH]QUOSTA=1", "sql": "SQH.QUOSTA_0 = 1" }],
  "orderBy": [{ "sql": "SQH.BPCORD_0", "direction": "asc" }],
  "parameters": [],
  "sql": "SELECT\n  SQH.BPCORD_0 AS [Customer],\n  ...\nFROM [SQUOTE] SQH\nWHERE ...\nORDER BY SQH.BPCORD_0 ASC",
  "warnings": []
}
```

`sum: true` marks a column the X3 grid totals at each break; the SQL keeps the
detail rows, as the grid does, and leaves the aggregation to you. `level` is
the break level of the column.

## 9. Output

Object operations return one item per input item, shaped as:

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
  "messages": [{ "trace": "F1730" }],
  "trace": "F1730",
  "sessionId": "6784"
}
```

| Field | Description |
| --- | --- |
| `success` | `true` when X3 reports the action succeeded (`XRETURNJSON.success`, fallback `status === 1`). |
| `status` | Raw X3 status: `1` OK, `0` failure. |
| `action` / `object` / `ident` / `transaction` | Echo of the request, for traceability. |
| `data` | The object payload (`XDATAJSON`), parsed into a navigable object. |
| `messages` | X3 user messages — `info`, `error`, `alert` — and the `trace` entry. |
| `trace` | The X3 trace name. A standard X3 trace is always written; quote it in a support request. |
| `sessionId` | The X3 pool entry that handled the call. Pass it back as **Pool ID Override** to chain calls on the same session. |
| `technicalInfos` | Pool and timing metrics (`poolExecDuration`, `totalDuration`…). Only present when **Include Technical Infos** is on. |

> X3 may report `success: true` and still include an `error` message (an
> access-level check, for instance). To gate a workflow strictly, test the
> messages in an IF node: `{{ !($json.messages || []).some(m => m.error) }}`

SQL Select with Simplify on returns the reduced shape of [§8.2](#82-simplify-and-row-format) instead.

On a transport or HTTP failure the node raises a one-sentence message naming
the cause and the URL called (timeout, connection refused, unknown host, 401,
403, 404, 405, 407, 502-504). With **Continue on Fail** the item carries
`error`, `httpStatus` and `url` instead of stopping the workflow.

## 10. Advanced options

All optional. Output-shaping options default to **on**; debug and override
options default to **off**.

| Option | Default | Purpose |
| --- | --- | --- |
| Compact Single-Value Arrays | on | Unwrap single-element arrays: `["Iconext"]` → `"Iconext"`. Multi-value arrays stay arrays. |
| Trim Trailing Empty Values | on | Drop the trailing empty values X3 pads dimensioned fields with: `["A","",""]` → `["A"]`. |
| Request Timeout (Seconds) | 30 | Abort the SOAP call when X3 does not answer, instead of hanging. |
| Code Language Override | — | Override the credential `codeLang` for this call. |
| Pool Alias Override | — | Override the credential `poolAlias` for this call. |
| Pool ID Override | — | Pin the call to a given X3 session, e.g. `={{ $json.sessionId }}` from a previous step, to keep a record lock across Read → Modify. |
| Public Name Override | — | Call another sub-program than `XCHATX3OBJ`. |
| Include Request in Output | off | Add `request` — the URL called, the JSON payload and the SOAP envelope sent — for debugging. |
| Include Result in Output | off | Add `result`, the parsed X3 result payload, for debugging. |
| Include Technical Infos | off | Add `technicalInfos`, the X3 pool and timing metrics. About a quarter of each item; keep it off when the node feeds an AI Agent. |
| Include Raw SOAP Response | off | Add `raw`, the full SOAP envelope as XML, for transport-level debugging. |

## 11. AI Agent and MCP

The node has `usableAsTool` enabled: attach it to an **AI Agent** node for
object operations ("find item BMS009", "create a customer") as well as SQL
Select. n8n generates the tool variant on its own — `n8n-nodes-nx3.nx3SoapTool`
in workflow JSON — with a **Description** field the model reads to pick the
tool. The same tool nodes can be wired to an **MCP Server Trigger** to expose
them to Claude, Cursor or any MCP client.

The *Query Sage X3 in natural language with an AI agent and an MCP server*
template on n8n.io is a complete agent + MCP setup built on this node.

### 11.1 Two ways to wire a SQL tool

- **The agent writes the query** — put `$fromAI` on **SQL Query**. Flexible,
  but the model composes the SQL itself and can reach any table.
- **The query is fixed, the agent only fills values** — write the query once
  with `[[ ... ]]` optional clauses and put `$fromAI` on the **Value** of each
  Query Parameter. The model cannot write SQL, values are escaped by the node,
  and unfilled filters disappear on their own. **Prefer this one.**
- **The queries live in a catalogue, one runner executes them** — a
  sub-workflow receives a query name and a filters object, looks the query up
  in a JSON catalogue, validates the filters, and calls one SQL Select node in
  **Parameters Mode: JSON**. The agent and the MCP clients see two tools,
  `x3_query_catalog` and `x3_query_run`, whatever the size of the catalogue.
  Adding a query is one JSON entry, and adds no tool.
  This is the design of the template in
  [`templates/sage-x3-sql-mcp/`](templates/sage-x3-sql-mcp/README.md).

### 11.2 Make optional filters actually optional

`$fromAI('name', 'description', 'string')` produces a **mandatory** field: n8n
only marks it optional when the call carries a fourth argument, the default
value. Without it the model is forced to supply a value on every call, an
`[[ ... ]]` clause can never be dropped, and the call is rejected before it
reaches the node with `Received tool input did not match expected schema`.

So end every parameter that backs an optional filter with an empty default:

```
={{ $fromAI('creator', 'Creator code. Leave empty to skip this filter', 'string', '') }}
```

The red asterisk next to the field in the tool's Test dialog disappears once
it is right. Keep the default off for genuinely required inputs — reading a
record without its identifier makes no sense.

### 11.3 Keep tool calls cheap

Every byte of a tool result is paid for in tokens, on every call:

- **Row Format: Arrays** on SQL tools, with a `maxLines` cap sized for the
  question, not for the table.
- **Include Technical Infos** off (the default).
- Describe once, then create — rather than guessing the payload shape.
- Write operations as tools really write into X3. The system prompt can require
  a confirmation on the conversational path; a direct MCP call bypasses it.
  Expose only what you mean to.

## 12. Workflow recipes

**Read an item**

- Operation `Read Sage X3 Object`, object `ITM`, identifier `ASS001`.

**Modify an item description**

- Operation `Modify Sage X3 Object`, object `ITM`, identifier `ASS001`,
  data `{ "ITM0": { "DES1AXX": ["New description"] } }`.

**Read → Modify on the same X3 session (keep the lock)**

1. The `Read Sage X3 Object` node returns `sessionId`.
2. In the following `Modify Sage X3 Object` node, set **Advanced Options →
   Pool ID Override** to `={{ $('Read Sage X3 Object').item.json.sessionId }}`.

**List → one item per row**

1. `List Sage X3 Objects` on `ICD` with data `{"list_filters": "[F:ITC]FIYNUM >= 8"}`.
2. A **Split Out** node on `data.values`.
3. A `Read Sage X3 Object` whose identifier maps the positions, e.g.
   `={{ $json['1'] }}~{{ $json['0'] }}~1~{{ $json['6'] }}`.

**A generic SQL MCP server from a query catalogue**

- The template in [`templates/sage-x3-sql-mcp/`](templates/sage-x3-sql-mcp/README.md)
  stores its queries and WHERE filters in a JSON catalogue, runs them all through
  one runner sub-workflow in **Parameters Mode: JSON**, and exposes only **five
  tools** on an AI Agent and an MCP Server: `x3_query_catalog` and
  `x3_query_run` for every query, `x3_object` (describe, list, read) and
  `x3_object_write` (create, modify) through an object runner, and
  `x3_object_guide`. Adding a query is one JSON entry and one SQL file, and
  adds no tool.

**Filtered SQL Select**

- Operation `SQL Select`, Simplify on, query:
  ```sql
  SELECT TOP (200) [SOHNUM_0], [BPCORD_0], [ORDDAT_0]
  FROM   [SORDER]
  WHERE  1 = 1
  [[AND  [BPCORD_0] = {{customer}}]]
  [[AND  [ORDDAT_0] >= {{from}}]]
  ```
- Query Parameters `customer` (Text) and `from` (Date): leave either empty to
  drop its clause.

**Run an X3 graphical query (Requêteur) with bounds**

- `IntellX Query Interpreter for Sage X3`, Query Source *Query Code*, code
  `FRVEN055`, Execute on, one Bound: column `BPCORD`, from `FR`, to `FRZZZ`.
- The node reads the query, builds the SQL and returns the rows in one step.
  Turn Execute off to see the SQL and the structure instead, and feed the
  `sql` to a `SQL Select` node if you want to edit it by hand first.

## 13. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `405 Method Not Allowed` at credential test or at run time | The Base URL is a web server, not the SOAP service — most often the port is missing (`:8124` or `:8443`). |
| `401` / `403` | Wrong Syracuse password, or the user is not allowed to call web services ([§3.4](#34-syracuse-user-rights), [§3.5](#35-x3-user-web-services-right)). |
| `self-signed certificate` | Enable **Allow Self-Signed Certificates** in the credential. |
| Timed out / connection refused / host not found | X3 is unreachable: check the Base URL and the network; raise **Request Timeout** if the server is merely slow. |
| `No Pool: <alias>` | The pool is not started or the alias is wrong ([§3.2](#32-soap-web-services-pool)). |
| `Insufficient access level` / `Niveau d'accès insuffisant` | The Syracuse user lacks function rights on the object. |
| `Modification in progress on another workstation` | A previous Read still holds the record lock. Chain with **Pool ID Override**, or skip the Read. |
| `Erreur zone [M:...]<field>` | Field validation failed: check that the identifier matches the key field in the data, the value formats, and the counters. |
| SQL Select returns 0 rows with an `IN` filter | The parameter is typed Text instead of **List**. |
| Imported nodes show a `?` icon and n8n asks to install `n8n-nodes-nx3` | Type mismatch between npm install (`n8n-nodes-nx3.nx3Soap`) and custom-folder install (`CUSTOM.nx3Soap`). Edit the node `type` in the JSON ([§4.2](#42-self-hosted-docker-from-source)). |
| `Received tool input did not match expected schema` | A `$fromAI` without a fourth argument makes the field mandatory ([§11.2](#112-make-optional-filters-actually-optional)). |
| The license check fails | The X3 runtime server cannot reach the license endpoint ([§3.3](#33-license-endpoint)). |

When reporting a problem, include the **X3 trace name** returned in `trace`.

## 14. Compatibility

- **n8n 1.x and 2.x** (Nodes API v1). Tested on n8n 2.17.
- No runtime dependency: response parsing is done without external libraries,
  as required for n8n Cloud verification.
- **Sage X3 V12** (`CAdxWebServiceXmlCC`, Apache Axis 1.4 SOAP stack) with the
  ChatX3 `XCHATX3OBJ` sub-program.

## 15. Support and resources

- 🐛 Bug or feature request: [GitHub issues](https://github.com/adrien-ge/n8n-nodes-nx3/issues)
- 💬 Contact: [contact@intellx.chat](mailto:contact@intellx.chat)
- 🌐 [intellx.chat](https://intellx.chat)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Sage X3 SOAP web services guide](https://online-help.sageerpx3.com/erp/12/wp-static-content/static-pages/en_US/web-services/Configuration_management.html)

Before opening an issue, check the [requirements](#2-requirements) and attach
the X3 trace name.

## 16. Version history

The full history is in [CHANGELOG.md](CHANGELOG.md).

- **0.6.0** — **Parameters Mode: JSON** on SQL operations; `truncated` flag on
  Simplify; numeric caps accepted from string expressions; generic MCP template
  with a query catalogue and a runner sub-workflow.
- **0.5.2** — Credential test does a real POST on the SOAP endpoint; HTTP
  failures explained with the URL called; `technicalInfos` now opt-in.
- **0.5.1** — Simplify recovers column names on a query that opens with a
  comment.
- **0.5.0** — **Contains** parameter type; Simplify output reduced to
  `{ rowCount, columns, rows }`; SQL dates as `YYYY-MM-DD`, `0000-00-00` as
  `null`.
- **0.4.0** — First release on npm: Describe, Context envelope, SQL Analyse and
  Select with Query Parameters and Simplify, Request Timeout and readable
  network errors.
- **0.2.0** — List and Custom operations; Action Code always visible; node
  renamed *IntellX for Sage X3*.
- **0.1.0** — Read, Create, Modify, Run Sub-Program; native X3 JSON mode;
  output shaping; session affinity; `usableAsTool`.

---

<p align="center"><sub>IntellX for Sage X3 — Sage X3 integration for n8n</sub></p>
