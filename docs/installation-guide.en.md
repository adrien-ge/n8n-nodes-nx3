# n8n-nodes-nx3 — Sage X3 integration for n8n

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-FF6D5A)](https://docs.n8n.io/integrations/community-nodes/)

[🇫🇷 Français](installation-guide.fr.md) · **🇬🇧 English** · [Node technical reference](../README.md)

> **nX3 by IntellX** community node — orchestrate your **Sage X3** objects and processes straight from [n8n](https://n8n.io), through the **ChatX3** gateway.

This node reproduces the behaviour of an X3 user (read, list, create, modify objects) over Sage X3 SOAP web services, fully honouring the rights of the associated Syracuse user and folder.

---

## Table of contents

- [Overview](#overview)
- [Requirements](#requirements)
- [1. Installation](#1-installation)
  - [1.1 ChatX3 patch](#11-chatx3-patch)
  - [1.2 Web services pool](#12-web-services-pool)
  - [1.3 X3 server → ChatX3 connectivity](#13-x3-server--chatx3-connectivity)
  - [1.4 Syracuse user rights](#14-syracuse-user-rights)
  - [1.5 X3 user web services right](#15-x3-user-web-services-right)
  - [1.6 Installing the package in n8n](#16-installing-the-package-in-n8n)
- [2. Usage](#2-usage)
  - [General information](#general-information)
  - [Expected formats](#expected-formats)
  - [Returned information](#returned-information)
  - [Technical behaviour](#technical-behaviour)
- [3. Available actions](#3-available-actions)
  - [READ — Read an object](#read--read-an-object)
  - [LIST — List objects](#list--list-objects)
  - [CREATE — Create an object](#create--create-an-object)
  - [MODIFY — Modify an object](#modify--modify-an-object)
- [Support](#support)

---

## Overview

Data flows run **directly between your n8n instance and your Sage X3 environment**. The ChatX3 gateway is used for license control only: **no data and no credentials are ever stored or routed through ChatX3**.

| Feature | Detail |
|---------|--------|
| npm package | `n8n-nodes-nx3` |
| n8n node | **nX3 by IntellX** |
| Protocol | Sage X3 SOAP web services (Syracuse) |
| Scope | **Standard, vertical and specific** objects and processes |
| Security | Syracuse user and folder rights strictly enforced |

---

## Requirements

Before you begin, make sure the following conditions are met:

- [ ] The **ChatX3 patch** is installed on the X3 folder ([§1.1](#11-chatx3-patch))
- [ ] A **web services pool** is created, started and reachable from n8n ([§1.2](#12-web-services-pool))
- [ ] The X3 Runtime server can **reach the ChatX3 license URL** ([§1.3](#13-x3-server--chatx3-connectivity))
- [ ] The Syracuse user has the `statusAndUsage > Read` right ([§1.4](#14-syracuse-user-rights))
- [ ] The folder's X3 user has the **Web services connection** right ([§1.5](#15-x3-user-web-services-right))
- [ ] The `n8n-nodes-nx3` package is installed on the n8n instance ([§1.6](#16-installing-the-package-in-n8n))

---

## 1. Installation

### 1.1 ChatX3 patch

1. Download the ChatX3 patch: **[📥 Download the ChatX3 patch](https://intellx.chat/)** <!-- TODO: replace with the real URL -->
2. In Sage X3, open **Development > Utilities > Patches > Patch integration (PATCH)**.
3. Reproduce exactly the checkboxes shown in the screenshot below, then run the integration.

> **Path:** `All > Development > Utilities > Patches`

![ChatX3 patch integration screen in Sage X3](images/1_param_patch_chatx3.png)

> [!TIP]
> Run the integration on a test environment first, and keep a backup of the folder before any operation.

---

### 1.2 Web services pool

The web services pool must be **reachable publicly or from the n8n instance**.

**a.** Check that there is **at least one SOAP child process** on the Syracuse web server:

![SOAP child process configuration on Syracuse](images/3_Syracuse_SOAP.png)

**b.** Create and start a **web services pool** on the relevant folder:

![Web services SOAP pool created and started](images/4_Pool-SOAP.png)

---

### 1.3 X3 server → ChatX3 connectivity

To verify the ChatX3 license, a connection is made **randomly once or twice a week**. The following URL must be reachable from your **X3 Runtime server**:

```
https://akfcgzazfvqipbjvdemn.supabase.co
```

> [!IMPORTANT]
> If your X3 server sits behind a proxy or firewall, allow this URL outbound. Without this access, the license check will fail.

---

### 1.4 Syracuse user rights

The Syracuse user used must have the following right in its security profile:

> `statusAndUsage` → **Read**

![Syracuse security profile with statusAndUsage read right](images/5_profil-securite.png)

---

### 1.5 X3 user web services right

The folder's X3 user, linked to the Syracuse user, must have the field:

> **Web services connection** → **Yes**

![X3 user record with web services connection enabled](images/6_Utilisateur-web-serv.png)

---

### 1.6 Installing the package in n8n

**1.** In your n8n instance menu, open **Settings > Community nodes**.

![Settings > Community nodes menu in n8n](images/7_n8n_1.png)

**2.** Click the **Install** button.

![Community nodes Install button](images/8_n8n_2.png)

**3.** Enter the npm package name `n8n-nodes-nx3`, tick the risk acknowledgement checkbox, then click **Install**.

![Entering the n8n-nodes-nx3 package and acknowledgement](images/9_n8n_3.png)

**4.** To verify the installation, create a new workflow and search for **"sage"** in the node list.

![Searching for the sage node in a new workflow](images/10_n8n_4.png)

**5.** The **nX3 by IntellX** node should appear with its available actions.

![nX3 by IntellX node and its actions](images/11_n8n_5.png)

> [!NOTE]
> Installing community nodes may require administrator rights on the n8n instance. On n8n Cloud, make sure community nodes are allowed on your plan.

> [!TIP]
> Every operation of the node (Describe, Custom, SQL Select with parameters, the advanced options and the AI Agent tool usage) is documented in the [technical reference](../README.md). This guide covers the Sage X3 side of the setup and the four basic actions.

---

## 2. Usage

### General information

- Flows run between your n8n instance and your X3 environment.
- **No data and no credentials** are stored or routed through ChatX3.
- The rights of the associated Syracuse user and folder are used, ensuring controlled access to information.
- **Standard, vertical and specific** objects of the environment are supported.
- All **standard, vertical and specific** processes run as if the user were entering them manually.

### Expected formats

- The node expects a **JSON payload** containing the screen abbreviations and the fields to use.
- All fields are treated as **dimensioned**: they must therefore be **collections** (arrays) in the JSON.
- To target a specific dimension, add the `(X)` index to the field name.
- You do **not** need to fill in the table-footer variables inside table blocks.
- Dates use the alphanumeric format **`YYYY-MM-DD`** (year-month-day).
- To **clear** a field: date `"0000-00-00"`, integer `0`, or empty string `""`.

Field syntax examples:

```json
"TSICOD": ["20", "21", "99"]
"TSICOD(1)": "21"
"SBSDAT": ["2026-05-01"]
```

### Returned information

- All required information is returned as a **JSON payload**.
- All **X3 user messages** are returned as JSON.
- A **`success`** boolean (`true`/`false`) indicates whether the requested action succeeded.
- On success, the JSON payload of the screens and fields read/written **after the operation** is returned.
- A standard **X3 trace** is always created; its name is sent in the messages.

**Example messages JSON:**

```json
{
  "messages": [
    { "info": "Info message" },
    { "error": "Error message" },
    { "alert": "Warning message" }
  ]
}
```

**Example trace:**

```json
{
  "trace": "F64723"
}
```

### Technical behaviour

In the context of n8n calls, the following X3 variables are set:

| Variable | Value |
|----------|:-----:|
| `[V]GXCHATX3OBJ` | `1` |
| `[V]GSERVEUR` | `0` |
| `[V]GBATCH` | `0` |
| `[V]GWEBSERV` | `1` |
| `[V]GIMPORT` | `0` |

> [!WARNING]
> The objects and actions called **must not open additional windows** beyond those of the base action or object being called.

---

## 3. Available actions

| Action | Description |
|--------|-------------|
| [`READ`](#read--read-an-object) | Read an existing record |
| [`LIST`](#list--list-objects) | List records with advanced selection |
| [`CREATE`](#create--create-an-object) | Create a new record |
| [`MODIFY`](#modify--modify-an-object) | Modify an existing record |

---

### READ — Read an object

Reads a record for an X3 object.

> **Example (SEED folder)** — Object `GAS`, transaction `1PAGE`, key `SMDIV~FR0120104SMDIV000001`

**Request payload:**

```json
{}
```

**Returned JSON:**

```json
{
  "HAE1": {
    "ACC1": ["608801", "486000"],
    "ACCDAT": ["2024-04-01"],
    "ACCDES": ["Assurance facturée", "Charges constatées d'avance"],
    "AMT1": [1000, 1000],
    "CAT": [2],
    "CPY": ["FR10"],
    "CUR": ["EUR"],
    "FCY": ["FR012"],
    "JOU": ["ODDIV"],
    "NBLIG": [2],
    "NUM": ["FR0120104SMDIV000001"],
    "NUMLIG": [1, 2],
    "TYP": ["SMDIV"],
    "TOTCDT": [1000],
    "TOTDEB": [1000],
    "VALDAT": ["2024-04-01"]
  }
}
```

**Returned messages JSON:**

```json
{
  "messages": [
    { "trace": "F64843" }
  ],
  "success": true
}
```

---

### LIST — List objects

Returns the information of the object's main left-hand list through an **advanced selection**. Lists can be filtered, via the JSON payload, on any field of the main table. By default the number of returned items is `[V]GNBGAUCHE` or `100`.

> **Example (SEED folder)** — Object `SOH`, transaction `ALL`

**Request payload:**

```json
{
  "list_nb": 10,
  "list_filters": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
}
```

**Returned JSON:**

```json
{
  "table_count": 1193,
  "list_count": 10,
  "filters": {
    "CRITERE(0)": "1=1",
    "FILTSUP(0)": "SOHCAT < 4",
    "FILRAP(0)": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
  },
  "codes": [
    "[F:SOH]SOHNUM",
    "[F:SOH]BPCORD",
    "[F:SOH]ORDDAT",
    "[F:SOH]CUSORDREF",
    "[F:SOH]DLVSTA"
  ],
  "titles": [
    "No commande",
    "Client commande",
    "Date commande",
    "Référence",
    "Etat livraison"
  ],
  "values": [
    ["SOWDE0120012", "DE001", "2025-07-21", "WEB015182112", 1],
    ["SOWDE0120011", "DE001", "2025-12-21", "WEB015182112", 2],
    ["SOWDE0120010", "DE001", "2025-11-09", "WEB015180911", 2]
  ]
}
```

**Returned messages JSON:**

```json
{
  "messages": [
    { "trace": "F64837" }
  ],
  "success": true
}
```

---

### CREATE — Create an object

Creates a new record for an X3 object (excluding table-type objects).

> **Example (SEED folder)** — Creating an `SQH` quote

**Request payload:**

```json
{
  "SQH0": {
    "BPCORD": ["FR001"],
    "SALFCY": ["FR021"],
    "SQHTYP": ["SQN"]
  },
  "SQH1": {
    "STOFCY": ["FR021"],
    "VACBPR": ["FRA"]
  },
  "SQH2": {
    "GROPRI": [1000],
    "ITMREF": ["ASS001"],
    "QTY": [1]
  }
}
```

**Returned JSON:**

```json
{
  "SQH0": {
    "BPCNAM": ["Urban Cycle"],
    "BPCORD": ["FR001"],
    "CUR": ["AED"],
    "QUODAT": ["2026-05-28"],
    "SALFCY": ["FR021"],
    "SQHNUM": ["FR0212605SQN00000001"],
    "SQHTYP": ["SQN"]
  }
}
```

**Returned messages JSON:**

```json
{
  "messages": [
    { "trace": "F64842" },
    { "info": "Objet créé : FR0212605SQN00000001" },
    { "alert": "Accès non autorisé sur cet article (Elaboration)" }
  ],
  "success": true
}
```

---

### MODIFY — Modify an object

Modifies a record for an X3 object.

> **Example (SEED folder)** — Object `SOH`, transaction `STD`, key `SOWFR0110003`

**Request payload:**

```json
{
  "SOH4": {
    "QTY(1)": [7]
  }
}
```

**Returned JSON:**

```json
{
  "SOH0": {
    "BPCNAM": ["Micro Systems"],
    "BPCORD": ["FR004"],
    "CUR": ["EUR"],
    "CUSORDREF": ["Test report ACCINV"],
    "ORDDAT": ["2026-05-22"],
    "SALFCY": ["FR011"],
    "SOHNUM": ["SOWFR0110003"],
    "SOHTYP": ["WEB"]
  },
  "SOH4": {
    "ITMREF": ["DIS009", "DIS007"],
    "QTY": [1, 7],
    "GROPRI": [220, 250],
    "NBLIG": [2]
  }
}
```

**Returned messages JSON:**

```json
{
  "messages": [
    { "trace": "F64844" },
    { "alert": "Désirez vous recalculer les prix et remises ?   (Non)" }
  ],
  "success": true
}
```

---

## Support

A question, a bug, or a feature request?

- 🐛 **Bug / feature**: open a [GitHub issue](https://github.com/adrien-ge/n8n-nodes-nx3/issues)
- 💬 **Contact**: [contact@intellx.chat](mailto:contact@intellx.chat)
- 🌐 **Website**: [https://intellx.chat](https://intellx.chat)

Before opening an issue, make sure all [requirements](#requirements) are met and, if possible, include the **X3 trace name** returned in the messages.

---

<p align="center"><sub>nX3 by IntellX — Sage X3 integration for n8n</sub></p>
