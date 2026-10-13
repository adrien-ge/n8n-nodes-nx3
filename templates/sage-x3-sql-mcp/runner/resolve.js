// Code node "Resolve query and validate params" (run once for all items).
// The build script prepends `const CATALOG = {...};` from catalog.json.
// Input item (from the Execute Workflow Trigger): { action, query, params, max_rows }.
// Output item: { ok, mode, ... } consumed by the Switch and the SQL nodes.

const TYPES = ['boolean', 'contains', 'date', 'list', 'number', 'text'];

function error(code, message, extra) {
  return Object.assign({ ok: false, error: code, message }, extra || {});
}

function normalizeKey(k) {
  return String(k || '').trim().toLowerCase();
}

// Accepts an object, a JSON string, or nothing. Keys are matched case-insensitively.
function parseParams(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '' || text === '{}' || text === 'null') return {};
    try { value = JSON.parse(text); } catch (e) { return { __invalid: 'params is not valid JSON: ' + text.slice(0, 120) }; }
  }
  if (Array.isArray(value)) return { __invalid: 'params must be an object {filter: value}, not an array' };
  if (typeof value !== 'object') return { __invalid: 'params must be an object {filter: value}' };
  return value;
}

// The model sometimes wraps values in quotes or % despite the instructions: undo it.
function cleanValue(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(cleanValue).filter((x) => x !== '').join(',');
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return JSON.stringify(v);
  let s = String(v).trim();
  if (s.length >= 2 && ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"'))) {
    s = s.slice(1, -1).trim();
  }
  if (s.length >= 2 && s[0] === '%' && s[s.length - 1] === '%') s = s.slice(1, -1).trim();
  return s;
}

function validateValue(filter, value) {
  switch (filter.type) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(value)) return `expected a number, got "${value}"`;
      return null;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `expected a date formatted YYYY-MM-DD, got "${value}"`;
      if (isNaN(Date.parse(value))) return `"${value}" is not a valid calendar date`;
      return null;
    case 'boolean':
      if (!/^(true|false|1|0|yes|no|y|n|on|off)$/i.test(value)) return `expected true or false, got "${value}"`;
      return null;
    case 'list': {
      const items = value.split(',').map((x) => x.trim()).filter((x) => x !== '');
      if (items.length === 0) return 'expected at least one value';
      return null;
    }
    default:
      return null;
  }
}

function normalizeBoolean(value) {
  return /^(true|1|yes|y|on)$/i.test(value) ? '1' : '0';
}

function slotsOf(filter) {
  if (filter.clauses && typeof filter.clauses === 'object') return filter.clauses;
  return { [filter.slot || 'main']: filter.clause };
}

// Insert every filter as an optional [[ clause ]] block at its /*FILTERS*/ or /*FILTERS:slot*/ marker.
function composeSql(query) {
  const bySlot = {};
  for (const f of query.filters) {
    for (const [slot, clause] of Object.entries(slotsOf(f))) {
      (bySlot[slot] = bySlot[slot] || []).push('[[' + clause + ']]');
    }
  }
  let sql = query.sql;
  const seen = new Set();
  sql = sql.replace(/\/\*FILTERS(?::([A-Za-z0-9_]+))?\*\//g, (m, slot) => {
    const key = slot || 'main';
    seen.add(key);
    return (bySlot[key] || []).join('\n');
  });
  const missing = Object.keys(bySlot).filter((s) => !seen.has(s));
  if (missing.length) throw new Error(`catalogue error on ${query.name}: no marker for slot(s) ${missing.join(', ')}`);
  return sql;
}

function describeQuery(q) {
  return {
    name: q.name,
    group: q.group,
    purpose: q.purpose,
    returns: q.returns,
    notes: q.notes || undefined,
    max_rows: q.max_rows || CATALOG.settings.default_max_rows,
    filters: q.filters.map((f) => ({ name: f.name, type: f.type, required: !!f.required, description: f.description })),
  };
}

function catalog(params) {
  const group = normalizeKey(params.group);
  const name = normalizeKey(params.name || params.query);
  let list = CATALOG.queries;
  if (group) list = list.filter((q) => q.group === group);
  if (name) list = list.filter((q) => q.name.toLowerCase().includes(name));
  return {
    ok: true,
    mode: 'catalog',
    count: list.length,
    groups: CATALOG.groups,
    queries: list.map(describeQuery),
    how_to_call: 'x3_query_run with query = <name> and params = {filter: value}. Lists are comma separated (FR001,FR002), dates YYYY-MM-DD, no quotes, no % signs.',
  };
}

function resolve(input) {
  const action = normalizeKey(input.action) || 'run';
  const paramsRaw = parseParams(input.params);
  if (paramsRaw.__invalid) return error('invalid_params', paramsRaw.__invalid);

  if (action === 'catalog') return catalog(paramsRaw);
  if (action !== 'run' && action !== 'analyse') {
    return error('unknown_action', `action must be run, analyse or catalog, got "${input.action}"`);
  }

  const queryName = normalizeKey(input.query || paramsRaw.query);
  const query = CATALOG.queries.find((q) => q.name.toLowerCase() === queryName);
  if (!query) {
    return error('unknown_query', `No query named "${input.query}" in the catalogue.`, {
      hint: 'Call x3_query_catalog to list the queries and their filters.',
      available: CATALOG.queries.map((q) => q.name),
    });
  }

  const byKey = new Map(query.filters.map((f) => [f.name.toLowerCase(), f]));
  const used = {};
  const unknown = [];
  const invalid = [];
  for (const [rawKey, rawValue] of Object.entries(paramsRaw)) {
    const key = normalizeKey(rawKey);
    if (key === 'query' || key === 'action' || key === 'max_rows') continue;
    const filter = byKey.get(key);
    if (!filter) { unknown.push(rawKey); continue; }
    let value = cleanValue(rawValue);
    if (value === '') continue;
    const problem = validateValue(filter, value);
    if (problem) { invalid.push(`${filter.name}: ${problem}`); continue; }
    if (filter.type === 'boolean') value = normalizeBoolean(value);
    used[filter.name] = value;
  }
  if (unknown.length) {
    return error('unknown_filter', `Unknown filter(s) for ${query.name}: ${unknown.join(', ')}.`, {
      valid_filters: query.filters.map((f) => f.name),
    });
  }
  if (invalid.length) return error('invalid_value', invalid.join(' | '));
  const missing = query.filters.filter((f) => f.required && !(f.name in used)).map((f) => f.name);
  if (missing.length) {
    return error('missing_required', `${query.name} requires: ${missing.join(', ')}.`, {
      required_filters: query.filters.filter((f) => f.required).map((f) => ({ name: f.name, description: f.description })),
    });
  }

  const s = CATALOG.settings;
  const requested = Number(input.max_rows ?? paramsRaw.max_rows);
  const base = query.max_rows || s.default_max_rows;
  const maxLines = Math.min(Number.isFinite(requested) && requested > 0 ? requested : base, s.hard_max_rows);
  const maxTime = query.max_time || s.default_max_time;

  const sqlParams = query.filters.map((f) => ({ name: f.name, type: f.type, value: used[f.name] ?? '' }));
  sqlParams.push({ name: 'lang', type: 'text', value: s.lang });

  return {
    ok: true,
    mode: action,
    query: query.name,
    group: query.group,
    sqlQuery: composeSql(query),
    sqlParams,
    maxLines,
    maxTime,
    requestTimeout: maxTime + (s.request_timeout_margin || 10),
    params_used: used,
    notes: query.notes || '',
  };
}

function main() {
  const first = $input.first();
  return [{ json: resolve(first ? first.json : {}) }];
}
