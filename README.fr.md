# n8n-nodes-nx3 — IntellX for Sage X3

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-nx3.svg)](https://www.npmjs.com/package/n8n-nodes-nx3)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-FF6D5A)](https://docs.n8n.io/integrations/community-nodes/)

[🇬🇧 English](README.md) · **🇫🇷 Français**

Nœud communautaire [n8n](https://n8n.io/) pour lire, lister, créer, modifier
et décrire des objets **Sage X3**, et exécuter des requêtes SQL `SELECT` sur la
base X3 — depuis un workflow ou depuis un agent IA.

Le nœud dialogue avec le web service SOAP `CAdxWebServiceXmlCC` de Sage X3 via
le sous-programme `XCHATX3OBJ` livré par le **patch ChatX3**. Vous travaillez
uniquement en JSON : le nœud construit la requête SOAP, demande à X3 de
répondre en JSON natif et renvoie un objet propre, directement exploitable.
Aucune manipulation de XML.

## Sommaire

1. [Fonctionnement](#1-fonctionnement)
2. [Prérequis](#2-prérequis)
3. [Mise en place côté Sage X3](#3-mise-en-place-côté-sage-x3)
4. [Installation du nœud dans n8n](#4-installation-du-nœud-dans-n8n)
5. [Credential](#5-credential)
6. [Opérations](#6-opérations)
7. [Opérations sur les objets](#7-opérations-sur-les-objets)
8. [Opérations SQL](#8-opérations-sql)
9. [Sortie](#9-sortie)
10. [Options avancées](#10-options-avancées)
11. [Agent IA et MCP](#11-agent-ia-et-mcp)
12. [Recettes de workflow](#12-recettes-de-workflow)
13. [Dépannage](#13-dépannage)
14. [Compatibilité](#14-compatibilité)
15. [Support et ressources](#15-support-et-ressources)
16. [Historique des versions](#16-historique-des-versions)

---

## 1. Fonctionnement

| | |
|---|---|
| Package npm | `n8n-nodes-nx3` |
| Nœud n8n | **IntellX for Sage X3** (credential : *IntellX for Sage X3 API*) |
| Protocole | Web services SOAP Sage X3 (Syracuse), `CAdxWebServiceXmlCC` |
| Côté X3 | Sous-programme `XCHATX3OBJ`, installé par le patch ChatX3 |
| Périmètre | Objets et traitements standards, verticaux et spécifiques |
| Sécurité | Les droits fonctionnels de l'utilisateur Syracuse et du dossier s'appliquent à chaque appel |

Les flux circulent **directement entre votre instance n8n et votre serveur
Sage X3**. La passerelle ChatX3 n'est contactée que pour le contrôle de
licence ([§3.3](#33-url-de-licence)) : aucune donnée métier ni aucun identifiant
ne transite par elle.

Chaque appel reproduit ce qu'un utilisateur X3 ferait à l'écran. X3 l'exécute
avec `GXCHATX3OBJ=1`, `GWEBSERV=1`, `GSERVEUR=0`, `GBATCH=0` et `GIMPORT=0`,
donc les traitements standards, verticaux et spécifiques se déroulent comme si
l'utilisateur avait saisi les valeurs — avec ses droits, ses valeurs par défaut
et ses contrôles.

Deux limites en découlent :

- Un objet ou une action qui ouvre **une fenêtre supplémentaire** au-delà de
  l'écran de base ne peut pas être piloté ainsi.
- Les **objets de type tableau** ne sont pas encore pris en charge par le patch
  ChatX3.

## 2. Prérequis

Cochez chaque case avant le premier appel. Les sections 3 et 4 détaillent
chaque point.

- [ ] Le **patch ChatX3** est intégré sur le dossier X3 ([§3.1](#31-patch-chatx3))
- [ ] Un **pool de web services** est créé, lancé et accessible depuis n8n ([§3.2](#32-pool-de-web-services-soap))
- [ ] Le serveur Runtime X3 peut **joindre l'URL de licence ChatX3** ([§3.3](#33-url-de-licence))
- [ ] L'utilisateur Syracuse a le droit `statusAndUsage → Lire` ([§3.4](#34-droits-de-lutilisateur-syracuse))
- [ ] L'utilisateur X3 du dossier a **Connexion services web = Oui** ([§3.5](#35-droit-web-services-de-lutilisateur-x3))
- [ ] Le package `n8n-nodes-nx3` est installé sur l'instance n8n ([§4](#4-installation-du-nœud-dans-n8n))

## 3. Mise en place côté Sage X3

### 3.1 Patch ChatX3

1. Téléchargez le patch ChatX3 sur [intellx.chat](https://intellx.chat/).
2. Dans Sage X3, ouvrez **Développement → Utilitaires → Patchs → Intégration
   de patchs**.
3. Reproduisez les cases cochées ci-dessous, puis lancez l'intégration.

![Écran d'intégration du patch ChatX3 dans Sage X3](docs/images/1_param_patch_chatx3.png)

> [!TIP]
> Intégrez d'abord sur un dossier de test, et conservez une sauvegarde du
> dossier avant toute opération de patch.

### 3.2 Pool de web services SOAP

Le pool doit être accessible depuis l'instance n8n (publiquement ou via votre
réseau).

**a.** Vérifiez que le serveur web Syracuse a **au moins un processus enfant
SOAP** :

![Configuration du processus enfant SOAP sur Syracuse](docs/images/3_Syracuse_SOAP.png)

**b.** Créez et **lancez** un pool de web services sur le dossier. Son alias
est ce que vous renseignerez dans le *Pool Alias* de la credential :

![Pool de web services SOAP créé et lancé](docs/images/4_Pool-SOAP.png)

### 3.3 URL de licence

Pour contrôler la licence ChatX3, le **serveur Runtime X3** se connecte
aléatoirement une à deux fois par semaine à :

```
https://akfcgzazfvqipbjvdemn.supabase.co
```

> [!IMPORTANT]
> Derrière un proxy ou un pare-feu, autorisez cette URL en sortie depuis le
> serveur Runtime X3. Sans cet accès, le contrôle de licence échoue. Rien
> d'autre ne transite par cette URL.

### 3.4 Droits de l'utilisateur Syracuse

L'utilisateur Syracuse utilisé par la credential doit avoir, dans son profil de
sécurité :

> `statusAndUsage` → **Lire**

![Profil de sécurité Syracuse avec le droit statusAndUsage en lecture](docs/images/5_profil-securite.png)

### 3.5 Droit web services de l'utilisateur X3

L'utilisateur X3 du dossier rattaché à cet utilisateur Syracuse doit avoir :

> **Connexion services web** → **Oui**

![Fiche utilisateur X3 avec la connexion services web activée](docs/images/6_Utilisateur-web-serv.png)

## 4. Installation du nœud dans n8n

### 4.1 Depuis l'interface n8n (community nodes)

**1.** Ouvrez **Paramètres → Community nodes**.

![Menu Paramètres → Community nodes dans n8n](docs/images/7_n8n_1.png)

**2.** Cliquez sur **Install**.

![Bouton Install des Community nodes](docs/images/8_n8n_2.png)

**3.** Saisissez `n8n-nodes-nx3`, cochez la case d'acceptation, puis cliquez
sur **Install**.

![Saisie du package n8n-nodes-nx3](docs/images/9_n8n_3.png)

**4.** Dans un nouveau workflow, cherchez **« sage »** dans le panneau des
nœuds.

![Recherche du nœud Sage dans un nouveau workflow](docs/images/10_n8n_4.png)

**5.** Le nœud **IntellX for Sage X3** apparaît avec ses actions.

![Nœud IntellX for Sage X3 et ses actions](docs/images/11_n8n_5.png)

> [!NOTE]
> L'installation de community nodes demande un compte propriétaire ou
> administrateur. Sur n8n Cloud, vérifiez que les community nodes sont
> autorisés sur votre offre. Voir la
> [documentation n8n](https://docs.n8n.io/integrations/community-nodes/installation/).

### 4.2 Docker auto-hébergé, depuis les sources

Pour charger le package directement depuis un clone du dépôt, compilez-le et
montez-le dans le dossier d'extensions personnalisées du conteneur :

```bash
npm install && npm run build
```

```bash
docker run -d --name n8n -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -v /chemin/vers/n8n-nodes-nx3:/home/node/.n8n/custom/n8n-nodes-nx3:ro \
  n8nio/n8n
```

Redémarrez le conteneur après chaque recompilation.

> Un package chargé depuis le dossier `custom` est enregistré par n8n sous le
> type `CUSTOM.nx3Soap` (et `CUSTOM.nx3SoapTool`), pas `n8n-nodes-nx3.nx3Soap`.
> Un workflow exporté d'une instance où le package venait de npm affiche alors
> ses nœuds avec une icône `?` et demande d'installer le package : modifiez le
> `type` des nœuds dans le JSON avant l'import, ou installez depuis npm.

## 5. Credential

Vous vous authentifiez avec votre utilisateur **Syracuse** — celui avec lequel
vous vous connectez à Sage X3 — en authentification HTTP Basic.

| Champ | Obligatoire | Description |
| --- | --- | --- |
| Base URL | ✅ | Schéma + hôte + port du serveur Syracuse, par ex. `https://mon-serveur-x3:8124`. Le chemin SOAP est ajouté automatiquement. |
| Username | ✅ | Utilisateur Syracuse ([§3.4](#34-droits-de-lutilisateur-syracuse)) |
| Password | ✅ | Mot de passe Syracuse |
| Code Language | | `codeLang` par défaut du contexte d'appel SOAP (`FRA`, `ENG`…). `FRA` par défaut. |
| Pool Alias | | `poolAlias` par défaut, par ex. `POOL_SEED`. Doit correspondre à un pool existant et **lancé** ([§3.2](#32-pool-de-web-services-soap)). |
| Pool ID | | `poolId` par défaut. En général vide. |
| Request Config | | `requestConfig` par défaut. Le nœud ajoute lui-même les indicateurs du mode JSON. |
| Allow Self-Signed Certificates | | Ignore la validation TLS. Pour un X3 sur site avec certificat auto-signé uniquement ; jamais en production via Internet. |

Le bouton **Test** envoie un vrai `POST` sur l'endpoint SOAP appelé par le
nœud, avec une charge `XCHATX3OBJ` vide. Obtenir la réponse d'X3 prouve que
l'URL, le port, l'authentification et le pool fonctionnent ; rien n'est lu ni
écrit. Un 405 à ce stade signifie que la Base URL n'est pas le service SOAP —
le plus souvent un port manquant (Syracuse écoute sur 8124 ou 8443, rarement
sur 443).

## 6. Opérations

| Opération | Action X3 | Rôle |
| --- | --- | --- |
| **Read Sage X3 Object** | `READ` | Lire un enregistrement par son identifiant et renvoyer tous ses champs |
| **List Sage X3 Objects** | `LIST` | Lister les enregistrements d'un objet, avec critères de sélection optionnels |
| **Create Sage X3 Object** | `CREATE` | Créer un enregistrement à partir d'une charge JSON |
| **Modify Sage X3 Object** | `MODIFY` | Modifier des champs d'un enregistrement existant |
| **Describe Sage X3 Object** | `DESC` | Obtenir les écrans, champs et menus locaux d'une classe d'objet |
| **Custom Sage X3 Action** | *(texte libre)* | Envoyer n'importe quel `XACTION` exposé par le patch, y compris les futurs |
| **SQL Analyse** | `ANALYSE` | Vérifier qu'une requête SQL est valide, sans renvoyer de lignes |
| **SQL Select** | `SELECT` | Exécuter un `SELECT` SQL et renvoyer les lignes |
| **Run Sub-Program (Advanced)** | *(XML brut)* | Appeler n'importe quel sous-programme X3 avec une charge brute — la porte de secours |

Le champ **Action Code** est toujours visible et pré-rempli selon l'opération :
vous voyez exactement quel `XACTION` part, et vous pouvez le surcharger.

## 7. Opérations sur les objets

### 7.1 Paramètres

Affichés pour Read, List, Create, Modify, Describe et Custom :

- **Sage X3 Object Code** — le code objet : `ITM` (articles), `BPC` (clients),
  `SOH` (commandes de vente)…
- **Transaction Code** — la transaction de saisie X3 (`XTRANSACTION`). Vide
  pour la transaction par défaut.
- **Identifier** — la clé primaire de l'enregistrement (`XIDENT`). Obligatoire
  pour Read et Modify. Pour Create, doit correspondre au champ clé des données
  (par ex. `ITM0.ITMREF`) sauf si X3 génère la clé. Optionnel pour Custom,
  masqué pour List et Describe. Une **clé composée** s'écrit avec `~` entre
  ses parties, dans l'ordre de la clé de l'objet : `FIN311~NA021` pour un
  article-site, `SMDIV~FR0120104SMDIV000001` pour une pièce comptable,
  `FR012~BMS001~1~8` pour un coût standard (site, article, version, exercice).
- **Data (JSON)** — la charge envoyée en `XDATAJSON`. Affichée pour Create,
  Modify, List et Custom.

### 7.2 Conventions du JSON de données

La charge reflète les écrans X3 : une clé par **abréviation d'écran**, et à
l'intérieur une clé par champ.

- Tous les champs sont dimensionnés, donc les valeurs sont des **tableaux** :
  `"TSICOD": ["20"]` ou `"TSICOD": ["20", "21", "99"]`.
- Pour viser un indice précis, ajoutez `(n)` au nom du champ :
  `"TSICOD(1)": "21"`.
- Ne renseignez pas les variables de bas de tableau et de comptage (`NBLIG` et
  consorts) : X3 les remplit.
- Les dates sont au format `"YYYY-MM-DD"` : `"SBSDAT": ["2026-05-01"]`.
- Pour vider un champ : `""`, l'entier `0`, ou la date `"0000-00-00"`.

En **sortie**, les tableaux à une seule valeur sont dépliés en scalaires par
défaut (*Compact Single-Value Arrays*, [§10](#10-options-avancées)) :
`["FR001"]` revient en `"FR001"`, les tableaux multi-valeurs restent des
tableaux.

### 7.3 Context (optionnel)

Une enveloppe optionnelle fusionnée dans `XDATAJSON` sous la clé `context`.
Laissez-la vide et la charge part exactement comme écrite.

| Option | Effet |
| --- | --- |
| Language | Surcharge la langue XCHATX3OBJ pour cet appel (par ex. `ITA`). Couche distincte du `codeLang` SOAP de la credential. |
| User | Exécute l'appel sous un autre utilisateur (par ex. `FU01`). Honoré uniquement si l'appelant a `GPROFIL=ADMIN`. |
| Response Screens | Ne renvoie que ces écrans, par ex. `ITM0`, `ITM1`. |
| Response Fields | Ne renvoie que ces champs, par ex. `DES1AXX`. |
| Include Hidden Fields | Inclut les champs masqués et techniques, exclus par défaut. |

Charge résultante :

```json
{
  "context": {
    "language": "ITA",
    "user": "FU01",
    "response": { "screens": ["ITM0"], "fields": ["DES1AXX"], "hidden_fields": true }
  },
  "ITM0": { "DES1AXX": ["Nouvelle désignation"] }
}
```

### 7.4 Read

Lit un enregistrement. Exemple sur le dossier SEED — objet `GAS`, transaction
`1PAGE`, identifiant `SMDIV~FR0120104SMDIV000001`, sans données :

```json
{
  "success": true,
  "action": "READ",
  "object": "GAS",
  "ident": "SMDIV~FR0120104SMDIV000001",
  "transaction": "1PAGE",
  "data": {
    "HAE1": {
      "TYP": "SMDIV",
      "NUM": "FR0120104SMDIV000001",
      "CPY": "FR10",
      "FCY": "FR012",
      "JOU": "ODDIV",
      "ACCDAT": "2024-04-01",
      "CUR": "EUR",
      "NUMLIG": [1, 2],
      "ACC1": ["608801", "486000"],
      "ACCDES": ["Assurance facturée", "Charges constatées d'avance"],
      "AMT1": [1000, 1000],
      "TOTDEB": 1000,
      "TOTCDT": 1000,
      "NBLIG": 2
    }
  },
  "messages": [{ "trace": "F64843" }],
  "trace": "F64843",
  "sessionId": "6784"
}
```

### 7.5 List

Lit la liste gauche principale de l'objet via une sélection avancée. La charge
accepte deux clés optionnelles :

```json
{
  "list_nb": 10,
  "list_filters": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
}
```

- `list_nb` — nombre de lignes à renvoyer. Par défaut : le paramètre
  `GNBGAUCHE` du dossier, ou 100.
- `list_filters` — une expression de sélection X3 sur n'importe quel champ de
  la table principale, en syntaxe `[F:TABLE]CHAMP`. Elle s'ajoute aux filtres
  propres de l'objet, renvoyés sous `filters`.

La sortie porte les codes et titres de colonnes une seule fois, et les lignes
sous forme de tableaux :

```json
{
  "table_count": 1193,
  "list_count": 10,
  "filters": {
    "CRITERE(0)": "1=1",
    "FILTSUP(0)": "SOHCAT < 4",
    "FILRAP(0)": "[F:BPA]CRY<>\"FR\" & [F:SOH]CUSORDREF<>\"\""
  },
  "codes":  ["[F:SOH]SOHNUM", "[F:SOH]BPCORD", "[F:SOH]ORDDAT", "[F:SOH]CUSORDREF", "[F:SOH]DLVSTA"],
  "titles": ["No commande", "Client commande", "Date commande", "Référence", "Etat livraison"],
  "values": [
    ["SOWDE0120012", "DE001", "2025-07-21", "WEB015182112", 1],
    ["SOWDE0120011", "DE001", "2025-12-21", "WEB015182112", 2]
  ]
}
```

`table_count` est la taille de la table entière, `list_count` le nombre de
lignes renvoyées. Pour obtenir un item n8n par ligne, découpez sur
`data.values` et retrouvez les positions via `data.codes`.

### 7.6 Create

Crée un enregistrement. Exemple sur SEED — un devis, objet `SQH` :

```json
{
  "SQH0": { "BPCORD": ["FR001"], "SALFCY": ["FR021"], "SQHTYP": ["SQN"] },
  "SQH1": { "STOFCY": ["FR021"], "VACBPR": ["FRA"] },
  "SQH2": { "GROPRI": [1000], "ITMREF": ["ASS001"], "QTY": [1] }
}
```

X3 répond avec l'enregistrement tel qu'enregistré — y compris les champs qu'il
a calculés, comme le numéro généré — et ses messages utilisateur :

```json
{
  "success": true,
  "action": "CREATE",
  "object": "SQH",
  "data": {
    "SQH0": {
      "SQHNUM": "FR0212605SQN00000001",
      "SQHTYP": "SQN",
      "BPCORD": "FR001",
      "BPCNAM": "Urban Cycle",
      "SALFCY": "FR021",
      "CUR": "AED",
      "QUODAT": "2026-05-28"
    }
  },
  "messages": [
    { "trace": "F64842" },
    { "info": "Objet créé : FR0212605SQN00000001" },
    { "alert": "Accès non autorisé sur cet article (Elaboration)" }
  ],
  "trace": "F64842",
  "sessionId": "6784"
}
```

Notez l'`alert` : X3 peut renvoyer `success: true` tout en portant des
avertissements, voire une `error`. Voir [§9](#9-sortie) pour conditionner un
workflow dessus.

### 7.7 Modify

Modifie des champs d'un enregistrement existant. Exemple sur SEED — objet
`SOH`, transaction `STD`, identifiant `SOWFR0110003`, quantité de la ligne 1
mise à 7 :

```json
{
  "SOH4": { "QTY(1)": [7] }
}
```

```json
{
  "success": true,
  "action": "MODIFY",
  "object": "SOH",
  "ident": "SOWFR0110003",
  "data": {
    "SOH0": { "SOHNUM": "SOWFR0110003", "SOHTYP": "WEB", "BPCORD": "FR004", "BPCNAM": "Micro Systems", "SALFCY": "FR011", "CUR": "EUR", "ORDDAT": "2026-05-22" },
    "SOH4": { "ITMREF": ["DIS009", "DIS007"], "QTY": [1, 7], "GROPRI": [220, 250], "NBLIG": 2 }
  },
  "messages": [
    { "trace": "F64844" },
    { "alert": "Désirez vous recalculer les prix et remises ?   (Non)" }
  ],
  "trace": "F64844",
  "sessionId": "6784"
}
```

Une question qu'X3 poserait à l'écran reçoit sa réponse par défaut et est
signalée en `alert`, comme ci-dessus.

> X3 conserve un verrou sur un enregistrement lu dans la même session. Pour
> enchaîner un Read et un Modify sur un enregistrement, passez le `sessionId`
> du Read dans le **Pool ID Override** du Modify ([§12](#12-recettes-de-workflow)),
> ou sautez le Read.

### 7.8 Describe

Renvoie les métadonnées de la classe d'objet : ses écrans, chacun avec ses
champs (nom, type, longueur, dimension, caractère obligatoire, description,
numéro de menu local) et ses blocs, puis les menus locaux utilisés avec leurs
lignes. C'est ce qu'un agent IA doit appeler avant un Create pour connaître la
forme de la charge.

```json
{
  "screens": {
    "screen_code": "ACV2",
    "screen_name": "Gestion des codes activités",
    "fields": [
      { "name": "CODACT", "system_type": "Char", "length": 5, "dimension": 1, "required": true, "description": "Code activité", "type": "ACV" },
      { "name": "FLACT", "menu_number": 1, "system_type": "Integer", "description": "Actif", "type": "M" }
    ],
    "blocks": [{ "code": "10", "description": "Identifiant", "type": "List" }]
  },
  "local_menus": [
    { "menu_number": 1, "menu_name": "Non/Oui", "lines": [{ "line_number": 1, "message": "Non" }, { "line_number": 2, "message": "Oui" }] }
  ]
}
```

### 7.9 Action personnalisée et Run Sub-Program

**Custom Sage X3 Action** envoie le code objet, l'identifiant et les données
avec l'`XACTION` de votre choix — pour les actions que le patch ChatX3 expose
au-delà des cinq ci-dessus, y compris celles ajoutées par une version
ultérieure du patch.

**Run Sub-Program (Advanced)** contourne entièrement `XCHATX3OBJ` : vous
nommez le sous-programme public et passez son XML d'entrée brut (encapsulé en
CDATA pour vous). La sortie est l'enveloppe générique du [§9](#9-sortie) avec
le résultat du sous-programme, pour tout ce que la couche objet ne couvre pas.

## 8. Opérations SQL

**SQL Analyse** valide une requête sans l'exécuter ; **SQL Select** l'exécute
et renvoie les lignes. Les deux acceptent des plafonds optionnels **Max Lines**
et **Max Time (Seconds)**, envoyés à X3 en `context.max_lines` et
`context.max_time`.

> `Max Time` plafonne l'exécution *dans X3* ; **Request Timeout** dans les
> options avancées plafonne l'appel HTTP (30 s par défaut). Gardez le premier
> sous le second, sinon la requête abandonne avant X3.

Les requêtes s'écrivent dans le dialecte de la base derrière X3 — T-SQL sur
Microsoft SQL Server, PL/SQL sur Oracle.

### 8.1 Paramètres de requête

Plutôt que de concaténer des valeurs dans la requête — dangereux, surtout quand
un agent IA les fournit — déclarez-les sous **Query Parameters** et
référencez-les avec `{{nom}}` :

```sql
SELECT TOP (100) [USR_0], [CREUSR_0], [CREDAT_0]
FROM   [AUTILIS]
WHERE  USR_0 IN ({{logins}})
  AND  CREDAT_0 BETWEEN {{from}} AND {{to}}
[[AND  CREUSR_0 = {{creator}}]]
```

- Chaque valeur est échappée selon son **Type** et produit un littéral
  *complet* : n'entourez jamais `{{nom}}` de guillemets vous-même.
- `[[ ... ]]` marque une **clause optionnelle** : supprimée entièrement quand
  ses paramètres sont vides, conservée sinon. Idéal pour des filtres qu'un
  agent remplira ou non.
- Un `{{nom}}` hors clause optionnelle et sans valeur lève une erreur claire
  plutôt que de modifier la requête en silence.
- **Les commentaires désactivent les paramètres.** Un marqueur dans un
  commentaire `--`, un bloc `/* ... */` ou un littéral chaîne est laissé tel
  quel : commenter une ligne de filtre fait exactement ce qu'un lecteur SQL
  attend.

| Type | Rendu | Usage |
| --- | --- | --- |
| Text | `'valeur'`, guillemets internes doublés | `=`, ou un `LIKE` dont vous écrivez le motif |
| Contains | `'%valeur%'`, avec `%` `_` `[` échappés dans la valeur | `LIKE {{nom}}` — tapez `dupont`, pas `%dupont%` |
| Number | brut, numérique validé | `>`, `<`, `>=` |
| Date | entre guillemets, `YYYY-MM-DD` ou ISO-8601 | `BETWEEN`, comparaisons |
| Boolean | `1` / `0` | indicateurs |
| List | `'a','b','c'` — découpé sur la virgule, chaque élément cité | `IN ({{nom}})` |

> **Contains** échappe les jokers LIKE contenus dans la valeur : chercher
> `remise 50%` cherche ce texte exact et non tout ce qui commence par
> `remise 50`.

> Utilisez **List**, pas Text, pour `IN ({{nom}})`. Une valeur Text contenant
> `a,b` devient le littéral unique `'a,b'` et ne trouve rien ; le nœud détecte
> ce cas et vous indique de changer de type. Une valeur List ne peut pas
> contenir de virgule, puisque c'est le séparateur.

### 8.2 Simplify et Row Format

Sage X3 renvoie les lignes SQL avec des clés génériques — `Col_1`, `Col_2`… —
en perdant le lien avec les colonnes sélectionnées. Activez **Simplify** (SQL
Select uniquement) pour obtenir les lignes avec leurs vrais noms, retrouvés
dans la requête :

```json
{
  "rowCount": 3,
  "columns": ["USR_0", "CREUSR_0", "CREDAT_0"],
  "rows": [{ "USR_0": "ADMCA", "CREUSR_0": "ADMIN", "CREDAT_0": "2015-08-14" }]
}
```

L'enveloppe se réduit aux données : `success`, `messages` et `trace`
n'apparaissent qu'en cas de problème, donc un échec n'est jamais silencieux
tandis que le cas nominal reste léger à lire — ce qui compte quand les lignes
alimentent un agent IA.

Les dates reviennent en `YYYY-MM-DD` simple, et la sentinelle `0000-00-00`
d'X3 (« non renseigné ») devient `null`. L'heure n'est supprimée que
lorsqu'elle vaut exactement minuit UTC : un vrai horodatage garde sa valeur
complète.

**Row Format** choisit ensuite la forme des lignes :

- **Objects** (par défaut) — une clé par colonne, le plus simple en expression
  (`{{ $json.rows[0].USR_0 }}`) et rendu nativement par la vue Table de n8n.
- **Arrays** — les valeurs seules, dans l'ordre de `columns`. Bien plus
  compact : le bon choix quand les lignes vont vers un agent IA.

Les noms de colonnes sont lus après suppression des commentaires SQL : une
requête peut s'ouvrir par un en-tête `/* ... */` et porter des commentaires
entre deux colonnes ; les littéraux chaîne sont laissés intacts. Le renommage
est conservateur et ne réordonne ni ne perd jamais de données : avec `SELECT *`,
une expression non résoluble ou un écart de nombre de colonnes, les clés
`Col_N` d'origine sont conservées. Laissez Simplify désactivé pour obtenir
l'enveloppe complète du [§9](#9-sortie).

## 9. Sortie

Les opérations sur les objets renvoient un item par item d'entrée, de la forme :

```json
{
  "success": true,
  "status": 1,
  "action": "READ",
  "object": "ITM",
  "ident": "ASS001",
  "transaction": "",
  "data": {
    "ITM0": { "ITMREF": "ASS001", "DES1AXX": "Serveur informatique", "TCLCOD": "BMSOL" },
    "ITM1": { "EANCOD": "3782940199614", "TSICOD": ["10", "12", "122"] }
  },
  "messages": [{ "trace": "F1730" }],
  "trace": "F1730",
  "sessionId": "6784"
}
```

| Champ | Description |
| --- | --- |
| `success` | `true` quand X3 indique que l'action a réussi (`XRETURNJSON.success`, sinon `status === 1`). |
| `status` | Statut X3 brut : `1` OK, `0` échec. |
| `action` / `object` / `ident` / `transaction` | Rappel de la requête, pour la traçabilité. |
| `data` | La charge objet (`XDATAJSON`), parsée en objet navigable. |
| `messages` | Messages utilisateur X3 — `info`, `error`, `alert` — et l'entrée `trace`. |
| `trace` | Le nom de la trace X3. Une trace X3 classique est toujours écrite ; citez-la dans toute demande de support. |
| `sessionId` | L'entrée du pool X3 qui a traité l'appel. Repassez-la en **Pool ID Override** pour enchaîner des appels sur la même session. |
| `technicalInfos` | Métriques de pool et de temps (`poolExecDuration`, `totalDuration`…). Présent uniquement si **Include Technical Infos** est activé. |

> X3 peut renvoyer `success: true` tout en incluant un message `error` (un
> contrôle de niveau d'accès, par exemple). Pour conditionner strictement un
> workflow, testez les messages dans un nœud IF :
> `{{ !($json.messages || []).some(m => m.error) }}`

SQL Select avec Simplify renvoie à la place la forme réduite du
[§8.2](#82-simplify-et-row-format).

En cas d'échec de transport ou HTTP, le nœud lève un message d'une phrase qui
nomme la cause et l'URL appelée (timeout, connexion refusée, hôte inconnu, 401,
403, 404, 405, 407, 502-504). Avec **Continue on Fail**, l'item porte `error`,
`httpStatus` et `url` au lieu d'arrêter le workflow.

## 10. Options avancées

Toutes optionnelles. Les options de mise en forme de la sortie sont **activées**
par défaut ; les options de débogage et de surcharge sont **désactivées**.

| Option | Défaut | Rôle |
| --- | --- | --- |
| Compact Single-Value Arrays | on | Déplie les tableaux à un élément : `["Iconext"]` → `"Iconext"`. Les tableaux multi-valeurs restent des tableaux. |
| Trim Trailing Empty Values | on | Supprime les valeurs vides de fin dont X3 complète les champs dimensionnés : `["A","",""]` → `["A"]`. |
| Request Timeout (Seconds) | 30 | Abandonne l'appel SOAP quand X3 ne répond pas, au lieu de bloquer. |
| Code Language Override | — | Surcharge le `codeLang` de la credential pour cet appel. |
| Pool Alias Override | — | Surcharge le `poolAlias` de la credential pour cet appel. |
| Pool ID Override | — | Fixe l'appel sur une session X3 donnée, par ex. `={{ $json.sessionId }}` d'une étape précédente, pour conserver un verrou entre Read et Modify. |
| Public Name Override | — | Appelle un autre sous-programme que `XCHATX3OBJ`. |
| Include Request in Output | off | Ajoute `request` — l'URL appelée, la charge JSON et l'enveloppe SOAP envoyées — pour le débogage. |
| Include Result in Output | off | Ajoute `result`, le résultat X3 parsé, pour le débogage. |
| Include Technical Infos | off | Ajoute `technicalInfos`, les métriques de pool et de temps d'X3. Environ un quart de chaque item ; à laisser désactivé quand le nœud alimente un agent IA. |
| Include Raw SOAP Response | off | Ajoute `raw`, l'enveloppe SOAP complète en XML, pour le débogage transport. |

## 11. Agent IA et MCP

Le nœud a `usableAsTool` activé : branchez-le sur un nœud **AI Agent** pour
les opérations objet (« trouve l'article BMS009 », « crée un client ») comme
pour SQL Select. n8n génère lui-même la variante outil — `n8n-nodes-nx3.nx3SoapTool`
dans le JSON du workflow — avec un champ **Description** que le modèle lit pour
choisir l'outil. Les mêmes nœuds outils peuvent être reliés à un **MCP Server
Trigger** pour les exposer à Claude, Cursor ou tout client MCP.

Le template *Query Sage X3 in natural language with an AI agent and an MCP
server* sur n8n.io est un montage complet agent + MCP construit sur ce nœud.

### 11.1 Deux façons de câbler un outil SQL

- **L'agent écrit la requête** — mettez `$fromAI` sur **SQL Query**. Souple,
  mais le modèle compose lui-même le SQL et peut atteindre n'importe quelle
  table.
- **La requête est fixe, l'agent ne remplit que les valeurs** — écrivez la
  requête une fois avec des clauses optionnelles `[[ ... ]]` et mettez `$fromAI`
  sur la **Value** de chaque Query Parameter. Le modèle ne peut pas écrire de
  SQL, les valeurs sont échappées par le nœud, et les filtres non remplis
  disparaissent d'eux-mêmes. **À préférer.**

### 11.2 Rendre les filtres optionnels vraiment optionnels

`$fromAI('nom', 'description', 'string')` produit un champ **obligatoire** :
n8n ne le marque optionnel que si l'appel porte un quatrième argument, la
valeur par défaut. Sans lui, le modèle est forcé de fournir une valeur à chaque
appel, une clause `[[ ... ]]` ne peut jamais être supprimée, et l'appel est
rejeté avant d'atteindre le nœud avec `Received tool input did not match
expected schema`.

Terminez donc chaque paramètre qui porte un filtre optionnel par une valeur par
défaut vide :

```
={{ $fromAI('creator', 'Code créateur. Laisser vide pour ignorer ce filtre', 'string', '') }}
```

L'astérisque rouge à côté du champ dans la fenêtre de test de l'outil
disparaît quand c'est correct. Gardez le champ obligatoire pour les entrées
vraiment requises — lire un enregistrement sans son identifiant n'a pas de
sens.

### 11.3 Garder les appels d'outil légers

Chaque octet d'un résultat d'outil coûte des tokens, à chaque appel :

- **Row Format : Arrays** sur les outils SQL, avec un plafond `maxLines`
  dimensionné pour la question, pas pour la table.
- **Include Technical Infos** désactivé (le défaut).
- Un Describe une fois, puis le Create — plutôt que deviner la forme de la
  charge.
- Les opérations d'écriture en outil écrivent réellement dans X3. Le prompt
  système peut exiger une confirmation sur le chemin conversationnel ; un appel
  MCP direct la contourne. N'exposez que ce que vous voulez exposer.

## 12. Recettes de workflow

**Lire un article**

- Opération `Read Sage X3 Object`, objet `ITM`, identifiant `ASS001`.

**Modifier la désignation d'un article**

- Opération `Modify Sage X3 Object`, objet `ITM`, identifiant `ASS001`,
  données `{ "ITM0": { "DES1AXX": ["Nouvelle désignation"] } }`.

**Read → Modify sur la même session X3 (conserver le verrou)**

1. Le nœud `Read Sage X3 Object` renvoie `sessionId`.
2. Dans le nœud `Modify Sage X3 Object` suivant, mettez **Advanced Options →
   Pool ID Override** à `={{ $('Read Sage X3 Object').item.json.sessionId }}`.

**List → un item par ligne**

1. `List Sage X3 Objects` sur `ICD` avec les données
   `{"list_filters": "[F:ITC]FIYNUM >= 8"}`.
2. Un nœud **Split Out** sur `data.values`.
3. Un `Read Sage X3 Object` dont l'identifiant recompose les positions, par ex.
   `={{ $json['1'] }}~{{ $json['0'] }}~1~{{ $json['6'] }}`.

**SQL Select filtré**

- Opération `SQL Select`, Simplify activé, requête :
  ```sql
  SELECT TOP (200) [SOHNUM_0], [BPCORD_0], [ORDDAT_0]
  FROM   [SORDER]
  WHERE  1 = 1
  [[AND  [BPCORD_0] = {{customer}}]]
  [[AND  [ORDDAT_0] >= {{from}}]]
  ```
- Query Parameters `customer` (Text) et `from` (Date) : laissez l'un ou l'autre
  vide pour supprimer sa clause.

## 13. Dépannage

| Symptôme | Cause probable |
| --- | --- |
| `405 Method Not Allowed` au test de credential ou à l'exécution | La Base URL est un serveur web, pas le service SOAP — le plus souvent le port manque (`:8124` ou `:8443`). |
| `401` / `403` | Mot de passe Syracuse incorrect, ou utilisateur non autorisé à appeler les web services ([§3.4](#34-droits-de-lutilisateur-syracuse), [§3.5](#35-droit-web-services-de-lutilisateur-x3)). |
| `self-signed certificate` | Activez **Allow Self-Signed Certificates** dans la credential. |
| Timeout / connexion refusée / hôte introuvable | X3 est injoignable : vérifiez la Base URL et le réseau ; augmentez **Request Timeout** si le serveur est seulement lent. |
| `No Pool: <alias>` | Le pool n'est pas lancé ou l'alias est faux ([§3.2](#32-pool-de-web-services-soap)). |
| `Niveau d'accès insuffisant` | L'utilisateur Syracuse n'a pas les droits fonctionnels sur l'objet. |
| `Modification en cours sur un autre poste` | Un Read précédent détient encore le verrou. Enchaînez avec **Pool ID Override**, ou sautez le Read. |
| `Erreur zone [M:...]<champ>` | Contrôle de champ en échec : vérifiez que l'identifiant correspond au champ clé des données, les formats de valeurs et les compteurs. |
| SQL Select renvoie 0 ligne avec un filtre `IN` | Le paramètre est typé Text au lieu de **List**. |
| Les nœuds importés affichent `?` et n8n demande d'installer `n8n-nodes-nx3` | Écart de type entre une installation npm (`n8n-nodes-nx3.nx3Soap`) et une installation par dossier custom (`CUSTOM.nx3Soap`). Modifiez le `type` des nœuds dans le JSON ([§4.2](#42-docker-auto-hébergé-depuis-les-sources)). |
| `Received tool input did not match expected schema` | Un `$fromAI` sans quatrième argument rend le champ obligatoire ([§11.2](#112-rendre-les-filtres-optionnels-vraiment-optionnels)). |
| Le contrôle de licence échoue | Le serveur Runtime X3 ne joint pas l'URL de licence ([§3.3](#33-url-de-licence)). |

Pour signaler un problème, joignez le **nom de la trace X3** renvoyé dans
`trace`.

## 14. Compatibilité

- **n8n 1.x et 2.x** (Nodes API v1). Testé sur n8n 2.17.
- Aucune dépendance à l'exécution : l'analyse des réponses se fait sans
  bibliothèque externe, comme l'exige la vérification n8n Cloud.
- **Sage X3 V12** (`CAdxWebServiceXmlCC`, pile SOAP Apache Axis 1.4) avec le
  sous-programme `XCHATX3OBJ` du patch ChatX3.

## 15. Support et ressources

- 🐛 Bug ou demande d'évolution : [issues GitHub](https://github.com/adrien-ge/n8n-nodes-nx3/issues)
- 💬 Contact : [contact@intellx.chat](mailto:contact@intellx.chat)
- 🌐 [intellx.chat](https://intellx.chat)
- [Documentation n8n des community nodes](https://docs.n8n.io/integrations/#community-nodes)
- [Guide des web services SOAP Sage X3](https://online-help.sageerpx3.com/erp/12/wp-static-content/static-pages/en_US/web-services/Configuration_management.html)

Avant d'ouvrir une issue, vérifiez les [prérequis](#2-prérequis) et joignez le
nom de la trace X3.

## 16. Historique des versions

L'historique complet est dans [CHANGELOG.md](CHANGELOG.md).

- **0.5.2** — Test de credential en vrai POST sur l'endpoint SOAP ; échecs HTTP
  expliqués avec l'URL appelée ; `technicalInfos` désormais optionnel.
- **0.5.1** — Simplify retrouve les noms de colonnes d'une requête qui s'ouvre
  par un commentaire.
- **0.5.0** — Type de paramètre **Contains** ; sortie Simplify réduite à
  `{ rowCount, columns, rows }` ; dates SQL en `YYYY-MM-DD`, `0000-00-00` en
  `null`.
- **0.4.0** — Première publication sur npm : Describe, enveloppe Context, SQL
  Analyse et Select avec Query Parameters et Simplify, Request Timeout et
  erreurs réseau lisibles.
- **0.2.0** — Opérations List et Custom ; Action Code toujours visible ; nœud
  renommé *IntellX for Sage X3*.
- **0.1.0** — Read, Create, Modify, Run Sub-Program ; mode JSON natif X3 ;
  mise en forme de la sortie ; affinité de session ; `usableAsTool`.

---

<p align="center"><sub>IntellX for Sage X3 — Intégration Sage X3 pour n8n</sub></p>
