const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Simple JSON file store for persisting app data.
 * Stores data in the Electron userData directory.
 */
class Store {
  constructor(defaults = {}) {
    const userData = app.getPath('userData');
    this.path = path.join(userData, 'distrack-data.json');
    this.data = { ...defaults };
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.path)) {
        const raw = fs.readFileSync(this.path, 'utf8');
        this.data = { ...this.data, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('[Store] Failed to load:', e.message);
      throw new Error('Productivity data could not be read. The original file has been preserved.', {cause:e});
    }
  }

  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmpPath = `${this.path}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmpPath, this.path);
        this.lastError = null;
      } catch (e) {
        console.error('[Store] Failed to save:', e.message);
        this.lastError = 'Usage could not be saved to disk';
      }
    }, 500);
  }

  saveSync() {
    try {
      const dir = path.dirname(this.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.path}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.path);
      this.lastError = null;
    } catch (e) {
      console.error('[Store] Failed to save:', e.message);
      this.lastError = 'Usage could not be saved to disk';
      throw e;
    }
  }

  get(key, defaultValue) {
    const keys = key.split('.');
    let value = this.data;
    for (const k of keys) {
      if (value === undefined || value === null || typeof value !== 'object') {
        return defaultValue;
      }
      value = value[k];
    }
    return value !== undefined ? value : defaultValue;
  }

  set(key, value) {
    const keys = key.split('.');
    if (keys.some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error('Invalid store key');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.save();
  }

  delete(key) {
    const keys = key.split('.');
    if (keys.some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error('Invalid store key');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) return;
      obj = obj[keys[i]];
    }
    delete obj[keys[keys.length - 1]];
    this.save();
  }

  clear() {
    this.data = {};
    this.saveSync();
  }
}

const STORE_DEFAULTS = {
  usageData: {},
  appCategories: {},
  settings: { theme: 'dark', notifications: true, launchOnStartup: false },
  focusSessions: [],
  blocklist: [],
  onboarded: true,
  userProfile: { name: 'Badsha', email: 'user@baymax.local', picture: '', emailVerified: true },
};

module.exports = {
  Store,
  STORE_DEFAULTS,
};
