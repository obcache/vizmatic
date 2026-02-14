import type { SessionState } from '../types/session';
import type { ExportSessionRequest, ElectronAPI } from '../types/global';
import type { ProjectSchema } from 'common/project';
import type { MediaLibraryItem } from 'common/project';

const BRIDGE_MOCK_ENV_FLAGS = [
  'VITE_vizmatic_USE_ELECTRON_BRIDGE_MOCK',
  'vizmatic_USE_ELECTRON_BRIDGE_MOCK',
];

type EnvValue = string | boolean | number | undefined;
type EnvRecord = Record<string, EnvValue>;

const readFromProcessEnv = (flag: string): EnvValue => {
  const withProcess = globalThis as typeof globalThis & {
    process?: {
      env?: EnvRecord;
    };
  };

  return withProcess.process?.env?.[flag];
};

const readFromImportMeta = (flag: string): EnvValue => {
  try {
    if (typeof import.meta !== 'undefined') {
      const metaEnv = (import.meta as { env?: EnvRecord }).env;
      return metaEnv?.[flag];
    }
  } catch (_error) {
    // Accessing import.meta can throw in non-module builds; swallow and continue.
  }

  return undefined;
};

const readFromGlobal = (flag: string): EnvValue => {
  const globalValue = (globalThis as Record<string, unknown>)[flag];

  if (typeof globalValue === 'string' || typeof globalValue === 'boolean' || typeof globalValue === 'number') {
    return globalValue;
  }

  return undefined;
};

const readEnvFlag = (flag: string): EnvValue => {
  const sources: EnvValue[] = [readFromProcessEnv(flag), readFromImportMeta(flag), readFromGlobal(flag)];

  for (const value of sources) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const isTruthyFlagValue = (value: EnvValue): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }

  return false;
};

const isFlagEnabled = (flag: string): boolean => {
  const value = readEnvFlag(flag);
  return isTruthyFlagValue(value);
};

const isDevelopmentRuntime = (() => {
  const processEnvValue = readFromProcessEnv('NODE_ENV');
  if (typeof processEnvValue === 'string') {
    return processEnvValue !== 'production';
  }

  const metaEnv = readFromImportMeta('MODE');
  if (typeof metaEnv === 'string') {
    return metaEnv !== 'production';
  }

  const metaDev = readFromImportMeta('DEV');
  if (typeof metaDev === 'boolean') {
    return metaDev;
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    return hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'http:';
  }

  return false;
})();

const shouldMockBridge = isDevelopmentRuntime && BRIDGE_MOCK_ENV_FLAGS.some(isFlagEnabled);

const mockBridge: ElectronAPI = {
  async loadSessionState() {
    return undefined;
  },
  async saveSessionState() {
    // no-op
  },
  async exportSession() {
    // no-op
  },
  async openAudioFile() {
    return undefined;
  },
  async openVideoFiles() {
    return [];
  },
  async openImageFile() {
    return undefined;
  },
  async readFileBuffer() {
    return new Uint8Array();
  },
  async fileExists(_filePath: string) {
    return true;
  },
  async machineFingerprint() {
    return 'mock-machine-fingerprint';
  },
  async chooseProjectSavePath() {
    return undefined;
  },
  async startRender() {
    // no-op
  },
  async cancelRender() {
    // no-op
  },
  async chooseRenderOutput() {
    return undefined;
  },
  async prepareRenderProject(projectJsonPath: string) {
    return projectJsonPath;
  },
  async getDefaultProjectPath(projectName?: string) {
    const docs = 'C:/Users/Public/Documents';
    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const safeBase = (projectName ?? 'Project').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'Project';
    const name = `${safeBase}-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
    return `${docs}/vizmatic/Projects/${name}`;
  },
  async openProject() {
    return undefined as any;
  },
  async saveProject() {
    // no-op
  },
  async updateProjectDirty(_dirty: boolean) {
    // no-op
  },
  notifyProjectSaved(_ok: boolean) {
    // no-op
  },
  async loadMediaLibrary() {
    return [];
  },
  async saveMediaLibrary(_items) {
    // no-op
  },
  async probeMediaFile(_path: string) {
    return {};
  },
  async openMediaLibraryWindow() {
    // no-op
  },
  async addMediaLibraryItemToProject(_path: string) {
    // no-op
  },
  onProjectRequestSave(listener) {
    return () => void listener;
  },
  onMenuAction(listener) {
    return () => void listener;
  },
  onMediaLibraryAddPath(listener) {
    return () => void listener;
  },
  setLayerMoveEnabled(_payload) {
    // no-op
  },
  onRenderLog(listener) {
    // return unsubscribe no-op
    return () => void listener;
  },
  onRenderProgress(listener) {
    return () => void listener;
  },
  onRenderDone(listener) {
    return () => void listener;
  },
  onRenderError(listener) {
    return () => void listener;
  },
  onRenderCancelled(listener) {
    return () => void listener;
  },
};

let hasLoggedMockWarning = false;

const getBridge = (): ElectronAPI => {
  if (typeof window === 'undefined' || !window.electron) {
    if (shouldMockBridge) {
      if (!hasLoggedMockWarning) {
        console.warn(
          'Electron bridge is unavailable; falling back to a mock because the bridge mock flag is enabled.',
        );
        hasLoggedMockWarning = true;
      }

      return mockBridge;
    }

    throw new Error('Electron bridge is unavailable.');
  }

  return window.electron;
};

export const loadSessionState = async (): Promise<SessionState | undefined> => {
  return getBridge().loadSessionState();
};

export const saveSessionState = async (state: SessionState): Promise<void> => {
  await getBridge().saveSessionState(state);
};

export const exportSession = async (request: ExportSessionRequest): Promise<void> => {
  await getBridge().exportSession(request);
};

export const openAudioFile = async (): Promise<string | undefined> => {
  return getBridge().openAudioFile();
};

export const openVideoFiles = async (): Promise<string[]> => {
  return getBridge().openVideoFiles();
};

export const openImageFile = async (): Promise<string | undefined> => {
  return getBridge().openImageFile();
};

export const readFileBuffer = async (filePath: string): Promise<Uint8Array> => {
  const res = await getBridge().readFileBuffer(filePath);
  if (res instanceof Uint8Array) return res;
  if (ArrayBuffer.isView(res as any)) {
    const view = res as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (res && typeof (res as any).byteLength === 'number') {
    return new Uint8Array(res as ArrayBuffer);
  }
  return new Uint8Array();
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    return await getBridge().fileExists(filePath);
  } catch {
    return false;
  }
};

export const getMachineFingerprint = async (): Promise<string> => {
  try {
    return await getBridge().machineFingerprint();
  } catch {
    return '';
  }
};

export const chooseProjectSavePath = async (defaultPath?: string): Promise<string | undefined> => {
  return getBridge().chooseProjectSavePath(defaultPath);
};

export const startRender = async (projectJsonPath: string): Promise<void> => {
  return getBridge().startRender(projectJsonPath);
};

export const cancelRender = async (): Promise<void> => {
  return getBridge().cancelRender();
};

export const chooseRenderOutput = async (projectJsonPath?: string): Promise<string | undefined> => {
  return getBridge().chooseRenderOutput(projectJsonPath);
};

export const prepareRenderProject = async (projectJsonPath: string, outputPath: string): Promise<string> => {
  return getBridge().prepareRenderProject(projectJsonPath, outputPath);
};

export const onRenderLog = (listener: (line: string) => void): (() => void) => {
  return getBridge().onRenderLog(listener);
};

export const onRenderProgress = (listener: (data: { outTimeMs?: number; totalMs?: number }) => void): (() => void) => {
  return getBridge().onRenderProgress(listener);
};

export const onRenderDone = (listener: () => void): (() => void) => {
  return getBridge().onRenderDone(listener);
};

export const onRenderError = (listener: (message: string) => void): (() => void) => {
  return getBridge().onRenderError(listener);
};

export const onRenderCancelled = (listener: () => void): (() => void) => {
  return getBridge().onRenderCancelled(listener);
};

export const openProject = async (): Promise<{ path: string; project: import('common/project').ProjectSchema } | undefined> => {
  return getBridge().openProject();
};

export const updateProjectDirty = async (dirty: boolean): Promise<void> => {
  return getBridge().updateProjectDirty(dirty);
};

export const onProjectRequestSave = (listener: () => void): (() => void) => {
  return getBridge().onProjectRequestSave(listener);
};

export const onMenuAction = (listener: (action: string) => void): (() => void) => {
  return getBridge().onMenuAction(listener);
};

export const setLayerMoveEnabled = (payload: { up: boolean; down: boolean }): void => {
  return getBridge().setLayerMoveEnabled(payload);
};

export const notifyProjectSaved = (ok: boolean): void => {
  return getBridge().notifyProjectSaved(ok);
};

export const getDefaultProjectPath = async (projectName?: string): Promise<string> => {
  return getBridge().getDefaultProjectPath(projectName);
};

export const saveProject = async (filePath: string, project: ProjectSchema): Promise<void> => {
  return getBridge().saveProject(filePath, project);
};

export const loadMediaLibrary = async (): Promise<MediaLibraryItem[]> => {
  return getBridge().loadMediaLibrary();
};

export const saveMediaLibrary = async (items: MediaLibraryItem[]): Promise<void> => {
  return getBridge().saveMediaLibrary(items);
};

export const probeMediaFile = async (path: string): Promise<Partial<MediaLibraryItem>> => {
  return getBridge().probeMediaFile(path);
};

export const openMediaLibraryWindow = async (): Promise<void> => {
  return getBridge().openMediaLibraryWindow();
};

export const addMediaLibraryItemToProject = async (path: string): Promise<void> => {
  return getBridge().addMediaLibraryItemToProject(path);
};

export const onMediaLibraryAddPath = (listener: (path: string) => void): (() => void) => {
  return getBridge().onMediaLibraryAddPath(listener);
};
