(function (root) {
  function message(value, fallback = '', depth = 0) {
    if (depth > 5 || value == null) return fallback;
    if (typeof value === 'string') return value.trim() && value !== '[object Object]' ? value.trim() : fallback;
    if (Array.isArray(value)) return value.map(item => message(item, '', depth + 1)).filter(Boolean).join('; ') || fallback;
    if (typeof value === 'object') {
      for (const key of ['errorMessage', 'message', 'error', 'description', 'detail', 'statusMessage', 'availablityStatus', 'availabilityStatus', 'status']) {
        const text = message(value[key], '', depth + 1);
        if (text) return text;
      }
    }
    return fallback;
  }
  function dateKey(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  }
  const api = { message, dateKey };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LexusAvailabilityFormat = api;
})(typeof window === 'object' ? window : globalThis);
