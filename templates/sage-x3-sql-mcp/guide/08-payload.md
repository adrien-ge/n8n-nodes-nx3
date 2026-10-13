# The JSON payload of create and modify

The payload is a JSON object keyed by screen block, each block holding fields:

```json
{
  "SOH0": { "BPCORD": "FR001", "SALFCY": "FR011", "SOHTYP": "SON", "CUSORDREF": "PO-4521" },
  "SOH2": { "STOFCY": "FR011" },
  "SOH4": {
    "ITMREF":     ["FIN008", "FIN006"],
    "QTY":        [10, 4],
    "DDEMDLVDAT": ["2026-11-15", "2026-11-15"]
  }
}
```

Rules:
- Block and field names come from `x3_object` with action `describe` or `x3_object` with action `read`, exactly as spelled, no
  `_0` suffix.
- Every X3 field is dimensioned: a grid column is an array aligned by index with the other columns
  of the same block (first item, first quantity, first date). A scalar is accepted for a single value.
- `"FIELD(3)": value` targets the third row only, useful for a modify.
- Dates are `YYYY-MM-DD`. Local menus are integers. Numbers are bare, not quoted strings. Codes
  (customer, item, site) are strings.
- Do not send the record number on a create when X3 numbers it (orders, deliveries, invoices).
- Do not invent fields: a field absent from the description is rejected or ignored.
