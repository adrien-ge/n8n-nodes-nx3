/**
 * Interpreter for Sage X3 graphical queries (object ALT, "Requêteur graphique").
 *
 * A query is stored as an X3PORTAL XML document in ALT1.CLBFL: the tables it
 * uses, the links between them, and the columns dropped on the result grid.
 * The selection criteria live beside it, in ALT2.SEL, written in the X3 4GL
 * expression language. This module turns the whole thing into a SQL SELECT
 * that can be run against the X3 database (SQL Server or Oracle), together
 * with a structured description of the query.
 */

import { ApplicationError } from 'n8n-workflow';

export type SqlDialect = 'mssql' | 'oracle';

export type ColumnAliasMode = 'label' | 'code' | 'none';

export interface InterpretOptions {
	dialect: SqlDialect;
	/** Schema / folder prefix for table names, e.g. `SEED` or `basex3.SEED`. */
	schema?: string;
	columnAliases: ColumnAliasMode;
	/** Keep columns the query marks as hidden (Vis="N") in the SELECT list. */
	includeHidden: boolean;
	/**
	 * Render each bounded column (Bounds="Y") as an optional `[[AND ... {{name}}]]`
	 * clause, using the parameter syntax of the SQL Select operation.
	 */
	boundsAsParameters: boolean;
	/** Row cap; `undefined` falls back to the query's own Max Lines, 0 disables it. */
	maxLines?: number;
	/** Add the full field catalogue of every table to the output. */
	includeTableFields: boolean;
	/** Language of the translatable texts (ATEXTRA.LANGUE_0), e.g. FRA or ENG. Default FRA. */
	language?: string;
	/**
	 * How a local-menu column (X3 type M) is selected: the stored number (`code`),
	 * its label from APLSTD as the X3 grid shows it (`label`), or both. Default code.
	 */
	localMenus?: 'code' | 'label' | 'both';
	/** X3 user code substituted for `GUSER` / `GACTX.USER` in the criteria. */
	user?: string;
}

export interface X3QuerySource {
	code?: string;
	title?: string;
	module?: number;
	clbfl: string;
	/** Selection criteria, one X3 expression per entry (ANDed). */
	sel: string[];
	/**
	 * Link expressions from ALT2.LNK, the "Links" tab: `[F:ADI]CODE = 20 ; [F:ITM]TSICOD`
	 * reads table ADI through its index CODE with one expression per key field.
	 */
	lnk?: string[];
	maxLines?: number;
	objectLink?: string;
	functionLink?: string;
	/**
	 * Data types of the dropped columns, in grid order, when the ALT5 block is
	 * available (CODTYP of the TYPLIG=4 rows). Used to type bound parameters.
	 */
	columnTypes?: string[];
	/**
	 * X3 data type of every table field, keyed `ALIAS.FIELD`, from the ALT5
	 * TYPLIG=2 rows. Tells translatable texts (AX* types) apart from real columns.
	 */
	fieldTypes?: Record<string, string>;
	/** Local-menu number of every menu field, keyed `ALIAS.FIELD`, from the ALT5 NOLIB column. */
	fieldMenus?: Record<string, number>;
}

export interface QueryTable {
	alias: string;
	name: string;
	label: string;
	sql: string;
	fields?: Array<{ name: string; label: string }>;
	indexes?: Array<{ name: string; fields: string[] }>;
}

export interface QueryJoin {
	/** Alias of the table this JOIN brings into the query. */
	table: string;
	type: 'inner' | 'left' | 'right' | 'cross';
	on: Array<{ from: { alias: string; field: string }; to: { alias: string; field: string } }>;
	sql: string;
}

export interface QueryColumn {
	position: number;
	label: string;
	expression: string;
	sql: string;
	alias?: string;
	visible: boolean;
	sort?: 'asc' | 'desc';
	level: number;
	sum: boolean;
	bounds: boolean;
	type?: string;
	/** Local-menu number for an X3 type M column. */
	menu?: number;
	/** The APLSTD lookup that returns the menu label, when the column is a local menu. */
	labelSql?: string;
}

export interface QueryCriterion {
	x3: string;
	sql: string;
}

export interface QueryParameter {
	name: string;
	type: 'date' | 'number' | 'text';
	column: string;
	label: string;
	bound: 'from' | 'to';
}

export interface InterpretedQuery {
	code?: string;
	title?: string;
	module?: number;
	objectLink?: string;
	functionLink?: string;
	tables: QueryTable[];
	joins: QueryJoin[];
	columns: QueryColumn[];
	criteria: QueryCriterion[];
	orderBy: Array<{ sql: string; direction: 'asc' | 'desc' }>;
	parameters: QueryParameter[];
	maxLines?: number;
	sql: string;
	warnings: string[];
}

/** Raised when a query definition cannot be interpreted; the node turns it into a NodeOperationError. */
export class X3QueryError extends ApplicationError {}

// ---------------------------------------------------------------------------
// XML helpers (regex based: the X3PORTAL document is small and regular)
// ---------------------------------------------------------------------------

function xmlUnescape(s: string): string {
	return s
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function parseAttrs(tag: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(tag)) !== null) attrs[m[1]] = xmlUnescape(m[2]);
	return attrs;
}

/** Every `<name ...>...</name>` block (non nested) with its attributes and inner content. */
function elements(
	xml: string,
	name: string,
): Array<{ attrs: Record<string, string>; inner: string }> {
	const out: Array<{ attrs: Record<string, string>; inner: string }> = [];
	const re = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) out.push({ attrs: parseAttrs(m[1]), inner: m[2] ?? '' });
	return out;
}

function section(xml: string, name: string): string {
	const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
	return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// X3 4GL expression → SQL
// ---------------------------------------------------------------------------

type Token =
	| { kind: 'ref'; table: string; field: string; index: number }
	| { kind: 'date'; day: number; month: number; year: number }
	| { kind: 'str'; value: string }
	| { kind: 'num'; value: string }
	| { kind: 'ident'; value: string }
	| { kind: 'op'; value: string }
	| { kind: 'punct'; value: '(' | ')' | ',' };

// `[F:SQH]BPCORD`, `[SQH]BPCORD(1)`; the `F:` class prefix is optional.
const REF_RE = /^\[(?:[A-Za-z]:)?([A-Za-z][A-Za-z0-9_]*)\]([A-Za-z][A-Za-z0-9_]*)(?:\((\d+)\))?/;
const DATE_RE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{1,4})\]/;
const NUM_RE = /^\d+(?:\.\d+)?/;
// `date$`, `GUSER`, and class members such as `GACTX.USER`.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\$?/;
const OPS = ['<>', '<=', '>=', '=', '<', '>', '&', '|', '!', '+', '-', '*', '/', '^'];

function tokenize(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < expr.length) {
		const rest = expr.slice(i);
		const c = rest[0];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		let m = rest.match(REF_RE);
		if (m) {
			tokens.push({ kind: 'ref', table: m[1], field: m[2], index: m[3] ? Number(m[3]) : 0 });
			i += m[0].length;
			continue;
		}
		m = rest.match(DATE_RE);
		if (m) {
			tokens.push({ kind: 'date', day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) });
			i += m[0].length;
			continue;
		}
		if (c === '"' || c === "'") {
			// X3 accepts both quote characters and doubles an embedded one.
			let j = 1;
			let value = '';
			while (j < rest.length) {
				if (rest[j] === c) {
					if (rest[j + 1] === c) {
						value += c;
						j += 2;
						continue;
					}
					break;
				}
				value += rest[j];
				j++;
			}
			if (j >= rest.length) throw new X3QueryError(`Unterminated string in expression: ${expr}`);
			tokens.push({ kind: 'str', value });
			i += j + 1;
			continue;
		}
		m = rest.match(NUM_RE);
		if (m) {
			tokens.push({ kind: 'num', value: m[0] });
			i += m[0].length;
			continue;
		}
		m = rest.match(IDENT_RE);
		if (m) {
			tokens.push({ kind: 'ident', value: m[0] });
			i += m[0].length;
			continue;
		}
		if (c === '(' || c === ')' || c === ',') {
			tokens.push({ kind: 'punct', value: c });
			i++;
			continue;
		}
		const op = OPS.find((o) => rest.startsWith(o));
		if (op) {
			tokens.push({ kind: 'op', value: op });
			i += op.length;
			continue;
		}
		throw new X3QueryError(`Unexpected character "${c}" in expression: ${expr}`);
	}
	return tokens;
}

type Node =
	| { kind: 'token'; token: Token }
	| { kind: 'group'; items: Node[] }
	| { kind: 'call'; name: string; args: Node[][] };

/** Group parentheses and function calls so arguments can be reordered when needed. */
function parse(tokens: Token[]): Node[] {
	let pos = 0;

	function parseSequence(stopAt: Set<string>): Node[] {
		const items: Node[] = [];
		while (pos < tokens.length) {
			const t = tokens[pos];
			if (t.kind === 'punct' && stopAt.has(t.value)) return items;
			pos++;
			if (t.kind === 'punct' && t.value === '(') {
				items.push({ kind: 'group', items: parseSequence(new Set([')'])) });
				expect(')');
				continue;
			}
			if (
				t.kind === 'ident' &&
				tokens[pos]?.kind === 'punct' &&
				(tokens[pos] as { value: string }).value === '('
			) {
				pos++;
				const args: Node[][] = [];
				if (!(tokens[pos]?.kind === 'punct' && (tokens[pos] as { value: string }).value === ')')) {
					for (;;) {
						args.push(parseSequence(new Set([',', ')'])));
						const sep = tokens[pos];
						if (sep?.kind === 'punct' && sep.value === ',') {
							pos++;
							continue;
						}
						break;
					}
				}
				expect(')');
				items.push({ kind: 'call', name: t.value, args });
				continue;
			}
			items.push({ kind: 'token', token: t });
		}
		return items;
	}

	function expect(p: string): void {
		const t = tokens[pos];
		if (!(t?.kind === 'punct' && t.value === p)) {
			throw new X3QueryError(`Expected "${p}" in expression`);
		}
		pos++;
	}

	const out = parseSequence(new Set());
	if (pos < tokens.length) throw new X3QueryError('Unbalanced parentheses in expression');
	return out;
}

interface EmitContext {
	dialect: SqlDialect;
	/** Known tables by alias; a reference to an unknown alias is reported. */
	tables: Map<string, QueryTable>;
	/** Fields of the first index of each table, by alias: what ATEXTRA uses as IDENT1/IDENT2. */
	tableKeys: Map<string, string[]>;
	/** Aliases of the tables that carry a given field name, to resolve a bare `FIELD` reference. */
	fieldOwners: Map<string, string[]>;
	/** X3 data type per `ALIAS.FIELD`, when the ALT5 block was available. */
	fieldTypes: Record<string, string>;
	/** X3 user code for `GUSER` / `GACTX.USER`, when known. */
	user?: string;
	/** SQL name of the ATEXTRA table, schema prefix included. */
	atextra: string;
	language: string;
	warnings: string[];
}

/**
 * A translatable text (X3 data types AX1..AX9, AXX) has no column of its own:
 * its value sits in ATEXTRA, keyed by table, field, language and record key.
 */
function isTranslatableText(type: string | undefined): boolean {
	return /^AX[0-9X]?$/i.test(type ?? '');
}

/** The label of a local-menu value, as the X3 grid shows it (APLSTD, by language, menu and line). */
function localMenuLabelSql(
	codeSql: string,
	menu: number,
	aplstd: string,
	language: string,
	dialect: SqlDialect,
): string {
	const where = `LAN_0 = ${sqlString(language)} AND LANCHP_0 = ${menu} AND LANNUM_0 = ${codeSql}`;
	return dialect === 'oracle'
		? `NVL((SELECT LANMES_0 FROM ${aplstd} WHERE ${where} AND ROWNUM = 1), '')`
		: `ISNULL((SELECT TOP (1) LANMES_0 FROM ${aplstd} WHERE ${where}), '')`;
}

function translatedTextSql(table: QueryTable, field: string, ctx: EmitContext): string | undefined {
	const keys = ctx.tableKeys.get(table.alias) ?? [];
	if (keys.length === 0) return undefined;
	const ident1 = columnSql(table.alias, keys[0], 0);
	const ident2 = keys.length > 1 ? columnSql(table.alias, keys[1], 0) : "''";
	const where = `CODFIC_0 = ${sqlString(table.name)} AND ZONE_0 = ${sqlString(field)} AND LANGUE_0 = ${sqlString(ctx.language)} AND IDENT1_0 = ${ident1} AND IDENT2_0 = ${ident2}`;
	return ctx.dialect === 'oracle'
		? `NVL((SELECT TEXTE_0 FROM ${ctx.atextra} WHERE ${where} AND ROWNUM = 1), '')`
		: `ISNULL((SELECT TOP (1) TEXTE_0 FROM ${ctx.atextra} WHERE ${where}), '')`;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function columnSql(table: string, field: string, index: number): string {
	return `${table}.${field}_${index}`;
}

/** X3 stores "no date" as a sentinel that differs per database engine. */
function nullDate(dialect: SqlDialect): string {
	return dialect === 'oracle' ? "DATE '1599-12-31'" : "'1753-01-01'";
}

function dateLiteral(t: { day: number; month: number; year: number }, dialect: SqlDialect): string {
	if (t.day === 0 && t.month === 0 && t.year === 0) return nullDate(dialect);
	const year = t.year < 100 ? 2000 + t.year : t.year;
	const iso = `${String(year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
	return dialect === 'oracle' ? `DATE '${iso}'` : `'${iso}'`;
}

const X3_OPERATORS: Record<string, string> = {
	'&': 'AND',
	'|': 'OR',
	'!': 'NOT',
	'<>': '<>',
	'<=': '<=',
	'>=': '>=',
	'=': '=',
	'<': '<',
	'>': '>',
	'+': '+',
	'-': '-',
	'*': '*',
	'/': '/',
};

/**
 * A field written without its table, as X3 allows for the current file: the
 * query's own field catalogue says which table it belongs to.
 */
function resolveBareField(name: string, index: number, ctx: EmitContext): string | undefined {
	const owners = ctx.fieldOwners.get(name.toUpperCase());
	if (!owners || owners.length === 0) return undefined;
	if (owners.length > 1) {
		ctx.warnings.push(
			`"${name}" is a field of several tables of the query (${owners.join(', ')}); ${owners[0]} was assumed`,
		);
	}
	return columnSql(owners[0], name.toUpperCase(), index);
}

function emitIdent(name: string, ctx: EmitContext): string {
	const lower = name.toLowerCase();
	if (lower === 'and') return 'AND';
	if (lower === 'or') return 'OR';
	if (lower === 'not') return 'NOT';
	if (lower === 'date$' || lower === 'gdat')
		return ctx.dialect === 'oracle' ? 'TRUNC(SYSDATE)' : 'CAST(GETDATE() AS date)';
	if (lower === 'datetime$') return ctx.dialect === 'oracle' ? 'SYSDATE' : 'GETDATE()';
	if (lower === 'time$')
		return ctx.dialect === 'oracle'
			? "TO_CHAR(SYSDATE, 'HH24:MI:SS')"
			: 'CONVERT(varchar(8), GETDATE(), 108)';
	if (lower === 'gactx.lan' || lower === 'glangue' || lower === 'glan')
		return sqlString(ctx.language);
	if (lower === 'gactx.user' || lower === 'guser') {
		if (ctx.user) return sqlString(ctx.user);
		ctx.warnings.push(
			`"${name}" is the current X3 user; set the X3 User option to substitute it, otherwise replace it by hand`,
		);
		return name;
	}
	const bare = resolveBareField(name, 0, ctx);
	if (bare !== undefined) return bare;
	ctx.warnings.push(
		`"${name}" is an X3 variable or keyword with no SQL equivalent; it was left as-is and must be replaced by hand`,
	);
	return name;
}

function likePattern(value: string): string {
	// X3 `pat` wildcards: * any string, ? any single character, # any digit.
	return value
		.replace(/%/g, '[%]')
		.replace(/_/g, '[_]')
		.replace(/\*/g, '%')
		.replace(/\?/g, '_')
		.replace(/#/g, '[0-9]');
}

function emitCall(node: { name: string; args: Node[][] }, ctx: EmitContext): string {
	const name = node.name.toLowerCase();
	// `NYTBILL(2)` on the current file: a dimensioned field, not a function.
	if (node.args.length === 1 && node.args[0].length === 1) {
		const only = node.args[0][0];
		if (only.kind === 'token' && only.token.kind === 'num' && /^\d+$/.test(only.token.value)) {
			const bare = resolveBareField(node.name, Number(only.token.value), ctx);
			if (bare !== undefined) return bare;
		}
	}
	const a = node.args.map((arg) => emitSequence(arg, ctx));
	const oracle = ctx.dialect === 'oracle';
	const arity = (n: number): boolean => {
		if (a.length === n) return true;
		ctx.warnings.push(
			`X3 function ${node.name} expects ${n} argument(s) but ${a.length} were given`,
		);
		return false;
	};

	switch (name) {
		case 'left$':
			if (arity(2)) return oracle ? `SUBSTR(${a[0]}, 1, ${a[1]})` : `LEFT(${a[0]}, ${a[1]})`;
			break;
		case 'right$':
			if (arity(2)) return oracle ? `SUBSTR(${a[0]}, -${a[1]})` : `RIGHT(${a[0]}, ${a[1]})`;
			break;
		case 'mid$':
			if (arity(3))
				return oracle
					? `SUBSTR(${a[0]}, ${a[1]}, ${a[2]})`
					: `SUBSTRING(${a[0]}, ${a[1]}, ${a[2]})`;
			break;
		case 'len':
			if (arity(1)) return oracle ? `LENGTH(${a[0]})` : `LEN(${a[0]})`;
			break;
		case 'toupper':
			if (arity(1)) return `UPPER(${a[0]})`;
			break;
		case 'tolower':
			if (arity(1)) return `LOWER(${a[0]})`;
			break;
		case 'abs':
			if (arity(1)) return `ABS(${a[0]})`;
			break;
		case 'int':
			if (arity(1)) return `FLOOR(${a[0]})`;
			break;
		case 'arr':
			if (a.length === 1) return `ROUND(${a[0]}, 0)`;
			ctx.warnings.push(
				'arr(value, precision) rounds to a precision step in X3; check the generated ROUND',
			);
			return `ROUND(${a[0]}, ${a[1] ?? '0'})`;
		case 'num$':
			if (arity(1)) return oracle ? `TO_CHAR(${a[0]})` : `CAST(${a[0]} AS varchar(50))`;
			break;
		case 'val':
			if (arity(1)) return oracle ? `TO_NUMBER(${a[0]})` : `CAST(${a[0]} AS float)`;
			break;
		case 'year':
		case 'month':
		case 'day':
			if (arity(1))
				return oracle
					? `EXTRACT(${name.toUpperCase()} FROM ${a[0]})`
					: `${name.toUpperCase()}(${a[0]})`;
			break;
		case 'addmonth':
			if (arity(2))
				return oracle ? `ADD_MONTHS(${a[0]}, ${a[1]})` : `DATEADD(month, ${a[1]}, ${a[0]})`;
			break;
		case 'gdat$':
			if (arity(3)) {
				return oracle
					? `TO_DATE(${a[2]} || '-' || ${a[1]} || '-' || ${a[0]}, 'YYYY-MM-DD')`
					: `DATEFROMPARTS(${a[2]}, ${a[1]}, ${a[0]})`;
			}
			break;
		case 'string$':
			if (arity(2)) return `CASE WHEN ${a[0]} THEN ${a[1]} ELSE '' END`;
			break;
		case 'instr':
			if (arity(3))
				return oracle ? `INSTR(${a[1]}, ${a[2]}, ${a[0]})` : `CHARINDEX(${a[2]}, ${a[1]}, ${a[0]})`;
			break;
		case 'find':
			// find(value, v1, v2, ...) is the position of value in the list, 0 when
			// absent; in a condition that is exactly an IN (...).
			if (a.length >= 2) return `${a[0]} IN (${a.slice(1).join(', ')})`;
			ctx.warnings.push('find() needs a value and at least one candidate');
			break;
		case 'pat': {
			if (!arity(2)) break;
			const pattern = node.args[1];
			const single =
				pattern.length === 1 && pattern[0].kind === 'token' ? pattern[0].token : undefined;
			if (single?.kind === 'str') return `${a[0]} LIKE ${sqlString(likePattern(single.value))}`;
			ctx.warnings.push(
				'pat() with a non-literal pattern cannot be translated; the LIKE pattern must be adapted by hand',
			);
			return `${a[0]} LIKE ${a[1]}`;
		}
		case 'func':
			ctx.warnings.push(`A call to an X3 sub-program (func ${node.name}) has no SQL equivalent`);
			break;
		default:
			ctx.warnings.push(
				`X3 function ${node.name}() has no known SQL equivalent; it was left as-is`,
			);
	}
	return `${node.name}(${a.join(', ')})`;
}

// X3 functions whose result is a string: a `+` next to one of them is a concatenation.
const STRING_FUNCTIONS = new Set([
	'left$',
	'right$',
	'mid$',
	'num$',
	'toupper',
	'tolower',
	'string$',
	'ctrans',
	'format$',
]);

function isStringNode(node: Node | undefined): boolean {
	if (!node) return false;
	if (node.kind === 'token') return node.token.kind === 'str';
	if (node.kind === 'call') return STRING_FUNCTIONS.has(node.name.toLowerCase());
	return false;
}

const DATE_FUNCTIONS = new Set(['gdat$', 'addmonth']);

/** Whether a node yields a date: a date field, a date literal, today, or a date function. */
function isDateNode(node: Node | undefined, ctx: EmitContext): boolean {
	if (!node) return false;
	if (node.kind === 'call') return DATE_FUNCTIONS.has(node.name.toLowerCase());
	if (node.kind === 'group') return node.items.length === 1 && isDateNode(node.items[0], ctx);
	const t = node.token;
	if (t.kind === 'date') return true;
	if (t.kind === 'ident') return ['date$', 'gdat'].includes(t.value.toLowerCase());
	if (t.kind === 'ref')
		return (ctx.fieldTypes[`${t.table}.${t.field}`] ?? '').toUpperCase() === 'D';
	return false;
}

function emitSequence(nodes: Node[], ctx: EmitContext): string {
	const parts: string[] = [];
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index];
		index++;
		if (node.kind === 'group') {
			parts.push(`(${emitSequence(node.items, ctx)})`);
			continue;
		}
		if (node.kind === 'call') {
			parts.push(emitCall(node, ctx));
			continue;
		}
		const t = node.token;
		// X3 subtracts dates into a number of days and adds days to a date; SQL
		// Server needs DATEDIFF / DATEADD for that (Oracle does it natively).
		if (
			t.kind === 'op' &&
			(t.value === '-' || t.value === '+') &&
			ctx.dialect === 'mssql' &&
			parts.length > 0 &&
			index < nodes.length &&
			isDateNode(nodes[index - 2], ctx)
		) {
			const right = nodes[index];
			const left = parts.pop() as string;
			const rightSql = emitSequence([right], ctx);
			index++;
			if (t.value === '-' && isDateNode(right, ctx))
				parts.push(`DATEDIFF(day, ${rightSql}, ${left})`);
			else parts.push(`DATEADD(day, ${t.value === '-' ? `-(${rightSql})` : rightSql}, ${left})`);
			continue;
		}
		switch (t.kind) {
			case 'ref': {
				const table = ctx.tables.get(t.table);
				if (!table) {
					ctx.warnings.push(
						`Expression refers to table alias [${t.table}] which is not part of the query`,
					);
				}
				if (table && isTranslatableText(ctx.fieldTypes[`${t.table}.${t.field}`])) {
					const sql = translatedTextSql(table, t.field, ctx);
					if (sql !== undefined) {
						parts.push(sql);
						break;
					}
					ctx.warnings.push(
						`[${t.table}]${t.field} is a translatable text stored in ATEXTRA, but the key of ${table.name} is unknown; the plain column was used`,
					);
				}
				parts.push(columnSql(t.table, t.field, t.index));
				break;
			}
			case 'date':
				parts.push(dateLiteral(t, ctx.dialect));
				break;
			case 'str':
				parts.push(sqlString(t.value));
				break;
			case 'num':
				parts.push(t.value);
				break;
			case 'ident':
				parts.push(emitIdent(t.value, ctx));
				break;
			case 'op': {
				// X3 overloads `+` for strings; Oracle needs `||` there, SQL Server keeps `+`.
				if (
					t.value === '+' &&
					ctx.dialect === 'oracle' &&
					(isStringNode(nodes[index - 2]) || isStringNode(nodes[index]))
				) {
					parts.push('||');
					break;
				}
				const sql = X3_OPERATORS[t.value];
				if (sql === undefined) {
					ctx.warnings.push(
						`Operator "${t.value}" has no direct SQL equivalent and was left as-is`,
					);
					parts.push(t.value);
				} else parts.push(sql);
				break;
			}
			case 'punct':
				parts.push(t.value);
				break;
		}
	}
	return parts.join(' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')').replace(/\s,/g, ',');
}

/** Translate one X3 4GL expression into SQL. */
export function translateExpression(expr: string, ctx: EmitContext): string {
	const nodes = parse(tokenize(expr));
	// A formula column often starts with a unary plus (`=+1`); SQL does not need it.
	if (
		nodes.length > 1 &&
		nodes[0].kind === 'token' &&
		nodes[0].token.kind === 'op' &&
		nodes[0].token.value === '+'
	) {
		nodes.shift();
	}
	return emitSequence(nodes, ctx);
}

/** Same as translateExpression, but hands the failure back instead of throwing. */
function tryTranslate(expr: string, ctx: EmitContext): string | Error {
	try {
		return translateExpression(expr, ctx);
	} catch (e) {
		return e as Error;
	}
}

// ---------------------------------------------------------------------------
// Query model
// ---------------------------------------------------------------------------

function quoteName(dialect: SqlDialect, name: string): string {
	return dialect === 'oracle' ? `"${name.replace(/"/g, '""')}"` : `[${name.replace(/]/g, ']]')}]`;
}

function tableSql(dialect: SqlDialect, schema: string | undefined, name: string): string {
	const parts = (schema ?? '')
		.split('.')
		.map((p) => p.trim())
		.filter((p) => p !== '');
	parts.push(name);
	return dialect === 'oracle'
		? parts.map((p) => p.toUpperCase()).join('.')
		: parts.map((p) => `[${p}]`).join('.');
}

function parseTables(
	xml: string,
	opts: InterpretOptions,
): {
	tables: QueryTable[];
	keys: Map<string, string[]>;
	indexes: Map<string, Map<string, string[]>>;
	fieldOwners: Map<string, string[]>;
} {
	const keys = new Map<string, string[]>();
	const indexesByAlias = new Map<string, Map<string, string[]>>();
	const fieldOwners = new Map<string, string[]>();
	const tables = elements(section(xml, 'Tables'), 'Table').map(({ attrs, inner }) => {
		const table: QueryTable = {
			alias: attrs.Id ?? '',
			name: attrs.Name ?? '',
			label: attrs.Lbl ?? '',
			sql: tableSql(opts.dialect, opts.schema, attrs.Name ?? ''),
		};
		const indexes = elements(section(inner, 'Indexes'), 'Field').map(({ attrs: f }) => ({
			name: f.Id ?? '',
			fields: (f.Def ?? '').split(';').filter((s) => s !== ''),
		}));
		// The first index is the primary key: what ATEXTRA stores as IDENT1/IDENT2.
		if (indexes.length > 0) keys.set(table.alias, indexes[0].fields);
		indexesByAlias.set(table.alias, new Map(indexes.map((i) => [i.name.toUpperCase(), i.fields])));
		const fields = elements(section(inner, 'Fields'), 'Field').map(({ attrs: f }) => ({
			name: f.Id ?? '',
			label: f.Lbl ?? '',
		}));
		for (const f of fields) {
			// `BPCNAM(1)` is a slot of the field BPCNAM: owners are tracked per field name.
			const name = f.name.replace(/\(\d+\)$/, '').toUpperCase();
			const owners = fieldOwners.get(name) ?? [];
			if (!owners.includes(table.alias)) owners.push(table.alias);
			fieldOwners.set(name, owners);
		}
		if (opts.includeTableFields) {
			table.fields = fields;
			table.indexes = indexes;
		}
		return table;
	});
	return { tables, keys, indexes: indexesByAlias, fieldOwners };
}

/** A graphical link between two tables: `Sid` and `Tid` of a `<Link>`. */
interface RawLink {
	from: { alias: string; field: string };
	to: { alias: string; field: string };
	type: 'inner' | 'left' | 'right';
}

/**
 * A link expression of the "Links" tab: table `target` is read through one of
 * its indexes, each key field matched to an expression over the other tables.
 */
interface ExprLink {
	target: string;
	requires: string[];
	conditions: string[];
	on: QueryJoin['on'];
}

function parseRef(ref: string): { alias: string; field: string; index: number } | undefined {
	const m = ref.trim().match(REF_RE);
	if (!m || m[0].length !== ref.trim().length) return undefined;
	return { alias: m[1], field: m[2], index: m[3] ? Number(m[3]) : 0 };
}

function parseLinks(xml: string, warnings: string[]): RawLink[] {
	const links: RawLink[] = [];
	for (const { attrs } of elements(section(xml, 'Links'), 'Link')) {
		const from = parseRef(attrs.Sid ?? '');
		const to = parseRef(attrs.Tid ?? '');
		if (!from || !to) {
			warnings.push(`Link ${attrs.Id ?? ''} could not be read (${attrs.Sid} → ${attrs.Tid})`);
			continue;
		}
		const join = (attrs.Join ?? 'I').toUpperCase();
		const type: RawLink['type'] = join === 'L' ? 'left' : join === 'R' ? 'right' : 'inner';
		links.push({
			from: { alias: from.alias, field: `${from.field}_${from.index}` },
			to: { alias: to.alias, field: `${to.field}_${to.index}` },
			type,
		});
	}
	return links;
}

/**
 * `[F:ADI]CODE = 20 ; [F:ITM]TSICOD` → ADI joined on index CODE (NUMTAB;CODE):
 * `ADI.NUMTAB_0 = 20 AND ADI.CODE_0 = ITM.TSICOD_0`.
 */
function parseExprLinks(
	lnk: string[],
	indexes: Map<string, Map<string, string[]>>,
	ctx: EmitContext,
): ExprLink[] {
	const links: ExprLink[] = [];
	for (const raw of lnk) {
		const text = raw.trim();
		if (text === '') continue;
		const m = text.match(
			/^\[(?:[A-Za-z]:)?([A-Za-z][A-Za-z0-9_]*)\]\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/,
		);
		if (!m) {
			ctx.warnings.push(
				`Link expression "${text}" is not of the form [F:TABLE]INDEX = expr ; expr`,
			);
			continue;
		}
		const [, target, indexName, rest] = m;
		const keyFields = indexes.get(target)?.get(indexName.toUpperCase());
		if (!keyFields) {
			ctx.warnings.push(
				`Link expression "${text}" names index ${indexName} which table ${target} does not have`,
			);
			continue;
		}
		const exprs = rest
			.split(';')
			.map((e) => e.trim())
			.filter((e) => e !== '');
		const count = Math.min(exprs.length, keyFields.length);
		if (exprs.length > keyFields.length) {
			ctx.warnings.push(
				`Link expression "${text}" gives more values than index ${indexName} has fields`,
			);
		}
		const requires = new Set<string>();
		const conditions: string[] = [];
		const on: QueryJoin['on'] = [];
		let failed = false;
		for (let i = 0; i < count; i++) {
			const sql = tryTranslate(exprs[i], ctx);
			if (sql instanceof Error) {
				ctx.warnings.push(`Link expression "${text}": ${sql.message}`);
				failed = true;
				break;
			}
			for (const t of tokenize(exprs[i])) if (t.kind === 'ref') requires.add(t.table);
			const field = `${keyFields[i]}_0`;
			conditions.push(`${target}.${field} = ${sql}`);
			on.push({ from: { alias: target, field }, to: { alias: '', field: sql } });
		}
		if (failed || conditions.length === 0) continue;
		requires.delete(target);
		links.push({ target, requires: Array.from(requires), conditions, on });
	}
	return links;
}

/**
 * Order the tables as a chain of JOINs. The root is the table that is only ever
 * the source of a link (the main table of the query); the others follow as
 * they become reachable: graphical links first, each pair of tables merging all
 * its links into one ON, then link expressions once the tables they read from
 * are in place.
 */
function buildJoins(
	tables: QueryTable[],
	links: RawLink[],
	exprLinks: ExprLink[],
	warnings: string[],
): { fromOrder: QueryTable[]; joins: QueryJoin[] } {
	if (tables.length === 0) throw new X3QueryError('The query XML declares no table');
	const byAlias = new Map(tables.map((t) => [t.alias, t]));
	const targets = new Set([...links.map((l) => l.to.alias), ...exprLinks.map((l) => l.target)]);
	const sources = new Set([
		...links.map((l) => l.from.alias),
		...exprLinks.flatMap((l) => l.requires),
	]);
	const root =
		tables.find((t) => sources.has(t.alias) && !targets.has(t.alias)) ??
		tables.find((t) => sources.has(t.alias)) ??
		tables[0];

	const visited = new Set<string>([root.alias]);
	const fromOrder: QueryTable[] = [root];
	const joins: QueryJoin[] = [];
	const remaining = [...links];
	const remainingExpr = [...exprLinks];

	const attach = (
		table: QueryTable,
		type: QueryJoin['type'],
		on: QueryJoin['on'],
		conditions: string[],
	): void => {
		const keyword = type === 'left' ? 'LEFT JOIN' : type === 'right' ? 'RIGHT JOIN' : 'INNER JOIN';
		joins.push({
			table: table.alias,
			type,
			on,
			sql: `${keyword} ${table.sql} ${table.alias} ON ${conditions.join(' AND ')}`,
		});
		visited.add(table.alias);
		fromOrder.push(table);
	};

	for (;;) {
		const next = remaining.find(
			(l) =>
				visited.has(l.from.alias) !== visited.has(l.to.alias) &&
				byAlias.has(l.from.alias) &&
				byAlias.has(l.to.alias),
		);
		if (next) {
			const reversed = visited.has(next.to.alias);
			const newAlias = reversed ? next.from.alias : next.to.alias;
			const pairLinks = remaining.filter(
				(l) =>
					(l.from.alias === next.from.alias && l.to.alias === next.to.alias) ||
					(l.from.alias === next.to.alias && l.to.alias === next.from.alias),
			);
			for (const l of pairLinks) remaining.splice(remaining.indexOf(l), 1);

			let type: QueryJoin['type'] = next.type;
			if (reversed && type !== 'inner') {
				type = type === 'left' ? 'right' : 'left';
			}
			if (pairLinks.some((l) => l.type !== next.type)) {
				warnings.push(
					`Links between ${next.from.alias} and ${next.to.alias} use different join types; "${type}" was kept`,
				);
			}
			attach(
				byAlias.get(newAlias) as QueryTable,
				type,
				pairLinks.map((l) => ({ from: l.from, to: l.to })),
				pairLinks.map((l) => `${l.from.alias}.${l.from.field} = ${l.to.alias}.${l.to.field}`),
			);
			continue;
		}
		const nextExpr = remainingExpr.find(
			(l) =>
				!visited.has(l.target) && byAlias.has(l.target) && l.requires.every((a) => visited.has(a)),
		);
		if (!nextExpr) break;
		remainingExpr.splice(remainingExpr.indexOf(nextExpr), 1);
		// A link expression reads the target by key, like a lookup: rows without a
		// match keep their line with empty values, hence the LEFT JOIN.
		attach(byAlias.get(nextExpr.target) as QueryTable, 'left', nextExpr.on, nextExpr.conditions);
	}

	for (const l of remaining) {
		if (!byAlias.has(l.from.alias) || !byAlias.has(l.to.alias)) {
			warnings.push(
				`Link ${l.from.alias}.${l.from.field} → ${l.to.alias}.${l.to.field} refers to a table that is not in the query`,
			);
		}
	}
	for (const l of remainingExpr) {
		if (!visited.has(l.target)) {
			warnings.push(
				`Link expression for ${l.target} depends on ${l.requires.join(', ')} which could not be joined first`,
			);
		}
	}
	for (const t of tables) {
		if (visited.has(t.alias)) continue;
		warnings.push(
			`Table ${t.alias} (${t.name}) is not linked to the others; it was added as a CROSS JOIN`,
		);
		joins.push({ table: t.alias, type: 'cross', on: [], sql: `CROSS JOIN ${t.sql} ${t.alias}` });
		visited.add(t.alias);
		fromOrder.push(t);
	}
	return { fromOrder, joins };
}

interface RawColumn {
	expression: string;
	label: string;
	visible: boolean;
	bounds: boolean;
	sum: boolean;
	sort?: 'asc' | 'desc';
	level: number;
}

function parseDroppedFields(xml: string): RawColumn[] {
	return elements(section(xml, 'DroppedFields'), 'DroppedField').map(({ attrs }) => {
		const sortFlag = (attrs.Sort ?? 'N').toUpperCase();
		return {
			expression: attrs.Expr ?? '',
			label: attrs.Lbl ?? '',
			visible: (attrs.Vis ?? 'Y').toUpperCase() !== 'N',
			bounds: (attrs.Bounds ?? 'N').toUpperCase() === 'Y',
			sum: (attrs.Sum ?? 'N').toUpperCase() === 'Y',
			sort: sortFlag === 'A' ? 'asc' : sortFlag === 'D' ? 'desc' : undefined,
			level: Number(attrs.Level ?? '1') || 1,
		};
	});
}

/** Map an X3 data type code (CODTYP) to the parameter types of the SQL Select operation. */
function parameterType(codtyp: string | undefined): QueryParameter['type'] {
	const t = (codtyp ?? '').toUpperCase();
	if (t === 'D' || t === 'ADATIM') return 'date';
	if (/^(C|L|M|DCB|QTY|MD\d?|PRI|DEC|AC\d?|PCT|CO\d?|CU\d?)$/.test(t)) return 'number';
	return 'text';
}

function uniqueAlias(base: string, used: Set<string>): string {
	let alias = base;
	let n = 2;
	while (used.has(alias)) alias = `${base} (${n++})`;
	used.add(alias);
	return alias;
}

/**
 * Interpret a Sage X3 graphical query and render it as SQL.
 */
export function interpretX3Query(source: X3QuerySource, opts: InterpretOptions): InterpretedQuery {
	const warnings: string[] = [];
	const xml = source.clbfl;
	if (!xml || !/<X3PORTAL\b/i.test(xml)) {
		throw new X3QueryError(
			'The query definition is not an X3PORTAL document (expected the CLBFL field of an ALT object)',
		);
	}

	const { tables, keys: tableKeys, indexes, fieldOwners } = parseTables(xml, opts);
	const tablesByAlias = new Map(tables.map((t) => [t.alias, t]));
	const ctx: EmitContext = {
		dialect: opts.dialect,
		tables: tablesByAlias,
		tableKeys,
		fieldOwners,
		fieldTypes: source.fieldTypes ?? {},
		atextra: tableSql(opts.dialect, opts.schema, 'ATEXTRA'),
		language: (opts.language ?? 'FRA').trim().toUpperCase() || 'FRA',
		warnings,
	};
	const user = (opts.user ?? '').trim();
	if (user) ctx.user = user;
	const aplstd = tableSql(opts.dialect, opts.schema, 'APLSTD');
	const localMenus = opts.localMenus ?? 'code';
	const { fromOrder, joins } = buildJoins(
		tables,
		parseLinks(xml, warnings),
		parseExprLinks(source.lnk ?? [], indexes, ctx),
		warnings,
	);

	// Columns ---------------------------------------------------------------
	const rawColumns = parseDroppedFields(xml);
	const usedAliases = new Set<string>();
	const columns: QueryColumn[] = [];
	const parameters: QueryParameter[] = [];
	const whereParams: string[] = [];
	const usedParamNames = new Set<string>();

	rawColumns.forEach((raw, position) => {
		const isFormula = raw.expression.startsWith('=');
		const x3Expr = isFormula ? raw.expression.slice(1) : raw.expression;
		let sql = tryTranslate(x3Expr, ctx);
		if (sql instanceof Error) {
			warnings.push(`Column ${position + 1} (${raw.label}): ${sql.message}`);
			sql = `NULL /* ${raw.expression} */`;
		}
		const ref = isFormula ? undefined : parseRef(raw.expression);
		const code = ref
			? `${ref.alias}_${ref.field}${ref.index ? `_${ref.index}` : ''}`
			: `EXPR_${position + 1}`;
		const type = source.columnTypes?.[position];

		let alias: string | undefined;
		if (opts.columnAliases === 'label') alias = uniqueAlias(raw.label || code, usedAliases);
		else if (opts.columnAliases === 'code') alias = uniqueAlias(code, usedAliases);

		const column: QueryColumn = {
			position: position + 1,
			label: raw.label,
			expression: raw.expression,
			sql,
			visible: raw.visible,
			level: raw.level,
			sum: raw.sum,
			bounds: raw.bounds,
		};
		if (alias !== undefined) column.alias = alias;
		if (raw.sort) column.sort = raw.sort;
		if (type) column.type = type;
		// A local-menu column: the grid shows the label, the table holds the number.
		if (ref) {
			const key = `${ref.alias}.${ref.field}`;
			const menu = source.fieldMenus?.[key];
			if (
				(source.fieldTypes?.[key] ?? '').toUpperCase() === 'M' &&
				menu !== undefined &&
				menu > 0
			) {
				column.menu = menu;
				column.labelSql = localMenuLabelSql(sql, menu, aplstd, ctx.language, opts.dialect);
			}
		}
		columns.push(column);

		if (opts.boundsAsParameters && raw.bounds && ref) {
			const base = code.replace(/[^A-Za-z0-9_]/g, '_');
			for (const bound of ['from', 'to'] as const) {
				let name = `${base}_${bound}`;
				let n = 2;
				while (usedParamNames.has(name)) name = `${base}_${bound}_${n++}`;
				usedParamNames.add(name);
				parameters.push({ name, type: parameterType(type), column: sql, label: raw.label, bound });
				whereParams.push(`[[AND ${sql} ${bound === 'from' ? '>=' : '<='} {{${name}}}]]`);
			}
		}
	});

	// Criteria ----------------------------------------------------------------
	const criteria: QueryCriterion[] = [];
	for (const x3 of source.sel) {
		const text = x3.trim();
		if (text === '') continue;
		const sql = tryTranslate(text, ctx);
		if (sql instanceof Error) {
			throw new X3QueryError(`Selection criterion "${text}": ${sql.message}`);
		}
		criteria.push({ x3: text, sql });
	}

	// SQL ---------------------------------------------------------------------
	const selected = columns.filter((c) => c.visible || opts.includeHidden);

	// Order by ----------------------------------------------------------------
	// The grid sorts by break level first, then by the column order within a
	// level. A selected, aliased column is sorted by its alias, so a heavy
	// expression (an ATEXTRA lookup) is not written twice. A local menu shown
	// as a label still sorts by its number, as the grid does.
	const orderBy = columns
		.map((c, i) => ({ c, i }))
		.filter(({ c }) => c.sort !== undefined)
		.sort((a, b) => a.c.level - b.c.level || a.i - b.i)
		.map(({ c }) => ({
			sql:
				c.alias !== undefined && selected.includes(c) && !(c.labelSql && localMenus === 'label')
					? quoteName(opts.dialect, c.alias)
					: c.sql,
			direction: c.sort as 'asc' | 'desc',
		}));
	if (selected.length === 0)
		warnings.push('The query has no visible column; SELECT * was generated');
	const selectItem = (sql: string, alias: string | undefined): string =>
		alias !== undefined ? `${sql} AS ${quoteName(opts.dialect, alias)}` : sql;
	const selectList: string[] = [];
	for (const c of selected) {
		if (c.labelSql && localMenus === 'label') {
			selectList.push(selectItem(c.labelSql, c.alias));
		} else if (c.labelSql && localMenus === 'both') {
			selectList.push(selectItem(c.sql, c.alias !== undefined ? `${c.alias} (code)` : undefined));
			selectList.push(selectItem(c.labelSql, c.alias));
		} else {
			selectList.push(selectItem(c.sql, c.alias));
		}
	}
	if (selectList.length === 0) selectList.push('*');

	const maxLines = opts.maxLines !== undefined ? opts.maxLines : source.maxLines;
	const top = maxLines && maxLines > 0 ? maxLines : undefined;

	const lines: string[] = [];
	lines.push(`SELECT${top !== undefined && opts.dialect === 'mssql' ? ` TOP (${top})` : ''}`);
	lines.push(`  ${selectList.join(',\n  ')}`);
	lines.push(`FROM ${fromOrder[0].sql} ${fromOrder[0].alias}`);
	for (const j of joins) if (j.sql) lines.push(`  ${j.sql}`);
	const whereParts = criteria.map((c) => (criteria.length > 1 ? `(${c.sql})` : c.sql));
	if (whereParts.length > 0 || whereParams.length > 0) {
		lines.push(`WHERE ${whereParts.length > 0 ? whereParts.join('\n  AND ') : '1=1'}`);
		for (const p of whereParams) lines.push(`  ${p}`);
	}
	if (orderBy.length > 0) {
		lines.push(
			`ORDER BY ${orderBy.map((o) => `${o.sql} ${o.direction.toUpperCase()}`).join(', ')}`,
		);
	}
	if (top !== undefined && opts.dialect === 'oracle') lines.push(`FETCH FIRST ${top} ROWS ONLY`);

	const result: InterpretedQuery = {
		tables,
		joins,
		columns,
		criteria,
		orderBy,
		parameters,
		sql: lines.join('\n'),
		warnings: Array.from(new Set(warnings)),
	};
	if (source.code) result.code = source.code;
	if (source.title) result.title = source.title;
	if (source.module !== undefined) result.module = source.module;
	if (source.objectLink) result.objectLink = source.objectLink;
	if (source.functionLink) result.functionLink = source.functionLink;
	if (top !== undefined) result.maxLines = top;
	return result;
}

// ---------------------------------------------------------------------------
// Locating the query inside a Read ALT output
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function firstString(v: unknown): string | undefined {
	if (typeof v === 'string') return v;
	if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
	return undefined;
}

function firstNumber(v: unknown): number | undefined {
	const raw = Array.isArray(v) ? v[0] : v;
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function stringList(v: unknown): string[] {
	if (typeof v === 'string') return [v];
	if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
	return [];
}

/**
 * Find the ALT blocks in an item: the node accepts the full output of a Read
 * (`{ data: { ALT0, ALT1, ... } }`), the bare data object, or an object that
 * directly carries a CLBFL string.
 */
export function extractQuerySource(json: unknown): X3QuerySource | undefined {
	if (!isRecord(json)) return undefined;
	const candidates: AnyRecord[] = [json];
	if (isRecord(json.data)) candidates.unshift(json.data);

	for (const obj of candidates) {
		const alt1 = isRecord(obj.ALT1) ? obj.ALT1 : undefined;
		const clbfl = firstString(alt1?.CLBFL) ?? firstString(obj.CLBFL);
		if (!clbfl) continue;
		const alt0 = isRecord(obj.ALT0) ? obj.ALT0 : {};
		const alt2 = isRecord(obj.ALT2) ? obj.ALT2 : {};
		const alt3 = isRecord(obj.ALT3) ? obj.ALT3 : {};
		const alt5 = isRecord(obj.ALT5) ? obj.ALT5 : undefined;

		const source: X3QuerySource = {
			clbfl,
			sel: stringList(alt2.SEL ?? obj.SEL),
			lnk: stringList(alt2.LNK ?? obj.LNK),
		};
		const code = firstString(alt0.COD) ?? firstString(json.ident);
		if (code) source.code = code;
		const title = firstString(alt0.INTIT);
		if (title) source.title = title;
		const module = firstNumber(alt0.MODULE);
		if (module !== undefined) source.module = module;
		const maxLines = firstNumber(alt2.MAXLIG);
		if (maxLines !== undefined && maxLines > 0) source.maxLines = maxLines;
		const objectLink = firstString(alt3.OBJLNK);
		if (objectLink) source.objectLink = objectLink;
		const functionLink = firstString(alt3.FCTLNK);
		if (functionLink) source.functionLink = functionLink;

		// The ALT5 grid: TYPLIG=2 rows are the table fields with their data type,
		// TYPLIG=4 rows the dropped columns, in display order.
		if (alt5 && Array.isArray(alt5.TYPLIG)) {
			const typlig = alt5.TYPLIG as unknown[];
			const codtyp = Array.isArray(alt5.CODTYP) ? (alt5.CODTYP as unknown[]) : [];
			const champ = Array.isArray(alt5.CHAMP) ? (alt5.CHAMP as unknown[]) : [];
			const nolib = Array.isArray(alt5.NOLIB) ? (alt5.NOLIB as unknown[]) : [];
			const types: string[] = [];
			const fieldTypes: Record<string, string> = {};
			const fieldMenus: Record<string, number> = {};
			typlig.forEach((t, i) => {
				const type = typeof codtyp[i] === 'string' ? (codtyp[i] as string) : '';
				if (Number(t) === 4) types.push(type);
				if (Number(t) === 2 && typeof champ[i] === 'string') {
					const ref = parseRef(champ[i] as string);
					if (ref && type) {
						const key = `${ref.alias}.${ref.field}`;
						fieldTypes[key] = type;
						const menu = Number(nolib[i]);
						if (type.toUpperCase() === 'M' && Number.isFinite(menu) && menu > 0)
							fieldMenus[key] = menu;
					}
				}
			});
			if (types.length > 0) source.columnTypes = types;
			if (Object.keys(fieldTypes).length > 0) source.fieldTypes = fieldTypes;
			if (Object.keys(fieldMenus).length > 0) source.fieldMenus = fieldMenus;
		}
		return source;
	}
	return undefined;
}
