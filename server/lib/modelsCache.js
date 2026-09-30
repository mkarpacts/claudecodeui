const MODELS_CACHE_TTL_MS = 15 * 60 * 1000;

let entry = null;

export const modelsCache = {
  get() {
    return entry ? entry.models : null;
  },
  set(models) {
    if (!Array.isArray(models) || models.length === 0) return;
    entry = { models, fetchedAt: Date.now() };
  },
  needsRefresh() {
    return !entry || Date.now() - entry.fetchedAt > MODELS_CACHE_TTL_MS;
  },
};
