#!/usr/bin/env node
// Generate the three n8n workflows (runner, main agent + MCP, tests) from catalog.json.
//   node build.mjs          -> workflows/*.json, sanitised template (no credentials, placeholders)
//   node build.mjs --dev    -> workflows/dev/*.json for a local instance, using dev/dev.config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, loadCatalog, readRunnerSource, readGuide } from './lib.mjs';

const DEV = process.argv.includes('--dev');
const catalog = loadCatalog();
const S = catalog.settings;
const cfg = DEV
  ? JSON.parse(readFileSync(join(ROOT, 'dev', 'dev.config.json'), 'utf8'))
  : { nodePrefix: 'n8n-nodes-nx3', namePrefix: '', ids: {}, credentials: {}, mcpPath: S.mcp_path, x3User: 'YOUR_X3_USER' };
const OUT = DEV ? join(ROOT, 'workflows', 'dev') : join(ROOT, 'workflows');
mkdirSync(OUT, { recursive: true });

const NX3 = `${cfg.nodePrefix}.nx3Soap`;
const NX3_TOOL = `${cfg.nodePrefix}.nx3SoapTool`;
const RUNNER_NAME = cfg.namePrefix + S.runner_name; // label of the nested SQL runner section
const MAIN_NAME = cfg.namePrefix + S.main_name;
const TESTS_NAME = cfg.namePrefix + 'X3 SQL Runner tests';
const COLORS = { grey: 7, red: 3, green: 4, blue: 5, purple: 6, orange: 2, yellow: 1 };
const CRED = (type) => (cfg.credentials[type] ? { [type]: cfg.credentials[type] } : undefined);

let nodeIds = 0;
const uid = () => (DEV ? `dev-${String(++nodeIds).padStart(4, '0')}` : randomUUID());

function sticky(name, content, [x, y], width, height, color) {
  return { parameters: { content, height, width, color }, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [x, y], id: uid(), name };
}
function node(name, type, typeVersion, parameters, position, extra = {}) {
  const n = { parameters, type, typeVersion, position, id: uid(), name, ...extra };
  if (!n.credentials) delete n.credentials;
  return n;
}
function workflow(name, nodes, connections, id, extra = {}) {
  const wf = { name, nodes, connections, settings: { executionOrder: 'v1', ...(extra.settings || {}) }, pinData: {}, meta: { templateCredsSetupCompleted: false } };
  if (DEV) { wf.id = id; wf.settings.availableInMCP = true; }
  if (extra.active !== undefined) wf.active = extra.active;
  return wf;
}
function connect(connections, from, to, type = 'main', fromIndex = 0) {
  connections[from] = connections[from] || {};
  connections[from][type] = connections[from][type] || [];
  while (connections[from][type].length <= fromIndex) connections[from][type].push([]);
  connections[from][type][fromIndex].push({ node: to, type, index: 0 });
}
const bt = (s) => String(s).replace(/`/g, "'").replace(/\}\}/g, '} }');

// ---------------------------------------------------------------------------------------------
// 1. Nested SQL runner: the branch every x3_query_* tool call lands on
// ---------------------------------------------------------------------------------------------
function addSqlRunner(nodes, connections, y, from, fromIndex) {
  nodes.push(sticky('Note - 6 SQL runner', `## 6. Nested SQL runner (\`kind: sql\`)

Every \`x3_query_catalog\` / \`x3_query_run\` call re-enters **this workflow** through the trigger of section 8 and lands here.

1. **Resolve** looks the query up in the catalogue embedded in its code (${catalog.queries.length} queries, ${catalog.queries.reduce((a, q) => a + q.filters.length, 0)} filters, generated from \`catalog.json\` and \`sql/*.sql\` by \`build.mjs\`), normalises the params (JSON text or object, case-insensitive keys, stray quotes and % removed), refuses unknown filters, missing required ones and badly typed values **before** anything reaches Sage X3, composes the SQL by inserting each filter as an optional \`[[ ... ]]\` block at its \`/*FILTERS*/\` marker, and caps the row count (hard cap ${S.hard_max_rows}).
2. **Route** sends errors and catalogue answers straight to Shape, \`run\` to SQL Select, \`analyse\` to SQL Analyse.
3. The two Sage X3 nodes receive the query and the parameter list **by expression** (\`Parameters Mode: JSON\`, node 0.6.0+) and continue on failure.
4. **Shape** returns \`{ ok, query, rowCount, truncated, max_rows, columns, rows, params_used, warnings }\` or \`{ ok: false, error, message }\`.

**Do not edit the catalogue here**: change the files and run \`node build.mjs\`, then re-import.`, [0, y], 1680, 600, COLORS.yellow));

  const r = (name) => name;
  nodes.push(node(r('Resolve query and validate params'), 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readRunnerSource('resolve.js', catalog) }, [380, y + 400]));
  nodes.push(node(r('Route the SQL action'), 'n8n-nodes-base.switch', 3.2, {
    mode: 'expression', numberOutputs: 3,
    output: "={{ $json.ok !== true ? 2 : ($json.mode === 'analyse' ? 1 : 0) }}",
  }, [700, y + 400]));
  const sqlCommon = {
    sqlQuery: '={{ $json.sqlQuery }}',
    sqlParametersMode: 'json',
    sqlParametersJson: '={{ $json.sqlParams }}',
    sqlOptions: { maxLines: '={{ $json.maxLines }}', maxTime: '={{ $json.maxTime }}' },
    advanced: { requestTimeout: '={{ $json.requestTimeout }}' },
  };
  nodes.push(node(r('Run SQL on Sage X3'), NX3, 1, { operation: 'sqlSelect', ...sqlCommon, simplify: true, rowFormat: 'arrays' }, [1020, y + 300], { onError: 'continueRegularOutput', credentials: CRED('nx3SoapApi') }));
  nodes.push(node(r('Analyse SQL on Sage X3'), NX3, 1, { operation: 'sqlAnalyse', ...sqlCommon }, [1020, y + 500], { onError: 'continueRegularOutput', credentials: CRED('nx3SoapApi') }));
  nodes.push(node(r('Shape the response'), 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readRunnerSource('shape.js', catalog) }, [1340, y + 400]));

  connect(connections, from, 'Resolve query and validate params', 'main', fromIndex);
  connect(connections, 'Resolve query and validate params', 'Route the SQL action');
  connect(connections, 'Route the SQL action', 'Run SQL on Sage X3', 'main', 0);
  connect(connections, 'Route the SQL action', 'Analyse SQL on Sage X3', 'main', 1);
  connect(connections, 'Route the SQL action', 'Shape the response', 'main', 2);
  connect(connections, 'Run SQL on Sage X3', 'Shape the response');
  connect(connections, 'Analyse SQL on Sage X3', 'Shape the response');
  return y + 660;
}

// ---------------------------------------------------------------------------------------------
// 2. Nested object runner: describe / list / read / create / modify
// ---------------------------------------------------------------------------------------------
const OBJECT_RUNNER_NAME = 'X3 Object Runner';

function addObjectRunner(nodes, connections, y, from, fromIndex) {
  nodes.push(sticky('Note - 7 Object runner', `## 7. Nested object runner (\`kind: object\`)

Every \`x3_object\` / \`x3_object_write\` call lands here. **Validate** checks the action (describe, list, read, create, modify), the object code, the identifier and the payload before anything reaches Sage X3, and refuses create and modify unless \`allow_write\` is true: \`x3_object\` never writes, only \`x3_object_write\` does. **Route** sends each action to its own Sage X3 node; **Shape** returns \`{ ok, action, object, identifier, data, messages }\` or \`{ ok: false, error, message }\`.

Replace \`${cfg.x3User}\` on the Create node by the X3 user the records must be created under.`, [0, y], 1680, 780, COLORS.yellow));

  nodes.push(node('Validate the object call', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readRunnerSource('object-validate.js', catalog) }, [380, y + 480]));
  nodes.push(node('Route the object action', 'n8n-nodes-base.switch', 3.2, {
    mode: 'expression', numberOutputs: 6,
    output: "={{ $json.ok !== true ? 5 : ['describe', 'list', 'read', 'create', 'modify'].indexOf($json.action) }}",
  }, [700, y + 480]));
  const x3 = (name, params, dy) => node(name, NX3, 1, params, [1020, y + dy], { onError: 'continueRegularOutput', credentials: CRED('nx3SoapApi') });
  nodes.push(x3('Describe the object', { operation: 'describe', object: '={{ $json.object }}', transaction: '={{ $json.transaction }}', x3Context: {}, advanced: {} }, 160));
  nodes.push(x3('List the records', { operation: 'list', object: '={{ $json.object }}', transaction: '={{ $json.transaction }}', data: '={{ $json.data }}', x3Context: {}, advanced: {} }, 320));
  nodes.push(x3('Read the record', { operation: 'read', actionCode: 'READ', object: '={{ $json.object }}', transaction: '={{ $json.transaction }}', ident: '={{ $json.identifier }}', x3Context: {}, advanced: {} }, 480));
  nodes.push(x3('Create the record', { operation: 'create', object: '={{ $json.object }}', transaction: '={{ $json.transaction }}', ident: '={{ $json.identifier }}', data: '={{ $json.data }}', x3Context: { user: cfg.x3User }, advanced: {} }, 640));
  nodes.push(x3('Modify the record', { operation: 'modify', object: '={{ $json.object }}', transaction: '={{ $json.transaction }}', ident: '={{ $json.identifier }}', data: '={{ $json.data }}', x3Context: {}, advanced: {} }, 800));
  nodes.push(node('Shape the object response', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readRunnerSource('object-shape.js', catalog) }, [1340, y + 480]));

  connect(connections, from, 'Validate the object call', 'main', fromIndex);
  connect(connections, 'Validate the object call', 'Route the object action');
  ['Describe the object', 'List the records', 'Read the record', 'Create the record', 'Modify the record'].forEach((n, i) => {
    connect(connections, 'Route the object action', n, 'main', i);
    connect(connections, n, 'Shape the object response');
  });
  connect(connections, 'Route the object action', 'Shape the object response', 'main', 5);
  return y + 840;
}

// ---------------------------------------------------------------------------------------------
// 3. Main workflow: chat agent + MCP server + five generic tools
// ---------------------------------------------------------------------------------------------
// Every tool calls THIS workflow back: it re-enters through the Execute Workflow Trigger of the
// nested runner section, so the whole server is one importable workflow.
const selfRef = () => (DEV
  ? { __rl: true, value: cfg.ids.main, mode: 'list', cachedResultName: MAIN_NAME }
  : { __rl: true, value: '', mode: 'list', cachedResultName: `${MAIN_NAME} (select THIS workflow after importing it)` });

const schemaField = (id, type) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type, canBeUsedToMatch: true, removed: false });
const RUNNER_INPUTS = [['kind', 'string'], ['action', 'string'], ['query', 'string'], ['params', 'any'], ['max_rows', 'any'], ['object', 'string'], ['transaction', 'string'], ['identifier', 'string'], ['data', 'any'], ['allow_write', 'any']];
const runnerSchema = RUNNER_INPUTS.map(([id, type]) => schemaField(id, type));
const sqlSchema = runnerSchema;
const objectSchema = runnerSchema;

function toolWorkflow(name, description, ref, schema, value, position) {
  return node(name, '@n8n/n8n-nodes-langchain.toolWorkflow', 2.2, {
    description,
    source: 'database',
    workflowId: ref,
    workflowInputs: { mappingMode: 'defineBelow', value, matchingColumns: [], schema, attemptToConvertTypes: false, convertFieldsToString: false },
  }, position);
}

const RULES = "Rules: pass raw values (FR001, not 'FR001'; bike, not %bike%), the runner adds quotes and wildcards itself. Several values: comma separated with no space (FR001,FR002). Dates: YYYY-MM-DD. Filters combine with AND. Leave a filter out rather than guessing.";

function routingTable() {
  const out = [];
  for (const [g, label] of Object.entries(catalog.groups)) {
    const qs = catalog.queries.filter((q) => q.group === g);
    if (!qs.length) continue;
    out.push(`${label}:`);
    for (const q of qs) {
      const req = q.filters.filter((f) => f.required).map((f) => f.name);
      out.push(`- ${q.name}: ${q.purpose} Filters: ${q.filters.map((f) => f.name).join(', ')}.${req.length ? ' Required: ' + req.join(', ') + '.' : ''}`);
    }
    out.push('');
  }
  return out.join('\n').trim();
}

function catalogSummary() {
  return Object.entries(catalog.groups).map(([g, label]) => {
    const qs = catalog.queries.filter((q) => q.group === g);
    return qs.length ? `**${label.split(':')[0]}** - ${qs.map((q) => `\`${q.name}\``).join(', ')}` : null;
  }).filter(Boolean).join('\n');
}

function buildMain() {
  const nodes = [];
  const connections = {};
  const tools = [];
  const nQueries = catalog.queries.length;
  const nFilters = catalog.queries.reduce((a, q) => a + q.filters.length, 0);
  const sqlRef = selfRef();
  const objRef = selfRef();

  nodes.push(sticky('Note - Overview', `## Query Sage X3 in natural language, with five tools

An AI agent answers sales, stock, revenue, purchasing and finance questions and explores or writes Sage X3 objects. The same five tools are published on an **MCP Server** for Claude, Cursor or any MCP client.

### Why only five tools

- **The queries are a catalogue, not tools.** ${nQueries} parameterised SQL queries with ${nFilters} WHERE filters live in \`catalog.json\` + \`sql/*.sql\`. \`x3_query_catalog\` lets the model discover them and their filters; \`x3_query_run\` runs any of them by name. One nested runner (section 6) validates every filter, composes the SQL, calls Sage X3 with the parameters passed **by expression** and returns one stable shape. Adding a query never adds a tool: one JSON entry, one SQL file, \`node build.mjs\`.
- **The object layer is two tools.** \`x3_object\` reads (describe, list, read) through the nested object runner (section 7); \`x3_object_write\` creates and modifies through the same runner, and is the only tool able to write. \`x3_object_guide\` carries the method (find the object with the \`x3_object_search\` query, describe, list, read, then write).

### How a question travels

1. The chat (or an MCP client) sends the question.
2. The agent reads the catalogue summary in its system prompt, or calls \`x3_query_catalog\`.
3. \`x3_query_run\` validates the filters, composes the SQL, calls Sage X3 and returns \`{ ok, rowCount, columns, rows, truncated, warnings }\`.
4. The agent writes the answer, with currency, unit and horizon.

The canvas is generated by \`build.mjs\`: edit the catalogue and the templates, not the nodes.`, [0, 0], 820, 760, COLORS.grey));

  nodes.push(sticky('Note - Setup required', `## Set this up before use

### 1. Community node
**n8n-nodes-nx3 0.6.0 or later** (Settings > Community nodes). The SQL runner uses its *Parameters Mode: JSON*.

### 2. Point the tools at this workflow
Everything is nested in this single workflow: the four *Call n8n Workflow* tools call it back and re-enter through the trigger of section 8. After importing, open each of the four tools and select **this workflow** in the **Workflow** field${DEV ? ' (already set for this DEV build)' : ' (or run build.mjs --dev with the workflow id in a dev config)'}.

### 3. Credentials
- **Nx3 SOAP API** on the seven Sage X3 nodes of sections 6 and 7.
- **Bearer Auth** on the MCP Server Trigger (\`openssl rand -hex 32\`).
- **OpenRouter** (or any chat model) on the model node.
- **Header Auth** on \`X3_Support\` if you keep that knowledge-base tool.

### 4. Placeholders
| Where | Value | Replace with |
|---|---|---|
| Section 7, *Create the record* | \`YOUR_X3_USER\` | the X3 user the records are created under |
| MCP Server Trigger | path \`${S.mcp_path}\` | any path |
| \`catalog.json\` settings | \`lang: ${S.lang}\` | your label language if the folder has no English texts |

### 5. Test
Activate, open the chat and ask *"list my customers in category FR"*, then *"billed revenue by month for 2025"*, then *"which X3 object holds purchase orders and what are its fields?"*.`, [860, 0], 820, 760, COLORS.red));

  // --- 1. Conversation -------------------------------------------------------------------------
  nodes.push(sticky('Note - 1 Conversation', `## 1. Conversation

The n8n chat receives the question, the agent chooses among the five tools, the memory keeps the thread for follow-ups ("and for 2026?"). The system prompt carries the catalogue summary (generated) and the routing rules.`, [0, 820], 820, 460, COLORS.green));
  const chatParams = DEV ? { public: true, mode: 'webhook', options: { responseMode: 'lastNode' } } : { options: {} };
  nodes.push(node('When a user asks in the chat', '@n8n/n8n-nodes-langchain.chatTrigger', 1.4, chatParams, [60, 1000], { webhookId: DEV ? cfg.chatWebhookId : randomUUID() }));
  const systemPrompt = readFileSync(join(ROOT, 'main', 'system-prompt.md'), 'utf8').replace('{{ROUTING_TABLE}}', routingTable());
  nodes.push(node('Route the question to the right tool', '@n8n/n8n-nodes-langchain.agent', 3.1, { options: { systemMessage: systemPrompt, maxIterations: 15, ...(DEV ? { returnIntermediateSteps: true } : {}) } }, [340, 1000]));
  nodes.push(node('Language model (OpenRouter)', '@n8n/n8n-nodes-langchain.lmChatOpenRouter', 1, { model: 'anthropic/claude-sonnet-5', options: { temperature: 0.2 } }, [280, 1180], { credentials: CRED('openRouterApi') }));
  nodes.push(node('Conversation memory', '@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3, {}, [500, 1180]));
  connect(connections, 'When a user asks in the chat', 'Route the question to the right tool');
  connect(connections, 'Language model (OpenRouter)', 'Route the question to the right tool', 'ai_languageModel');
  connect(connections, 'Conversation memory', 'Route the question to the right tool', 'ai_memory');

  // --- 2. MCP ----------------------------------------------------------------------------------
  nodes.push(sticky('Note - 2 MCP server', `## 2. MCP server

The five tools are published on this endpoint, protected by Bearer Auth. Point Claude Desktop, Claude Code or Cursor at the production URL with the token. A client that only knows \`x3_query_catalog\` and \`x3_query_run\` can use every query of the catalogue.

**Careful**: \`x3_object_write\` is reachable here with no confirmation step. Disconnect it from this trigger if the MCP audience should be read-only.`, [860, 820], 820, 460, COLORS.green));
  nodes.push(node('Expose the tools as an MCP server', '@n8n/n8n-nodes-langchain.mcpTrigger', 1.1, { authentication: 'bearerAuth', path: cfg.mcpPath }, [1140, 1020], { webhookId: DEV && cfg.mcpWebhookId ? cfg.mcpWebhookId : randomUUID(), credentials: CRED('httpBearerAuth') }));

  // --- 3. SQL through the catalogue ------------------------------------------------------------
  nodes.push(sticky('Note - 3 SQL queries through the catalogue', `## 3. SQL queries: two tools for ${nQueries} queries

\`x3_query_catalog\` describes the queries (filters, types, required ones, caps); \`x3_query_run\` runs one by name with a \`params\` object. Both re-enter this workflow and run through the nested SQL runner (section 6). The catalogue today:

${catalogSummary()}

**Adding a query**: one entry in \`catalog.json\`, one file in \`sql/\` with \`/*FILTERS*/\` markers, \`node build.mjs\`, re-import this workflow. No new tool: the catalogue is discovered at run time.`, [0, 1340], 1680, 560, COLORS.blue));
  tools.push(toolWorkflow('x3_query_catalog', `Purpose: list the Sage X3 SQL queries available on this server, with their group, purpose, returned columns, filters (name, type, required) and row cap. Call it when you are not certain which query answers the question or which filters it takes.

Parameters:
- group (string): optional group to narrow the list: ${Object.keys(catalog.groups).join(', ')}.
- name (string): optional fragment of a query name.

Answer: { ok, count, groups, queries: [{ name, group, purpose, returns, notes, filters: [{ name, type, required, description }], max_rows }] }.

Next step: x3_query_run with the chosen query name and a params object built from its filters.`, sqlRef, sqlSchema, {
    kind: 'sql', action: 'catalog', query: '',
    params: "={{ ({ \"group\": $fromAI('group', `Optional group: " + Object.keys(catalog.groups).join(', ') + ". Leave empty for all.`, 'string', ''), \"name\": $fromAI('name', `Optional fragment of a query name. Leave empty for all.`, 'string', '') }) }}",
    max_rows: 0,
  }, [60, 1720]));
  tools.push(toolWorkflow('x3_query_run', `Purpose: run one Sage X3 SQL query of the catalogue by name, with its filters passed as a params object. Every figure, list and ranking comes from here. Queries available: ${catalog.queries.map((q) => q.name).join(', ')}; x3_query_catalog gives their filters.

Parameters:
- query (string, REQUIRED): the query name, e.g. x3_customer_search.
- params (string): a JSON object written as text, { "filter_name": "value" }. ${RULES} Required filters: x3_revenue_summary needs level (Total, Month, Customer, Item, CustomerItem); x3_payment_delay needs level, partner_type, date_from and date_to.
- max_rows (number): optional row cap, never above ${S.hard_max_rows}; 0 for the query default.

Answer: { ok, query, rowCount, columns, rows (arrays, same order as columns), truncated, warnings, params_used }. When ok is false, error tells what to fix: unknown_query (see available), unknown_filter (see valid_filters), missing_required, invalid_value; x3_error and transport_error come from Sage X3. truncated true means the result stops at max_rows: say so and narrow the filters.`, sqlRef, sqlSchema, {
    kind: 'sql', action: 'run',
    query: "={{ $fromAI('query', `Name of the query to run, e.g. x3_customer_search. See x3_query_catalog.`, 'string') }}",
    params: "={{ $fromAI('params', `Filters as a JSON object written as text, e.g. {\"category\": \"FR\", \"date_from\": \"2025-01-01\"}. Raw values, no quotes inside values, no % signs; lists comma separated; dates YYYY-MM-DD. Leave empty for no filter.`, 'string', '') }}",
    max_rows: "={{ $fromAI('max_rows', `Optional row cap, 0 for the query default.`, 'number', 0) }}",
  }, [380, 1720]));

  // --- 4. Objects ------------------------------------------------------------------------------
  const guide = readGuide();
  let y = 1960;
  nodes.push(sticky('Note - 4 Sage X3 objects', `## 4. Explore and read Sage X3 objects

\`x3_object\` reads the object layer through *${OBJECT_RUNNER_NAME}* with one \`action\`: **describe** (blocks, fields, local menus, mandatory flags), **list** (records with an X3 filter, to get an exact identifier), **read** (one record in full). It cannot write.

The chain the agent follows, documented step by step by \`x3_object_guide\` (edit \`guide/*.md\`, then rebuild):
1. the \`x3_object_search\` query, through \`x3_query_run\` - a notion, a function code such as GESSOH, a screen label or a table name gives the object code, its main table, primary key and management function;
2. \`x3_object\` describe; 3. \`x3_object\` list; 4. \`x3_object\` read; 5. \`x3_object_write\`.

\`X3_Support\` answers how-to questions about Sage X3 itself from a knowledge base (template only; bind a Header Auth credential or delete it).`, [0, y], 1680, 560, COLORS.purple));
  tools.push(toolWorkflow('x3_object', `Purpose: read the Sage X3 object layer. One tool, three actions: describe (the screen blocks, fields, local menus and mandatory flags of an object), list (the records of an object with an X3 filter, to obtain exact identifiers), read (one record in full from its identifier). It never writes.

Parameters:
- action (string, REQUIRED): describe, list or read.
- object (string, REQUIRED): the 3-letter object code, e.g. SOH sales orders, POH purchase orders, ITM items, BPC customers, BPS suppliers, SIH sales invoices, PIH purchase invoices, MFG work orders. Unknown? run the x3_object_search query through x3_query_run.
- transaction (string): empty for master data (ITM, BPC, BPS...), ALL for documents (SOH, POH, SIH...) unless the user names one. Use the same transaction for a read and the modify that follows.
- identifier (string): required for read. The exact primary key, composite keys joined with ~ (FIN311~NA021). Take it from a list or a SQL query, never from memory.
- data (string): for list only, a JSON object written as text, { "list_filters": "<X3 expression>" }, e.g. { "list_filters": "[F:SOH]BPCORD = 'FR001' & [F:SOH]ORDDAT >= [12/01/2025]" }: & is AND, | is OR, strings in single quotes, dates between brackets as [DD/MM/YYYY], field codes without _0. Always filter a list.

Answer: { ok, action, object, identifier, data, messages }. describe: blocks and fields, large, call it once per object. list: data.fields names the positions, data.values holds one array per record. read: blocks of fields, each field an array even for one value. When ok is false read error and message (missing_identifier, invalid_object, x3_error...).

Use instead: a SQL query through x3_query_run for a search with several criteria, labels or amounts. Next step: x3_object_write to change the record, after confirmation.`, objRef, objectSchema, {
    kind: 'object',
    action: "={{ $fromAI('action', `describe, list or read.`, 'string') }}",
    object: "={{ $fromAI('object', `Sage X3 object code, e.g. SOH, ITM, BPC. From the x3_object_search query when unknown.`, 'string') }}",
    transaction: "={{ $fromAI('transaction', `Empty for master data, ALL for documents unless the user names a transaction.`, 'string', '') }}",
    identifier: "={{ $fromAI('identifier', `Exact primary key for read, composite keys joined with ~. Empty for describe and list.`, 'string', '') }}",
    data: "={{ $fromAI('data', `For list only, a JSON object written as text: {\"list_filters\": \"[F:XXX]FIELD = 'value'\"}. Leave empty for describe and read.`, 'string', '') }}",
    allow_write: false,
  }, [60, y + 340]));
  const guideCode = `const topics = ${JSON.stringify(guide)};
const raw = (query !== null && typeof query === 'object') ? (query.topic ?? '') : (query ?? '');
const key = String(raw).trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
if (key && topics[key]) return topics[key];
return topics.overview + '\\n\\nAvailable topics: ' + Object.keys(topics).join(', ') + (key ? ' (unknown topic: ' + key + ')' : '');`;
  tools.push(node('x3_object_guide', '@n8n/n8n-nodes-langchain.toolCode', 1.3, {
    description: `Purpose: return the method for working with Sage X3 objects through this server: which tool and action to use in which order, how identifiers, transactions, list filters and JSON payloads are written, how to read errors. Read it as soon as you work on an object you have not handled in this conversation, and before any x3_object_write.

Parameters:
- topic (string): one of ${Object.keys(guide).join(', ')}. Use overview first.

Answer: the instructions as text. No access to live data.`,
    language: 'javaScript', jsCode: guideCode,
    specifyInputSchema: true, schemaType: 'fromJson', jsonSchemaExample: '{ "topic": "find_object" }',
  }, [380, y + 340]));
  if (!DEV) {
    tools.push(node('X3_Support', 'n8n-nodes-base.httpRequestTool', 4.2, {
      toolDescription: `Purpose: knowledge base about how Sage X3 works: setup, parameters, screens, processes, error messages, best practices. Use it for "how to", "why", "what does X mean", "where do I configure", not to read or change data.

Parameters:
- message_content (string, REQUIRED): the user's question in natural language.

Rules: it has no access to the live folder; for data, use the x3_ tools.`,
      method: 'POST', url: 'https://YOUR-KNOWLEDGE-BASE.example/ask',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'keypair',
      bodyParameters: { parameters: [{ name: 'message_content', value: "={{ $fromAI('message_content', `The question about Sage X3, in natural language.`, 'string') }}" }] },
      options: {},
    }, [700, y + 340]));
  }
  y += 620;

  // --- 5. Write --------------------------------------------------------------------------------
  nodes.push(sticky('Note - 5 Write', `## 5. Write into Sage X3 (irreversible)

\`x3_object_write\` creates or modifies any object through *${OBJECT_RUNNER_NAME}*, which refuses a write coming from \`x3_object\`. The system prompt requires a recap and an explicit confirmation on the chat path. **A direct MCP call has no such guard**: disconnect this node from the MCP trigger unless the MCP audience may write.`, [0, y], 1680, 400, COLORS.orange));
  tools.push(toolWorkflow('x3_object_write', `Purpose: create or modify a Sage X3 record through the object layer. IRREVERSIBLE WRITE: only after the user explicitly confirmed a recap of the object, identifier, fields and values; only with block and field names taken from x3_object describe or read; only after checking the referenced codes exist (customer, item, site, supplier) with the reference queries.

Parameters:
- action (string, REQUIRED): create or modify.
- object (string, REQUIRED): object code, e.g. SOH, POH, BPC, ITM.
- transaction (string): ALL for documents, empty for master data, unless the user names one; for modify, the same as the read before it.
- identifier (string): create: empty when Sage X3 numbers the record (orders, deliveries, invoices), the code when the user gives it (item, customer, supplier). modify: required, the exact key, composite keys joined with ~.
- data (object, REQUIRED): payload by screen block. create example for a sales order: { "SOH0": { "BPCORD": "FR001", "SALFCY": "FR011", "SOHTYP": "SON", "CUSORDREF": "PO-4521" }, "SOH2": { "STOFCY": "FR011" }, "SOH4": { "ITMREF": ["FIN008"], "QTY": [10], "DDEMDLVDAT": ["2026-11-15"] } }. Grid columns are index-aligned arrays of the same length; dates YYYY-MM-DD; local menus as integers; numbers bare. modify: only the fields to change, FIELD(n) targets row n of a grid, e.g. { "SOH4": { "QTY(2)": 15 } }. Never send the document number on a create when X3 numbers it.

Answer: { ok, action, object, identifier, data, messages }; the identifier assigned by Sage X3 is in messages or identifier. ok false means nothing was written: read message, fix, ask before retrying.`, objRef, objectSchema, {
    kind: 'object',
    action: "={{ $fromAI('action', `create or modify.`, 'string') }}",
    object: "={{ $fromAI('object', `Sage X3 object code, e.g. SOH, POH, BPC, ITM.`, 'string') }}",
    transaction: "={{ $fromAI('transaction', `ALL for documents, empty for master data, unless the user names a transaction.`, 'string', '') }}",
    identifier: "={{ $fromAI('identifier', `Empty when Sage X3 numbers the record on create; the exact key otherwise, composite keys joined with ~.`, 'string', '') }}",
    data: "={{ $fromAI('data', `Payload by screen block with field names from describe or read. Grid columns as index-aligned arrays, dates YYYY-MM-DD, local menus as integers, numbers bare.`, 'json') }}",
    allow_write: true,
  }, [60, y + 240]));

  for (const t of tools) {
    nodes.push(t);
    connect(connections, t.name, 'Route the question to the right tool', 'ai_tool');
    connect(connections, t.name, 'Expose the tools as an MCP server', 'ai_tool');
  }

  // --- 8. The single re-entry point of the nested runners --------------------------------------
  y += 460;
  nodes.push(sticky('Note - 8 Re-entry point', `## 8. Where the tool calls come back in

The four *Call n8n Workflow* tools call **this very workflow**. n8n starts a sub-execution at this trigger with the tool's fields: \`kind\` (sql or object) picks the runner below, the other fields are what the model filled in. Nothing else should connect to this trigger.

Inputs: ${RUNNER_INPUTS.map(([n]) => '\`' + n + '\`').join(', ')}.`, [0, y], 1680, 300, COLORS.yellow));
  nodes.push(node('When a tool calls this workflow', 'n8n-nodes-base.executeWorkflowTrigger', 1.2, {
    inputSource: 'workflowInputs',
    workflowInputs: { values: RUNNER_INPUTS.map(([name, type]) => ({ name, type })) },
  }, [60, y + 180]));
  nodes.push(node('Route by kind', 'n8n-nodes-base.switch', 3.2, { mode: 'expression', numberOutputs: 2, output: "={{ $json.kind === 'object' ? 1 : 0 }}" }, [380, y + 180]));
  connect(connections, 'When a tool calls this workflow', 'Route by kind');
  y += 360;
  y = addSqlRunner(nodes, connections, y, 'Route by kind', 0);
  addObjectRunner(nodes, connections, y, 'Route by kind', 1);

  const maxTime = Math.max(...catalog.queries.map((q) => q.max_time || S.default_max_time));
  return workflow(MAIN_NAME, nodes, connections, cfg.ids.main, { settings: { executionTimeout: Math.max(120, maxTime + (S.request_timeout_margin || 10) + 30), callerPolicy: 'workflowsFromSameOwner' }, ...(DEV ? { active: true } : {}) });
}

// ---------------------------------------------------------------------------------------------
// 4. Test harness (webhook -> SQL runner or object runner for each case -> assertions)
// ---------------------------------------------------------------------------------------------
function buildTests() {
  const cases = JSON.parse(readFileSync(join(ROOT, 'test', 'cases.json'), 'utf8'));
  const nodes = [];
  const connections = {};
  nodes.push(sticky('Note - Runner tests', `## Runner tests

POST to this webhook with \`{}\` to run the ${cases.length} default cases of \`test/cases.json\` against the nested runners of *${MAIN_NAME}*, or with \`{ "cases": [...] }\` for your own. A case is \`{ name, target: "sql" | "object", input: {...}, expect: { ok, error, count, rows, min_rows, column0, truncated, max_rows, params_used, all_rows, some_row } }\`. The answer is \`{ passed, failed, results: [...] }\`. The default cases are read-only against Sage X3.`, [-100, -300], 1500, 260, COLORS.yellow));
  nodes.push(node('Receive the test request', 'n8n-nodes-base.webhook', 2.1, { httpMethod: 'POST', path: cfg.testsWebhookPath || 'x3-runner-tests', responseMode: 'lastNode', options: {} }, [0, 0], { webhookId: DEV ? 'dev-x3-tests-00000000001' : randomUUID() }));
  nodes.push(node('Expand cases', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: `const DEFAULT_CASES = ${JSON.stringify(cases)};
const body = ($input.first() && $input.first().json.body) || {};
const cases = Array.isArray(body.cases) && body.cases.length ? body.cases : DEFAULT_CASES;
return cases.map((c, i) => ({ json: { index: i, name: c.name, target: c.target === 'object' ? 'object' : 'sql', input: c.input || {}, expect: c.expect || {} } }));` }, [320, 0]));
  nodes.push(node('Route by target', 'n8n-nodes-base.switch', 3.2, { mode: 'expression', numberOutputs: 2, output: "={{ $json.target === 'object' ? 1 : 0 }}" }, [640, 0]));
  nodes.push(node('Call the SQL runner', 'n8n-nodes-base.executeWorkflow', 1.3, {
    mode: 'each', source: 'database', workflowId: selfRef(),
    workflowInputs: { mappingMode: 'defineBelow', value: { kind: 'sql', action: "={{ $json.input.action || 'run' }}", query: "={{ $json.input.query || '' }}", params: '={{ $json.input.params || {} }}', max_rows: '={{ $json.input.max_rows || 0 }}' }, matchingColumns: [], schema: sqlSchema, attemptToConvertTypes: false, convertFieldsToString: false },
    options: { waitForSubWorkflow: true },
  }, [960, -120], { onError: 'continueRegularOutput' }));
  nodes.push(node('Call the object runner', 'n8n-nodes-base.executeWorkflow', 1.3, {
    mode: 'each', source: 'database', workflowId: selfRef(),
    workflowInputs: { mappingMode: 'defineBelow', value: { kind: 'object', action: "={{ $json.input.action || '' }}", object: "={{ $json.input.object || '' }}", transaction: "={{ $json.input.transaction || '' }}", identifier: "={{ $json.input.identifier || '' }}", data: '={{ $json.input.data || {} }}', allow_write: '={{ $json.input.allow_write === true }}' }, matchingColumns: [], schema: objectSchema, attemptToConvertTypes: false, convertFieldsToString: false },
    options: { waitForSubWorkflow: true },
  }, [960, 120], { onError: 'continueRegularOutput' }));
  nodes.push(node('Collect results', 'n8n-nodes-base.merge', 3, { mode: 'append', numberInputs: 2 }, [1280, 0]));
  nodes.push(node('Assert', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: `const all = $('Expand cases').all().map((i) => i.json);
const ordered = [...all.filter((c) => c.target === 'sql'), ...all.filter((c) => c.target === 'object')];
const results = $input.all().map((i) => i.json);
const out = [];
ordered.forEach((c, k) => {
  const r = results[k] || {};
  const e = c.expect || {};
  const problems = [];
  const col = (name) => (r.columns || []).indexOf(name);
  if ('ok' in e && r.ok !== e.ok) problems.push('ok=' + r.ok + ' expected ' + e.ok + (r.message ? ' (' + r.message + ')' : ''));
  if ('error' in e && r.error !== e.error) problems.push('error=' + r.error + ' expected ' + e.error);
  if ('count' in e && r.count !== e.count) problems.push('count=' + r.count + ' expected ' + e.count);
  if ('rows' in e && r.rowCount !== e.rows) problems.push('rowCount=' + r.rowCount + ' expected ' + e.rows);
  if ('min_rows' in e && !(r.rowCount >= e.min_rows)) problems.push('rowCount=' + r.rowCount + ' expected >= ' + e.min_rows);
  if ('column0' in e && (r.columns || [])[0] !== e.column0) problems.push('columns[0]=' + (r.columns || [])[0]);
  if ('truncated' in e && r.truncated !== e.truncated) problems.push('truncated=' + r.truncated);
  if ('max_rows' in e && r.max_rows !== e.max_rows) problems.push('max_rows=' + r.max_rows);
  if (e.params_used) for (const [k2, v] of Object.entries(e.params_used)) if ((r.params_used || {})[k2] !== v) problems.push('params_used.' + k2 + '=' + (r.params_used || {})[k2]);
  if (e.all_rows) for (const [k2, v] of Object.entries(e.all_rows)) { const i = col(k2); if (i < 0) problems.push('no column ' + k2); else if (!(r.rows || []).every((row) => row[i] == v)) problems.push('some row has ' + k2 + ' != ' + v); }
  if (e.some_row) { const ok = (r.rows || []).some((row) => Object.entries(e.some_row).every(([k2, v]) => row[col(k2)] == v)); if (!ok) problems.push('no row matching ' + JSON.stringify(e.some_row)); }
  out.push({ name: c.name, target: c.target, passed: problems.length === 0, problems, rowCount: r.rowCount, error: r.error, message: r.message, warnings: r.warnings });
});
return [{ json: { passed: out.filter((o) => o.passed).length, failed: out.filter((o) => !o.passed).length, results: out } }];` }, [1600, 0]));
  connect(connections, 'Receive the test request', 'Expand cases');
  connect(connections, 'Expand cases', 'Route by target');
  connect(connections, 'Route by target', 'Call the SQL runner', 'main', 0);
  connect(connections, 'Route by target', 'Call the object runner', 'main', 1);
  connections['Call the SQL runner'] = { main: [[{ node: 'Collect results', type: 'main', index: 0 }]] };
  connections['Call the object runner'] = { main: [[{ node: 'Collect results', type: 'main', index: 1 }]] };
  connect(connections, 'Collect results', 'Assert');
  return workflow(TESTS_NAME, nodes, connections, cfg.ids.tests, DEV ? { active: true } : {});
}

// ---------------------------------------------------------------------------------------------
const files = { 'main.json': buildMain(), 'tests.json': buildTests() };
for (const [f, wf] of Object.entries(files)) {
  writeFileSync(join(OUT, f), JSON.stringify(wf, null, 2) + '\n');
  console.log(`${DEV ? '[dev] ' : ''}${f}: ${wf.nodes.length} nodes -> ${join(OUT, f)}`);
}
