// Compact partner PC access. Incoming consent expands only while it is needed.
import { h, svg, clear } from './dom';
import { ICONS } from './icons';
import { Bridge } from '../core/bridge';
import { Sound } from '../core/sound';
import { State } from '../core/state';
import { startHostScreenSharing, stopHostScreenSharing } from '../remote/hostStream';
import type { ViewActions, ViewHost } from './views';

type Screen = Awaited<ReturnType<typeof Bridge.getAvailableScreens>>[number];

export function buildRemoteControl(_actions: ViewActions): ViewHost {
  const content = h('div', { class: 'remote-content' });
  const el = h('div', { class: 'view remote-control-view' }, h('div', { class: 'card remote-card' }, content));
  let screens: Screen[] = [], selectedScreenId = '', loadingScreens = false, screensLoaded = false;
  let busy = false, error = '', renderedKey = '', lastStatus = State.remoteAccessStatus;

  function partnerName() {
    const isMe = (State.settings.userRole || 'me') === 'me';
    return (isMe ? State.settings.partnerName : State.settings.userName) || 'Partner';
  }

  function changeStatus(status: typeof State.remoteAccessStatus) {
    State.remoteAccessStatus = status;
    render();
    State.notify();
  }

  function action(label: string, callback: () => Promise<void>, danger = false) {
    return h('button', {
      class: `btn ${danger ? 'btn-danger' : 'glass'}`, text: label, disabled: busy,
      onclick: async () => {
        if (busy) return;
        busy = true; error = ''; render();
        try { await callback(); }
        catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
        finally { busy = false; render(); }
      },
    });
  }

  function render() {
    const status = State.remoteAccessStatus;
    if (status !== lastStatus) {
      if (status === 'incoming_request') { screensLoaded = false; screens = []; selectedScreenId = ''; }
      lastStatus = status; error = '';
    }
    const partner = partnerName();
    const key = JSON.stringify([status, partner, State.partnerOnline, State.remoteRequesterName, busy, error, screens, loadingScreens]);
    if (renderedKey === key) return;
    renderedKey = key;
    clear(content);
    const title = h('h2');
    const presence = h('span', { class: `remote-presence${State.partnerOnline ? ' online' : ''}`, text: State.partnerOnline ? 'Online' : 'Offline' });
    const subtitle = h('p');
    const copy = h('div', { class: 'remote-copy' }, h('div', { class: 'remote-heading' }, title, presence), subtitle);
    const buttons = h('div', { class: 'remote-actions' });
    const row = h('div', { class: 'remote-row' }, h('div', { class: 'remote-icon' }, svg(ICONS.monitor, 21)), copy, buttons);
    content.append(row);

    if (status === 'incoming_request') {
      const requester = State.remoteRequesterName || partner;
      title.textContent = `${requester} requests PC access`;
      subtitle.textContent = 'They can see your screen and control your mouse and keyboard. You can disconnect at any time.';
      const consent = h('div', { class: 'remote-consent' });
      if (!screensLoaded && !loadingScreens) {
        loadingScreens = true;
        void Bridge.getAvailableScreens().then(value => {
          screens = value || [];
          selectedScreenId = (screens.find(screen => screen.isPrimary) || screens[0])?.id || '';
          if (!screens.length) error = 'No screen is available. Decline and ask your partner to retry.';
        }).catch(() => { error = 'Could not list screens. Decline and ask your partner to retry.'; })
          .finally(() => { loadingScreens = false; screensLoaded = true; renderedKey = ''; render(); });
      }
      if (loadingScreens) consent.append(h('span', { class: 'remote-presence', text: 'Finding your screens…' }));
      if (screens.length > 1) {
        const select = h('select', { 'aria-label': 'Screen to share', disabled: busy });
        for (const screen of screens) select.append(h('option', { value: screen.id, text: screen.label, selected: screen.id === selectedScreenId }));
        select.addEventListener('change', () => { selectedScreenId = select.value; });
        consent.append(h('label', { class: 'remote-monitor' }, 'Share screen', select));
      }
      const accept = action(busy ? 'Connecting…' : 'Accept & share screen', async () => {
        Sound.play('approve');
        const chosen = screens.find(screen => screen.id === selectedScreenId);
        try {
          if (!chosen || !(await window.electronAPI?.prepareRemoteHost?.())) throw new Error('Request expired or no screen is available. Ask your partner to retry.');
          const result = await startHostScreenSharing(chosen);
          if (!result.success || !result.offer) throw new Error('Could not capture your screen. Please try again.');
          const sent = await Bridge.respondRemoteAccess(true, { offer: result.offer, resolution: result.resolution, displayBounds: chosen.bounds });
          if (!sent) throw new Error('Could not connect to your partner. Check the sync connection.');
          changeStatus('active_host');
        } catch (failure) {
          stopHostScreenSharing();
          await Bridge.endRemoteAccess().catch(() => false);
          changeStatus('idle');
          throw failure;
        }
      });
      accept.disabled = busy || loadingScreens || !screens.length;
      const decline = action('Decline', async () => { await Bridge.respondRemoteAccess(false); changeStatus('idle'); });
      consent.append(h('div', { class: 'remote-actions' }, accept, decline));
      content.append(consent);
    } else if (status === 'requesting') {
      title.textContent = `Waiting for ${partner}`;
      subtitle.textContent = 'Your partner must accept before access starts.';
      buttons.append(action('Cancel request', async () => { await Bridge.endRemoteAccess(); changeStatus('idle'); }));
    } else if (status === 'active_host' || status === 'active_viewer') {
      const hosting = status === 'active_host';
      title.textContent = hosting ? `${partner} is controlling this PC` : `Connected to ${partner}'s PC`;
      subtitle.textContent = hosting ? 'Your screen is live. Disconnect to stop sharing.' : 'Use the viewer window for mouse and keyboard control.';
      buttons.append(action('Disconnect', async () => {
        Sound.play('close'); stopHostScreenSharing();
        await Bridge.endRemoteAccess(); changeStatus('idle');
      }, true));
    } else {
      title.textContent = `Remote PC Access to ${partner}`;
      subtitle.textContent = 'Screen, mouse & keyboard — with their permission.';
      buttons.append(action(busy ? 'Requesting…' : 'Request Access', async () => {
        Sound.play('open');
        if (!(await Bridge.requestRemoteAccess())) throw new Error('Could not send the request. Check your partner sync connection.');
        changeStatus('requesting');
      }));
    }
    title.title = title.textContent || '';
    if (error) content.append(h('div', { class: 'remote-error', role: 'alert', text: error }));
  }
  return { el, sync: render, focus: render };
}
