const { randomUUID } = require('node:crypto');

// Only a locally accepted request can become a host session. End/expiry revoke
// the capability, including packets already queued by the transport.
class RemoteSession {
  constructor(now = Date.now) { this.now = now; this.session = null; }
  begin() {
    this.session = { id: randomUUID(), role: 'viewer', accepted: false, expires: this.now() + 60000 };
    return this.session.id;
  }
  receive(packet) {
    if (!packet || !packet.senderId || !/^[\w-]{36}$/.test(packet.sessionId || '')) return false;
    if (!Number.isFinite(Number(packet.timestamp)) || Math.abs(this.now() - Number(packet.timestamp)) > 600000) return false;
    if (packet.action === 'request') {
      if (this.current()) return false;
      this.session = { id: packet.sessionId, peer: packet.senderId, role: 'host', accepted: false, expires: this.now() + 60000 };
      return true;
    }
    const s = this.current();
    if (!s || s.id !== packet.sessionId || (s.peer && s.peer !== packet.senderId)) return false;
    if (packet.action === 'response') {
      if (s.role !== 'viewer' || s.accepted) return false;
      s.peer = packet.senderId;
      s.accepted = packet.accepted === true;
      s.expires = this.now() + 3600000;
      if (!s.accepted) this.end();
      return true;
    }
    if (packet.action === 'end') return true;
    if (!s.accepted || (packet.action === 'input' && s.role !== 'host')) return false;
    return ['signal', 'input', 'end'].includes(packet.action);
  }
  accept(accepted) {
    const s = this.current();
    if (!s || s.role !== 'host' || s.accepted) return null;
    const id = s.id;
    s.accepted = accepted === true;
    s.expires = this.now() + 3600000;
    if (!accepted) this.end();
    return id;
  }
  current() { if (this.session && this.session.expires <= this.now()) this.end(); return this.session; }
  isHost() { const s = this.current(); return !!s?.accepted && s.role === 'host'; }
  allowCapture() { const s = this.current(); if (!s || s.role !== 'host') return false; s.captureAllowed = true; return true; }
  canCapture() { const s = this.current(); return !!s?.captureAllowed && s.role === 'host'; }
  end() { this.session = null; }
}
module.exports = { RemoteSession };
