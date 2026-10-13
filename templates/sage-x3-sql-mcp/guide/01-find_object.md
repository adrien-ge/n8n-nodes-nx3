# Finding the right object (x3_object_search)

Use `x3_query_run` on the `x3_object_search` query when the user names a thing (customers, purchase receipts, bills of material,
work orders, price lists) or a screen or function (GESITM, "Products", "Order management") and you
need the object code.

Filters, all optional, combined with AND:
- `label_contains` — a word of the object, function or table label, in the folder language
  (`order`, `supplier`, `invoice`, `receipt`). Prefer a single significant word.
- `function_code` — exact function codes (`GESSOH`, `GESITM`).
- `object_code` — exact codes, or `object_code_starts` for a prefix (`SO` lists SOH, SOQ, SOV...).
- `main_table` — table names (`SORDER`, `ITMMASTER`) when the user talks in table terms.
- `module` — 1 Supervisor, 2 Financials, 3 A/P-A/R accounting, 5 Sales, 6 Purchasing, 7 Stock,
  8 Manufacturing, 9 Common data, 11 Sage X3 internal, 13 CRM, 14 Fixed assets.
- `with_function_only: true` — keep only objects that have a GESxxx management function, that is a
  real screen a user opens. Use it to cut the noise of technical objects.

Reading the result:
- OBJECT_CODE is what every object tool takes as `object`.
- MAIN_TABLE and PRIMARY_KEY tell you how records are identified (SOH -> SORDER, key SOHNUM).
  A key made of several fields means a composite identifier (see topic identifiers).
- FUNCTION_CODE empty means the object has no dedicated screen: it is managed from another object
  (lines of a document, for example). Look for the parent object instead.
- Several candidates? Prefer the one whose MODULE matches the user's domain and that has a
  FUNCTION_CODE. Say which one you picked and why.

Common codes, to avoid a search when the mapping is obvious: ITM items, BPC customers, BPS
suppliers, BPR business partners, SOH sales orders, SQH sales quotes, SDH sales deliveries, SIH sales
invoices, POH purchase orders, PTH purchase receipts, PIH purchase invoices, MFG work orders, BOM
bills of material, FCY sites, CPY companies, AUS users.
