const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

app.name = 'Baymax';
app.setPath('userData', path.join(process.env.APPDATA, 'Baymax'));

app.whenReady().then(async () => {
  try {
    const file = path.join(process.env.APPDATA, 'Baymax', 'CoucouCreator', 'account.dpapi.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const data = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64')));
    const token = data.session.access_token;

    const supabase = createClient(data.project, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljbW15Z3dqc2xqaXhkZnV5YWF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTc2NDQsImV4cCI6MjEwNzQ3MzY0NH0.EEkWdy3VXTEkwgrxIjoCnZp1XrbZtvO4HAVu53FtL2E", {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const channelName = "baymax:pair:1a7a23ba-5a09-437e-8814-5beedc862b73:4638a81f-1c47-48b1-8e9a-517b68ce3026";
    console.log("Setting realtime auth...");
    await supabase.realtime.setAuth(token);

    const channel = supabase.channel(channelName, { config: { private: true } });

    channel.on('broadcast', { event: 'partner' }, ({ payload }) => {
      console.log("[BROADCAST partner RECEIVED]:", JSON.stringify(payload, null, 2));
    });

    channel.subscribe((status, err) => {
      console.log("Subscription status:", status, err || "");
      if (status === 'SUBSCRIBED') {
        console.log("Sending test ping signal via RPC send_pair_signal...");
        supabase.rpc('send_pair_signal', {
          p_pair: "1a7a23ba-5a09-437e-8814-5beedc862b73",
          p_kind: "presence",
          p_value: { online: true, test: true }
        }).then(res => {
          console.log("send_pair_signal result:", res);
        }).catch(e => {
          console.error("send_pair_signal error:", e);
        });
      }
    });

    setTimeout(() => {
      console.log("15s timeout reached, closing test.");
      app.exit(0);
    }, 15000);

  } catch (err) {
    console.error("Fatal:", err);
    app.exit(1);
  }
});
