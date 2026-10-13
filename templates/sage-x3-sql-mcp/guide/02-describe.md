# Describing an object (x3_object, action describe)

`x3_object` with action `describe` returns the structure of an object: its screen blocks, each field with its
code, type, length, local menu number and whether it is mandatory, and the values of the local menus
involved. Parameter: `object` only. The answer is large: call it once per object and
reuse it.

What to look for:
- **Blocks** are named after the object plus a digit: SOH0 is the header, SOH1 and SOH2 are
  secondary header tabs, the lines are usually in the last block (SOH4 for sales order lines,
  ITM0 and ITM1 for an item). The JSON of create and modify is organised by these blocks.
- **Fields** keep their X3 code without the `_0` suffix of the database columns: `BPCORD`, not
  `BPCORD_0`. Table columns and object fields are two different namings of the same data.
- **Local menus** are integer codes whose labels the description gives you: send the integer, show
  the label. Yes/No fields are local menu 1 (1 = No, 2 = Yes).
- **Mandatory** fields must be present in a create. A field the description does not list cannot be
  written through the object.

When to call it:
- always before `x3_object_write` (action `create`) on an object you have not created in this conversation;
- before `x3_object_write` (action `modify`) when `x3_object` with action `read` did not show the field you want to change;
- when the user asks what information an object holds.
