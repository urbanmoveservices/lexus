const GENDER_OPTIONS = `
  <option value="M">Male</option>
  <option value="F">Female</option>
  <option value="T">Transgender</option>
`;

const BERTH_OPTIONS = `
  <option value="">No Preference</option>
  <option value="UB">Upper</option>
  <option value="LB">Lower</option>
  <option value="MB">Middle</option>
  <option value="SL">Side Lower</option>
  <option value="SU">Side Upper</option>
  <option value="WS">Window Side</option>
  <option value="CB">Cabin</option>
  <option value="CP">Coupe</option>
  <option value="SM">Side Middle</option>
`;

const FOOD_OPTIONS = `
  <option value="">No Preference</option>
  <option value="V">Veg</option>
  <option value="N">Non Veg</option>
  <option value="D">No Food</option>
`;

const state = {
  selectedJourneyId: null,
  selectedCredentialId: null,
  selectedPaymentId: null,
  credentialEditMode: false,
  maxRuns: 4,
  visiblePassengers: 1,
  ticketsFilter: 'all',
  ticketsSearch: '',
};

const SHELL = {
  view: new URLSearchParams(window.location.search).get('view') || 'toolbar',
  modal: new URLSearchParams(window.location.search).get('modal') || '',
};

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

function sanitizePassengerNameValue(raw) {
  return String(raw || '')
    .replace(/[^a-zA-Z\s]/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 16)
    .toUpperCase();
}

function sanitizePassengerAgeValue(raw) {
  let digits = String(raw || '').replace(/\D/g, '').slice(0, 3);
  if (digits && Number(digits) > 125) digits = '125';
  return digits;
}

function bindPassengerNameInput(el) {
  if (!el || el.dataset.oceanBound === '1') return;
  el.dataset.oceanBound = '1';
  el.setAttribute('maxlength', '16');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('spellcheck', 'false');
  el.addEventListener('input', () => {
    const cleaned = sanitizePassengerNameValue(el.value);
    if (el.value !== cleaned) el.value = cleaned;
    if (el.id === 'passenger-name-1') updateAutoTicketName();
  });
}

function bindPassengerAgeInput(el) {
  if (!el || el.dataset.oceanBound === '1') return;
  el.dataset.oceanBound = '1';
  el.setAttribute('maxlength', '3');
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('autocomplete', 'off');
  el.addEventListener('input', () => {
    const cleaned = sanitizePassengerAgeValue(el.value);
    if (el.value !== cleaned) el.value = cleaned;
  });
}

function wirePassengerFieldConstraints() {
  for (let i = 1; i <= 6; i += 1) {
    bindPassengerNameInput(document.getElementById(`passenger-name-${i}`));
    bindPassengerAgeInput(document.getElementById(`age-${i}`));
  }
}

function buildPassengerRows() {
  const root = document.getElementById('passengerRows');
  if (!root) return;
  root.innerHTML = '';
  for (let i = 1; i <= 6; i += 1) {
    const row = document.createElement('div');
    row.className = 'passenger-row' + (i > state.visiblePassengers ? ' is-hidden' : '');
    row.id = `passenger-row-${i}`;
    row.dataset.index = String(i);
    row.innerHTML = `
      <span class="psg-sno">${i}</span>
      <input type="text" id="passenger-name-${i}" name="passenger-name-${i}" placeholder="Enter full name" maxlength="16" autocomplete="off" spellcheck="false" />
      <input type="text" id="age-${i}" name="age-${i}" placeholder="Age" maxlength="3" inputmode="numeric" autocomplete="off" />
      <select id="passenger-gender-${i}" name="passenger-gender-${i}">${GENDER_OPTIONS}</select>
      <select id="passenger-berth-${i}" name="passenger-berth-${i}">${BERTH_OPTIONS}</select>
      <select id="passenger-food-${i}" name="passenger-food-${i}">${FOOD_OPTIONS}</select>
      <button type="button" class="psg-remove" data-action="remove-passenger" data-index="${i}" aria-label="Remove passenger">×</button>
      <input id="passengerchildberth${i}" name="passengerchildberth${i}" type="checkbox" hidden />
    `;
    root.appendChild(row);
  }
  syncPassengerVisibility();
  wirePassengerFieldConstraints();
}

function syncPassengerVisibility() {
  for (let i = 1; i <= 6; i += 1) {
    const row = document.getElementById(`passenger-row-${i}`);
    if (!row) continue;
    row.classList.toggle('is-hidden', i > state.visiblePassengers);
  }
  const addBtn = document.getElementById('addPassengerBtn');
  if (addBtn) addBtn.hidden = state.visiblePassengers >= 6;
}

function addPassengerRow() {
  if (state.visiblePassengers >= 6) {
    toast('Max 6 passengers');
    return;
  }
  state.visiblePassengers += 1;
  syncPassengerVisibility();
}

function removePassengerRow(index) {
  const i = Number(index);
  if (!i || state.visiblePassengers <= 1) {
    setVal(`passenger-name-${i}`, '');
    setVal(`age-${i}`, '');
    setVal(`passenger-gender-${i}`, 'M');
    setVal(`passenger-berth-${i}`, '');
    setVal(`passenger-food-${i}`, '');
    return;
  }
  // shift up
  for (let j = i; j < state.visiblePassengers; j += 1) {
    setVal(`passenger-name-${j}`, val(`passenger-name-${j + 1}`));
    setVal(`age-${j}`, val(`age-${j + 1}`));
    setVal(`passenger-gender-${j}`, val(`passenger-gender-${j + 1}`) || 'M');
    setVal(`passenger-berth-${j}`, val(`passenger-berth-${j + 1}`));
    setVal(`passenger-food-${j}`, val(`passenger-food-${j + 1}`));
  }
  const last = state.visiblePassengers;
  setVal(`passenger-name-${last}`, '');
  setVal(`age-${last}`, '');
  setVal(`passenger-gender-${last}`, 'M');
  setVal(`passenger-berth-${last}`, '');
  setVal(`passenger-food-${last}`, '');
  state.visiblePassengers -= 1;
  syncPassengerVisibility();
}

function readBookOptions() {
  const insurance = document.querySelector('input[name="travelInsurance"]:checked')?.value === '1';
  const food = document.querySelector('input[name="foodOpt"]:checked')?.value === '1';
  return {
    autoUpgradation: Boolean(document.getElementById('optAutoUpgradation')?.checked),
    captchaManual: Boolean(document.getElementById('optCaptchaManual')?.checked),
    travelInsurance: insurance,
    foodOpted: food,
    confirmBerths: Boolean(document.getElementById('optConfirmBerths')?.checked),
    maxPtFare: val('maxPtFare'),
    backupGateway: val('journeyBackupGateway'),
    ipMode: val('bookIpSelect') || 'auto',
  };
}

function writeBookOptions(opt) {
  const o = opt || {};
  const auto = document.getElementById('optAutoUpgradation');
  const cap = document.getElementById('optCaptchaManual');
  const conf = document.getElementById('optConfirmBerths');
  if (auto) auto.checked = Boolean(o.autoUpgradation);
  if (cap) cap.checked = Boolean(o.captchaManual);
  if (conf) conf.checked = o.confirmBerths !== false;
  setVal('maxPtFare', o.maxPtFare || '');
  setVal('journeyBackupGateway', o.backupGateway || '');
  setVal('bookIpSelect', o.ipMode || 'auto');
  document.querySelectorAll('input[name="travelInsurance"]').forEach((r) => {
    r.checked = r.value === (o.travelInsurance ? '1' : '0');
  });
  document.querySelectorAll('input[name="foodOpt"]').forEach((r) => {
    r.checked = r.value === (o.foodOpted ? '1' : '0');
  });
}


function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function ensureDefaultJourneyDate() {
  const el = document.getElementById('journey-date');
  if (!el) return;
  if (!String(el.value || '').trim()) {
    el.value = defaultJourneyDateIso();
  }
}

function setSelectValue(id, value) {
  if (value == null || value === '') return;
  const sel = document.getElementById(id);
  if (!sel || sel.tagName !== 'SELECT') {
    setVal(id, value);
    return;
  }
  const code = String(value).trim().toUpperCase();
  const has = Array.from(sel.options).some((o) => o.value === code);
  if (!has) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    sel.appendChild(opt);
  }
  sel.value = code;
}

function readPassengers() {
  const list = [];
  for (let i = 1; i <= 6; i += 1) {
    const name = sanitizePassengerNameValue(val(`passenger-name-${i}`)).trim();
    if (!name) continue;
    list.push({
      name,
      age: sanitizePassengerAgeValue(val(`age-${i}`)),
      gender: val(`passenger-gender-${i}`),
      berth: val(`passenger-berth-${i}`),
      food: val(`passenger-food-${i}`),
      childBerth: Boolean(document.getElementById(`passengerchildberth${i}`)?.checked),
    });
  }
  return list;
}

function writePassengers(passengers) {
  for (let i = 1; i <= 6; i += 1) {
    const p = passengers[i - 1];
    setVal(`passenger-name-${i}`, sanitizePassengerNameValue(p?.name || ''));
    setVal(`age-${i}`, sanitizePassengerAgeValue(String(p?.age ?? '')));
    setVal(`passenger-gender-${i}`, p?.gender || 'M');
    setVal(`passenger-berth-${i}`, p?.berth || '');
    setVal(`passenger-food-${i}`, p?.food || '');
    const cb = document.getElementById(`passengerchildberth${i}`);
    if (cb) cb.checked = Boolean(p?.childBerth);
  }
}

function readInfants() {
  const list = [];
  for (let i = 1; i <= 2; i += 1) {
    const name = val(`Infant-name-${i}`).trim();
    if (!name) continue;
    list.push({
      name,
      age: val(`Infant-age-${i}`),
      gender: val(`Infant-gender-${i}`),
    });
  }
  return list;
}

function writeInfants(infants) {
  for (let i = 1; i <= 2; i += 1) {
    const inf = infants[i - 1];
    setVal(`Infant-name-${i}`, inf?.name || '');
    setVal(`Infant-age-${i}`, inf?.age ?? '0');
    setVal(`Infant-gender-${i}`, inf?.gender || '');
  }
}

function readAvailability() {
  const checked = document.querySelector('input[name="AvailabilityCheck"]:checked');
  return checked ? checked.value : '';
}

function writeAvailability(value) {
  document.querySelectorAll('input[name="AvailabilityCheck"]').forEach((r) => {
    r.checked = r.value === value;
  });
}

function collectJourneyPayload() {
  updateAutoTicketName();
  return {
    id: state.selectedJourneyId || undefined,
    name: buildAutoTicketName() || val('journey-profile-name') || 'Journey',
    from: val('from-station-input'),
    to: val('destination-station-input'),
    date: val('journey-date'),
    trainNo: val('train-no'),
    class: val('journey-class-input'),
    quota: val('quota-input'),
    boarding: val('boarding-station-input'),
    availabilityCheck: readAvailability(),
    slbooktime: val('slbooktime') || '10:59:59',
    acbooktime: val('acbooktime') || '09:59:59',
    gnbooktime: val('gnbooktime') || '07:59:59',
    passengers: readPassengers(),
    infants: readInfants(),
    contact: {
      mobile: val('mobileNumber'),
      email: val('email'),
    },
    options: readBookOptions(),
  };
}

function fillJourneyEditor(j) {
  if (!j) return;
  state.selectedJourneyId = j.id;
  setVal('journey-profile-name', j.name || '');
  setStationInput('from-station-input', j.from || '');
  setStationInput('destination-station-input', j.to || '');
  setVal('journey-date', j.date || defaultJourneyDateIso());
  setVal('train-no', j.trainNo || '');
  setVal('journey-class-input', j.class || '');
  setVal('quota-input', j.quota || 'TQ');
  setStationInput('boarding-station-input', j.boarding || '');
  writeAvailability(j.availabilityCheck || 'A');
  setVal('slbooktime', j.slbooktime || '10:59:59');
  setVal('acbooktime', j.acbooktime || '09:59:59');
  setVal('gnbooktime', j.gnbooktime || '07:59:59');
  const pax = j.passengers || [];
  state.visiblePassengers = Math.max(1, Math.min(6, pax.length || 1));
  syncPassengerVisibility();
  writePassengers(pax);
  writeInfants(j.infants || []);
  setVal('mobileNumber', j.contact?.mobile || '');
  setVal('email', j.contact?.email || '');
  writeBookOptions(j.options || {});
  updateAutoTicketName();
  syncSaveJourneyButton();
}

function defaultJourneyDateIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clearJourneyEditor() {
  state.selectedJourneyId = null;
  setVal('journey-profile-name', '');
  setVal('from-station-input', '');
  setVal('destination-station-input', '');
  setVal('journey-date', defaultJourneyDateIso());
  setVal('train-no', '');
  setVal('journey-class-input', '');
  setVal('quota-input', 'TQ');
  setVal('boarding-station-input', '');
  writeAvailability('A');
  setVal('slbooktime', '10:59:59');
  setVal('acbooktime', '09:59:59');
  setVal('gnbooktime', '07:59:59');
  state.visiblePassengers = 1;
  syncPassengerVisibility();
  writePassengers([]);
  writeInfants([]);
  setVal('mobileNumber', '');
  setVal('email', '');
  writeBookOptions({ confirmBerths: true });
  syncSaveJourneyButton();
}

function syncSaveJourneyButton() {
  const btn = document.getElementById('saveJourneyBtn');
  if (!btn) return;
  btn.textContent = state.selectedJourneyId ? 'UPDATE' : 'SAVE';
}

function collectCredentialPayload() {
  const username = val('irctc-login').trim();
  const payload = {
    name: username || 'Login',
    username,
    password: val('irctc-password'),
  };
  // Sirf Change PASS edit mode me existing row update — Add IRCTC hamesha naya
  if (state.credentialEditMode && state.selectedCredentialId) {
    payload.id = state.selectedCredentialId;
  }
  return payload;
}

function fillCredentialEditor(c) {
  if (!c) return;
  state.selectedCredentialId = c.id;
  setVal('irctc-login', c.username || '');
  setVal('irctc-password', c.password || '');
  setLoginFieldsEditable(true);
}

function setLoginFieldsEditable(editable) {
  const user = document.getElementById('irctc-login');
  const pass = document.getElementById('irctc-password');
  if (user) user.readOnly = !editable;
  if (pass) pass.readOnly = !editable;
}

function paymentMethodLabel(code) {
  const sel = document.getElementById('paymentMethod');
  if (!sel || !code) return code || 'Payment';
  const opt = sel.querySelector(`option[value="${CSS.escape(String(code))}"]`);
  return opt?.textContent?.trim() || code;
}

/** Gateways where user must type a UPI ID / VPA (not QR / eWallet) */
function paymentNeedsVpa(method) {
  const m = String(method || '').trim().toUpperCase();
  if (!m) return false;
  if (m.includes('QR') || m === 'IRCWA') return false;
  return (
    m === 'IRCUPIID' ||
    m === 'PAYTMUPIID' ||
    m === 'PAYUUPIID' ||
    m === 'RAZORPAYUPI' ||
    m.endsWith('UPIID')
  );
}

function syncVpaFieldVisibility() {
  const field = document.getElementById('vpaField');
  if (!field) return;
  const show = paymentNeedsVpa(val('paymentMethod')) || paymentNeedsVpa(val('backupPaymentMethod'));
  field.hidden = !show;
  field.classList.toggle('is-vpa-hidden', !show);
  field.style.display = show ? '' : 'none';
}

function collectPaymentPayload({ id } = {}) {
  const method = val('paymentMethod');
  return {
    id: id !== undefined ? id : undefined,
    name: method || 'Payment',
    paymentMethod: method,
    backupPaymentMethod: val('backupPaymentMethod'),
    vpa: (paymentNeedsVpa(method) || paymentNeedsVpa(val('backupPaymentMethod'))) ? val('vpa') : '',
    cardnumber: val('cardnumber'),
    cardexpiry: val('cardexpiry'),
    cardcvv: val('cardcvv'),
    cardholder: val('cardholder'),
  };
}

function fillPaymentEditor(p) {
  if (!p) return;
  state.selectedPaymentId = p.id;
  setVal('paymentMethod', p.paymentMethod || '');
  setVal('backupPaymentMethod', p.backupPaymentMethod || '');
  setVal('vpa', p.vpa || '');
  setVal('cardnumber', p.cardnumber || '');
  setVal('cardexpiry', p.cardexpiry || '');
  setVal('cardcvv', p.cardcvv || '');
  setVal('cardholder', p.cardholder || '');
  syncVpaFieldVisibility();
}

function clearCredentialEditor() {
  state.selectedCredentialId = null;
  state.credentialEditMode = false;
  setVal('irctc-login', '');
  setVal('irctc-password', '');
  setLoginFieldsEditable(true);
}

function clearPaymentEditor() {
  state.selectedPaymentId = null;
  setVal('paymentMethod', 'IRCUPIID');
  setVal('backupPaymentMethod', '');
  setVal('vpa', '');
  setVal('cardnumber', '');
  setVal('cardexpiry', '');
  setVal('cardcvv', '');
  setVal('cardholder', '');
  syncVpaFieldVisibility();
}

function fillSelect(selectId, items, selectedId, labelFn) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = selectedId || '';
  const placeholder =
    selectId === 'credentialSelect' || selectId === 'paymentSelect'
      ? '- Select -'
      : '— New / unsaved —';
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = labelFn(item);
    sel.appendChild(opt);
  }
  sel.value = prev;
  if (prev && sel.value !== prev) sel.value = '';
}

function setChip(valueElId, chipId, text, ready) {
  const valueEl = document.getElementById(valueElId);
  const chip = document.getElementById(chipId);
  if (valueEl) valueEl.textContent = text || 'Choose below';
  if (chip) chip.classList.toggle('is-ready', Boolean(ready));
}

function updateRunChips(journeys, credentials, payments) {
  const j = journeys.find((x) => x.id === state.selectedJourneyId);
  const c = credentials.find((x) => x.id === state.selectedCredentialId);
  const p = payments.find((x) => x.id === state.selectedPaymentId);
  setChip(
    'chipJourneyValue',
    'chipJourney',
    j ? j.name || `${j.from || '?'} → ${j.to || '?'}` : '',
    Boolean(j)
  );
  setChip('chipLoginValue', 'chipLogin', c ? c.username || c.name || 'Login' : '', Boolean(c));
  setChip(
    'chipPaymentValue',
    'chipPayment',
    p ? p.name || p.paymentMethod || 'Payment' : '',
    Boolean(p)
  );
}

function showEditorTab(name) {
  const map = {
    journey: 'book',
    login: 'accounts',
    payment: 'payment',
    proxy: 'proxies',
    tickets: 'tickets',
    tokens: 'tokens',
    about: 'about',
    runs: 'history',
    history: 'history',
  };
  openModal(map[name] || name);
}

async function openNewBookForm() {
  if (SHELL.view === 'toolbar') {
    state.selectedJourneyId = null;
    await window.ocean.openNewBookDraft();
    return;
  }
  clearJourneyEditor();
  state.selectedJourneyId = null;
  await window.ocean.setUiState({ selectedJourneyId: null });
  setVal('journey-date', defaultJourneyDateIso());
  openModal('book');
}

let newBookDraftRequested = false;
function prepareNewBookDraftLocal() {
  newBookDraftRequested = true;
  clearJourneyEditor();
  state.selectedJourneyId = null;
  const tomorrow = defaultJourneyDateIso();
  setVal('journey-date', tomorrow);
  activateModalLocal('book');
  // Re-apply after panel activate (guards against race / empty date input)
  setVal('journey-date', tomorrow);
  ensureDefaultJourneyDate();
}

function activateModalLocal(modalName) {
  const name = modalName || '';
  document.querySelectorAll('.modal-panel').forEach((panel) => {
    const on = panel.dataset.modal === name;
    panel.classList.toggle('is-active', on);
    if (panel.id === 'runsDrawer') panel.hidden = !on;
  });
  document.querySelectorAll('.tb-btn[data-editor-tab]').forEach((btn) => {
    const tab = btn.dataset.editorTab;
    const active =
      (name === 'book' && tab === 'journey') ||
      (name === 'accounts' && tab === 'login') ||
      (name === 'proxies' && tab === 'proxy') ||
      (name === 'history' && (tab === 'history' || tab === 'runs')) ||
      tab === name;
    btn.classList.toggle('is-active', Boolean(active));
  });
  document.querySelectorAll('details.tb-brand-menu, details.tb-settings-menu').forEach((d) => {
    d.open = false;
  });
  if (name === 'book') ensureDefaultJourneyDate();
  if (name === 'payment') syncVpaFieldVisibility();
}

function openModal(modalName) {
  const name = modalName || '';
  if (SHELL.view === 'toolbar') {
    closeToolbarMenus();
    if (name) window.ocean?.openModalShell?.(name);
    return;
  }
  activateModalLocal(name);
  // Edit from Tickets reuses this window — ask main to resize to book/default bounds
  if (name && typeof window.ocean?.openModalShell === 'function') {
    Promise.resolve(window.ocean.openModalShell(name)).catch(() => {});
  }
}

function placeOpenDropdownCard(details) {
  const card = details?.querySelector('.dropdown-card');
  const summary = details?.querySelector('summary');
  if (!card || !summary || card.classList.contains('is-dragged')) return;
  const rect = summary.getBoundingClientRect();
  const width = Math.max(card.offsetWidth || 300, 280);
  let left = rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  card.style.position = 'fixed';
  card.style.left = `${left}px`;
  card.style.right = 'auto';
  card.style.top = 'auto';
  card.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 10)}px`;
  card.style.width = `${width}px`;
}

async function syncToolbarMenuShell() {
  if (SHELL.view !== 'toolbar') return;
  const openDetails = document.querySelector(
    'details.tb-brand-menu[open], details.tb-settings-menu[open]'
  );
  const open = Boolean(openDetails);
  document.body.classList.toggle('toolbar-menu-open', open);
  try {
    await window.ocean?.setToolbarMenuOpen?.(open);
  } catch (_) {}
  if (open && openDetails) {
    // After window grows, pin menu above the button (avoids 86px clip)
    requestAnimationFrame(() => placeOpenDropdownCard(openDetails));
  }
}

function resetDropdownCardPosition(card) {
  if (!card) return;
  card.classList.remove('is-dragging', 'is-dragged');
  card.style.position = '';
  card.style.left = '';
  card.style.top = '';
  card.style.right = '';
  card.style.bottom = '';
  card.style.width = '';
}

function closeToolbarMenus() {
  document.querySelectorAll('details.tb-brand-menu, details.tb-settings-menu').forEach((d) => {
    d.open = false;
    resetDropdownCardPosition(d.querySelector('.dropdown-card'));
  });
  syncToolbarMenuShell();
}

function formatAboutDays(leftDays) {
  if (leftDays == null || Number.isNaN(Number(leftDays))) return '—';
  return String(leftDays);
}

function applyAboutInfo({ key = '', leftDays = null, version = '' } = {}) {
  const licenseKey = String(key || '').trim() || '—';
  const daysText = formatAboutDays(leftDays);
  const versionText = String(version || '').trim() || '—';
  const subtitle = licenseKey !== '—' ? `License ${licenseKey}` : 'License';

  document.querySelectorAll('.about-license-key').forEach((el) => {
    el.textContent = licenseKey;
  });
  document.querySelectorAll('.about-license-days').forEach((el) => {
    el.textContent = daysText;
  });
  document.querySelectorAll('.about-app-version').forEach((el) => {
    el.textContent = versionText;
  });
  document.querySelectorAll('.about-license-subtitle').forEach((el) => {
    el.textContent = subtitle;
  });
}

async function refreshAboutInfo(refreshFromServer = false) {
  if (!window.ocean?.getLicenseAbout) return;
  try {
    const info = refreshFromServer && window.ocean.refreshLicenseAbout
      ? await window.ocean.refreshLicenseAbout()
      : await window.ocean.getLicenseAbout();
    applyAboutInfo(info);
  } catch (err) {
    console.warn('[Ocean] About info failed', err);
  }
}

function enableDropdownDrag(card) {
  if (!card || card.dataset.dragBound === '1') return;
  card.dataset.dragBound = '1';
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = e.clientX - offsetX;
    let top = e.clientY - offsetY;
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('is-dragging');
    try {
      card.releasePointerCapture(e.pointerId);
    } catch (_) {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    const rect = card.getBoundingClientRect();
    dragging = true;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    card.style.position = 'fixed';
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.width = `${rect.width}px`;
    card.classList.add('is-dragging', 'is-dragged');
    try {
      card.setPointerCapture(e.pointerId);
    } catch (_) {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function wireToolbarMenus() {
  if (SHELL.view !== 'toolbar') return;
  document.querySelectorAll('details.tb-brand-menu, details.tb-settings-menu').forEach((details) => {
    const card = details.querySelector('.dropdown-card');
    const summary = details.querySelector('summary');
    enableDropdownDrag(card);
    // Expand window before details opens so first paint isn't clipped
    summary?.addEventListener('pointerdown', () => {
      if (!details.open) window.ocean?.setToolbarMenuOpen?.(true);
    });
    details.addEventListener('toggle', () => {
      if (details.open) {
        document
          .querySelectorAll('details.tb-brand-menu, details.tb-settings-menu')
          .forEach((other) => {
            if (other !== details) {
              other.open = false;
              resetDropdownCardPosition(other.querySelector('.dropdown-card'));
            }
          });
        resetDropdownCardPosition(card);
        if (details.classList.contains('tb-brand-menu')) {
          refreshAboutInfo(true);
        }
      } else {
        resetDropdownCardPosition(card);
      }
      syncToolbarMenuShell();
    });
  });
}

function closeModals() {
  if (SHELL.view === 'toolbar') {
    window.ocean?.closeModalShell?.();
    return;
  }
  if (SHELL.view === 'modal') {
    window.ocean?.closeModalShell?.();
    return;
  }
  activateModalLocal('');
}

function setRunsDrawer(open) {
  if (open) openModal('history');
  else closeModals();
}

async function refreshLists() {
  const [journeys, credentials, payments] = await Promise.all([
    window.ocean.listProfiles('journeys'), window.ocean.listProfiles('credentials'), window.ocean.listProfiles('payments'),
  ]);

  fillSelect('journeySelect', journeys, state.selectedJourneyId, (j) =>
    j.name || `${j.from || '?'} → ${j.to || '?'}`
  );
  const activeCredentials = credentials.filter(
    (c) => String(c.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
  );
  let selectedCred = state.selectedCredentialId;
  if (
    selectedCred &&
    !activeCredentials.some((c) => c.id === selectedCred)
  ) {
    selectedCred = activeCredentials[0]?.id || null;
    state.selectedCredentialId = selectedCred;
  }
  fillSelect('credentialSelect', activeCredentials, selectedCred, (c) =>
    c.username || c.name || 'Login'
  );
  fillSelect('paymentSelect', payments, state.selectedPaymentId, (p) =>
    p.name || p.paymentMethod || 'Payment'
  );
  updateRunChips(journeys, credentials, payments);
  renderTicketsList(journeys);
  renderPaymentsList(payments);
  await Promise.all([renderAccountsList(credentials), renderProxiesList()]);
}

function stationCodeShort(raw) {
  if (window.OceanStations?.normalizeToStationCode) {
    const c = window.OceanStations.normalizeToStationCode(raw);
    if (c) return c;
  }
  if (window.OceanStations?.stationCodeFromValue) {
    const c = window.OceanStations.stationCodeFromValue(raw);
    if (c) return c;
  }
  const s = String(raw || '').trim();
  if (!s) return '—';
  const parts = s.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim().toUpperCase();
  if (s.length <= 5) return s.toUpperCase();
  return s.slice(0, 4).toUpperCase();
}

function setStationInput(id, raw) {
  const code = stationCodeShort(raw);
  setVal(id, code === '—' ? '' : code);
}

/** BWN_KAN_ARSHAD — from + to codes + first passenger name (6 chars) */
function buildAutoTicketName() {
  const fromRaw = val('from-station-input');
  const toRaw = val('destination-station-input');
  const from = stationCodeShort(fromRaw);
  const to = stationCodeShort(toRaw);
  if (!fromRaw.trim() || !toRaw.trim() || from === '—' || to === '—') return '';
  const namePart = val('passenger-name-1')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase();
  if (!namePart) return `${from}_${to}`;
  return `${from}_${to}_${namePart}`;
}

function updateAutoTicketName() {
  const name = buildAutoTicketName();
  if (name) setVal('journey-profile-name', name);
}

function validateJourneyForm() {
  const from = val('from-station-input').trim();
  const to = val('destination-station-input').trim();
  const date = val('journey-date').trim();
  const train = val('train-no').trim();
  const cls = val('journey-class-input').trim();
  const quota = val('quota-input').trim();
  const mobile = val('mobileNumber').trim();
  const payId = val('paymentSelect').trim();
  const p1name = val('passenger-name-1').trim();
  const p1age = val('age-1').trim();

  if (!from) return { ok: false, message: 'FROM station fill/select nahi kiya' };
  if (!to) return { ok: false, message: 'TO station fill/select nahi kiya' };
  if (!date) return { ok: false, message: 'DATE select nahi kiya' };
  if (!train) return { ok: false, message: 'TRAIN number fill nahi kiya' };
  if (!cls) return { ok: false, message: 'CLASS select nahi kiya' };
  if (!quota) return { ok: false, message: 'QUOTA select nahi kiya' };
  if (!p1name) return { ok: false, message: 'Passenger 1 NAME fill nahi kiya' };
  const ageNum = Number(p1age);
  if (!p1age || !/^\d{1,3}$/.test(p1age) || ageNum < 1 || ageNum > 125) {
    return { ok: false, message: 'Passenger 1 AGE 1-125 (number only) fill karo' };
  }
  if (!/^\d{10}$/.test(mobile)) return { ok: false, message: 'MOBILE number 10 digit fill karo' };
  if (!payId) return { ok: false, message: 'BANK / GATEWAY select nahi kiya' };
  return { ok: true };
}

function wireTicketNameAutoUpdate() {
  const fields = [
    'from-station-input',
    'destination-station-input',
    'passenger-name-1',
    'train-no',
    'journey-class-input',
    'quota-input',
  ];
  for (const id of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', updateAutoTicketName);
    el.addEventListener('change', updateAutoTicketName);
  }
}

function formatTicketDate(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return iso;
}

function parseTicketDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function filterTickets(journeys) {
  const q = state.ticketsSearch.trim().toLowerCase();
  let list = journeys.slice();
  if (q) {
    list = list.filter((j) => {
      const hay = [
        j.name,
        j.from,
        j.to,
        j.trainNo,
        j.quota,
        j.class,
        j.date,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  if (state.ticketsFilter === 'all') return list;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  return list.filter((j) => {
    const d = parseTicketDate(j.date);
    if (!d) return state.ticketsFilter === 'all';
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / dayMs);
    if (state.ticketsFilter === 'today') return diff === 0;
    if (state.ticketsFilter === 'tomorrow') return diff === 1;
    if (state.ticketsFilter === 'week') return diff >= 0 && diff <= 6;
    return true;
  });
}

function trainNumberOnly(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/(\d{3,5})/);
  return m ? m[1] : s.split('-')[0].trim() || '—';
}

function renderTicketsList(journeys) {
  const list = document.getElementById('ticketsList');
  const empty = document.getElementById('ticketsEmpty');
  const totalEl = document.getElementById('ticketsTotalCount');
  if (!list) return;
  const filtered = filterTickets(journeys);
  list.innerHTML = '';
  if (totalEl) {
    totalEl.textContent = String(filtered.length).padStart(2, '0');
  }
  if (empty) empty.hidden = filtered.length > 0;
  filtered.forEach((j) => {
    const row = document.createElement('div');
    row.className = `table-row ticket${j.id === state.selectedJourneyId ? ' is-selected' : ''}`;
    row.dataset.id = j.id;
    row.innerHTML = `
      <span class="ticket-train">${trainNumberOnly(j.trainNo)}</span>
      <span class="ticket-name" title="${j.name || ''}">${j.name || '—'}</span>
      <span class="ticket-bold">${stationCodeShort(j.from)}</span>
      <span class="ticket-bold">${stationCodeShort(j.to)}</span>
      <span class="ticket-bold">${formatTicketDate(j.date)}</span>
      <span class="ticket-bold">${j.quota || 'GN'}</span>
      <span class="ticket-bold">${j.class || '—'}</span>
      <span class="ticket-act">
        <button type="button" class="btn btn-sm btn-primary" data-action="ticket-open" data-id="${j.id}">Open</button>
      </span>
      <span class="ticket-act">
        <button type="button" class="btn btn-sm btn-secondary" data-action="ticket-edit" data-id="${j.id}">Edit</button>
      </span>
      <span class="ticket-act">
        <button type="button" class="btn btn-sm btn-secondary danger" data-action="ticket-delete" data-id="${j.id}">Delete</button>
      </span>
    `;
    list.appendChild(row);
  });
}

async function openTicketPanel(id) {
  if (!id) {
    toast('Ticket ID missing');
    return;
  }
  if (!window.ocean?.openTicketPanel) {
    toast('Panel API missing — app restart karo');
    return;
  }
  const r = await window.ocean.openTicketPanel(id);
  if (!r?.ok) {
    toast(r?.error || 'Panel open failed');
    return;
  }
  closeModals();
}

async function editTicket(id) {
  await selectJourney(id);
  syncSaveJourneyButton();
  openModal('book');
}

async function duplicateTicket(id) {
  const j = await window.ocean.getProfile({ kind: 'journeys', id });
  if (!j) return;
  const saved = await window.ocean.saveJourney({
    name: `${j.name || 'ticket'}_copy`,
    from: j.from,
    to: j.to,
    date: j.date,
    trainNo: j.trainNo,
    class: j.class,
    quota: j.quota,
    boarding: j.boarding,
    availabilityCheck: j.availabilityCheck,
    slbooktime: j.slbooktime,
    acbooktime: j.acbooktime,
    gnbooktime: j.gnbooktime,
    passengers: j.passengers,
    infants: j.infants,
    contact: j.contact,
    options: j.options,
  });
  toast(`Copied: ${saved.name}`);
  await refreshLists();
}

async function deleteTicket(id) {
  if (!confirm('Delete this ticket?')) return;
  await window.ocean.deleteProfile('journeys', id);
  if (state.selectedJourneyId === id) clearJourneyEditor();
  await refreshLists();
  toast('Ticket deleted');
}

function setTicketsFilter(filter) {
  state.ticketsFilter = filter;
  document.querySelectorAll('[data-action^="tickets-filter-"]').forEach((btn) => {
    const key = btn.dataset.action.replace('tickets-filter-', '');
    btn.classList.toggle('is-active', key === filter);
  });
  window.ocean.listProfiles('journeys').then((journeys) => renderTicketsList(journeys));
}

async function renderAccountsList(credentials) {
  const list = document.getElementById('accountsList');
  const empty = document.getElementById('accountsEmpty');
  const count = document.getElementById('accountsCount');
  const activeEl = document.getElementById('accountsActiveCount');
  const inactiveEl = document.getElementById('accountsInactiveCount');
  if (!list) return;
  list.innerHTML = '';

  const total = credentials.length;
  const activeCount = credentials.filter(
    (c) => String(c.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
  ).length;
  const inactiveCount = credentials.filter((c) => {
    const s = String(c.status || 'ACTIVE').toUpperCase();
    return s !== 'ACTIVE';
  }).length;
  if (count) count.textContent = String(total);
  if (activeEl) activeEl.textContent = String(activeCount);
  if (inactiveEl) inactiveEl.textContent = String(inactiveCount);
  if (empty) empty.hidden = total > 0;

  const detailed = await Promise.all(
    credentials.map(async (c) => {
      try {
        const full = await window.ocean.getProfile({
          kind: 'credentials',
          id: c.id,
          includeSecrets: true,
        });
        return full ? { ...c, ...full } : c;
      } catch {
        return c;
      }
    })
  );

  detailed.forEach((c) => {
    const status = String(c.status || 'ACTIVE').toUpperCase();
    const isSelected = c.id === state.selectedCredentialId;
    const row = document.createElement('div');
    row.className = `table-row account${isSelected ? ' is-selected' : ''}`;
    row.dataset.id = c.id;

    const user = document.createElement('span');
    user.textContent = c.username || c.name || '—';

    const pass = document.createElement('span');
    pass.textContent = c.password || '—';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'account-action';
    if (status === 'ACTIVE') action.classList.add('is-active');
    else if (status === 'BOOKED') action.classList.add('is-booked');
    else action.classList.add('is-deactive');
    action.textContent = status;
    action.title = 'Click to toggle ACTIVE / DEACTIVE';
    action.addEventListener('click', async (e) => {
      e.stopPropagation();
      // STAR: ACTIVE → DEACTIVE; DEACTIVE/BOOKED/… → ACTIVE
      const next = status === 'ACTIVE' ? 'DEACTIVE' : 'ACTIVE';
      try {
        if (typeof window.ocean.setCredentialStatus !== 'function') return;
        await window.ocean.setCredentialStatus(c.id, next);
        await refreshLists();
      } catch (err) {
        console.warn('[Ocean] credential status toggle failed', err);
      }
    });

    const delWrap = document.createElement('span');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'account-del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.selectedCredentialId = c.id;
      await deleteSelected('credentials');
    });
    delWrap.appendChild(delBtn);

    row.append(user, pass, action, delWrap);
    row.addEventListener('click', () =>
      selectCredential(c.id, { navigate: false, fillForm: false })
    );
    list.appendChild(row);
  });
}

function setAccountsBulkMode(on) {
  const bulk = Boolean(on);
  const panel = document.getElementById('accountsBulkPanel');
  const table = document.getElementById('accountsTableCard');
  const passWrap = document.getElementById('accountsSinglePassWrap');
  const addBtn = document.getElementById('saveCredentialBtn');
  const toggle = document.getElementById('accountsBulkToggle');
  if (toggle) toggle.checked = bulk;
  if (panel) panel.hidden = !bulk;
  if (table) table.hidden = bulk;
  if (passWrap) passWrap.hidden = bulk;
  if (addBtn) addBtn.hidden = bulk;
}

function parseBulkCredentialLines(text, commonPassword) {
  const common = String(commonPassword || '').trim();
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let username = '';
    let password = '';
    if (line.includes(':')) {
      const i = line.indexOf(':');
      username = line.slice(0, i).trim();
      password = line.slice(i + 1).trim();
    } else if (line.includes(',')) {
      const parts = line.split(',');
      username = (parts[0] || '').trim();
      password = (parts[1] || '').trim();
    } else {
      username = line;
      password = common;
    }
    if (!username) continue;
    if (!password && common) password = common;
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ username, password, name: username });
  }
  return out;
}

async function saveBulkCredentials() {
  const lines = parseBulkCredentialLines(
    val('accountsBulkText'),
    val('accountsBulkCommonPass')
  );
  if (!lines.length) {
    toast('Paste at least one userid:password');
    return;
  }
  const missingPass = lines.filter((x) => !x.password);
  if (missingPass.length) {
    toast(`Password missing for ${missingPass[0].username}`);
    return;
  }
  const btn = document.getElementById('accountsBulkSaveBtn');
  if (btn) btn.disabled = true;
  try {
    let lastId = null;
    for (const item of lines) {
      const saved = await window.ocean.saveCredential(item);
      lastId = saved?.id || lastId;
    }
    if (lastId) {
      state.selectedCredentialId = lastId;
      await window.ocean.setUiState({ selectedCredentialId: lastId });
    }
    setVal('accountsBulkText', '');
    setAccountsBulkMode(false);
    toast(`Saved ${lines.length} ID${lines.length > 1 ? 's' : ''}`);
    await refreshLists();
  } catch (e) {
    toast(e?.message || 'Bulk save failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderPaymentsList(payments) {
  const list = document.getElementById('paymentsList');
  const empty = document.getElementById('paymentsEmpty');
  if (!list) return;
  list.innerHTML = '';
  if (empty) empty.hidden = payments.length > 0;
  payments.forEach((p) => {
    const row = document.createElement('div');
    row.className = `table-row payment${p.id === state.selectedPaymentId ? ' is-selected' : ''}`;
    row.dataset.id = p.id;
    const method = String(p.paymentMethod || '—').trim();
    const vpa = String(p.vpa || '').trim();
    const label =
      vpa && vpa.toUpperCase() !== method.toUpperCase()
        ? `${method} · ${vpa}`
        : method;
    row.innerHTML = `
      <span>${label}</span>
      <span>${p.id === state.selectedPaymentId ? 'Active' : ''}</span>
    `;
    row.addEventListener('click', () => selectPayment(p.id));
    list.appendChild(row);
  });
}

function formatProxyString(p) {
  if (!p?.host) return '';
  const host = String(p.host || '').trim();
  const port = p.port ? String(p.port) : '';
  const user = String(p.username || '').trim();
  const pass = String(p.password || '');
  if (host && port && user) {
    return pass ? `${host}:${port}:${user}:${pass}` : `${host}:${port}:${user}`;
  }
  if (host && port) return `${host}:${port}`;
  return host;
}

async function renderProxiesList() {
  const list = document.getElementById('proxiesList');
  const empty = document.getElementById('proxiesEmpty');
  const count = document.getElementById('proxiesCount');
  const selectAll = document.getElementById('proxySelectAll');
  if (!list) return;
  list.innerHTML = '';
  if (selectAll) selectAll.checked = false;
  try {
    const res =
      typeof window.ocean?.listProxies === 'function'
        ? await window.ocean.listProxies()
        : null;
    const proxies = Array.isArray(res?.proxies) ? res.proxies : [];
    if (count) count.textContent = String(proxies.length);
    if (empty) empty.hidden = proxies.length > 0;
    if (!proxies.length) return;
    const esc = (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    proxies.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'table-row proxy';
      row.dataset.id = p.id || '';
      row.innerHTML = `
        <span class="proxy-check-col">
          <input type="checkbox" class="proxy-row-check" data-id="${esc(p.id)}" aria-label="Select proxy ${i + 1}" />
        </span>
        <span>${i + 1}</span>
        <span title="${esc(p.host)}">${esc(p.host || '—')}</span>
        <span>${esc(p.port || '—')}</span>
        <span>${esc(p.username || '—')}</span>
        <span title="${esc(p.password || '')}">${esc(p.password || '—')}</span>
      `;
      list.appendChild(row);
    });
  } catch {
    if (count) count.textContent = '0';
    if (empty) empty.hidden = false;
  }
}

function getSelectedProxyIds() {
  return Array.from(document.querySelectorAll('.proxy-row-check:checked'))
    .map((el) => el.dataset.id || el.closest('.table-row')?.dataset.id || '')
    .filter(Boolean);
}

function clearProxyInput() {
  const host = document.getElementById('proxyHost');
  if (host) host.value = '';
}

async function selectJourney(id, { navigate = true } = {}) {
  const j = await window.ocean.getProfile({ kind: 'journeys', id });
  if (!j) return;
  fillJourneyEditor(j);
  await window.ocean.setUiState({ selectedJourneyId: id });
  if (navigate) showEditorTab('journey');
  await refreshLists();
}

async function selectCredential(id, { navigate = true, fillForm = navigate } = {}) {
  const c = await window.ocean.getProfile({ kind: 'credentials', id, includeSecrets: true });
  if (!c) return;
  state.selectedCredentialId = c.id;
  if (fillForm) fillCredentialEditor(c);
  await window.ocean.setUiState({ selectedCredentialId: id });
  if (navigate) showEditorTab('login');
  await refreshLists();
}

async function selectPayment(id, { navigate = true } = {}) {
  const p = await window.ocean.getProfile({ kind: 'payments', id, includeSecrets: true });
  if (!p) return;
  fillPaymentEditor(p);
  await window.ocean.setUiState({ selectedPaymentId: id });
  if (navigate) showEditorTab('payment');
  await refreshLists();
}

async function saveJourney() {
  const formCheck = validateJourneyForm();
  if (!formCheck.ok) {
    toast(formCheck.message);
    return;
  }
  if (window.OceanStations) {
    const check = window.OceanStations.validateJourneyStations();
    if (!check.ok) {
      toast(check.problems[0] || 'Station list se choose karo');
      return;
    }
  }
  // Sync IRCTC ID / payment picks from Book dropdowns
  const credId = val('credentialSelect');
  const payId = val('paymentSelect');
  if (credId) {
    state.selectedCredentialId = credId;
    await window.ocean.setUiState({ selectedCredentialId: credId });
  }
  if (payId) {
    state.selectedPaymentId = payId;
    await window.ocean.setUiState({ selectedPaymentId: payId });
  }
  const wasEdit = Boolean(state.selectedJourneyId);
  const payload = collectJourneyPayload();
  // Persist station codes only (LTT / BSB)
  payload.from = stationCodeShort(payload.from);
  payload.to = stationCodeShort(payload.to);
  if (payload.boarding) payload.boarding = stationCodeShort(payload.boarding);
  if (payload.from === '—') payload.from = '';
  if (payload.to === '—') payload.to = '';
  if (payload.boarding === '—') payload.boarding = '';
  const saved = await window.ocean.saveJourney(payload);
  state.selectedJourneyId = saved.id;
  await window.ocean.setUiState({ selectedJourneyId: saved.id });
  fillJourneyEditor(saved);
  toast(wasEdit ? `Ticket updated: ${saved.name}` : `Ticket saved: ${saved.name}`);
  await refreshLists();
  closeModals();
}

async function saveCredential() {
  const payload = collectCredentialPayload();
  if (!payload.username) {
    toast('Enter IRCTC ID');
    return;
  }
  if (!payload.password && !state.credentialEditMode) {
    toast('Enter password');
    return;
  }
  const saved = await window.ocean.saveCredential(payload);
  const wasEdit = state.credentialEditMode;
  state.selectedCredentialId = saved.id;
  state.credentialEditMode = false;
  await window.ocean.setUiState({ selectedCredentialId: saved.id });
  setVal('irctc-login', '');
  setVal('irctc-password', '');
  setLoginFieldsEditable(true);
  toast(wasEdit ? `Updated: ${saved.username || saved.name}` : `Added: ${saved.username || saved.name}`);
  await refreshLists();
}

async function editCredential() {
  if (!state.selectedCredentialId) {
    toast('Pehle list se ID select karo');
    return;
  }
  const c = await window.ocean.getProfile({
    kind: 'credentials',
    id: state.selectedCredentialId,
    includeSecrets: true,
  });
  if (!c) return;
  state.credentialEditMode = true;
  setVal('irctc-login', c.username || '');
  setVal('irctc-password', c.password || '');
  setLoginFieldsEditable(true);
  setAccountsBulkMode(false);
  document.getElementById('irctc-password')?.focus();
  toast('Change PASS — edit karke Add IRCTC dabao');
}

async function savePayment() {
  const method = val('paymentMethod').trim();
  if (!method) {
    toast('Gateway select karo');
    return;
  }

  const payments = await window.ocean.listProfiles('payments');
  const existing = payments.find((p) => p.paymentMethod === method);
  const label = paymentMethodLabel(method);

  if (existing) {
    if (state.selectedPaymentId === existing.id) {
      const saved = await window.ocean.savePayment(collectPaymentPayload({ id: existing.id }));
      state.selectedPaymentId = saved.id;
      toast(`Updated: ${label}`);
      await refreshLists();
      return;
    }
    toast(`${label} pehle se add hai — replace nahi hoga`);
    await selectPayment(existing.id, { navigate: false });
    return;
  }

  const saved = await window.ocean.savePayment(collectPaymentPayload());
  state.selectedPaymentId = saved.id;
  toast(`Added: ${label}`);
  await refreshLists();
}

async function renameSelected(kind) {
  const id =
    kind === 'journeys'
      ? state.selectedJourneyId
      : kind === 'credentials'
        ? state.selectedCredentialId
        : state.selectedPaymentId;
  if (!id) {
    toast('Select a profile first');
    return;
  }
  const name = prompt('New name:');
  if (!name) return;
  await window.ocean.renameProfile(kind, id, name);
  if (kind === 'journeys') setVal('journey-profile-name', name);
  toast('Renamed');
  await refreshLists();
}

async function deleteSelected(kind) {
  const id =
    kind === 'journeys'
      ? state.selectedJourneyId
      : kind === 'credentials'
        ? state.selectedCredentialId
        : state.selectedPaymentId;
  if (!id) {
    toast('Select a profile first');
    return;
  }
  if (!confirm('Delete this profile?')) return;
  await window.ocean.deleteProfile(kind, id);
  if (kind === 'journeys') clearJourneyEditor();
  if (kind === 'credentials') clearCredentialEditor();
  if (kind === 'payments') clearPaymentEditor();
  toast('Deleted');
  await refreshLists();
}

async function deleteAllPayments() {
  const payments = await window.ocean.listProfiles('payments');
  if (!payments.length) {
    toast('No payment methods to delete');
    return;
  }
  if (!confirm('Delete ALL saved payment methods?')) return;
  for (const p of payments) await window.ocean.deleteProfile('payments', p.id);
  clearPaymentEditor();
  await window.ocean.setUiState({ selectedPaymentId: null });
  toast('All payment methods deleted');
  await refreshLists();
}

function shortUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url.slice(0, 40);
  }
}

function renderRuns(runs) {
  const ul = document.getElementById('runList');
  const badge = document.getElementById('runCountHeader');
  const status = document.getElementById('irctcStatus');
  if (badge) badge.textContent = `${runs.length}/${state.maxRuns}`;
  if (status) {
    status.textContent = runs.length
      ? `${runs.length} active run${runs.length > 1 ? 's' : ''}`
      : 'No active runs';
    status.classList.toggle('is-open', runs.length > 0);
  }
  if (!ul) return;

  ul.innerHTML = '';
  if (!runs.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No active runs';
    ul.appendChild(li);
    return;
  }

  for (const run of runs) {
    const li = document.createElement('li');
    li.className = 'run-item';
    li.innerHTML = `
      <div class="run-title">${run.credentialName || 'Login'} · ${run.journeyName || 'Journey'}</div>
      <div class="run-meta">${run.engine || 'electron'} · ${run.mode || 'nget'} · ${run.status} · ${shortUrl(run.url)}</div>
      <div class="run-actions">
        <button type="button" class="btn btn-outline btn-sm" data-focus="${run.sessionId}">Focus</button>
        <button type="button" class="btn btn-red btn-sm" data-stop="${run.sessionId}">Stop</button>
      </div>
    `;
    ul.appendChild(li);
  }

  ul.querySelectorAll('[data-focus]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.ocean.focusRun(btn.dataset.focus);
    });
  });
  ul.querySelectorAll('[data-stop]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.ocean.stopRun(btn.dataset.stop);
    });
  });
}

function formatHistoryWhen(iso) {
  if (!iso) return '';
  const s = String(iso);
  // Prefer YYYY-MM-DD for STAR Date column
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return s.slice(0, 10);
  }
}

function renderHistory(items) {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  const count = document.getElementById('historyCount');
  const rows = Array.isArray(items) ? items : [];
  if (count) count.textContent = String(rows.length);
  if (empty) empty.hidden = rows.length > 0;
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i];
    const row = document.createElement('div');
    row.className = `history-row${i % 2 === 0 ? ' is-alt' : ''}`;
    const idLabel = String(rows.length - i);
    const ticketName = h.ticketName || h.journeyName || '—';
    const userId = h.userId || h.credentialName || '—';
    const from = h.fromStn || h.from || '—';
    const to = h.toStn || h.to || '—';
    const jrny = h.journeyDate || h.date || '—';
    const bank = h.bankName || '—';
    const pnr = h.pnr || '—';
    const fare = h.fare || '—';
    const booked = formatHistoryWhen(h.bookingDate || h.createdAt);
    row.innerHTML = `
      <span class="col-id">${idLabel}</span>
      <span class="col-ticket" title="${ticketName}">${ticketName}</span>
      <span class="col-user" title="${userId}">${userId}</span>
      <span class="col-from">${from}</span>
      <span class="col-to">${to}</span>
      <span class="col-jrny">${jrny}</span>
      <span class="col-bank" title="${bank}">${bank}</span>
      <span class="col-pnr">${pnr}</span>
      <span class="col-fare">${fare}</span>
      <span class="col-date">${booked}</span>
    `;
    list.appendChild(row);
  }
}

async function refreshHistory() {
  if (typeof window.ocean?.listHistory !== 'function') return;
  try {
    const data = await window.ocean.listHistory();
    renderHistory(data?.items || []);
  } catch (_) {
    renderHistory([]);
  }
}

async function startRun() {
  const credId = val('credentialSelect') || state.selectedCredentialId;
  const payId = val('paymentSelect') || state.selectedPaymentId;
  if (credId) state.selectedCredentialId = credId;
  if (payId) state.selectedPaymentId = payId;

  if (!state.selectedJourneyId || !state.selectedCredentialId || !state.selectedPaymentId) {
    toast('Select Journey + Login + Payment first');
    return;
  }
  if (window.OceanStations) {
    const check = window.OceanStations.validateJourneyStations();
    if (!check.ok) {
      showEditorTab('journey');
      toast(check.problems[0] || 'Station list se choose karo');
      return;
    }
  }
  const mode = val('runMode') || 'nget';
  const engine = val('runEngine') || 'system-chrome';
  const ipMode = val('bookIpSelect') === 'proxy' ? 'proxy' : 'auto';
  const result = await window.ocean.startRun({
    journeyId: state.selectedJourneyId,
    credentialId: state.selectedCredentialId,
    paymentId: state.selectedPaymentId,
    mode,
    engine,
    ipMode,
  });
  if (!result.ok) {
    toast(result.error || 'Start failed');
    return;
  }
  setRunsDrawer(true);
  const eng = result.run?.engine || engine;
  const modeLabel =
    mode === 'direct'
      ? 'Direct Booking (login → API)'
      : mode === 'eticket'
        ? 'beta eticket'
        : 'classic nget';
  toast(
    eng === 'brave'
      ? `Brave host + ${modeLabel}`
      : eng === 'system-chrome'
        ? `System Chrome + ${modeLabel} (~8s)`
        : `Electron + ${modeLabel}`
  );
}

function startClock() {
  const clock = document.getElementById('timerClock');
  const toolbarClock = document.getElementById('toolbarClock');
  const tick = () => {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    if (clock) clock.textContent = t;
    if (toolbarClock) toolbarClock.textContent = t;
  };
  tick();
  setInterval(tick, 1000);
}

async function loadManualLoginSetting() {
  if (!window.ocean?.getUiState) return;
  try {
    const ui = await window.ocean.getUiState();
    const el = document.getElementById('optManualLogin');
    if (el) el.checked = String(ui.manualLoginEnabled ?? '0') === '1';
  } catch (e) {
    console.warn('[Ocean] Manual login load failed', e);
  }
}

async function saveManualLogin(enabled) {
  if (!window.ocean?.setUiState) return;
  await window.ocean.setUiState({ manualLoginEnabled: enabled ? '1' : '0' });
  toast(
    enabled
      ? 'Manual login ON — password aur Sign In aap karenge'
      : 'Auto login ON — password fill + Sign In automatic'
  );
}

async function loadTrueCaptchaForm() {
  if (!window.ocean?.getTrueCaptcha) return;
  try {
    const c = await window.ocean.getTrueCaptcha();
    const ui = await window.ocean.getUiState();
    const en = document.getElementById('trueCaptchaEnabled');
    const uid = document.getElementById('trueCaptchaUserId');
    const key = document.getElementById('trueCaptchaApiKey');
    if (en) en.checked = String(ui.trueCaptchaEnabled ?? '1') !== '0';
    if (uid) uid.value = c.userId || '';
    if (key) key.value = c.apiKey || '';
  } catch (e) {
    console.warn('[Ocean] TrueCaptcha load failed', e);
  }
}

async function saveTrueCaptcha() {
  if (!window.ocean?.setTrueCaptcha) {
    toast('Captcha save unavailable');
    return;
  }
  const enabled = Boolean(document.getElementById('trueCaptchaEnabled')?.checked);
  const userId = val('trueCaptchaUserId');
  const apiKey = val('trueCaptchaApiKey');
  await window.ocean.setTrueCaptcha({ enabled, userId, apiKey });
  toast(
    enabled && userId && apiKey
      ? 'TrueCaptcha saved (jab captcha aaye tab use hoga)'
      : 'Captcha settings saved — captcha nahi aaya to skip'
  );
}

async function loadProxyForm() {
  // Input stays empty for new paste — saved proxy only in list below
  clearProxyInput();
  await renderProxiesList();
}

async function saveProxy() {
  if (!window.ocean?.addProxy && !window.ocean?.setProxy) {
    toast('Proxy save unavailable');
    return;
  }
  const host = val('proxyHost').trim();
  if (!host) {
    toast('Proxy string paste karo');
    return;
  }
  if (!host.includes(':')) {
    toast('Proxy string: host:port ya host:port:user:pass');
    return;
  }
  try {
    if (typeof window.ocean.addProxy === 'function') {
      const res = await window.ocean.addProxy({ host });
      clearProxyInput();
      await renderProxiesList();
      toast(`Proxy added (${res?.count ?? '?'} saved)`);
      return;
    }
    const saved = await window.ocean.setProxy({ host });
    clearProxyInput();
    await renderProxiesList();
    toast(
      saved.configured
        ? `Proxy saved — ${saved.host}:${saved.port}`
        : 'Proxy cleared'
    );
  } catch (e) {
    toast(e && e.message ? e.message : String(e));
  }
}

async function deleteProxy() {
  if (!window.ocean?.deleteProxies && !window.ocean?.setProxy) {
    toast('Proxy delete unavailable');
    return;
  }
  const ids = getSelectedProxyIds();
  if (!ids.length) {
    toast('Pehle list se proxy select karo');
    return;
  }
  if (!confirm(`Delete ${ids.length} selected proxy?`)) return;
  try {
    if (typeof window.ocean.deleteProxies === 'function') {
      await window.ocean.deleteProxies({ ids });
    } else {
      await window.ocean.setProxy({ host: '' });
    }
    clearProxyInput();
    await renderProxiesList();
    toast(ids.length > 1 ? `${ids.length} proxies deleted` : 'Proxy deleted');
  } catch (e) {
    toast(e && e.message ? e.message : String(e));
  }
}

async function testProxy() {
  if (!window.ocean?.testProxy) {
    toast('Proxy test unavailable');
    return;
  }
  const raw = val('proxyHost').trim();
  const selected = getSelectedProxyIds();
  const btn = document.getElementById('btnProxyTest');
  if (btn) btn.disabled = true;
  try {
    let payload = {};
    if (raw) {
      payload = { host: raw };
    } else if (selected.length) {
      payload = { id: selected[0] };
    }
    const res = await window.ocean.testProxy(payload);
    if (res?.ok) {
      toast(
        `IRCTC OK — HTTP ${res.status || 200}${res.ms != null ? ` (${res.ms}ms)` : ''}`
      );
    } else {
      toast(res?.error || 'Proxy check failed');
    }
  } catch (e) {
    toast(e && e.message ? e.message : String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function bootstrap() {
  if (!window.ocean) {
    toast('Ocean bridge missing');
    return;
  }

  const info = await window.ocean.getAppInfo();
  state.maxRuns = info.maxParallelRuns || 4;
  refreshAboutInfo(false).catch(error => console.warn('[Ocean] About load:', error.message));

  const runs = await window.ocean.listRuns();
  renderRuns(runs.runs || []);
  window.ocean.onRunsStatus((data) => renderRuns(data.runs || []));
  refreshHistory().catch(error => console.warn('[Ocean] History load:', error.message));
  window.ocean.onHistoryUpdated?.((data) => {
    renderHistory(data?.items || []);
  });

  // Toolbar shell: show immediately — heavy work only in modal window
  if (SHELL.view === 'toolbar') {
    console.log('[Ocean] Toolbar ready');
    return;
  }

  const stationsReady = (async () => { try {
    if (window.OceanStations) {
      const n = await window.OceanStations.initStationAutocomplete();
      console.log('[Ocean] Stations loaded:', n);
    }
  } catch (e) {
    console.error('[Ocean] Station list failed', e);
    toast('Station list load failed');
  } })();

  const ui = await window.ocean.getUiState();
  state.selectedJourneyId = newBookDraftRequested ? null : ui.selectedJourneyId || null;
  state.selectedCredentialId = ui.selectedCredentialId || null;
  state.selectedPaymentId = ui.selectedPaymentId || null;

  await stationsReady;
  const [journey, credential, payment] = await Promise.all([
    state.selectedJourneyId ? window.ocean.getProfile({ kind: 'journeys', id: state.selectedJourneyId }) : null,
    state.selectedCredentialId ? window.ocean.getProfile({ kind: 'credentials', id: state.selectedCredentialId, includeSecrets: true }) : null,
    state.selectedPaymentId ? window.ocean.getProfile({ kind: 'payments', id: state.selectedPaymentId, includeSecrets: true }) : null,
  ]);
  if (journey && !newBookDraftRequested) fillJourneyEditor(journey);
  if (credential) fillCredentialEditor(credential);
  if (payment) fillPaymentEditor(payment);
  await refreshLists();
  await Promise.all([loadTrueCaptchaForm(), loadManualLoginSetting(), loadProxyForm()]);

  window.ocean.onTrainSelected((payload) => {
    applyTrainSelection(payload || {});
  });

  // Register early-ish; also recover if book:new-draft fired before listener
  window.ocean.onNewBookDraft?.(() => {
    prepareNewBookDraftLocal();
  });

  const startModal = document.querySelector('.modal-panel.is-active')?.dataset.modal || SHELL.modal || 'tickets';
  if (startModal === 'book' && !state.selectedJourneyId) {
    prepareNewBookDraftLocal();
  } else {
    activateModalLocal(startModal);
    if (startModal === 'book') ensureDefaultJourneyDate();
  }
  console.log('[Ocean] Modal ready:', startModal);
}

function findStationFullNameByCode(code) {
  if (!window.OceanStations || !code) return null;
  const matches = window.OceanStations.getStationMatches(code, 20) || [];
  const exact = matches.find((line) => {
    const parts = line.split(' - ');
    return (parts[parts.length - 1] || '').trim().toUpperCase() === String(code).toUpperCase();
  });
  return exact || null;
}

function applyTrainSelection(payload) {
  const {
    trainNo,
    trainClass,
    actualDestination,
    actualSource,
    quota,
    from,
    to,
    date,
  } = payload || {};

  // Edit flow: sirf train fields update — passengers / contact / selectedJourneyId mat mito
  const editingId = state.selectedJourneyId;

  if (from) setStationInput('from-station-input', from);
  if (to) setStationInput('destination-station-input', to);
  if (date) setVal('journey-date', date);

  if (actualDestination) {
    setStationInput('destination-station-input', actualDestination);
  }
  if (actualSource) {
    setStationInput('from-station-input', actualSource);
  }

  if (trainNo) setVal('train-no', trainNo);
  if (trainClass) setSelectValue('journey-class-input', trainClass);
  if (quota) setSelectValue('quota-input', quota);

  if (editingId) state.selectedJourneyId = editingId;
  updateAutoTicketName();
  syncSaveJourneyButton();

  try {
    window.OceanStations?.closeAllStationLists?.();
  } catch (_) {}

  if (SHELL.view === 'modal') {
    activateModalLocal('book');
  } else {
    showEditorTab('journey');
  }

  toast(`Train applied: ${trainNo || ''} ${trainClass || ''} ${quota || ''}`.trim());
}

async function openTrainSearch() {
  const from = stationCodeShort(val('from-station-input'));
  const to = stationCodeShort(val('destination-station-input'));
  const date = val('journey-date');
  if (!from || from === '—' || !to || to === '—' || !date) {
    toast('Pehle From, To aur Date bharo');
    return;
  }
  if (window.OceanStations) {
    const check = window.OceanStations.validateJourneyStations();
    if (!check.ok) {
      toast(check.problems[0] || 'Stations list se choose karo');
      return;
    }
  }
  await window.ocean.openTrainSearch({ from, to, date });
}

document.addEventListener('DOMContentLoaded', () => {
  buildPassengerRows();
  wireTicketNameAutoUpdate();
  startClock();
  if (SHELL.view === 'toolbar') {
    document.body.classList.add('view-toolbar');
    wireToolbarMenus();
    document.addEventListener('pointerdown', (e) => {
      const openMenu = document.querySelector(
        'details.tb-brand-menu[open], details.tb-settings-menu[open]'
      );
      if (!openMenu) return;
      if (openMenu.contains(e.target)) return;
      closeToolbarMenus();
    });
  } else if (SHELL.view === 'modal') {
    document.body.classList.add('view-modal');
    activateModalLocal(SHELL.modal || 'tickets');
    // Catch book:new-draft before async bootstrap finishes
    window.ocean?.onNewBookDraft?.(() => {
      prepareNewBookDraftLocal();
    });
  }
  bootstrap().catch((err) => {
    console.error('[Ocean] bootstrap failed', err);
  });

  window.ocean?.onModalNavigate?.((name) => {
    activateModalLocal(name || 'tickets');
    if (name === 'book') ensureDefaultJourneyDate();
    if (name === 'history' || name === 'runs') refreshHistory();
    if (name === 'about') refreshAboutInfo(true);
    refreshLists();
  });

  const on = (id, evt, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  };

  // Date box: open native calendar on any click inside the field
  on('journey-date', 'click', (e) => {
    const el = e.currentTarget;
    if (!el || typeof el.showPicker !== 'function') return;
    try {
      el.showPicker();
    } catch (_) {}
  });
  document.querySelector('.field-date')?.addEventListener('click', (e) => {
    if (e.target?.id === 'journey-date') return;
    const el = document.getElementById('journey-date');
    if (!el || typeof el.showPicker !== 'function') return;
    try {
      el.focus();
      el.showPicker();
    } catch (_) {}
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (!action) return;
      if (action === 'book-open') {
        openNewBookForm();
        return;
      }
      if (action === 'open-tickets') {
        openModal('tickets');
        return;
      }
      if (action === 'open-tokens') {
        openModal('tokens');
        return;
      }
      if (action === 'open-accounts') {
        openModal('accounts');
        return;
      }
      if (action === 'open-payment') {
        openModal('payment');
        return;
      }
      if (action === 'open-history') {
        openModal('history');
        refreshHistory();
        return;
      }
      if (action === 'settings-proxy') {
        openModal('proxies');
        return;
      }
      if (action === 'book-cancel' || action === 'modal-close') {
        closeModals();
        return;
      }
      if (action === 'add-passenger') {
        addPassengerRow();
        return;
      }
      if (action === 'remove-passenger') {
        removePassengerRow(el.dataset.index);
        return;
      }
      if (action === 'random-mobile') {
        const n = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        setVal('mobileNumber', n);
        return;
      }
      if (action === 'book-reset') {
        clearJourneyEditor();
        toast('Draft cleared');
        return;
      }
      if (action === 'book-swap') {
        const a = val('from-station-input');
        const b = val('destination-station-input');
        setVal('from-station-input', b);
        setVal('destination-station-input', a);
        updateAutoTicketName();
        return;
      }
      if (action === 'search-trains' || action === 'availability-check') {
        await openTrainSearch();
        return;
      }
      if (action === 'tickets-open-all') {
        const journeys = filterTickets(await window.ocean.listProfiles('journeys'));
        if (!journeys.length) {
          toast('No tickets to open');
          return;
        }
        for (const j of journeys) {
          await window.ocean.openTicketPanel(j.id);
        }
        closeModals();
        return;
      }
      if (action === 'tickets-history') {
        openModal('history');
        refreshHistory();
        return;
      }
      if (action === 'tickets-filter-all') {
        setTicketsFilter('all');
        return;
      }
      if (action === 'tickets-filter-today') {
        setTicketsFilter('today');
        return;
      }
      if (action === 'tickets-filter-tomorrow') {
        setTicketsFilter('tomorrow');
        return;
      }
      if (action === 'tickets-filter-week') {
        setTicketsFilter('week');
        return;
      }
      if (action === 'ticket-open') {
        await openTicketPanel(el.dataset.id);
        return;
      }
      if (action === 'ticket-edit') {
        await editTicket(el.dataset.id);
        return;
      }
      if (action === 'ticket-duplicate') {
        await duplicateTicket(el.dataset.id);
        return;
      }
      if (action === 'ticket-delete') {
        await deleteTicket(el.dataset.id);
        return;
      }
      if (action === 'tickets-delete-all') {
        if (!confirm('Delete ALL saved tickets?')) return;
        const journeys = await window.ocean.listProfiles('journeys');
        for (const j of journeys) await window.ocean.deleteProfile('journeys', j.id);
        clearJourneyEditor();
        await refreshLists();
        toast('All tickets deleted');
        return;
      }
      if (action === 'proxy-add' || action === 'proxy-test-add') {
        await saveProxy();
        return;
      }
      if (action === 'proxy-test') {
        await testProxy();
        return;
      }
      if (action === 'proxy-delete') {
        await deleteProxy();
        return;
      }
      if (action === 'tokens-check') {
        const btn = document.getElementById('btnTokensCheck');
        if (btn) btn.disabled = true;
        try {
          const res = await window.ocean.checkSensorTokens();
          const count = Number(res?.count) || 0;
          const uid = res?.userId || '—';
          const countEl = document.getElementById('tokensCount');
          const userEl = document.getElementById('tokensUserId');
          const statusEl = document.getElementById('tokensStatusLine');
          if (countEl) countEl.textContent = String(count);
          if (userEl) userEl.textContent = uid;
          if (statusEl) {
            statusEl.textContent = res?.httpOk
              ? `Queue: ${count} sensor${count === 1 ? '' : 's'} (userId=${uid})`
              : `Check failed: ${res?.reason || 'HTTP error'}`;
          }
          toast(res?.httpOk ? `Tokens: ${count}` : res?.reason || 'Check failed');
        } catch (err) {
          toast(err?.message || 'Check failed');
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }
      if (action === 'tokens-clear') {
        if (!confirm('Clear ALL sensor tokens on server for this license?')) return;
        const btn = document.getElementById('btnTokensClear');
        if (btn) btn.disabled = true;
        try {
          const res = await window.ocean.clearSensorTokens();
          const countEl = document.getElementById('tokensCount');
          const userEl = document.getElementById('tokensUserId');
          const statusEl = document.getElementById('tokensStatusLine');
          if (res?.ok) {
            if (countEl) countEl.textContent = String(Number(res.remaining) || 0);
            if (userEl) userEl.textContent = res.userId || '—';
            if (statusEl) {
              statusEl.textContent = `Cleared ${res.cleared || 0} · remaining ${res.remaining || 0}`;
            }
            toast(`Cleared ${res.cleared || 0} tokens`);
          } else {
            if (statusEl) statusEl.textContent = res?.reason || 'Clear failed';
            toast(res?.reason || 'Clear failed');
          }
        } catch (err) {
          toast(err?.message || 'Clear failed');
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }
      if (action === 'settings-export' || action === 'settings-import') {
        toast('Export/Import — baad me');
        return;
      }
      if (action === 'cleanup-cache' || action === 'cleanup-forms' || action === 'cleanup-runs') {
        toast('Cleanup stub');
        return;
      }
      if (action === 'accounts-bulk' || action === 'accounts-single') {
        setAccountsBulkMode(action === 'accounts-bulk');
        return;
      }
      if (action === 'history-clear') {
        if (!confirm('Clear all booking history?')) return;
        await window.ocean.clearHistory?.();
        renderHistory([]);
        toast('History cleared');
        return;
      }
      if (action === 'support-whatsapp') {
        await window.ocean.openSupportLink?.('whatsapp');
        return;
      }
      if (action === 'support-telegram') {
        await window.ocean.openSupportLink?.('telegram');
        return;
      }
      if (action === 'reset-key') {
        toast('Support / license — baad me');
        return;
      }
  });

  on('journeySelect', 'change', async (e) => {
    const id = e.target.value;
    if (!id) {
      clearJourneyEditor();
      await window.ocean.setUiState({ selectedJourneyId: null });
      await refreshLists();
      return;
    }
    await selectJourney(id);
  });
  // Book form dropdowns: only pick IDs — do NOT open IRCTC ID / Payment windows
  on('credentialSelect', 'change', async (e) => {
    const id = e.target.value;
    if (!id) {
      state.selectedCredentialId = null;
      await window.ocean.setUiState({ selectedCredentialId: null });
      await refreshLists();
      return;
    }
    await selectCredential(id, { navigate: false, fillForm: false });
  });
  on('paymentSelect', 'change', async (e) => {
    const id = e.target.value;
    if (!id) {
      state.selectedPaymentId = null;
      await window.ocean.setUiState({ selectedPaymentId: null });
      await refreshLists();
      return;
    }
    await selectPayment(id, { navigate: false });
  });

  on('paymentMethod', 'change', async (e) => {
    syncVpaFieldVisibility();
    const method = String(e.target?.value || '').trim();
    if (!state.selectedPaymentId || !method) return;
    const payments = await window.ocean.listProfiles('payments');
    const selected = payments.find((p) => p.id === state.selectedPaymentId);
    if (selected && selected.paymentMethod !== method) {
      state.selectedPaymentId = null;
      await window.ocean.setUiState({ selectedPaymentId: null });
      await refreshLists();
      syncVpaFieldVisibility();
    }
  });

  // Extra: catch gateway changes even if other handlers run first
  document.getElementById('paymentMethod')?.addEventListener('input', syncVpaFieldVisibility);

  syncVpaFieldVisibility();

  on('toggleRunsBtn', 'click', () => {
    const panel = document.querySelector('.modal-panel.is-active');
    setRunsDrawer(panel?.dataset.modal !== 'history');
  });
  on('closeRunsBtn', 'click', () => closeModals());
  on('closeAppBtn', 'click', () => {
    window.ocean?.quitApp?.();
  });

  on('newCredentialBtn', 'click', async () => {
    clearCredentialEditor();
    await window.ocean.setUiState({ selectedCredentialId: null });
    setAccountsBulkMode(false);
    await refreshLists();
    document.getElementById('irctc-login')?.focus();
    toast('New ID — type karke Add IRCTC');
  });
  on('editCredentialBtn', 'click', editCredential);
  on('accountsBulkToggle', 'change', (e) => {
    setAccountsBulkMode(Boolean(e.target?.checked));
  });
  on('accountsBulkSaveBtn', 'click', saveBulkCredentials);
  on('saveJourneyBtn', 'click', saveJourney);
  on('saveCredentialBtn', 'click', saveCredential);
  on('savePaymentBtn', 'click', savePayment);
  on('saveTrueCaptchaBtn', 'click', saveTrueCaptcha);
  on('optManualLogin', 'change', async (e) => {
    await saveManualLogin(Boolean(e.target.checked));
  });
  on('saveProxyBtn', 'click', saveProxy);
  on('proxySelectAll', 'change', (e) => {
    const on = Boolean(e.target?.checked);
    document.querySelectorAll('.proxy-row-check').forEach((cb) => {
      cb.checked = on;
    });
  });
  document.getElementById('proxiesList')?.addEventListener('change', (e) => {
    if (!e.target?.classList?.contains('proxy-row-check')) return;
    const all = Array.from(document.querySelectorAll('.proxy-row-check'));
    const sel = document.getElementById('proxySelectAll');
    if (sel && all.length) {
      sel.checked = all.every((cb) => cb.checked);
    }
  });
  on('deleteCredentialBtn', 'click', () => deleteSelected('credentials'));
  on('deletePaymentBtn', 'click', () => deleteSelected('payments'));
  on('deleteAllPaymentBtn', 'click', deleteAllPayments);
  on('startRunBtn', 'click', startRun);
  on('search-trains-btn', 'click', openTrainSearch);

  on('clearEditorBtn', 'click', async () => {
    if (!confirm('Clear all editor fields? (saved profiles stay)')) return;
    clearJourneyEditor();
    clearCredentialEditor();
    clearPaymentEditor();
    await window.ocean.setUiState({
      selectedJourneyId: null,
      selectedCredentialId: null,
      selectedPaymentId: null,
    });
    await refreshLists();
    toast('Editor cleared');
  });

  on('ticketsSearchInput', 'input', async (e) => {
    state.ticketsSearch = e.target.value || '';
    const journeys = await window.ocean.listProfiles('journeys');
    renderTicketsList(journeys);
  });
});

document.getElementById("backupPaymentMethod")?.addEventListener("change", syncVpaFieldVisibility);
