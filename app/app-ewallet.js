/**
 * APP IRCTC eWallet (STAR app_ewallet.py).
 * bookingInitPayment bankId=1000 txnType=7 → MIN_PAYMENT wait → verifyPayment
 * paramList: juspayResponse (WALLET / close_sdk), withoutOTP=true
 *
 * Status (Ocean): Final Count → Final Hit For Pnr → BOOKED PNR=
 */
const crypto = require('crypto');
const {
  getMinPaymentWaitMs,
  buildVerifyPaymentCookieHeader,
  parseVerifyPaymentResponse,
  waitMinPaymentElapsed,
} = require('./app-ipay-qr');

const MPS_VERIFY_BASE =
  'https://www.mps.irctc.co.in/eticketing/protected/mapps1/verifyPayment';
const APP_UA = 'IRCTC Rail Connect/4.3.12Android';
const EWALLET_BANK_ID = 1000;
const EWALLET_TXN_TYPE = 7;

function log(...a) {
  console.log('[Ocean APP eWallet]', ...a);
}

function buildJuspayResponse() {
  return {
    upi: null,
    txnDetail: null,
    service: 'in.juspay.hyperpay',
    returnUrl: null,
    requestId: crypto.randomUUID(),
    paymentMethodType: null,
    paymentMethod: null,
    paymentGatewayResponse: null,
    payload: {
      statusId: null,
      status: 'close_sdk',
      paymentInstrumentGroup: 'WALLET',
      paymentInstrument: null,
      paymentFlows: null,
      otherInfo: null,
      actionables: null,
      action: 'gatewaySelection',
    },
    orderId: '',
    merchantId: null,
    gatewayId: null,
    errorMessage: '',
    errorCode: '',
    error: false,
    epgTxnId: null,
    card: null,
    bankErrorMessage: null,
    bankErrorCode: null,
    amount: null,
    event: 'process_result',
  };
}

function buildEwalletVerifyBody(paymentData, payAmount, juspayResponse) {
  let amount = payAmount;
  if (amount == null) {
    amount = paymentData?._pay_amount ?? paymentData?.amount;
  }
  const transId =
    paymentData?.transationId || paymentData?.transactionId || 0;
  return {
    amount: amount != null ? Number(amount) : 0.0,
    apiName: null,
    bankId: EWALLET_BANK_ID,
    bankName: null,
    captchaDto: null,
    errorMsg: null,
    juspayLoadDTO: null,
    loyaltyNum: 0,
    paramList: [
      {
        key: 'juspayResponse',
        value: JSON.stringify(juspayResponse),
      },
    ],
    paymentId: null,
    paymentType: null,
    remainingBalance: 0.0,
    serverId: null,
    timeStamp: null,
    transationId: Number(transId) || 0,
    txnDate: null,
    txnStatus: 1,
    txnType: EWALLET_TXN_TYPE,
    upiModeOpted: 0,
    withoutOTP: true,
  };
}

/**
 * @param {{
 *   paymentData: object,
 *   amount: number,
 *   clientTransactionId?: string,
 *   sess?: object,
 *   onStatus?: Function,
 * }} opts
 */
async function runAppEwalletFlow({
  paymentData,
  amount,
  clientTransactionId,
  sess,
  onStatus,
} = {}) {
  const status = (msg) => {
    try {
      if (typeof onStatus === 'function') onStatus(msg);
    } catch (_) {}
    log(msg);
  };

  if (!paymentData) {
    return { ok: false, reason: 'Payment init missing' };
  }

  const cid = String(
    clientTransactionId || paymentData._clientTransactionId || ''
  ).trim();
  if (!cid) {
    return { ok: false, reason: 'clientTransactionId missing' };
  }
  if (!sess?.tokens?.access_token) {
    return { ok: false, reason: 'mapps access_token missing' };
  }

  const minWait = getMinPaymentWaitMs(paymentData);
  const flowStart = Date.now();
  const dispatcher = sess?.dispatcher || null;

  let balance = null;
  for (const item of paymentData.paramList || []) {
    if (item && String(item.key) === 'BALANCE') {
      balance = item.value;
      break;
    }
  }

  log(
    `eWallet start order=${paymentData.transationId || paymentData.transactionId || '?'} minWait=${minWait}ms balance=${balance != null ? balance : 'n/a'}`
  );
  status('APP · eWallet…');

  // Ocean Final Count (same as iPay / Direct eWallet)
  await waitMinPaymentElapsed(flowStart, minWait, status);

  status('Final Hit For Pnr');

  const juspayResponse = buildJuspayResponse();
  const { cookieHeader, cookieNames } = buildVerifyPaymentCookieHeader(paymentData);
  const spa = paymentData._session_spa_csrf || sess.spaCsrf || '';
  const greq = paymentData._session_greq || sess.uid || '';
  const mup = paymentData._session_mup || sess.mup || '';
  const body22 = buildEwalletVerifyBody(paymentData, amount, juspayResponse);
  const url22 = `${MPS_VERIFY_BASE}/${cid}`;
  const headers22 = {
    Accept: 'application/json',
    Authorization: `bearer ${sess.tokens.access_token}`,
    greq,
    'User-Agent': APP_UA,
    mup,
    bmirak: 'androidbm',
    'Content-Language': 'en',
    'Accept-Language': 'en-US,en;q=0.0',
    bmiyek: sess.tokens.refresh_token || '',
    'spa-csrf-token': spa,
    'Content-Type': 'application/json ; charset=UTF-8',
    'Accept-Encoding': 'gzip',
  };
  if (cookieHeader) headers22.Cookie = cookieHeader;

  log(
    `verifyPayment/${cid} cookies=${cookieNames.length}/6 spa=${spa ? spa.slice(0, 12) + '…' : 'EMPTY'} requestId=${juspayResponse.requestId}`
  );

  const undiciFetch = require('undici').fetch;
  const fetchFn = dispatcher ? undiciFetch : fetch;
  const res22 = await fetchFn(url22, {
    method: 'POST',
    headers: headers22,
    body: JSON.stringify(body22),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text22 = await res22.text();
  log(`verifyPayment ← ${res22.status} len=${text22.length}`);

  if (res22.status !== 200) {
    const msg = `verifyPayment HTTP ${res22.status}`;
    status(msg);
    return {
      ok: false,
      reason: msg,
      captured: true,
      verifyText: text22.slice(0, 400),
    };
  }

  try {
    const nextCsrf =
      res22.headers.get('csrf-token') ||
      res22.headers.get('spa-csrf-token') ||
      '';
    if (nextCsrf && sess) sess.spaCsrf = nextCsrf;
  } catch (_) {}

  const parsed22 = parseVerifyPaymentResponse(text22);
  if (!parsed22.pnr) {
    const msg = parsed22.userMessage || 'PNR missing';
    status(msg);
    return {
      ok: false,
      reason: msg,
      captured: true,
      verifyPayment: parsed22.data,
      userMessage: msg,
    };
  }

  status(`BOOKED PNR=${parsed22.pnr}`);
  return {
    ok: true,
    captured: true,
    pnr: String(parsed22.pnr),
    reservationId: parsed22.reservationId,
    verifyPayment: parsed22.data,
    paymentData,
    juspayResponse,
    minWait,
  };
}

module.exports = {
  runAppEwalletFlow,
  EWALLET_BANK_ID,
  EWALLET_TXN_TYPE,
};
