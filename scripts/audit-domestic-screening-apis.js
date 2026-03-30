#!/usr/bin/env node
require('dotenv').config();

const { Client } = require('pg');
const axios = require('axios');

const stockCode = process.argv[2] || '005930';
const baseUrl = process.env.KIS_BASE_URL || 'https://openapi.koreainvestment.com:9443';

function kstDateOffset(days) {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

async function getStoredToken() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(
    'select access_token, expires_at, created_at from kis_tokens order by created_at desc limit 1',
  );
  await client.end();
  return result.rows[0];
}

async function kisGet(path, trId, params, token) {
  const response = await axios.get(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: 'P',
    },
    params,
    timeout: 60_000,
  });
  return response.data;
}

function summarizeValue(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      kind: 'array',
      count: value.length,
      sampleKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 20) : [],
      sample: first && typeof first === 'object'
        ? Object.fromEntries(Object.entries(first).slice(0, 12))
        : first,
    };
  }
  if (value && typeof value === 'object') {
    return {
      kind: 'object',
      keys: Object.keys(value).slice(0, 20),
      sample: Object.fromEntries(Object.entries(value).slice(0, 12)),
    };
  }
  return { kind: typeof value, value };
}

async function main() {
  const tokenRow = await getStoredToken();
  if (!tokenRow?.access_token) {
    throw new Error('No stored KIS token found in kis_tokens');
  }

  const today = kstDateOffset(0);
  const past30 = kstDateOffset(-30);
  const past320 = kstDateOffset(-320);
  const past3650 = kstDateOffset(-3650);

  const calls = [
    {
      name: 'volume-rank',
      path: '/uapi/domestic-stock/v1/quotations/volume-rank',
      trId: 'FHPST01710000',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20171',
        FID_INPUT_ISCD: '0000',
        FID_DIV_CLS_CODE: '0',
        FID_BLNG_CLS_CODE: '0',
        FID_TRGT_CLS_CODE: '111111111',
        FID_TRGT_EXLS_CLS_CODE: '0000000000',
        FID_INPUT_PRICE_1: '',
        FID_INPUT_PRICE_2: '',
        FID_VOL_CNT: '',
        FID_INPUT_DATE_1: '',
      },
    },
    {
      name: 'foreign-institution-total',
      path: '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
      trId: 'FHPTJ04400000',
      params: {
        FID_COND_MRKT_DIV_CODE: 'V',
        FID_COND_SCR_DIV_CODE: '16449',
        FID_INPUT_ISCD: '0000',
        FID_DIV_CLS_CODE: '0',
        FID_RANK_SORT_CLS_CODE: '0',
        FID_ETC_CLS_CODE: '0',
      },
    },
    {
      name: 'inquire-price',
      path: '/uapi/domestic-stock/v1/quotations/inquire-price',
      trId: 'FHKST01010100',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
      },
    },
    {
      name: 'daily-itemchartprice',
      path: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      trId: 'FHKST03010100',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: past320,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    },
    {
      name: 'financial-ratio',
      path: '/uapi/domestic-stock/v1/finance/financial-ratio',
      trId: 'FHKST66430300',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'growth-ratio',
      path: '/uapi/domestic-stock/v1/finance/growth-ratio',
      trId: 'FHKST66430800',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'profit-ratio',
      path: '/uapi/domestic-stock/v1/finance/profit-ratio',
      trId: 'FHKST66430400',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'other-major-ratios',
      path: '/uapi/domestic-stock/v1/finance/other-major-ratios',
      trId: 'FHKST66430500',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'income-statement',
      path: '/uapi/domestic-stock/v1/finance/income-statement',
      trId: 'FHKST66430200',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'stability-ratio',
      path: '/uapi/domestic-stock/v1/finance/stability-ratio',
      trId: 'FHKST66430600',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'balance-sheet',
      path: '/uapi/domestic-stock/v1/finance/balance-sheet',
      trId: 'FHKST66430100',
      params: {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    },
    {
      name: 'dividend-schedule',
      path: '/uapi/domestic-stock/v1/ksdinfo/dividend',
      trId: 'HHKDB669102C0',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        CTS: '',
        GB1: '0',
        F_DT: past3650,
        T_DT: today,
        SHT_CD: stockCode,
        HIGH_GB: '',
      },
    },
    {
      name: 'invest-opinion',
      path: '/uapi/domestic-stock/v1/quotations/invest-opinion',
      trId: 'FHKST663300C0',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '16633',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: '',
        FID_INPUT_DATE_2: '',
      },
    },
    {
      name: 'estimate-perform',
      path: '/uapi/domestic-stock/v1/quotations/estimate-perform',
      trId: 'HHKST668300C0',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        SHT_CD: stockCode,
      },
    },
    {
      name: 'investor-trade-by-stock-daily',
      path: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      trId: 'FHPTJ04160001',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: past30,
        FID_INPUT_DATE_2: today,
        FID_ORG_ADJ_PRC: '',
        FID_ETC_CLS_CODE: '1',
      },
    },
    {
      name: 'daily-short-sale',
      path: '/uapi/domestic-stock/v1/quotations/daily-short-sale',
      trId: 'FHPST04830000',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: past30,
        FID_INPUT_DATE_2: today,
      },
    },
    {
      name: 'daily-credit-balance',
      path: '/uapi/domestic-stock/v1/quotations/daily-credit-balance',
      trId: 'FHPST04760000',
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20476',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: '',
        FID_INPUT_DATE_2: '',
      },
    },
    {
      name: 'comp-interest',
      path: '/uapi/domestic-stock/v1/quotations/comp-interest',
      trId: 'FHPST07020000',
      params: {
        FID_COND_MRKT_DIV_CODE: 'I',
        FID_COND_SCR_DIV_CODE: '20702',
        FID_DIV_CLS_CODE: '1',
        FID_DIV_CLS_CODE1: '',
      },
    },
  ];

  const report = [];
  for (const call of calls) {
    try {
      const payload = await kisGet(call.path, call.trId, call.params, tokenRow.access_token);
      report.push({
        name: call.name,
        path: call.path,
        trId: call.trId,
        params: call.params,
        rt_cd: payload.rt_cd,
        msg_cd: payload.msg_cd,
        msg1: payload.msg1,
        output: summarizeValue(payload.output),
        output1: summarizeValue(payload.output1),
        output2: summarizeValue(payload.output2),
      });
    } catch (error) {
      report.push({
        name: call.name,
        path: call.path,
        trId: call.trId,
        params: call.params,
        error: error.message,
      });
    }
  }

  console.log(JSON.stringify({
    stockCode,
    tokenCreatedAt: tokenRow.created_at,
    tokenExpiresAt: tokenRow.expires_at,
    report,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
