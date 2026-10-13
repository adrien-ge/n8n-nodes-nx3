/* Sage X3 object dictionary (AOBJET) with labels, module, main table, main screen, primary key
   and the functions that manage the object (AFONCTION type 2 named GES + object code). */
SELECT
    O.ABREV_0                                   AS OBJECT_CODE,
    ISNULL(TO_.TEXTE_0, '')                     AS OBJECT_LABEL,
    O.MODULE_0                                  AS MODULE_CODE,
    ISNULL(ML_MOD.LANMES_0, 'Unknown') + ' (' + CAST(ISNULL(O.MODULE_0, 0) AS VARCHAR(10)) + ')' AS MODULE_LABEL,
    O.NOMFIC_0                                  AS MAIN_TABLE,
    ISNULL(TT.TEXTE_0, '')                      AS MAIN_TABLE_LABEL,
    ISNULL(IDX.DESCRIPT_0, '')                  AS PRIMARY_KEY,
    O.SELCLE_0                                  AS MAIN_SCREEN,
    O.MENU_0                                    AS MENU_CODE,
    F.CODINT_0                                  AS FUNCTION_CODE,
    ISNULL(TF.TEXTE_0, '')                      AS FUNCTION_LABEL,
    (SELECT COUNT(*) FROM AFONCTION F2 WHERE F2.MENU_0 = O.MENU_0 AND O.MENU_0 <> '') AS FUNCTIONS_ON_SAME_MENU
FROM AOBJET O
LEFT JOIN ATEXTE TO_ ON TO_.NUMERO_0 = O.LIBEL_0 AND TO_.LAN_0 = {{lang}}
LEFT JOIN APLSTD ML_MOD ON ML_MOD.LAN_0 = {{lang}} AND ML_MOD.LANCHP_0 = 14 AND ML_MOD.LANNUM_0 = O.MODULE_0
LEFT JOIN ATABLE T ON T.CODFIC_0 = O.NOMFIC_0
LEFT JOIN ATEXTE TT ON TT.NUMERO_0 = T.INTITFIC_0 AND TT.LAN_0 = {{lang}}
LEFT JOIN ATABIND IDX ON IDX.CODFIC_0 = O.NOMFIC_0 AND IDX.NUMLIG_0 = 0
LEFT JOIN AFONCTION F ON F.TYP_0 = 2 AND F.CODINT_0 = 'GES' + RTRIM(O.ABREV_0)
LEFT JOIN ATEXTE TF ON TF.NUMERO_0 = F.NOM_0 AND TF.LAN_0 = {{lang}}
WHERE O.NOMFIC_0 <> ''
/*FILTERS*/
ORDER BY O.MODULE_0, O.ABREV_0
