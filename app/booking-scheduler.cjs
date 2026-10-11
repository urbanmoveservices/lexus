// One-shot schedules in India time. No catch-up bookings after sleep/restart.
const IST = 330 * 60000;
function nextStart(hour, now = Date.now()) {
  if (![8, 10, 11].includes(Number(hour))) throw Error('Choose 8, 10 or 11 AM');
  const local = new Date(now + IST);
  let due = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(hour)) - IST;
  if (due <= now) due += 86400000;
  return due;
}
function createScheduler({ launch, notify, now = Date.now, timer = setTimeout, clear = clearTimeout }) {
  const jobs = new Map();
  function cancel(id) {
    const job = jobs.get(id);
    if (job) clear(job.timer);
    jobs.delete(id);
  }
  function arm(id, hour, opts) {
    if (!opts?.journeyId || !opts.credentialId || !opts.paymentId) throw Error('Select ID and Bank first');
    const due = nextStart(hour, now());
    cancel(id);
    const job = { due, opts: { ...opts } };
    jobs.set(id, job);
    job.timer = timer(async () => {
      if (jobs.get(id) !== job) return;
      jobs.delete(id); // Consume before launching, including launch failures.
      if (now() - due > 60000) { notify(id, { state: 'missed', error: 'Auto-start missed. Schedule again.' }); return; }
      notify(id, { state: 'starting', engine: job.opts.uiEngine });
      try {
        const result = await launch({ ...job.opts, runStartedAt: now() });
        notify(id, { state: 'finished', result });
      } catch (error) { notify(id, { state: 'finished', result: { ok: false, error: error.message } }); }
    }, due - now());
    return { ok: true, due };
  }
  return { arm, cancel };
}
module.exports = { nextStart, createScheduler };
