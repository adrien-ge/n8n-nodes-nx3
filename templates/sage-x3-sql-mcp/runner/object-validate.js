// Code node "Validate the object call" of the X3 Object Runner (run once for all items).
// Input: { action, object, transaction, identifier, data, allow_write }.
// Output: { ok, action, object, transaction, identifier, data } or { ok: false, error, message }.

const READ_ACTIONS = ['describe', 'list', 'read'];
const WRITE_ACTIONS = ['create', 'modify'];

function error(code, message, extra) {
  return Object.assign({ ok: false, error: code, message }, extra || {});
}

function parseData(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '' || text === 'null') return {};
    try { return JSON.parse(text); } catch (e) { return { __invalid: 'data is not valid JSON: ' + text.slice(0, 120) }; }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { __invalid: 'data must be a JSON object keyed by screen block' };
  return raw;
}

function validate(input) {
  const action = String(input.action || '').trim().toLowerCase();
  const allowWrite = input.allow_write === true || String(input.allow_write).toLowerCase() === 'true';
  if (!READ_ACTIONS.includes(action) && !WRITE_ACTIONS.includes(action)) {
    return error('unknown_action', `action must be one of ${[...READ_ACTIONS, ...WRITE_ACTIONS].join(', ')}, got "${input.action}"`);
  }
  if (WRITE_ACTIONS.includes(action) && !allowWrite) {
    return error('write_not_allowed', `${action} is a write action: call x3_object_write, after the user confirmed the change.`);
  }
  const object = String(input.object || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,11}$/.test(object)) {
    return error('invalid_object', `object must be a Sage X3 object code such as SOH, ITM or BPC, got "${input.object}". Find it with x3_query_run on x3_object_search.`);
  }
  const transaction = String(input.transaction || '').trim();
  const identifier = String(input.identifier || '').trim();
  const data = parseData(input.data);
  if (data.__invalid) return error('invalid_data', data.__invalid);
  if ((action === 'read' || action === 'modify') && !identifier) {
    return error('missing_identifier', `${action} needs the exact identifier of the record (composite keys joined with ~). Get it from a list or a SQL query.`);
  }
  if ((action === 'create' || action === 'modify') && Object.keys(data).length === 0) {
    return error('missing_data', `${action} needs a data payload keyed by screen block, with field names from describe.`);
  }
  return { ok: true, action, object, transaction, identifier, data };
}

function main() {
  const first = $input.first();
  return [{ json: validate(first ? first.json : {}) }];
}
