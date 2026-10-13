/**
 * The "Run Sage X3 Query" operation: read a graphical query (object ALT),
 * interpret it as SQL, apply the bounds and run it through the SQL object.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	extractQuerySource,
	interpretX3Query,
	type ColumnAliasMode,
	type InterpretOptions,
	type InterpretedQuery,
	type QueryParameter,
	type SqlDialect,
	type X3QuerySource,
} from './x3QueryInterpreter';
import {
	applyQueryParameters,
	buildChatX3InputJson,
	buildRunEnvelope,
	buildSqlSimplifiedOutput,
	deepParseJsonStrings,
	parseRunResponse,
	postSoapEnvelope,
	readPositiveNumber,
	tryParseJson,
	type SqlParam,
	type X3Connection,
} from './x3Soap';

export interface BoundInput {
	column?: string;
	from?: string;
	to?: string;
}

/**
 * Filled in as the run progresses, so that an error raised at any point can
 * still say which query it was about, which call failed and what SQL was
 * about to run.
 */
export interface QueryRunState {
	queryCode: string;
	phase: 'read' | 'interpret' | 'select';
	sql?: string;
	timings: IDataObject;
}

export interface QueryRunParams {
	queryCode: string;
	execute: boolean;
	bounds: BoundInput[];
	/** The Query Options collection of the node. */
	options: IDataObject;
	includeRequest: boolean;
	itemIndex: number;
}

/** `[F:SQH]BPCORD`, `SQH.BPCORD`, `sqh_bpcord` and `BPCORD` all name the same column. */
function normaliseColumnRef(raw: string): string {
	return raw
		.trim()
		.toUpperCase()
		.replace(/^\[(?:[A-Z]:)?([A-Z0-9_]+)\]/, '$1_')
		.replace(/[.\s]+/g, '_')
		.replace(/\((\d+)\)$/, '_$1');
}

/**
 * Turn the user's Bounds into the SQL parameters the interpreted query expects.
 * A bound may name the column by its code (`SQH_BPCORD`), by the field alone
 * (`BPCORD`) when that is unambiguous, or by its grid label (`Customer`).
 */
export function resolveBounds(
	bounds: BoundInput[],
	parameters: QueryParameter[],
): { params: SqlParam[]; error?: string } {
	const params: SqlParam[] = parameters.map((p) => ({ name: p.name, type: p.type, value: '' }));
	const byBase = new Map<string, QueryParameter[]>();
	for (const p of parameters) {
		const base = p.name.replace(/_(from|to)(_\d+)?$/, '');
		const list = byBase.get(base) ?? [];
		list.push(p);
		byBase.set(base, list);
	}
	const bases = Array.from(byBase.keys());

	for (const bound of bounds) {
		const ref = normaliseColumnRef(bound.column ?? '');
		if (ref === '') continue;
		let matches = bases.filter((b) => b === ref);
		if (matches.length === 0) matches = bases.filter((b) => b.replace(/^[A-Z0-9]+_/, '') === ref);
		if (matches.length === 0) {
			const label = (bound.column ?? '').trim().toLowerCase();
			matches = bases.filter(
				(b) => (byBase.get(b) as QueryParameter[])[0].label.toLowerCase() === label,
			);
		}
		if (matches.length === 0) {
			return {
				params,
				error: `Bound "${bound.column}" does not match a bounded column of this query. Bounded columns: ${bases.join(', ') || '(none)'}`,
			};
		}
		if (matches.length > 1) {
			return {
				params,
				error: `Bound "${bound.column}" is ambiguous (${matches.join(', ')}); prefix it with the table alias`,
			};
		}
		for (const p of byBase.get(matches[0]) as QueryParameter[]) {
			const value = p.bound === 'from' ? bound.from : bound.to;
			const target = params.find((x) => x.name === p.name) as SqlParam;
			target.value = value === undefined || value === null ? '' : String(value);
		}
	}
	return { params };
}

function structureOf(result: InterpretedQuery): IDataObject {
	return {
		tables: result.tables as unknown as IDataObject[],
		joins: result.joins as unknown as IDataObject[],
		columns: result.columns as unknown as IDataObject[],
		criteria: result.criteria as unknown as IDataObject[],
		orderBy: result.orderBy as unknown as IDataObject[],
	};
}

function x3Messages(parsed: ReturnType<typeof parseRunResponse>): string[] {
	if (Array.isArray(parsed.xmessages)) {
		return (parsed.xmessages as IDataObject[])
			.map((m) => (m && typeof m === 'object' ? (m.error ?? m.alert ?? m.info ?? '') : ''))
			.filter((m): m is string => typeof m === 'string' && m !== '');
	}
	return parsed.soapMessages.map((m) => String(m.message ?? ''));
}

/**
 * Run one graphical query. Throws NodeOperationError for anything the query
 * definition or the bounds make impossible; transport errors propagate as-is
 * so the node reports them like any other call.
 */
export async function runX3Query(
	fns: IExecuteFunctions,
	connection: X3Connection,
	params: QueryRunParams,
	state: QueryRunState,
): Promise<IDataObject> {
	const { options, itemIndex } = params;

	const callX3 = async (args: {
		object: string;
		action: string;
		ident: string;
		dataJson: string;
	}) => {
		const inputXml = buildChatX3InputJson({ ...args, transaction: '' });
		const envelope = buildRunEnvelope(connection.ctx, connection.publicName, inputXml);
		const rawText = await postSoapEnvelope(fns, connection, envelope);
		return { parsed: parseRunResponse(rawText), inputXml, envelope };
	};

	// 1. The query definition: a READ of the ALT record ---------------------
	state.queryCode = params.queryCode.trim().toUpperCase();
	state.phase = 'read';
	if (!state.queryCode) {
		throw new NodeOperationError(fns.getNode(), 'Query Code is required', { itemIndex });
	}
	const readStart = Date.now();
	const read = await callX3({
		object: 'ALT',
		action: 'READ',
		ident: state.queryCode,
		dataJson: '',
	});
	state.timings.readMs = Date.now() - readStart;
	state.phase = 'interpret';
	const ok = read.parsed.xsuccess ?? read.parsed.status === 1;
	const source: X3QuerySource | undefined = ok
		? extractQuerySource({ ident: state.queryCode, data: read.parsed.dataJson })
		: undefined;
	if (!ok || !source) {
		const messages = x3Messages(read.parsed);
		throw new NodeOperationError(
			fns.getNode(),
			`Sage X3 could not return query ${state.queryCode}${messages.length ? `: ${messages.join(' | ')}` : ' (no CLBFL definition in the ALT record)'}`,
			{ itemIndex },
		);
	}

	// 2. Interpretation ------------------------------------------------------
	const rawMaxLines = options.maxLines;
	const maxLinesNumber = rawMaxLines === undefined || rawMaxLines === '' ? -1 : Number(rawMaxLines);
	const interpretOptions: InterpretOptions = {
		dialect: (options.dialect as SqlDialect | undefined) ?? 'mssql',
		columnAliases: (options.columnAliases as ColumnAliasMode | undefined) ?? 'label',
		includeHidden: Boolean(options.includeHidden),
		boundsAsParameters: params.execute || Boolean(options.boundsAsParameters),
		includeTableFields: Boolean(options.includeTableFields),
		// Translatable texts (ATEXTRA) and menu labels (APLSTD) come back in the
		// credential's language.
		language: connection.ctx.codeLang,
		localMenus: (options.localMenus as 'code' | 'label' | 'both' | undefined) ?? 'label',
	};
	const x3User = typeof options.x3User === 'string' ? options.x3User.trim() : '';
	if (x3User) interpretOptions.user = x3User;
	const schema = typeof options.schema === 'string' ? options.schema.trim() : '';
	if (schema) interpretOptions.schema = schema;
	if (Number.isFinite(maxLinesNumber) && maxLinesNumber >= 0)
		interpretOptions.maxLines = maxLinesNumber;

	const result = interpretX3Query(source, interpretOptions);
	if (!params.execute) return result as unknown as IDataObject;

	// 3. Bounds → SQL parameters ---------------------------------------------
	const { params: sqlParams, error } = resolveBounds(params.bounds, result.parameters);
	if (error) throw new NodeOperationError(fns.getNode(), error, { itemIndex });
	// Dropped [[ ... ]] clauses leave blank lines behind; remove them.
	const finalSql = applyQueryParameters(result.sql, sqlParams)
		.split('\n')
		.filter((line) => line.trim() !== '')
		.join('\n')
		.trim();

	// 4. Execution through XOBJECT='SQL' --------------------------------------
	const sqlCtx: IDataObject = {};
	const maxLines = result.maxLines;
	const maxTime = readPositiveNumber(options.maxTime);
	if (maxLines !== undefined) sqlCtx.max_lines = maxLines;
	if (maxTime !== undefined) sqlCtx.max_time = maxTime;
	const payload: IDataObject = { query: finalSql };
	if (Object.keys(sqlCtx).length > 0) payload.context = sqlCtx;

	state.phase = 'select';
	state.sql = finalSql;
	const selectStart = Date.now();
	const run = await callX3({
		object: 'SQL',
		action: 'SELECT',
		ident: '',
		dataJson: JSON.stringify(payload),
	});
	state.timings.selectMs = Date.now() - selectStart;

	const rowFormat = (options.rowFormat as 'arrays' | 'objects' | undefined) ?? 'objects';
	const simplified = buildSqlSimplifiedOutput(run.parsed, finalSql, rowFormat, maxLines);

	const output: IDataObject = {};
	if (result.code !== undefined) output.code = result.code;
	if (result.title !== undefined) output.title = result.title;
	if (simplified !== undefined) {
		Object.assign(output, simplified);
	} else {
		// Not row-shaped (an X3 error, usually): expose what X3 said.
		output.success = run.parsed.xsuccess ?? run.parsed.status === 1;
		output.status = run.parsed.status;
		if (run.parsed.dataJson !== undefined) output.data = run.parsed.dataJson as IDataObject;
		if (run.parsed.xmessages !== undefined) output.messages = run.parsed.xmessages as IDataObject;
		else if (run.parsed.soapMessages.length > 0) output.messages = run.parsed.soapMessages;
		if (run.parsed.xtrace !== undefined) output.trace = run.parsed.xtrace;
	}
	output.sql = finalSql;
	if (result.warnings.length > 0) output.warnings = result.warnings;
	if (options.includeStructure) Object.assign(output, structureOf(result));
	if (params.includeRequest) {
		const parsedInput = tryParseJson(run.inputXml);
		output.request = {
			url: connection.soapUrl,
			input: (parsedInput && typeof parsedInput === 'object'
				? deepParseJsonStrings(parsedInput)
				: run.inputXml) as IDataObject,
			envelope: run.envelope,
			timings: state.timings,
		};
	}
	return output;
}
