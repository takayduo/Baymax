const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

let cachedToken = null;
let cachedIdentity = null;
let tokenExpiry = 0;

function base64UrlEncode(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Generates an OAuth2 access token for a Google Service Account using RS256 JWT.
 * No browser login, no consent screen, no token expiry issues.
 */
async function getAccessToken(serviceAccount) {
  const identity = crypto.createHash("sha256").update(JSON.stringify(serviceAccount)).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedIdentity === identity && tokenExpiry > now + 60) {
    return cachedToken;
  }

  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Invalid service account JSON: missing client_email or private_key");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = base64UrlEncode(signer.sign(serviceAccount.private_key));
  const jwt = `${signatureInput}.${signature}`;

  const res = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Service Account Token Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedIdentity = identity;
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

/**
 * Uploads a file buffer directly to a Google Drive folder via Drive API v3 multipart upload.
 */
async function uploadFileToDrive(options) {
  return uploadFileWithToken({ ...options, accessToken: await getAccessToken(options.serviceAccount) });
}

/**
 * Downloads a file directly from Google Drive using Service Account token or API Key.
 */
async function downloadFileFromDrive({ fileId, apiKey, serviceAccount, accessToken, targetPath }) {
  let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const headers = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (serviceAccount) {
    const token = await getAccessToken(serviceAccount);
    headers["Authorization"] = `Bearer ${token}`;
  } else if (apiKey) {
    downloadUrl += `&key=${apiKey}`;
  }

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok) {
    throw new Error(`Drive Download API Error (${res.status})`);
  }

  const temporary = targetPath + '.download-' + crypto.randomUUID();
  try {
    await require('node:stream/promises').pipeline(require('node:stream').Readable.fromWeb(res.body), fs.createWriteStream(temporary, {flags:'wx'}));
    await fs.promises.rename(temporary, targetPath);
  } catch (e) { await fs.promises.unlink(temporary).catch(() => {}); throw e; }
  return true;
}

// ── OAuth 2.0 Flow for Personal Google Accounts ─────────────────────────────
const http = require("node:http");

let cancelOAuth = null;

function startGoogleOAuthFlow({ clientId, clientSecret, port = 8085 }) {
  cancelOAuth?.(new Error('Authorization replaced by a newer request.'));
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'+params;
  let startedResolve, startedReject, finishResolve, finishReject, timer, settled=false, processing=false;
  const serverStarted = new Promise((resolve,reject)=>{startedResolve=resolve;startedReject=reject;});
  const completion = new Promise((resolve,reject)=>{finishResolve=resolve;finishReject=reject;});
  completion.catch(()=>{});
  const controller = new AbortController();
  function finish(error, result) {
    if(settled)return;settled=true;clearTimeout(timer);controller.abort();
    server.close();if(cancelOAuth===cancel)cancelOAuth=null;
    if(error){startedReject(error);finishReject(error);}else finishResolve(result);
  }
  const cancel = error=>finish(error);
  const server = http.createServer(async(req,res)=>{
    try {
      const url = new URL(req.url,redirectUri);
      if(url.pathname!=='/oauth2callback'){res.writeHead(404).end('Not found');return;}
      if(url.searchParams.get('state')!==state){res.writeHead(403).end('Invalid authorization state');return;}
      if(processing || settled){res.writeHead(409).end('Authorization already handled');return;}
      const error=url.searchParams.get('error'),code=url.searchParams.get('code');
      if(error){res.writeHead(400).end('Authorization cancelled');finish(new Error('Authorization cancelled'));return;}
      if(!code){res.writeHead(400).end('Missing authorization code');return;}
      processing=true;
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);
      const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,code_verifier:verifier,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'})});
      if(!tokenResponse.ok)throw new Error(`Token exchange failed (${tokenResponse.status})`);
      const token=await tokenResponse.json();
      if(!token.access_token)throw new Error('Google did not return an access token');
      let email='';
      try {const user=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{signal,headers:{Authorization:'Bearer '+token.access_token}});if(user.ok)email=(await user.json()).email || '';}catch{}
      if(settled)return;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<html><body><h2>Baymax is connected to Google Drive</h2><p>You can close this tab and return to Baymax.</p></body></html>');
      finish(null,{success:true,email,refreshToken:token.refresh_token,accessToken:token.access_token,expiresIn:token.expires_in});
    } catch(error) {
      if(!res.headersSent)res.writeHead(500);res.end('Authorization failed. Return to Baymax to retry.');finish(error);
    }
  });
  cancelOAuth=cancel;
  server.on('error',error=>finish(error));
  server.listen(port,'127.0.0.1',startedResolve);
  timer=setTimeout(()=>finish(new Error('Authorization timed out after 5 minutes.')),5*60*1000);timer.unref?.();
  return {authUrl,serverStarted,completion};
}

async function refreshOAuthAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function uploadFileWithToken({ filePath, fileName, mimeType, folderId, accessToken }) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('Choose a regular file to upload.');
  const type = mimeType || 'application/octet-stream';
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json', 'X-Upload-Content-Type':type, 'X-Upload-Content-Length':String(stat.size) },
    body:JSON.stringify({name:fileName,parents:folderId ? [folderId] : undefined})
  });
  if (!start.ok) throw new Error(`Drive upload initialization failed (${start.status})`);
  const uploadUrl = start.headers.get('location');
  if (!uploadUrl || new URL(uploadUrl).origin !== 'https://www.googleapis.com') throw new Error('Invalid Drive upload location');
  const stream = fs.createReadStream(filePath);
  try {
    const response = await fetch(uploadUrl, { method:'PUT', signal:AbortSignal.timeout(30*60*1000), headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':type,'Content-Length':String(stat.size)}, body:stream, duplex:'half' });
    if (!response.ok) throw new Error(`Drive upload failed (${response.status}). Retry the transfer.`);
    // File inherits the chosen folder's access; never grant public permissions.
    return await response.json();
  } finally { stream.destroy(); }
}

module.exports = {
  getAccessToken,
  uploadFileToDrive,
  downloadFileFromDrive,
  startGoogleOAuthFlow,
  refreshOAuthAccessToken,
  uploadFileWithToken,
};

