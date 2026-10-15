// A loopback-only preview server: exposes the sound pack and its documentation,
// never the rest of the workspace. Close with Ctrl+C when finished listening.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = new Map([
  ['/docs/sounds-preview.html', ['docs/sounds-preview.html', 'text/html; charset=utf-8']],
  ['/docs/SOUND_ASSETS.md', ['docs/SOUND_ASSETS.md', 'text/plain; charset=utf-8']],
]);
for (const { name } of require('./sounds/recipes.cjs')) routes.set('/public/sounds/' + name + '.wav', ['public/sounds/' + name + '.wav', 'audio/wav']);
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { res.writeHead(302, { Location: '/docs/sounds-preview.html' }); return res.end(); }
  const route = routes.get(pathname);
  if (!route) { res.writeHead(404); return res.end('Not found'); }
  try {
    const bytes = fs.readFileSync(path.join(root, route[0]));
    res.writeHead(200, { 'content-type': route[1], 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Run node scripts/generate-sounds.cjs first.'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => console.log('Sound preview: http://127.0.0.1:' + server.address().port + '/docs/sounds-preview.html'));
