// =======================================================================
//  Erail / IndianRail math captcha OCR (ONNX / onnxruntime-web)
//  Ocean captcha_ocr.js structure + STAR erail_ocr.py model/preprocess
//
//  Requires: ort.min.js loaded first (global `ort`)
//  Exposes: window.ErailOCR = { init, solve, solveAnswer, ready }
//
//  Model: R2 crnn_ir_48x160_int8.onnx → IndexedDB cache → warm session
// =======================================================================
(() => {
  "use strict";

  // ---- Match STAR erail_ocr.py ----
  const H = 48, W = 160;
  const VOCAB = "0123456789+- ".split("");
  const BLANK_IDX = VOCAB.length; // 13
  const MEAN = [0.694, 0.695, 0.693];
  const STD = [0.299, 0.296, 0.301];
  const MIN_MODEL_BYTES = 1_000_000;

  const MODEL_URL = "https://pub-722a945d267a4b209f09e3eb76a87603.r2.dev/crnn_ir_48x160_int8.onnx";
  const MODEL_VERSION = "crnn_ir_48x160_int8_v1";
  const DB_NAME = "erail_ocr";
  const STORE = "models";

  let session = null;
  let initPromise = null;
  const state = { ready: false };

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error);
      });
    } catch (e) {
      console.warn("[ErailOCR] idbGet failed:", e);
      return null;
    }
  }

  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("[ErailOCR] idbSet failed:", e);
    }
  }

  async function getModelBytes() {
    const cached = await idbGet(MODEL_VERSION);
    if (cached && cached.byteLength > MIN_MODEL_BYTES) {
      console.log("[ErailOCR] Model from IndexedDB cache:", cached.byteLength, "bytes");
      return cached;
    }
    console.log("[ErailOCR] Cache MISS — downloading from R2...");
    const resp = await fetch(MODEL_URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error("Erail OCR model download failed: HTTP " + resp.status);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < MIN_MODEL_BYTES) {
      throw new Error("Erail OCR model incomplete: " + buf.byteLength + " bytes");
    }
    console.log("[ErailOCR] Downloaded", buf.byteLength, "bytes — caching...");
    await idbSet(MODEL_VERSION, buf);
    return buf;
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (typeof ort === "undefined") {
        throw new Error("onnxruntime-web (ort) not loaded before erail_captcha_ocr.js");
      }
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
          ort.env.wasm.wasmPaths = chrome.runtime.getURL("ocr/");
        } else {
          ort.env.wasm.wasmPaths = new URL("ocr/", window.location.href).href;
        }
      } catch (_) {}
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      ort.env.logLevel = "error";

      const bytes = await getModelBytes();
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log("[ErailOCR] Session ready.", session.inputNames, session.outputNames);

      try {
        const dummy = new Float32Array(1 * 3 * H * W);
        const t = new ort.Tensor("float32", dummy, [1, 3, H, W]);
        const feeds = {};
        feeds[session.inputNames[0]] = t;
        await session.run(feeds);
        console.log("[ErailOCR] Warm-up done.");
      } catch (e) {
        console.warn("[ErailOCR] Warm-up failed (non-fatal):", e);
      }
      state.ready = true;
    })();
    return initPromise;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("captcha image decode failed"));
      img.src = src;
    });
  }

  function normalizeSrc(base64OrUrl) {
    if (!base64OrUrl) return "";
    if (base64OrUrl.startsWith("data:image") || base64OrUrl.startsWith("blob:") || base64OrUrl.startsWith("http")) {
      return base64OrUrl;
    }
    return "data:image/png;base64," + base64OrUrl;
  }

  // PIL ImageOps.autocontrast(cutoff=2) approx on grayscale 0-255
  function autocontrastGray(gray, cutoffPct) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const n = gray.length;
    const cut = Math.floor((n * cutoffPct) / 100);
    let lo = 0, hi = 255, c = 0;
    for (let i = 0; i < 256; i++) {
      c += hist[i];
      if (c > cut) { lo = i; break; }
    }
    c = 0;
    for (let i = 255; i >= 0; i--) {
      c += hist[i];
      if (c > cut) { hi = i; break; }
    }
    if (hi <= lo) return gray;
    const scale = 255 / (hi - lo);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = Math.round((gray[i] - lo) * scale);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      out[i] = v;
    }
    return out;
  }

  // STAR: to_rgb_on_white → invert L → autocontrast → RGB; resize BICUBIC to WxH
  async function preprocess(base64OrUrl) {
    const img = await loadImage(normalizeSrc(base64OrUrl));
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = w0;
    srcCanvas.height = h0;
    const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    // white background for alpha (indianrail captcha often alpha-only)
    srcCtx.fillStyle = "#ffffff";
    srcCtx.fillRect(0, 0, w0, h0);
    srcCtx.drawImage(img, 0, 0);
    const rgba = srcCtx.getImageData(0, 0, w0, h0).data;

    const gray = new Uint8Array(w0 * h0);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      // luminance then invert (ImageOps.invert)
      const y = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
      gray[p] = 255 - y;
    }
    const contrasted = autocontrastGray(gray, 2);

    // draw gray RGB to temp canvas then scale to WxH (browser bicubic-ish)
    const gCanvas = document.createElement("canvas");
    gCanvas.width = w0;
    gCanvas.height = h0;
    const gCtx = gCanvas.getContext("2d");
    const gImg = gCtx.createImageData(w0, h0);
    for (let p = 0; p < contrasted.length; p++) {
      const v = contrasted[p];
      const i = p * 4;
      gImg.data[i] = v;
      gImg.data[i + 1] = v;
      gImg.data[i + 2] = v;
      gImg.data[i + 3] = 255;
    }
    gCtx.putImageData(gImg, 0, 0);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = W;
    outCanvas.height = H;
    const outCtx = outCanvas.getContext("2d");
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(gCanvas, 0, 0, W, H);
    const outRgba = outCtx.getImageData(0, 0, W, H).data;

    const out = new Float32Array(3 * H * W);
    const planeR = 0, planeG = H * W, planeB = 2 * H * W;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const i = idx * 4;
        const r = outRgba[i], g = outRgba[i + 1], b = outRgba[i + 2];
        out[planeR + idx] = (r / 255 - MEAN[0]) / (STD[0] + 1e-8);
        out[planeG + idx] = (g / 255 - MEAN[1]) / (STD[1] + 1e-8);
        out[planeB + idx] = (b / 255 - MEAN[2]) / (STD[2] + 1e-8);
      }
    }
    return new ort.Tensor("float32", out, [1, 3, H, W]);
  }

  function ctcGreedyDecode(logits, T, C) {
    let prev = BLANK_IDX;
    const chars = [];
    let confSum = 0;
    for (let t = 0; t < T; t++) {
      const off = t * C;
      let maxLogit = -Infinity, argmax = 0;
      for (let c = 0; c < C; c++) {
        const v = logits[off + c];
        if (v > maxLogit) { maxLogit = v; argmax = c; }
      }
      let denom = 0;
      for (let c = 0; c < C; c++) denom += Math.exp(logits[off + c] - maxLogit);
      confSum += 1 / denom;
      const p = argmax;
      if (p !== prev && p !== BLANK_IDX && p < VOCAB.length) chars.push(VOCAB[p]);
      prev = p;
    }
    return { text: chars.join("").trim(), conf: T > 0 ? confSum / T : 0 };
  }

  /** STAR ir_captcha_solver.eval_math_captcha_text */
  function evalMathCaptchaText(text) {
    let raw = String(text || "").trim().replace(/\s/g, "");
    if (raw.includes("=")) raw = raw.split("=", 1)[0];
    raw = raw.replace(/[^0-9+\-]/g, "");
    if (!raw) throw new Error("empty captcha expression from " + JSON.stringify(text));
    if (raw.includes("+")) {
      const parts = raw.split("+");
      return parseInt(parts[0], 10) + parseInt(parts[1], 10);
    }
    if (raw.slice(1).includes("-")) {
      const i = raw.indexOf("-", 1);
      return parseInt(raw.slice(0, i), 10) - parseInt(raw.slice(i + 1), 10);
    }
    return parseInt(raw, 10);
  }

  async function solve(base64OrUrl) {
    if (!state.ready) await init();
    const input = await preprocess(base64OrUrl);
    const feeds = {};
    feeds[session.inputNames[0]] = input;
    const results = await session.run(feeds);
    const outName = session.outputNames[0];
    const tensor = results[outName];
    const dims = tensor.dims;
    const T = dims.length >= 3 ? dims[1] : dims[0];
    const C = dims.length >= 3 ? dims[2] : dims[1];
    const res = ctcGreedyDecode(tensor.data, T, C);
    console.log("[ErailOCR] text='" + res.text + "' conf=" + (res.conf != null ? res.conf.toFixed(3) : "?"));
    if (!res.text) throw new Error("Erail OCR returned empty text");
    return res;
  }

  async function solveAnswer(base64OrUrl) {
    const { text, conf } = await solve(base64OrUrl);
    const answer = evalMathCaptchaText(text);
    return { text, conf, answer };
  }

  window.ErailOCR = {
    init,
    solve,
    solveAnswer,
    evalMathCaptchaText,
    get ready() { return state.ready; }
  };

  try {
    init().catch((e) => console.warn("[ErailOCR] init failed:", e));
  } catch (e) {
    console.warn("[ErailOCR] init threw:", e);
  }
})();
