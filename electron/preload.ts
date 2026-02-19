import { contextBridge, ipcRenderer } from 'electron';
import type { SessionState } from '../common/session';
import type { ProjectSchema } from '../common/project';

export interface ExportSessionRequest {
  /**
   * Absolute file path where the exported session should be written.
   */
  targetPath: string;
  /**
   * Session payload that will be persisted to the export file.
   */
  state: SessionState;
}

export interface ElectronBridge {
  loadSettings: () => Promise<Record<string, any>>;
  saveSettings: (settings: Record<string, any>) => Promise<void>;
  loadSessionState: () => Promise<SessionState | undefined>;
  saveSessionState: (state: SessionState) => Promise<void>;
  exportSession: (request: ExportSessionRequest) => Promise<void>;
  openAudioFile: () => Promise<string | undefined>;
  openVideoFiles: () => Promise<string[]>;
  openImageFile: () => Promise<string | undefined>;
  readFileBuffer: (filePath: string) => Promise<Uint8Array>;
  fileExists: (filePath: string) => Promise<boolean>;
  machineFingerprint: () => Promise<string>;
  chooseProjectSavePath: (defaultPath?: string) => Promise<string | undefined>;
  startRender: (projectJsonPath: string) => Promise<void>;
  cancelRender: () => Promise<void>;
  chooseRenderOutput: (projectJsonPath?: string) => Promise<string | undefined>;
  prepareRenderProject: (projectJsonPath: string, outputPath: string) => Promise<string>;
  openProject: () => Promise<{ path: string; project: ProjectSchema } | undefined>;
  saveProject: (filePath: string, project: ProjectSchema) => Promise<void>;
  updateProjectDirty: (dirty: boolean) => Promise<void>;
  notifyProjectSaved: (ok: boolean) => void;
  getDefaultProjectPath: (projectName?: string) => Promise<string>;
  loadMediaLibrary: () => Promise<import('../common/project').MediaLibraryItem[]>;
  saveMediaLibrary: (items: import('../common/project').MediaLibraryItem[]) => Promise<void>;
  probeMediaFile: (path: string) => Promise<Partial<import('../common/project').MediaLibraryItem>>;
  openMediaLibraryWindow: () => Promise<void>;
  addMediaLibraryItemToProject: (path: string) => Promise<void>;
  onProjectRequestSave: (listener: () => void) => () => void;
  onMenuAction: (listener: (action: string) => void) => () => void;
  onMediaLibraryAddPath: (listener: (path: string) => void) => () => void;
  setLayerMoveEnabled: (payload: { up: boolean; down: boolean }) => void;
  onRenderLog: (listener: (line: string) => void) => () => void;
  onRenderProgress: (listener: (data: { outTimeMs?: number; totalMs?: number }) => void) => () => void;
  onRenderDone: (listener: () => void) => () => void;
  onRenderError: (listener: (message: string) => void) => () => void;
  onRenderCancelled: (listener: () => void) => () => void;
  invokeMenuAction: (action: string) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximized: (listener: (maximized: boolean) => void) => () => void;
}

const bridge: ElectronBridge = {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  loadSessionState: () => ipcRenderer.invoke('session:load'),
  saveSessionState: (state) => ipcRenderer.invoke('session:save', state),
  exportSession: (request) => ipcRenderer.invoke('session:export', request),
  openAudioFile: () => ipcRenderer.invoke('audio:open'),
  openVideoFiles: () => ipcRenderer.invoke('videos:open'),
  openImageFile: () => ipcRenderer.invoke('image:open'),
  readFileBuffer: async (filePath: string) => {
    const buf: Buffer = await ipcRenderer.invoke('file:readBuffer', filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  },
  fileExists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  machineFingerprint: () => ipcRenderer.invoke('machine:fingerprint'),
  chooseProjectSavePath: (defaultPath?: string) => ipcRenderer.invoke('project:saveAs', defaultPath),
  startRender: (projectJsonPath: string) => ipcRenderer.invoke('render:start', projectJsonPath),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),
  chooseRenderOutput: (projectJsonPath?: string) => ipcRenderer.invoke('render:chooseOutput', projectJsonPath),
  prepareRenderProject: (projectJsonPath: string, outputPath: string) => ipcRenderer.invoke('render:prepareProject', projectJsonPath, outputPath),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (filePath: string, project: ProjectSchema) => ipcRenderer.invoke('project:save', filePath, project),
  updateProjectDirty: (dirty: boolean) => ipcRenderer.invoke('project:updateDirty', dirty),
  notifyProjectSaved: (ok: boolean) => { ipcRenderer.send('project:saved', ok); },
  getDefaultProjectPath: (projectName?: string) => ipcRenderer.invoke('project:defaultPath', projectName),
  loadMediaLibrary: () => ipcRenderer.invoke('mediaLibrary:load'),
  saveMediaLibrary: (items: any[]) => ipcRenderer.invoke('mediaLibrary:save', items),
  probeMediaFile: (p: string) => ipcRenderer.invoke('mediaLibrary:probe', p),
  openMediaLibraryWindow: () => ipcRenderer.invoke('mediaLibrary:openWindow'),
  addMediaLibraryItemToProject: (p: string) => ipcRenderer.invoke('mediaLibrary:addToProject', p),
  onProjectRequestSave: (listener) => {
    const channel = 'project:requestSave';
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onMenuAction: (listener) => {
    const channel = 'menu:action';
    const handler = (_e: Electron.IpcRendererEvent, action: string) => listener(action);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onMediaLibraryAddPath: (listener) => {
    const channel = 'mediaLibrary:addPath';
    const handler = (_e: Electron.IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  setLayerMoveEnabled: (payload) => {
    ipcRenderer.send('menu:setLayerMoveEnabled', payload);
  },
  onRenderLog: (listener) => {
    const channel = 'render:log';
    const handler = (_e: Electron.IpcRendererEvent, line: string) => listener(line);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onRenderProgress: (listener) => {
    const channel = 'render:progress';
    const handler = (_e: Electron.IpcRendererEvent, data: { outTimeMs?: number; totalMs?: number }) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onRenderDone: (listener) => {
    const channel = 'render:done';
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onRenderError: (listener) => {
    const channel = 'render:error';
    const handler = (_e: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onRenderCancelled: (listener) => {
    const channel = 'render:cancelled';
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  invokeMenuAction: (action) => ipcRenderer.invoke('menu:invoke', action),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximized: (listener) => {
    const channel = 'window:maximized';
    const handler = (_e: Electron.IpcRendererEvent, maximized: boolean) => listener(!!maximized);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld('electron', bridge);
