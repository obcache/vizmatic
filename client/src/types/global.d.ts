import type { SessionState } from './session';
import type { ProjectSchema } from 'common/project';

export interface ExportSessionRequest {
  targetPath: string;
  state: SessionState;
}

export interface ElectronAPI {
  loadSessionState(): Promise<SessionState | undefined>;
  saveSessionState(state: SessionState): Promise<void>;
  exportSession(request: ExportSessionRequest): Promise<void>;
  openAudioFile(): Promise<string | undefined>;
  openVideoFiles(): Promise<string[]>;
  openImageFile(): Promise<string | undefined>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  fileExists(path: string): Promise<boolean>;
  machineFingerprint(): Promise<string>;
  chooseProjectSavePath(defaultPath?: string): Promise<string | undefined>;
  startRender(projectJsonPath: string): Promise<void>;
  cancelRender(): Promise<void>;
  chooseRenderOutput(projectJsonPath?: string): Promise<string | undefined>;
  prepareRenderProject(projectJsonPath: string, outputPath: string): Promise<string>;
  openProject(): Promise<{ path: string; project: import('common/project').ProjectSchema } | undefined>;
  saveProject(filePath: string, project: import('common/project').ProjectSchema): Promise<void>;
  updateProjectDirty(dirty: boolean): Promise<void>;
  notifyProjectSaved(ok: boolean): void;
  getDefaultProjectPath(projectName?: string): Promise<string>;
  loadMediaLibrary(): Promise<import('common/project').MediaLibraryItem[]>;
  saveMediaLibrary(items: import('common/project').MediaLibraryItem[]): Promise<void>;
  probeMediaFile(path: string): Promise<Partial<import('common/project').MediaLibraryItem>>;
  openMediaLibraryWindow(): Promise<void>;
  addMediaLibraryItemToProject(path: string): Promise<void>;
  onMediaLibraryAddPath(listener: (path: string) => void): () => void;
  onProjectRequestSave(listener: () => void): () => void;
  onMenuAction(listener: (action: string) => void): () => void;
  setLayerMoveEnabled(payload: { up: boolean; down: boolean }): void;
  onRenderLog(listener: (line: string) => void): () => void;
  onRenderProgress(listener: (data: { outTimeMs?: number; totalMs?: number }) => void): () => void;
  onRenderDone(listener: () => void): () => void;
  onRenderError(listener: (message: string) => void): () => void;
  onRenderCancelled(listener: () => void): () => void;
  invokeMenuAction(action: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onWindowMaximized(listener: (maximized: boolean) => void): () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
