const el = id => document.getElementById(id);
let keys = [], revokeId = '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
function message(text, error = false) { el('message').textContent = text; el('message').hidden = false; el('message').classList.toggle('error', error); }
async function api(route, body) { const response = await fetch('/api/admin/' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) { if (response.status === 401) showLogin(); throw Error(data.error || 'Request failed'); } return data; }
function showLogin() { el('login-panel').hidden = false; el('dashboard').hidden = true; el('logout').hidden = true; el('issued').hidden = true; el('new-key').textContent = ''; }
function render() {
  el('total').textContent = keys.length;
  for (const status of ['ACTIVE', 'EXPIRED', 'REVOKED']) el(status.toLowerCase()).textContent = keys.filter(x => x.status === status).length;
  const search = el('search').value.toLowerCase();
  el('keys').innerHTML = keys.filter(x => (x.customer + x.hint).toLowerCase().includes(search)).map(x => `<tr><td>${escape(x.customer)}</td><td>…${escape(x.hint)}</td><td><span class="status">${escape(x.status)}</span></td><td>${escape(new Date(x.expiresAt).toLocaleDateString())}</td><td>${x.devicesUsed} / ${x.maxDevices}</td><td>${x.revoked ? '—' : `<button class="danger" data-revoke="${escape(x.id)}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="6">No matching keys.</td></tr>';
}
async function refresh() { keys = (await api('keys')).keys; el('login-panel').hidden = true; el('dashboard').hidden = false; el('logout').hidden = false; render(); }
el('login-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { await api('login', { password: el('password').value }); el('password').value = ''; el('message').hidden = true; await refresh(); } catch (error) { message(error.message, true); } finally { button.disabled = false; } });
el('issue-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const form = new FormData(event.target); const result = await api('issue', { customer: form.get('customer'), preferredKey: form.get('preferredKey'), days: Number(form.get('days')), maxDevices: Number(form.get('maxDevices')) }); el('new-key').textContent = result.key; el('issued').hidden = false; await refresh(); message('Activation key issued'); } catch (error) { message(error.message, true); } finally { button.disabled = false; } });
el('copy-key').addEventListener('click', async () => { try { await navigator.clipboard.writeText(el('new-key').textContent); message('Key copied'); } catch { message('Select the displayed key and copy it manually', true); } });
el('logout').addEventListener('click', async () => { try { await api('logout', {}); showLogin(); message('Signed out'); } catch (error) { message(error.message, true); } });
el('search').addEventListener('input', render);
el('keys').addEventListener('click', event => { const button = event.target.closest('[data-revoke]'); if (button) { revokeId = button.dataset.revoke; el('revoke-dialog').showModal(); } });
el('cancel-revoke').addEventListener('click', () => el('revoke-dialog').close());
el('confirm-revoke').addEventListener('click', async () => { el('confirm-revoke').disabled = true; try { await api('revoke', { id: revokeId }); el('revoke-dialog').close(); await refresh(); message('Activation key revoked'); } catch (error) { message(error.message, true); } finally { el('confirm-revoke').disabled = false; } });
api('session').then(refresh).catch(() => showLogin());
