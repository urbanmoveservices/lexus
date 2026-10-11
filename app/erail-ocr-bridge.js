/**
 * Hidden BrowserWindow bridge for local Erail/IndianRail math captcha OCR.
 * Replaces dead external API: chekavailbility.xyz:5000
 */
const path = require('path');
const { BrowserWindow } = require('electron');

let ocrWin = null;
let ocrReadyPromise = null;

function getOcrWindow() {
  if (ocrWin && !ocrWin.isDestroyed()) return ocrWin;

  const win = ocrWin = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (_e, _level, message) => {
    if (String(message).includes('[ErailOCR]')) {
      console.log(message);
    }
  });

  ocrReadyPromise = win
    .loadFile(path.join(__dirname, 'erail-ocr.html'))
    .then(() =>
      win.webContents.executeJavaScript(
        `(async () => {
          if (!window.ErailOCR) throw new Error('ErailOCR not loaded');
          await window.ErailOCR.init();
          return true;
        })()`,
        true
      )
    )
    .catch((err) => {
      if (ocrWin === win) { ocrWin = null; ocrReadyPromise = null; }
      if (!win.isDestroyed()) win.destroy();
      throw err;
    });

  win.on('closed', () => {
    if (ocrWin === win) { ocrWin = null; ocrReadyPromise = null; }
  });

  return ocrWin;
}

async function ensureOcrReady() {
  getOcrWindow();
  await ocrReadyPromise;
}

/**
 * @param {Buffer} pngBuffer captchaDraw.png bytes
 * @returns {Promise<number|string>} numeric answer for inputCaptcha
 */
async function solveCaptchaImage(pngBuffer) {
  await ensureOcrReady();
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const result = await ocrWin.webContents.executeJavaScript(
    `(async () => {
      const r = await window.ErailOCR.solveAnswer(${JSON.stringify(dataUrl)});
      return r;
    })()`,
    true
  );
  if (!result || result.answer === undefined || result.answer === null) {
    throw new Error('Local Erail OCR returned no answer');
  }
  return result.answer;
}

module.exports = {
  ensureOcrReady,
  solveCaptchaImage,
};
