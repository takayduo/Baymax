const { normalizeCompanion } = require('./companion');
function cleanVoiceSignal(value) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 60000 || !/^[\w-]{1,80}$/.test(value.sessionId || '')) throw new Error('Invalid call signal');
  if (!['ring','accept','offer','answer','decline','hangup'].includes(value.type)) throw new Error('Unsupported call signal');
  const result = {type:value.type,sessionId:value.sessionId};
  if (['offer','answer'].includes(value.type)) {
    if (typeof value.sdp !== 'string' || !value.sdp.startsWith('v=0') || value.sdp.length > 48000) throw new Error('Invalid call description');
    result.sdp = value.sdp;
  }
  if (['ring','accept'].includes(value.type)) {
    const companion = normalizeCompanion(value.appearance?.companion), style = companion.styles[companion.avatarId];
    companion.styles = style ? {[companion.avatarId]:style} : {};
    result.appearance = {companion,headphones:value.appearance?.headphones === true};
  }
  return result;
}
module.exports = {cleanVoiceSignal};
