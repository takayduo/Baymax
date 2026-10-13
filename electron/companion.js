const catalog = require('../public/companions/catalog.json');
const colour = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
function normalizeCompanion(value) {
  const input = value && typeof value === 'object' ? value : {};
  const styles = {};
  for (const avatar of catalog) {
    const raw = input.styles?.[avatar.id];
    if (!raw || typeof raw !== 'object') continue;
    styles[avatar.id] = { color: colour(raw.color, avatar.color), accent: colour(raw.accent, avatar.accent),
      accessory: ['none', 'scarf', 'bow', 'sparkle'].includes(raw.accessory) ? raw.accessory : 'none',
      markings: ['plain', 'cheeks', 'freckles'].includes(raw.markings) ? raw.markings : avatar.minimal ? 'plain' : 'cheeks' };
  }
  return { avatarId: catalog.some(a => a.id === input.avatarId) ? input.avatarId : catalog[0].id, styles };
}
module.exports = { normalizeCompanion };
