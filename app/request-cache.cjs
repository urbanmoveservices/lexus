function createRequestCache(ttlMs, maxEntries = 100) {
  const pending = new Map(), cache = new Map();
  return function request(key, fetcher) {
    const saved = cache.get(key);
    if (saved && saved.until > Date.now()) return Promise.resolve(saved.value);
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(fetcher).then(value => {
      if (ttlMs > 0) {
        cache.delete(key);
        cache.set(key, { value, until: Date.now() + ttlMs });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
module.exports = { createRequestCache };
