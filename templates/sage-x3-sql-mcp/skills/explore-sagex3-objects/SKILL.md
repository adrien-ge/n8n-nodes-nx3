---
name: explore-sagex3-objects
description: Explore and act on Sage X3 objects through the sagex3 MCP — find the object code behind a business notion, a function (GESSOH, GESITM) or a screen, describe its blocks and fields, list records to get an exact identifier, read one record, then create or modify with confirmation. Use when the user asks "which X3 object holds…", "what are the fields of…", "list the…", "read the record…", "create/modify a… in X3", or names an X3 function or screen.
---

# Explore Sage X3 objects

The sagex3 MCP exposes Sage X3 in two ways. **SQL queries** (`x3_customer_search`,
`x3_revenue_summary`, `x3_stock_available`, ... and the generic `x3_query_catalog` /
`x3_query_run`) answer questions about figures and lists: prefer them for anything analytical. The
**object tools** below act on one record of the X3 object layer and are the only way to write.

## The chain, always in this order

1. **Find the object** — `x3_query_run` on the `x3_object_search` query with `label_contains` (one significant word of the
   object, function or table label: `order`, `supplier`, `receipt`), or `function_code` (`GESSOH`),
   `object_code_starts` (`SO`), `main_table` (`SORDER`), `module` (5 Sales, 6 Purchasing, 7 Stock,
   8 Manufacturing, 9 Common data, 2 Financials). Add `with_function_only: true` to keep only objects
   that have a real screen. Read `OBJECT_CODE`, `MAIN_TABLE`, `PRIMARY_KEY`, `FUNCTION_CODE`.
   Skip the search when the code is obvious: ITM items, BPC customers, BPS suppliers, SOH sales
   orders, SQH quotes, SDH deliveries, SIH sales invoices, POH purchase orders, PTH receipts, PIH
   purchase invoices, MFG work orders, BOM bills of material.
2. **Describe it** — `x3_object` with action `describe` with the object code: screen blocks (`SOH0` header,
   `SOH4` lines...), fields (X3 codes without `_0`), local menus (integers, labels given), mandatory
   flags. Large answer: once per object, reuse it.
3. **List records** — `x3_object` with action `list` with `data` =
   `{"list_filters": "[F:SOH]BPCORD = 'FR001' & [F:SOH]ORDDAT >= [12/01/2025]"}` (`&` AND, `|` OR,
   strings quoted, dates `[DD/MM/YYYY]`, local menus as integers). Always filter. The identifier
   you need is in the key field of `data.values`.
4. **Read one record** — `x3_object` with action `read` with the exact identifier. Composite keys are joined with
   `~` in key order (`FIN311~NA021`). `transaction`: empty for master data, `ALL` for documents
   unless the user names one. Read with the transaction you will modify with.
5. **Write** — `x3_object_write` with action `create` or `modify`. Irreversible: recap the exact change, wait for an explicit go-ahead, use only field
   names from describe or read, check referenced codes exist (customers, items, sites). Payload by
   block, grid columns as index-aligned arrays, `"FIELD(2)"` to target one row on a modify, dates
   `YYYY-MM-DD`, numbers bare. Never send the document number on a create when X3 numbers it.

`x3_object_guide` with a `topic` (`overview`, `find_object`, `describe`, `list`, `read`, `create`,
`modify`, `identifiers`, `payload`, `errors`) returns the full instructions for each step; call it
when a detail is missing here.

## Reading errors

`success: false` with `messages` is X3 refusing the call, in the folder language: wrong or
incomplete identifier (confirm it with a list or a SQL query), guessed field or block name (take it
from describe), missing mandatory field (ask the user), business rule (customer blocked, item not
sold: report it, do not retry with another value), unknown transaction (`ALL` or empty). SQL
queries return `{ ok: false, error, message }`: `unknown_query`, `unknown_filter`, `invalid_value`,
`missing_required` are about your call and the message says how to fix it.

## Report

State which object and identifier you acted on, what you read or changed, and the identifier X3
assigned on a create. Quote labels, keep codes for the next call. Never present a guess as a value
read from X3.
