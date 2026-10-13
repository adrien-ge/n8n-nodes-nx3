import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	ACTION_CODE_CUSTOM_FIELD,
	ACTION_CODE_PRESET_FIELDS,
	ACTION_MAP,
	DEFAULT_PUBLIC_NAME,
	SQL_OPS,
	X3_OBJECT_OPS,
	X3_OPS_WITH_DATA,
	applyQueryParameters,
	buildChatX3InputJson,
	buildObjectOperationOutput,
	buildRunEnvelope,
	buildSqlSimplifiedOutput,
	debugResult,
	deepParseJsonStrings,
	describeX3Error,
	parseRunResponse,
	parseSqlParamsJson,
	postSoapEnvelope,
	readPositiveNumber,
	reshapeX3Data,
	resolveX3Connection,
	tryParseJson,
	type Operation,
	type SqlParam,
} from './x3Soap';
import { runX3Query, type BoundInput, type QueryRunState } from './x3QueryRun';

// ---------------------------------------------------------------------------
// Node definition
// ---------------------------------------------------------------------------

export class Nx3Soap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IntellX for Sage X3',
		name: 'nx3Soap',
		icon: 'file:nx3.svg',
		group: ['transform'],
		// Version 2 groups the operations under a Resource (Object, Query, SQL,
		// Sub-Program); version 1 keeps the flat list for workflows saved before.
		// Both run the same execute(): only the way the operation is picked differs.
		version: [1, 2],
		defaultVersion: 2,
		// Shows the real XACTION rather than the internal operation value.
		//
		// Deliberately limited to `operation`, `actionCode` and `object`: on a node used
		// as an AI tool, any field left to the model is a $fromAI expression with no
		// design-time value, and reading one here makes the whole subtitle fail — the
		// node then renders with no subtitle at all. `ident` is the field most often
		// delegated to the model, so it is left out; `object` is usually pinned and
		// carries the useful context.
		subtitle:
			'={{ $parameter["operation"] === "sqlSelect" ? "SQL Select" : $parameter["operation"] === "sqlAnalyse" ? "SQL Analyse" : $parameter["operation"] === "runRaw" ? "Run Sub-Program" : $parameter["operation"] === "runQuery" ? ($parameter["queryExecute"] === false ? "SQL of query " : "Run query ") + $parameter["queryCode"] : ($parameter["actionCode"] || $parameter["operation"]) + ($parameter["object"] ? ": " + $parameter["object"] : "") }}',
		description:
			'Read, create or modify a Sage X3 object via the XCHATX3OBJ sub-program (JSON in, JSON out)',
		defaults: { name: 'IntellX for Sage X3' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'nx3SoapApi', required: true }],
		properties: [
			// Version 2: Resource, then the operations of that resource ----------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2] } },
				default: 'object',
				options: [
					{
						name: 'Object',
						value: 'object',
						description: 'Read, list, create, modify or describe a Sage X3 object (XCHATX3OBJ)',
					},
					{
						name: 'Query',
						value: 'query',
						description: 'Run a Sage X3 graphical query (object ALT) as SQL',
					},
					{
						name: 'SQL',
						value: 'sql',
						description: 'Analyse or run a SQL SELECT against the Sage X3 database',
					},
					{
						name: 'Sub-Program',
						value: 'subProgram',
						description: 'Call any Sage X3 sub-program with raw input XML',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2], resource: ['object'] } },
				default: 'read',
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a new Sage X3 object from JSON data',
						action: 'Create an X3 object',
					},
					{
						name: 'Custom Action',
						value: 'custom',
						description:
							'Send any XACTION value to the sub-program (e.g. LIST or future actions not listed here)',
						action: 'Run a custom X3 action',
					},
					{
						name: 'Describe',
						value: 'describe',
						description:
							'Get the local-menus and field metadata description for a Sage X3 object class',
						action: 'Describe an X3 object',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List records of a Sage X3 object with optional filter criteria',
						action: 'List X3 objects',
					},
					{
						name: 'Modify',
						value: 'modify',
						description: 'Update an existing Sage X3 object with JSON data',
						action: 'Modify an X3 object',
					},
					{
						name: 'Read',
						value: 'read',
						description: 'Read a Sage X3 object by its identifier',
						action: 'Read an X3 object',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2], resource: ['query'] } },
				default: 'runQuery',
				options: [
					{
						name: 'Run',
						value: 'runQuery',
						description:
							'Run a graphical query (Requêteur, object ALT) by its code: its definition is read, translated to SQL and executed, with the X3 bounds as parameters',
						action: 'Run an X3 query',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2], resource: ['sql'] } },
				default: 'sqlSelect',
				options: [
					{
						name: 'Analyse',
						value: 'sqlAnalyse',
						description:
							'Check that a SQL query is syntactically valid, without returning any rows',
						action: 'Analyse a SQL query',
					},
					{
						name: 'Select',
						value: 'sqlSelect',
						description: 'Execute a SQL SELECT against the Sage X3 database and return the rows',
						action: 'Run a SQL SELECT query',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2], resource: ['subProgram'] } },
				default: 'runRaw',
				options: [
					{
						name: 'Run (Advanced)',
						value: 'runRaw',
						description: 'Call any Sage X3 sub-program with raw input XML',
						action: 'Run a sub program with raw xml',
					},
				],
			},

			// Version 1: the flat operation list, kept for saved workflows ---------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [1] } },
				default: 'read',
				options: [
					{
						name: 'Create Sage X3 Object',
						value: 'create',
						description: 'Create a new Sage X3 object from JSON data',
						action: 'Create an X3 object',
					},
					{
						name: 'Custom Sage X3 Action',
						value: 'custom',
						description:
							'Send any XACTION value to the sub-program (e.g. LIST or future actions not listed here)',
						action: 'Run a custom X3 action',
					},
					{
						name: 'Describe Sage X3 Object',
						value: 'describe',
						description:
							'Get the local-menus and field metadata description for a Sage X3 object class',
						action: 'Describe an X3 object',
					},
					{
						name: 'List Sage X3 Objects',
						value: 'list',
						description: 'List records of a Sage X3 object with optional filter criteria',
						action: 'List X3 objects',
					},
					{
						name: 'Modify Sage X3 Object',
						value: 'modify',
						description: 'Update an existing Sage X3 object with JSON data',
						action: 'Modify an X3 object',
					},
					{
						name: 'Read Sage X3 Object',
						value: 'read',
						description: 'Read a Sage X3 object by its identifier',
						action: 'Read an X3 object',
					},
					{
						name: 'Run Sage X3 Query',
						value: 'runQuery',
						description:
							'Run a graphical query (Requêteur, object ALT) by its code: its definition is read, translated to SQL and executed, with the X3 bounds as parameters',
						action: 'Run an X3 query',
					},
					{
						name: 'Run Sub-Program (Advanced)',
						value: 'runRaw',
						description: 'Call any Sage X3 sub-program with raw input XML',
						action: 'Run a sub program with raw xml',
					},
					{
						name: 'SQL Analyse',
						value: 'sqlAnalyse',
						description:
							'Check that a SQL query is syntactically valid, without returning any rows',
						action: 'Analyse a SQL query',
					},
					{
						name: 'SQL Select',
						value: 'sqlSelect',
						description: 'Execute a SQL SELECT against the Sage X3 database and return the rows',
						action: 'Run a SQL SELECT query',
					},
				],
			},

			// X3 Object operations -------------------------------------------------
			// Per-operation Action Code fields (generated above): each shows the right
			// pre-filled XACTION as the user changes the Operation dropdown.
			...ACTION_CODE_PRESET_FIELDS,
			ACTION_CODE_CUSTOM_FIELD,
			{
				displayName: 'Sage X3 Object Code',
				name: 'object',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. ITM',
				description: 'Sage X3 object code (e.g. ITM, SOH, BPC)',
				displayOptions: { show: { operation: X3_OBJECT_OPS } },
			},
			{
				displayName: 'Transaction Code',
				name: 'transaction',
				type: 'string',
				default: '',
				placeholder: 'e.g. STD',
				description: 'Sage X3 transaction code (XTRANSACTION). Leave empty for default.',
				displayOptions: { show: { operation: X3_OBJECT_OPS } },
			},
			{
				displayName: 'Identifier',
				name: 'ident',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. BMS009',
				description: 'Primary identifier of the object (XIDENT)',
				displayOptions: { show: { operation: ['read', 'modify'] } },
			},
			{
				displayName: 'Identifier',
				name: 'ident',
				type: 'string',
				default: '',
				placeholder: 'e.g. ASS001B',
				description:
					'Primary key (XIDENT). For Create, this must usually match the key field in the Data JSON (e.g. ITM0.ITMREF) unless Sage X3 auto-generates it. For Custom actions, fill it only if the action needs one.',
				displayOptions: { show: { operation: ['create', 'custom'] } },
			},
			{
				displayName: 'Data (JSON)',
				name: 'data',
				type: 'json',
				default: '{\n  "ITM0": {\n    "TSICOD": ["20"]\n  }\n}',
				required: true,
				description:
					'JSON payload sent as XDATAJSON. For Create/Modify: the fields to set. For List: optional filter/selection criteria. For Custom: depends on the action. All fields are dimensioned, so values are arrays (e.g. "TSICOD": ["20"]); use "TSICOD(1)":"20" to target a specific index. Dates: "YYYY-MM-DD".',
				displayOptions: { show: { operation: X3_OPS_WITH_DATA } },
			},

			// Context envelope (ChatX3 patch) --------------------------------------
			// Merged into XDATAJSON as a top-level `context` key, alongside the object
			// data, only if the user fills at least one sub-option. A workflow that
			// leaves this empty produces exactly the same payload as before — keeps
			// backward compatibility with the existing patch behaviour.
			{
				displayName: 'Context (Optional)',
				name: 'x3Context',
				type: 'collection',
				placeholder: 'Add context option',
				default: {},
				displayOptions: { show: { operation: X3_OBJECT_OPS } },
				description:
					'XCHATX3OBJ-level overrides and response filtering. Different layer from the SOAP callContext in Advanced Options.',
				options: [
					{
						displayName: 'Include Hidden Fields',
						name: 'hiddenFields',
						type: 'boolean',
						default: false,
						description:
							'Whether to include hidden and technical fields in the response (off by default)',
					},
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: '',
						placeholder: 'e.g. ITA',
						description:
							'Override the XCHATX3OBJ language for this call (e.g. ITA). Independent from the SOAP-level codeLang in Advanced Options.',
					},
					{
						displayName: 'Response Fields',
						name: 'responseFields',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						placeholder: 'Add field',
						description: 'Restrict the response to these field codes',
						options: [
							{
								name: 'item',
								displayName: 'Field',
								values: [
									{
										displayName: 'Name',
										name: 'value',
										type: 'string',
										default: '',
										placeholder: 'e.g. DES1AXX',
									},
								],
							},
						],
					},
					{
						displayName: 'Response Screens',
						name: 'responseScreens',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						placeholder: 'Add screen',
						description: 'Restrict the response to these screen codes',
						options: [
							{
								name: 'item',
								displayName: 'Screen',
								values: [
									{
										displayName: 'Code',
										name: 'value',
										type: 'string',
										default: '',
										placeholder: 'e.g. ITM0',
									},
								],
							},
						],
					},
					{
						displayName: 'User',
						name: 'user',
						type: 'string',
						default: '',
						placeholder: 'e.g. FU01',
						description:
							'Override the target user for this call. Only honored when the caller has GPROFIL=ADMIN.',
					},
				],
			},

			// SQL operations (XOBJECT='SQL', payload built from Query + Options) ---
			{
				displayName: 'SQL Query',
				name: 'sqlQuery',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				placeholder: 'e.g. SELECT TOP (100) [ITMREF_0], [ITMDES1_0] FROM [ITMMASTER]',
				description:
					'SQL query executed against the Sage X3 database via the ChatX3 sub-program. Read-only style — use SQL Analyse to validate the syntax, SQL Select to fetch rows. Supports {{name}} placeholders and [[optional clauses]] defined in Query Parameters.',
				displayOptions: { show: { operation: SQL_OPS } },
			},
			{
				displayName: 'Parameters Mode',
				name: 'sqlParametersMode',
				type: 'options',
				default: 'fields',
				displayOptions: { show: { operation: SQL_OPS } },
				description: 'Where the {{name}} values come from',
				options: [
					{
						name: 'Fields',
						value: 'fields',
						description: 'Declare each parameter below, one row per name',
					},
					{
						name: 'JSON',
						value: 'json',
						description:
							'Pass the whole parameter list as JSON, typically through an expression on the incoming item — for a generic sub-workflow that runs queries stored elsewhere',
					},
				],
			},
			{
				displayName: 'Query Parameters',
				name: 'sqlParameters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add parameter',
				displayOptions: { show: { operation: SQL_OPS, sqlParametersMode: ['fields'] } },
				description:
					"Named filter values substituted into the query. Write {{name}} where the value goes — never inside quotes, the value brings its own. Wrap a clause in [[ ... ]] to drop it entirely when its parameter is empty, e.g. [[AND CREUSR_0 = {{creator}}]]. As an AI tool, give each $fromAI an empty default so the model may omit the filter: $fromAI('creator', '...', 'string', '')",
				options: [
					{
						name: 'parameter',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. creator',
								description: 'Name used as {{name}} in the query',
							},
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								default: 'text',
								description: 'How the value is escaped before it reaches the query',
								options: [
									{ name: 'Boolean', value: 'boolean', description: 'Rendered as 1 or 0' },
									{
										name: 'Contains',
										value: 'contains',
										description:
											"Wrapped in % for a LIKE search — type dupont, get '%dupont%'. Any % or _ inside the value is escaped so it stays a literal character.",
									},
									{
										name: 'Date',
										value: 'date',
										description: 'YYYY-MM-DD or ISO-8601, rendered quoted',
									},
									{
										name: 'List',
										value: 'list',
										description:
											'Comma-separated values, each quoted separately — for IN ({{name}})',
									},
									{ name: 'Number', value: 'number', description: 'Validated numeric, unquoted' },
									{ name: 'Text', value: 'text', description: 'Quoted, embedded quotes doubled' },
								],
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									"Leave empty to drop any [[ ... ]] clause that uses this parameter. When the model fills this in, end the call with an empty default — $fromAI('name', '...', 'string', '') — otherwise n8n makes the field mandatory and the model can never skip the filter.",
							},
						],
					},
				],
			},
			{
				displayName: 'Query Parameters (JSON)',
				name: 'sqlParametersJson',
				type: 'json',
				default: '[]',
				displayOptions: { show: { operation: SQL_OPS, sqlParametersMode: ['json'] } },
				description:
					'Array of { "name", "type", "value" } objects. type is one of boolean, contains, date, list, number, text. value may be a string, a number, a boolean, null or an array (joined with commas for a List). Same escaping and [[ ... ]] rules as the Fields mode.',
				placeholder:
					'e.g. [{ "name": "customer", "type": "list", "value": "FR001,FR002" }, { "name": "from", "type": "date", "value": "2025-01-01" }]',
			},
			{
				displayName: 'SQL Options (Optional)',
				name: 'sqlOptions',
				type: 'collection',
				placeholder: 'Add SQL option',
				default: {},
				displayOptions: { show: { operation: SQL_OPS } },
				description: 'Optional runtime caps for the SQL execution',
				options: [
					{
						displayName: 'Max Lines',
						name: 'maxLines',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 1 },
						description: 'Cap the number of rows returned',
					},
					{
						displayName: 'Max Time (Seconds)',
						name: 'maxTime',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 1 },
						description:
							'Cap the SQL execution time inside Sage X3, in seconds. Keep it below the node Request Timeout in Advanced Options, otherwise the HTTP request gives up first.',
					},
				],
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: false,
				// Default stays false on purpose: n8n applies schema defaults to
				// already-saved workflows, so flipping it would silently rewrite the
				// output of every existing SQL Select node.
				displayOptions: { show: { operation: ['sqlSelect'] } },
				description:
					'Whether to return just the result rows, with the real column names restored from the query instead of the generic Col_1, Col_2 keys returned by Sage X3',
			},
			{
				displayName: 'Row Format',
				name: 'rowFormat',
				type: 'options',
				default: 'objects',
				displayOptions: { show: { operation: ['sqlSelect'], simplify: [true] } },
				description: 'How each row is shaped in the simplified output',
				options: [
					{
						name: 'Arrays',
						value: 'arrays',
						description: 'Values only, ordered like columns — compact, ideal for an AI Agent',
					},
					{
						name: 'Objects',
						value: 'objects',
						description: 'One key per column — easiest to reference in expressions',
					},
				],
			},

			// Run Sage X3 Query (READ of the ALT record + SELECT) ----------------
			{
				displayName: 'Query Code',
				name: 'queryCode',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. FRVEN055',
				description:
					'Code of the graphical query (object ALT) to run, as shown in the Sage X3 query tool',
				displayOptions: { show: { operation: ['runQuery'] } },
			},
			{
				displayName: 'Execute',
				name: 'queryExecute',
				type: 'boolean',
				default: true,
				description:
					'Whether to run the SQL on Sage X3 and return the rows. Turn off to get only the SQL and the query structure.',
				displayOptions: { show: { operation: ['runQuery'] } },
			},
			{
				displayName: 'Bounds',
				name: 'queryBounds',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add bound',
				displayOptions: { show: { operation: ['runQuery'], queryExecute: [true] } },
				description:
					'Start / end values for the columns the query lets the user bound, like the bounds screen in Sage X3. Name the column by its field (BPCORD), by alias and field (SQH_BPCORD) or by its grid label. Leave From or To empty to bound on one side only.',
				options: [
					{
						name: 'bound',
						displayName: 'Bound',
						values: [
							{
								displayName: 'Column',
								name: 'column',
								type: 'string',
								default: '',
								placeholder: 'e.g. BPCORD',
								description: 'Field code, alias_field, or grid label of a bounded column',
							},
							{
								displayName: 'From',
								name: 'from',
								type: 'string',
								default: '',
								description: 'Lower bound (inclusive). Dates as YYYY-MM-DD.',
							},
							{
								displayName: 'To',
								name: 'to',
								type: 'string',
								default: '',
								description: 'Upper bound (inclusive). Dates as YYYY-MM-DD.',
							},
						],
					},
				],
			},
			{
				displayName: 'Query Options',
				name: 'queryOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['runQuery'] } },
				options: [
					{
						displayName: 'Bounds as Parameters',
						name: 'boundsAsParameters',
						type: 'boolean',
						default: false,
						description:
							'Whether to keep, when Execute is off, an optional [[AND column >= {{name_from}}]] / [[AND column <= {{name_to}}]] clause for every bounded column, in the syntax of the SQL Select operation, with the parameter list under "parameters". Always on when Execute is on.',
					},
					{
						displayName: 'Column Aliases',
						name: 'columnAliases',
						type: 'options',
						default: 'label',
						description: 'What the AS alias of each SELECT column is made of',
						options: [
							{
								name: 'Code',
								value: 'code',
								description: 'Table alias and field, e.g. SQH_BPCORD; formulas become EXPR_n',
							},
							{
								name: 'Label',
								value: 'label',
								description: 'The column label shown in the X3 grid, e.g. [Customer name]',
							},
							{
								name: 'None',
								value: 'none',
								description: 'No alias, the raw column expression only',
							},
						],
					},
					{
						displayName: 'Include Hidden Columns',
						name: 'includeHidden',
						type: 'boolean',
						default: false,
						description:
							'Whether to keep the columns the query hides from the grid (Vis="N") in the SELECT list. They stay available for sorting and bounds either way.',
					},
					{
						displayName: 'Include Query Structure',
						name: 'includeStructure',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the interpreted structure (tables, joins, columns, criteria, order by) next to the rows when Execute is on. Always returned when Execute is off.',
					},
					{
						displayName: 'Include Table Fields',
						name: 'includeTableFields',
						type: 'boolean',
						default: false,
						description:
							'Whether to list every field and index of each table under "tables". Off by default: a table can carry hundreds of fields.',
					},
					{
						displayName: 'Local Menus',
						name: 'localMenus',
						type: 'options',
						default: 'label',
						description:
							'How a local-menu column (quote status, item status...) is returned. Criteria, bounds and sort always work on the stored number.',
						options: [
							{
								name: 'Both',
								value: 'both',
								description:
									'The label, plus the number in a second column named after the label followed by " (code)"',
							},
							{
								name: 'Code',
								value: 'code',
								description: 'The number stored in the table, e.g. 1',
							},
							{
								name: 'Label',
								value: 'label',
								description:
									'The label in the credential language, as the X3 grid shows it, e.g. Open',
							},
						],
					},
					{
						displayName: 'Max Lines',
						name: 'maxLines',
						type: 'number',
						default: -1,
						typeOptions: { minValue: -1 },
						description:
							'Row cap rendered as TOP (SQL Server) or FETCH FIRST (Oracle), and passed to Sage X3 as max_lines. -1 keeps the Max Lines of the query itself, 0 removes any cap.',
					},
					{
						displayName: 'Max Time (Seconds)',
						name: 'maxTime',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 0 },
						description:
							'Cap the SQL execution time inside Sage X3, in seconds. Keep it below the Request Timeout in Advanced Options.',
					},
					{
						displayName: 'Row Format',
						name: 'rowFormat',
						type: 'options',
						default: 'objects',
						description: 'How each row is shaped when Execute is on',
						options: [
							{
								name: 'Arrays',
								value: 'arrays',
								description: 'Values only, ordered like columns — compact, ideal for an AI Agent',
							},
							{
								name: 'Objects',
								value: 'objects',
								description: 'One key per column — easiest to reference in expressions',
							},
						],
					},
					{
						displayName: 'Schema',
						name: 'schema',
						type: 'string',
						default: '',
						placeholder: 'e.g. SEED',
						description:
							'Folder (schema) prefix for the table names, e.g. SEED or basex3.SEED. Not needed when the SQL runs through Sage X3, which is already inside the folder.',
					},
					{
						displayName: 'SQL Dialect',
						name: 'dialect',
						type: 'options',
						default: 'mssql',
						description: 'Database engine behind the Sage X3 folder',
						options: [
							{ name: 'Oracle', value: 'oracle' },
							{ name: 'SQL Server', value: 'mssql' },
						],
					},
					{
						displayName: 'X3 User',
						name: 'x3User',
						type: 'string',
						default: '',
						placeholder: 'e.g. ADMIN',
						description:
							'X3 user code substituted for GUSER / GACTX.USER in the criteria of "my ..." queries (my quotes, my order book). Left empty, such a criterion is reported in warnings and the SQL fails.',
					},
				],
			},

			// Run Sub-Program (Advanced) -------------------------------------------
			{
				displayName: 'Public Name',
				name: 'publicName',
				type: 'string',
				default: DEFAULT_PUBLIC_NAME,
				required: true,
				description: 'Name of the Sage X3 web service / sub-program to call',
				displayOptions: { show: { operation: ['runRaw'] } },
			},
			{
				displayName: 'Input XML',
				name: 'inputXml',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				required: true,
				description: 'Raw XML payload passed to the sub-program (wrapped in CDATA automatically)',
				displayOptions: { show: { operation: ['runRaw'] } },
			},

			// Shared advanced options ----------------------------------------------
			{
				displayName: 'Advanced Options',
				name: 'advanced',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Code Language Override',
						name: 'codeLang',
						type: 'string',
						default: '',
						description: 'Override the credential codeLang for this call',
					},
					{
						displayName: 'Compact Single-Value Arrays',
						name: 'compactArrays',
						type: 'boolean',
						default: true,
						description:
							'Whether to unwrap single-element arrays in the data output (e.g. ["Iconext"] becomes "Iconext"). Multi-value arrays are kept untouched. Improves readability and lets you reference values without the [0] suffix in downstream expressions.',
					},
					{
						displayName: 'Include Raw SOAP Response',
						name: 'includeRaw',
						type: 'boolean',
						default: false,
						description: 'Whether to include the full SOAP response body in the output',
					},
					{
						displayName: 'Include Request in Output',
						name: 'includeRequest',
						type: 'boolean',
						default: false,
						description:
							'Whether to include the SOAP envelope and X3 input XML that were sent, useful for debugging',
					},
					{
						displayName: 'Include Result in Output',
						name: 'includeResultXml',
						type: 'boolean',
						default: false,
						description:
							'Whether to include the parsed X3 result payload (the resultXml content, navigable) in the output under the "result" key',
					},
					{
						displayName: 'Include Technical Infos',
						name: 'includeTechnicalInfos',
						type: 'boolean',
						default: false,
						description:
							'Whether to include the X3 pool and timing metrics (the SOAP technicalInfos block) in the output. Off by default: it is about a quarter of each item and carries nothing a workflow or an AI Agent can act on. Turn it on to diagnose pool contention or slow calls.',
					},
					{
						displayName: 'Pool Alias Override',
						name: 'poolAlias',
						type: 'string',
						default: '',
						description: 'Override the credential poolAlias for this call',
					},
					{
						displayName: 'Pool ID Override',
						name: 'poolId',
						type: 'string',
						default: '',
						description:
							"Override the credential poolId. Set this to the previous call's `sessionId` (e.g. ={{$JSON.sessionId}}) to keep the same Sage X3 session — needed when chaining READ → MODIFY to preserve the Sage X3 lock on the object.",
					},
					{
						displayName: 'Public Name Override',
						name: 'publicName',
						type: 'string',
						default: DEFAULT_PUBLIC_NAME,
						description: 'Override the Sage X3 sub-program used by Read/Create/Modify',
					},
					{
						displayName: 'Request Timeout (Seconds)',
						name: 'requestTimeout',
						type: 'number',
						default: 30,
						typeOptions: { minValue: 1 },
						description:
							'Abort the SOAP request after this many seconds if Sage X3 has not responded. Prevents AI Agent runs from hanging when the X3 server is unreachable. A clear timeout error is then surfaced to the workflow / agent.',
					},
					{
						displayName: 'Trim Trailing Empty Values',
						name: 'trimEmpty',
						type: 'boolean',
						default: true,
						description:
							'Whether to drop empty values at the end of arrays. X3 pads dimensioned fields up to their max size — e.g. "CCE": ["PEND-001","","","","",""] becomes ["PEND-001"], then "PEND-001" if Compact is also on. Interior empty values are preserved.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('nx3SoapApi');
		const soapUrl = resolveX3Connection(credentials, {}).soapUrl;

		for (let i = 0; i < items.length; i++) {
			// Progress of a Run Sage X3 Query item, so a failure can say which
			// query, which call and what SQL it was about.
			let queryState: QueryRunState | undefined;
			try {
				const operation = this.getNodeParameter('operation', i) as Operation;
				const advanced = this.getNodeParameter('advanced', i, {}) as IDataObject;

				// Where and how to call X3: credential defaults + per-call overrides.
				const connection = resolveX3Connection(credentials, advanced);
				const ctx = connection.ctx;

				if (operation === 'runQuery') {
					queryState = { queryCode: '', phase: 'read', timings: {} };
					const output = await runX3Query(
						this,
						connection,
						{
							queryCode: this.getNodeParameter('queryCode', i, '') as string,
							execute: this.getNodeParameter('queryExecute', i, true) as boolean,
							bounds: ((this.getNodeParameter('queryBounds', i, {}) as IDataObject).bound ??
								[]) as BoundInput[],
							options: this.getNodeParameter('queryOptions', i, {}) as IDataObject,
							includeRequest: Boolean(advanced.includeRequest),
							itemIndex: i,
						},
						queryState,
					);
					returnData.push({ json: output, pairedItem: i });
					continue;
				}

				const includeResultXml = Boolean(advanced.includeResultXml);
				const includeRaw = Boolean(advanced.includeRaw);
				const includeRequest = Boolean(advanced.includeRequest);
				// Off by default: pool and timing metrics are debug material, and when the
				// node runs as an AI Agent tool every byte of them is paid for in tokens.
				const includeTechnicalInfos = Boolean(advanced.includeTechnicalInfos);
				// Default true: compact single-value arrays for readability. Pass advanced.compactArrays
				// explicitly only when set (n8n collections may omit unset values).
				const compactArrays =
					advanced.compactArrays === undefined ? true : Boolean(advanced.compactArrays);
				const trimEmpty = advanced.trimEmpty === undefined ? true : Boolean(advanced.trimEmpty);
				const reshapeOpts = { compact: compactArrays, trimEmpty };

				let envelope: string;
				let inputXmlSent: string;
				// Set by the SQL branch: the query after parameter substitution, used
				// later to recover the real column names for the Simplify output.
				let sqlFinalQuery: string | undefined;
				let sqlMaxLines: number | undefined;
				let metaForOutput:
					| { kind: 'object'; action: string; object: string; ident: string; transaction: string }
					| { kind: 'raw'; publicName: string };

				if (operation === 'runRaw') {
					const publicName = this.getNodeParameter('publicName', i) as string;
					inputXmlSent = this.getNodeParameter('inputXml', i) as string;
					envelope = buildRunEnvelope(ctx, publicName, inputXmlSent);
					metaForOutput = { kind: 'raw', publicName };
				} else if (SQL_OPS.includes(operation)) {
					// XOBJECT is fixed to 'SQL'; XDATAJSON = { query, context?: { max_lines?, max_time? } }.
					let query = (this.getNodeParameter('sqlQuery', i, '') as string).trim();
					if (!query) {
						throw new NodeOperationError(this.getNode(), 'SQL Query is required', {
							itemIndex: i,
						});
					}

					// Metabase-style {{name}} / [[optional clause]] resolution. Values are
					// escaped per type, never concatenated raw.
					const paramsMode = this.getNodeParameter('sqlParametersMode', i, 'fields') as string;
					try {
						const sqlParams =
							paramsMode === 'json'
								? parseSqlParamsJson(this.getNodeParameter('sqlParametersJson', i, '[]'))
								: (this.getNodeParameter('sqlParameters.parameter', i, []) as SqlParam[]);
						query = applyQueryParameters(query, sqlParams).trim();
					} catch (e) {
						throw new NodeOperationError(this.getNode(), (e as Error).message, { itemIndex: i });
					}
					if (!query) {
						throw new NodeOperationError(
							this.getNode(),
							'The SQL query is empty once the optional [[ ... ]] clauses were removed',
							{ itemIndex: i },
						);
					}
					sqlFinalQuery = query;

					const sqlOpts = this.getNodeParameter('sqlOptions', i, {}) as IDataObject;
					const sqlCtx: IDataObject = {};
					// Caps may come from an expression that yields a numeric string.
					const maxLines = readPositiveNumber(sqlOpts.maxLines);
					const maxTime = readPositiveNumber(sqlOpts.maxTime);
					if (maxLines !== undefined) sqlCtx.max_lines = maxLines;
					if (maxTime !== undefined) sqlCtx.max_time = maxTime;
					sqlMaxLines = maxLines;
					const sqlPayload: IDataObject = { query };
					if (Object.keys(sqlCtx).length > 0) sqlPayload.context = sqlCtx;

					// A typed Action Code overrides the ANALYSE/SELECT preset, mirroring the
					// behaviour for object ops.
					const typedAction = (this.getNodeParameter('actionCode', i, '') as string)
						.trim()
						.toUpperCase();
					const action = typedAction || ACTION_MAP[operation as 'sqlAnalyse' | 'sqlSelect'];

					const publicName = connection.publicName;

					inputXmlSent = buildChatX3InputJson({
						object: 'SQL',
						transaction: '',
						action,
						ident: '',
						dataJson: JSON.stringify(sqlPayload),
					});
					envelope = buildRunEnvelope(ctx, publicName, inputXmlSent);
					metaForOutput = { kind: 'object', action, object: 'SQL', ident: '', transaction: '' };
				} else {
					const object = (this.getNodeParameter('object', i) as string).trim();
					const ident = (this.getNodeParameter('ident', i, '') as string).trim();
					const transaction = (this.getNodeParameter('transaction', i, '') as string).trim();

					// A typed Action Code always wins. When left empty, fall back to the XACTION
					// implied by the Operation dropdown (the dropdown then acts as a shortcut).
					const typedAction = (this.getNodeParameter('actionCode', i, '') as string)
						.trim()
						.toUpperCase();
					const action: string =
						typedAction || (operation === 'custom' ? '' : ACTION_MAP[operation]);

					if (!action) {
						throw new NodeOperationError(
							this.getNode(),
							'Action Code is required when Operation is "Custom"',
							{ itemIndex: i },
						);
					}

					if (!object) {
						throw new NodeOperationError(this.getNode(), 'X3 Object Code is required', {
							itemIndex: i,
						});
					}
					if ((operation === 'read' || operation === 'modify') && !ident) {
						throw new NodeOperationError(this.getNode(), 'Identifier is required for Read/Modify', {
							itemIndex: i,
						});
					}

					// Build the XDATAJSON payload. Object data is only sent for ops in
					// X3_OPS_WITH_DATA (List/Create/Modify/Custom); Read and Describe
					// start from an empty payload. The optional Context envelope from the
					// ChatX3 patch (language/user/response.*) is merged in at the top level
					// when at least one sub-option is filled.
					const parsed: IDataObject = {};
					if (X3_OPS_WITH_DATA.includes(operation)) {
						const rawData = this.getNodeParameter('data', i, '{}');
						let parsedData: unknown;
						if (typeof rawData === 'string') {
							try {
								parsedData = JSON.parse(rawData);
							} catch (e) {
								throw new NodeOperationError(
									this.getNode(),
									`Data field is not valid JSON: ${(e as Error).message}`,
									{ itemIndex: i },
								);
							}
						} else {
							parsedData = rawData;
						}
						if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
							Object.assign(parsed, parsedData as IDataObject);
						}
					}

					const ctxInput = this.getNodeParameter('x3Context', i, {}) as IDataObject;
					const contextObj: IDataObject = {};
					if (typeof ctxInput.language === 'string' && ctxInput.language !== '') {
						contextObj.language = ctxInput.language;
					}
					if (typeof ctxInput.user === 'string' && ctxInput.user !== '') {
						contextObj.user = ctxInput.user;
					}
					const responseObj: IDataObject = {};
					const screens = (
						(ctxInput.responseScreens as { item?: Array<{ value?: string }> })?.item ?? []
					)
						.map((s) => s.value?.trim())
						.filter((v): v is string => !!v);
					if (screens.length > 0) responseObj.screens = screens;
					const fields = (
						(ctxInput.responseFields as { item?: Array<{ value?: string }> })?.item ?? []
					)
						.map((s) => s.value?.trim())
						.filter((v): v is string => !!v);
					if (fields.length > 0) responseObj.fields = fields;
					if (ctxInput.hiddenFields === true) responseObj.hidden_fields = true;
					if (Object.keys(responseObj).length > 0) contextObj.response = responseObj;
					if (Object.keys(contextObj).length > 0) parsed.context = contextObj;

					// Compact form (no whitespace/newlines) — matches what SoapUI sends and
					// avoids confusing X3's payload parser when entity-encoded whitespace would
					// leak through (&#x0a; etc.). Empty payload stays empty.
					const dataJsonString = Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : '';

					const publicName = connection.publicName;

					inputXmlSent = buildChatX3InputJson({
						object,
						transaction,
						action,
						ident,
						dataJson: dataJsonString,
					});

					envelope = buildRunEnvelope(ctx, publicName, inputXmlSent);
					metaForOutput = { kind: 'object', action, object, ident, transaction };
				}

				const rawText = await postSoapEnvelope(this, connection, envelope);
				const parsed = parseRunResponse(rawText);

				// Simplify only applies to SQL Select, and only when the payload really
				// is row-shaped; anything else falls through to the standard envelope.
				const simplifySql =
					sqlFinalQuery !== undefined && (this.getNodeParameter('simplify', i, false) as boolean);
				const simplified = simplifySql
					? buildSqlSimplifiedOutput(
							parsed,
							sqlFinalQuery as string,
							this.getNodeParameter('rowFormat', i, 'objects') as 'arrays' | 'objects',
							sqlMaxLines,
						)
					: undefined;

				let output: IDataObject;
				if (simplified !== undefined) {
					output = simplified;
				} else if (metaForOutput.kind === 'object') {
					output = buildObjectOperationOutput({
						action: metaForOutput.action,
						object: metaForOutput.object,
						ident: metaForOutput.ident,
						transaction: metaForOutput.transaction,
						parsed,
						includeResultXml,
						includeRaw,
						includeTechnicalInfos,
						reshapeOpts,
						raw: rawText,
					});
					// Asked for Simplify but the response was not row-shaped — say so
					// instead of silently returning a different structure.
					if (simplifySql) output.simplified = false;
				} else {
					output = {
						success: parsed.xsuccess ?? parsed.status === 1,
						status: parsed.status,
						publicName: metaForOutput.publicName,
					};
					if (parsed.dataJson !== undefined) {
						const data =
							reshapeOpts.compact || reshapeOpts.trimEmpty
								? reshapeX3Data(parsed.dataJson, reshapeOpts)
								: parsed.dataJson;
						output.data = data as IDataObject;
					}
					if (parsed.xmessages !== undefined) output.messages = parsed.xmessages as IDataObject;
					else if (parsed.soapMessages.length > 0) output.messages = parsed.soapMessages;
					if (parsed.xtrace !== undefined) output.trace = parsed.xtrace;
					if (parsed.sessionId !== undefined) output.sessionId = parsed.sessionId;
					if (includeTechnicalInfos && Object.keys(parsed.technicalInfos).length > 0)
						output.technicalInfos = parsed.technicalInfos;
					if (includeResultXml && parsed.resultXml)
						output.result = debugResult(parsed.resultXml) as IDataObject;
					if (includeRaw) output.raw = rawText;
				}

				if (includeRequest) {
					// Expose the payload as a navigable object (XDATAJSON parsed too) when it is JSON,
					// else keep the raw string (e.g. XML mode or runRaw). Envelope stays raw (transport).
					const parsedInput = tryParseJson(inputXmlSent);
					const input =
						parsedInput && typeof parsedInput === 'object'
							? deepParseJsonStrings(parsedInput)
							: inputXmlSent;
					// The URL is the one thing the envelope cannot show, and it is what
					// separates "same call, different server" from "same server,
					// different folder" when two n8n instances disagree.
					output.request = {
						url: soapUrl,
						input: input as IDataObject,
						envelope,
					};
				}

				returnData.push({ json: output, pairedItem: i });
			} catch (error) {
				const err = error as Error & { code?: string };
				const { message: friendlyMessage, httpStatus } = describeX3Error(err, soapUrl);

				if (this.continueOnFail()) {
					const json: IDataObject = {
						error: friendlyMessage,
						code: err.code,
						httpStatus,
						url: soapUrl,
						raw: err.message,
					};
					if (queryState) {
						json.queryCode = queryState.queryCode;
						json.phase = queryState.phase;
						if (queryState.sql !== undefined) json.sql = queryState.sql;
						json.timings = queryState.timings;
					}
					returnData.push({ json, pairedItem: i });
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, {
					itemIndex: i,
					message: friendlyMessage,
				});
			}
		}

		return [returnData];
	}
}
