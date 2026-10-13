# Reading errors

Object tools return `success: false` with `messages` when X3 refuses the call. The message is the
one the user would see on screen, in the folder language. Frequent cases:

- "Record does not exist" / identifier errors: the key is wrong or incomplete. Confirm it with
  `x3_object` with action `list` or a SQL query; check the `~` composition for composite keys.
- "Field does not exist" / "Invalid block": a name was guessed. Take it from `x3_object` with action `describe`.
- "Mandatory field": the description marks it as required; ask the user for the value rather than
  defaulting it.
- Value refused (customer blocked, item not sold, site not allowed for the user): a business rule.
  Report it as is; do not retry with another value without asking.
- "Transaction unknown": use `ALL` for documents, empty for master data.
- Timeout or connection errors: the X3 web service pool is busy or down. Say so, suggest retrying,
  do not conclude anything about the data.

SQL queries return `{ ok: false, error, message }` instead: `unknown_query`, `unknown_filter`,
`invalid_value`, `missing_required` are about the call (fix the parameters, the message tells you
how); `x3_error` and `transport_error` come from Sage X3 itself.
