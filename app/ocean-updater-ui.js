(function () {
  const bar = document.getElementById('bar');
  const pctEl = document.getElementById('pct');
  const msgEl = document.getElementById('msg');
  const curEl = document.getElementById('curVer');
  const newEl = document.getElementById('newVer');
  const notesEl = document.getElementById('notes');
  const btnClose = document.getElementById('btnClose');

  function setProgress(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    if (bar) bar.style.width = `${p}%`;
    if (pctEl) pctEl.textContent = `${p}%`;
  }

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.classList.remove('is-err', 'is-ok');
    if (kind === 'err') msgEl.classList.add('is-err');
    if (kind === 'ok') msgEl.classList.add('is-ok');
  }

  window.lexusUpdater?.onState?.((data) => {
    if (!data) return;
    if (data.current != null && curEl) curEl.textContent = String(data.current);
    if (data.latest != null && newEl) newEl.textContent = String(data.latest);
    if (data.notes != null && notesEl) notesEl.textContent = String(data.notes || '');
    if (data.percent != null) setProgress(data.percent);
    if (data.message) {
      const kind = data.phase === 'error' ? 'err' : data.phase === 'done' ? 'ok' : '';
      setMsg(data.message, kind);
    }
    if (data.phase === 'error' && btnClose) {
      btnClose.classList.remove('hidden');
    }
  });

  window.lexusUpdater?.onProgress?.((data) => {
    if (!data) return;
    if (data.percent != null) setProgress(data.percent);
    if (data.message) setMsg(data.message);
  });

  btnClose?.addEventListener('click', () => {
    window.lexusUpdater?.close?.();
  });

  window.lexusUpdater?.getInfo?.().then((info) => {
    if (info?.current && curEl) curEl.textContent = String(info.current);
  });
})();
