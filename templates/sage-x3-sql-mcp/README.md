# Sage X3 SQL MCP, the generic way

An n8n template where an AI agent and an **MCP server** answer Sage X3 questions through
**parameterised SQL queries stored as data**, and **explore or write X3 objects**, with only
**five tools**:

| Tool | What it does |
| --- | --- |
| `x3_query_catalog` | lists the queries of the catalogue with their filters, types, required ones and row caps |
| `x3_query_run` | runs one query by name with a `params` object; every figure, list and ranking comes from here |
| `x3_object` | reads the object layer: `describe` (blocks, fields, local menus), `list` (records with an X3 filter), `read` (one record) |
| `x3_object_write` | `create` or `modify` a record; the only tool able to write |
| `x3_object_guide` | the method for the object layer, topic by topic |

The catalogue can grow to hundreds of queries without adding a tool: the model discovers them
through `x3_query_catalog`.

**One workflow**, generated from one catalogue. `workflows/main.json` holds everything:

| Section | Role |
| --- | --- |
| 1-2 | Chat trigger + AI Agent + memory + model, and the MCP Server Trigger. The agent has a single tool, an **MCP Client Tool** pointed at this workflow's own MCP endpoint, so the chat sees exactly what external MCP clients see |
| 3-5 | The five tools, published on the MCP Server Trigger only. The four *Call n8n Workflow* tools call **this same workflow** back |
| 6 | Nested **SQL runner**: looks the query up in the embedded catalogue, validates the filters, composes the SQL, calls Sage X3 with the parameters passed **by expression** (node 0.6.0, Parameters Mode: JSON), returns one stable object |
| 7 | Nested **object runner**: describe, list, read, create, modify, with validation of the action, object code, identifier and payload, and a guard that refuses writes coming from the read tool |
| 8 | The single *Execute Workflow Trigger* the tool calls re-enter through; `kind` (sql or object) picks the runner |

`workflows/tests.json` is a separate development workflow: a webhook that runs `test/cases.json`
through the nested runners and reports pass/fail.

Requirements: n8n with community nodes, **n8n-nodes-nx3 0.6.0 or later**, a Sage X3 SOAP web
service on Microsoft SQL Server (the queries are T-SQL), a chat model credential.

## Layout

```
catalog.json         queries, filters, caps, groups, global settings (lang, hard_max_rows...)
sql/<query>.sql      one SELECT per query, with /*FILTERS*/ markers where the filters go
runner/resolve.js    Code node of the nested SQL runner: lookup, validation, composition, caps
runner/shape.js      Code node of the nested SQL runner: the response contract
runner/object-validate.js, runner/object-shape.js   the same two roles for the nested object runner
main/system-prompt.md  agent prompt; {{ROUTING_TABLE}} is generated from the catalogue
guide/*.md           the x3_object_guide topics (overview, find_object, describe, list, read, create, modify, identifiers, payload, errors)
skills/explore-sagex3-objects/SKILL.md   the same method as a Claude skill
test/cases.json      runner test cases; test/local.test.mjs runs the catalogue and resolver checks without n8n
lib.mjs, build.mjs   validation and generation
workflows/           generated workflows (template); workflows/dev/ when built with --dev
```

## Install

1. Install or upgrade `n8n-nodes-nx3` (0.6.0+), then import `workflows/main.json`.
2. Open each of the four *Call n8n Workflow* tools (`x3_query_catalog`, `x3_query_run`,
   `x3_object`, `x3_object_write`) and select **this workflow** in the **Workflow** field: the
   tools re-enter the workflow through the trigger of section 8. Select the **Nx3 SOAP API**
   credential on the seven Sage X3 nodes of sections 6 and 7, a chat model credential on the
   model node, a **Bearer Auth** credential on the MCP Server Trigger **and** on *Use the MCP
   server of this workflow*, whose **Endpoint** must be the production MCP URL of this workflow
   followed by `/sse` (`https://<your n8n>/mcp/sage-x3-mcp/sse`, SSE transport). Replace
   `YOUR_X3_USER` on *Create the record*.
   The workflow must be active for the chat to work: the agent goes through the live endpoint.
3. Activate the main workflow. In the chat, ask *list my customers in category FR*, then
   *billed revenue by month for 2025*, then *which X3 object holds purchase orders and what are its
   fields?*.
4. Point an MCP client at the trigger's production URL with the bearer token. For Claude, also
   install `skills/explore-sagex3-objects/` as a skill.

## Add or change a query

1. Write `sql/x3_my_query.sql`: a single `SELECT`, no `;`, labels through `{{lang}}` where you
   need the folder language, and a `/*FILTERS*/` comment where the optional `AND ...` clauses must
   land (use `/*FILTERS:name*/` for several places, for instance inside each branch of a `UNION`).
2. Add the entry to `catalog.json`:

```json
{
  "name": "x3_my_query", "group": "stock",
  "purpose": "One sentence the model reads to pick the tool.",
  "returns": "The columns, in order, with their meaning.",
  "notes": "Business traps the model must relay.",
  "use_instead": ["x3_other_query when ..."],
  "max_rows": 400, "max_time": 30,
  "filters": [
    { "name": "item", "type": "list", "clause": "AND ITM.ITMREF_0 IN ({{item}})", "description": "One or more item references." },
    { "name": "date_from", "type": "date", "required": true, "clauses": { "main": "AND X.DAT_0 >= {{date_from}}" }, "description": "YYYY-MM-DD." }
  ]
}
```

   Types: `list` (`IN (...)`), `contains` (`LIKE '%v%'`), `text`, `number`, `date`, `boolean`.
   `required: true` is enforced by the runner before Sage X3 is called.
3. `node test/local.test.mjs` validates the catalogue (names, types, markers, forbidden keywords,
   every clause references its own filter) and composes every query.
4. `node build.mjs` regenerates `workflows/main.json`. Re-import it over the existing workflow: the
   catalogue is embedded in the *Resolve* Code node of section 6, and the system prompt and sticky
   notes carry its summary.

## Develop against a local instance

`dev/dev.config.json` (git-ignored) holds the credential ids, fixed workflow ids, the node type
prefix (`CUSTOM` when the package is loaded from the custom folder) and the DEV paths:

```json
{ "nodePrefix": "CUSTOM", "namePrefix": "[DEV] ",
  "ids": { "main": "DEVx3main00000001", "tests": "DEVx3tests0000001" },
  "credentials": { "nx3SoapApi": { "id": "...", "name": "..." }, "openRouterApi": { "id": "...", "name": "..." }, "httpBearerAuth": { "id": "...", "name": "..." } },
  "mcpPath": "sage-x3-mcp-dev", "mcpWebhookId": "dev-x3-mcp-0000000000001", "mcpSelfUrl": "http://localhost:5678/mcp/sage-x3-mcp-dev/sse",
  "chatWebhookId": "dev-x3-chat-000000000001",
  "testsWebhookPath": "dev-x3-runner-tests", "x3User": "AGERA" }
```

`node build.mjs --dev` writes `workflows/dev/`. With n8n in Docker and this repository mounted in the
container:

```bash
docker exec n8n n8n import:workflow --separate --input=/home/node/.n8n/custom/n8n-nodes-nx3/templates/sage-x3-sql-mcp/workflows/dev/
for id in DEVx3main00000001 DEVx3tests0000001; do
  docker exec n8n n8n update:workflow --id=$id --active=true
done
docker restart n8n   # first import only, so the webhooks register
curl -s -X POST http://localhost:5678/webhook/dev-x3-runner-tests -H 'Content-Type: application/json' -d '{}'
```

The DEV chat trigger is public in webhook mode, so the agent can be exercised from the command line:

```bash
curl -s -X POST http://localhost:5678/webhook/dev-x3-chat-000000000001/chat -H 'Content-Type: application/json' \
  -d '{"action":"sendMessage","sessionId":"t1","chatInput":"list my customers in category FR"}'
```

## Response contract

`x3_query_run` answers `{ ok, query, mode, rowCount, truncated, max_rows, columns, rows,
params_used, warnings }`, rows as arrays in the order of `columns`. `x3_query_catalog` answers
`{ ok, count, groups, queries }`. `x3_object` and `x3_object_write` answer `{ ok, action, object,
identifier, data, messages }`. On failure every tool answers `{ ok: false, error, message }` with
`error` in `unknown_query`, `unknown_filter`, `missing_required`, `invalid_value`,
`invalid_params`, `unknown_action`, `invalid_object`, `missing_identifier`, `missing_data`,
`write_not_allowed`, `x3_error`, `transport_error`.

## Security notes

- The nested SQL runner only runs the catalogue's SELECTs; the model never writes SQL. Values are typed and
  escaped by the node, filters are whitelisted by the catalogue, row counts are capped.
- `x3_object_write` is exposed on the MCP trigger without a confirmation step. Disconnect it if
  the MCP audience is read-only; `x3_object` cannot write, the object runner refuses it.
- Keep Bearer Auth on the MCP trigger and never commit `dev/`.
