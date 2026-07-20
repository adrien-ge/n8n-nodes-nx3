import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

// Path appended to the credential base URL to reach the SOAP endpoint.
const SOAP_PATH = '/soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC';

// Default X3 sub-program implementing the JSON-driven object API (patch ChatX3).
const DEFAULT_PUBLIC_NAME = 'XCHATX3OBJ';

type Operation =
	| 'read'
	| 'list'
	| 'create'
	| 'modify'
	| 'describe'
	| 'custom'
	| 'sqlAnalyse'
	| 'sqlSelect'
	| 'runRaw';

// Built-in XACTION values. `custom` reads the value from a free-text field at runtime,
// `runRaw` builds its own input payload, so neither appear in the map.
const ACTION_MAP: Record<Exclude<Operation, 'runRaw' | 'custom'>, string> = {
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
const X3_OBJECT_OPS: string[] = ['read', 'list', 'create', 'modify', 'describe', 'custom'];
// SQL ops that run a query through XCHATX3OBJ with XOBJECT='SQL'.
const SQL_OPS: string[] = ['sqlAnalyse', 'sqlSelect'];
// Subset whose XDATAJSON payload carries object data (the user's `data` field is read).
// Read and Describe send no object data — only the optional `context` envelope, if any.
const X3_OPS_WITH_DATA: string[] = ['list', 'create', 'modify', 'custom'];

// One Action Code field per built-in operation, each pre-filled with the matching XACTION.
// The Operation dropdown thus seeds the field with the right default (acting as a shortcut),
// while the user can still edit the value to send a different action.
const ACTION_CODE_PRESET_FIELDS: INodeProperties[] = (
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
const ACTION_CODE_CUSTOM_FIELD: INodeProperties = {
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

interface CallContext {
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
	return s
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
		.replace(/&amp;/g, '&');
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
	const re = /<(?:[\w.-]+:)?multiRef\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?multiRef>/gi;
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
	const childRe =
		/<(?:[\w.-]+:)?(messages|item)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1>)/gi;
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
function tryParseJson(s: string | undefined): unknown {
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
function deepParseJsonStrings(value: unknown): unknown {
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
function debugResult(resultXml: string): unknown {
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
function describeNetworkError(err: Error & { code?: string }): string | undefined {
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
function reshapeX3Data(
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
function buildChatX3InputJson(args: {
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
function withJsonRequestConfig(existing: string): string {
	const flags = 'adxwss.optreturn=JSON&adxwss.beautify=true';
	if (!existing) return flags;
	return existing.includes('adxwss.optreturn') ? existing : `${existing}&${flags}`;
}

/**
 * Wrap an inputXml payload in the SOAP envelope for the `run` operation.
 */
function buildRunEnvelope(ctx: CallContext, publicName: string, inputXml: string): string {
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

interface ParsedResponse {
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

function parseRunResponse(rawText: string): ParsedResponse {
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
function buildObjectOperationOutput(args: {
	action: string;
	object: string;
	ident: string;
	transaction: string;
	parsed: ParsedResponse;
	includeResultXml: boolean;
	includeRaw: boolean;
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
	if (Object.keys(parsed.technicalInfos).length > 0) output.technicalInfos = parsed.technicalInfos;
	if (includeResultXml && parsed.resultXml) output.result = debugResult(parsed.resultXml) as IDataObject;
	if (includeRaw) output.raw = raw;

	return output;
}

// ---------------------------------------------------------------------------
// Node definition
// ---------------------------------------------------------------------------

export class Nx3Soap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IntellX for Sage X3',
		name: 'nx3Soap',
		icon: 'file:nx3.svg',
		group: ['transform'],
		version: 1,
		subtitle:
			'={{$parameter["operation"] + ": " + ($parameter["object"] || $parameter["publicName"]) + ($parameter["ident"] ? " (" + $parameter["ident"] + ")" : "")}}',
		description:
			'Read, create or modify a Sage X3 object via the XCHATX3OBJ sub-program (JSON in, JSON out)',
		defaults: { name: 'IntellX for Sage X3' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'nx3SoapApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
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
						description:
							'Execute a SQL SELECT against the Sage X3 database and return the rows',
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
				placeholder: 'ITM',
				description: 'Sage X3 object code (e.g. ITM, SOH, BPC)',
				displayOptions: { show: { operation: X3_OBJECT_OPS } },
			},
			{
				displayName: 'Transaction Code',
				name: 'transaction',
				type: 'string',
				default: '',
				placeholder: 'STD',
				description: 'Sage X3 transaction code (XTRANSACTION). Leave empty for default.',
				displayOptions: { show: { operation: X3_OBJECT_OPS } },
			},
			{
				displayName: 'Identifier',
				name: 'ident',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'BMS009',
				description: 'Primary identifier of the object (XIDENT)',
				displayOptions: { show: { operation: ['read', 'modify'] } },
			},
			{
				displayName: 'Identifier',
				name: 'ident',
				type: 'string',
				default: '',
				placeholder: 'ASS001B',
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
						description: 'Whether to include hidden and technical fields in the response (off by default)',
					},
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: '',
						placeholder: 'ITA',
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
										placeholder: 'DES1AXX',
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
										placeholder: 'ITM0',
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
						placeholder: 'FU01',
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
				placeholder:
					'SELECT TOP (100) [ITMREF_0], [ITMDES1_0] FROM [basex3].[SEED].[ITMMASTER]',
				description:
					'SQL query executed against the Sage X3 database via the ChatX3 sub-program. Read-only style — use SQL Analyse to validate the syntax, SQL Select to fetch rows.',
				displayOptions: { show: { operation: SQL_OPS } },
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
						displayName: 'Max Time (Ms)',
						name: 'maxTime',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 1 },
						description: 'Cap the SQL execution time in milliseconds',
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
						description: 'Override the credential poolId. Set this to the previous call\'s `sessionId` (e.g. ={{$JSON.sessionId}}) to keep the same Sage X3 session — needed when chaining READ → MODIFY to preserve the Sage X3 lock on the object.',
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
		const baseUrl = String(credentials.baseUrl ?? '').replace(/\/+$/, '');
		const allowSelfSigned = Boolean(credentials.allowSelfSigned);
		const defaultCtx: CallContext = {
			codeLang: String(credentials.codeLang ?? 'FRA'),
			poolAlias: String(credentials.poolAlias ?? ''),
			poolId: String(credentials.poolId ?? ''),
			requestConfig: String(credentials.requestConfig ?? ''),
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as Operation;
				const advanced = this.getNodeParameter('advanced', i, {}) as IDataObject;

				// Effective call context (credential defaults + per-call overrides)
				const ctx: CallContext = { ...defaultCtx };
				for (const k of ['codeLang', 'poolAlias', 'poolId'] as const) {
					const v = advanced[k];
					if (typeof v === 'string' && v !== '') ctx[k] = v;
				}

				const includeResultXml = Boolean(advanced.includeResultXml);
				const includeRaw = Boolean(advanced.includeRaw);
				const includeRequest = Boolean(advanced.includeRequest);
				// Default true: compact single-value arrays for readability. Pass advanced.compactArrays
				// explicitly only when set (n8n collections may omit unset values).
				const compactArrays =
					advanced.compactArrays === undefined ? true : Boolean(advanced.compactArrays);
				const trimEmpty =
					advanced.trimEmpty === undefined ? true : Boolean(advanced.trimEmpty);
				const reshapeOpts = { compact: compactArrays, trimEmpty };

				// X3 native JSON mode is the only mode: always ask X3 to answer in JSON.
				ctx.requestConfig = withJsonRequestConfig(ctx.requestConfig);

				let envelope: string;
				let inputXmlSent: string;
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
					const query = (this.getNodeParameter('sqlQuery', i, '') as string).trim();
					if (!query) {
						throw new NodeOperationError(this.getNode(), 'SQL Query is required', {
							itemIndex: i,
						});
					}
					const sqlOpts = this.getNodeParameter('sqlOptions', i, {}) as IDataObject;
					const sqlCtx: IDataObject = {};
					if (typeof sqlOpts.maxLines === 'number' && sqlOpts.maxLines > 0) {
						sqlCtx.max_lines = sqlOpts.maxLines;
					}
					if (typeof sqlOpts.maxTime === 'number' && sqlOpts.maxTime > 0) {
						sqlCtx.max_time = sqlOpts.maxTime;
					}
					const sqlPayload: IDataObject = { query };
					if (Object.keys(sqlCtx).length > 0) sqlPayload.context = sqlCtx;

					// A typed Action Code overrides the ANALYSE/SELECT preset, mirroring the
					// behaviour for object ops.
					const typedAction = (this.getNodeParameter('actionCode', i, '') as string)
						.trim()
						.toUpperCase();
					const action = typedAction || ACTION_MAP[operation as 'sqlAnalyse' | 'sqlSelect'];

					const publicName =
						typeof advanced.publicName === 'string' && advanced.publicName !== ''
							? advanced.publicName
							: DEFAULT_PUBLIC_NAME;

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
					const dataJsonString =
						Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : '';

					const publicName =
						typeof advanced.publicName === 'string' && advanced.publicName !== ''
							? advanced.publicName
							: DEFAULT_PUBLIC_NAME;

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

				// Default 30 s — avoids AI Agent runs hanging forever on a dead X3 server.
				const requestTimeoutSec =
					typeof advanced.requestTimeout === 'number' && advanced.requestTimeout > 0
						? advanced.requestTimeout
						: 30;
				const requestTimeoutMs = requestTimeoutSec * 1000;

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: `${baseUrl}${SOAP_PATH}`,
					headers: {
						'Content-Type': 'text/xml; charset=utf-8',
						SOAPAction: '""',
					},
					body: envelope,
					returnFullResponse: false,
					skipSslCertificateValidation: allowSelfSigned,
					timeout: requestTimeoutMs,
				};

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'nx3SoapApi',
					requestOptions,
				)) as string | Buffer;

				const rawText =
					typeof response === 'string'
						? response
						: Buffer.isBuffer(response)
							? response.toString('utf8')
							: String(response);

				const parsed = parseRunResponse(rawText);

				let output: IDataObject;
				if (metaForOutput.kind === 'object') {
					output = buildObjectOperationOutput({
						action: metaForOutput.action,
						object: metaForOutput.object,
						ident: metaForOutput.ident,
						transaction: metaForOutput.transaction,
						parsed,
						includeResultXml,
						includeRaw,
						reshapeOpts,
						raw: rawText,
					});
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
					if (Object.keys(parsed.technicalInfos).length > 0)
						output.technicalInfos = parsed.technicalInfos;
					if (includeResultXml && parsed.resultXml) output.result = debugResult(parsed.resultXml) as IDataObject;
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
					output.request = {
						input: input as IDataObject,
						envelope,
					};
				}

				returnData.push({ json: output, pairedItem: i });
			} catch (error) {
				const err = error as Error & { code?: string };
				const networkHint = describeNetworkError(err);
				const friendlyMessage = networkHint ?? err.message ?? 'Unknown error calling Sage X3';

				if (this.continueOnFail()) {
					returnData.push({
						json: { error: friendlyMessage, code: err.code, raw: err.message },
						pairedItem: i,
					});
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
