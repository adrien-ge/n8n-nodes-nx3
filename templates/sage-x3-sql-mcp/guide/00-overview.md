# Working with Sage X3 objects through this MCP

Sage X3 exposes its business data as **objects**: a 3-letter code (SOH sales orders, POH purchase
orders, ITM items, BPC customers, BPS suppliers, SIH sales invoices, PIH purchase invoices, MFG work
orders, BOM bills of material...). Every screen a user opens manages one object through a
**function** whose code is usually `GES` + the object code (GESSOH, GESITM).

Always follow this order; each step gives you what the next one needs:

1. `x3_query_run` on the `x3_object_search` query — turn a business notion, a function code or a screen label into the
   OBJECT_CODE, its MAIN_TABLE and PRIMARY_KEY. Skip it only when you already know the code.
2. `x3_object` with action `describe` — get the screen blocks (SOH0, SOH1, SOH2...), every field with its type,
   length, local menu and mandatory flag. Required before any create or modify, useful before a list.
3. `x3_object` with action `list` — list records of the object with a filter, to obtain exact identifiers.
4. `x3_object` with action `read` — read one record in full from its identifier.
5. `x3_object_write` with action `create` or `modify` — write. Only after an explicit confirmation from the
   user, and only with field names taken from describe or read, never invented.

For figures (stock, revenue, order lines, payment delays) prefer the SQL queries: they are faster,
cheaper in tokens and already aggregated. Objects are for reading one record in full, and for
writing.

Call `x3_object_guide` again with a topic for the details: find_object, describe, list, read,
create, modify, identifiers, payload, errors.
