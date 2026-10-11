/**
 * Station autocomplete (renderer). Loads ./stationlist.json
 * Box me sirf station CODE save hota hai (e.g. LTT) — list me Name - Code dikhta hai.
 */
(function () {
  let parsedStations = [];
  let loaded = false;

  async function loadStations() {
    if (loaded && parsedStations.length) return parsedStations;
    const res = await fetch('./stationlist.json');
    if (!res.ok) throw new Error(`stationlist.json failed: ${res.status}`);
    const json = await res.json();
    parsedStations = (json || [])
      .map((item) => ({
        code: String(item.code || '').trim(),
        name: String(item.name || '').trim(),
      }))
      .filter((s) => s.code && s.name);
    loaded = true;
    return parsedStations;
  }

  function formatStation(s) {
    return `${s.name} - ${s.code}`;
  }

  /** "NAME - CODE" | "CODE" | messy → uppercase code or '' */
  function stationCodeFromValue(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const parts = v.split(' - ');
    if (parts.length > 1) {
      return (parts[parts.length - 1] || '').trim().toUpperCase();
    }
    if (/^[A-Za-z0-9]{2,6}$/.test(v)) return v.toUpperCase();
    return v.toUpperCase();
  }

  function findStationByCode(code) {
    const c = String(code || '')
      .trim()
      .toUpperCase();
    if (!c) return null;
    return parsedStations.find((s) => s.code.toUpperCase() === c) || null;
  }

  /** Known value → canonical code; unknown → '' */
  function normalizeToStationCode(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const fromFmt = stationCodeFromValue(v);
    if (findStationByCode(fromFmt)) return fromFmt;
    const upper = v.toUpperCase();
    const byName = parsedStations.find((s) => s.name.toUpperCase() === upper);
    if (byName) return byName.code.toUpperCase();
    return '';
  }

  function getStationMatches(query, limit = 12) {
    const raw = (query || '').trim();
    if (!raw) return [];
    const q = stationCodeFromValue(raw) || raw.toUpperCase();
    const qName = raw.toUpperCase();

    const exactCode = [];
    const codeStarts = [];
    const nameStarts = [];
    const includes = [];

    for (const s of parsedStations) {
      const codeU = s.code.toUpperCase();
      const nameU = s.name.toUpperCase();
      if (codeU === q) exactCode.push(s);
      else if (codeU.startsWith(q) || codeU.startsWith(qName)) codeStarts.push(s);
      else if (nameU.startsWith(qName) || nameU.startsWith(q)) nameStarts.push(s);
      else if (nameU.includes(qName) || codeU.includes(q) || nameU.includes(q)) {
        includes.push(s);
      }
    }

    return [...exactCode, ...codeStarts, ...nameStarts, ...includes]
      .slice(0, limit)
      .map(formatStation);
  }

  function isKnownStation(value) {
    const v = (value || '').trim();
    if (!v) return false;
    return Boolean(normalizeToStationCode(v));
  }

  function closeAllStationLists() {
    document.querySelectorAll('.autocomplete-items').forEach((el) => el.remove());
  }

  function positionStationList(list, input) {
    const r = input.getBoundingClientRect();
    const gap = 4;
    const maxH = Math.min(180, Math.max(100, window.innerHeight - r.bottom - 12));
    let top = r.bottom + gap;
    if (r.bottom + maxH + 8 > window.innerHeight && r.top > maxH + 8) {
      top = Math.max(8, r.top - maxH - gap);
    }
    list.style.position = 'fixed';
    list.style.left = `${Math.max(8, r.left)}px`;
    list.style.top = `${top}px`;
    list.style.width = `${Math.max(160, r.width)}px`;
    list.style.maxHeight = `${maxH}px`;
    list.style.zIndex = '10050';
  }

  function attachStationAutocomplete(input) {
    if (!input || input.dataset.stationAuto === '1') return;
    input.dataset.stationAuto = '1';
    if (!input.placeholder) input.placeholder = 'e.g. LTT';

    let activeIndex = -1;
    let openList = null;

    function setActive(items) {
      if (!items || !items.length) return;
      items.forEach((el) => el.classList.remove('autocomplete-active'));
      if (activeIndex >= items.length) activeIndex = 0;
      if (activeIndex < 0) activeIndex = items.length - 1;
      items[activeIndex].classList.add('autocomplete-active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function markValidity() {
      const ok = !input.value.trim() || isKnownStation(input.value);
      input.classList.toggle('station-invalid', !ok);
      input.classList.toggle('station-valid', Boolean(input.value.trim()) && ok);
      input.title = ok ? '' : 'Station list me nahi mila — list se choose karo';
    }

    function applyCodeValue(codeOrLabel) {
      const code =
        normalizeToStationCode(codeOrLabel) || stationCodeFromValue(codeOrLabel);
      if (code) input.value = code;
      markValidity();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function hideList() {
      if (openList) {
        openList.remove();
        openList = null;
      }
      activeIndex = -1;
    }

    function showList(matches) {
      closeAllStationLists();
      openList = null;
      activeIndex = -1;
      if (!matches.length) return;

      const list = document.createElement('div');
      list.id = `${input.id}-autocomplete-list`;
      list.className = 'autocomplete-items';
      list.setAttribute('role', 'listbox');

      for (const match of matches) {
        const row = document.createElement('div');
        row.textContent = match;
        row.dataset.stationLabel = match;
        row.setAttribute('role', 'option');
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          applyCodeValue(match);
          closeAllStationLists();
          openList = null;
          activeIndex = -1;
        });
        list.appendChild(row);
      }

      document.body.appendChild(list);
      positionStationList(list, input);
      openList = list;
      activeIndex = 0;
      setActive(list.querySelectorAll('[role="option"]'));
    }

    const reposition = () => {
      if (openList && openList.isConnected) positionStationList(openList, input);
    };

    input.addEventListener('input', () => {
      const value = input.value;
      markValidity();
      if (!value.trim()) {
        hideList();
        return;
      }
      showList(getStationMatches(value, 12));
    });

    input.addEventListener('keydown', (e) => {
      const list = openList || document.getElementById(`${input.id}-autocomplete-list`);
      if (!list || !list.isConnected) return;
      const items = list.querySelectorAll('[role="option"]');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? 0 : activeIndex + 1;
        setActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? items.length - 1 : activeIndex - 1;
        setActive(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const idx = activeIndex >= 0 ? activeIndex : 0;
        const row = items[idx];
        if (row) row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideList();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        hideList();
        const code = normalizeToStationCode(input.value);
        if (code) input.value = code;
        markValidity();
      }, 150);
    });

    input.addEventListener('focus', () => {
      const code = normalizeToStationCode(input.value);
      if (code) input.value = code;
      if (input.value.trim()) {
        showList(getStationMatches(input.value, 12));
      }
    });

    window.addEventListener('resize', reposition);
    const scrollParent = input.closest('.modal-panel, .ocean-form, body');
    if (scrollParent) {
      scrollParent.addEventListener(
        'scroll',
        () => {
          hideList();
        },
        true
      );
    }

    const existing = normalizeToStationCode(input.value);
    if (existing) {
      input.value = existing;
      markValidity();
    }
  }

  async function initStationAutocomplete() {
    await loadStations();
    ['from-station-input', 'destination-station-input', 'boarding-station-input'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) attachStationAutocomplete(el);
      }
    );
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.autocomplete-items')) return;
      if (
        e.target.closest(
          '#from-station-input, #destination-station-input, #boarding-station-input'
        )
      ) {
        return;
      }
      closeAllStationLists();
    });
    document.addEventListener(
      'focusin',
      (e) => {
        const t = e.target;
        if (!t || !t.id) {
          if (t && !t.closest?.('.autocomplete-items') && !t.closest?.('.field-station')) {
            closeAllStationLists();
          }
          return;
        }
        if (
          t.id === 'from-station-input' ||
          t.id === 'destination-station-input' ||
          t.id === 'boarding-station-input'
        ) {
          return;
        }
        closeAllStationLists();
      },
      true
    );
    return parsedStations.length;
  }

  function validateJourneyStations() {
    const from = document.getElementById('from-station-input')?.value || '';
    const to = document.getElementById('destination-station-input')?.value || '';
    const boarding = document.getElementById('boarding-station-input')?.value || '';
    const problems = [];
    if (from && !isKnownStation(from)) problems.push('Source station list me nahi hai');
    if (to && !isKnownStation(to)) problems.push('Destination station list me nahi hai');
    if (boarding && !isKnownStation(boarding)) problems.push('Boarding station list me nahi hai');
    return { ok: problems.length === 0, problems };
  }

  window.OceanStations = {
    loadStations,
    getStationMatches,
    isKnownStation,
    initStationAutocomplete,
    validateJourneyStations,
    closeAllStationLists,
    stationCodeFromValue,
    normalizeToStationCode,
    findStationByCode,
    get count() {
      return parsedStations.length;
    },
  };
})();
