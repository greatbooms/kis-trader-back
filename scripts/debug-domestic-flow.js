#!/usr/bin/env node
require('dotenv').config();

const { Client } = require('pg');
const axios = require('axios');

const stockCode = process.argv[2] || '005930';

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
  const response = await axios.get(`${process.env.KIS_BASE_URL || 'https://openapi.koreainvestment.com:9443'}${path}`, {
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

function pickRows(payload) {
  if (Array.isArray(payload?.output)) return payload.output;
  if (Array.isArray(payload?.output1)) return payload.output1;
  if (Array.isArray(payload?.output2)) return payload.output2;
  return [];
}

async function main() {
  const tokenRow = await getStoredToken();
  if (!tokenRow?.access_token) {
    throw new Error('No stored KIS token found in kis_tokens');
  }

  const investorParams = {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: stockCode,
    FID_INPUT_DATE_1: kstDateOffset(-30),
    FID_INPUT_DATE_2: kstDateOffset(0),
    FID_ORG_ADJ_PRC: '',
    FID_ETC_CLS_CODE: '1',
  };

  const aggregateParams = {
    FID_COND_MRKT_DIV_CODE: 'V',
    FID_COND_SCR_DIV_CODE: '16449',
    FID_INPUT_ISCD: '0000',
    FID_DIV_CLS_CODE: '0',
    FID_RANK_SORT_CLS_CODE: '0',
    FID_ETC_CLS_CODE: '0',
  };

  const [investorDaily, aggregate] = await Promise.all([
    kisGet(
      '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      'FHPTJ04160001',
      investorParams,
      tokenRow.access_token,
    ),
    kisGet(
      '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
      'FHPTJ04400000',
      aggregateParams,
      tokenRow.access_token,
    ),
  ]);

  const investorRows = pickRows(investorDaily);
  const aggregateRows = pickRows(aggregate);
  const aggregateMatch = aggregateRows.find((row) => row.mksc_shrn_iscd === stockCode) || null;

  console.log(JSON.stringify({
    tokenCreatedAt: tokenRow.created_at,
    tokenExpiresAt: tokenRow.expires_at,
    stockCode,
    investorParams,
    investorMeta: {
      rt_cd: investorDaily.rt_cd,
      msg_cd: investorDaily.msg_cd,
      msg1: investorDaily.msg1,
      count: investorRows.length,
      sample: investorRows.slice(0, 3),
    },
    aggregateParams,
    aggregateMeta: {
      rt_cd: aggregate.rt_cd,
      msg_cd: aggregate.msg_cd,
      msg1: aggregate.msg1,
      count: aggregateRows.length,
      match: aggregateMatch,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
