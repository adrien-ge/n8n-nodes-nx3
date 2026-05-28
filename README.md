# n8n-nodes-nx3

This is an n8n community node. It lets you read, create and modify **Sage X3** objects from your n8n workflows.

**nX3 by IntellX** talks to Sage X3's `CAdxWebServiceXmlCC` SOAP web service through the `XCHATX3OBJ` sub-program (ChatX3 patch). You work entirely with JSON — the node builds the SOAP request, asks X3 to answer in native JSON, and returns a clean, ready-to-use object. No XML wrangling required.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Node parameters](#node-parameters)
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

The node exposes one resource (the X3 object API) with the following operations:

| Operation | X3 action | Description |
| --- | --- | --- |
| **Read X3 Object** | `READ` | Read an object by its identifier and return its full field tree |
| **Create X3 Object** | `CREATE` | Create a new object from a JSON payload |
| **Modify X3 Object** | `MODIFY` | Update fields of an existing object |
| **Run Sub-Program (Advanced)** | `run` | Call any X3 sub-program with a raw input payload (escape hatch) |

> The patch ChatX3 currently supports READ, CREATE and MODIFY. Table-type objects are not yet handled.

## Credentials

You authenticate with your **Syracuse** user (the same credentials you use to log into Sage X3), via HTTP Basic Authentication.

**Prerequisites**

- A reachable Sage X3 server exposing the SOAP endpoint
- A Syracuse user with the required function rights on the objects you intend to read/create/modify
- The `XCHATX3OBJ` sub-program published in your X3 environment (ChatX3 patch)

**Credential fields (`nX3 by IntellX API`)**

| Field | Required | Description |
| --- | --- | --- |
| Base URL | ✅ | Scheme + host (+ port) of the X3 server, e.g. `https://my-x3-host:8124`. The SOAP path is appended automatically. |
| Username | ✅ | Syracuse user |
| Password | ✅ | Syracuse password |
| Code Language | | Default `codeLang` for the call context (e.g. `FRA`, `ENG`). Defaults to `FRA`. |
| Pool Alias | | Default `poolAlias` (e.g. `POOL_SEED`). Must match an existing, started X3 connection pool. |
| Pool ID | | Default `poolId` (usually left empty). |
| Request Config | | Default `requestConfig`. The node adds the JSON-mode flags automatically. |
| Allow Self-Signed Certificates | | Skip TLS validation. Useful for on-prem X3 with a self-signed certificate; do not enable for production over the Internet. |

The credential **Test** button calls the WSDL endpoint with your credentials to confirm connectivity.

## Node parameters

For **Read / Create / Modify**:

- **X3 Object Code** — the object code, e.g. `ITM` (articles), `BPC` (customers), `SOH` (sales orders).
- **Transaction Code** — X3 transaction (`XTRANSACTION`); leave empty for the default.
- **Identifier** — the object's primary key (`XIDENT`). Required for Read/Modify. For Create, it must usually match the key field in the data (e.g. `ITM0.ITMREF`) unless X3 auto-generates it.
- **Data (JSON)** — for Create/Modify, the screen abbreviations and fields to set.

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

## Output

The node always returns a clean JSON object:

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

## Advanced options

All optional. The output-shaping ones default to **on**; debug and override options default to **off**.

| Option | Default | Purpose |
| --- | --- | --- |
| Compact Single-Value Arrays | on | Unwrap single-element arrays: `["Iconext"]` → `"Iconext"`. Multi-value arrays stay arrays. |
| Trim Trailing Empty Values | on | Drop trailing empty values X3 pads dimensioned fields with: `["A","",""]` → `["A"]`. |
| Code Language Override | — | Override the credential `codeLang` for this call. |
| Pool Alias Override | — | Override the credential `poolAlias` for this call. |
| Pool ID Override | — | Pin the call to a specific X3 session (e.g. `={{$json.sessionId}}` from a previous step) to preserve object locks across Read → Modify. |
| Public Name Override | — | Call a different sub-program than `XCHATX3OBJ`. |
| Include Request in Output | off | Add `request` (the JSON payload sent + the SOAP envelope) for debugging. |
| Include Result in Output | off | Add `result` (the parsed X3 result payload, navigable) for debugging. |
| Include Raw SOAP Response | off | Add `raw` (the full SOAP envelope as XML) for low-level transport debugging. |

## Use as an AI Agent tool

This node has `usableAsTool` enabled, so it can be attached to an **AI Agent** node. The agent can read, create or modify X3 objects on demand (e.g. "find item BMS009", "create a customer record"). Give the agent clear instructions about which object codes and fields to use.

## Compatibility

- Requires **n8n 1.x** (Nodes API v1).
- No runtime dependencies — response parsing is done without external libraries, so the node is compatible with n8n Cloud's verification requirements.
- Tested against **Sage X3 V12** (`CAdxWebServiceXmlCC`, Apache Axis 1.4 SOAP stack) with the ChatX3 `XCHATX3OBJ` sub-program.

## Usage examples

**Read an item**

- Operation: `Read X3 Object`
- X3 Object Code: `ITM`
- Identifier: `ASS001`

**Modify an item description**

- Operation: `Modify X3 Object`
- X3 Object Code: `ITM`
- Identifier: `ASS001`
- Data (JSON): `{ "ITM0": { "DES1AXX": ["New description"] } }`

**Read → modify on the same X3 session (preserve the lock)**

1. A `Read X3 Object` node returns `sessionId`.
2. In the following `Modify X3 Object` node, set **Advanced Options → Pool ID Override** to `={{ $('Read X3 Object').item.json.sessionId }}`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `self-signed certificate` error | Enable **Allow Self-Signed Certificates** in the credential. |
| `No Pool: <alias>` | The X3 pool isn't started or the alias is wrong. Start the pool in X3 (Administration → Web services) or fix **Pool Alias**. |
| `Niveau d'accès insuffisant` / `Insufficient access level` | The Syracuse user lacks rights on the object. Grant the function rights in X3. |
| `Modification en cours sur un autre poste` | A previous READ still holds the object lock. Chain calls with **Pool ID Override**, or skip the READ and MODIFY directly. |
| `Erreur zone [M:...]<field>` | Field validation failed — check that `Identifier` matches the key field in the data, value formats, and category counters. |

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Sage X3 SOAP web services guide](https://online-help.sageerpx3.com/erp/12/wp-static-content/static-pages/en_US/web-services/Configuration_management.html)

## Version history

### 0.1.0

- Initial release.
- Read / Create / Modify X3 objects via `XCHATX3OBJ`, plus an advanced raw Run Sub-Program mode.
- Native X3 JSON mode (JSON in, JSON out) with clean, navigable output.
- Output shaping (single-value array compaction, trailing-empty trimming).
- Session affinity via `sessionId` / Pool ID Override.
- `usableAsTool` for AI Agent integration.
