import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SessionState } from '../common/session';
import type { ExportSessionRequest } from './preload';
import { isProjectSchema } from '../common/project';
import type { MediaLibraryItem } from '../common/project';
import { spawn } from 'node:child_process';
import os from 'os';
import crypto from 'crypto';

const SESSION_FILENAME = 'session.json';
const SETTINGS_FILENAME = 'settings.json';

type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
};

type SettingsState = {
  window?: WindowState;
};

const getSessionFilePath = () => path.join(app.getPath('userData'), SESSION_FILENAME);
const getSettingsFilePath = () => path.join(app.getPath('userData'), SETTINGS_FILENAME);

const DEFAULT_WINDOW_STATE: WindowState = { width: 2400, height: 900 };

async function ensureUserDataDir(): Promise<void> {
  const directory = app.getPath('userData');
  await fs.mkdir(directory, { recursive: true });
}

const writeJsonAtomic = async (filePath: string, payload: unknown): Promise<void> => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `${base}.tmp`);
  const data = JSON.stringify(payload ?? {}, null, 2);
  await fs.writeFile(tmpPath, data, 'utf-8');
  await fs.rename(tmpPath, filePath);
};

const readSettingsState = async (): Promise<SettingsState> => {
  const filePath = getSettingsFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.trim()) {
      return {};
    }
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as SettingsState;
    }
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {};
    }
    if (err.name === 'SyntaxError') {
      try {
        const corruptPath = `${filePath}.corrupt-${Date.now()}`;
        await fs.rename(filePath, corruptPath);
        console.warn('[settings] Corrupt settings file moved to', corruptPath);
      } catch (moveErr) {
        console.warn('[settings] Failed to move corrupt settings file:', moveErr);
      }
      return {};
    }
    console.warn('[settings] Failed to read settings file:', error);
  }
  return {};
};

const loadWindowState = async (): Promise<WindowState> => {
  const settings = await readSettingsState();
  const state: Partial<WindowState> = settings.window ?? {};
  const width = Number(state.width);
  const height = Number(state.height);
  const x = Number(state.x);
  const y = Number(state.y);
  const next: WindowState = {
    width: Number.isFinite(width) ? Math.max(400, width) : DEFAULT_WINDOW_STATE.width,
    height: Number.isFinite(height) ? Math.max(300, height) : DEFAULT_WINDOW_STATE.height,
  };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    next.x = x;
    next.y = y;
  }
  if (state.isMaximized) {
    next.isMaximized = true;
  }
  return next;
};

const saveWindowState = async (window: BrowserWindow): Promise<void> => {
  const isMaximized = window.isMaximized();
  const bounds = isMaximized ? window.getNormalBounds() : window.getBounds();
  const settings = await readSettingsState();
  const payload: SettingsState = {
    ...settings,
    window: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    },
  };
  await ensureUserDataDir();
  await writeJsonAtomic(getSettingsFilePath(), payload);
};

const safeSaveWindowState = async (window: BrowserWindow): Promise<void> => {
  try {
    await saveWindowState(window);
  } catch (err) {
    console.warn('[settings] Failed to save window state:', err);
  }
};

ipcMain.handle('session:load', async (): Promise<SessionState | undefined> => {
  const filePath = getSessionFilePath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as SessionState;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    console.error('[session:load] Failed to read session file:', error);
    throw error;
  }
});

ipcMain.handle('session:save', async (_event, state: SessionState): Promise<void> => {
  await ensureUserDataDir();
  const filePath = getSessionFilePath();

  try {
    const payload = JSON.stringify(state ?? {}, null, 2);
    await fs.writeFile(filePath, payload, 'utf-8');
  } catch (error) {
    console.error('[session:save] Failed to persist session state:', error);
    throw error;
  }
});

ipcMain.handle('session:export', async (_event, request: ExportSessionRequest): Promise<void> => {
  const { targetPath, state } = request;

  if (!targetPath) {
    throw new Error('No export path provided.');
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const payload = JSON.stringify(state ?? {}, null, 2);
    await fs.writeFile(targetPath, payload, 'utf-8');
  } catch (error) {
    console.error('[session:export] Failed to export session:', error);
    throw error;
  }
});

ipcMain.handle('render:cancel', async (): Promise<void> => {
  const child = currentRenderChild;
  if (!child) return;
  try {
    child.kill('SIGINT');
    setTimeout(() => {
      if (!child.killed) {
        try {
          if (process.platform === 'win32') {
            const { spawn: sysSpawn } = require('node:child_process');
            sysSpawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
          } else {
            child.kill('SIGKILL');
          }
        } catch {}
      }
    }, 750);
  } catch {}
  currentRenderChild = null;
  mainWindow?.webContents.send('render:cancelled');
});

ipcMain.handle('audio:open', async (): Promise<string | undefined> => {
  const result = await dialog.showOpenDialog({
    title: 'Select audio file',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'aac', 'flac', 'ogg', 'm4a'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
});

ipcMain.handle('videos:open', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    title: 'Select video files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle('image:open', async (): Promise<string | undefined> => {
  const result = await dialog.showOpenDialog({
    title: 'Select image file',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
});

ipcMain.handle('file:exists', async (_event, filePath: string): Promise<boolean> => {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

const buildMachineFingerprint = (): string => {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus().map((c) => c.model).join('|');
  const base = `${hostname}::${platform}::${arch}::${cpus}`;
  return crypto.createHash('sha256').update(base).digest('hex');
};

ipcMain.handle('machine:fingerprint', async (): Promise<string> => {
  try {
    return buildMachineFingerprint();
  } catch {
    return '';
  }
});

ipcMain.handle('file:readBuffer', async (_event, filePath: string): Promise<Buffer> => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error('[file:readBuffer] Failed to read', filePath, err);
    throw err;
  }
});

ipcMain.handle('project:saveAs', async (_event, defaultPath?: string): Promise<string | undefined> => {
  const result = await dialog.showSaveDialog({
    title: 'Save project as JSON',
    defaultPath,
    filters: [{ name: 'Project JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  // ensure folder exists
  await fs.mkdir(path.dirname(result.filePath), { recursive: true });
  return result.filePath;
});

ipcMain.handle('project:open', async (): Promise<{ path: string; project: unknown } | undefined> => {
  const result = await dialog.showOpenDialog({
    title: 'Open project JSON',
    properties: ['openFile'],
    filters: [{ name: 'Project JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('Selected file is not valid JSON.');
  }
  // Basic shape validation; renderer can further validate
  if (!isProjectSchema(parsed)) {
    throw new Error('Selected file is not a valid vizmatic project JSON.');
  }
  return { path: filePath, project: parsed };
});

ipcMain.handle('project:save', async (_event, filePath: string, project: unknown): Promise<void> => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid project path.');
  }
  if (!isProjectSchema(project)) {
    throw new Error('Invalid project payload.');
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(project, null, 2);
  await fs.writeFile(filePath, payload, 'utf-8');
});

ipcMain.handle('project:updateDirty', async (_event, dirty: boolean): Promise<void> => {
  projectDirty = !!dirty;
});

ipcMain.handle('render:start', async (_event, projectJsonPath: string): Promise<void> => {
  if (currentRenderChild) {
    throw new Error('A render is already in progress.');
  }
  if (!projectJsonPath || typeof projectJsonPath !== 'string') {
    throw new Error('Invalid project JSON path.');
  }
  try {
    await fs.access(projectJsonPath);
  } catch {
    throw new Error('Project JSON file does not exist.');
  }

  const rendererOverride = process.env.vizmatic_RENDERER; // path to exe or script
  const pythonOverride = process.env.vizmatic_PYTHON || 'python';

  // Resolve default renderer script location in dev
  const candidates = [
    // packaged binary inside Electron asar/resources
    path.join(process.resourcesPath, 'renderer', process.platform === 'win32' ? 'vizmatic-renderer.exe' : 'vizmatic-renderer'),
    // when running from TS outDir (dist-electron/electron), go up to repo root
    path.join(__dirname, '..', '..', 'renderer', 'python', 'main.py'),
    // alternate relative
    path.join(process.cwd(), 'renderer', 'python', 'main.py'),
  ];

  const rendererPath = rendererOverride ?? (await (async () => {
    for (const c of candidates) {
      try { await fs.access(c); return c; } catch {}
    }
    return undefined;
  })());

  if (!rendererPath) {
    throw new Error('Renderer script not found. Set vizmatic_RENDERER to the Python script or packaged renderer.');
  }

  const isPy = rendererPath.toLowerCase().endsWith('.py');
  const cmd = isPy ? pythonOverride : rendererPath;
  const args = isPy ? [rendererPath, projectJsonPath] : [projectJsonPath];
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // Prefer redist folder inside Electron resources for ffmpeg/ffprobe
  const redistDir = path.join(process.resourcesPath, 'redist');
  const ffName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const fpName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const redistFfmpeg = path.join(redistDir, ffName);
  const redistFfprobe = path.join(redistDir, fpName);
  try {
    await fs.access(redistFfmpeg);
    if (!childEnv.vizmatic_FFMPEG) childEnv.vizmatic_FFMPEG = redistFfmpeg;
  } catch {}
  try {
    await fs.access(redistFfprobe);
    if (!childEnv.vizmatic_FFPROBE) childEnv.vizmatic_FFPROBE = redistFfprobe;
  } catch {}
  // If running a standalone packaged renderer binary, also try sibling fallback
  if (!isPy) {
    const base = path.dirname(rendererPath);
    const sibFfmpeg = path.join(base, ffName);
    const sibFfprobe = path.join(base, fpName);
    try {
      await fs.access(sibFfmpeg);
      if (!childEnv.vizmatic_FFMPEG) childEnv.vizmatic_FFMPEG = sibFfmpeg;
    } catch {}
    try {
      await fs.access(sibFfprobe);
      if (!childEnv.vizmatic_FFPROBE) childEnv.vizmatic_FFPROBE = sibFfprobe;
    } catch {}
  }
  // Dev fallbacks: vendor\\windows\\redist and local .\\redist under repo root
  const repoRoot = path.resolve(__dirname, '..', '..');
  const devBases = [
    path.join(repoRoot, 'vendor', 'windows', 'redist'),
    path.join(process.cwd(), 'vendor', 'windows', 'redist'),
    path.join(repoRoot, 'redist'),
    path.join(process.cwd(), 'redist'),
  ];
  for (const b of devBases) {
    try {
      if (!childEnv.vizmatic_FFMPEG) {
        const p = path.join(b, ffName);
        await fs.access(p);
        childEnv.vizmatic_FFMPEG = p;
      }
      if (!childEnv.vizmatic_FFPROBE) {
        const p = path.join(b, fpName);
        await fs.access(p);
        childEnv.vizmatic_FFPROBE = p;
      }
    } catch {}
  }

  // Emit diagnostic of resolved tools
  try {
    const msg = `Using ffmpeg: ${childEnv.vizmatic_FFMPEG ?? '(PATH)'}; ffprobe: ${childEnv.vizmatic_FFPROBE ?? '(PATH)'}`;
    console.log('[render]', msg);
    mainWindow?.webContents.send('render:log', msg);
  } catch {}

  return await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe', env: childEnv });
    currentRenderChild = child;
    let stdoutBuf = '';
    let stderrBuf = '';
    let totalMs = 0;
    const flushLines = (buf: string, isErr: boolean) => {
      const lines = buf.split(/\r?\n/);
      // Keep last partial if not ending with newline
      const complete = lines.slice(0, lines[lines.length - 1] === '' ? lines.length - 1 : lines.length - 1);
      const remainder = lines[lines.length - 1] ?? '';
      for (const line of complete) {
        const msg = line.trimEnd();
        if (!msg) continue;
        if (isErr) {
          console.error(`[renderer] ${msg}`);
        } else {
          console.log(`[renderer] ${msg}`);
        }
        // Emit log event to renderer
        mainWindow?.webContents.send('render:log', msg);
        // Very basic progress parsing
        const mOut = msg.match(/^out_time_ms=(\d+)/);
        if (mOut) {
          const ms = Number(mOut[1]);
          if (Number.isFinite(ms)) {
            mainWindow?.webContents.send('render:progress', { outTimeMs: ms, totalMs });
          }
        }
        const mTot = msg.match(/^total_duration_ms=(\d+)/);
        if (mTot) {
          const t = Number(mTot[1]);
          if (Number.isFinite(t)) {
            totalMs = t;
            mainWindow?.webContents.send('render:progress', { totalMs });
          }
        }
      }
      return remainder;
    };
    child.stdout.on('data', (d) => {
      stdoutBuf += String(d);
      stdoutBuf = flushLines(stdoutBuf, false);
    });
    child.stderr.on('data', (d) => {
      stderrBuf += String(d);
      stderrBuf = flushLines(stderrBuf, true);
    });
    child.on('error', (err) => { currentRenderChild = null; reject(err); });
    child.on('close', (code) => {
      currentRenderChild = null;
      if (code === 0) {
        mainWindow?.webContents.send('render:done');
        resolve();
      } else {
        const err = new Error(`Renderer exited with code ${code}`);
        mainWindow?.webContents.send('render:error', String(err));
        reject(err);
      }
    });
  });
});

async function resolveRendererEntryPoint(): Promise<string> {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'index.html'),
    path.join(__dirname, '..', '..', 'dist', 'index.html'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Renderer bundle not found. Ensure the renderer has been built before starting Electron.',
  );
}

async function resolveAppIcon(): Promise<string | undefined> {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'ui', 'vizmatic_noText_logo.ico'),
    path.join(__dirname, '..', '..', 'dist', 'ui', 'vizmatic_noText_logo.ico'),
    path.join(__dirname, '..', 'client', 'public', 'ui', 'vizmatic_noText_logo.ico'),
    path.join(__dirname, '..', '..', 'client', 'public', 'ui', 'vizmatic_noText_logo.ico'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

let mainWindow: BrowserWindow | null = null;
let currentRenderChild: import('node:child_process').ChildProcess | null = null;
let projectDirty: boolean = false;
let preferencesWindow: BrowserWindow | null = null;
let mediaLibraryWindow: BrowserWindow | null = null;

const openPreferencesWindow = async () => {
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    preferencesWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 600,
    minHeight: 420,
    autoHideMenuBar: true,
    title: 'Advanced Settings',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  preferencesWindow = win;
  win.on('closed', () => {
    preferencesWindow = null;
  });
  const prefsPath = path.join(__dirname, 'preferences.html');
  await win.loadFile(prefsPath);
};

const buildMediaLibraryHtml = () => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Media Library</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: #0b0f16;
      color: #e7ebf5;
    }
    .wrap { padding: 12px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
    button {
      border: 1px solid #2b3a58;
      background: #101a2a;
      color: #e7ebf5;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .list {
      border: 1px solid #22314d;
      border-radius: 8px;
      overflow: auto;
      max-height: 420px;
      background: #0f1625;
    }
    .row {
      border-bottom: 1px solid #1e2b43;
      padding: 8px 10px;
      cursor: pointer;
    }
    .row:last-child { border-bottom: none; }
    .row.sel { background: #1a2640; }
    .name { font-weight: 600; }
    .path { font-size: 12px; color: #9fb0d4; margin-top: 2px; }
    .meta { font-size: 12px; color: #9fb0d4; margin-top: 2px; }
    .status { margin-top: 10px; font-size: 12px; color: #9fb0d4; min-height: 16px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <button id="addEntry">Add Entry</button>
      <button id="addToProject" disabled>Add to Project</button>
      <button id="remove" disabled>Remove</button>
      <button id="refresh">Refresh</button>
    </div>
    <div id="list" class="list"></div>
    <div id="status" class="status"></div>
  </div>
  <script>
    const listEl = document.getElementById('list');
    const statusEl = document.getElementById('status');
    const addEntryBtn = document.getElementById('addEntry');
    const addToProjectBtn = document.getElementById('addToProject');
    const removeBtn = document.getElementById('remove');
    const refreshBtn = document.getElementById('refresh');
    let items = [];
    let selectedId = null;
    const makeId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
    const ext = (p) => {
      const i = p.lastIndexOf('.');
      return i >= 0 ? p.slice(i).toLowerCase() : '';
    };
    const isVideo = (p) => ['.mp4','.mov','.mkv','.avi','.webm','.wmv'].includes(ext(p));
    const render = () => {
      addToProjectBtn.disabled = !selectedId;
      removeBtn.disabled = !selectedId;
      listEl.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'row' + (item.id === selectedId ? ' sel' : '');
        row.onclick = () => { selectedId = item.id; render(); };
        row.ondblclick = async () => {
          await window.electron.addMediaLibraryItemToProject(item.path);
          statusEl.textContent = 'Added to project: ' + item.name;
        };
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = item.name;
        const path = document.createElement('div');
        path.className = 'path';
        path.textContent = item.path;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const d = item.duration ? Math.round(item.duration) + 's' : 'n/a';
        meta.textContent = 'Duration: ' + d;
        row.appendChild(name);
        row.appendChild(path);
        row.appendChild(meta);
        listEl.appendChild(row);
      }
    };
    const reload = async () => {
      items = await window.electron.loadMediaLibrary();
      if (!items.some((x) => x.id === selectedId)) selectedId = null;
      render();
      statusEl.textContent = 'Library items: ' + items.length;
    };
    addEntryBtn.onclick = async () => {
      try {
        const paths = await window.electron.openVideoFiles();
        if (!paths || !paths.length) return;
        const existing = new Set(items.map((i) => i.path));
        const next = items.slice();
        for (const p of paths) {
          if (!isVideo(p) || existing.has(p)) continue;
          let meta = {};
          try { meta = await window.electron.probeMediaFile(p); } catch {}
          const base = p.split(/[\\\\/]/).pop() || 'clip';
          next.push({
            id: makeId(),
            name: base.replace(/\\.[^.]+$/, ''),
            path: p,
            description: '',
            duration: Number.isFinite(meta.duration) ? Number(meta.duration) : undefined,
            videoCodec: meta.videoCodec,
            audioCodec: meta.audioCodec,
            audioChannels: Number.isFinite(meta.audioChannels) ? Number(meta.audioChannels) : undefined,
            width: Number.isFinite(meta.width) ? Number(meta.width) : undefined,
            height: Number.isFinite(meta.height) ? Number(meta.height) : undefined,
          });
          existing.add(p);
        }
        items = next;
        await window.electron.saveMediaLibrary(items);
        await reload();
      } catch (err) {
        statusEl.textContent = 'Failed to add entry.';
      }
    };
    addToProjectBtn.onclick = async () => {
      const sel = items.find((x) => x.id === selectedId);
      if (!sel) return;
      await window.electron.addMediaLibraryItemToProject(sel.path);
      statusEl.textContent = 'Added to project: ' + sel.name;
    };
    removeBtn.onclick = async () => {
      if (!selectedId) return;
      items = items.filter((x) => x.id !== selectedId);
      selectedId = null;
      await window.electron.saveMediaLibrary(items);
      await reload();
    };
    refreshBtn.onclick = reload;
    reload();
  </script>
</body>
</html>`;

const openMediaLibraryWindow = async () => {
  if (mediaLibraryWindow && !mediaLibraryWindow.isDestroyed()) {
    mediaLibraryWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 520,
    title: 'Media Library',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mediaLibraryWindow = win;
  win.on('closed', () => {
    mediaLibraryWindow = null;
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMediaLibraryHtml())}`);
};

async function createWindow(): Promise<void> {
  const windowState = await loadWindowState();
  const iconPath = await resolveAppIcon();
  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // At runtime the preload script is compiled to JavaScript and emitted
      // to the electron output directory as `preload.js`. Point to that file
      // so the BrowserWindow can load the actual compiled script.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = win;
  win.webContents.setWindowOpenHandler((details) => {
    const url = details.url || '';
    if (details.frameName === 'vizmatic-preview') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1060,
          height: 660,
          minWidth: 520,
          minHeight: 340,
          frame: false,
          titleBarStyle: 'hidden',
          autoHideMenuBar: true,
          show: true,
        },
      };
    }
    if (url.includes('vizmatic.sorryneedboost.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 900,
          minWidth: 900,
          minHeight: 700,
          autoHideMenuBar: false,
          show: true,
        },
      };
    }
    return { action: 'allow' };
  });
  if (windowState.isMaximized) {
    win.maximize();
  }
  win.on('maximize', () => {
    try { win.webContents.send('window:maximized', true); } catch {}
  });
  win.on('unmaximize', () => {
    try { win.webContents.send('window:maximized', false); } catch {}
  });
  win.webContents.on('did-finish-load', () => {
    try { win.webContents.send('window:maximized', win.isMaximized()); } catch {}
  });
  win.on('close', () => {
    void safeSaveWindowState(win);
  });
  const indexHtml = await resolveRendererEntryPoint();

  try {
    await win.loadFile(indexHtml);
  } catch (error) {
    dialog.showErrorBox('Failed to load renderer', `${error}`);
    throw error;
  }
}

const emitMenuAction = (action: string) => {
  try {
    mainWindow?.webContents.send('menu:action', action);
  } catch (err) {
    console.warn('[menu] failed to emit action', action, err);
  }
};

const resolveEventWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
};

ipcMain.handle('menu:invoke', async (_event, action: string): Promise<void> => {
  switch (action) {
    case 'preferences:advanced':
      await openPreferencesWindow();
      break;
    case 'view:toggleDevTools':
      mainWindow?.webContents.toggleDevTools();
      break;
    case 'view:refresh':
      mainWindow?.webContents.reload();
      break;
    case 'view:toggleFullscreen':
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
      break;
    default:
      emitMenuAction(action);
      break;
  }
});

ipcMain.handle('window:minimize', async (event): Promise<void> => {
  resolveEventWindow(event)?.minimize();
});

ipcMain.handle('window:toggleMaximize', async (event): Promise<void> => {
  const win = resolveEventWindow(event);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.handle('window:close', async (event): Promise<void> => {
  resolveEventWindow(event)?.close();
});

ipcMain.handle('window:isMaximized', async (event): Promise<boolean> => {
  return !!resolveEventWindow(event)?.isMaximized();
});

ipcMain.on('menu:setLayerMoveEnabled', (_event, payload: { up: boolean; down: boolean }) => {
  try {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const upItem = menu.getMenuItemById('layer:moveUp');
    const downItem = menu.getMenuItemById('layer:moveDown');
    if (upItem) upItem.enabled = !!payload.up;
    if (downItem) downItem.enabled = !!payload.down;
  } catch (err) {
    console.warn('[menu] failed to update layer move items', err);
  }
});

ipcMain.handle('settings:load', async (): Promise<SettingsState> => {
  return readSettingsState();
});

ipcMain.handle('settings:save', async (_event, settings: SettingsState): Promise<void> => {
  await ensureUserDataDir();
  await writeJsonAtomic(getSettingsFilePath(), settings ?? {});
});

const buildAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => emitMenuAction('project:new') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+O', click: () => emitMenuAction('project:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => emitMenuAction('project:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => emitMenuAction('project:saveAs') },
        { type: 'separator' },
        { label: 'Preferences', submenu: [
          { label: 'Advanced Settings', click: () => { void openPreferencesWindow(); } },
        ] },
        { type: 'separator' },
        { label: 'Render', accelerator: 'CmdOrCtrl+R', click: () => emitMenuAction('render:start') },
        { label: 'Cancel Render', click: () => emitMenuAction('render:cancel') },
        { label: 'Clear Render Logs', click: () => emitMenuAction('render:clearLogs') },
        { type: 'separator' },
        { role: 'quit' as const },
      ],
    },
    {
      label: 'Media',
      submenu: [
        { label: 'Open Media Library', click: () => { void openMediaLibraryWindow(); } },
        { type: 'separator' },
        { label: 'Load Audio...', click: () => emitMenuAction('media:loadAudio') },
        { label: 'Add Videos...', click: () => emitMenuAction('media:addVideos') },
        { label: 'Add From Library...', click: () => emitMenuAction('media:addFromLibrary') },
      ],
    },
    {
      label: 'Layers',
      submenu: [
        { label: 'Add Visualizer', click: () => emitMenuAction('layer:addSpectrograph') },
        { label: 'Add Text', click: () => emitMenuAction('layer:addText') },
        { type: 'separator' },
        { id: 'layer:moveUp', label: 'Move Layer Up', click: () => emitMenuAction('layer:moveUp'), enabled: false },
        { id: 'layer:moveDown', label: 'Move Layer Down', click: () => emitMenuAction('layer:moveDown'), enabled: false },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Zoom Timeline In', accelerator: 'CmdOrCtrl+=', click: () => emitMenuAction('view:zoomIn') },
        { label: 'Zoom Timeline Out', accelerator: 'CmdOrCtrl+-', click: () => emitMenuAction('view:zoomOut') },
        { label: 'Zoom Timeline Fit', accelerator: 'CmdOrCtrl+0', click: () => emitMenuAction('view:zoomFit') },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: [
            { label: 'Auto', type: 'radio', checked: true, click: () => emitMenuAction('view:theme:auto') },
            { label: 'Dark', type: 'radio', click: () => emitMenuAction('view:theme:dark') },
            { label: 'Light', type: 'radio', click: () => emitMenuAction('view:theme:light') },
          ],
        },
        { label: 'Toggle Logs', click: () => emitMenuAction('view:toggleLogs') },
        { type: 'separator' },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Activation',
          submenu: [
            { label: 'Activation Info', click: () => emitMenuAction('help:activation') },
            { label: 'Unlicense', click: () => emitMenuAction('help:unlicense') },
          ],
        },
        { type: 'separator' },
        { label: 'About vizmatic', click: () => emitMenuAction('help:about') },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template as any);
  Menu.setApplicationMenu(menu);
};

app.whenReady().then(() => {
  buildAppMenu();
  return createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (mainWindow) {
    void safeSaveWindowState(mainWindow);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('browser-window-created', (_event, window) => {
  window.on('closed', () => {
    if (window === mainWindow) mainWindow = null;
  });
});

// Intercept window close to prompt save for dirty projects
app.on('browser-window-created', (_event, window) => {
  window.on('close', async (e) => {
    await safeSaveWindowState(window);
    // First, if a render is in progress, prompt to stop or cancel exit
    if (currentRenderChild) {
      e.preventDefault();
      const res = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['Stop Render', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Render In Progress',
        message: 'A render is currently in progress. Do you want to stop it before exiting? ',
        noLink: true,
      });
      if (res.response === 1) {
        // Cancel exit
        return;
      }
      // Stop render and then continue to dirty-check flow
      try {
        const child = currentRenderChild;
        if (child) {
          child.kill('SIGINT');
          setTimeout(() => {
            if (!child.killed) {
              try {
                if (process.platform === 'win32') {
                  const { spawn: sysSpawn } = require('node:child_process');
                  sysSpawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
                } else {
                  child.kill('SIGKILL');
                }
              } catch {}
            }
          }, 750);
        }
      } catch {}
      // Fall through to dirty prompt below after attempting to stop
    }

    if (!projectDirty) return;
    e.preventDefault();
    const res = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved Changes',
      message: 'You have unsaved project changes. Save before exiting?',
      noLink: true,
    });
    if (res.response === 1) {
      // Discard
      projectDirty = false;
      window.destroy();
      return;
    }
    if (res.response === 2) {
      // Cancel
      return;
    }
    // Save
    try {
      const once = (evt: string) => new Promise<boolean>((resolve) => {
        const handler = (_event: Electron.IpcMainEvent, ok: boolean) => {
          ipcMain.removeListener('project:saved', handler);
          resolve(!!ok);
        };
        ipcMain.on('project:saved', handler);
      });
      window.webContents.send('project:requestSave');
      const ok = await once('project:saved');
      if (ok) {
        projectDirty = false;
        window.destroy();
      }
    } catch {
      // swallow and keep window open
    }
  });
});
ipcMain.handle('project:defaultPath', async (_event, projectName?: string): Promise<string> => {
  const docs = app.getPath('documents');
  const baseDir = path.join(docs, 'vizmatic', 'Projects');
  await fs.mkdir(baseDir, { recursive: true });
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rawBase = typeof projectName === 'string' ? projectName.trim() : '';
  const safeBase = (rawBase || 'Project').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'Project';
  const name = `${safeBase}-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
  return path.join(baseDir, name);
});

ipcMain.handle('render:chooseOutput', async (_event, projectJsonPath?: string): Promise<string | undefined> => {
  // Suggest <project>_render.mp4 next to the project JSON, or fall back to Documents
  let defaultPath: string | undefined;
  try {
    if (projectJsonPath) {
      const root = projectJsonPath.replace(/\.[^\.]+$/, '');
      defaultPath = `${root}_render.mp4`;
    }
  } catch {}
  if (!defaultPath) {
    const docs = app.getPath('documents');
    await fs.mkdir(path.join(docs, 'vizmatic', 'Renders'), { recursive: true });
    defaultPath = path.join(docs, 'vizmatic', 'Renders', 'render.mp4');
  }
  const result = await dialog.showSaveDialog({
    title: 'Choose output video file',
    defaultPath,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  await fs.mkdir(path.dirname(result.filePath), { recursive: true });
  return result.filePath;
});

ipcMain.handle('render:prepareProject', async (_event, projectJsonPath: string, outputPath: string): Promise<string> => {
  const dir = path.dirname(projectJsonPath);
  const work = path.join(dir, '.vizmatic');
  await fs.mkdir(work, { recursive: true });
  const tmpPath = path.join(work, 'render.json');
  const raw = await fs.readFile(projectJsonPath, 'utf-8');
  let json: any;
  try { json = JSON.parse(raw); } catch { throw new Error('Project JSON is invalid.'); }
  if (!json || typeof json !== 'object') throw new Error('Project JSON is invalid.');
  json.output = { path: outputPath };
  await fs.writeFile(tmpPath, JSON.stringify(json, null, 2), 'utf-8');
  return tmpPath;
});

const mediaLibraryPath = () => path.join(app.getPath('userData'), 'library.json');

ipcMain.handle('mediaLibrary:load', async (): Promise<MediaLibraryItem[]> => {
  try {
    const p = mediaLibraryPath();
    const raw = await fs.readFile(p, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as MediaLibraryItem[];
    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
});

ipcMain.handle('mediaLibrary:save', async (_event, items: MediaLibraryItem[]): Promise<void> => {
  const p = mediaLibraryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(items ?? [], null, 2), 'utf-8');
});

ipcMain.handle('mediaLibrary:openWindow', async (): Promise<void> => {
  await openMediaLibraryWindow();
});

ipcMain.handle('mediaLibrary:addToProject', async (_event, filePath: string): Promise<void> => {
  if (!filePath) return;
  mainWindow?.webContents.send('mediaLibrary:addPath', filePath);
});

ipcMain.handle('mediaLibrary:probe', async (_event, filePath: string): Promise<Partial<MediaLibraryItem>> => {
  if (!filePath) throw new Error('No file path');
  const ffprobePath = await (async () => {
    const ffName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const candidates = [
      process.env.vizmatic_FFPROBE,
      path.join(process.resourcesPath, 'redist', ffName),
      path.join(path.resolve(__dirname, '..', '..'), 'vendor', 'windows', 'redist', ffName),
      path.join(process.cwd(), 'vendor', 'windows', 'redist', ffName),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      try { await fs.access(c); return c; } catch {}
    }
    return 'ffprobe';
  })();

  const runProbe = () => new Promise<any>((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath];
    const proc = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(out)); } catch (err) { reject(err); }
      } else {
        reject(new Error('ffprobe failed'));
      }
    });
    proc.on('error', reject);
  });

  try {
    const data = await runProbe();
    const fmt = data?.format ?? {};
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    const v = streams.find((s: any) => s.codec_type === 'video');
    const a = streams.find((s: any) => s.codec_type === 'audio');
    return {
      duration: fmt?.duration ? Number(fmt.duration) : undefined,
      videoCodec: v?.codec_name,
      audioCodec: a?.codec_name,
      audioChannels: a?.channels ? Number(a.channels) : undefined,
      width: v?.width ? Number(v.width) : undefined,
      height: v?.height ? Number(v.height) : undefined,
    };
  } catch {
    return {};
  }
});
