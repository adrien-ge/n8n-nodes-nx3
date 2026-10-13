# Listing records (x3_object, action list)

`x3_object` with action `list` returns the records of an object as the left list of the X3 screen would show them:
a few key columns per record, positionally. Parameters: `object`, optional
`transaction`, and `data` holding the filter.

Filter syntax (`list_filters`): an X3 expression on the main table, written with the file
abbreviation in brackets and the field codes **without** `_0`:

```json
{ "list_filters": "[F:SOH]BPCORD = 'FR001' & [F:SOH]ORDDAT >= [12/01/2025]" }
```

- `&` is AND, `|` is OR, strings in single quotes, dates between square brackets as `[DD/MM/YYYY]`
  (folder format), numbers bare, local menus as integers.
- The abbreviation is the table abbreviation shown by `x3_query_run` on the `x3_object_search` query (MAIN_TABLE SORDER has
  abbreviation SOH, ITMMASTER has ITM, BPCUSTOMER has BPC). When unsure, use `[F:XXX]` with the
  object code: it is almost always the same.
- Without `list_filters` the list is the whole table, capped by X3: always filter.

Reading the result: `data.values` holds one array per record and `data.fields` names the positions;
`data.count` tells how many came back. The identifier you need for `x3_object` with action `read` is in the key
field(s) (SOHNUM for SOH, ITMREF for ITM): take it from here rather than guessing.

Prefer a SQL query through `x3_query_run` (`x3_sales_order_lines`, `x3_item_search`, `x3_customer_search`...) when the
question is a search with several criteria or needs labels and amounts: the list is for finding an
identifier, not for analysis.
