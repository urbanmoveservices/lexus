/**
 * APP Razorpay UPI Collect (STAR app_razorpayupi.py).
 * bookingInitPayment bankId=141 + gatewayId=23 → Juspay UPI_COLLECT
 * → poll CHARGED → verifyPayment (juspayResponse) → PNR
 *
 * Status: Waiting for UPI payment… / Payment Successful / Final Hit For Pnr
 * (same Ocean panel animation as iPay / Direct).
 */
const crypto = require('crypto');
const { sleep } = require('./app-http');
const {
  getMinPaymentWaitMs,
  buildVerifyPaymentCookieHeader,
  parseVerifyPaymentResponse,
  waitMinPaymentElapsed,
} = require('./app-ipay-qr');

const JUSPAY_TXNS_URL = 'https://api-ns2.juspay.in/txns';
const JUSPAY_STATUS_URL = 'https://api-ns2.juspay.in/order/payment-status';
const MPS_VERIFY_BASE =
  'https://www.mps.irctc.co.in/eticketing/protected/mapps1/verifyPayment';

const APP_UA = 'IRCTC Rail Connect/4.3.12Android';
const APP_RAZORPAY_BANK_ID = 141;
const APP_RAZORPAY_GATEWAY_ID = 23;
const APP_RAZORPAY_TXN_TYPE = 13;
const VERIFY_UPI_TIMEOUT_SEC = 300;
const VERIFY_UPI_POLL_INTERVAL_SEC = 2;

function log(...a) {
  console.log('[Ocean APP Razorpay]', ...a);
}

function normalizeJuspayLoad(paymentData) {
  const raw = paymentData?.juspayLoadDTO;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function orderIdFromPayment(paymentData) {
  return String(
    paymentData?.transationId || paymentData?.transactionId || ''
  ).trim();
}

function buildTxnsFormBody(juspayLoad, upiVpa) {
  let orderDetails = juspayLoad.orderDetails || '';
  if (typeof orderDetails === 'object') {
    orderDetails = JSON.stringify(orderDetails);
  }
  let orderId = '';
  try {
    orderId = String(JSON.parse(orderDetails).order_id || '');
  } catch (_) {}
  if (!orderId) orderId = String(juspayLoad.order_id || '');

  const metadata = JSON.stringify({
    pp_mode: 'RELEASE',
    payment_channel: 'ANDROID',
    microapp: 'hyperpay',
  });

  const fields = {
    upi_vpa: upiVpa,
    txn_type: 'UPI_COLLECT',
    signature: juspayLoad.signature || '',
    save_to_locker: 'true',
    redirect_after_payment: 'true',
    payment_method_type: 'UPI',
    payment_method: 'UPI',
    payment_channel: 'ANDROID',
    order_id: orderId,
    order_details: orderDetails,
    metadata,
    merchant_key_id: String(
      juspayLoad.merchantKeyID || juspayLoad.merchant_key_id || ''
    ),
    merchant_id: String(juspayLoad.merchant_id || 'irctc'),
    format: 'json',
    additional_payment_details: '[]',
    add_merchant_return_url: 'true',
    payment_page_client_id: 'irctc',
  };
  return new URLSearchParams(fields).toString();
}

function buildPaymentStatusUrl(juspayLoad) {
  let orderDetails = juspayLoad.orderDetails || '';
  if (typeof orderDetails === 'object') {
    orderDetails = JSON.stringify(orderDetails);
  }
  let orderId = '';
  try {
    orderId = String(JSON.parse(orderDetails).order_id || '');
  } catch (_) {}
  const params = new URLSearchParams({
    signature_payload: orderDetails,
    signature: String(juspayLoad.signature || ''),
    order_id: orderId,
    merchant_key_id: String(juspayLoad.merchantKeyID || ''),
    merchant_id: String(juspayLoad.merchant_id || 'irctc'),
  });
  return `${JUSPAY_STATUS_URL}?${params.toString()}`;
}

async function juspayFetch(url, { method = 'GET', headers = {}, body = null, dispatcher = null } = {}) {
  const opts = { method, headers, body };
  if (dispatcher) opts.dispatcher = dispatcher;
  const undiciFetch = require('undici').fetch;
  const res = await (dispatcher ? undiciFetch(url, opts) : fetch(url, opts));
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function postJuspayTxnsCollect(juspayLoad, upiVpa, dispatcher) {
  const body = buildTxnsFormBody(juspayLoad, upiVpa);
  log(`Juspay UPI_COLLECT → ${upiVpa}`);
  const res = await juspayFetch(JUSPAY_TXNS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': APP_UA,
    },
    body,
    dispatcher,
  });
  log(`txns ← ${res.status} len=${res.text.length}`);
  if (res.status !== 200) {
    log('txns fail body', res.text.slice(0, 300));
    return null;
  }
  try {
    const data = JSON.parse(res.text);
    return {
      json: data,
      order_id: data.order_id,
      txn_uuid: data.txn_uuid,
    };
  } catch (_) {
    return null;
  }
}

async function pollJuspayPaymentStatus(juspayLoad, { status, dispatcher, showWaiting }) {
  const url = buildPaymentStatusUrl(juspayLoad);
  const headers = {
    Accept: 'application/json',
    'User-Agent': APP_UA,
  };
  const deadline = Date.now() + VERIFY_UPI_TIMEOUT_SEC * 1000;
  let attempt = 0;
  log(`poll payment-status (max ${VERIFY_UPI_TIMEOUT_SEC}s)`);

  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await juspayFetch(url, { headers, dispatcher });
      if (res.status === 200 && res.text) {
        const data = JSON.parse(res.text);
        const st = String(data.status || '').toUpperCase();
        if (attempt === 1 || st !== 'PENDING_VBV') {
          log(`poll #${attempt} status=${st}`);
        }
        if (st === 'CHARGED') {
          if (typeof status === 'function') status('Payment Successful');
          return data;
        }
        if (
          st === 'FAILED' ||
          st === 'AUTHORIZATION_FAILED' ||
          st === 'AUTHENTICATION_FAILED'
        ) {
          log('payment failed', data.bank_error_message || st);
          return null;
        }
      }
    } catch (e) {
      log('poll error', e.message || e);
    }
    if (showWaiting && typeof status === 'function') {
      status('Waiting for UPI payment…');
    }
    await sleep(VERIFY_UPI_POLL_INTERVAL_SEC * 1000);
  }
  log('payment poll timeout');
  return null;
}

function buildJuspayResponseFromCharged(charged, juspayLoad, upiVpa) {
  let gatewayId = APP_RAZORPAY_GATEWAY_ID;
  try {
    const od = JSON.parse(juspayLoad.orderDetails || '{}');
    gatewayId = parseInt(od.gateway_id || APP_RAZORPAY_GATEWAY_ID, 10) || APP_RAZORPAY_GATEWAY_ID;
  } catch (_) {}

  const txnDetail = charged.txn_detail || charged.txnDetail || {};
  const pgr = charged.payment_gateway_response || {};
  const epg = charged.epg_txn_id || pgr.epg_txn_id || '';

  return {
    upi: { txnFlowType: 'COLLECT', payerApp: null },
    txnDetail: { gateway: txnDetail.gateway || 'RAZORPAY' },
    service: 'in.juspay.hyperpay',
    returnUrl: charged.return_url || '',
    requestId: crypto.randomUUID(),
    paymentMethodType: charged.payment_method_type || 'UPI',
    paymentMethod: charged.payment_method || 'UPI',
    paymentGatewayResponse: epg ? { epgTxnId: epg } : null,
    payload: {
      statusId: charged.status_id,
      status: 'charged',
      paymentInstrumentGroup: 'UPI',
      paymentInstrument: upiVpa,
      otherInfo: null,
      action: 'gatewaySelection',
    },
    orderId: String(charged.order_id || ''),
    merchantId: charged.merchant_id || juspayLoad.merchant_id || 'irctc',
    gatewayId,
    errorMessage: charged.bank_error_message || '',
    errorCode: charged.bank_error_code || '',
    error: false,
    epgTxnId: epg || null,
    card: null,
    bankErrorMessage: charged.bank_error_message || '',
    bankErrorCode: charged.bank_error_code || '',
    amount: charged.amount,
    event: 'process_result',
  };
}

function juspayLoadForVerify(juspayLoad) {
  return {
    clientId: juspayLoad.clientId,
    environment: juspayLoad.environment || 'production',
    merchantKeyID: juspayLoad.merchantKeyID,
    merchant_id: juspayLoad.merchant_id,
    orderDetails: juspayLoad.orderDetails,
    serviceUrl: juspayLoad.serviceUrl || 'in.juspay.hyperservices',
    signature: juspayLoad.signature,
    udf6: juspayLoad.udf6,
    upiOpted: juspayLoad.upiOpted,
  };
}

function buildVerifyBody(paymentData, payAmount, juspayLoad, juspayResponse) {
  let amount = payAmount;
  if (amount == null) {
    amount = paymentData?._pay_amount ?? paymentData?.amount;
  }
  const transId = orderIdFromPayment(paymentData);
  const juspayStr = JSON.stringify(juspayResponse);
  return {
    amount: amount != null ? Number(amount) : 0.0,
    apiName: null,
    bankId: APP_RAZORPAY_BANK_ID,
    bankName: null,
    captchaDto: null,
    errorMsg: null,
    juspayLoadDTO: juspayLoadForVerify(juspayLoad),
    loyaltyNum: 0,
    paramList: [{ key: 'juspayResponse', value: juspayStr }],
    paymentId: null,
    paymentType: null,
    remainingBalance: 0.0,
    serverId: null,
    timeStamp: null,
    transationId: /^\d+$/.test(String(transId)) ? Number(transId) : 0,
    txnDate: null,
    txnStatus: 1,
    txnType: APP_RAZORPAY_TXN_TYPE,
    upiModeOpted: 0,
    withoutOTP: false,
  };
}

/**
 * @param {{
 *   paymentData: object,
 *   amount: number,
 *   clientTransactionId?: string,
 *   sess?: object,
 *   vpa?: string,
 *   onStatus?: Function,
 * }} opts
 */
async function runAppRazorpayUpiFlow({
  paymentData,
  amount,
  clientTransactionId,
  sess,
  vpa,
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

  const juspayLoad = normalizeJuspayLoad(paymentData);
  if (!juspayLoad || !juspayLoad.signature) {
    return { ok: false, reason: 'Juspay init missing (juspayLoadDTO)' };
  }

  const upiVpa = String(vpa || '').trim();
  if (!upiVpa || !upiVpa.includes('@')) {
    return { ok: false, reason: 'VPA missing — set UPI ID in Payment' };
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

  const dispatcher = sess?.dispatcher || null;
  const minWait = getMinPaymentWaitMs(paymentData);
  const flowStart = Date.now();

  log(
    `UPI_COLLECT start order=${orderIdFromPayment(paymentData)} vpa=${upiVpa} bankId=${APP_RAZORPAY_BANK_ID} minWait=${minWait}ms`
  );

  status('APP · Razorpay UPI collect…');
  const txns = await postJuspayTxnsCollect(juspayLoad, upiVpa, dispatcher);
  if (!txns) {
    return { ok: false, reason: 'Juspay UPI collect failed' };
  }

  status('Waiting for UPI payment…');
  const charged = await pollJuspayPaymentStatus(juspayLoad, {
    status,
    dispatcher,
    showWaiting: true,
  });
  if (!charged) {
    return { ok: false, reason: 'UPI payment timeout or failed', captured: false };
  }

  const juspayResponse = buildJuspayResponseFromCharged(
    charged,
    juspayLoad,
    upiVpa
  );
  if (charged.order_id) {
    juspayResponse.orderId = String(charged.order_id);
  }

  await waitMinPaymentElapsed(flowStart, minWait, status);

  // Same Ocean panel animation as iPay / Direct bookingData
  status('Final Hit For Pnr');

  const { cookieHeader, cookieNames } = buildVerifyPaymentCookieHeader(paymentData);
  const spa = paymentData._session_spa_csrf || sess.spaCsrf || '';
  const greq = paymentData._session_greq || sess.uid || '';
  const mup = paymentData._session_mup || sess.mup || '';
  const body22 = buildVerifyBody(paymentData, amount, juspayLoad, juspayResponse);
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
    `verifyPayment/${cid} cookies=${cookieNames.length}/6 spa=${spa ? spa.slice(0, 12) + '…' : 'EMPTY'}`
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
    charged,
    txns,
    minWait,
  };
}

module.exports = {
  runAppRazorpayUpiFlow,
  APP_RAZORPAY_BANK_ID,
  APP_RAZORPAY_GATEWAY_ID,
  APP_RAZORPAY_TXN_TYPE,
};
