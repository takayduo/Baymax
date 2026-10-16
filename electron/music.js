const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const trackId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id);
function cleanTrack(value) {
  if (!value || !trackId(value.id)) throw new Error('Invalid YouTube track');
  return { id: value.id, title: String(value.title || 'Untitled').replace(/[\u0000-\u001f]/g,'').slice(0, 180),
    artist: String(value.artist || '').replace(/[\u0000-\u001f]/g,'').slice(0, 100), duration: Math.max(0, Math.min(86400, Number(value.duration) || 0)),
    ...(value.addedBy ? {addedBy:['me','her'].includes(value.addedBy)?value.addedBy:''} : {}) };
}
function cleanLibrary(value) {
  if (!value || !Array.isArray(value.playlists) || value.playlists.length < 1 || value.playlists.length > 50) throw new Error('Keep between 1 and 50 playlists');
  const ids = new Set();
  const playlists = value.playlists.map(list => {
    if (!list || !/^[\w-]{1,80}$/.test(list.id) || ids.has(list.id) || !Array.isArray(list.tracks) || list.tracks.length > 200) throw new Error('Invalid playlist (maximum 200 songs)');
    ids.add(list.id);
    const tracks = list.tracks.map(cleanTrack);
    if (new Set(tracks.map(t => t.id)).size !== tracks.length) throw new Error('This song is already in the playlist');
    return { id: list.id, name: String(list.name || 'My playlist').trim().slice(0, 80) || 'My playlist', tracks };
  });
  const activePlaylistId = ids.has(value.activePlaylistId) ? value.activePlaylistId : playlists[0].id;
  const active = playlists.find(p => p.id === activePlaylistId);
  return { version: 1, repeat: ['off','all','one'].includes(value.repeat) ? value.repeat : 'off', activePlaylistId, currentTrackId: active.tracks.some(t => t.id === value.currentTrackId) ? value.currentTrackId : active.tracks[0]?.id || '', playlists };
}
class MusicStore {
  constructor(folder) { this.file = path.join(folder, 'playlists.json'); }
  load() {
    if (!fs.existsSync(this.file)) return cleanLibrary({playlists:[{id:'favorites',name:'My playlist',tracks:[]}]});
    try { return cleanLibrary(JSON.parse(fs.readFileSync(this.file,'utf8'))); }
    catch { throw new Error('Could not read playlists.json. Your existing file has been preserved.'); }
  }
  save(value) {
    const data = cleanLibrary(value);
    fs.mkdirSync(path.dirname(this.file), { recursive:true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data,null,2),'utf8'); fs.renameSync(temp,this.file);
    return data;
  }
}
class MusicExtractor {
  constructor(command, execute = execFile) { this.command = command; this.execute = execute; this.pending = new Map(); this.children = new Set(); this.queue = []; this.active = 0; this.closed = false; }
  run(args) {
    if (this.closed) return Promise.reject(new Error('Music player is shutting down'));
    return new Promise((resolve, reject) => { this.queue.push({args, resolve, reject}); this.drain(); });
  }
  drain() {
    while (!this.closed && this.active < 3 && this.queue.length) {
      const job = this.queue.shift(); this.active++;
      Promise.resolve().then(()=>this.executeJob(job.args)).then(job.resolve, job.reject).finally(() => {this.active--; this.drain();});
    }
  }
  executeJob(args) {
    const { file, prefix, runtime, pythonPath } = this.command();
    return new Promise((resolve,reject) => {
      const child = this.execute(file, [...prefix,'--ignore-config','--no-playlist','--no-warnings','--no-cache-dir','--socket-timeout','15','--retries','1',
        '--extractor-args','youtube:player_client=android,web',
        ...(runtime ? ['--js-runtimes',`node:${runtime}`] : []), ...args],
      {windowsHide:true,timeout:45000,maxBuffer:2*1024*1024,encoding:'utf8',env:{...process.env,...(pythonPath?{PYTHONPATH:pythonPath}:{}),ELECTRON_RUN_AS_NODE:'1',PYTHONIOENCODING:'utf-8'}},
      (error,stdout) => { this.children.delete(child); error ? reject(new Error('Could not load this music source. Check your internet connection, or try another song.')) : resolve(stdout); });
      this.children.add(child);
    });
  }
  async search(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Enter a song or artist (up to 200 characters)');
    const raw = await this.run(['--flat-playlist','--dump-single-json','--skip-download','--',`ytsearch8:${query.trim()}`]);
    const data = JSON.parse(raw);
    return (data.entries || []).filter(t => trackId(t.id) && t.live_status !== 'is_live').slice(0,8)
      .map(t => cleanTrack({id:t.id,title:t.title,artist:t.uploader || t.channel,duration:t.duration}));
  }
  async resolve(id, refresh = false) {
    if (!trackId(id)) throw new Error('Invalid music track');
    if (!refresh && this.pending.has(id)) return this.pending.get(id);
    const pending = this.run(['-f','bestaudio[ext=m4a][protocol=https]/bestaudio[acodec^=mp4a][protocol=https]/bestaudio[protocol=https]/bestaudio/best[height<=360][protocol=https]/best[protocol=https]','-g','--',`https://www.youtube.com/watch?v=${id}`]).then(raw => {
      const url = raw.trim().split(/\r?\n/)[0];
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(parsed.hostname)) throw new Error('This song did not provide a supported audio stream');
      return url;
    }).finally(() => {if(this.pending.get(id) === pending)this.pending.delete(id);});
    this.pending.set(id,pending); return pending;
  }
  close() { this.closed = true; for(const job of this.queue.splice(0))job.reject(new Error('Music player is shutting down')); for (const child of this.children) child.kill(); this.children.clear(); }
}
// Only setup and small discovery messages may use the partner's cloud channel.
function cleanMusicSignal(value) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 50000) throw new Error('Invalid music signal');
  if (value.type === 'status') return { type:'status', playing:!!value.playing, title:String(value.title || '').slice(0,180) };
  if (value.type === 'probe') return { type:'probe' };
  if (value.type === 'playlist') {
    if(!Array.isArray(value.entries)||value.entries.length>40)throw new Error('Invalid playlist signal');
    return {type:'playlist',entries:value.entries.map(require('./sharedMusic').cleanEntry)};
  }
  if (!/^[\w-]{1,80}$/.test(value.sessionId || '')) throw new Error('Invalid listening session');
  if (['join','decline','leave'].includes(value.type)) return {type:value.type, sessionId:value.sessionId};
  if (['offer','answer'].includes(value.type) && typeof value.sdp === 'string' && value.sdp.length < 48000)
    return {type:value.type,sessionId:value.sessionId,sdp:value.sdp};
  throw new Error('Unsupported music signal');
}
module.exports = { MusicStore, MusicExtractor, cleanLibrary, cleanTrack, cleanMusicSignal };
