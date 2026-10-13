// Local checks that need no n8n: catalogue validity, SQL composition, Resolve behaviour.
import { loadCatalog, readRunnerSource } from '../lib.mjs';
import { strict as assert } from 'node:assert';

const catalog = loadCatalog();
const source = readRunnerSource('resolve.js', catalog);

function runResolve(input) {
  const $input = { first: () => ({ json: input }) };
  const fn = new Function('$input', source);
  return fn($input)[0].json;
}

let n = 0;
function check(name, f) { f(); n++; console.log('ok -', name); }

check('catalogue lists every query', () => {
  const r = runResolve({ action: 'catalog' });
  assert.equal(r.ok, true); assert.equal(r.count, catalog.queries.length);
});
check('catalogue filters by group', () => {
  const r = runResolve({ action: 'catalog', params: { group: 'stock' } });
  assert.equal(r.count, catalog.queries.filter((q) => q.group === 'stock').length);
});
check('unknown query is a structured error', () => {
  const r = runResolve({ action: 'run', query: 'nope' });
  assert.equal(r.ok, false); assert.equal(r.error, 'unknown_query'); assert.ok(r.available.length > 10);
});
check('unknown filter lists the valid ones', () => {
  const r = runResolve({ action: 'run', query: 'x3_customer_search', params: { bogus: 1 } });
  assert.equal(r.error, 'unknown_filter'); assert.ok(r.valid_filters.includes('category'));
});
check('invalid date is refused before X3', () => {
  const r = runResolve({ action: 'run', query: 'x3_stock_movements', params: { date_from: '01/01/2025' } });
  assert.equal(r.error, 'invalid_value'); assert.match(r.message, /YYYY-MM-DD/);
});
check('required level enforced on revenue_summary', () => {
  const r = runResolve({ action: 'run', query: 'x3_revenue_summary', params: { date_from: '2025-01-01', date_to: '2025-12-31' } });
  assert.equal(r.error, 'missing_required'); assert.match(r.message, /level/);
});
check('quotes and % are stripped, params JSON string accepted, keys case-insensitive', () => {
  const r = runResolve({ action: 'run', query: 'x3_item_search', params: JSON.stringify({ Description: "'%bike%'", Category: ['FINIS', 'SFINI'] }) });
  assert.equal(r.ok, true);
  assert.equal(r.params_used.description, 'bike');
  assert.equal(r.params_used.category, 'FINIS,SFINI');
  assert.ok(r.sqlParams.some((p) => p.name === 'lang' && p.value === 'ENG'));
  assert.ok(r.sqlQuery.includes('[[AND (UPPER(ITM.ITMDES1_0) LIKE UPPER({{description}})'));
  assert.ok(!r.sqlQuery.includes('/*FILTERS'));
});
check('max_rows is capped and defaulted', () => {
  assert.equal(runResolve({ action: 'run', query: 'x3_customer_search', max_rows: 999999 }).maxLines, catalog.settings.hard_max_rows);
  assert.equal(runResolve({ action: 'run', query: 'x3_customer_search' }).maxLines, 200);
  assert.equal(runResolve({ action: 'run', query: 'x3_customer_search', max_rows: '7' }).maxLines, 7);
});
check('boolean filters normalise to 1/0', () => {
  const r = runResolve({ action: 'run', query: 'x3_stock_available', params: { only_in_stock: true, item: 'FIN008' } });
  assert.equal(r.params_used.only_in_stock, '1');
});
check('every query composes with all markers consumed and slots placed', () => {
  for (const q of catalog.queries) {
    const params = {};
    for (const f of q.filters) params[f.name] = { list: 'X', contains: 'x', number: '1', date: '2025-01-01', boolean: '1', text: 'X' }[f.type];
    const r = runResolve({ action: 'analyse', query: q.name, params });
    assert.equal(r.ok, true, `${q.name}: ${r.message}`);
    assert.ok(!r.sqlQuery.includes('/*FILTERS'), `${q.name}: marker left`);
    for (const f of q.filters) assert.ok(r.sqlQuery.includes(`{{${f.name}}}`), `${q.name}: ${f.name} not placed`);
    assert.equal(r.sqlParams.length, q.filters.length + 1);
  }
});
console.log(`\n${n} local checks passed, ${catalog.queries.length} queries, ${catalog.queries.reduce((a, q) => a + q.filters.length, 0)} filters`);
