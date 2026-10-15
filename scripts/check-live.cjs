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

    console.log("Checking profiles table:");
    const pr = await supabase.from('profiles').select('*');
    console.log("Profiles:", JSON.stringify(pr, null, 2));

    app.exit(0);
  } catch (err) {
    console.error("Error:", err);
    app.exit(1);
  }
});
