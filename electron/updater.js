// Mochi Eye — 1-Click In-App Auto-Updater from GitHub
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

const REPO_OWNER = "takayduo";
const REPO_NAME = "Mochi-Ultra";
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`;
const GITHUB_ZIP_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/main.zip`;

const appDir = path.resolve(__dirname, "..");
const versionJsonPath = path.join(appDir, "version.json");

function getLocalVersionInfo() {
  let commit = "";
  let version = "1.0.0";
  let commitMessage = "";
  let commitDate = "";

  // 1. Try reading version.json
  try {
    if (fs.existsSync(versionJsonPath)) {
      const data = JSON.parse(fs.readFileSync(versionJsonPath, "utf-8"));
      commit = data.commit || "";
      version = data.version || "1.0.0";
      commitMessage = data.commitMessage || "";
      commitDate = data.commitDate || "";
    }
  } catch (e) {
    console.warn("[Updater] Failed to parse version.json:", e);
  }

  // 2. If git exists, git rev-parse is the source of truth
  if (!commit || fs.existsSync(path.join(appDir, ".git"))) {
    try {
      const gitRev = execSync("git rev-parse HEAD", { cwd: appDir, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (gitRev && gitRev.length >= 7) {
        commit = gitRev;
      }
      const gitMsg = execSync("git log -1 --pretty=%s", { cwd: appDir, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (gitMsg) {
        commitMessage = gitMsg;
      }
      const gitDate = execSync("git log -1 --pretty=%cI", { cwd: appDir, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (gitDate) {
        commitDate = gitDate;
      }
    } catch (e) {
      // not a git repo or git not in path, use version.json
    }
  }

  return {
    version,
    commit,
    commitShort: commit ? commit.slice(0, 7) : "1.0.0",
    commitMessage,
    commitDate,
  };
}

/**
 * Checks GitHub for the latest commit on the main branch.
 */
async function checkForUpdates() {
  if (app.isPackaged) return { success: false, error: "This installer build uses manual updates. Install a newer Baymax release when available.", local: getLocalVersionInfo() };
  const local = getLocalVersionInfo();
  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: {
        "User-Agent": "Mochi-Ultra-Updater",
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!res.ok) {
      console.warn(`[Updater] GitHub API returned status ${res.status}`);
      return {
        success: false,
        error: `GitHub returned status ${res.status}`,
        local,
      };
    }

    const data = await res.json();
    const remoteSha = data.sha || "";
    const rawMsg = data.commit?.message || "";
    const remoteMessage = rawMsg.split("\n")[0];
    const remoteDate = data.commit?.committer?.date || "";
    const remoteShort = remoteSha ? remoteSha.slice(0, 7) : "";

    const isUpdateAvailable = !!remoteSha && remoteSha !== local.commit;

    return {
      success: true,
      updateAvailable: isUpdateAvailable,
      local,
      remote: {
        commit: remoteSha,
        commitShort: remoteShort,
        message: remoteMessage,
        date: remoteDate,
      },
    };
  } catch (err) {
    console.error("[Updater] Check for updates failed:", err);
    return {
      success: false,
      error: err.message || "Failed to connect to GitHub",
      local,
    };
  }
}

/**
 * Recursively copies directory contents while preserving user-specific files.
 */
async function performUpdate(onProgress = () => {}) {
  if (app.isPackaged) return { success: false, error: "Install a newer Baymax release to update this packaged app." };
  const { execFile } = require('node:child_process');
  const run = (file, args, cwd, timeout=120000) => new Promise((resolve,reject) => execFile(file,args,{cwd,windowsHide:true,timeout,maxBuffer:8*1024*1024,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}},(err,out,stderr)=>err ? reject(new Error(`${file} failed: ${stderr || err.message}`)) : resolve(out.trim())));
  // No destructive ZIP fallback. A dirty or non-Git installation is reviewable
  // local work and must be committed/backed up before an in-app update.
  if (!fs.existsSync(path.join(appDir,'.git'))) throw new Error('Automatic updates require a clean Git installation. Install a fresh copy beside this folder.');
  if (await run('git',['status','--porcelain','--untracked-files=normal'],appDir)) throw new Error('Local changes detected. Commit or back them up before updating.');
  const check=await checkForUpdates();
  if (!check.success) throw new Error(check.error);
  if (!check.updateAvailable) return {success:true,updated:false};
  const remote=check.remote;
  if (!/^[a-f0-9]{40}$/.test(remote.commit)) throw new Error('Invalid update revision');
  const stamp=Date.now(), parent=path.dirname(appDir);
  const stage=path.join(parent,`.baymax-stage-${stamp}`), backup=path.join(parent,`.baymax-backup-${stamp}`);
  onProgress('Preparing an isolated update...');
  await run('git',['clone','--no-checkout',`https://github.com/${REPO_OWNER}/${REPO_NAME}.git`,stage],parent,300000);
  await run('git',['checkout','--detach',remote.commit],stage);
  if (await run('git',['rev-parse','HEAD'],stage) !== remote.commit) throw new Error('Update revision mismatch');
  for (const required of ['package-lock.json','productivity/package-lock.json','scripts/build.cjs']) if (!fs.existsSync(path.join(stage,required))) throw new Error(`Update lacks required validation file: ${required}`);
  onProgress('Installing locked dependencies and validating both frontends...');
  await run('cmd.exe',['/d','/s','/c','npm ci'],stage,600000);
  await run('cmd.exe',['/d','/s','/c','npm ci'],path.join(stage,'productivity'),600000);
  await run('cmd.exe',['/d','/s','/c','npm run build'],stage,300000);
  // Engine dependency changes are prepared in an isolated virtual environment.
  onProgress('Validating the Python engine...');
  await run('python',['-m','venv',path.join(stage,'engine','.venv')],stage,120000);
  const stagedPython=path.join(stage,'engine','.venv','Scripts','python.exe');
  await run(stagedPython,['-m','pip','install','-r',path.join(stage,'engine','requirements.txt')],stage,900000);
  await run(stagedPython,['-m','pip','check'],stage);
  fs.writeFileSync(path.join(stage,'engine','python_path.txt'),path.join(appDir,'engine','.venv','Scripts','python.exe'));
  fs.writeFileSync(path.join(stage,'version.json'),JSON.stringify({version:'1.0.0',commit:remote.commit,commitDate:remote.date,commitMessage:remote.message},null,2));
  // The helper lives outside the folders it moves and keeps a rollback copy.
  const helper=path.join(parent,`.baymax-apply-${stamp}.ps1`);
  fs.copyFileSync(path.join(__dirname,'..','scripts','apply-update.ps1'),helper);
  onProgress('Validation passed. Restarting into the prepared update...');
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Root',appDir,'-Stage',stage,'-Backup',backup,'-WaitPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref(); app.quit(); return {success:true,updated:true,backup};
}
module.exports = { getLocalVersionInfo, checkForUpdates, performUpdate };
