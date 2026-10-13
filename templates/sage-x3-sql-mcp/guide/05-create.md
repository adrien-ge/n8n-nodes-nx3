# Creating a record (x3_object_write, action create)

Writing into the ERP is irreversible. Before calling `x3_object_write` (action `create`):

1. Recap to the user exactly what will be created (object, key fields, lines) and wait for an
   explicit go-ahead. Do not infer it.
2. Call `x3_object` with action `describe` on the object, or reuse a description from this conversation, so every
   field name comes from X3 and mandatory fields are covered.
3. Check the references you will use exist: customer with `x3_customer_search`, items with
   `x3_item_search`, supplier with `x3_object` with action `list` on BPS.

Call: `object`, `transaction` (`ALL` for documents, empty for master data),
`identifier` (empty when X3 numbers the record itself, as for orders; the code when the user gives
it, as for an item or a customer), `data` (see topic payload).

After the call: the response carries the created record and, in the messages, the identifier X3
assigned. Quote it to the user. A `success: false` with messages means nothing was created: read the
messages, fix the payload, ask the user before retrying.

