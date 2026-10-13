# Reading one record (x3_object, action read)

`x3_object` with action `read` returns a complete record: every block and field of the object, with current
values. Parameters: `object`, `identifier`, optional `transaction`.

- The identifier is the primary key value, exact and complete (`SONFR0120099`, `FIN008`). Get it
  from `x3_object` with action `list` or a SQL query, never from memory.
- Composite keys are joined with `~` (see topic identifiers).
- Transactions: leave `transaction` empty for master data (ITM, BPC, BPS, FCY...). For
  documents (SOH, POH, SIH, PIH, MFG...) pass `ALL` unless the user names a specific transaction;
  the transaction decides which fields are visible. Before a modify, read with the **same**
  transaction you will modify with.
- The answer is organised by blocks, each field being an array even for a single value; grid
  blocks hold one array per column, aligned by index.

One record per call. To compare several records or to answer a question about a set, use a SQL
query instead.
