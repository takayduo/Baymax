// Readiness only: never inject keys into the user's foreground application.
const fs = require('node:fs'), path = require('node:path');
const { PushToTalkService } = require('../electron/pushToTalk');
const service = new PushToTalkService(state => {
  if (state.ready) finish();
});
let finished = false;
const timer = setTimeout(() => finish(new Error(service.snapshot().error || 'Native shortcut helper did not become ready')), 75000);
function finish(error) {
  if (finished) return; finished = true;
  clearTimeout(timer); service.stop();
  const result = { ready: !error, globalWindowsPolling: !error, injectedKeys: false, error: error?.message || null };
  fs.writeFileSync(path.join(__dirname, '../audit/talk-key-native.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); process.exitCode = error ? 1 : 0;
}
service.configure({ pushToTalkEnabled: true, pushToTalkKey: 'Control+Shift+F8' });
