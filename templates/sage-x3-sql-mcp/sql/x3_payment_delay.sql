/* Payment delays on fully settled due dates, customers (receivables) and suppliers (payables),
   aggregated by GROUPING SETS. The level filter picks the row family to return. */
SELECT
    AGG.LEVEL               AS LEVEL,
    AGG.PARTNER_TYPE        AS PARTNER_TYPE,
    AGG.YEAR                AS YEAR,
    AGG.MONTH               AS MONTH,
    AGG.SITE                AS SITE,
    AGG.PARTNER_CODE        AS PARTNER_CODE,
    AGG.PARTNER_NAME        AS PARTNER_NAME,
    AGG.DUE_COUNT           AS DUE_COUNT,
    AGG.AVG_PAYMENT_DAYS    AS AVG_PAYMENT_DAYS,
    AGG.AVG_LATE_DAYS       AS AVG_LATE_DAYS,
    AGG.MAX_LATE_DAYS       AS MAX_LATE_DAYS,
    AGG.LATE_COUNT          AS LATE_COUNT,
    AGG.LATE_PCT            AS LATE_PCT
FROM (
    SELECT
        CASE
            WHEN GROUPING(CA.SITE) = 0 AND GROUPING(CA.PARTNER_CODE) = 0 AND GROUPING(CA.YEAR) = 0 THEN 'SitePartnerMonth'
            WHEN GROUPING(CA.SITE) = 0 AND GROUPING(CA.PARTNER_CODE) = 0                           THEN 'SitePartner'
            WHEN GROUPING(CA.SITE) = 0 AND GROUPING(CA.YEAR) = 0                                   THEN 'SiteMonth'
            WHEN GROUPING(CA.PARTNER_CODE) = 0 AND GROUPING(CA.YEAR) = 0                           THEN 'PartnerMonth'
            WHEN GROUPING(CA.SITE) = 0                                                             THEN 'Site'
            WHEN GROUPING(CA.PARTNER_CODE) = 0                                                     THEN 'Partner'
            WHEN GROUPING(CA.YEAR) = 0                                                             THEN 'Month'
            ELSE 'Total'
        END                                                             AS LEVEL,
        CA.PARTNER_TYPE,
        CA.YEAR,
        CA.MONTH,
        CA.SITE,
        CA.PARTNER_CODE,
        CASE WHEN GROUPING(CA.PARTNER_CODE) = 0 THEN MAX(CA.PARTNER_NAME) END AS PARTNER_NAME,
        COUNT(*)                                                        AS DUE_COUNT,
        AVG(CA.PAYMENT_DAYS * 1.0)                                      AS AVG_PAYMENT_DAYS,
        AVG(CA.LATE_DAYS * 1.0)                                         AS AVG_LATE_DAYS,
        MAX(CA.LATE_DAYS)                                               AS MAX_LATE_DAYS,
        SUM(CASE WHEN CA.LATE_DAYS > 0 THEN 1 ELSE 0 END)               AS LATE_COUNT,
        100.0 * SUM(CASE WHEN CA.LATE_DAYS > 0 THEN 1 ELSE 0 END) / COUNT(*) AS LATE_PCT
    FROM (

    /* ---------- Customers ---------- */
    SELECT
        'Customer'                                  AS PARTNER_TYPE,
        D.FCY_0                                     AS SITE,
        D.BPR_0                                     AS PARTNER_CODE,
        BPR.BPRNAM_0                                AS PARTNER_NAME,
        D.NUM_0                                     AS DOCUMENT,
        MAX(H.ACCDAT_0)                             AS PAYMENT_DATE,
        YEAR(MAX(H.ACCDAT_0))                       AS YEAR,
        MONTH(MAX(H.ACCDAT_0))                      AS MONTH,
        DATEDIFF(DAY, I.ACCDAT_0, MAX(H.ACCDAT_0))  AS PAYMENT_DAYS,
        DATEDIFF(DAY, D.DUDDAT_0, MAX(H.ACCDAT_0))  AS LATE_DAYS
    FROM GACCDUDATE D
    INNER JOIN BPCUSTOMER C  ON C.BPCNUM_0 = D.BPR_0
    LEFT  JOIN BPARTNER  BPR ON BPR.BPRNUM_0 = D.BPR_0
    LEFT  JOIN SINVOICE  I   ON I.NUM_0 = D.NUM_0
    INNER JOIN PAYMENTD  P   ON P.VCRNUM_0 = D.NUM_0
    INNER JOIN PAYMENTH  H   ON H.NUM_0 = P.NUM_0
    WHERE (D.AMTCUR_0 - D.PAYCUR_0) = 0
    GROUP BY D.FCY_0, D.BPR_0, BPR.BPRNAM_0, D.NUM_0, D.DUDDAT_0, I.ACCDAT_0

    UNION ALL

    /* ---------- Suppliers ---------- */
    SELECT
        'Supplier',
        D.FCY_0,
        D.BPR_0,
        BPR.BPRNAM_0,
        D.NUM_0,
        MAX(H.ACCDAT_0),
        YEAR(MAX(H.ACCDAT_0)),
        MONTH(MAX(H.ACCDAT_0)),
        DATEDIFF(DAY, I.ACCDAT_0, MAX(H.ACCDAT_0)),
        DATEDIFF(DAY, D.DUDDAT_0, MAX(H.ACCDAT_0))
    FROM GACCDUDATE D
    INNER JOIN BPSUPPLIER S  ON S.BPSNUM_0 = D.BPR_0
    LEFT  JOIN BPARTNER  BPR ON BPR.BPRNUM_0 = D.BPR_0
    LEFT  JOIN PINVOICE  I   ON I.NUM_0 = D.NUM_0
    INNER JOIN PAYMENTD  P   ON P.VCRNUM_0 = D.NUM_0
    INNER JOIN PAYMENTH  H   ON H.NUM_0 = P.NUM_0
    WHERE (D.AMTCUR_0 - D.PAYCUR_0) = 0
    GROUP BY D.FCY_0, D.BPR_0, BPR.BPRNAM_0, D.NUM_0, D.DUDDAT_0, I.ACCDAT_0

    ) CA
    WHERE 1 = 1
    /*FILTERS*/
    GROUP BY GROUPING SETS (
        (CA.PARTNER_TYPE),
        (CA.PARTNER_TYPE, CA.SITE),
        (CA.PARTNER_TYPE, CA.PARTNER_CODE),
        (CA.PARTNER_TYPE, CA.YEAR, CA.MONTH),
        (CA.PARTNER_TYPE, CA.SITE, CA.PARTNER_CODE),
        (CA.PARTNER_TYPE, CA.SITE, CA.YEAR, CA.MONTH),
        (CA.PARTNER_TYPE, CA.PARTNER_CODE, CA.YEAR, CA.MONTH),
        (CA.PARTNER_TYPE, CA.SITE, CA.PARTNER_CODE, CA.YEAR, CA.MONTH)
    )
) AGG
WHERE 1 = 1
/*FILTERS:level*/
ORDER BY AGG.LEVEL, AGG.PARTNER_TYPE, AGG.SITE, AGG.PARTNER_CODE, AGG.YEAR, AGG.MONTH
