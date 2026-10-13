/* Revenue aggregated on the database side, converted to EUR, billed and ordered horizons.
   The level filter picks the GROUPING SETS row family to return. */
SELECT
    AGG.LEVEL               AS LEVEL,
    AGG.REVENUE_TYPE        AS REVENUE_TYPE,
    AGG.YEAR                AS YEAR,
    AGG.MONTH               AS MONTH,
    AGG.CUSTOMER_CODE       AS CUSTOMER_CODE,
    AGG.CUSTOMER_NAME       AS CUSTOMER_NAME,
    AGG.ITEM                AS ITEM,
    AGG.DESCRIPTION         AS DESCRIPTION,
    AGG.DOCUMENT_COUNT      AS DOCUMENT_COUNT,
    AGG.LINE_COUNT          AS LINE_COUNT,
    AGG.LINES_WITHOUT_RATE  AS LINES_WITHOUT_RATE,
    AGG.QUANTITY            AS QUANTITY,
    AGG.REVENUE_EUR         AS REVENUE_EUR
FROM (
    SELECT
        CASE
            WHEN GROUPING(CA.YEAR) = 0                                     THEN 'Month'
            WHEN GROUPING(CA.CUSTOMER_CODE) = 0 AND GROUPING(CA.ITEM) = 0  THEN 'CustomerItem'
            WHEN GROUPING(CA.CUSTOMER_CODE) = 0                            THEN 'Customer'
            WHEN GROUPING(CA.ITEM) = 0                                     THEN 'Item'
            ELSE 'Total'
        END                                                         AS LEVEL,
        CA.REVENUE_TYPE,
        CA.YEAR,
        CA.MONTH,
        CA.CUSTOMER_CODE,
        CASE WHEN GROUPING(CA.CUSTOMER_CODE) = 0 THEN MAX(CA.CUSTOMER_NAME) END AS CUSTOMER_NAME,
        CA.ITEM,
        CASE WHEN GROUPING(CA.ITEM) = 0 THEN MAX(CA.DESCRIPTION) END AS DESCRIPTION,
        COUNT(DISTINCT CA.DOCUMENT)                             AS DOCUMENT_COUNT,
        COUNT(*)                                                AS LINE_COUNT,
        SUM(CASE WHEN CA.AMOUNT_EUR IS NULL THEN 1 ELSE 0 END)  AS LINES_WITHOUT_RATE,
        SUM(CA.QUANTITY)                                        AS QUANTITY,
        SUM(CA.AMOUNT_EUR)                                      AS REVENUE_EUR
    FROM (

    /* ---------- Billed ---------- */
    SELECT
        'Billed' AS REVENUE_TYPE,
        SID.NUM_0     AS DOCUMENT,
        SID.SIDLIN_0  AS LINE,
        YEAR(SIE.ACCDAT_0)                 AS YEAR,
        MONTH(SIE.ACCDAT_0)                AS MONTH,
        SID.BPCINV_0                       AS CUSTOMER_CODE,
        BPR.BPRNAM_0                       AS CUSTOMER_NAME,
        SID.ITMREF_0                       AS ITEM,
        ISNULL(NULLIF(DES1.LABEL, ''), ITM.ITMDES1_0) AS DESCRIPTION,
        ITM.TCLCOD_0                       AS X3_CATEGORY,
        SID.SALFCY_0                       AS SITE,
        (CASE ISNULL(TIV.INVTYP_0, 1) WHEN 2 THEN -1 WHEN 4 THEN -1 WHEN 5 THEN 0 ELSE 1 END) * SID.QTY_0 AS QUANTITY,
        SIE.CUR_0                          AS CURRENCY,
        (CASE ISNULL(TIV.INVTYP_0, 1) WHEN 2 THEN -1 WHEN 4 THEN -1 WHEN 5 THEN 0 ELSE 1 END) * SID.AMTNOTLIN_0
        * CASE WHEN SIE.CUR_0 = 'EUR' THEN 1 ELSE COALESCE(
            (SELECT TOP (1) TCH.CHGRAT_0
               FROM TABCHANGE TCH
              WHERE TCH.CUR_0 = SIE.CUR_0 AND TCH.CURDEN_0 = 'EUR' AND TCH.CHGTYP_0 = 1
                AND TCH.CHGSTRDAT_0 <= SIE.ACCDAT_0
              ORDER BY TCH.CHGSTRDAT_0 DESC),
            (SELECT TOP (1) 1.0 / NULLIF(TCH.CHGRAT_0, 0)
               FROM TABCHANGE TCH
              WHERE TCH.CUR_0 = 'EUR' AND TCH.CURDEN_0 = SIE.CUR_0 AND TCH.CHGTYP_0 = 1
                AND TCH.CHGSTRDAT_0 <= SIE.ACCDAT_0
              ORDER BY TCH.CHGSTRDAT_0 DESC)
        ) END                              AS AMOUNT_EUR
    FROM SINVOICED SID
    JOIN SINVOICE  SIE ON SIE.NUM_0 = SID.NUM_0
    LEFT JOIN TABSIVTYP TIV ON TIV.SIVTYP_0 = SIE.SIVTYP_0
    LEFT JOIN ITMMASTER ITM ON ITM.ITMREF_0 = SID.ITMREF_0
    LEFT JOIN (
        SELECT RTRIM(IDENT1_0) AS ITMREF, MAX(TEXTE_0) AS LABEL
        FROM   ATEXTRA WHERE CODFIC_0 = 'ITMMASTER' AND ZONE_0 = 'DES1AXX' AND LANGUE_0 = {{lang}}
        GROUP  BY RTRIM(IDENT1_0)
    ) DES1 ON DES1.ITMREF = RTRIM(ITM.ITMREF_0)
    LEFT JOIN BPARTNER BPR ON BPR.BPRNUM_0 = SID.BPCINV_0
    WHERE 1 = 1
    /*FILTERS:billed*/

    UNION ALL

    /* ---------- Ordered, not yet invoiced ---------- */
    SELECT
        'Ordered',
        SOQ.SOHNUM_0,
        SOQ.SOPLIN_0,
        YEAR(SOQ.SHIDAT_0),
        MONTH(SOQ.SHIDAT_0),
        SOQ.BPCORD_0,
        BPC.BPCNAM_0,
        SOQ.ITMREF_0,
        ISNULL(NULLIF(DES1.LABEL, ''), ITM.ITMDES1_0),
        ITM.TCLCOD_0,
        SOQ.STOFCY_0,
        (SOQ.QTY_0 - ISNULL(SOQ.INVQTY_0, 0)),
        SOH.CUR_0,
        (SOQ.QTY_0 - ISNULL(SOQ.INVQTY_0, 0)) * SOP.NETPRI_0
        * CASE WHEN SOH.CUR_0 = 'EUR' THEN 1 ELSE COALESCE(
            (SELECT TOP (1) TCH.CHGRAT_0
               FROM TABCHANGE TCH
              WHERE TCH.CUR_0 = SOH.CUR_0 AND TCH.CURDEN_0 = 'EUR' AND TCH.CHGTYP_0 = 1
                AND TCH.CHGSTRDAT_0 <= SOH.ORDDAT_0
              ORDER BY TCH.CHGSTRDAT_0 DESC),
            (SELECT TOP (1) 1.0 / NULLIF(TCH.CHGRAT_0, 0)
               FROM TABCHANGE TCH
              WHERE TCH.CUR_0 = 'EUR' AND TCH.CURDEN_0 = SOH.CUR_0 AND TCH.CHGTYP_0 = 1
                AND TCH.CHGSTRDAT_0 <= SOH.ORDDAT_0
              ORDER BY TCH.CHGSTRDAT_0 DESC)
        ) END
    FROM SORDERQ SOQ
    JOIN SORDERP SOP ON SOP.SOHNUM_0 = SOQ.SOHNUM_0 AND SOP.SOPLIN_0 = SOQ.SOPLIN_0
    LEFT JOIN SORDER SOH     ON SOH.SOHNUM_0 = SOQ.SOHNUM_0
    LEFT JOIN BPCUSTOMER BPC ON BPC.BPCNUM_0 = SOQ.BPCORD_0
    LEFT JOIN ITMMASTER  ITM ON ITM.ITMREF_0 = SOQ.ITMREF_0
    LEFT JOIN (
        SELECT RTRIM(IDENT1_0) AS ITMREF, MAX(TEXTE_0) AS LABEL
        FROM   ATEXTRA WHERE CODFIC_0 = 'ITMMASTER' AND ZONE_0 = 'DES1AXX' AND LANGUE_0 = {{lang}}
        GROUP  BY RTRIM(IDENT1_0)
    ) DES1 ON DES1.ITMREF = RTRIM(ITM.ITMREF_0)
    WHERE SOQ.SOQSTA_0 < 3   -- open lines only
    /*FILTERS:ordered*/

    ) CA
    WHERE 1 = 1
    /*FILTERS*/
    GROUP BY GROUPING SETS (
        (CA.REVENUE_TYPE),
        (CA.REVENUE_TYPE, CA.YEAR, CA.MONTH),
        (CA.REVENUE_TYPE, CA.CUSTOMER_CODE),
        (CA.REVENUE_TYPE, CA.ITEM),
        (CA.REVENUE_TYPE, CA.CUSTOMER_CODE, CA.ITEM)
    )
) AGG
WHERE 1 = 1
/*FILTERS:level*/
ORDER BY AGG.LEVEL, AGG.REVENUE_TYPE, AGG.YEAR, AGG.MONTH, AGG.REVENUE_EUR DESC
