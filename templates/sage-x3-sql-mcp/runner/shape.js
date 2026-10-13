// Code node "Shape the response" (run once for all items).
// Receives either the Resolve item (error or catalogue, routed straight here) or the SQL node output.
// Produces one stable object for the agent and the MCP client.

function shape() {
  const meta = $('Resolve query and validate params').first().json;
  const item = $input.first() ? $input.first().json : {};

  if (meta && meta.ok === false) return meta;
  if (meta && meta.mode === 'catalog') return meta;

  const out = {
    ok: true,
    query: meta.query,
    mode: meta.mode,
    params_used: meta.params_used || {},
    max_rows: meta.maxLines,
  };

  // Continue-on-fail item from the SQL node: transport or HTTP failure.
  if (item && item.error !== undefined && item.rowCount === undefined && item.success === undefined) {
    return Object.assign(out, {
      ok: false,
      error: 'transport_error',
      message: typeof item.error === 'string' ? item.error : JSON.stringify(item.error),
      http_status: item.httpStatus,
    });
  }

  // Sage X3 refused or failed the statement.
  if (item && item.success === false) {
    const messages = Array.isArray(item.messages) ? item.messages : [];
    const text = messages.map((m) => (typeof m === 'string' ? m : m.error || m.message || JSON.stringify(m))).join(' | ');
    return Object.assign(out, { ok: false, error: 'x3_error', message: text || 'Sage X3 returned an error', trace: item.trace });
  }

  if (meta.mode === 'analyse') {
    return Object.assign(out, { valid: true, message: 'The query compiles on this folder with every filter applied.' });
  }

  const rowCount = typeof item.rowCount === 'number' ? item.rowCount : Array.isArray(item.rows) ? item.rows.length : 0;
  const truncated = item.truncated === true || (meta.maxLines > 0 && rowCount >= meta.maxLines);
  const warnings = [];
  if (truncated) warnings.push(`Result truncated at ${meta.maxLines} rows: narrow the filters or raise max_rows (hard cap ${CATALOG_HARD_MAX}).`);
  if (rowCount === 0) warnings.push('No row matched: check the codes with the reference queries before concluding there is no data.');
  return Object.assign(out, {
    rowCount,
    truncated,
    columns: item.columns || [],
    rows: item.rows || [],
    warnings,
  });
}

function main() {
  return [{ json: shape() }];
}
