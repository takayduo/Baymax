import { Bridge, type TalkKeyState } from '../core/bridge';
import type { Settings } from '../core/state';
import { h } from '../views/dom';
import keys from '../../public/voice-keys.json';

export function shortcutLabel(value = 'Control+Space') {
  return value.split('+').map(p => p === 'Control' ? 'Ctrl' : keys.find(k => k.code === p)?.label || p).join(' + ');
}
function validShortcut(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('+'), code = parts.pop();
  return keys.some(key => key.code === code) && new Set(parts).size === parts.length && parts.every(p => ['Control','Alt','Shift'].includes(p)) && !(parts.includes('Alt') && code === 'F4');
}

export function pushToTalkSetting(settings: Settings, save: () => Promise<boolean>, redraw: () => void) {
  const enabled = !!settings.pushToTalkEnabled;
  const toggle = h('button', { class: enabled ? 'switch on' : 'switch', 'aria-label': 'Push-to-talk', 'aria-pressed': String(enabled) }) as HTMLButtonElement;
  const change = h('button', { class: 'ptt-change-key', text: validShortcut(settings.pushToTalkKey) ? shortcutLabel(settings.pushToTalkKey) : 'Choose key', 'aria-label': 'Choose push-to-talk key' });
  const hint = h('span', { class: 'hint ptt-hint', role: 'status', text: 'Hold to speak, release to send. Works with either voice provider.' });
  const row = h('div', { class: 'row ptt-setting' }, h('label', { text: 'Push-to-talk' }), toggle, change, hint);
  const status = (state: TalkKeyState) => {
    if (settings.pushToTalkEnabled) hint.textContent = state.error || (settings.micEnabled === false ? 'Microphone is off. Turn it on in AI & voice to talk.' : state.held ? 'Listening… release to send.' : state.ready ? `Hold ${shortcutLabel(settings.pushToTalkKey)} to speak. Release to send.` : 'Starting the talk shortcut…');
  };
  const off = Bridge.on('push-to-talk-state', status);
  // Settings pages are cached while open; stop the listener after they are discarded.
  const mount = document.querySelector('.preferences-body');
  const observer = new MutationObserver(() => { if (!mount?.isConnected) { off(); observer.disconnect(); } });
  requestAnimationFrame(() => { if (row.isConnected) observer.observe(document.body, { childList: true, subtree: true }); else off(); });
  void Bridge.getPushToTalkState().then(status).catch(() => {});

  async function choose() {
    if (document.querySelector('.ptt-key-dialog')) return;
    try { await Bridge.suspendPushToTalk(true); } catch { hint.textContent = 'Could not pause the microphone. Please try again.'; return; }
    if (!row.isConnected) { await Bridge.suspendPushToTalk(false).catch(() => {}); return; }
    let chosen = '', saving = false, finished = false;
    const dialog = h('dialog', { class: 'ptt-key-dialog settings-surface', 'aria-labelledby': 'ptt-key-title' }) as HTMLDialogElement;
    const record = h('button', { class: 'ptt-key-record', text: 'Press a key or shortcut…', type: 'button' });
    const error = h('p', { class: 'hint', role: 'status', text: 'Try F8 or Ctrl + Space. Avoid shortcuts you use in other apps.' });
    const apply = h('button', { class: 'primary ptt-key-save', text: 'Save & enable', type: 'button' }) as HTMLButtonElement; apply.disabled = true;
    const cancel = h('button', { text: 'Cancel', type: 'button', class: 'ptt-key-cancel' }) as HTMLButtonElement;
    const cleanup = new MutationObserver(() => {
      if (!row.isConnected || !dialog.isConnected || !dialog.open) void finish(false);
    });
    const onPageHide = () => void finish(false);
    const finish = async (redrawView = true) => {
      if (finished) return;
      finished = true; cleanup.disconnect(); window.removeEventListener('pagehide', onPageHide);
      if (dialog.open) dialog.close(); dialog.remove();
      try { await Bridge.suspendPushToTalk(false); } catch { /* The native gate remains closed if IPC fails. */ }
      if (redrawView && row.isConnected) redraw();
    };
    record.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Tab') return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || e.isComposing) return;
      const key = keys.find(k => k.code === e.code);
      if (!key || e.metaKey || (e.altKey && e.code === 'F4')) { error.textContent = 'Use a letter, F1–F12, Space, Insert, Pause or Caps Lock, with optional Ctrl, Alt or Shift.'; return; }
      chosen = [e.ctrlKey ? 'Control' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key.code].filter(Boolean).join('+');
      record.textContent = shortcutLabel(chosen); apply.disabled = false;
      error.textContent = 'This shortcut also reaches the app you are using. Choose one that will not interrupt your work.';
    });
    cancel.onclick = () => { if (!saving) void finish(); };
    dialog.addEventListener('keydown', e => e.stopPropagation());
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!saving) void finish(); });
    dialog.addEventListener('close', () => void finish());
    apply.onclick = async () => {
      if (!chosen || saving) return;
      saving = true; apply.disabled = true; cancel.disabled = true;
      const previous = { enabled: settings.pushToTalkEnabled, key: settings.pushToTalkKey };
      settings.pushToTalkKey = chosen; settings.pushToTalkEnabled = true;
      let saved = false;
      try { saved = await save(); } catch {}
      if (saved) { await finish(); return; }
      settings.pushToTalkKey = previous.key; settings.pushToTalkEnabled = previous.enabled;
      if (finished) { if (row.isConnected) redraw(); return; }
      saving = false; apply.disabled = false; cancel.disabled = false;
      error.textContent = 'Could not save this shortcut. Try again, or cancel to keep your previous setting.';
    };
    dialog.append(h('h2', { id: 'ptt-key-title', text: 'Choose your talk key' }),
      h('p', { class: 'hint', text: 'Your microphone is paused while you choose. Press your shortcut below, then save it. Groq messages can be up to 30 seconds per hold.' }),
      record, error, h('div', { class: 'ptt-key-actions' }, cancel, apply));
    try {
      document.body.append(dialog); dialog.showModal(); record.focus();
      cleanup.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
      window.addEventListener('pagehide', onPageHide, { once: true });
    } catch { await finish(false); }
  }
  change.onclick = () => void choose();
  toggle.onclick = async () => {
    if (!settings.pushToTalkEnabled && !validShortcut(settings.pushToTalkKey)) { await choose(); return; }
    const previous = !!settings.pushToTalkEnabled;
    toggle.disabled = true; settings.pushToTalkEnabled = !previous;
    try { if (!await save()) settings.pushToTalkEnabled = previous; } catch { settings.pushToTalkEnabled = previous; }
    redraw();
  };
  return row;
}
