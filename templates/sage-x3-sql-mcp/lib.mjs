// Shared helpers for build.mjs and the local tests: load the catalogue, inline the SQL files,
// validate everything a maintainer could get wrong, and expose the Code-node sources.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
const TYPES = ['boolean', 'contains', 'date', 'list', 'number', 'text'];
const NAME_RE = /^[A-Za-z0-9_]+$/;
const WRITE_RE = /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|TRUNCATE|GRANT|CREATE|INTO|BULK|OPENROWSET|XP_|SP_)\b/i;

/** Blank out comments and string literals so keyword checks only look at executable SQL. */
export function maskNonCode(sql) {
  let out = '';
  let i = 0;
  let depth = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (depth > 0) {
      if (c === '/' && n === '*') { depth++; out += '  '; i += 2; continue; }
      if (c === '*' && n === '/') { depth--; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { depth = 1; out += '  '; i += 2; continue; }
    if (c === "'" || c === '"') {
      out += ' '; i++;
      while (i < sql.length) {
        if (sql[i] === c) { if (sql[i + 1] === c) { out += '  '; i += 2; continue; } out += ' '; i++; break; }
        out += sql[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function fail(errors, msg) { errors.push(msg); }

export function loadCatalog() {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
  const errors = [];
  const seen = new Set();
  for (const q of catalog.queries) {
    const where = `query ${q.name || '(unnamed)'}`;
    if (!q.name || !NAME_RE.test(q.name)) fail(errors, `${where}: invalid name`);
    if (seen.has(q.name)) fail(errors, `${where}: duplicate name`);
    seen.add(q.name);
    if (!catalog.groups[q.group]) fail(errors, `${where}: unknown group "${q.group}"`);
    for (const field of ['purpose', 'returns']) if (!q[field]) fail(errors, `${where}: missing ${field}`);
    const sqlPath = join(ROOT, 'sql', `${q.name}.sql`);
    if (!existsSync(sqlPath)) { fail(errors, `${where}: missing sql/${q.name}.sql`); continue; }
    q.sql = readFileSync(sqlPath, 'utf8').trim();
    const code = maskNonCode(q.sql);
    if (!/^\s*SELECT\b/i.test(code)) fail(errors, `${where}: SQL must start with SELECT`);
    if (code.includes(';')) fail(errors, `${where}: SQL must not contain ;`);
    const bad = code.match(WRITE_RE);
    if (bad) fail(errors, `${where}: forbidden keyword ${bad[0]} in SQL`);
    const markers = new Set();
    for (const m of q.sql.matchAll(/\/\*FILTERS(?::([A-Za-z0-9_]+))?\*\//g)) markers.add(m[1] || 'main');
    const fnames = new Set();
    for (const f of q.filters || []) {
      const fw = `${where}, filter ${f.name}`;
      if (!f.name || !NAME_RE.test(f.name)) fail(errors, `${fw}: invalid filter name`);
      if (fnames.has(f.name)) fail(errors, `${fw}: duplicate filter`);
      fnames.add(f.name);
      if (f.name === 'lang') fail(errors, `${fw}: lang is reserved`);
      if (!TYPES.includes(f.type)) fail(errors, `${fw}: unknown type ${f.type}`);
      if (!f.description) fail(errors, `${fw}: missing description`);
      const clauses = f.clauses || { [f.slot || 'main']: f.clause };
      for (const [slot, clause] of Object.entries(clauses)) {
        if (!clause) { fail(errors, `${fw}: empty clause for slot ${slot}`); continue; }
        if (!markers.has(slot)) fail(errors, `${fw}: slot ${slot} has no /*FILTERS:${slot}*/ marker in the SQL`);
        const refs = [...clause.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((m) => m[1]);
        if (!refs.includes(f.name)) fail(errors, `${fw}: clause does not reference {{${f.name}}}`);
        for (const r of refs) if (r !== f.name && r !== 'lang') fail(errors, `${fw}: clause references unknown {{${r}}}`);
        if (/;/.test(clause) || WRITE_RE.test(maskNonCode(clause))) fail(errors, `${fw}: unsafe clause`);
      }
    }
    // {{names}} used in the base SQL must be lang only (filters bring their own markers).
    for (const m of code.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
      if (m[1] !== 'lang') fail(errors, `${where}: base SQL references {{${m[1]}}}; only {{lang}} is allowed there`);
    }
    if (!markers.has('main') && (q.filters || []).some((f) => !f.slot && !f.clauses)) fail(errors, `${where}: no /*FILTERS*/ marker`);
    if ((q.max_rows || 0) > catalog.settings.hard_max_rows) fail(errors, `${where}: max_rows above hard_max_rows`);
  }
  if (errors.length) throw new Error('Catalogue validation failed:\n - ' + errors.join('\n - '));
  return catalog;
}

/** Catalogue as embedded by the runner: SQL inlined, no editorial fields the runtime does not need. */
export function runtimeCatalog(catalog) {
  return {
    settings: catalog.settings,
    groups: catalog.groups,
    queries: catalog.queries.map((q) => ({
      name: q.name, group: q.group, purpose: q.purpose, returns: q.returns, notes: q.notes || '',
      max_rows: q.max_rows, max_time: q.max_time, sql: q.sql,
      filters: q.filters.map((f) => ({ name: f.name, type: f.type, required: !!f.required, description: f.description, slot: f.slot, clause: f.clause, clauses: f.clauses })),
    })),
  };
}

export function readRunnerSource(name, catalog) {
  const src = readFileSync(join(ROOT, 'runner', name), 'utf8');
  const header = `const CATALOG = ${JSON.stringify(runtimeCatalog(catalog))};\nconst CATALOG_HARD_MAX = ${catalog.settings.hard_max_rows};\n`;
  // The sources are valid standalone JS (no top-level return); the Code node needs the call.
  return header + src + '\nreturn main();\n';
}

export function readGuide() {
  const dir = join(ROOT, 'guide');
  const topics = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    topics[f.replace(/^\d+-/, '').replace(/\.md$/, '')] = readFileSync(join(dir, f), 'utf8').trim();
  }
  return topics;
}
