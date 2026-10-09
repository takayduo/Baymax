const { createClient } = require("@supabase/supabase-js");

let supabaseClient = null;
let realtimeChannel = null;
let currentConfig = null;
let dbChangesChannel = null;
let hasSentInitialPartnerJoin = false;
let connectionGeneration = 0;

const SUPABASE_SQL_SETUP = `-- ========================================================
-- 🍡 MOCHI 24/7 OFFLINE CLOUD STORAGE SETUP
-- Run this once in your Supabase SQL Editor (supabase.com)
-- ========================================================

-- 1. Create table for persistent messages (delivered even when PC was off)
create table if not exists public.mochi_messages (
  id text primary key,
  channel text not null default 'coucou-badsha-ayzil',
  sender text not null,
  recipient text not null,
  text text not null,
  timestamp bigint not null,
  is_ai_generated boolean default false,
  read boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create table for shared couple tasks & schedule
create table if not exists public.mochi_tasks (
  id text primary key,
  channel text not null default 'coucou-badsha-ayzil',
  title text not null,
  time text default '',
  assignee text default '',
  assigned_by text default '',
  completed boolean default false,
  created_at bigint default (extract(epoch from now()) * 1000),
  updated_at bigint default (extract(epoch from now()) * 1000)
);

-- 3. Enable Row Level Security (RLS)
alter table public.mochi_messages enable row level security;
alter table public.mochi_tasks enable row level security;

-- 5. Enable Supabase Realtime broadcast for database changes (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mochi_messages'
  ) then
    alter publication supabase_realtime add table public.mochi_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mochi_tasks'
  ) then
    alter publication supabase_realtime add table public.mochi_tasks;
  end if;
end $$;
` + require('node:fs').readFileSync(require('node:path').join(__dirname, 'supabase-policy.sql'), 'utf8');

/**
 * Tests connecting to a Supabase project URL and Anon key.
 */
async function testSupabaseConnection({ url, key }) {
  if (!url || !key) {
    return { success: false, error: "Please provide both Supabase URL and Anon Key." };
  }

  const cleanUrl = url.trim().replace(/\/+$/, "");
  const cleanKey = key.trim();
  if (!cleanUrl.startsWith("https://")) {
    return { success: false, error: "Supabase URL must start with https://" };
  }

  try {
    const res = await fetch(`${cleanUrl}/auth/v1/settings`, {
      headers: {
        apikey: cleanKey,
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: "Invalid Anon Key (Unauthorized)." };
    }

    if (res.ok || res.status === 200) {
      return { success: true };
    }

    return { success: false, error: `Supabase returned HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Checks whether the cloud persistent tables (mochi_messages & mochi_tasks) exist in Supabase.
 */
async function checkCloudStorageReady(creds) {
  if (!currentConfig?.userId) return { ready:false, error:"Sign in with an authorized pair account first." };
  let client = supabaseClient;
  const url = (creds?.url || currentConfig?.url || "").trim().replace(/\/+$/, "");
  const key = (creds?.key || currentConfig?.key || "").trim();
  if (!client && url && key) {
    return { ready: false, error: "Sign in with an authorized pair account first." };
  }
  if (false) {
    try {
      client = createClient(url, key, { auth: { persistSession: false } });
    } catch (e) {
      console.warn("[Supabase] Failed to instantiate client:", e);
    }
  }
  if (!client) {
    return { ready: false, error: "Supabase not connected yet. Click 'Save & Connect' first." };
  }

  try {
    const { error: msgErr } = await client.from("mochi_messages").select("id").limit(1);
    if (msgErr) {
      console.warn("[Supabase Cloud DB Check] mochi_messages error:", msgErr);
      return { ready: false, error: `mochi_messages: ${msgErr.message}`, code: msgErr.code };
    }

    const { error: taskErr } = await client.from("mochi_tasks").select("id").limit(1);
    if (taskErr) {
      console.warn("[Supabase Cloud DB Check] mochi_tasks error:", taskErr);
      return { ready: false, error: `mochi_tasks: ${taskErr.message}`, code: taskErr.code };
    }

    console.log("[Supabase Cloud DB Check] Cloud tables mochi_messages and mochi_tasks verified active!");
    return { ready: true };
  } catch (err) {
    console.warn("[Supabase Cloud DB Check] Exception:", err);
    return { ready: false, error: err.message };
  }
}

/**
 * Initializes Supabase client, presence tracking, real-time broadcast listeners, and DB catch-up.
 */
async function initSupabase({
  email, password, onStatus,
  url,
  key,
  channelName = "coucou-badsha-ayzil",
  userName = "Badsha",
  userRole = "me",
  onChatMessage,
  onFileShared,
  onScheduleUpdated,
  onPresenceSync,
  onRemoteAccess,
  onSyncRequest,
  onSyncResponse,
  onPartnerJoin,
}) {
  disconnectSupabase();
  const generation = connectionGeneration;
  if (!url || !key) return null;
  let client = null;

  const cleanUrl = url.trim().replace(/\/+$/, "");
  const cleanKey = key.trim();

  try {
    if (!email || !password) throw new Error('Enter your Supabase account email/password and provision pair membership before connecting.');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(channelName)) throw new Error('Channel must contain only letters, digits, underscores and hyphens.');
    client = createClient(cleanUrl, cleanKey, {
      auth: { persistSession: false },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
    if (generation !== connectionGeneration) {void client.removeAllChannels();return null;}
    if (authError || !auth.user) throw new Error(authError?.message || 'Authentication failed');
    const { data: pair, error: pairError } = await client.from('baymax_pairs').select('user_a,user_b').eq('channel', channelName).single();
    if (generation !== connectionGeneration) {void client.removeAllChannels();return null;}
    if (pairError || !pair || ![pair.user_a, pair.user_b].includes(auth.user.id)) throw new Error('No authorized pair membership. Apply the secure setup SQL and add both Auth user IDs.');
    supabaseClient = client;
    currentConfig = { url: cleanUrl, key: cleanKey, channelName, userName, userRole, userId: auth.user.id, peerId: pair.user_a === auth.user.id ? pair.user_b : pair.user_a };
    await client.realtime.setAuth(auth.session.access_token);
    if (generation !== connectionGeneration) {void client.removeAllChannels();return null;}
    client.auth.onAuthStateChange((event, session) => {
      if(generation !== connectionGeneration)return;
      if (session?.access_token) void client?.realtime.setAuth(session.access_token);
      else if (event === 'SIGNED_OUT') disconnectSupabase();
    });

    const channel = client.channel(channelName, {
      config: {
        private: true,
        broadcast: { ack: true, self: false },
        presence: { key: userName },
      },
    });

    realtimeChannel = channel;

    // 1. Broadcast: File Sharing
    channel.on("broadcast", { event: "file_shared" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received file_shared event:", payload?.fileName);
      if (typeof onFileShared === "function" && payload) {
        try {
          onFileShared(payload);
        } catch (e) {
          console.warn("[Supabase Realtime] onFileShared error:", e);
        }
      }
    });

    // 2. Broadcast: Schedule & Task Updates
    channel.on("broadcast", { event: "schedule_update" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received schedule_update event from:", payload?.senderName);
      if (typeof onScheduleUpdated === "function" && payload) {
        try {
          onScheduleUpdated(payload);
        } catch (e) {
          console.warn("[Supabase Realtime] onScheduleUpdated error:", e);
        }
      }
    });

    // 3. Presence: Partner Online Status
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      console.log("[Supabase Realtime] Presence sync:", Object.keys(state));
      if (typeof onPresenceSync === "function") {
        try {
          onPresenceSync(state);
        } catch (e) {
          console.warn("[Supabase Realtime] onPresenceSync error:", e);
        }
      }
    });

    // 4. Broadcast: Live Partner Chat
    channel.on("broadcast", { event: "partner_chat" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received partner_chat event from:", payload?.sender);
      if (typeof onChatMessage === "function" && payload) {
        try {
          onChatMessage(payload);
        } catch (e) {
          console.error("[Supabase Realtime] onChatMessage error:", e);
        }
      }
    });

    // 5. Broadcast: Remote Desktop Access (Mochi Eye)
    channel.on("broadcast", { event: "remote_access" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received remote_access event:", payload?.action, "from:", payload?.sender);
      if (typeof onRemoteAccess === "function" && payload && payload.senderId === currentConfig?.peerId && payload.recipientId === currentConfig?.userId) {
        try {
          onRemoteAccess(payload);
        } catch (e) {
          console.error("[Supabase Realtime] onRemoteAccess error:", e);
        }
      }
    });

    // 6. Broadcast: Peer Catch-Up Sync Request
    channel.on("broadcast", { event: "sync_request" }, ({ payload }) => {
      console.log("[Supabase Realtime] Partner requested peer catch-up sync from:", payload?.senderName);
      if (typeof onSyncRequest === "function" && payload) {
        try {
          onSyncRequest(payload);
        } catch (e) {
          console.warn("[Supabase Realtime] onSyncRequest error:", e);
        }
      }
    });

    // 7. Broadcast: Peer Catch-Up Sync Response
    channel.on("broadcast", { event: "sync_response" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received peer catch-up sync response from:", payload?.senderName);
      if (typeof onSyncResponse === "function" && payload) {
        try {
          onSyncResponse(payload);
        } catch (e) {
          console.warn("[Supabase Realtime] onSyncResponse error:", e);
        }
      }
    });

    // 8. Broadcast: Partner Online Join Announcement
    channel.on("broadcast", { event: "partner_join" }, ({ payload }) => {
      console.log("[Supabase Realtime] Received partner_join event from:", payload?.senderName);
      if (typeof onPartnerJoin === "function" && payload) {
        try {
          onPartnerJoin(payload);
        } catch (e) {
          console.warn("[Supabase Realtime] onPartnerJoin error:", e);
        }
      }
    });

    // Subscribe and track self
    channel.subscribe(async (status) => {
      if(generation !== connectionGeneration)return;
      console.log(`[Supabase Realtime] Subscription status for ${channelName}:`, status);
      onStatus?.({ connected: status === "SUBSCRIBED", status });
      if (status === "SUBSCRIBED") {
        try {
          await channel.track({
            user: userName,
            role: userRole,
            online: true,
            updatedAt: Date.now(),
          });
        } catch (e) {
          console.warn("[Supabase Realtime] Presence track warning:", e);
        }

        if(generation !== connectionGeneration)return;
        // Announce presence once on startup to partner
        if (!hasSentInitialPartnerJoin) {
          hasSentInitialPartnerJoin = true;
          try {
            await channel.send({
              type: "broadcast",
              event: "partner_join",
              payload: {
                senderName: userName,
                senderRole: userRole,
                timestamp: Date.now(),
              },
            });
          } catch (sendErr) {
            console.warn("[Supabase Realtime] partner_join broadcast error:", sendErr);
          }
        }
      }
    });

    // Also listen to database change streams if tables are created
    try {
      dbChangesChannel = client
        .channel("db_changes_" + channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "mochi_messages",
            filter: `channel=eq.${channelName}`,
          },
          (payload) => {
            const newRow = payload?.new;
            if (newRow && typeof onChatMessage === "function") {
              // Ignore messages we sent ourselves
              const isSelf = ((newRow.sender || "").toLowerCase() === (userName || "").toLowerCase()) ||
                             (newRow.sender_role && newRow.sender_role === userRole) ||
                             (newRow.senderRole && newRow.senderRole === userRole);
              if (!isSelf) {
                onChatMessage({
                  id: newRow.id,
                  sender: newRow.sender,
                  recipient: newRow.recipient,
                  senderRole: newRow.sender_role || newRow.senderRole,
                  text: newRow.text,
                  timestamp: Number(newRow.timestamp),
                  isAiGenerated: !!newRow.is_ai_generated,
                  read: !!newRow.read,
                });
              }
            }
          }
        )
        .subscribe();
    } catch (dbErr) {
      console.warn("[Supabase Realtime] DB changes subscription notice:", dbErr.message);
    }

    return channel;
  } catch (err) {
    if(generation === connectionGeneration) {onStatus?.({ connected: false, error: err.message });disconnectSupabase();}
    else if(client)void client.removeAllChannels();
    console.error("[Supabase Realtime] Init error:", err.message);
    return null;
  }
}

/**
 * Disconnects existing channels and client.
 */
function disconnectSupabase() {
  connectionGeneration++;
  if (realtimeChannel && supabaseClient) {
    try {
      realtimeChannel.untrack();
      supabaseClient.removeChannel(realtimeChannel);
    } catch (e) {
      console.warn("Channel cleanup error:", e);
    }
  }
  if (dbChangesChannel && supabaseClient) {
    try {
      supabaseClient.removeChannel(dbChangesChannel);
    } catch (e) {}
  }
  realtimeChannel = null;
  dbChangesChannel = null;
  supabaseClient = null;
  currentConfig = null;
  hasSentInitialPartnerJoin = false;
}

/**
 * Broadcasts file metadata to the partner's PC in real-time (<50ms).
 */
async function broadcastFileShared(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "file_shared",
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast file error:", err);
    return false;
  }
}

/**
 * Broadcasts schedule updates to the partner's PC in real-time (<50ms).
 */
async function broadcastScheduleUpdate(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "schedule_update",
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast schedule error:", err);
    return false;
  }
}

/**
 * Broadcasts a live chat message to the partner's PC in real-time (<50ms).
 */
async function broadcastChatMessage(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "partner_chat",
      payload: {
        ...payload,
        timestamp: payload.timestamp || Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast chat error:", err);
    return false;
  }
}

/**
 * Broadcasts remote desktop co-pilot signals to the partner's PC (Mochi Eye).
 */
async function broadcastRemoteAccess(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "remote_access",
      payload: {
        ...payload,
        senderId: currentConfig.userId, recipientId: currentConfig.peerId,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast remote_access error:", err);
    return false;
  }
}

/**
 * Broadcasts a peer-to-peer sync request (asking partner for any missed messages/tasks).
 */
async function broadcastSyncRequest(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "sync_request",
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast sync_request error:", err);
    return false;
  }
}

/**
 * Broadcasts a peer-to-peer sync response (sending missed messages and schedule).
 */
async function broadcastSyncResponse(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "sync_response",
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast sync_response error:", err);
    return false;
  }
}

/**
 * Broadcasts partner join announcement.
 */
async function broadcastPartnerJoin(payload) {
  if (!realtimeChannel) return false;
  try {
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: "partner_join",
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast partner_join error:", err);
    return false;
  }
}

// ── Cloud Database Storage (24/7 Offline Sync) ──────────────────────────────

/**
 * Saves a chat message to the persistent mochi_messages table.
 */
async function saveChatMessageToCloud(msg, channelName = "coucou-badsha-ayzil") {
  if (!supabaseClient) return false;
  try {
    const row = {
      id: msg.id,
      channel: channelName,
      sender: msg.sender,
      sender_role: msg.senderRole,
      recipient: msg.recipient,
      text: msg.text,
      timestamp: msg.timestamp || Date.now(),
      is_ai_generated: !!msg.isAiGenerated,
      read: !!msg.read,
    };
    const { error } = await supabaseClient.from("mochi_messages").upsert(row);
    if (error) {
      // Table doesn't exist yet or other permission issue
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fetches offline chat messages stored in the cloud table.
 */
async function fetchOfflineChatMessages(channelName = "coucou-badsha-ayzil", sinceTimestamp = 0) {
  if (!supabaseClient) return [];
  try {
    const data = [], boundary = Date.now();
    let cursor = null;
    while (true) {
      let query = supabaseClient.from('mochi_messages').select('*').eq('channel', channelName)
        .gte('timestamp', sinceTimestamp).lte('timestamp', boundary).order('timestamp').order('id').limit(500);
      if (cursor) query = query.or(`timestamp.gt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.gt.${cursor.id})`);
      const { data: page, error } = await query;
      if (error) throw error;
      data.push(...(page || []));
      if (!page || page.length < 500) break;
      cursor = page[page.length - 1];
      if (!/^[\w-]+$/.test(cursor.id)) throw new Error('Invalid message cursor');
    }

    return (data || []).map((row) => ({
      id: row.id,
      sender: row.sender,
      recipient: row.recipient,
      text: row.text,
      timestamp: Number(row.timestamp),
      senderRole: row.sender_role,
      isAiGenerated: !!row.is_ai_generated,
      read: !!row.read,
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Saves a single task to the cloud table.
 */
async function saveTaskToCloud(task, channelName = "coucou-badsha-ayzil") {
  if (!supabaseClient || !task) return false;
  try {
    const row = {
      id: task.id,
      channel: channelName,
      title: task.title || "",
      time: task.time || "",
      assignee: task.assignee || "",
      assigned_by: task.assignedBy || "",
      completed: !!task.completed,
      created_at: task.createdAt || Date.now(),
      updated_at: task.updatedAt || task.createdAt || Date.now(),
      deleted: !!task.deleted,
      revision: task.revision || "",
    };
    const { error } = await supabaseClient.from("mochi_tasks").upsert(row);
    if (error) return false;
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Saves all active schedule tasks to the cloud table.
 */
async function saveAllTasksToCloud(tasks, channelName = "coucou-badsha-ayzil") {
  if (!supabaseClient || !Array.isArray(tasks) || tasks.length === 0) return false;
  try {
    const rows = tasks.map((task) => ({
      id: task.id,
      channel: channelName,
      title: task.title || "",
      time: task.time || "",
      assignee: task.assignee || "",
      assigned_by: task.assignedBy || "",
      completed: !!task.completed,
      created_at: task.createdAt || Date.now(),
      updated_at: task.updatedAt || task.createdAt || Date.now(),
      deleted: !!task.deleted,
      revision: task.revision || "",
    }));
    const { error } = await supabaseClient.from("mochi_tasks").upsert(rows);
    if (error) return false;
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Deletes a task from the cloud table.
 */
async function deleteTaskFromCloud(taskId, channelName = "coucou-badsha-ayzil") {
  if (!supabaseClient || !taskId) return false;
  try {
    const { error } = await supabaseClient
      .from("mochi_tasks")
      .update({ deleted: true, updated_at: Date.now(), revision: require("node:crypto").randomUUID() })
      .eq("id", taskId)
      .eq("channel", channelName);
    if (error) return false;
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fetches all tasks stored in the cloud table.
 */
async function fetchOfflineTasks(channelName = "coucou-badsha-ayzil") {
  if (!supabaseClient) return [];
  try {
    const data = []; let cursor = null;
    while (true) {
      let query = supabaseClient.from('mochi_tasks').select('*').eq('channel', channelName).order('id').limit(500);
      if (cursor) query = query.gt('id', cursor);
      const { data:page, error } = await query;
      if(error) throw error;
      data.push(...(page || []));
      if(!page || page.length<500) break;
      cursor=page[page.length-1].id;
    }

    return (data || []).map((row) => ({
      id: row.id,
      title: row.title,
      time: row.time || "",
      assignee: row.assignee || "",
      assignedBy: row.assigned_by || "",
      completed: !!row.completed,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Number(row.created_at) || 0,
      deleted: !!row.deleted,
      revision: row.revision || "",
    }));
  } catch (err) {
    return [];
  }
}

module.exports = {
  SUPABASE_SQL_SETUP,
  testSupabaseConnection,
  checkCloudStorageReady,
  initSupabase,
  disconnectSupabase,
  broadcastFileShared,
  broadcastScheduleUpdate,
  broadcastChatMessage,
  broadcastRemoteAccess,
  broadcastSyncRequest,
  broadcastSyncResponse,
  broadcastPartnerJoin,
  saveChatMessageToCloud,
  fetchOfflineChatMessages,
  saveTaskToCloud,
  saveAllTasksToCloud,
  deleteTaskFromCloud,
  fetchOfflineTasks,
};
