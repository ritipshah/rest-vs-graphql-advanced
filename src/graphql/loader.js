// A tiny DataLoader (the idea behind the popular `dataloader` package, in ~30 lines).
//
// THE N+1 PROBLEM: `allFilms { items { characters { name } } }` runs the `characters`
// resolver once per film, and each one asks for its people separately: 1 + N calls.
//
// THE FIX: resolvers call loader.load(id) instead of asking the data layer directly.
// The loader waits until the current burst of resolver calls is finished (setImmediate),
// then sends ALL the ids it collected in ONE call (batching). It also remembers every id it
// has already loaded during this request, so the same person is never fetched twice (caching).
// A new loader is created for every request, so one user's cache is never shown to another.
class Loader {
  constructor(batchFn) {
    this.batchFn = batchFn; // (ids[]) => Promise<values[]> in the same order
    this.cache = new Map();
    this.queue = [];
    this.batches = 0;
  }

  load(id) {
    const key = String(id);
    if (this.cache.has(key)) return this.cache.get(key);
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (this.queue.length === 1) setImmediate(() => this.dispatch());
    });
    this.cache.set(key, promise);
    return promise;
  }

  loadMany(ids) {
    return Promise.all(ids.map((id) => this.load(id)));
  }

  async dispatch() {
    const batch = this.queue;
    this.queue = [];
    this.batches++;
    try {
      const values = await this.batchFn(batch.map((b) => b.key));
      batch.forEach((b, i) => b.resolve(values[i] ?? null));
    } catch (err) {
      batch.forEach((b) => { this.cache.delete(b.key); b.reject(err); });
    }
  }
}

module.exports = { Loader };
