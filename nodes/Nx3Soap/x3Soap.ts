/**
 * Everything the IntellX nodes share to talk to Sage X3: SOAP envelope construction,
 * response parsing, SQL parameter substitution and output shaping. Kept apart from
 * the node definitions so that every node drives X3 through the exact same code.
 */
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';
// Path appended to the credential base URL to reach the SOAP endpoint.
export const SOAP_PATH = '/soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC';

// Default X3 sub-program implementing the JSON-driven object API (patch ChatX3).
export const DEFAULT_PUBLIC_NAME = 'XCHATX3OBJ';

export type Operation =
	| 'read'
	| 'list'
	| 'create'
	| 'modify'
	| 'describe'
	| 'custom'
	| 'sqlAnalyse'
	| 'sqlSelect'
	| 'runQuery'
	| 'runRaw';

// Built-in XACTION values. `custom` reads the value from a free-text field at runtime,
// `runRaw` builds its own input payload and `runQuery` chains a READ and a SELECT,
// so none of them appear in the map.
export const ACTION_MAP: Record<Exclude<Operation, 'runRaw' | 'custom' | 'runQuery'>, string> = {
	read: 'READ',
	list: 'LIST',
	create: 'CREATE',
	modify: 'MODIFY',
	describe: 'DESC',
	sqlAnalyse: 'ANALYSE',
	sqlSelect: 'SELECT',
};

// Operations that act on a Sage X3 object (the shared XOBJECT/XTRANSACTION fields apply).
// SQL ops hardcode XOBJECT='SQL' and build their own payload, so they are NOT in this set.
export const X3_OBJECT_OPS: string[] = ['read', 'list', 'create', 'modify', 'describe', 'custom'];
// SQL ops that run a query through XCHATX3OBJ with XOBJECT='SQL'.
export const SQL_OPS: string[] = ['sqlAnalyse', 'sqlSelect'];
// Subset whose XDATAJSON payload carries object data (the user's `data` field is read).
// Read and Describe send no object data — only the optional `context` envelope, if any.
export const X3_OPS_WITH_DATA: string[] = ['list', 'create', 'modify', 'custom'];

// One Action Code field per built-in operation, each pre-filled with the matching XACTION.
// The Operation dropdown thus seeds the field with the right default (acting as a shortcut),
// while the user can still edit the value to send a different action.
export const ACTION_CODE_PRESET_FIELDS: INodeProperties[] = (
	Object.entries(ACTION_MAP) as Array<[keyof typeof ACTION_MAP, string]>
).map(([op, xaction]) => ({
	displayName: 'Action Code',
	name: 'actionCode',
	type: 'string',
	default: xaction,
	placeholder: xaction,
	description:
		'XACTION sent to the sub-program. Pre-filled from the Operation above; edit to send a different action.',
	displayOptions: { show: { operation: [op] } },
}));

// Custom Action has no preset, so the field is required and starts empty.
export const ACTION_CODE_CUSTOM_FIELD: INodeProperties = {
	displayName: 'Action Code',
	name: 'actionCode',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'LIST',
	description:
		'XACTION sent to the sub-program. Required for Custom Action (no preset to fall back on). Will be upper-cased.',
	displayOptions: { show: { operation: ['custom'] } },
};

export interface CallContext {
	codeLang: string;
	poolAlias: string;
	poolId: string;
	requestConfig: string;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/**
 * Escape for XML element content (text between tags). Only &, <, > are mandatory.
 * Leaving " and ' as literals matches what SoapUI sends and what X3 / XCHATX3OBJ expects,
 * since some X3 parsers don't decode &quot; / &apos; reliably inside FLD values.
 */
function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlUnescape(s: string): string {
	return (
		s
			// Numeric character references (hex and decimal) — X3 emits these for whitespace
			// in echoed payloads, e.g. &#x0a; for newline, &#x09; for tab.
			.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
				const code = parseInt(h, 16);
				return Number.isFinite(code) ? String.fromCodePoint(code) : '';
			})
			.replace(/&#(\d+);/g, (_, d) => {
				const code = parseInt(d, 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : '';
			})
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			// &amp; must come last so e.g. "&amp;lt;" decodes to "<" not "&lt;"
			.replace(/&amp;/g, '&')
	);
}

function wrapCdata(s: string): string {
	// Defensive: if the payload itself contains ']]>', split it to keep CDATA valid.
	const safe = s.split(']]>').join(']]]]><![CDATA[>');
	return `<![CDATA[${safe}]]>`;
}

function readTextContent(s: string): string {
	const cdataMatch = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
	if (cdataMatch) return cdataMatch[1];
	return xmlUnescape(s.trim());
}

/**
 * Capture the inner content of the first element with a given local name (namespace-agnostic).
 */
function pickElement(xml: string, localName: string): string | undefined {
	const safeName = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(
		`<(?:[\\w.-]+:)?${safeName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${safeName}>`,
		'i',
	);
	const m = xml.match(re);
	return m ? m[1] : undefined;
}

/**
 * Build a lookup of all <multiRef id="...">...</multiRef> blocks in the envelope.
 * SOAP RPC/encoded responses (used by older Apache Axis backends like Sage X3)
 * defer object content to multiRef blocks referenced by href="#id" from elsewhere.
 */
function extractMultiRefs(xml: string): Map<string, string> {
	const refs = new Map<string, string>();
	const re =
		/<(?:[\w.-]+:)?multiRef\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?multiRef>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		refs.set(m[1], m[2]);
	}
	return refs;
}

/**
 * Map X3 numeric message types to a readable label. Best-effort, X3 type codes vary;
 * the original numeric value is preserved alongside as `typeCode`.
 */
function labelForType(code: string | undefined): string {
	switch ((code ?? '').trim()) {
		case '1':
			return 'info';
		case '2':
			return 'warning';
		case '3':
			return 'error';
		case '4':
			return 'error';
		default:
			return code ?? '';
	}
}

/**
 * Extract messages from the SOAP-level <messages> container.
 * Supports both inline content and SOAP multi-ref encoding (href="#idN").
 * Returns [] if absent.
 */
function pickSoapMessages(xml: string, multiRefs: Map<string, string>): IDataObject[] {
	const container = pickElement(xml, 'messages');
	if (!container) return [];
	const out: IDataObject[] = [];

	// Walk over every direct child of the messages container so we can interleave
	// inline entries and href references in the order they appear.
	const childRe = /<(?:[\w.-]+:)?(messages|item)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1>)/gi;
	let m: RegExpExecArray | null;
	while ((m = childRe.exec(container)) !== null) {
		const attrs = m[2] ?? '';
		const inline = m[3];

		let inner: string | undefined;
		const hrefMatch = attrs.match(/\bhref="#([^"]+)"/);
		if (hrefMatch) {
			inner = multiRefs.get(hrefMatch[1]);
		} else if (inline !== undefined) {
			inner = inline;
		}
		if (inner === undefined) continue;

		const message = pickElement(inner, 'message');
		const type = pickElement(inner, 'type');
		const typeRaw = type !== undefined ? readTextContent(type) : '';
		out.push({
			message: message !== undefined ? readTextContent(message) : '',
			type: labelForType(typeRaw),
			typeCode: typeRaw,
		});
	}
	return out;
}

/**
 * Find the inner text of the FLD with NAME=<fieldName> inside a resultXml string.
 */
function pickResultField(resultXml: string, fieldName: string): string | undefined {
	if (!resultXml) return undefined;
	const safeName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`<FLD\\b[^>]*\\bNAME="${safeName}"[^>]*>([\\s\\S]*?)<\\/FLD>`, 'i');
	const m = resultXml.match(re);
	if (!m) return undefined;
	return readTextContent(m[1]);
}

/**
 * Try to parse a string as JSON, falling back to the raw string if it isn't valid JSON.
 */
export function tryParseJson(s: string | undefined): unknown {
	if (s === undefined || s === '') return undefined;
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

/**
 * Recursively parse any string value that is itself a JSON object/array. X3 nests JSON
 * inside Clob string fields (e.g. XDATAJSON), so this turns the debug "request" object
 * into a fully navigable tree instead of a wall of escaped quotes.
 */
export function deepParseJsonStrings(value: unknown): unknown {
	if (typeof value === 'string') {
		const t = value.trim();
		if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
			try {
				return deepParseJsonStrings(JSON.parse(t));
			} catch {
				return value;
			}
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(deepParseJsonStrings);
	if (value !== null && typeof value === 'object') {
		const out: IDataObject = {};
		for (const [k, v] of Object.entries(value as IDataObject)) {
			out[k] = deepParseJsonStrings(v) as IDataObject[keyof IDataObject];
		}
		return out;
	}
	return value;
}

/**
 * Shape the resultXml for the debug output: if X3 returned JSON, expose it as a navigable
 * object with nested Clob JSON fields parsed; if it returned XML, keep the raw string.
 */
export function debugResult(resultXml: string): unknown {
	const t = resultXml.trim();
	if (t.startsWith('{') || t.startsWith('[')) {
		const parsed = tryParseJson(t);
		if (parsed && typeof parsed === 'object') return deepParseJsonStrings(parsed);
	}
	return resultXml;
}

/**
 * Translate low-level network errors (timeout, refused, DNS, etc.) into one-sentence
 * actionable messages. Important for AI Agent tool calls: a clear message lets the
 * LLM decide whether to retry, ask the user, or surface the failure.
 */
export function describeNetworkError(err: Error & { code?: string }): string | undefined {
	const code = err.code ?? '';
	const msg = err.message ?? '';
	if (code === 'ECONNABORTED' || /timeout/i.test(msg)) {
		return 'Sage X3 did not respond before the request timed out — check that the X3 server is reachable, or raise the Request Timeout option in Advanced Options';
	}
	if (code === 'ECONNREFUSED') {
		return 'Connection refused by the Sage X3 server — the host is up but no service is listening on that port. Check the credential Base URL';
	}
	if (code === 'ENOTFOUND') {
		return 'Cannot resolve the Sage X3 host — DNS/host name not found. Check the credential Base URL';
	}
	if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
		return 'Network unreachable — cannot route to the Sage X3 server. Check VPN/network connectivity';
	}
	if (code === 'ECONNRESET') {
		return 'Connection reset by the Sage X3 server during the request';
	}
	return undefined;
}

/**
 * Pull an HTTP status out of whatever error shape the request helper threw.
 * Different layers surface it differently, and the raw message is the last
 * resort ("Request failed with status code 405").
 */
export function extractHttpStatus(err: unknown): number | undefined {
	const e = err as {
		statusCode?: unknown;
		httpCode?: unknown;
		status?: unknown;
		response?: { status?: unknown; statusCode?: unknown };
		message?: unknown;
	};
	const candidates = [
		e?.statusCode,
		e?.httpCode,
		e?.status,
		e?.response?.status,
		e?.response?.statusCode,
	];
	for (const c of candidates) {
		const n = typeof c === 'string' ? Number(c) : c;
		if (typeof n === 'number' && Number.isFinite(n) && n >= 100 && n <= 599) return n;
	}
	const m = typeof e?.message === 'string' ? /status code (\d{3})/i.exec(e.message) : null;
	return m ? Number(m[1]) : undefined;
}

/**
 * Turn an HTTP status into an actionable sentence naming the URL that was called.
 * A bare "Request failed with status code 405" points the reader at the node,
 * when the cause is almost always the credential Base URL.
 */
export function describeHttpError(status: number, url: string): string | undefined {
	if (status === 401) {
		return `Sage X3 rejected the credentials (HTTP 401) at ${url} — check the Syracuse username and password`;
	}
	if (status === 403) {
		return `Sage X3 refused access to the SOAP service (HTTP 403) at ${url} — the Syracuse user is not allowed to call the web service`;
	}
	if (status === 404) {
		return `No SOAP service found at ${url} (HTTP 404) — check the host and port in the credential Base URL. The SOAP path is appended automatically, so Base URL must not contain it`;
	}
	if (status === 405) {
		return `${url} answered 405 Method Not Allowed to a POST, so it is not the Sage X3 SOAP service. Base URL must be scheme + host + port only (e.g. https://x3-server:8124) — the SOAP path is appended automatically. A missing port is the most common cause: Syracuse usually listens on 8124 or 8443, not on 443`;
	}
	if (status === 407) {
		return `A proxy requires authentication (HTTP 407) before reaching ${url}`;
	}
	if (status === 502 || status === 503 || status === 504) {
		return `Sage X3, or a proxy in front of it, returned HTTP ${status} for ${url} — the service is down, restarting, or overloaded`;
	}
	return undefined;
}

/**
 * Drop trailing empty values from an array. X3 returns dimensioned fields with every
 * "slot" filled, even unused ones — e.g. `"CCE": ["PEND-001","","","","",""]` is really
 * a 1-value array padded to the field's max dimension. Trailing "" / null / undefined
 * are dropped; interior empties are kept (their position is meaningful).
 */
function isEmptyValue(v: unknown): boolean {
	return v === '' || v === null || v === undefined;
}

function trimTrailingEmpty(arr: unknown[]): unknown[] {
	let i = arr.length;
	while (i > 0 && isEmptyValue(arr[i - 1])) i--;
	return i === arr.length ? arr : arr.slice(0, i);
}

/**
 * Recursively process X3 payload for display in n8n:
 * - optionally trim trailing empty values from arrays (sparse dimensions)
 * - optionally unwrap single-element arrays to their element
 * Multi-element arrays with meaningful values stay as arrays.
 */
export function reshapeX3Data(
	value: unknown,
	opts: { compact: boolean; trimEmpty: boolean },
): unknown {
	if (Array.isArray(value)) {
		let mapped = value.map((v) => reshapeX3Data(v, opts));
		if (opts.trimEmpty) mapped = trimTrailingEmpty(mapped);
		return opts.compact && mapped.length === 1 ? mapped[0] : mapped;
	}
	if (value !== null && typeof value === 'object') {
		const out: IDataObject = {};
		for (const [k, v] of Object.entries(value as IDataObject)) {
			out[k] = reshapeX3Data(v, opts) as IDataObject[keyof IDataObject];
		}
		return out;
	}
	return value;
}

// ---------------------------------------------------------------------------
// SQL query helpers (parameters + column names)
// ---------------------------------------------------------------------------

export type SqlParamType = 'boolean' | 'contains' | 'date' | 'list' | 'number' | 'text';

export interface SqlParam {
	name: string;
	type: SqlParamType;
	value: string;
}

// Matches a {{name}} placeholder. Built fresh per use so `lastIndex` never leaks.
const SQL_PARAM_PATTERN = '\\{\\{\\s*([A-Za-z0-9_.-]+)\\s*\\}\\}';

/** Quote a string as a SQL literal, doubling embedded single quotes. */
function escapeSqlText(name: string, value: string): string {
	if (value.includes('\u0000')) {
		throw new ApplicationError(`SQL parameter "${name}" contains a NUL character`);
	}
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Render a parameter as a complete SQL literal. The result already carries its
 * own quoting, so `{{param}}` must NOT be written inside quotes in the query.
 * Values are never concatenated raw — this is the injection barrier for the
 * AI Agent use case, where an LLM supplies the values.
 */
function escapeSqlValue(name: string, type: SqlParamType, raw: string): string {
	const value = raw.trim();
	switch (type) {
		case 'number':
			if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
				throw new ApplicationError(
					`SQL parameter "${name}" is typed Number but its value is not numeric: ${raw}`,
				);
			}
			return value;
		case 'boolean':
			return /^(true|1|yes|y|on)$/i.test(value) ? '1' : '0';
		case 'date':
			if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
				throw new ApplicationError(
					`SQL parameter "${name}" is typed Date but its value is not YYYY-MM-DD or ISO-8601: ${raw}`,
				);
			}
			return escapeSqlText(name, value);
		case 'contains': {
			// Wildcards inside the value must not act as wildcards themselves, so they
			// are neutralised with T-SQL bracket escaping before the surrounding %.
			// `[` is escaped first, otherwise the brackets added just after would be
			// escaped in turn.
			const likeEscaped = value.replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_]');
			return escapeSqlText(name, `%${likeEscaped}%`);
		}
		case 'list': {
			// "a, b ,c" -> 'a','b','c' — each element escaped on its own so the
			// result can be dropped straight into an IN (...) clause.
			const items = value
				.split(',')
				.map((v) => v.trim())
				.filter((v) => v !== '');
			if (items.length === 0) {
				throw new ApplicationError(
					`SQL parameter "${name}" is typed List but resolves to an empty list`,
				);
			}
			return items.map((v) => escapeSqlText(name, v)).join(',');
		}
		default:
			return escapeSqlText(name, value);
	}
}

const SQL_PARAM_TYPES: readonly SqlParamType[] = [
	'boolean',
	'contains',
	'date',
	'list',
	'number',
	'text',
];

/**
 * Parse the "Query Parameters (JSON)" field into the same shape the Fields
 * mode produces. The value usually arrives through an expression, so it may be
 * an already-resolved array or a JSON string. Each entry is checked strictly:
 * an unknown type is an error, never a silent fallback to Text, because the
 * caller of a generic runner would otherwise get a differently escaped value
 * than the one it asked for.
 */
export function parseSqlParamsJson(raw: unknown): SqlParam[] {
	let value: unknown = raw;
	if (typeof value === 'string') {
		const text = value.trim();
		if (text === '') return [];
		let parsedJson: unknown;
		let invalid = false;
		try {
			parsedJson = JSON.parse(text);
		} catch {
			invalid = true;
		}
		if (invalid) throw new ApplicationError('Query Parameters (JSON) is not valid JSON');
		value = parsedJson;
	}
	if (value === null || value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new ApplicationError(
			'Query Parameters (JSON) must be an array of { name, type, value } objects',
		);
	}
	// Same character class as SQL_PARAM_PATTERN: a name the query can reference.
	const nameRe = /^[A-Za-z0-9_.-]+$/;
	return value.map((entry, index) => {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new ApplicationError(`Query Parameters (JSON): entry #${index + 1} is not an object`);
		}
		const e = entry as Record<string, unknown>;
		const name = typeof e.name === 'string' ? e.name.trim() : '';
		if (!name || !nameRe.test(name)) {
			throw new ApplicationError(
				`Query Parameters (JSON): entry #${index + 1} needs a "name" made of letters, digits, _ . or -`,
			);
		}
		const type = typeof e.type === 'string' ? e.type.trim().toLowerCase() : 'text';
		if (!SQL_PARAM_TYPES.includes(type as SqlParamType)) {
			throw new ApplicationError(
				`Query Parameters (JSON): parameter "${name}" has unknown type "${String(e.type)}" (expected ${SQL_PARAM_TYPES.join(', ')})`,
			);
		}
		const v = e.value;
		let text: string;
		if (v === null || v === undefined) text = '';
		else if (Array.isArray(v)) text = v.map((x) => String(x ?? '').trim()).join(',');
		else if (typeof v === 'object') {
			throw new ApplicationError(
				`Query Parameters (JSON): parameter "${name}" has an object value; pass a string, number, boolean or array`,
			);
		} else text = String(v);
		return { name, type: type as SqlParamType, value: text };
	});
}

/** Read a numeric cap that may arrive as a number or as a numeric string from an expression. */
export function readPositiveNumber(raw: unknown): number | undefined {
	if (raw === null || raw === undefined || raw === '') return undefined;
	const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A parameter counts as provided only when it yields at least one value. */
function isSqlParamProvided(param: SqlParam | undefined): boolean {
	if (!param) return false;
	const value = (param.value ?? '').trim();
	if (value === '') return false;
	if (param.type === 'list') return value.split(',').some((v) => v.trim() !== '');
	return true;
}

/**
 * Flag every character that is NOT executable code: inside a string literal, a
 * double-dash line comment, or a slash-star block comment (T-SQL allows those
 * to nest). Markers found in such regions are left untouched, so commenting a
 * filter out disables it exactly the way a SQL reader expects.
 *
 * This runs before any substitution, so a parameter value can never introduce a
 * comment that would change how the query is analysed.
 */
function maskNonCode(query: string): boolean[] {
	const mask = new Array<boolean>(query.length).fill(false);
	let i = 0;
	let blockDepth = 0;

	while (i < query.length) {
		const c = query[i];
		const next = query[i + 1];

		if (blockDepth > 0) {
			mask[i] = true;
			if (c === '/' && next === '*') {
				blockDepth++;
				mask[i + 1] = true;
				i += 2;
				continue;
			}
			if (c === '*' && next === '/') {
				blockDepth--;
				mask[i + 1] = true;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (c === '-' && next === '-') {
			while (i < query.length && query[i] !== '\n') {
				mask[i] = true;
				i++;
			}
			continue;
		}

		if (c === '/' && next === '*') {
			blockDepth = 1;
			mask[i] = true;
			mask[i + 1] = true;
			i += 2;
			continue;
		}

		if (c === "'" || c === '"') {
			mask[i] = true;
			i++;
			while (i < query.length) {
				mask[i] = true;
				if (query[i] === c) {
					// A doubled quote is an escaped quote, not the end of the literal.
					if (query[i + 1] === c) {
						mask[i + 1] = true;
						i += 2;
						continue;
					}
					i++;
					break;
				}
				i++;
			}
			continue;
		}

		i++;
	}

	return mask;
}

/** indexOf that only matches positions belonging to executable code. */
function indexOfInCode(text: string, mask: boolean[], needle: string, from: number): number {
	let idx = text.indexOf(needle, from);
	while (idx !== -1 && mask[idx]) idx = text.indexOf(needle, idx + 1);
	return idx;
}

function collectSqlParamNames(text: string, mask: boolean[]): string[] {
	const names: string[] = [];
	const re = new RegExp(SQL_PARAM_PATTERN, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (!mask[m.index]) names.push(m[1]);
	}
	return names;
}

/** Whether the marker at `offset` sits directly inside an `IN ( ... )` clause. */
function isInsideInClause(text: string, offset: number): boolean {
	let i = offset - 1;
	while (i >= 0 && /\s/.test(text[i])) i--;
	if (i < 0 || text[i] !== '(') return false;
	return /\bIN\s*$/i.test(text.slice(0, i));
}

function substituteSqlParams(text: string, byName: Map<string, SqlParam>, mask: boolean[]): string {
	return text.replace(
		new RegExp(SQL_PARAM_PATTERN, 'g'),
		(full: string, name: string, offset: number) => {
			// Commented-out or quoted markers stay literal.
			if (mask[offset]) return full;
			const param = byName.get(name);
			if (!isSqlParamProvided(param)) {
				throw new ApplicationError(
					`SQL parameter "${name}" is used in the query but has no value. Define it in Query Parameters, comment that line out, or wrap the clause in [[ ... ]] to make it optional`,
				);
			}
			// A comma-bearing Text value inside IN (...) collapses into one literal:
			// valid SQL that silently matches nothing. Fail loudly instead.
			if (
				(param as SqlParam).type === 'text' &&
				((param as SqlParam).value ?? '').includes(',') &&
				isInsideInClause(text, offset)
			) {
				throw new ApplicationError(
					`SQL parameter "${name}" is typed Text but holds comma-separated values inside an IN (...) clause, so it would be sent as one single value and match nothing. Switch its Type to List`,
				);
			}
			return escapeSqlValue(name, (param as SqlParam).type, (param as SqlParam).value);
		},
	);
}

/**
 * Apply Metabase-style parameters to a query.
 * - `{{name}}` is replaced by the escaped value
 * - `[[ ... {{name}} ... ]]` is kept without its brackets when every parameter
 *   inside it is provided, and dropped entirely otherwise
 *
 * `[[` never occurs in valid T-SQL, so the `[identifier]` syntax cannot clash.
 * Markers sitting in a comment or a string literal are ignored throughout.
 * Optional blocks are resolved first (keep/drop only), then a single
 * substitution pass runs — so a value that itself contains `{{...}}` is never
 * re-expanded.
 */
export function applyQueryParameters(query: string, params: SqlParam[]): string {
	if (!query.includes('{{') && !query.includes('[[')) return query;

	const byName = new Map<string, SqlParam>();
	for (const param of params) {
		const name = (param.name ?? '').trim();
		if (name) byName.set(name, param);
	}

	const mask = maskNonCode(query);
	let resolved = '';
	let cursor = 0;
	while (cursor < query.length) {
		const start = indexOfInCode(query, mask, '[[', cursor);
		if (start === -1) {
			resolved += query.slice(cursor);
			break;
		}
		const end = indexOfInCode(query, mask, ']]', start + 2);
		if (end === -1) {
			throw new ApplicationError(
				'Unclosed optional block in the SQL query: a "[[" has no matching "]]"',
			);
		}
		resolved += query.slice(cursor, start);
		const inner = query.slice(start + 2, end);
		const names = collectSqlParamNames(inner, mask.slice(start + 2, end));
		if (names.length === 0) {
			throw new ApplicationError(
				'An optional block "[[ ... ]]" must contain at least one {{parameter}} to decide whether to keep it',
			);
		}
		if (names.every((name) => isSqlParamProvided(byName.get(name)))) resolved += inner;
		cursor = end + 2;
	}

	// Dropping the brackets shifts every offset, so the mask is recomputed on the
	// resolved text rather than reused.
	return substituteSqlParams(resolved, byName, maskNonCode(resolved));
}

/**
 * Remove SQL comments while leaving string literals untouched. Queries often
 * open with a documentation block, and carry comments between select items;
 * both would otherwise hide the SELECT keyword or unbalance the item splitting.
 * Each comment collapses to a single space so surrounding tokens stay separated.
 */
function stripSqlComments(query: string): string {
	let out = '';
	let i = 0;
	let blockDepth = 0;

	while (i < query.length) {
		const c = query[i];
		const next = query[i + 1];

		if (blockDepth > 0) {
			if (c === '/' && next === '*') {
				blockDepth++;
				i += 2;
				continue;
			}
			if (c === '*' && next === '/') {
				blockDepth--;
				i += 2;
				if (blockDepth === 0) out += ' ';
				continue;
			}
			i++;
			continue;
		}

		if (c === '-' && next === '-') {
			while (i < query.length && query[i] !== '\n') i++;
			out += ' ';
			continue;
		}

		if (c === '/' && next === '*') {
			blockDepth = 1;
			i += 2;
			continue;
		}

		if (c === "'" || c === '"') {
			out += c;
			i++;
			while (i < query.length) {
				out += query[i];
				if (query[i] === c) {
					if (query[i + 1] === c) {
						out += query[i + 1];
						i += 2;
						continue;
					}
					i++;
					break;
				}
				i++;
			}
			continue;
		}

		out += c;
		i++;
	}

	return out;
}

function unquoteSqlIdentifier(token: string): string {
	const t = token.trim();
	if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1);
	if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
	return t;
}

/**
 * Split the SELECT list on depth-0 commas and stop at the depth-0 FROM, so that
 * `ISNULL(a, b)` and sub-queries stay intact.
 */
function splitSelectList(text: string): string[] {
	const items: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let start = 0;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === quote) {
				if (text[i + 1] === quote) i++;
				else quote = null;
			}
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c;
			continue;
		}
		if (c === '(' || c === '[') {
			depth++;
			continue;
		}
		if (c === ')' || c === ']') {
			if (depth > 0) depth--;
			continue;
		}
		if (depth !== 0) continue;
		if (c === ',') {
			items.push(text.slice(start, i));
			start = i + 1;
			continue;
		}
		if (
			(c === 'F' || c === 'f') &&
			/^from\b/i.test(text.slice(i, i + 5)) &&
			/[\s)\]]/.test(text[i - 1] ?? ' ')
		) {
			items.push(text.slice(start, i));
			return items;
		}
	}
	items.push(text.slice(start));
	return items;
}

/** Resolve the output name of one SELECT item, or undefined when unknowable. */
function resolveColumnName(item: string): string | undefined {
	const s = item.trim();
	if (s === '' || s === '*' || s.endsWith('.*')) return undefined;

	const as = s.match(/\sAS\s+(\[[^\]]+\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_$#@]*)\s*$/i);
	if (as) return unquoteSqlIdentifier(as[1]);

	// A single bracketed name may legitimately contain dots: [my.column]
	if (/^\[[^\]]+\]$/.test(s)) return s.slice(1, -1);

	// Plain reference such as USR_0, [USR_0], t.[USR_0], dbo.t.col
	if (/^[A-Za-z0-9_$#@."[\]]+$/.test(s)) {
		const segments = s.split('.');
		const name = unquoteSqlIdentifier(segments[segments.length - 1]);
		return /^[A-Za-z0-9_$#@]+$/.test(name) ? name : undefined;
	}

	// Bare alias, but only for the unambiguous "reference alias" shape
	const two = s.match(/^([A-Za-z0-9_$#@."[\]]+)\s+(\[[^\]]+\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_$#@]*)$/);
	if (two) return unquoteSqlIdentifier(two[2]);

	return undefined;
}

/**
 * Best-effort recovery of the real column names from the query, because X3
 * answers with generic `Col_1`, `Col_2`, ... keys. Returns one entry per SELECT
 * item, `undefined` where the name cannot be determined (e.g. `SELECT *`).
 */
function deriveColumnNames(rawQuery: string): Array<string | undefined> {
	// Comments are dropped first: a leading documentation block would hide the
	// SELECT keyword, and inline ones can unbalance the item splitting.
	const query = stripSqlComments(rawQuery);
	const selectMatch = query.match(/^\s*SELECT\s+/i);
	if (!selectMatch) return [];
	let rest = query.slice(selectMatch[0].length);
	rest = rest.replace(/^\s*(?:ALL|DISTINCT)\s+/i, '');
	rest = rest.replace(/^\s*TOP\s*(?:\(\s*\d+\s*\)|\d+)\s*(?:PERCENT\s*)?(?:WITH\s+TIES\s*)?/i, '');
	return splitSelectList(rest).map(resolveColumnName);
}

// ---------------------------------------------------------------------------
// SOAP envelope construction
// ---------------------------------------------------------------------------

function buildCallContext(ctx: CallContext): string {
	return `<callContext xsi:type="wss:CAdxCallContext">
			<codeLang xsi:type="xsd:string">${xmlEscape(ctx.codeLang)}</codeLang>
			<poolAlias xsi:type="xsd:string">${xmlEscape(ctx.poolAlias)}</poolAlias>
			<poolId xsi:type="xsd:string">${xmlEscape(ctx.poolId)}</poolId>
			<requestConfig xsi:type="xsd:string">${xmlEscape(ctx.requestConfig)}</requestConfig>
		</callContext>`;
}

/**
 * Build the JSON payload accepted natively by X3 when requestConfig carries
 * adxwss.optreturn=JSON. Despite the `inputXml` parameter name, X3 accepts a pure JSON
 * object whose keys are the web service blocks (GRP1) and fields. XDATAJSON stays a
 * stringified JSON value, matching its Clob type.
 */
export function buildChatX3InputJson(args: {
	object: string;
	transaction: string;
	action: string;
	ident: string;
	dataJson: string;
}): string {
	const { object, transaction, action, ident, dataJson } = args;
	return JSON.stringify({
		GRP1: {
			XOBJECT: object,
			XTRANSACTION: transaction,
			XACTION: action,
			XIDENT: ident,
			XDATAJSON: dataJson,
			XRETURNJSON: '',
		},
	});
}

/** Merge the adxwss JSON-mode flags into an existing requestConfig string. */
export function withJsonRequestConfig(existing: string): string {
	const flags = 'adxwss.optreturn=JSON&adxwss.beautify=true';
	if (!existing) return flags;
	return existing.includes('adxwss.optreturn') ? existing : `${existing}&${flags}`;
}

/**
 * Wrap an inputXml payload in the SOAP envelope for the `run` operation.
 */
export function buildRunEnvelope(ctx: CallContext, publicName: string, inputXml: string): string {
	return `<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wss="http://www.adonix.com/WSS">
	<soapenv:Header/>
	<soapenv:Body>
		<wss:run soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
			${buildCallContext(ctx)}
			<publicName xsi:type="xsd:string">${xmlEscape(publicName)}</publicName>
			<inputXml xsi:type="xsd:string">${wrapCdata(inputXml)}</inputXml>
		</wss:run>
	</soapenv:Body>
</soapenv:Envelope>`;
}

// ---------------------------------------------------------------------------
// Response parsing — turns SOAP+X3 result into clean n8n-friendly JSON
// ---------------------------------------------------------------------------

export interface ParsedResponse {
	status: number | undefined;
	resultXml: string;
	/** Parsed XDATAJSON — the actual X3 object payload (ITM0/ITM1/... blocks). */
	dataJson: unknown;
	/** Parsed XRETURNJSON — wrapper holding `success` + `messages[]`. */
	returnJson: unknown;
	/** Convenience: success flag lifted out of XRETURNJSON. */
	xsuccess: boolean | undefined;
	/** Convenience: messages array lifted out of XRETURNJSON. */
	xmessages: unknown;
	/** Convenience: trace lifted out of XRETURNJSON messages. */
	xtrace: string | undefined;
	soapMessages: IDataObject[];
	/** Full <technicalInfos> block parsed into a flat object (numbers/booleans/strings). */
	technicalInfos: IDataObject;
	/**
	 * X3 pool entry index that handled the call. Pass this back as `poolId` in subsequent
	 * calls to keep the same X3 session — required when you want a READ to hold its lock
	 * for a follow-up MODIFY.
	 */
	sessionId: string | undefined;
}

/**
 * Parse a <technicalInfos> block into a flat object. Children with xsi:nil="true" are skipped.
 * Numbers and booleans are coerced from their text representation.
 */
function parseTechnicalInfos(xml: string | undefined): IDataObject {
	const result: IDataObject = {};
	if (!xml) return result;
	// Match every direct child element, capturing tag, attributes and inner text.
	const childRe = /<(?:[\w.-]+:)?([\w.-]+)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1>)/gi;
	let m: RegExpExecArray | null;
	while ((m = childRe.exec(xml)) !== null) {
		const tag = m[1];
		const attrs = m[2] ?? '';
		const inner = m[3];
		if (/\bxsi:nil="true"/.test(attrs)) continue;
		if (inner === undefined) continue;
		const raw = readTextContent(inner);
		// Coerce to number/boolean based on the xsi:type hint when available.
		const typeMatch = attrs.match(/xsi:type="(?:[\w.-]+:)?(\w+)"/);
		const xsiType = typeMatch ? typeMatch[1] : '';
		let value: unknown = raw;
		if (xsiType === 'int' || xsiType === 'long' || xsiType === 'double' || xsiType === 'float') {
			const n = Number(raw);
			value = Number.isFinite(n) ? n : raw;
		} else if (xsiType === 'boolean') {
			value = raw === 'true';
		}
		result[tag] = value as IDataObject[keyof IDataObject];
	}
	return result;
}

/**
 * Extract XDATAJSON and XRETURNJSON from a resultXml payload, auto-detecting whether X3
 * returned XML (`<RESULT><GRP><FLD NAME="...">`) or JSON (`{"GRP1":{"XDATAJSON":"..."}}`,
 * produced when requestConfig has adxwss.optreturn=JSON). Both fields stay stringified
 * JSON in either mode, so they get a second parse pass.
 */
function extractResultFields(resultXml: string): { dataJson: unknown; returnJson: unknown } {
	const trimmed = resultXml.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const obj = JSON.parse(trimmed) as IDataObject;
			const grp = (obj.GRP1 ?? obj) as IDataObject;
			return {
				dataJson: tryParseJson(grp.XDATAJSON as string | undefined),
				returnJson: tryParseJson(grp.XRETURNJSON as string | undefined),
			};
		} catch {
			// Not valid JSON after all — fall through to XML extraction.
		}
	}
	return {
		dataJson: tryParseJson(pickResultField(resultXml, 'XDATAJSON')),
		returnJson: tryParseJson(pickResultField(resultXml, 'XRETURNJSON')),
	};
}

export function parseRunResponse(rawText: string): ParsedResponse {
	// Multi-ref blocks live outside the response element, at the envelope body level.
	const multiRefs = extractMultiRefs(rawText);

	const responseInner = pickElement(rawText, 'runResponse') ?? rawText;
	const returnInner = pickElement(responseInner, 'runReturn') ?? responseInner;

	const statusRaw = pickElement(returnInner, 'status');
	const status = statusRaw !== undefined ? Number(readTextContent(statusRaw)) : undefined;

	// resultXml may be self-closing or carry xsi:nil="true" when X3 has nothing to return.
	const resultXmlRaw = pickElement(returnInner, 'resultXml');
	const resultXml = resultXmlRaw !== undefined ? readTextContent(resultXmlRaw) : '';

	// XDATAJSON = the object payload (read result, or what was created/modified)
	// XRETURNJSON = wrapper holding {success, messages:[{info|error|alert|trace}, ...]}
	// Works whether X3 returned XML or native JSON (adxwss.optreturn=JSON).
	const { dataJson, returnJson } = extractResultFields(resultXml);

	let xsuccess: boolean | undefined;
	let xmessages: unknown;
	let xtrace: string | undefined;

	if (returnJson && typeof returnJson === 'object' && !Array.isArray(returnJson)) {
		const obj = returnJson as IDataObject;
		if (typeof obj.success === 'boolean') xsuccess = obj.success;
		if (Array.isArray(obj.messages)) {
			xmessages = obj.messages;
			const traceEntry = (obj.messages as IDataObject[]).find(
				(m) => m !== null && typeof m === 'object' && typeof m.trace === 'string',
			);
			if (traceEntry) xtrace = traceEntry.trace as string;
		}
	}

	const soapMessages = pickSoapMessages(returnInner, multiRefs);

	const technicalInfosXml = pickElement(returnInner, 'technicalInfos');
	const technicalInfos = parseTechnicalInfos(technicalInfosXml);

	// X3 returns the pool entry index it used. Reusing it as poolId in subsequent calls
	// pins the next request to the same X3 session, which is necessary to keep object
	// locks alive between READ and MODIFY.
	const poolEntryIdx = technicalInfos.poolEntryIdx;
	const sessionId =
		poolEntryIdx !== undefined && poolEntryIdx !== null && poolEntryIdx !== -1
			? String(poolEntryIdx)
			: undefined;

	return {
		status,
		resultXml,
		dataJson,
		returnJson,
		xsuccess,
		xmessages,
		xtrace,
		soapMessages,
		technicalInfos,
		sessionId,
	};
}

/**
 * Normalize an X3 object operation response into the standard n8n output shape:
 *   { success, status, action, object, ident, data, messages, trace }
 *
 * Lifts `messages` and `trace` from XRETURNJSON to the top level when present.
 */
export function buildObjectOperationOutput(args: {
	action: string;
	object: string;
	ident: string;
	transaction: string;
	parsed: ParsedResponse;
	includeResultXml: boolean;
	includeRaw: boolean;
	includeTechnicalInfos: boolean;
	reshapeOpts: { compact: boolean; trimEmpty: boolean };
	raw: string;
}): IDataObject {
	const {
		action,
		object,
		ident,
		transaction,
		parsed,
		includeResultXml,
		includeRaw,
		includeTechnicalInfos,
		reshapeOpts,
		raw,
	} = args;

	// Prefer XRETURNJSON.success when present, fall back to status === 1.
	const success = parsed.xsuccess ?? parsed.status === 1;

	// Messages: from XRETURNJSON, or from SOAP-level messages when XRETURNJSON is empty.
	let messages: unknown = parsed.xmessages;
	if (
		(messages === undefined || (Array.isArray(messages) && messages.length === 0)) &&
		parsed.soapMessages.length > 0
	) {
		messages = parsed.soapMessages;
	}

	const output: IDataObject = {
		success,
		status: parsed.status,
		action,
		object,
		ident,
	};
	if (transaction) output.transaction = transaction;
	if (parsed.dataJson !== undefined) {
		const data =
			reshapeOpts.compact || reshapeOpts.trimEmpty
				? reshapeX3Data(parsed.dataJson, reshapeOpts)
				: parsed.dataJson;
		output.data = data as IDataObject;
	}
	if (messages !== undefined) output.messages = messages as IDataObject;
	if (parsed.xtrace !== undefined) output.trace = parsed.xtrace;
	if (parsed.sessionId !== undefined) output.sessionId = parsed.sessionId;
	if (includeTechnicalInfos && Object.keys(parsed.technicalInfos).length > 0)
		output.technicalInfos = parsed.technicalInfos;
	if (includeResultXml && parsed.resultXml)
		output.result = debugResult(parsed.resultXml) as IDataObject;
	if (includeRaw) output.raw = raw;

	return output;
}

/**
 * Turn an X3 date into a plain `YYYY-MM-DD`, and its "not set" sentinel into
 * null. The time part is only dropped when it is exactly midnight UTC, so a
 * genuine timestamp keeps its full value — the conversion never loses data.
 */
function normalizeX3Date(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const withTime = value.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/);
	const day = withTime ? withTime[1] : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
	if (day === undefined) return value;
	return day === '0000-00-00' ? null : day;
}

/**
 * Locate the row array in a SQL response. X3 answers with a plain array of flat
 * objects, so this stays deliberately small; `recognised: false` tells the
 * caller to fall back to the full envelope rather than invent a shape.
 */
function extractSqlRows(dataJson: unknown): { rows: IDataObject[]; recognised: boolean } {
	if (Array.isArray(dataJson)) {
		if (dataJson.length === 0) return { rows: [], recognised: true };
		const allObjects = dataJson.every(
			(row) => row !== null && typeof row === 'object' && !Array.isArray(row),
		);
		return allObjects
			? { rows: dataJson as IDataObject[], recognised: true }
			: { rows: [], recognised: false };
	}
	if (dataJson !== null && typeof dataJson === 'object') {
		const arrayProps = Object.values(dataJson as IDataObject).filter((v) => Array.isArray(v));
		if (arrayProps.length === 1) return extractSqlRows(arrayProps[0]);
	}
	return { rows: [], recognised: false };
}

/**
 * Decide the column labels for a SQL result. The derived names replace X3's
 * generic `Col_N` keys only when the mapping is unambiguous: same count, no
 * gaps, no duplicates, and every row sharing the same key set. Otherwise the
 * raw keys are kept — a misaligned mapping would be worse than none.
 */
function resolveSqlColumns(keys: string[], derived: Array<string | undefined>): string[] {
	if (keys.length === 0) return derived.filter((n): n is string => !!n);
	if (derived.length !== keys.length) return keys;
	if (derived.some((n) => !n)) return keys;
	const names = derived as string[];
	if (new Set(names).size !== names.length) return keys;
	return names;
}

/**
 * Build the Simplify output for a SQL SELECT: `{ success, rowCount, columns,
 * rows }` with the real column names restored. Reads the raw `dataJson` on
 * purpose — running it through `reshapeX3Data` would collapse a single-row
 * result into a bare object and make the output type depend on the row count.
 * Returns undefined when the payload is not row-shaped, so the caller can fall
 * back to the standard envelope.
 */
export function buildSqlSimplifiedOutput(
	parsed: ParsedResponse,
	query: string,
	rowFormat: 'arrays' | 'objects',
	maxLines?: number,
): IDataObject | undefined {
	const { rows, recognised } = extractSqlRows(parsed.dataJson);
	if (!recognised) return undefined;

	const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
	const sameShape = rows.every(
		(row) => Object.keys(row).length === keys.length && keys.every((k) => k in row),
	);
	const columns = resolveSqlColumns(sameShape ? keys : [], deriveColumnNames(query));
	const labels = columns.length === keys.length ? columns : keys;

	const success = parsed.xsuccess ?? parsed.status === 1;

	// The happy path stays down to the data itself. `success` and `trace` only
	// reappear when something went wrong, where they are worth the extra tokens.
	const output: IDataObject = {};
	if (!success) output.success = false;
	output.rowCount = rows.length;
	// X3 stops at max_lines without saying so; a result that fills the cap is
	// flagged so the caller (or the AI Agent) knows it may be looking at a slice.
	if (maxLines !== undefined && rows.length >= maxLines) output.truncated = true;
	output.columns = columns;
	output.rows =
		rowFormat === 'arrays'
			? rows.map((row) => keys.map((key) => normalizeX3Date(row[key])))
			: rows.map((row) => {
					const mapped: IDataObject = {};
					keys.forEach((key, index) => {
						mapped[labels[index]] = normalizeX3Date(row[key]) as IDataObject[string];
					});
					return mapped;
				});

	// Keep only real user messages — the bare {trace} entry carries no
	// information for the caller.
	const rawMessages = Array.isArray(parsed.xmessages) ? (parsed.xmessages as IDataObject[]) : [];
	const realMessages = rawMessages.filter(
		(m) => m !== null && typeof m === 'object' && Object.keys(m).some((k) => k !== 'trace'),
	);
	if (realMessages.length > 0) output.messages = realMessages;
	else if (parsed.soapMessages.length > 0) output.messages = parsed.soapMessages;
	if (!success && parsed.xtrace !== undefined) output.trace = parsed.xtrace;

	return output;
}

// ---------------------------------------------------------------------------
// Connection and transport shared by every node
// ---------------------------------------------------------------------------

export interface X3Connection {
	soapUrl: string;
	allowSelfSigned: boolean;
	/** Credential defaults merged with the per-call overrides, JSON mode flags applied. */
	ctx: CallContext;
	publicName: string;
	requestTimeoutMs: number;
}

/**
 * Resolve where and how to call Sage X3 from the credential and the node's
 * Advanced Options (code language, pool, public name and timeout overrides).
 */
export function resolveX3Connection(credentials: IDataObject, advanced: IDataObject): X3Connection {
	const baseUrl = String(credentials.baseUrl ?? '').replace(/\/+$/, '');
	const ctx: CallContext = {
		codeLang: String(credentials.codeLang ?? 'FRA'),
		poolAlias: String(credentials.poolAlias ?? ''),
		poolId: String(credentials.poolId ?? ''),
		requestConfig: String(credentials.requestConfig ?? ''),
	};
	for (const k of ['codeLang', 'poolAlias', 'poolId'] as const) {
		const v = advanced[k];
		if (typeof v === 'string' && v !== '') ctx[k] = v;
	}
	// X3 native JSON mode is the only mode: always ask X3 to answer in JSON.
	ctx.requestConfig = withJsonRequestConfig(ctx.requestConfig);

	const publicName =
		typeof advanced.publicName === 'string' && advanced.publicName !== ''
			? advanced.publicName
			: DEFAULT_PUBLIC_NAME;
	// Default 30 s — avoids AI Agent runs hanging forever on a dead X3 server.
	const timeoutSec =
		typeof advanced.requestTimeout === 'number' && advanced.requestTimeout > 0
			? advanced.requestTimeout
			: 30;

	return {
		soapUrl: `${baseUrl}${SOAP_PATH}`,
		allowSelfSigned: Boolean(credentials.allowSelfSigned),
		ctx,
		publicName,
		requestTimeoutMs: timeoutSec * 1000,
	};
}

/** POST a SOAP envelope to Sage X3 with the credential's Basic auth and return the response body. */
export async function postSoapEnvelope(
	fns: IExecuteFunctions,
	connection: X3Connection,
	envelope: string,
): Promise<string> {
	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url: connection.soapUrl,
		headers: {
			'Content-Type': 'text/xml; charset=utf-8',
			SOAPAction: '""',
		},
		body: envelope,
		returnFullResponse: false,
		skipSslCertificateValidation: connection.allowSelfSigned,
		timeout: connection.requestTimeoutMs,
	};
	const response = (await fns.helpers.httpRequestWithAuthentication.call(
		fns,
		'nx3SoapApi',
		requestOptions,
	)) as string | Buffer;
	return typeof response === 'string'
		? response
		: Buffer.isBuffer(response)
			? response.toString('utf8')
			: String(response);
}

/**
 * Turn whatever the request layer threw into one actionable sentence: HTTP
 * status first (the server answered), then network causes, then the raw message.
 */
export function describeX3Error(
	err: Error & { code?: string },
	soapUrl: string,
): { message: string; httpStatus?: number } {
	const httpStatus = extractHttpStatus(err);
	const hint =
		(httpStatus !== undefined ? describeHttpError(httpStatus, soapUrl) : undefined) ??
		describeNetworkError(err);
	const out: { message: string; httpStatus?: number } = {
		message: hint ?? err.message ?? 'Unknown error calling Sage X3',
	};
	if (httpStatus !== undefined) out.httpStatus = httpStatus;
	return out;
}
