// 地区与时区常量

/**
 * Anthropic 支持地区（Claude.ai 与 API 两份列表相同）
 * 来源：https://www.anthropic.com/supported-countries ，2026-09-30 抓取
 */
export const SUPPORTED_COUNTRIES = new Set(
  (
    'AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CO KM CD CG CR ' +
    'CI HR CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IQ IE ' +
    'IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ NA NR ' +
    'NP NL NZ NI NE NG MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SO SB ' +
    'ZA KR SS ES LK SD SR SE CH TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VN ZM ZW'
  ).split(' '),
);

/** 中国大陆时区（含历史别名） */
export const CN_TIMEZONES = ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Kashgar'];

/** 香港 / 澳门：Claude 不支持地区 */
export const HKMO_TIMEZONES = ['Asia/Hong_Kong', 'Asia/Macau'];

/** 使用中文的地区：IP 在这些地区时浏览器用中文不算矛盾 */
export const ZH_SPEAKING = new Set(['CN', 'HK', 'MO', 'TW', 'SG', 'MY']);
