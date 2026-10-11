/**
 * Phase 4–5 — Native trusted input via webContents.sendInputEvent + humanization.
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** Phase 5: 100–350ms between human actions */
async function humanDelay(minMs = 100, maxMs = 350) {
  await sleep(rand(minMs, maxMs));
}

async function mouseMoveTo(wc, x, y, steps = 10) {
  // Start NEAR the target — never from top-left header (LOGIN/LOGOUT hover zone)
  const fromX = x + rand(-70, 70);
  const fromY = y + rand(-50, 50);
  const ctrlX = fromX + (x - fromX) * rand(0.3, 0.6) + rand(-25, 25);
  const ctrlY = fromY + (y - fromY) * rand(0.3, 0.6) + rand(-20, 20);

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const cx = u * u * fromX + 2 * u * t * ctrlX + t * t * x;
    const cy = u * u * fromY + 2 * u * t * ctrlY + t * t * y;
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(cx), y: Math.round(cy) });
    await sleep(rand(8, 18));
  }
  wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
}

async function scrollToward(wc, x, y) {
  const need = await wc.executeJavaScript(
    `(() => {
      const vh = window.innerHeight || 800;
      const vw = window.innerWidth || 1200;
      const px = ${Math.round(x)};
      const py = ${Math.round(y)};
      if (py >= 80 && py <= vh - 80 && px >= 0 && px <= vw) return 0;
      return Math.round(py - vh / 2);
    })()`
  );
  if (!need) return;
  const dir = need > 0 ? 1 : -1;
  let left = Math.abs(need);
  while (left > 0) {
    const delta = Math.min(left, Math.round(rand(80, 160)));
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(x),
      y: Math.round(Math.max(120, Math.min(y, 500))),
      deltaX: 0,
      deltaY: -dir * delta,
      canScroll: true,
    });
    left -= delta;
    await sleep(rand(40, 90));
  }
  await humanDelay(80, 160);
}

async function clickAt(wc, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  try {
    await scrollToward(wc, px, py);
  } catch (_) {}
  await mouseMoveTo(wc, px, py);
  await humanDelay(100, 220);
  wc.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
  await humanDelay(40, 110);
  wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  await humanDelay(100, 280);
}

async function typeText(wc, text) {
  const str = String(text ?? '');
  for (const ch of str) {
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    await humanDelay(100, 280);
  }
}

async function keyPress(wc, key) {
  const keyCode = key;
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  await sleep(rand(20, 45));
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await humanDelay(80, 180);
}

async function resolveClickPoint(wc, selector, offsetXPercent = 50, offsetYPercent = 50) {
  const point = await wc.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const raw = ((el.innerText || el.textContent || "") + "").replace(/\\s+/g, " ").trim().toUpperCase();
      if (raw === "LOGOUT" || raw === "SIGN OUT" || raw === "LOG OUT" ||
          (/\\bLOG\\s*OUT\\b/.test(raw) && raw.length < 24)) {
        return { blocked: true, reason: "logout" };
      }
      try {
        if (el.closest && el.closest("[class*='logout' i], a[href*='logout' i]")) {
          return { blocked: true, reason: "logout-ancestor" };
        }
      } catch (_) {}
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
      let r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 24) {
        window.scrollBy(0, Math.ceil(r.bottom - window.innerHeight + 100));
        r = el.getBoundingClientRect();
      }
      if (r.top < 90) {
        window.scrollBy(0, Math.floor(r.top - 110));
        r = el.getBoundingClientRect();
      }
      if (!r.width || !r.height) return null;
      return {
        x: r.left + r.width * (${Number(offsetXPercent)} / 100),
        y: r.top + r.height * (${Number(offsetYPercent)} / 100)
      };
    })()`
  );
  if (point && point.blocked) {
    return null;
  }
  return point;
}

async function clickSelector(wc, selector, offsetXPercent = 50, offsetYPercent = 50) {
  const point = await resolveClickPoint(wc, selector, offsetXPercent, offsetYPercent);
  if (!point) return { success: false, error: `Element not found or blocked: ${selector}` };
  await clickAt(wc, point.x, point.y);
  return { success: true };
}

async function typeSelector(wc, selector, text) {
  const click = await clickSelector(wc, selector, 50, 50);
  if (!click.success) return click;
  await humanDelay(100, 220);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control' });
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'A' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'A' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
  await humanDelay(60, 140);
  await keyPress(wc, 'Backspace');
  await humanDelay(80, 160);
  await typeText(wc, text);
  return { success: true };
}

module.exports = {
  sleep,
  humanDelay,
  clickAt,
  clickSelector,
  typeSelector,
  typeText,
  keyPress,
};
