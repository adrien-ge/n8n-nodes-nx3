// Code node "Shape the object response" of the X3 Object Runner (run once for all items).
// Receives the Validate item (errors, routed straight here) or the envelope of a Sage X3 node.

function shape() {
  const meta = $('Validate the object call').first().json;
  const item = $input.first() ? $input.first().json : {};
  if (meta && meta.ok === false) return meta;

  const out = { ok: true, action: meta.action, object: meta.object, transaction: meta.transaction || '', identifier: meta.identifier || '' };

  if (item && item.error !== undefined && item.success === undefined) {
    return Object.assign(out, { ok: false, error: 'transport_error', message: typeof item.error === 'string' ? item.error : JSON.stringify(item.error), http_status: item.httpStatus });
  }
  const messages = Array.isArray(item.messages) ? item.messages.filter((m) => m && typeof m === 'object' ? Object.keys(m).some((k) => k !== 'trace') : !!m) : [];
  if (item.success === false) {
    const text = messages.map((m) => (typeof m === 'string' ? m : m.error || m.message || JSON.stringify(m))).join(' | ');
    return Object.assign(out, { ok: false, error: 'x3_error', message: text || 'Sage X3 refused the call', trace: item.trace, hint: 'Read the message: wrong identifier, guessed field name, missing mandatory field or business rule. Fix the call before retrying; never retry a write without asking.' });
  }
  out.data = item.data === undefined ? null : item.data;
  if (messages.length) out.messages = messages;
  if (item.ident) out.identifier = out.identifier || item.ident;
  if (meta.action === 'create' || meta.action === 'modify') out.note = 'The write went through. The identifier assigned by Sage X3, if any, is in messages or identifier.';
  if (meta.action === 'list') out.note = 'data.fields names the positions, data.values holds one array per record; the key field gives the identifier for a read.';
  return out;
}

function main() {
  return [{ json: shape() }];
}
