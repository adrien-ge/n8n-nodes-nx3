# Identifiers and transactions

- An identifier is the primary key of the object's main table, as shown by `x3_query_run` on the `x3_object_search` query in
  PRIMARY_KEY. One field -> one value (`SONFR0120099`). Several fields -> join the values with `~`
  in key order: `FIN311~NA021` for an item-site record (ITMREF then STOFCY), `SMDIV~FR0120104SMDIV000001`
  for a document numbered within a company.
- Identifiers are exact and case-sensitive. A partial number returns nothing, not an error: obtain
  it from `x3_object` with action `list` or a SQL query.
- Transactions (`transaction`) are entry layouts of documents. `ALL` is the usual complete
  layout for orders, deliveries, invoices and work orders. Master data (items, customers, suppliers,
  sites) has no transaction: leave it empty. When a user cites a transaction (FTIST, STD...), use it
  consistently for read and modify.
- Object codes are the same in every folder; identifiers, transactions and local menu labels depend
  on the folder.
