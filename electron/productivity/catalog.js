const path = require('node:path');
const { createHash } = require('node:crypto');
const normalize = s => String(s || '').trim().toLowerCase().replace(/\.exe$/, '');
const utilityNames = new Set(['scale', 'scalehost', 'wmplayer', 'windowsterminal', 'charmap', 'cleanmgr', 'mdsched', 'iscsicpl', 'odbcad32', 'regedit', 'recoverydrive', 'perfmon', 'msinfo32', 'msconfig', 'dfrgui', 'psr', 'quickassist', 'wfs', 'javacpl', 'setlang', 'msoev', 'amdbugreporttool', 'amdinstallmanager', 'control', 'livecaptions', 'magnify', 'narrator', 'osk', 'voiceaccess']);
function isJunk(a) {
  return /(?:^|[\s_-])(uninstall|uninstaller|repair|reset preferences|remove|crash reporter)(?:$|[\s_-])/i.test(a.name || '') ||
    /^(msiexec|unins\d*|uninst|uninstall|setup|install|crashpad_handler|scalehost|scale)$/i.test(a.processName || a.id || '');
}
function canonicalId(a) {
  // A resolved Squirrel --processStart shortcut and the direct executable are
  // one app. Keep the original shortcut arguments for launching, not identity.
  const wrapper = /--processStart\s+"?([^"\s]+\.exe)"?/i.exec(a.arguments || '');
  const args = wrapper && a.path && path.win32.basename(a.path).toLowerCase() === wrapper[1].toLowerCase() ? '' : a.arguments;
  const identity = a.appId ? `package:${a.appId.toLowerCase()}` : a.path ? `exe:${path.win32.normalize(a.path).toLowerCase()}${args ? '|'+args.toLowerCase() : ''}` : `process:${normalize(a.processName || a.id)}`;
  return 'app-' + createHash('sha256').update(identity).digest('hex').slice(0, 24);
}
function catalogEntry(a, previous = {}) {
  const processName = normalize(a.processName || (a.path && path.win32.basename(a.path)) || a.id);
  return { ...previous, ...a, id: canonicalId(a), processName,
    aliases: [...new Set([...(previous.aliases || []), ...(a.aliases || []), processName, processName.replace(/\.root$/, '')].filter(Boolean))],
    name: a.name || previous.name || a.processName, type: 'application',
    source: a.source || previous.source || 'observed',
    utility: utilityNames.has(processName),
    hidden: previous.hidden ?? a.hidden ?? (isJunk(a) || utilityNames.has(processName)),
  };
}
function matchCatalog(known, processName, exePath, appId) {
  const entries = Object.values(known);
  if (appId) { const a = entries.find(a => a.appId?.toLowerCase() === appId.toLowerCase()); if (a) return a; }
  if (exePath) {
    const matches = entries.filter(a => a.path?.toLowerCase() === exePath.toLowerCase());
    if (matches.length === 1) return matches[0];
    // A different executable path must never inherit the identity of a same-name app.
    const legacy = entries.filter(a => !a.path && !a.appId && (a.aliases || [a.id]).includes(normalize(processName)));
    if (legacy.length === 1) return legacy[0];
    return null;
  }
  const aliases = entries.filter(a => (a.aliases || [a.id]).includes(normalize(processName)));
  return aliases.length === 1 ? aliases[0] : null;
}
module.exports = { normalize, canonicalId, catalogEntry, matchCatalog, isJunk };
