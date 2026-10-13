# Modifying a record (x3_object_write, action modify)

1. `x3_object` with action `read` the record first, with the transaction you will modify with: you need the
   current values, the exact field names and the line indexes.
2. Recap the change to the user (record, field, old value, new value) and wait for a clear
   confirmation.
3. Call `x3_object_write` (action `modify`) with `object`, the same `transaction`, the
   `identifier`, and a `data` holding **only the fields to change**, in their block.

Grid lines: target a specific row with the index in parentheses, `"QTY(2)": 15` changes the second
line; a bare array replaces the column from the first row. Never send a whole block back unchanged,
X3 revalidates everything you send.

Some fields are not modifiable once the record exists (document numbers, posted amounts, a customer
code): the response says so. Report it rather than working around it.
