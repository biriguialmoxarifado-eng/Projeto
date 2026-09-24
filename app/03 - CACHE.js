/**
 * ============================================================
 * 03 - CACHE
 * ============================================================
 * Única camada de cache do sistema. Nenhum módulo deve chamar
 * CacheService diretamente — sempre via AP_Cache_get/set/invalidate.
 * Valores são serializados em JSON internamente.
 */

function AP_Cache_get(key) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null; // cache é best-effort; falha de cache nunca deve quebrar o sistema
  }
}

function AP_Cache_set(key, value, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var ttl = ttlSeconds || Number(AP_DEFAULT_CONFIG.CACHE_TTL_SECONDS) || 300;
    cache.put(key, JSON.stringify(value), ttl);
    return true;
  } catch (e) {
    return false;
  }
}

function AP_Cache_invalidate(key) {
  try {
    CacheService.getScriptCache().remove(key);
    return true;
  } catch (e) {
    return false;
  }
}

function AP_Cache_invalidateAll(keys) {
  try {
    CacheService.getScriptCache().removeAll(keys || []);
    return true;
  } catch (e) {
    return false;
  }
}
