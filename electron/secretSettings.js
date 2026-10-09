const MARKER = '__BAYMAX_SAVED_SECRET__';
const secretKey = key => /(?:api[_-]?key|password|token|secret|private[_-]?key)$/i.test(key) || key === 'googleOAuth';
function protect(value, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Settings were not saved.');
  return { encrypted: safeStorage.encryptString(JSON.stringify(value)).toString('base64') };
}
function reveal(value, safeStorage) {
  return value?.encrypted ? JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted,'base64'))) : value;
}
function encodeSettings(settings, safeStorage) { return Object.fromEntries(Object.entries(settings).map(([key,value]) => [key, secretKey(key) && value ? protect(value,safeStorage) : value])); }
function decodeSettings(settings, safeStorage) { return Object.fromEntries(Object.entries(settings).map(([key,value]) => [key, secretKey(key) ? reveal(value,safeStorage) : value])); }
function publicSettings(settings) { return Object.fromEntries(Object.entries(settings).map(([key,value])=>[key,secretKey(key) && value ? MARKER : value])); }
function mergeSettings(current,incoming) {
  const clean = Object.fromEntries(Object.entries(incoming || {}).filter(([key,value])=>key!=='__proto__' && key!=='constructor' && value!==MARKER));
  return {...current,...clean};
}
module.exports={MARKER,secretKey,protect,reveal,encodeSettings,decodeSettings,publicSettings,mergeSettings};
