const fs = require('fs');
let s = fs.readFileSync('src/settings/panel.ts', 'utf8');
s = s.replace(/\["account",\s*"Account & Plan",\s*"Sign-in, membership & your partner",\s*accountSection\]/, '["apps", "Applications", "Custom paths for launching apps", appLauncherSection]');
s = s.replace(/if\s*\(needsOnboarding\(\)\)\s*id\s*=\s*['"]account['"];\r?\n?/, '');
s = s.replace(/select\(needsOnboarding\(\)\s*\?\s*["']account["']\s*:\s*["']companion["']\);/, 'select("companion");');
fs.writeFileSync('src/settings/panel.ts', s);
console.log('Restored Applications tab in panel.ts!');
