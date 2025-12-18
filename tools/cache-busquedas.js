// tools/cache-busquedas.js
const NodeCache = require('node-cache');

// Caché de 5 minutos
const searchCache = new NodeCache({ 
  stdTTL: 300, // 5 minutos
  checkperiod: 60 // Limpiar cada minuto
});

function getCacheKey(toolName, params) {
  return `${toolName}:${JSON.stringify(params)}`;
}

function getCachedResult(toolName, params) {
  const key = getCacheKey(toolName, params);
  const cached = searchCache.get(key);
  
  if (cached) {
    console.log(`💾 Cache HIT: ${toolName}`);
    return cached;
  }
  
  console.log(`🔍 Cache MISS: ${toolName}`);
  return null;
}

function setCachedResult(toolName, params, result) {
  const key = getCacheKey(toolName, params);
  searchCache.set(key, result);
}

function clearCache() {
  searchCache.flushAll();
  console.log('🧹 Cache limpiado');
}

module.exports = {
  getCachedResult,
  setCachedResult,
  clearCache
};