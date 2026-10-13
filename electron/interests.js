const fs = require('node:fs');
const path = require('node:path');

// This application's persistent memory store is memory/long_term.json.
function syncInterestsMemory(engineDataDir, interests) {
  const file = path.join(engineDataDir, 'memory', 'long_term.json');
  let memory = {};
  if (fs.existsSync(file)) memory = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) throw new Error('Invalid assistant memory');
  const value = String(interests || '').trim().slice(0, 2000);
  if (memory.preferences?.user_interests?.value === value) return;
  if (!memory.preferences || typeof memory.preferences !== 'object' || Array.isArray(memory.preferences)) memory.preferences = {};
  memory.preferences.user_interests = {value, updated: new Date().toISOString().slice(0, 10)};
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.interests.tmp';
  fs.writeFileSync(temporary, JSON.stringify(memory, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}
module.exports = {syncInterestsMemory};
