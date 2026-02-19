import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadSessionState,
  openAudioFile,
  openVideoFiles,
  openImageFile,
  readFileBuffer,
  chooseProjectSavePath,
  startRender,
  cancelRender,
  onRenderLog,
  onRenderProgress,
  onRenderDone,
  onRenderError,
  onRenderCancelled,
  openProject,
  updateProjectDirty,
  onProjectRequestSave,
  notifyProjectSaved,
  chooseRenderOutput,
  prepareRenderProject,
  getDefaultProjectPath,
  setLayerMoveEnabled,
  saveProject,
  loadMediaLibrary,
  saveMediaLibrary as persistMediaLibrary,
  probeMediaFile,
  openMediaLibraryWindow,
  onMediaLibraryAddPath,
  fileExists,
  onMenuAction,
  getMachineFingerprint,
  invokeMenuAction,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowMaximized,
} from './state/storage';
import type { SessionState } from './types/session';
// ProjectSchema usage comes via storage types; no direct import needed here.
import Waveform from './components/Waveform';
import type { WaveformHandle } from './components/Waveform';
import OverviewWaveform from './components/OverviewWaveform';
import Storyboard from './components/Storyboard';
import VolumeSlider from './components/VolumeSlider';
import MaterialIcon from './components/MaterialIcon';
import type { ProjectSchema, LayerConfig, LayerType, TextLayer } from 'common/project';
import type { MediaLibraryItem } from 'common/project';
type Theme = 'dark' | 'light' | 'auto';
type WebAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
type LicensePayload = {
  name?: string;
  email?: string;
  edition?: string;
  issuedAt?: number;
  expiresAt?: number | null;
  machineId?: string;
};
type ClipEdit = {
  timelineStart?: number;
  trimStart?: number;
  trimEnd?: number;
  duration?: number;
  fillMethod?: 'loop' | 'pingpong' | 'stretch';
  hue?: number;
  contrast?: number;
  brightness?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  invert?: boolean;
};

type LayerDraft = Partial<LayerConfig> & {
  text?: string;
  mode?: 'bar' | 'line' | 'solid' | 'dots';
  font?: string;
  fontSize?: number;
  outlineColor?: string;
  outlineWidth?: number;
  glowColor?: string;
  glowAmount?: number;
  glowOpacity?: number;
  shadowColor?: string;
  shadowDistance?: number;
  pathMode?: 'straight' | 'circular';
  freqScale?: 'lin' | 'log' | 'rlog';
  ampScale?: 'lin' | 'sqrt' | 'cbrt' | 'log';
  averaging?: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  barCount?: number;
  barWidthPct?: number;
  dotCount?: number;
  solidPointCount?: number;
  imagePath?: string;
  motionAffected?: boolean;
  direction?: number;
  speed?: number;
  sizeMin?: number;
  sizeMax?: number;
  opacityMin?: number;
  opacityMax?: number;
  audioResponsive?: boolean;
  particleCount?: number;
};

const LICENSE_PUBLIC_KEY_JWK: JsonWebKey = {
  "kty": "EC",
  "x": "lp5m6hpsccQJTvvEGm-N_NTo0K0t-NgKkB7M0fTFAJ4",
  "y": "F7TMKrQqkuZcPA__LRejbn8JbpbChchfCNdZRy9Ml5o",
  "crv": "P-256"
}
const base64UrlToUint8 = (input: string): Uint8Array => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 2 ? '==' : normalized.length % 4 === 3 ? '=' : normalized.length % 4 === 1 ? '===' : '';
  const str = atob(normalized + pad);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
};

const derToRawEcdsa = (derSig: Uint8Array, size: number): Uint8Array | null => {
  if (derSig.length < 8 || derSig[0] !== 0x30) return null;
  let offset = 2;
  if (derSig[1] & 0x80) {
    const lenBytes = derSig[1] & 0x7f;
    offset = 2 + lenBytes;
  }
  if (derSig[offset] !== 0x02) return null;
  const rLen = derSig[offset + 1];
  const rStart = offset + 2;
  const rEnd = rStart + rLen;
  if (derSig[rEnd] !== 0x02) return null;
  const sLen = derSig[rEnd + 1];
  const sStart = rEnd + 2;
  const sEnd = sStart + sLen;
  if (sEnd > derSig.length) return null;
  const r = derSig.slice(rStart, rEnd);
  const s = derSig.slice(sStart, sEnd);
  const out = new Uint8Array(size * 2);
  const rTrim = r[0] === 0x00 ? r.slice(1) : r;
  const sTrim = s[0] === 0x00 ? s.slice(1) : s;
  if (rTrim.length > size || sTrim.length > size) return null;
  out.set(rTrim, size - rTrim.length);
  out.set(sTrim, size * 2 - sTrim.length);
  return out;
};

const importLicensePublicKey = async () => {
  if (!LICENSE_PUBLIC_KEY_JWK?.x || !LICENSE_PUBLIC_KEY_JWK?.y) {
    throw new Error('License public key not configured.');
  }
  return crypto.subtle.importKey(
    'jwk',
    LICENSE_PUBLIC_KEY_JWK,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
};

const parseLicensePayload = (bytes: Uint8Array): LicensePayload | null => {
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as LicensePayload;
  } catch {
    return null;
  }
};

type Particle = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  angleOffset: number;
  speedScale: number;
};

type ParticleState = {
  particles: Particle[];
  lastTime: number;
  width: number;
  height: number;
};

type TitleMenuItem = {
  label: string;
  action?: string;
  separator?: boolean;
};

type PreviewDockMode = 'top' | 'left' | 'right' | 'bottom' | 'detached';

type LocalSession = SessionState & {
  projectName?: string;
  audioPath?: string;
  videoPaths?: string[];
  videoIds?: string[];
  clipEdits?: Record<string, ClipEdit>;
  projectSavePath?: string;
  playhead?: number;
  layers?: LayerConfig[];
  theme?: Theme;
  canvasPreset?: 'landscape' | 'portrait';
  videoNames?: Record<string, string>;
};

const UNTITLED_PROJECT_PREFIX = 'Untitled Project';
const makeUntitledProjectName = (n: number) => `${UNTITLED_PROJECT_PREFIX} (${Math.max(1, n)})`;

const defaultState: LocalSession = { projectName: makeUntitledProjectName(1), notes: '', playhead: 0, theme: 'auto', canvasPreset: 'landscape', videoNames: {}, videoIds: [], clipEdits: {} };
const FONT_FACE_OPTIONS = [
  'Segoe UI',
  'Laritza',
  'Explosion',
  'Explosion-3D',
  'Explosion-Outlined',
  'Explosion-Outlined-3D',
  'Failed',
  'Failed-3D',
  'Failed-3D-Italic',
  'Failed-Italic',
  'Esprit',
  'Essen',
  'Essen3D',
  'Essen-Bold',
  'Essen-Italic',
  'Essere',
  'Essere-Italic',
  'Rabbit',
  'Racepod',
  'Raffas',
  'Sans Sample',
  'Santa Jolly',
  'Snowman Handmade',
  'Starlight',
  'Strong Farmhouse',
  'Thicksnow',
  'Time Work',
  'Unique Quotes',
  'Vandalrush',
  'Vintage School',
  'Winter Tosca',
  'Zunka Demo',
  'Agekia',
  'Banana Amsterdam',
  'Beige',
  'Blackfang',
  'Boho Christmas',
  'Brittney Script',
  'Cheesecake',
  'Clairo Sans',
  'Creative',
  'Eighty Free',
  'Enjoy Little Things',
  'I Love Father',
  'Incredible',
  'Innerline',
  'Kilon',
  'Love Flowers',
  'Metro City',
  'Modern Future',
  'Online',
  'Android Hollow',
  'Android Italic',
  'Android Scratch',
  'Android',
  'Anita Semi Square',
  'Asenine_',
  'Asenst__',
  'Asent___',
  'Asenw___',
  'Assassin$',
  'Atiba',
  'Blowbrush',
  'Bowhouse-Black',
  'Bowhouse-Bold',
  'Bowhouse-Light',
  'Bowhouse-Regular',
  'Cerebro Autodestructivo',
  'Cerebro',
  'Fightt__',
  'Ilits',
  'Kremlin',
  'Labtsebi',
  'Labtsec_',
  'Labtsecb',
  'Labtseci',
  'Labtsecs',
  'Labtsecw',
  'OpenDyslexic-Bold',
  'OpenDyslexic-BoldItalic',
  'OpenDyslexic-Italic',
  'OpenDyslexic-Regular',
  'OpenDyslexicAlta-Bold',
  'OpenDyslexicAlta-BoldItalic',
  'OpenDyslexicAlta-Italic',
  'OpenDyslexicAlta-Regular',
  'OpenDyslexicMono-Regular',
  'Robotech Gp',
  'Tonight',
  'Werewolf',
];

const App = () => {
  const [session, setSession] = useState<LocalSession>(defaultState);
  const [, setStatus] = useState<string>('');
  const [, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [renderElapsedMs, setRenderElapsedMs] = useState<number>(0);
  const [renderTotalMs, setRenderTotalMs] = useState<number>(0);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [theme, setThemeChoice] = useState<Theme>('auto');
  const [canvasPreset, setCanvasPreset] = useState<'landscape' | 'portrait'>('landscape');
  const [overviewPeaks, setOverviewPeaks] = useState<number[]>([]);
  const [volume, setVolume] = useState<number>(0.85);
  const [previewHeight, setPreviewHeight] = useState<number>(320);
  const waveRef = useRef<WaveformHandle | null>(null);
  const [layerDialogOpen, setLayerDialogOpen] = useState<boolean>(false);
  const [layerDraft, setLayerDraft] = useState<LayerDraft>({});
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [layerDragId, setLayerDragId] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [timelineScroll, setTimelineScroll] = useState<number>(0);
  const layers = useMemo(() => session.layers ?? [], [session.layers]);
  const selectedLayer = useMemo(() => layers.find((layer) => layer.id === selectedLayerId) ?? null, [layers, selectedLayerId]);
  useEffect(() => {
    const idx = selectedLayerId ? layers.findIndex((layer) => layer.id === selectedLayerId) : -1;
    const upEnabled = idx > 0;
    const downEnabled = idx >= 0 && idx < layers.length - 1;
    try {
      setLayerMoveEnabled({ up: upEnabled, down: downEnabled });
    } catch {}
  }, [layers, selectedLayerId]);
  const hasAudio = !!session.audioPath;
  const workflowLocked = !hasAudio;
  const renderLocked = isRendering;
  const canvasSize = useMemo(() => (
    canvasPreset === 'portrait'
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 }
  ), [canvasPreset]);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewVideoElRef = useRef<HTMLVideoElement | null>(null);
  const previewResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const previewSizeRef = useRef<{ w: number; h: number; dpr: number } | null>(null);
  const previewVideoFrameRef = useRef<HTMLCanvasElement | null>(null);
  const previewVideoFrameMetaRef = useRef<{ path: string; time: number } | null>(null);
  const [previewContainerWidth, setPreviewContainerWidth] = useState<number>(0);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imagePoolRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioMotionRef = useRef<any>(null);
  const spectroAudioCtxRef = useRef<AudioContext | null>(null);
  const spectroSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const spectroAnalyserRef = useRef<AnalyserNode | null>(null);
  const spectroGainRef = useRef<GainNode | null>(null);
  const spectroLastDataRef = useRef<Uint8Array | null>(null);
  const previewBusyRef = useRef<boolean>(false);
  const previewQueuedRef = useRef<boolean>(false);
  const spectroCacheRef = useRef<HTMLCanvasElement | null>(null);
  const spectroWorkRef = useRef<HTMLCanvasElement | null>(null);
  const particleStateRef = useRef<Map<string, ParticleState>>(new Map());
  const renderStartAtRef = useRef<number | null>(null);
  const USE_AUDIO_MOTION = false;
  const [library, setLibrary] = useState<MediaLibraryItem[]>([]);
  const [untitledProjectCounter, setUntitledProjectCounter] = useState<number>(2);
  const [editingProjectName, setEditingProjectName] = useState<boolean>(false);
  const [projectNameDraft, setProjectNameDraft] = useState<string>('');
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ id: string; path: string; index: number; x: number; y: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ path: string; index: number; name: string } | null>(null);
  const [clipEditor, setClipEditor] = useState<{ id: string; path: string; index: number } | null>(null);
  const [clipEditorDraft, setClipEditorDraft] = useState<(ClipEdit & { timelineStart?: number; timelineEnd?: number }) | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    preview: true,
    audio: false,
    videos: false,
    layers: false,
    project: false,
  });
  const [openTitleMenu, setOpenTitleMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [previewDockMode, setPreviewDockMode] = useState<PreviewDockMode>(() => {
    try {
      const raw = localStorage.getItem('vizmatic:previewDockMode');
      if (raw === 'left' || raw === 'right' || raw === 'bottom' || raw === 'detached' || raw === 'top') {
        return raw;
      }
    } catch {}
    return 'top';
  });
  const titlebarRef = useRef<HTMLDivElement | null>(null);
  const detachedPreviewWindowRef = useRef<Window | null>(null);
  const detachedPreviewFrameAtRef = useRef<number>(0);
  const [licenseStatus, setLicenseStatus] = useState<{ licensed: boolean; key?: string; activatedAt?: string; name?: string; email?: string }>(() => {
    try {
      const raw = localStorage.getItem('vizmatic:license');
      if (raw) {
        const parsed = JSON.parse(raw) as { licensed?: boolean; key?: string; activatedAt?: string; name?: string; email?: string };
        return { licensed: !!parsed.licensed, key: parsed.key, activatedAt: parsed.activatedAt, name: parsed.name, email: parsed.email };
      }
    } catch {}
    return { licensed: false, key: '' };
  });
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [validatingLicense] = useState(false);
  const [activationSuccessOpen, setActivationSuccessOpen] = useState(false);
  const [activationInfoOpen, setActivationInfoOpen] = useState(false);
  const [machineId, setMachineId] = useState<string>('');
  const [machineIdModalOpen, setMachineIdModalOpen] = useState(false);
  const isLicensed = licenseStatus.licensed;
  const libraryRef = useRef<MediaLibraryItem[]>([]);
  const loadLibrary = useCallback(async () => {
    try {
      const items = await loadMediaLibrary();
      setLibrary(items);
      libraryRef.current = items;
    } catch (err) {
      console.warn('Failed to load media library', err);
    }
  }, []);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  const closeDetachedPreviewWindow = useCallback(() => {
    const pop = detachedPreviewWindowRef.current;
    detachedPreviewWindowRef.current = null;
    if (!pop || pop.closed) return;
    try { pop.close(); } catch {}
  }, []);

  const ensureDetachedPreviewWindow = useCallback((): Window | null => {
    const existing = detachedPreviewWindowRef.current;
    if (existing && !existing.closed) return existing;
    const child = window.open('', 'vizmatic-preview', 'width=1060,height=660,resizable=yes,scrollbars=no');
    if (!child) {
      setStatus('Preview pop-out blocked by browser/window policy.');
      setPreviewDockMode('top');
      return null;
    }
    detachedPreviewWindowRef.current = child;
    try {
      child.document.title = 'vizmatic - Preview';
      child.document.body.innerHTML = `
        <style>
          :root { color-scheme: dark; }
          html, body { margin:0; padding:0; width:100%; height:100%; background:#0b0f16; overflow:hidden; }
          body { display:flex; flex-direction:column; padding:2px; box-sizing:border-box; }
          .preview-titlebar {
            height: 30px;
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap: 8px;
            padding: 0 8px;
            border: 1px solid rgba(42, 47, 58, 0.95);
            border-radius: 8px;
            background: linear-gradient(180deg, rgba(20,24,32,0.96), rgba(14,18,24,0.96));
            -webkit-app-region: drag;
            user-select: none;
            margin-bottom: 4px;
          }
          .preview-titlebar__left,
          .preview-titlebar__right {
            display:flex;
            align-items:center;
            gap: 6px;
            -webkit-app-region: no-drag;
          }
          .preview-titlebar__left {
            min-width: 170px;
          }
          .preview-titlebar__title {
            font-family: Laritza, system-ui, sans-serif;
            font-size: 16px;
            color: rgba(229,231,235,0.95);
            letter-spacing: 0.5px;
            flex: 1;
            text-align: center;
            -webkit-app-region: drag;
          }
          .preview-titlebar__logo {
            width: 16px;
            height: 16px;
            object-fit: contain;
          }
          .preview-window-btn {
            height: 28px;
            min-width: 34px;
            border: 0;
            background: transparent;
            color: #e5e7eb;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            cursor:pointer;
            font: 600 12px/1 system-ui, sans-serif;
            border-radius: 4px;
          }
          .preview-window-btn:hover { background: rgba(255,255,255,0.08); }
          .preview-window-btn.is-close:hover { background: #d9534f; color: #fff; }
          .preview-window-btn.is-pill {
            border: 1px solid rgba(255,255,255,0.16);
            background: rgba(0, 0, 0, 0.35);
            backdrop-filter: blur(2px);
            min-width: 0;
            padding: 0 10px;
            font-weight: 600;
          }
          .preview-window-btn.is-pill:hover {
            background: rgba(255,255,255,0.12);
          }
          #preview-root {
            width:100%;
            height: calc(100% - 34px);
            display:flex;
            align-items:center;
            justify-content:center;
            background:#0b0f16;
            border-radius: 8px;
            overflow: hidden;
          }
          #preview-image { max-width:100%; max-height:100%; object-fit:contain; background:#0b0f16; }
          html.is-fullscreen .preview-titlebar { display:none; }
          html.is-fullscreen #preview-root { height: 100%; }
        </style>
        <div class="preview-titlebar" id="preview-titlebar">
          <div class="preview-titlebar__left">
            <img class="preview-titlebar__logo" src="${assetHref('ui/vizmatic_noText_logo.png')}" alt="" />
            <button class="preview-window-btn is-pill" id="preview-reattach" title="Re-attach">Re-attach</button>
          </div>
          <div class="preview-titlebar__title">vizmatic preview</div>
          <div class="preview-titlebar__right">
            <button class="preview-window-btn is-pill" id="preview-fullscreen" title="Toggle Fullscreen">Fullscreen</button>
            <button class="preview-window-btn is-close" id="preview-close" title="Close">X</button>
          </div>
        </div>
        <div id="preview-root">
          <img id="preview-image" alt="Preview" />
        </div>
      `;
      const attachBtn = child.document.getElementById('preview-reattach');
      attachBtn?.addEventListener('click', () => {
        setPreviewDockMode('top');
      });
      const closeBtn = child.document.getElementById('preview-close');
      closeBtn?.addEventListener('click', () => {
        try { child.close(); } catch {}
      });
      const syncFsClass = () => {
        try {
          const isFs = !!child.document.fullscreenElement;
          child.document.documentElement.classList.toggle('is-fullscreen', isFs);
        } catch {}
      };
      child.document.addEventListener('fullscreenchange', syncFsClass);
      const fsBtn = child.document.getElementById('preview-fullscreen');
      fsBtn?.addEventListener('click', async () => {
        try {
          if (child.document.fullscreenElement) {
            await child.document.exitFullscreen();
          } else {
            await child.document.documentElement.requestFullscreen();
          }
        } catch {}
      });
      child.addEventListener('beforeunload', () => {
        detachedPreviewWindowRef.current = null;
        setPreviewDockMode((mode) => (mode === 'detached' ? 'top' : mode));
      });
    } catch {}
    return child;
  }, []);

  const assetHref = (rel: string) => {
    try {
      return new URL(rel, document.baseURI).toString();
    } catch {
      return rel;
    }
  };
  const resolvedTheme = useMemo<Exclude<Theme, 'auto'>>(() => {
    if (theme === 'auto') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'dark';
    }
    return theme;
  }, [theme]);
  const PillIconButton = ({ icon, label, ...rest }: { icon: string; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button className="pill-btn" type="button" {...rest}>
      <MaterialIcon name={icon} ariaHidden />
      <span className="pill-btn__label">{label}</span>
    </button>
  );
  const makeId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch {}
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  const parseTrailingInteger = (value: string, prefix: string): number | null => {
    const re = new RegExp(`^${prefix}\\s*\\((\\d+)\\)$`, 'i');
    const hit = value.trim().match(re);
    if (!hit) return null;
    const parsed = Number(hit[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const nextClipName = useCallback((names: Record<string, string>) => {
    let maxN = 0;
    Object.values(names).forEach((name) => {
      const hit = name.trim().match(/^clip-(\d+)$/i);
      if (!hit) return;
      const parsed = Number(hit[1]);
      if (Number.isFinite(parsed)) maxN = Math.max(maxN, parsed);
    });
    return `clip-${maxN + 1}`;
  }, []);
  const getProjectName = useCallback((state?: LocalSession) => {
    const value = (state ?? session).projectName?.trim();
    return value || makeUntitledProjectName(1);
  }, [session]);
  const hexToRgba = (hex: string, alpha: number) => {
    let c = hex.trim();
    if (c.startsWith('#')) c = c.slice(1);
    if (c.length === 3) {
      c = c.split('').map((ch) => ch + ch).join('');
    }
    if (c.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const makePseudoPeaks = useCallback((key: string, buckets = 640) => {
    const peaks: number[] = [];
    let seed = 2166136261;
    for (let i = 0; i < key.length; i++) {
      seed ^= key.charCodeAt(i);
      seed += (seed << 1) + (seed << 4) + (seed << 7) + (seed << 8) + (seed << 24);
    }
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < buckets; i++) {
      const base = 0.35 + rand() * 0.45;
      // slight smoothing with neighbors
      const prev = i > 0 ? peaks[i - 1] : base;
      peaks.push((base * 0.7) + (prev * 0.3));
    }
    return peaks;
  }, []);
  
  const toFileURL = (absPath: string): string => {
    if (/^file:\/\//i.test(absPath)) return absPath;
    if (/^\\\\/.test(absPath)) {
      const withoutPrefix = absPath.replace(/^\\\\+/, '');
      const normalized = withoutPrefix.replace(/\\/g, '/');
      return 'file://' + encodeURI(normalized);
    }
    const normalized = absPath.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) {
      return 'file:///' + encodeURI(normalized);
    }
    if (normalized.startsWith('/')) {
      return 'file:///' + encodeURI(normalized);
    }
    return 'file:///' + encodeURI(normalized.startsWith('/') ? normalized.slice(1) : normalized);
  };
  
  const applyTheme = useCallback((name: Theme, resolved: Exclude<Theme, 'auto'>) => {
    try {
      localStorage.setItem('vizmatic:theme', name);
    } catch {}
    document.documentElement.setAttribute('data-theme', resolved);
  }, []);

  const layerHistoryRef = useRef<Map<string, { undo: LayerConfig[]; redo: LayerConfig[] }>>(new Map());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vizmatic:theme');
      if (saved === 'light' || saved === 'dark' || saved === 'auto') {
        setThemeChoice(saved);
        return;
      }
    } catch {}
    applyTheme('auto', resolvedTheme);
  }, [applyTheme, resolvedTheme]);

  useEffect(() => {
    applyTheme(theme, resolvedTheme);
  }, [applyTheme, resolvedTheme, theme]);

  useEffect(() => {
    try {
      localStorage.setItem('vizmatic:license', JSON.stringify(licenseStatus));
    } catch {}
  }, [licenseStatus]);

  useEffect(() => {
    if (licenseModalOpen) {
      setLicenseKeyInput(licenseStatus.key ?? '');
      setLicenseError(null);
    }
  }, [licenseModalOpen, licenseStatus.key]);

  useEffect(() => {
    if (!licenseModalOpen) return;
    void getMachineFingerprint().then((id: string) => {
      if (typeof id === 'string') setMachineId(id);
    }).catch(() => {});
  }, [licenseModalOpen]);

  useEffect(() => {
    if (!activationInfoOpen) return;
    void getMachineFingerprint().then((id: string) => {
      if (typeof id === 'string') setMachineId(id);
    }).catch(() => {});
  }, [activationInfoOpen]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // Check missing media (audio, videos, library) when paths change
  useEffect(() => {
    const checkMissing = async () => {
      const targets = new Set<string>();
      if (session.audioPath) targets.add(session.audioPath);
      (session.videoPaths ?? []).forEach((p) => targets.add(p));
      library.forEach((item) => targets.add(item.path));
      const results = await Promise.all(
        Array.from(targets).map(async (p) => ({ p, ok: await fileExists(p) }))
      );
      const missing = results.filter((r) => !r.ok).map((r) => r.p);
      setMissingPaths(new Set(missing));
    };
    void checkMissing();
  }, [session.audioPath, session.videoPaths, library]);

  // Sync theme from session load
  useEffect(() => {
    if (session.theme === 'light' || session.theme === 'dark' || session.theme === 'auto') {
      setThemeChoice(session.theme);
    }
  }, [session.theme]);

  // Sync canvas preset from session load
  useEffect(() => {
    if (session.canvasPreset === 'portrait' || session.canvasPreset === 'landscape') {
      setCanvasPreset(session.canvasPreset);
    }
  }, [session.canvasPreset]);

  // Persist theme into session for project-level saves
  useEffect(() => {
    setSession((prev) => (prev.theme === theme ? prev : { ...prev, theme }));
  }, [theme]);

  useEffect(() => {
    if (theme !== 'auto' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeChoice('auto');
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [theme]);

  // Persist canvas preset into session for project-level saves
  useEffect(() => {
    setSession((prev) => (prev.canvasPreset === canvasPreset ? prev : { ...prev, canvasPreset }));
  }, [canvasPreset]);

  // Auto-expand preview when media or layers are present
  useEffect(() => {
    const hasMedia = (session.videoPaths?.length ?? 0) > 0 || (session.layers?.length ?? 0) > 0;
    if (hasMedia) {
      setCollapsed((prev) => (prev.preview ? { ...prev, preview: false } : prev));
    }
  }, [session.videoPaths, session.layers]);

  useEffect(() => {
    // Reset zoom/scroll when audio loads
    if (audioDuration > 0) {
      setTimelineZoom(1);
      setTimelineScroll(0);
    }
  }, [audioDuration]);

  const startNewLayer = (type: LayerType) => {
    if (!hasAudio) {
      setStatus('Load audio before adding layers.');
      return;
    }
    const baseWidth = canvasSize.width;
    const newId = makeId();
    const draft: LayerDraft = {
      id: newId,
      type,
      color: '#ffffff',
      x: 0.05,
      y: 0.05,
      rotate: 0,
      opacity: 1,
      reverse: false,
      width: type === 'image' ? 320 : baseWidth,
      height: type === 'image' ? 320 : Math.round(baseWidth * (canvasSize.height / canvasSize.width)),
      lowCutHz: 40,
      highCutHz: 16000,
      mode: type === 'spectrograph' ? 'bar' : undefined,
      invert: type === 'spectrograph' ? false : undefined,
      barCount: type === 'spectrograph' ? 96 : undefined,
      barWidthPct: type === 'spectrograph' ? 0.8 : undefined,
      dotCount: type === 'spectrograph' ? 96 : undefined,
      solidPointCount: type === 'spectrograph' ? 96 : undefined,
      pathMode: type === 'spectrograph' ? 'straight' : undefined,
      freqScale: type === 'spectrograph' ? 'log' : undefined,
      ampScale: type === 'spectrograph' ? 'log' : undefined,
      averaging: type === 'spectrograph' ? 2 : undefined,
      mirrorX: type === 'spectrograph' ? false : undefined,
      mirrorY: type === 'spectrograph' ? false : undefined,
      imagePath: type === 'image' ? '' : undefined,
      motionAffected: type === 'image' ? true : undefined,
      direction: type === 'particles' ? 0 : undefined,
      speed: type === 'particles' ? 60 : undefined,
      sizeMin: type === 'particles' ? 2 : undefined,
      sizeMax: type === 'particles' ? 6 : undefined,
      opacityMin: type === 'particles' ? 0.3 : undefined,
      opacityMax: type === 'particles' ? 0.9 : undefined,
      audioResponsive: type === 'particles' ? true : undefined,
      particleCount: type === 'particles' ? 200 : undefined,
      text: type === 'text' ? 'Text' : undefined,
      font: type === 'text' ? 'Segoe UI' : undefined,
      fontSize: type === 'text' ? 12 : undefined,
    };
    const normalized = normalizeLayerDraft(draft);
    if (normalized) {
      setSession((prev) => ({ ...prev, layers: [...(prev.layers ?? []), normalized] }));
      void updateProjectDirty(true);
    }
    layerHistoryRef.current.set(newId, { undo: [], redo: [] });
    setLayerDraft(draft);
    setSelectedLayerId(newId);
    setLayerDialogOpen(true);
  };

  const openEditLayer = (layer: LayerConfig) => {
    layerHistoryRef.current.set(layer.id, { undo: [], redo: [] });
    setLayerDraft({ ...layer });
    setSelectedLayerId(layer.id);
    setLayerDialogOpen(true);
  };

  const normalizeLayerDraft = (draft: Partial<LayerConfig>): LayerConfig | null => {
    if (!draft.type || !draft.id) return null;
    const normalized: LayerConfig = { ...(draft as LayerConfig) };
    if (normalized.type === 'spectrograph') {
      normalized.mode = normalized.mode === 'line' || normalized.mode === 'solid' || normalized.mode === 'dots' ? normalized.mode : 'bar';
      if (!normalized.width || !normalized.height) {
        const w = canvasSize.width;
        normalized.width = w;
        normalized.height = Math.round(w * (canvasSize.height / canvasSize.width));
      }
      normalized.opacity = Number.isFinite(normalized.opacity as number) ? normalized.opacity : 1;
      normalized.rotate = Number.isFinite(normalized.rotate as number) ? normalized.rotate : 0;
      normalized.reverse = !!normalized.reverse;
      normalized.invert = !!normalized.invert;
      normalized.barCount = Number.isFinite(normalized.barCount as number) ? Math.max(8, Number(normalized.barCount)) : 96;
      normalized.barWidthPct = Number.isFinite(normalized.barWidthPct as number) ? Math.min(1, Math.max(0.1, Number(normalized.barWidthPct))) : 0.8;
      normalized.dotCount = Number.isFinite(normalized.dotCount as number) ? Math.max(8, Number(normalized.dotCount)) : 96;
      normalized.solidPointCount = Number.isFinite(normalized.solidPointCount as number) ? Math.max(8, Number(normalized.solidPointCount)) : 96;
      normalized.pathMode = normalized.pathMode === 'circular' ? 'circular' : 'straight';
      normalized.freqScale = normalized.freqScale === 'rlog' ? 'rlog' : normalized.freqScale === 'lin' ? 'lin' : 'log';
      normalized.ampScale = normalized.ampScale === 'sqrt' || normalized.ampScale === 'cbrt' || normalized.ampScale === 'lin' ? normalized.ampScale : 'log';
      normalized.averaging = Number.isFinite(normalized.averaging as number) ? Math.max(1, Math.round(Number(normalized.averaging))) : 2;
      normalized.mirrorX = !!normalized.mirrorX;
      normalized.mirrorY = !!normalized.mirrorY;
      normalized.lowCutHz = Number.isFinite(normalized.lowCutHz as number) ? normalized.lowCutHz : 40;
      normalized.highCutHz = Number.isFinite(normalized.highCutHz as number) ? normalized.highCutHz : 16000;
    } else if (normalized.type === 'image') {
      normalized.imagePath = normalized.imagePath ?? '';
      normalized.opacity = Number.isFinite(normalized.opacity as number) ? normalized.opacity : 1;
      normalized.rotate = Number.isFinite(normalized.rotate as number) ? normalized.rotate : 0;
      normalized.reverse = !!normalized.reverse;
      normalized.invert = !!normalized.invert;
      normalized.width = Number.isFinite(normalized.width as number) ? Math.max(20, Number(normalized.width)) : 320;
      normalized.height = Number.isFinite(normalized.height as number) ? Math.max(20, Number(normalized.height)) : 320;
      normalized.outlineWidth = Number.isFinite(normalized.outlineWidth as number) ? Math.max(0, Number(normalized.outlineWidth)) : 0;
      normalized.glowAmount = Number.isFinite(normalized.glowAmount as number) ? Math.max(0, Number(normalized.glowAmount)) : 0;
      normalized.glowOpacity = Number.isFinite(normalized.glowOpacity as number) ? Math.min(1, Math.max(0, Number(normalized.glowOpacity))) : 0.4;
      normalized.shadowDistance = Number.isFinite(normalized.shadowDistance as number) ? Math.max(0, Number(normalized.shadowDistance)) : 0;
      normalized.motionAffected = typeof normalized.motionAffected === 'boolean' ? normalized.motionAffected : true;
    } else if (normalized.type === 'particles') {
      normalized.opacity = Number.isFinite(normalized.opacity as number) ? normalized.opacity : 1;
      normalized.rotate = Number.isFinite(normalized.rotate as number) ? normalized.rotate : 0;
      normalized.reverse = !!normalized.reverse;
      normalized.direction = Number.isFinite(normalized.direction as number) ? Number(normalized.direction) : 0;
      normalized.speed = Number.isFinite(normalized.speed as number) ? Math.max(0, Number(normalized.speed)) : 60;
      normalized.sizeMin = Number.isFinite(normalized.sizeMin as number) ? Math.max(1, Number(normalized.sizeMin)) : 2;
      normalized.sizeMax = Number.isFinite(normalized.sizeMax as number) ? Math.max(normalized.sizeMin ?? 2, Number(normalized.sizeMax)) : 6;
      normalized.opacityMin = Number.isFinite(normalized.opacityMin as number) ? Math.min(1, Math.max(0, Number(normalized.opacityMin))) : 0.3;
      normalized.opacityMax = Number.isFinite(normalized.opacityMax as number) ? Math.min(1, Math.max(normalized.opacityMin ?? 0.3, Number(normalized.opacityMax))) : 0.9;
      normalized.audioResponsive = typeof normalized.audioResponsive === 'boolean' ? normalized.audioResponsive : true;
      normalized.particleCount = Number.isFinite(normalized.particleCount as number) ? Math.max(10, Number(normalized.particleCount)) : 200;
    } else if (normalized.type === 'text') {
      normalized.text = normalized.text ?? 'Text';
      normalized.font = normalized.font ?? 'Segoe UI';
      normalized.fontSize = Number(normalized.fontSize ?? 12);
      normalized.opacity = Number.isFinite(normalized.opacity as number) ? normalized.opacity : 1;
      normalized.rotate = Number.isFinite(normalized.rotate as number) ? normalized.rotate : 0;
      normalized.reverse = !!normalized.reverse;
    }
    return normalized;
  };

  const updateLayerDraftField = (partial: Partial<LayerConfig>) => {
    setLayerDraft((prev) => {
      const next = { ...prev, ...partial };
      const prevNormalized = normalizeLayerDraft(prev);
      if (prevNormalized) {
        const history = layerHistoryRef.current.get(prevNormalized.id) ?? { undo: [], redo: [] };
        history.undo.push(prevNormalized);
        history.redo = [];
        layerHistoryRef.current.set(prevNormalized.id, history);
      }
      const normalized = normalizeLayerDraft(next);
      if (normalized) {
        const nextFont = (partial as Partial<TextLayer>).font;
        setSession((prevSession) => {
          const existing = prevSession.layers ?? [];
          const idx = existing.findIndex((l) => l.id === normalized.id);
          const newLayers = existing.slice();
          if (idx >= 0) newLayers[idx] = normalized;
          else newLayers.push(normalized);
          return { ...prevSession, layers: newLayers };
        });
        void updateProjectDirty(true);
        void renderPreviewFrame();
        if (normalized.type === 'text' && nextFont && typeof document !== 'undefined' && (document as any).fonts?.load) {
          void (document as any).fonts.load(`12px "${nextFont}"`).then(() => {
            void renderPreviewFrame();
          }).catch(() => {});
        }
      }
      return next;
    });
  };

  const closeLayerDialog = () => {
    setLayerDialogOpen(false);
  };

  const undoLayerDraft = () => {
    const current = normalizeLayerDraft(layerDraft);
    if (!current) return;
    const history = layerHistoryRef.current.get(current.id);
    if (!history || history.undo.length === 0) return;
    const prev = history.undo.pop()!;
    history.redo.push(current);
    layerHistoryRef.current.set(current.id, history);
    setLayerDraft(prev);
    setSession((prevSession) => {
      const existing = prevSession.layers ?? [];
      const idx = existing.findIndex((l) => l.id === prev.id);
      const next = existing.slice();
      if (idx >= 0) next[idx] = prev;
      return { ...prevSession, layers: next };
    });
    void updateProjectDirty(true);
    void renderPreviewFrame();
  };

  const redoLayerDraft = () => {
    const current = normalizeLayerDraft(layerDraft);
    if (!current) return;
    const history = layerHistoryRef.current.get(current.id);
    if (!history || history.redo.length === 0) return;
    const next = history.redo.pop()!;
    history.undo.push(current);
    layerHistoryRef.current.set(current.id, history);
    setLayerDraft(next);
    setSession((prevSession) => {
      const existing = prevSession.layers ?? [];
      const idx = existing.findIndex((l) => l.id === next.id);
      const nextLayers = existing.slice();
      if (idx >= 0) nextLayers[idx] = next;
      return { ...prevSession, layers: nextLayers };
    });
    void updateProjectDirty(true);
    void renderPreviewFrame();
  };

  const deleteLayer = (id: string) => {
    setSession((prev) => ({ ...prev, layers: (prev.layers ?? []).filter((l) => l.id !== id) }));
    if (selectedLayerId === id) {
      setSelectedLayerId(null);
      setLayerDialogOpen(false);
      setLayerDraft({});
    }
    void updateProjectDirty(true);
  };

  const duplicateLayer = (layer: LayerConfig) => {
    const next = { ...layer, id: makeId(), x: Math.min(1, (layer.x ?? 0) + 0.02), y: Math.min(1, (layer.y ?? 0) + 0.02) };
    setSession((prev) => ({ ...prev, layers: [...(prev.layers ?? []), next] }));
    void updateProjectDirty(true);
  };

  const saveLibrary = async (items: MediaLibraryItem[]) => {
    console.info('[library] saveLibrary', { count: items.length });
    setLibrary(items);
    libraryRef.current = items;
    try {
      await persistMediaLibrary(items);
      console.info('[library] persisted to disk');
    } catch (err) {
      console.warn('Failed to save media library', err);
    }
  };

  const updateLibraryName = async (path: string, nextName: string) => {
    const next = library.map((i) => (i.path === path ? { ...i, name: nextName } : i));
    setLibrary(next);
    await saveLibrary(next);
  };

  const addLibraryEntryFromPath = async (filePath: string, name: string) => {
    console.info('[library] addLibraryEntryFromPath', filePath);
    const existing = libraryRef.current.find((item) => item.path === filePath);
    if (existing) return existing;
    let meta: Partial<MediaLibraryItem> = {};
    try {
      meta = await probeMediaFile(filePath);
    } catch (err) {
      console.warn('Probe failed; adding without metadata', err);
    }
    const item: MediaLibraryItem = {
      id: makeId(),
      name: name.trim(),
      path: filePath,
      description: '',
      duration: meta.duration ? Number(meta.duration) : undefined,
      videoCodec: meta.videoCodec,
      audioCodec: meta.audioCodec,
      audioChannels: meta.audioChannels ? Number(meta.audioChannels) : undefined,
      width: meta.width ? Number(meta.width) : undefined,
      height: meta.height ? Number(meta.height) : undefined,
    };
    await saveLibrary([...libraryRef.current, item]);
    console.info('[library] added item', item);
    return item;
  };

  // Manage hidden video elements for preview
  useEffect(() => {
    const pool = videoPoolRef.current;
    const keep = new Set(session.videoPaths ?? []);
    // remove stale
    for (const key of Array.from(pool.keys())) {
      if (!keep.has(key)) {
        const vid = pool.get(key)!;
        vid.pause();
        pool.delete(key);
      }
    }
    // add new
    for (const p of keep) {
      if (!pool.has(p)) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.crossOrigin = 'anonymous';
        v.src = toFileURL(p);
        pool.set(p, v);
      }
    }
  }, [session.videoPaths]);

  useEffect(() => {
    const pool = imagePoolRef.current;
    const imagePaths = new Set(
      (session.layers ?? [])
        .filter((layer) => layer.type === 'image')
        .map((layer) => (layer as any).imagePath)
        .filter(Boolean)
    );
    for (const key of Array.from(pool.keys())) {
      if (!imagePaths.has(key)) {
        pool.delete(key);
      }
    }
    for (const p of imagePaths) {
      if (!pool.has(p)) {
        const img = new Image();
        img.src = toFileURL(p);
        pool.set(p, img);
      }
    }
  }, [session.layers]);

  const handleMenuAction = useCallback((action: string) => {
    switch (action) {
      case 'project:new':
        handleNewProject();
        break;
      case 'project:open':
        void handleLoadProject();
        break;
      case 'project:save':
        void handleSaveProject();
        break;
      case 'project:saveAs':
        void handleSaveProjectAs();
        break;
      case 'preferences:advanced':
        void invokeMenuAction('preferences:advanced');
        break;
      case 'render:start':
        void handleStartRender();
        break;
      case 'render:cancel':
        void cancelRender();
        break;
      case 'render:clearLogs':
        setLogs([]);
        setRenderElapsedMs(0);
        setRenderTotalMs(0);
        break;
      case 'media:loadAudio':
        void handleBrowseAudio();
        break;
      case 'media:addVideos':
        void handleBrowseVideos();
        break;
      case 'media:addFromLibrary':
      case 'media:openLibrary':
        void openMediaLibraryWindow();
        break;
      case 'layer:addSpectrograph':
        startNewLayer('spectrograph');
        break;
      case 'layer:addText':
        startNewLayer('text');
        break;
      case 'layer:moveUp':
        if (selectedLayerId) moveLayerBy(selectedLayerId, -1);
        break;
      case 'layer:moveDown':
        if (selectedLayerId) moveLayerBy(selectedLayerId, 1);
        break;
      case 'view:toggleDevTools':
      case 'view:refresh':
      case 'view:toggleFullscreen':
        void invokeMenuAction(action);
        break;
      case 'view:zoomIn':
        setTimelineZoom((z) => Math.min(8, z * 2));
        setTimelineScroll(0);
        break;
      case 'view:zoomOut':
        setTimelineZoom((z) => Math.max(0.25, z / 2));
        setTimelineScroll(0);
        break;
      case 'view:zoomFit':
        setTimelineZoom(1);
        setTimelineScroll(0);
        break;
      case 'view:toggleLogs':
        break;
      case 'view:theme:dark':
        setThemeChoice('dark');
        break;
      case 'view:theme:light':
        setThemeChoice('light');
        break;
      case 'view:theme:auto':
        setThemeChoice('auto');
        break;
      case 'help:about':
        setStatus('vizmatic - music visualizer generator');
        break;
      case 'help:activation':
        setActivationInfoOpen(true);
        break;
      case 'help:unlicense':
        handleUnlicense();
        break;
      case 'dock:left':
        setPreviewDockMode('left');
        closeDetachedPreviewWindow();
        break;
      case 'dock:top':
        setPreviewDockMode('top');
        closeDetachedPreviewWindow();
        break;
      case 'dock:right':
        setPreviewDockMode('right');
        closeDetachedPreviewWindow();
        break;
      case 'dock:bottom':
        setPreviewDockMode('bottom');
        closeDetachedPreviewWindow();
        break;
      case 'dock:detach':
        setPreviewDockMode('detached');
        void ensureDetachedPreviewWindow();
        break;
      default:
        break;
    }
  }, [closeDetachedPreviewWindow, ensureDetachedPreviewWindow, selectedLayerId]);


  useEffect(() => {
    // Load session
    let cancelled = false;
    loadSessionState()
      .then((state) => {
        if (!cancelled && state) {
          const loaded = state as LocalSession;
          const nextProjectName = (loaded.projectName ?? '').trim() || makeUntitledProjectName(1);
          setSession({ ...defaultState, ...loaded, projectName: nextProjectName, playhead: 0 });
          const untitledN = parseTrailingInteger(nextProjectName, UNTITLED_PROJECT_PREFIX);
          if (untitledN != null) setUntitledProjectCounter((n) => Math.max(n, untitledN + 1));
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

    // Wire render event listeners
    const offLog = onRenderLog((line) => setLogs((prev) => [...prev, line]));
    const offProgress = onRenderProgress(({ outTimeMs, totalMs }) => {
      if (typeof outTimeMs === 'number') setRenderElapsedMs(outTimeMs);
      if (typeof totalMs === 'number') setRenderTotalMs(totalMs);
    });
    const offDone = onRenderDone(() => {
      setIsRendering(false);
      renderStartAtRef.current = null;
      setStatus('Render completed');
    });
    const offErr = onRenderError((msg) => {
      setIsRendering(false);
      renderStartAtRef.current = null;
      setError(msg);
    });
    const offCancelled = onRenderCancelled(() => {
      setIsRendering(false);
      renderStartAtRef.current = null;
      setStatus('Render cancelled');
    });

    // Handle external save requests (e.g., Ctrl+S from host)
    const offReqSave = onProjectRequestSave(() => {
      void handleSaveProject();
    });
    const offMenu = onMenuAction((action: string) => {
      handleMenuAction(action);
    });
    const offLibAdd = onMediaLibraryAddPath((path: string) => {
      if (!path) return;
      addVideoPaths([path]);
    });

    // Cleanup only (not JSX)
    return () => {
      cancelled = true;
      offLog?.();
      offProgress?.();
      offDone?.();
      offErr?.();
      offCancelled?.();
      offReqSave?.();
      offMenu?.();
      offLibAdd?.();
    };
  }, [handleMenuAction]);

  useEffect(() => {
    let alive = true;
    isWindowMaximized()
      .then((maximized) => {
        if (alive) setIsMaximized(!!maximized);
      })
      .catch(() => {});
    const offMax = onWindowMaximized((maximized) => setIsMaximized(!!maximized));
    const onDocMouseDown = (event: MouseEvent) => {
      const root = titlebarRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setOpenTitleMenu(null);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTitleMenu(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      alive = false;
      offMax?.();
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, []);

  useEffect(() => {
    if (previewDockMode === 'detached') {
      void ensureDetachedPreviewWindow();
      return;
    }
    closeDetachedPreviewWindow();
  }, [closeDetachedPreviewWindow, ensureDetachedPreviewWindow, previewDockMode]);

  useEffect(() => {
    return () => {
      closeDetachedPreviewWindow();
    };
  }, [closeDetachedPreviewWindow]);

  useEffect(() => {
    try {
      localStorage.setItem('vizmatic:previewDockMode', previewDockMode);
    } catch {}
  }, [previewDockMode]);

  const handleBrowseAudio = async () => {
    try {
      const path = await openAudioFile();
      if (path) {
        setSession((prev) => ({ ...prev, audioPath: path, playhead: 0 }));
        setAudioDuration(0);
        setStatus('Audio selected');
        void updateProjectDirty(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleBrowseVideos = async () => {
    try {
      if (!hasAudio) {
        setStatus('Load audio before adding video segments.');
        return;
      }
      const paths = await openVideoFiles();
      if (!paths || paths.length === 0) return;
      let assignedNames: Record<string, string> = {};
      setSession((prev) => {
        const existing = prev.videoPaths ?? [];
        const existingIds = prev.videoIds ?? [];
        const nextNames = { ...(prev.videoNames ?? {}) };
        const nextIds = [...existingIds];
        paths.forEach((p) => {
          nextIds.push(makeId());
          if (!nextNames[p]) nextNames[p] = nextClipName(nextNames);
        });
        assignedNames = { ...nextNames };
        return { ...prev, videoPaths: [...existing, ...paths], videoIds: nextIds, videoNames: nextNames };
      });
      for (const p of paths) {
        const name = assignedNames[p] ?? (p.split(/[\\/]/).pop() || 'clip');
        void addLibraryEntryFromPath(p, name);
      }
      setStatus(`${paths.length} video file(s) added`);
      void updateProjectDirty(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addVideoPaths = (paths: string[], allowWithoutAudio = false) => {
    if (!paths.length) return;
    if (!hasAudio && !allowWithoutAudio) {
      setStatus('Load audio before adding video segments.');
      return;
    }
    let assignedNames: Record<string, string> = {};
    setSession((prev) => {
      const existing = prev.videoPaths ?? [];
      const existingIds = prev.videoIds ?? [];
      const nextNames = { ...(prev.videoNames ?? {}) };
      const nextIds = [...existingIds];
      paths.forEach((p) => {
        nextIds.push(makeId());
        if (!nextNames[p]) nextNames[p] = nextClipName(nextNames);
      });
      assignedNames = { ...nextNames };
      return { ...prev, videoPaths: [...existing, ...paths], videoIds: nextIds, videoNames: nextNames };
    });
    for (const p of paths) {
      const name = assignedNames[p] ?? (p.split(/[\\/]/).pop() || 'clip');
      void addLibraryEntryFromPath(p, name);
    }
    setStatus(`${paths.length} video file(s) added`);
    void updateProjectDirty(true);
  };

  const formatClock = (seconds: number) => {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const promptNumeric = (label: string, value: number, min: number | null, max: number | null, onApply: (next: number) => void) => {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return;
    const res = window.prompt(`Enter ${label}`, String(value));
    if (res == null) return;
    const parsed = Number(res);
    if (!Number.isFinite(parsed)) return;
    let next = parsed;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onApply(next);
  };


  const extractDroppedFiles = (dataTransfer: DataTransfer) => {
    const files = dataTransfer.files && dataTransfer.files.length ? Array.from(dataTransfer.files) : [];
    if (files.length > 0) return files;
    if (dataTransfer.items && dataTransfer.items.length) {
      const items = Array.from(dataTransfer.items);
      return items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((item): item is File => !!item);
    }
    return [];
  };

  const handleDroppedMedia = (dataTransfer: DataTransfer) => {
    const files = extractDroppedFiles(dataTransfer);
    if (files.length === 0) {
      setStatus('Drop a supported audio or video file.');
      return;
    }
    if (files.length > 1) {
      setStatus('Only one file can be dropped at a time.');
      return;
    }
    const audioExts = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg']);
    const videoExts = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.wmv']);
    const audioPaths: string[] = [];
    const videoPaths: string[] = [];
    Array.from(files).forEach((file) => {
      const path = (file as any).path as string | undefined;
      if (!path) {
        setStatus('Dropped file path not available.');
        return;
      }
      const lower = path.toLowerCase();
      const dot = lower.lastIndexOf('.');
      const ext = dot >= 0 ? lower.slice(dot) : '';
      if (audioExts.has(ext)) audioPaths.push(path);
      else if (videoExts.has(ext)) videoPaths.push(path);
    });
    if (audioPaths.length > 0) {
      if (audioPaths.length > 1) {
        setStatus('Only one audio file can be dropped at a time.');
        return;
      }
      const audioPath = audioPaths[0];
      setSession((prev) => ({ ...prev, audioPath, playhead: 0 }));
      setAudioDuration(0);
      setStatus('Audio selected');
      void updateProjectDirty(true);
    }
    if (videoPaths.length > 0) {
      addVideoPaths(videoPaths, audioPaths.length > 0);
    } else if (audioPaths.length === 0) {
      setStatus('Unsupported file type dropped.');
    }
  };

  const extractLicenseToken = (key: string) => {
    const trimmed = key.trim();
    const match = trimmed.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    return match ? match[0] : '';
  };

  const ensureLicensed = useCallback(() => {
    if (isLicensed) return true;
    setLicenseModalOpen(true);
    setLicenseError(null);
    setStatus('Trial: upgrade to unlock project actions');
    return false;
  }, [isLicensed]);

  const handleValidateLicense = async () => {
    const trimmed = extractLicenseToken(licenseKeyInput);
    if (!trimmed) {
      setLicenseError('Invalid license format.');
      return;
    }
    const [payloadB64, sigB64] = trimmed.split('.');
    if (!payloadB64 || !sigB64) {
      setLicenseError('Invalid license format.');
      return;
    }
    try {
      const payloadBytes = base64UrlToUint8(payloadB64);
      const payloadView = new Uint8Array(payloadBytes);
      const payload = parseLicensePayload(payloadView);
      if (!payload) {
        setLicenseError('License payload is invalid.');
        return;
      }
      const publicKey = await importLicensePublicKey();
      const signatureDer = base64UrlToUint8(sigB64);
      const signatureRaw = signatureDer.length === 64 ? signatureDer : derToRawEcdsa(signatureDer, 32);
      if (!signatureRaw) {
        setLicenseError('Invalid license signature.');
        return;
      }
      const signatureBytes = new Uint8Array(signatureRaw);
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        signatureBytes,
        payloadView,
      );
      if (!ok) {
        setLicenseError('License signature failed verification.');
        return;
      }
      const machineId = (await getMachineFingerprint()).trim();
      const payloadMachine = String(payload.machineId ?? '').trim();
      if (!payloadMachine || payloadMachine.toLowerCase() !== machineId.toLowerCase()) {
        setLicenseError('License does not match this machine.');
        return;
      }
      if (payload.expiresAt && Date.now() > payload.expiresAt) {
        setLicenseError('License has expired.');
        return;
      }
      const activatedAt = payload.issuedAt ? new Date(payload.issuedAt).toISOString() : new Date().toISOString();
      setLicenseStatus({
        licensed: true,
        key: trimmed,
        activatedAt,
        name: payload.name,
        email: payload.email,
      });
      setLicenseError(null);
      setLicenseModalOpen(false);
      setActivationSuccessOpen(true);
      setStatus('License activated');
    } catch (err: unknown) {
      setLicenseError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUnlicense = () => {
    try {
      localStorage.removeItem('vizmatic:license');
    } catch {}
    setLicenseStatus({ licensed: false, key: '' });
    setStatus('License cleared');
  };

  const handleNewProject = () => {
    const nextUntitled = makeUntitledProjectName(untitledProjectCounter);
    setSession((prev) => ({
      ...defaultState,
      projectName: nextUntitled,
      theme: prev.theme ?? 'dark',
      canvasPreset: prev.canvasPreset ?? 'landscape',
    }));
    setUntitledProjectCounter((n) => n + 1);
    setEditingProjectName(false);
    setProjectNameDraft('');
    setSelectedLayerId(null);
    setLayerDialogOpen(false);
    setOverviewPeaks([]);
    setAudioDuration(0);
    setLogs([]);
    setRenderElapsedMs(0);
    setRenderTotalMs(0);
    setStatus('New project created');
    void updateProjectDirty(true);
  };

  const toggleSection = (key: keyof typeof collapsed) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const beginProjectRename = useCallback(() => {
    setProjectNameDraft(getProjectName());
    setEditingProjectName(true);
  }, [getProjectName]);
  const applyProjectRename = useCallback(() => {
    const nextName = projectNameDraft.trim() || getProjectName();
    setSession((prev) => ({ ...prev, projectName: nextName }));
    const untitledN = parseTrailingInteger(nextName, UNTITLED_PROJECT_PREFIX);
    if (untitledN != null) setUntitledProjectCounter((n) => Math.max(n, untitledN + 1));
    setEditingProjectName(false);
    void updateProjectDirty(true);
  }, [getProjectName, projectNameDraft]);
  const cancelProjectRename = useCallback(() => {
    setProjectNameDraft('');
    setEditingProjectName(false);
  }, []);

  const getClipLabel = useCallback((path: string) => {
    const names = session.videoNames ?? {};
    if (names[path]) return names[path];
    const hit = library.find((i) => i.path === path);
    if (hit?.name) return hit.name;
    return path.split(/[\\/]/).pop() || path;
  }, [library, session.videoNames]);

  const clipNames = useMemo(() => {
    const map: Record<string, string> = {};
    (session.videoPaths ?? []).forEach((p) => { map[p] = getClipLabel(p); });
    return map;
  }, [session.videoPaths, getClipLabel]);
  const clipEdits = useMemo(() => session.clipEdits ?? {}, [session.clipEdits]);
  const clipSegments = useMemo(() => {
    const paths = session.videoPaths ?? [];
    const ids = session.videoIds ?? [];
    const audioLimit = audioDuration > 0 ? audioDuration : null;
    let cursor = 0;
    return paths.map((path, index) => {
      const id = ids[index] || `${index}:${path}`;
      const edit = clipEdits[id] ?? {};
      const fillMethod = (edit.fillMethod as ClipEdit['fillMethod']) ?? 'loop';
      const sourceDuration = videoDurations[path] ?? 0;
      const trimStart = Math.max(0, Number(edit.trimStart ?? 0));
      const trimEnd = Number.isFinite(edit.trimEnd as number)
        ? Math.max(trimStart, Number(edit.trimEnd))
        : (sourceDuration > 0 ? sourceDuration : trimStart);
      const trimmedLength = Math.max(0.05, trimEnd - trimStart);
      const duration = Number.isFinite(edit.duration as number)
        ? Math.max(0.05, Number(edit.duration))
        : trimmedLength;
      const startOverride = Number.isFinite(edit.timelineStart as number)
        ? Math.max(0, Number(edit.timelineStart))
        : null;
      let start = startOverride === null ? cursor : Math.max(cursor, startOverride);
      let clampedDuration = duration;
      if (audioLimit !== null) {
        if (start >= audioLimit) {
          start = audioLimit;
          clampedDuration = 0;
        } else {
          const remaining = Math.max(0, audioLimit - start);
          clampedDuration = Math.min(duration, remaining);
        }
      }
      const end = start + clampedDuration;
      cursor = audioLimit !== null ? Math.min(audioLimit, end) : Math.max(cursor, end);
      return {
        id,
        path,
        index,
        start,
        end,
        duration: clampedDuration,
        trimStart,
        trimEnd,
        sourceDuration,
        fillMethod,
        hue: edit.hue,
        contrast: edit.contrast,
        brightness: edit.brightness,
        rotate: edit.rotate,
        flipH: edit.flipH,
        flipV: edit.flipV,
        invert: edit.invert,
        trimmedLength,
      };
    });
  }, [audioDuration, clipEdits, session.videoPaths, session.videoIds, videoDurations]);
  const timelineDuration = useMemo(() => {
    if (audioDuration > 0) return audioDuration;
    return clipSegments.reduce((acc, seg) => Math.max(acc, seg.end ?? 0), 0);
  }, [audioDuration, clipSegments]);
  const projectLocked = !isLicensed;

  const buildProjectFromSession = useCallback((): ProjectSchema => {
    const clips: ProjectSchema['clips'] = clipSegments.map((seg) => {
      const clip: ProjectSchema['clips'][number] = {
        path: seg.path,
        index: seg.index,
        label: (session.videoNames ?? {})[seg.path],
      };
      if (Number.isFinite(seg.start as number)) clip.start = seg.start;
      clip.trimStart = seg.trimStart;
      clip.trimEnd = seg.trimEnd;
      clip.duration = seg.duration;
      if (seg.fillMethod) clip.fillMethod = seg.fillMethod;
      if (Number.isFinite(seg.hue as number)) clip.hue = seg.hue;
      if (Number.isFinite(seg.contrast as number)) clip.contrast = seg.contrast;
      if (Number.isFinite(seg.brightness as number)) clip.brightness = seg.brightness;
      if (Number.isFinite(seg.rotate as number)) clip.rotate = seg.rotate;
      if (typeof seg.flipH === 'boolean') clip.flipH = seg.flipH;
      if (typeof seg.flipV === 'boolean') clip.flipV = seg.flipV;
      if (typeof seg.invert === 'boolean') clip.invert = seg.invert;
      return clip;
    });
    const audio = session.audioPath ? { path: session.audioPath } : null;
    const playhead = typeof session.playhead === 'number' && Number.isFinite(session.playhead) ? session.playhead : 0;
    const metadata: Record<string, unknown> = {};
    metadata.projectName = getProjectName(session);
    if (session.theme) metadata.theme = session.theme;
    if (canvasPreset) {
      metadata.canvas = { preset: canvasPreset, width: canvasSize.width, height: canvasSize.height };
    }
    return {
      version: '1.0',
      audio,
      playhead,
      clips,
      layers: session.layers ?? [],
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }, [canvasPreset, canvasSize.height, canvasSize.width, clipSegments, getProjectName, session, session.audioPath, session.playhead, session.layers, session.videoNames]);

  useEffect(() => {
    if (!clipEditor) {
      setClipEditorDraft(null);
      return;
    }
    const seg = clipSegments.find((item) => item.id === clipEditor.id);
    if (!seg) return;
    setClipEditorDraft({
      timelineStart: seg.start,
      timelineEnd: seg.end,
      trimStart: seg.trimStart,
      trimEnd: seg.trimEnd,
      duration: seg.duration,
      fillMethod: seg.fillMethod ?? 'loop',
      hue: Number.isFinite(seg.hue as number) ? seg.hue : 0,
      contrast: Number.isFinite(seg.contrast as number) ? seg.contrast : 1,
      brightness: Number.isFinite(seg.brightness as number) ? seg.brightness : 1,
      rotate: Number.isFinite(seg.rotate as number) ? seg.rotate : 0,
      flipH: !!seg.flipH,
      flipV: !!seg.flipV,
      invert: !!seg.invert,
    });
  }, [clipEditor, clipSegments]);

  useEffect(() => {
    if (!isRendering) return;
    const startAt = renderStartAtRef.current ?? Date.now();
    renderStartAtRef.current = startAt;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startAt;
      setRenderElapsedMs((prev) => Math.max(prev, elapsed));
    }, 500);
    return () => window.clearInterval(id);
  }, [isRendering]);

  const openClipContextMenu = (id: string, path: string, index: number, x: number, y: number) => {
    setContextMenu({ id, path, index, x, y });
  };

  const closeContextMenu = () => setContextMenu(null);

  const reorderList = <T,>(arr: T[], from: number, to: number) => {
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const updateClipEdit = useCallback((id: string, patch: Partial<ClipEdit>) => {
    setSession((prev) => {
      const edits = { ...(prev.clipEdits ?? {}) };
      const existing = edits[id] ?? {};
      edits[id] = { ...existing, ...patch };
      return { ...prev, clipEdits: edits };
    });
    void updateProjectDirty(true);
  }, []);

  const applyTrimEdit = useCallback((id: string, trimStart: number, duration: number) => {
    const seg = clipSegments.find((item) => item.id === id);
    const maxEnd = seg?.trimEnd ?? (seg?.sourceDuration ?? Number.POSITIVE_INFINITY);
    const nextStart = Math.max(0, trimStart);
    const clampedStart = Math.max(0, Math.min(maxEnd - 0.05, nextStart));
    const nextDuration = Math.max(0.05, duration);
    const maxDuration = audioDuration > 0 && seg?.start != null
      ? Math.max(0, audioDuration - seg.start)
      : Number.POSITIVE_INFINITY;
    const clampedDuration = Math.min(nextDuration, maxDuration);
    updateClipEdit(id, { trimStart: clampedStart, duration: clampedDuration });
  }, [audioDuration, clipSegments, updateClipEdit]);

  const applyDurationEdit = useCallback((id: string, duration: number) => {
    const seg = clipSegments.find((item) => item.id === id);
    const nextDuration = Math.max(0.05, duration);
    const maxDuration = audioDuration > 0 && seg?.start != null
      ? Math.max(0, audioDuration - seg.start)
      : Number.POSITIVE_INFINITY;
    const clampedDuration = Math.min(nextDuration, maxDuration);
    updateClipEdit(id, { duration: clampedDuration });
  }, [audioDuration, clipSegments, updateClipEdit]);

  const applyClipTrimDrag = useCallback((id: string, update: {
    kind: 'start' | 'end';
    mode: 'timeline' | 'source';
    trimStart: number;
    trimEnd: number;
    duration: number;
  }) => {
    const seg = clipSegments.find((item) => item.id === id);
    if (!seg) return;
    const minLen = 0.05;
    if (update.mode === 'source') {
      if (update.kind === 'start') {
        const maxStart = Math.max(0, (seg.trimEnd ?? update.trimEnd) - minLen);
        const nextStart = Math.max(0, Math.min(maxStart, update.trimStart));
        updateClipEdit(id, { trimStart: nextStart });
      } else {
        const maxEnd = seg.sourceDuration > 0 ? seg.sourceDuration : Number.POSITIVE_INFINITY;
        const nextEnd = Math.max((seg.trimStart ?? update.trimStart) + minLen, Math.min(maxEnd, update.trimEnd));
        updateClipEdit(id, { trimEnd: nextEnd });
      }
      return;
    }
    if (update.kind === 'start') {
      applyTrimEdit(id, update.trimStart, update.duration);
    } else {
      applyDurationEdit(id, update.duration);
    }
  }, [applyDurationEdit, applyTrimEdit, clipSegments, updateClipEdit]);

  const handlePickImageForLayer = useCallback(async () => {
    try {
      const path = await openImageFile();
      if (path) {
        updateLayerDraftField({ imagePath: path });
      }
    } catch (err) {
      console.warn('Failed to pick image', err);
    }
  }, [updateLayerDraftField]);

  const handleReorderClips = useCallback((from: number, to: number) => {
    setSession((prev) => {
      const paths = prev.videoPaths ?? [];
      const ids = prev.videoIds ?? [];
      if (from === to || from < 0 || to < 0 || from >= paths.length || to >= paths.length) return prev;
      const nextPaths = reorderList(paths, from, to);
      const nextIds = ids.length === paths.length ? reorderList(ids, from, to) : ids;
      return { ...prev, videoPaths: nextPaths, videoIds: nextIds };
    });
    void updateProjectDirty(true);
  }, []);


  const removeClipAt = (idx: number) => {
    setSession((prev) => {
      const next = (prev.videoPaths ?? []).slice();
      const ids = (prev.videoIds ?? []).slice();
      const removedId = ids[idx];
      next.splice(idx, 1);
      if (ids.length) ids.splice(idx, 1);
      const edits = { ...(prev.clipEdits ?? {}) };
      if (removedId) delete edits[removedId];
      return { ...prev, videoPaths: next, videoIds: ids, clipEdits: edits };
    });
    setContextMenu(null);
    void updateProjectDirty(true);
  };

  const duplicateClipAt = (idx: number) => {
    setSession((prev) => {
      const paths = prev.videoPaths ?? [];
      const ids = prev.videoIds ?? [];
      if (idx < 0 || idx >= paths.length) return prev;
      const dup = paths[idx];
      const next = paths.slice();
      next.splice(idx + 1, 0, dup);
      const nextIds = ids.slice();
      const newId = makeId();
      nextIds.splice(idx + 1, 0, newId);
      const edits = { ...(prev.clipEdits ?? {}) };
      const sourceId = ids[idx];
      if (sourceId && edits[sourceId]) {
        edits[newId] = { ...edits[sourceId] };
      }
      return { ...prev, videoPaths: next, videoIds: nextIds, clipEdits: edits };
    });
    setContextMenu(null);
    void updateProjectDirty(true);
  };

  const startRenameClip = (path: string, index: number) => {
    setRenameTarget({ path, index, name: getClipLabel(path) });
    setContextMenu(null);
  };

  const applyRenameClip = async () => {
    if (!renameTarget) return;
    const { path, name } = renameTarget;
    const trimmed = name.trim();
    const nextName = trimmed || getClipLabel(path);
    const hit = library.find((i) => i.path === path);
    if (hit) {
      await updateLibraryName(path, nextName);
    } else {
      setSession((prev) => ({ ...prev, videoNames: { ...(prev.videoNames ?? {}), [path]: nextName } }));
    }
    setStatus(`Renamed clip to ${nextName}`);
    setRenameTarget(null);
    void updateProjectDirty(true);
  };

  const handleClipInfo = (path: string) => {
    const label = getClipLabel(path);
    const dur = videoDurations[path];
    setStatus(`Clip: ${label} (${dur ? `${dur.toFixed(1)}s` : 'n/a'})`);
    setContextMenu(null);
  };

  const handleClipEdit = (id: string, path: string, index: number) => {
    setClipEditor({ id, path, index });
    setContextMenu(null);
  };

  const closeClipEditor = () => {
    setClipEditor(null);
    setClipEditorDraft(null);
  };

  const applyClipEditor = () => {
    if (!clipEditor || !clipEditorDraft) return;
    const seg = clipSegments.find((item) => item.id === clipEditor.id);
    if (!seg) return;
    const timelineStartRaw = Math.max(0, Number(clipEditorDraft.timelineStart ?? seg.start ?? 0));
    const maxTimelineEnd = audioDuration > 0 ? audioDuration : Number.POSITIVE_INFINITY;
    const timelineStart = Math.min(timelineStartRaw, maxTimelineEnd);
    const timelineEndRaw = Number.isFinite(clipEditorDraft.timelineEnd as number)
      ? Number(clipEditorDraft.timelineEnd)
      : (timelineStart + seg.duration);
    const timelineEnd = Math.min(Math.max(timelineStart, timelineEndRaw), maxTimelineEnd);
    const duration = Math.max(0.05, timelineEnd - timelineStart);
    const trimStart = Math.max(0, Number(clipEditorDraft.trimStart ?? seg.trimStart ?? 0));
    const sourceDuration = seg.sourceDuration || 0;
    let trimEnd = Number.isFinite(clipEditorDraft.trimEnd as number)
      ? Number(clipEditorDraft.trimEnd)
      : (sourceDuration > 0 ? sourceDuration : trimStart + duration);
    if (sourceDuration > 0) trimEnd = Math.min(trimEnd, sourceDuration);
    trimEnd = Math.max(trimStart + 0.05, trimEnd);
    updateClipEdit(clipEditor.id, {
      timelineStart,
      duration,
      trimStart,
      trimEnd,
      fillMethod: clipEditorDraft.fillMethod ?? 'loop',
      hue: Number(clipEditorDraft.hue ?? 0),
      contrast: Number(clipEditorDraft.contrast ?? 1),
      brightness: Number(clipEditorDraft.brightness ?? 1),
      rotate: Number(clipEditorDraft.rotate ?? 0),
      flipH: !!clipEditorDraft.flipH,
      flipV: !!clipEditorDraft.flipV,
      invert: !!clipEditorDraft.invert,
    });
    closeClipEditor();
  };

  const updateClipEditorDraft = useCallback((patch: Partial<ClipEdit> & { timelineStart?: number; timelineEnd?: number }) => {
    setClipEditorDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleClipAddToLibrary = async (path: string) => {
    const exists = library.some((item) => item.path === path);
    if (exists) {
      setContextMenu(null);
      return;
    }
    const name = getClipLabel(path);
    await addLibraryEntryFromPath(path, name);
    setContextMenu(null);
  };

  const handleLoadProject = async () => {
    if (!ensureLicensed()) return;
    try {
      const opened = await openProject();
      if (opened) {
        const project = opened.project as any;
        const clipList = Array.isArray(project?.clips) ? project.clips.filter((c: any) => c?.path) : [];
        const loadedProjectName = String(project?.metadata?.projectName ?? '').trim();
        const fallbackName = opened.path.split(/[\\/]/).pop()?.replace(/\.json$/i, '') || makeUntitledProjectName(1);
        const nextProjectName = loadedProjectName || fallbackName;
        const nextVideos = clipList.map((c: any) => c?.path).filter(Boolean);
        const nextIds = nextVideos.map(() => makeId());
        const nextNames: Record<string, string> = {};
        const nextEdits: Record<string, ClipEdit> = {};
        clipList.forEach((c: any, idx: number) => {
          if (c?.path && c.label) nextNames[c.path] = c.label;
          const edit: ClipEdit = {};
          if (Number.isFinite(c?.trimStart)) edit.trimStart = Number(c.trimStart);
          if (Number.isFinite(c?.trimEnd)) edit.trimEnd = Number(c.trimEnd);
          if (Number.isFinite(c?.duration)) edit.duration = Number(c.duration);
          if (typeof c?.fillMethod === 'string') edit.fillMethod = c.fillMethod;
          if (Number.isFinite(c?.start)) edit.timelineStart = Number(c.start);
          if (Number.isFinite(c?.hue)) edit.hue = Number(c.hue);
          if (Number.isFinite(c?.contrast)) edit.contrast = Number(c.contrast);
          if (Number.isFinite(c?.brightness)) edit.brightness = Number(c.brightness);
          if (Number.isFinite(c?.rotate)) edit.rotate = Number(c.rotate);
          if (typeof c?.flipH === 'boolean') edit.flipH = c.flipH;
          if (typeof c?.flipV === 'boolean') edit.flipV = c.flipV;
          if (typeof c?.invert === 'boolean') edit.invert = c.invert;
          if (Object.keys(edit).length > 0) {
            nextEdits[nextIds[idx]] = edit;
          }
        });
        setSession((prev) => ({
          ...prev,
          projectName: nextProjectName,
          projectSavePath: opened.path,
          audioPath: project?.audio?.path ?? undefined,
          videoPaths: nextVideos,
          videoIds: nextIds,
          clipEdits: nextEdits,
          videoNames: nextNames,
          playhead: typeof project?.playhead === 'number' ? project.playhead : 0,
          layers: Array.isArray(project?.layers) ? project.layers : [],
        }));
        const untitledN = parseTrailingInteger(nextProjectName, UNTITLED_PROJECT_PREFIX);
        if (untitledN != null) setUntitledProjectCounter((n) => Math.max(n, untitledN + 1));
        setEditingProjectName(false);
        setProjectNameDraft('');
        setStatus('Project loaded');
        await updateProjectDirty(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveProject = async () => {
    if (!ensureLicensed()) return;
    try {
      const project = buildProjectFromSession();
      let target = session.projectSavePath;
      if (!target) {
        const defaultPath = await getDefaultProjectPath(getProjectName());
        target = await chooseProjectSavePath(defaultPath);
        if (!target) return;
        setSession((prev) => ({ ...prev, projectSavePath: target }));
      }
      await saveProject(target, project);
      await updateProjectDirty(false);
      notifyProjectSaved(true);
      setStatus('Project saved');
    } catch (e: unknown) {
      notifyProjectSaved(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveProjectAs = async () => {
    if (!ensureLicensed()) return;
    try {
      const defaultPath = session.projectSavePath ?? await getDefaultProjectPath(getProjectName());
      const target = await chooseProjectSavePath(defaultPath);
      if (!target) return;
      setSession((prev) => ({ ...prev, projectSavePath: target }));
      const project = buildProjectFromSession();
      await saveProject(target, project);
      await updateProjectDirty(false);
      notifyProjectSaved(true);
      setStatus('Project saved as...');
    } catch (e: unknown) {
      notifyProjectSaved(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStartRender = async () => {
    if (!ensureLicensed()) return;
    try {
      const project = buildProjectFromSession();
      let target = session.projectSavePath;
      if (!target) {
        const defaultPath = await getDefaultProjectPath(getProjectName());
        target = await chooseProjectSavePath(defaultPath);
        if (!target) {
          setStatus('Render cancelled: no project path selected');
          return;
        }
        setSession((prev) => ({ ...prev, projectSavePath: target }));
      }
      await saveProject(target, project);
      await updateProjectDirty(false);

      const outputPath = await chooseRenderOutput(target);
      if (!outputPath) {
        setStatus('Render cancelled');
        return;
      }
      const preparedPath = await prepareRenderProject(target, outputPath);

      setIsRendering(true);
      renderStartAtRef.current = Date.now();
      setRenderElapsedMs(0);
      setRenderTotalMs(0);
      setLogs([]);
      setStatus('Render started');
      void startRender(preparedPath).catch((err) => {
        setIsRendering(false);
        renderStartAtRef.current = null;
        setError(err instanceof Error ? err.message : String(err));
      });
    } catch (e: unknown) {
      setIsRendering(false);
      renderStartAtRef.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const moveLayerBy = useCallback((layerId: string, delta: number) => {
    setSession((prev) => {
      const current = prev.layers ?? [];
      const idx = current.findIndex((layer) => layer.id === layerId);
      if (idx < 0) return prev;
      const nextIndex = Math.max(0, Math.min(current.length - 1, idx + delta));
      if (nextIndex === idx) return prev;
      const next = current.slice();
      const [item] = next.splice(idx, 1);
      next.splice(nextIndex, 0, item);
      return { ...prev, layers: next };
    });
    void updateProjectDirty(true);
  }, []);

  const moveLayerToIndex = useCallback((layerId: string, index: number) => {
    setSession((prev) => {
      const current = prev.layers ?? [];
      const idx = current.findIndex((layer) => layer.id === layerId);
      if (idx < 0) return prev;
      const nextIndex = Math.max(0, Math.min(current.length - 1, index));
      if (nextIndex === idx) return prev;
      const next = current.slice();
      const [item] = next.splice(idx, 1);
      next.splice(nextIndex, 0, item);
      return { ...prev, layers: next };
    });
    void updateProjectDirty(true);
  }, []);

  // Load video durations to scale storyboard items
  useEffect(() => {
    const paths = session.videoPaths ?? [];
    if (paths.length === 0) { setVideoDurations({}); return; }
    let cancel = false;
    const next: Record<string, number> = {};
    let loaded = 0;
    paths.forEach((p) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = toFileURL(p);
      const done = () => {
        loaded += 1;
        if (!cancel) {
          if (Number.isFinite(v.duration)) next[p] = v.duration;
          if (loaded === paths.length) setVideoDurations(next);
        }
        v.src = '';
      };
      v.addEventListener('loadedmetadata', done, { once: true });
      v.addEventListener('error', done, { once: true });
      // In case metadata is cached
      if (Number.isFinite(v.duration) && v.duration > 0) done();
    });
    return () => { cancel = true; };
  }, [session.videoPaths]);

  useEffect(() => {
    const audioPath = session.audioPath;
    if (!audioPath) {
      setOverviewPeaks([]);
      return;
    }
    // Show something immediately while decoding
    setOverviewPeaks(makePseudoPeaks(audioPath));
    let cancelled = false;

    const generatePeaks = async () => {
      try {
        const buf = await readFileBuffer(audioPath);
        const slice = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
          ? buf.buffer
          : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        // Ensure we hand AudioContext a real ArrayBuffer (not SharedArrayBuffer)
        const arrayBuffer = slice instanceof ArrayBuffer
          ? slice
          : (() => {
              const copy = new Uint8Array(slice.byteLength);
              copy.set(new Uint8Array(slice));
              return copy.buffer;
            })();
        const AudioCtor = window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
        if (!AudioCtor) throw new Error('AudioContext unavailable');
        const audioCtx = new AudioCtor();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        if (cancelled) {
          await audioCtx.close();
          return;
        }
        const channelData = decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : undefined;
        if (!channelData) {
          await audioCtx.close();
          throw new Error('No channel data');
        }
        const bucketCount = 640;
        const samplesPerBucket = Math.max(1, Math.floor(channelData.length / bucketCount));
        const peaks: number[] = [];
        for (let bucket = 0; bucket < bucketCount; bucket++) {
          const start = bucket * samplesPerBucket;
          if (start >= channelData.length) break;
          let peak = 0;
          for (let i = 0; i < samplesPerBucket && start + i < channelData.length; i++) {
            const sample = Math.abs(channelData[start + i]);
            if (sample > peak) peak = sample;
          }
          peaks.push(peak);
        }
        await audioCtx.close();
        if (!cancelled) setOverviewPeaks(peaks);
      } catch (err) {
        if (!cancelled) {
          console.warn('Overview waveform generation failed:', err);
          setOverviewPeaks(makePseudoPeaks(audioPath));
        }
      }
    };

    void generatePeaks();
    return () => {
      cancelled = true;
    };
  }, [session.audioPath, makePseudoPeaks]);

  // Wire AudioMotion analyzer when audio element is available (lazy-loaded from CDN)
  useEffect(() => {
    if (!USE_AUDIO_MOTION) return;
    const audio = audioEl;
    if (!audio) return;
    let container: HTMLDivElement | null = null;
    let destroyed = false;
    (async () => {
      try {
        // @ts-ignore external ESM import
        const mod: any = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/audiomotion-analyzer@4.0.0/+esm');
        const AudioMotion = mod?.default ?? mod;
        if (!AudioMotion) return;
        if (destroyed) return;
        container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        container.style.width = '400px';
        container.style.height = '200px';
        document.body.appendChild(container);
        const am = new AudioMotion(container, {
          source: audio,
          height: 200,
          width: 400,
          mode: 10,
          ledBars: false,
          ansiBands: false,
          smoothing: 0.7,
          gradient: 'classic',
          showScale: false,
          overlay: true,
          bgAlpha: 0,
          showPeaks: false,
        });
        audioMotionRef.current = am;
      } catch (err) {
        console.warn('AudioMotion init failed', err);
      }
    })();
    return () => {
      destroyed = true;
      if (audioMotionRef.current) {
        try { (audioMotionRef.current as any).destroy?.(); } catch {}
        audioMotionRef.current = null;
      }
      if (container) {
        container.remove();
      }
    };
  }, [USE_AUDIO_MOTION, audioEl, session.audioPath]);

  useEffect(() => {
    const audio = audioEl;
    if (!audio) return undefined;
    let ctx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let gain: GainNode | null = null;
    const cleanup = () => {
      try { source?.disconnect(); } catch {}
      try { analyser?.disconnect(); } catch {}
      try { gain?.disconnect(); } catch {}
      if (ctx) {
        try { ctx.close(); } catch {}
      }
      spectroAudioCtxRef.current = null;
      spectroSourceRef.current = null;
      spectroAnalyserRef.current = null;
      spectroGainRef.current = null;
    };
    try {
      const AudioCtor = window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
      if (!AudioCtor) return cleanup;
      ctx = new AudioCtor();
      source = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      gain = ctx.createGain();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      spectroAudioCtxRef.current = ctx;
      spectroSourceRef.current = source;
      spectroAnalyserRef.current = analyser;
      spectroGainRef.current = gain;
      const onPlay = () => { void ctx?.resume(); };
      audio.addEventListener('play', onPlay);
      return () => {
        audio.removeEventListener('play', onPlay);
        cleanup();
      };
    } catch {
      cleanup();
      return undefined;
    }
  }, [audioEl]);

  useEffect(() => {
    const gain = spectroGainRef.current;
    if (!gain) return;
    gain.gain.value = Math.min(1, Math.max(0, volume));
  }, [volume]);

  const resolveActiveClip = useCallback((playheadSec: number) => {
    for (const seg of clipSegments) {
      const start = seg.start ?? 0;
      const end = seg.end ?? (start + seg.duration);
      if (playheadSec >= start && playheadSec <= end) {
        const rel = Math.max(0, playheadSec - start);
        const loopLen = Math.max(0.05, seg.trimmedLength || (seg.sourceDuration || 0));
        const method = seg.fillMethod ?? 'loop';
        let local = seg.trimStart;
        if (method === 'stretch' && seg.duration > 0 && loopLen > 0) {
          const pct = Math.min(1, rel / seg.duration);
          local = seg.trimStart + (loopLen * pct);
        } else if (method === 'pingpong' && loopLen > 0) {
          const period = loopLen * 2;
          const t = period > 0 ? (rel % period) : 0;
          local = seg.trimStart + (t <= loopLen ? t : (period - t));
        } else {
          local = seg.trimStart + (loopLen > 0 ? (rel % loopLen) : 0);
        }
        return { path: seg.path, local, duration: seg.duration };
      }
    }
    return null;
  }, [clipSegments]);

  const renderPreviewFrame = useCallback(async () => {
    if (previewBusyRef.current) {
      previewQueuedRef.current = true;
      return;
    }
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    previewBusyRef.current = true;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.clientWidth || 800;
    const logicalH = canvas.clientHeight || 450;
    const stageAspect = canvasSize.width / canvasSize.height;
    const stageW = (logicalW / logicalH) > stageAspect ? (logicalH * stageAspect) : logicalW;
    const stageH = stageW / stageAspect;
    const stageX = (logicalW - stageW) / 2;
    const stageY = (logicalH - stageH) / 2;
    const stageScale = stageW / canvasSize.width;
    const targetW = Math.floor(logicalW * dpr);
    const targetH = Math.floor(logicalH * dpr);
    const prevSize = previewSizeRef.current;
    if (!prevSize || prevSize.w !== targetW || prevSize.h !== targetH || prevSize.dpr !== dpr) {
      canvas.width = targetW;
      canvas.height = targetH;
      previewSizeRef.current = { w: targetW, h: targetH, dpr };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, logicalW, logicalH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(stageX, stageY, stageW, stageH);
    ctx.clip();

    const active = resolveActiveClip(session.playhead ?? 0);
    const videoEl = previewVideoElRef.current;
    const useVideoElement = !!videoEl;
    if (!useVideoElement) {
      ctx.fillStyle = '#0b0f16';
      ctx.fillRect(0, 0, logicalW, logicalH);
    }
    if (active && !useVideoElement) {
      const vid = videoPoolRef.current.get(active.path);
      if (vid) {
        const targetTime = Math.min(Math.max(0, active.local), (vid.duration || active.duration || 0));
        let seekOk = false;
        if (vid.readyState >= 2 && Math.abs((vid.currentTime || 0) - targetTime) < 0.01) {
          seekOk = true;
        } else {
          seekOk = await new Promise<boolean>((resolve) => {
            const handler = () => resolve(true);
            try {
              vid.currentTime = targetTime;
              vid.addEventListener('seeked', handler, { once: true });
            } catch {
              resolve(false);
            }
            setTimeout(() => resolve(false), 500);
          });
        }
        const drawFrame = (frameSource: CanvasImageSource) => {
          const srcW = (frameSource as HTMLVideoElement).videoWidth
            || (frameSource as HTMLCanvasElement).width
            || (frameSource as HTMLImageElement).naturalWidth
            || logicalW;
          const srcH = (frameSource as HTMLVideoElement).videoHeight
            || (frameSource as HTMLCanvasElement).height
            || (frameSource as HTMLImageElement).naturalHeight
            || logicalH;
          const scale = Math.min(stageW / srcW, stageH / srcH);
          const dw = srcW * scale;
          const dh = srcH * scale;
          const dx = stageX + (stageW - dw) / 2;
          const dy = stageY + (stageH - dh) / 2;
          ctx.drawImage(frameSource, dx, dy, dw, dh);
        };
        if (seekOk) {
          try {
            let drew = false;
            if ('requestVideoFrameCallback' in vid) {
              (vid as any).requestVideoFrameCallback(() => {
                try {
                  const cache = previewVideoFrameRef.current ?? document.createElement('canvas');
                  if (!previewVideoFrameRef.current) previewVideoFrameRef.current = cache;
                  const cw = Math.max(1, vid.videoWidth || Math.floor(stageW));
                  const ch = Math.max(1, vid.videoHeight || Math.floor(stageH));
                  if (cache.width !== cw || cache.height !== ch) {
                    cache.width = cw;
                    cache.height = ch;
                  }
                  const cctx = cache.getContext('2d');
                  if (cctx) {
                    cctx.clearRect(0, 0, cache.width, cache.height);
                    cctx.drawImage(vid, 0, 0, cache.width, cache.height);
                    previewVideoFrameMetaRef.current = { path: active.path, time: targetTime };
                  }
                } catch {
                  // ignore draw errors
                }
              });
              const cache = previewVideoFrameRef.current;
              const meta = previewVideoFrameMetaRef.current;
              if (cache && meta?.path === active.path) {
                drawFrame(cache);
                drew = true;
              }
            }
            if (!drew) {
              drawFrame(vid);
            }
            const cache = previewVideoFrameRef.current ?? document.createElement('canvas');
            if (!previewVideoFrameRef.current) previewVideoFrameRef.current = cache;
            const cw = Math.max(1, vid.videoWidth || Math.floor(stageW));
            const ch = Math.max(1, vid.videoHeight || Math.floor(stageH));
            if (cache.width !== cw || cache.height !== ch) {
              cache.width = cw;
              cache.height = ch;
            }
            const cctx = cache.getContext('2d');
            if (cctx) {
              cctx.clearRect(0, 0, cache.width, cache.height);
              cctx.drawImage(vid, 0, 0, cache.width, cache.height);
              previewVideoFrameMetaRef.current = { path: active.path, time: targetTime };
            }
          } catch {
            // ignore draw errors
          }
        } else {
          const cache = previewVideoFrameRef.current;
          const meta = previewVideoFrameMetaRef.current;
          if (cache && meta?.path === active.path) {
            try {
              drawFrame(cache);
            } catch {
              // ignore draw errors
            }
          }
        }
      }
    }

    const analyser = spectroAnalyserRef.current;
    let audioData: Uint8Array | null = null;
    let audioAmplitude = 0;
    if (analyser) {
      audioData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      const live = !!audioEl && !audioEl.paused;
      if (live) {
        analyser.getByteFrequencyData(audioData as Uint8Array<ArrayBuffer>);
        spectroLastDataRef.current = audioData.slice();
      } else if (spectroLastDataRef.current && spectroLastDataRef.current.length === audioData.length) {
        audioData.set(spectroLastDataRef.current);
      } else {
        analyser.getByteFrequencyData(audioData as Uint8Array<ArrayBuffer>);
      }
      let sum = 0;
      for (let i = 0; i < audioData.length; i++) sum += audioData[i];
      audioAmplitude = sum / (audioData.length * 255);
    }
    const nowMs = performance.now();

    // Draw layers
    for (const layer of layers) {
      const x = stageX + (layer.x ?? 0) * stageW;
      const y = stageY + (layer.y ?? 0) * stageH;
      const baseW = layer.width ?? canvasSize.width;
      const baseH = layer.height ?? Math.round(baseW * (canvasSize.height / canvasSize.width));
      const drawW = Math.max(10, baseW * stageScale);
      const drawH = Math.max(10, baseH * stageScale);
      const opacity = Math.min(1, Math.max(0, layer.opacity ?? 1));
      const rotateDeg = layer.rotate ?? 0;
      const rotateRad = (rotateDeg * Math.PI) / 180;
      const reverse = !!layer.reverse;
      if (layer.type === 'spectrograph') {
        if (analyser && audioData) {
          const workCanvas = spectroWorkRef.current ?? document.createElement('canvas');
          if (!spectroWorkRef.current) spectroWorkRef.current = workCanvas;
          const barCanvasW = 512;
          const barCanvasH = 200;
          workCanvas.width = barCanvasW;
          workCanvas.height = barCanvasH;
          const workCtx = workCanvas.getContext('2d');
          if (!workCtx) continue;
          workCtx.clearRect(0, 0, barCanvasW, barCanvasH);
          const data = audioData;
          const mode = layer.mode ?? 'bar';
          const pathMode = layer.pathMode ?? 'straight';
          const freqScale = layer.freqScale ?? 'log';
          const ampScale = layer.ampScale ?? 'log';
          const barCount = mode === 'dots'
            ? (layer.dotCount ?? 96)
            : mode === 'solid'
              ? (layer.solidPointCount ?? 96)
              : (layer.barCount ?? 96);
          const step = Math.max(1, Math.floor(data.length / barCount));
          const barW = barCanvasW / barCount;
          const barWidthPct = mode === 'bar' || mode === 'solid' ? (layer.barWidthPct ?? 0.8) : 0.6;
          const averaging = Math.max(1, Math.round(layer.averaging ?? 1));
          const scaleAmp = (v: number) => {
            if (ampScale === 'lin') return v;
            if (ampScale === 'sqrt') return Math.sqrt(v);
            if (ampScale === 'cbrt') return Math.cbrt(v);
            return Math.log10(1 + 9 * v);
          };
          const scaleIndex = (i: number) => {
            if (freqScale === 'lin') return i;
            const t = i / Math.max(1, barCount - 1);
            if (freqScale === 'rlog') {
              return Math.floor((1 - Math.pow(1 - t, 2)) * (barCount - 1));
            }
            return Math.floor(Math.pow(t, 2) * (barCount - 1));
          };
          const sampleValue = (i: number) => {
            const sIdx = scaleIndex(i);
            if (averaging <= 1) {
              return data[sIdx * step] / 255;
            }
            const half = Math.floor(averaging / 2);
            let sum = 0;
            let count = 0;
            for (let o = -half; o <= half; o++) {
              const idx = Math.min(barCount - 1, Math.max(0, sIdx + o));
              sum += data[idx * step] / 255;
              count += 1;
            }
            return sum / Math.max(1, count);
          };
          const fill = layer.color ?? '';
          let gradient: CanvasGradient | null = null;
          if (!fill) {
            gradient = workCtx.createLinearGradient(0, 0, 0, barCanvasH);
            gradient.addColorStop(0, '#ff3b3b');
            gradient.addColorStop(0.55, '#ffd400');
            gradient.addColorStop(1, '#00ff7a');
          }
          workCtx.fillStyle = fill || gradient || '#00ff7a';
          if (mode === 'line') {
            workCtx.beginPath();
            for (let i = 0; i < barCount; i++) {
              const v = sampleValue(i);
              const h = Math.max(1, Math.floor(scaleAmp(v) * barCanvasH));
              const xPos = i * barW + barW / 2;
              const yPos = layer.invert ? h : (barCanvasH - h);
              if (i === 0) workCtx.moveTo(xPos, yPos);
              else workCtx.lineTo(xPos, yPos);
            }
            workCtx.strokeStyle = fill || gradient || '#00ff7a';
            workCtx.lineWidth = Math.max(1, barW * 0.4);
            workCtx.stroke();
          } else if (mode === 'dots') {
            const radius = Math.max(1, (barW * barWidthPct) / 2);
            for (let i = 0; i < barCount; i++) {
              const v = sampleValue(i);
              const h = Math.max(1, Math.floor(scaleAmp(v) * barCanvasH));
              const xPos = i * barW + barW / 2;
              const yPos = layer.invert ? h : (barCanvasH - h);
              workCtx.beginPath();
              workCtx.arc(xPos, yPos, radius, 0, Math.PI * 2);
              workCtx.fill();
            }
          } else {
            const widthScale = mode === 'solid' ? 1 : barWidthPct;
            for (let i = 0; i < barCount; i++) {
              const v = sampleValue(i);
              const h = Math.max(1, Math.floor(scaleAmp(v) * barCanvasH));
              const xPos = i * barW;
              const barWidth = Math.max(1, barW * widthScale);
              const yPos = layer.invert ? 0 : (barCanvasH - h);
              workCtx.fillRect(xPos, yPos, barWidth, h);
            }
          }
          const buildMirroredCanvas = (source: HTMLCanvasElement, mirrorX: boolean, mirrorY: boolean): HTMLCanvasElement => {
            if (!mirrorX && !mirrorY) return source;
            const out = document.createElement('canvas');
            out.width = source.width;
            out.height = source.height;
            const octx = out.getContext('2d');
            if (!octx) return source;
            const w = source.width;
            const h = source.height;
            const hw = Math.floor(w / 2);
            const hh = Math.floor(h / 2);
            octx.clearRect(0, 0, w, h);
            if (mirrorX && mirrorY) {
              // Mirror from the top-left quadrant into all 4 quadrants.
              octx.drawImage(source, 0, 0, hw, hh, 0, 0, hw, hh);
              octx.save();
              octx.scale(-1, 1);
              octx.drawImage(source, 0, 0, hw, hh, -w, 0, hw, hh);
              octx.restore();
              octx.save();
              octx.scale(1, -1);
              octx.drawImage(source, 0, 0, hw, hh, 0, -h, hw, hh);
              octx.restore();
              octx.save();
              octx.scale(-1, -1);
              octx.drawImage(source, 0, 0, hw, hh, -w, -h, hw, hh);
              octx.restore();
              return out;
            }
            if (mirrorX) {
              // Left half remains; right half is mirrored replacement.
              octx.drawImage(source, 0, 0, hw, h, 0, 0, hw, h);
              octx.save();
              octx.scale(-1, 1);
              octx.drawImage(source, 0, 0, hw, h, -w, 0, hw, h);
              octx.restore();
              return out;
            }
            // Top half remains; bottom half is mirrored replacement.
            octx.drawImage(source, 0, 0, w, hh, 0, 0, w, hh);
            octx.save();
            octx.scale(1, -1);
            octx.drawImage(source, 0, 0, w, hh, 0, -h, w, hh);
            octx.restore();
            return out;
          };
          let finalCanvas = workCanvas;
          const glowAmount = layer.glowAmount ?? 0;
          const glowOpacity = layer.glowOpacity ?? 0.4;
          const glowColor = layer.glowColor ?? layer.color ?? '#ffffff';
          const outlineWidth = layer.outlineWidth ?? 0;
          const outlineColor = layer.outlineColor ?? '#000000';
          const shadowDistance = layer.shadowDistance ?? 0;
          const shadowColor = layer.shadowColor ?? '#000000';
          ctx.save();
          ctx.translate(x + drawW / 2, y + drawH / 2);
          ctx.rotate(rotateRad);
          if (reverse) ctx.scale(-1, 1);
          ctx.globalAlpha = opacity;
          if (pathMode === 'circular') {
            const circleCanvas = document.createElement('canvas');
            circleCanvas.width = barCanvasW;
            circleCanvas.height = barCanvasH;
            const circleCtx = circleCanvas.getContext('2d');
            if (circleCtx) {
              circleCtx.clearRect(0, 0, barCanvasW, barCanvasH);
              circleCtx.translate(barCanvasW / 2, barCanvasH / 2);
              const radius = Math.min(barCanvasW, barCanvasH) / 2;
              const innerRadius = radius * 0.1;
              const angleStep = (Math.PI * 2) / barCount;
              circleCtx.fillStyle = fill || gradient || '#00ff7a';
              circleCtx.strokeStyle = fill || gradient || '#00ff7a';
              for (let i = 0; i < barCount; i++) {
                const v = sampleValue(i);
                const mag = Math.max(1, scaleAmp(v) * (radius - innerRadius));
                const startAngle = -Math.PI / 2 + i * angleStep;
                const thickness = angleStep * (mode === 'bar' || mode === 'solid' ? barWidthPct : 0.6);
                const angle = startAngle + thickness / 2;
                const outer = layer.invert ? innerRadius : innerRadius + mag;
                const inner = layer.invert ? innerRadius + mag : innerRadius;
                if (mode === 'dots') {
                  const dotR = Math.max(2, radius * 0.015 * barWidthPct);
                  const rx = Math.cos(angle) * outer;
                  const ry = Math.sin(angle) * outer;
                  circleCtx.beginPath();
                  circleCtx.arc(rx, ry, dotR, 0, Math.PI * 2);
                  circleCtx.fill();
                } else if (mode === 'line') {
                  circleCtx.lineWidth = Math.max(1, radius * 0.01 * barWidthPct);
                  circleCtx.beginPath();
                  circleCtx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                  circleCtx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                  circleCtx.stroke();
                } else {
                  const start = startAngle;
                  const end = startAngle + thickness;
                  circleCtx.beginPath();
                  circleCtx.arc(0, 0, outer, start, end, false);
                  circleCtx.arc(0, 0, inner, end, start, true);
                  circleCtx.closePath();
                  circleCtx.fill();
                }
              }
              finalCanvas = circleCanvas;
            }
          }
          finalCanvas = buildMirroredCanvas(finalCanvas, !!layer.mirrorX, !!layer.mirrorY);
          if (shadowDistance > 0) {
            ctx.save();
            ctx.shadowOffsetX = shadowDistance;
            ctx.shadowOffsetY = shadowDistance;
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = 0;
            ctx.drawImage(finalCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          }
          if (outlineWidth > 0) {
            ctx.save();
            ctx.shadowColor = outlineColor;
            ctx.shadowBlur = outlineWidth;
            ctx.drawImage(finalCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          }
          if (glowAmount > 0) {
            ctx.save();
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = glowAmount;
            ctx.globalAlpha = Math.min(1, Math.max(0, glowOpacity));
            ctx.drawImage(finalCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          }
          ctx.drawImage(finalCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        } else {
          const am = audioMotionRef.current;
          if (am?.canvas) {
            try { am.draw?.(); } catch {}
            const srcCanvas = am.canvas as HTMLCanvasElement;
            const sourceW = srcCanvas.width;
            const sourceH = Math.floor(srcCanvas.height * 0.8);
            const cacheCanvas = spectroCacheRef.current ?? document.createElement('canvas');
            if (!spectroCacheRef.current) spectroCacheRef.current = cacheCanvas;
            cacheCanvas.width = sourceW;
            cacheCanvas.height = sourceH;
            const cacheCtx = cacheCanvas.getContext('2d');
            if (cacheCtx) {
              cacheCtx.clearRect(0, 0, sourceW, sourceH);
              cacheCtx.drawImage(srcCanvas, 0, 0, sourceW, sourceH, 0, 0, sourceW, sourceH);
            }
            ctx.save();
            ctx.translate(x + drawW / 2, y + drawH / 2);
            ctx.rotate(rotateRad);
            if (reverse) ctx.scale(-1, 1);
            ctx.globalAlpha = opacity;
            ctx.drawImage(cacheCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          } else {
            // Fallback visual if analyser not ready
            ctx.save();
            ctx.fillStyle = layer.color ?? '#7ea5ff';
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x, y, drawW, drawH);
            ctx.restore();
          }
        }
      } else if (layer.type === 'image') {
        const imgPath = (layer as any).imagePath;
        if (!imgPath) continue;
        const img = imagePoolRef.current.get(imgPath);
        if (!img || !img.complete) continue;
        const outlineWidth = layer.outlineWidth ?? 0;
        const outlineColor = layer.outlineColor ?? '#000000';
        const glowAmount = layer.glowAmount ?? 0;
        const glowColor = layer.glowColor ?? '#000000';
        const shadowDistance = layer.shadowDistance ?? 0;
        const shadowColor = layer.shadowColor ?? '#000000';
        ctx.save();
        ctx.translate(x + drawW / 2, y + drawH / 2);
        if (rotateRad) ctx.rotate(rotateRad);
        if (reverse) ctx.scale(-1, 1);
        ctx.globalAlpha = opacity;
        if (layer.invert) ctx.filter = 'invert(1)';
        if (shadowDistance > 0) {
          ctx.save();
          ctx.shadowColor = shadowColor;
          ctx.shadowBlur = Math.max(0, shadowDistance);
          ctx.shadowOffsetX = shadowDistance;
          ctx.shadowOffsetY = shadowDistance;
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        }
        if (glowAmount > 0) {
          ctx.save();
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = glowAmount * 2;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        }
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        if (outlineWidth > 0) {
          ctx.shadowColor = 'transparent';
          ctx.filter = 'none';
          ctx.lineWidth = outlineWidth;
          ctx.strokeStyle = outlineColor;
          ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
        }
        ctx.restore();
      } else if (layer.type === 'particles') {
        const count = Math.max(10, Math.round(layer.particleCount ?? 200));
        const direction = (layer.direction ?? 0) * (Math.PI / 180);
        const baseSpeed = Math.max(1, layer.speed ?? 60);
        const sizeMin = Math.max(1, layer.sizeMin ?? 2);
        const sizeMax = Math.max(sizeMin, layer.sizeMax ?? 6);
        const opacityMin = Math.max(0, Math.min(1, layer.opacityMin ?? 0.3));
        const opacityMax = Math.max(opacityMin, Math.min(1, layer.opacityMax ?? 0.9));
        const speedScale = layer.audioResponsive ? (1 + audioAmplitude) : 1;
        const isActive = !!audioEl && !audioEl.paused;
        const state = particleStateRef.current.get(layer.id) ?? {
          particles: [],
          lastTime: nowMs,
          width: drawW,
          height: drawH,
        };
        if (state.width !== drawW || state.height !== drawH) {
          const prevW = state.width || drawW;
          const prevH = state.height || drawH;
          for (const p of state.particles) {
            p.x = (p.x / prevW) * drawW;
            p.y = (p.y / prevH) * drawH;
          }
          state.width = drawW;
          state.height = drawH;
        }
        if (state.particles.length !== count) {
          if (state.particles.length > count) {
            state.particles.length = count;
          } else {
            const missing = count - state.particles.length;
            for (let i = 0; i < missing; i++) {
              state.particles.push({
                x: Math.random() * drawW,
                y: Math.random() * drawH,
                size: sizeMin + Math.random() * (sizeMax - sizeMin),
                opacity: opacityMin + Math.random() * (opacityMax - opacityMin),
                angleOffset: (Math.random() - 0.5) * (Math.PI / 6),
                speedScale: 0.7 + Math.random() * 0.6,
              });
            }
          }
        }
        const dt = isActive ? Math.min(0.05, (nowMs - state.lastTime) / 1000) : 0;
        state.lastTime = nowMs;
        particleStateRef.current.set(layer.id, state);
        ctx.save();
        ctx.translate(x + drawW / 2, y + drawH / 2);
        ctx.rotate(rotateRad);
        if (reverse) ctx.scale(-1, 1);
        ctx.globalAlpha = opacity;
        ctx.fillStyle = layer.color ?? '#7ea5ff';
        const originX = -drawW / 2;
        const originY = -drawH / 2;
        for (const p of state.particles) {
          if (dt > 0) {
            const speed = baseSpeed * p.speedScale * speedScale;
            p.x += Math.cos(direction + p.angleOffset) * speed * dt;
            p.y += Math.sin(direction + p.angleOffset) * speed * dt;
            if (p.x < 0) p.x += drawW;
            if (p.x > drawW) p.x -= drawW;
            if (p.y < 0) p.y += drawH;
            if (p.y > drawH) p.y -= drawH;
          }
          ctx.globalAlpha = opacity * p.opacity;
          ctx.beginPath();
          ctx.arc(originX + p.x, originY + p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (layer.type === 'text') {
        ctx.save();
        ctx.translate(x + drawW / 2, y + drawH / 2);
        ctx.rotate(rotateRad);
        if (reverse) ctx.scale(-1, 1);
        ctx.globalAlpha = opacity;
        const fontSize = Math.max(8, layer.fontSize ?? 12);
        ctx.font = `${fontSize}px ${layer.font ?? 'Segoe UI'}, sans-serif`;
        ctx.fillStyle = layer.color ?? '#ffffff';
        const shadowOpacity = layer.glowOpacity ?? 0.4;
        if (layer.shadowDistance) {
          ctx.save();
          ctx.shadowOffsetX = layer.shadowDistance;
          ctx.shadowOffsetY = layer.shadowDistance;
          ctx.shadowColor = layer.shadowColor ?? '#000000';
          ctx.shadowBlur = 0;
          ctx.fillText(layer.text ?? 'Text', -drawW / 2, 0);
          ctx.restore();
        }
        if (layer.glowAmount) {
          ctx.save();
          ctx.shadowColor = `${layer.glowColor ?? layer.color ?? '#ffffff'}${Math.round(shadowOpacity * 255).toString(16).padStart(2, '0')}`;
          ctx.shadowBlur = layer.glowAmount ?? 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillText(layer.text ?? 'Text', -drawW / 2, 0);
          ctx.restore();
        }
        ctx.strokeStyle = layer.outlineColor ?? '#000000';
        ctx.lineWidth = Math.max(0, layer.outlineWidth ?? 0);
        if ((layer.outlineWidth ?? 0) > 0) {
          ctx.strokeText(layer.text ?? 'Text', -drawW / 2, 0);
        }
        ctx.fillText(layer.text ?? 'Text', -drawW / 2, 0);
        ctx.restore();
      }
    }

    ctx.restore();

    if (previewDockMode === 'detached') {
      const now = performance.now();
      if (now - detachedPreviewFrameAtRef.current > 80) {
        detachedPreviewFrameAtRef.current = now;
        const pop = ensureDetachedPreviewWindow();
        try {
          const img = pop?.document?.getElementById('preview-image') as HTMLImageElement | null;
          if (img && !pop?.closed) {
            img.src = canvas.toDataURL('image/jpeg', 0.9);
          }
        } catch {}
      }
    }

    previewBusyRef.current = false;
    if (previewQueuedRef.current) {
      previewQueuedRef.current = false;
      requestAnimationFrame(() => { void renderPreviewFrame(); });
    }
  }, [audioEl, canvasSize, ensureDetachedPreviewWindow, layers, previewDockMode, resolveActiveClip, session.playhead]);

  useEffect(() => {
    void renderPreviewFrame();
  }, [renderPreviewFrame, session.playhead, layers, videoDurations, session.videoPaths]);

  useEffect(() => {
    const onResize = () => { void renderPreviewFrame(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderPreviewFrame]);

  useEffect(() => {
    if (collapsed.preview) return;
    // Let layout settle after expand/collapse before forcing a redraw.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void renderPreviewFrame();
      });
    });
  }, [collapsed.preview, previewHeight, renderPreviewFrame]);

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = Math.max(0, Math.floor(el.clientWidth));
      setPreviewContainerWidth(width);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const root = appRootRef.current;
    if (!root) return;
    let rafA = 0;
    let rafB = 0;
    const adjustOnce = () => {
      const rect = root.getBoundingClientRect();
      const chrome = Math.max(0, window.outerHeight - window.innerHeight);
      const target = Math.max(600, Math.min(1400, Math.ceil(rect.height + chrome + 6)));
      if (Math.abs(window.outerHeight - target) > 4) {
        window.resizeTo(window.outerWidth, target);
      }
    };
    // Size once after initial layout; do not keep auto-resizing during workflow changes.
    rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(adjustOnce);
    });
    return () => {
      if (rafA) cancelAnimationFrame(rafA);
      if (rafB) cancelAnimationFrame(rafB);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = previewResizeRef.current;
      if (!drag) return;
      const delta = e.clientY - drag.startY;
      const nextH = Math.max(200, Math.min(800, drag.startH + delta));
      setPreviewHeight(nextH);
    };
    const onUp = () => {
      previewResizeRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const vid = previewVideoElRef.current;
    if (!vid) return;
    const active = resolveActiveClip(session.playhead ?? 0);
    if (!active) {
      vid.pause();
      return;
    }
    const src = toFileURL(active.path);
    if (vid.src !== src) {
      vid.src = src;
    }
    if (!isPlaying) {
      try {
        if (Math.abs(vid.currentTime - active.local) > 0.02) {
          vid.currentTime = active.local;
        }
        vid.pause();
      } catch {}
    }
  }, [isPlaying, resolveActiveClip, session.playhead]);

  useEffect(() => {
    if (!isPlaying) return;
    const vid = previewVideoElRef.current;
    if (!vid) return;
    const sync = () => {
      if (!isPlaying || !audioEl) return;
      const active = resolveActiveClip(audioEl.currentTime);
      if (!active) {
        vid.pause();
        return;
      }
      const src = toFileURL(active.path);
      if (vid.src !== src) {
        vid.src = src;
      }
      try {
        if (Math.abs(vid.currentTime - active.local) > 0.08) {
          vid.currentTime = active.local;
        }
        if (vid.paused) {
          vid.play().catch(() => {});
        }
      } catch {}
    };
    const id = window.setInterval(sync, 200);
    sync();
    return () => window.clearInterval(id);
  }, [audioEl, isPlaying, resolveActiveClip]);

  const titleMenus = useMemo<{ label: string; items: TitleMenuItem[] }[]>(() => ([
    {
      label: 'File',
      items: [
        { label: 'New Project', action: 'project:new' },
        { label: 'Open Project...', action: 'project:open' },
        { separator: true, label: '' },
        { label: 'Save', action: 'project:save' },
        { label: 'Save As...', action: 'project:saveAs' },
        { separator: true, label: '' },
        { label: 'Advanced Settings', action: 'preferences:advanced' },
        { separator: true, label: '' },
        { label: 'Render', action: 'render:start' },
        { label: 'Cancel Render', action: 'render:cancel' },
        { label: 'Clear Render Logs', action: 'render:clearLogs' },
      ],
    },
    {
      label: 'Media',
      items: [
        { label: 'Open Media Library', action: 'media:openLibrary' },
        { separator: true, label: '' },
        { label: 'Load Audio...', action: 'media:loadAudio' },
        { label: 'Add Videos...', action: 'media:addVideos' },
        { label: 'Add From Library...', action: 'media:addFromLibrary' },
      ],
    },
    {
      label: 'Layers',
      items: [
        { label: 'Add Visualizer', action: 'layer:addSpectrograph' },
        { label: 'Add Text', action: 'layer:addText' },
        { separator: true, label: '' },
        { label: 'Move Layer Up', action: 'layer:moveUp' },
        { label: 'Move Layer Down', action: 'layer:moveDown' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Developer Tools', action: 'view:toggleDevTools' },
        { label: 'Refresh', action: 'view:refresh' },
        { separator: true, label: '' },
        { label: 'Zoom Timeline In', action: 'view:zoomIn' },
        { label: 'Zoom Timeline Out', action: 'view:zoomOut' },
        { label: 'Zoom Timeline Fit', action: 'view:zoomFit' },
        { separator: true, label: '' },
        { label: 'Dock Preview Top', action: 'dock:top' },
        { label: 'Dock Preview Left', action: 'dock:left' },
        { label: 'Dock Preview Right', action: 'dock:right' },
        { label: 'Dock Preview Bottom', action: 'dock:bottom' },
        { label: 'Detach Preview', action: 'dock:detach' },
        { separator: true, label: '' },
        { label: 'Theme: Auto', action: 'view:theme:auto' },
        { label: 'Theme: Dark', action: 'view:theme:dark' },
        { label: 'Theme: Light', action: 'view:theme:light' },
        { separator: true, label: '' },
        { label: 'Toggle Logs', action: 'view:toggleLogs' },
        { label: 'Toggle Fullscreen', action: 'view:toggleFullscreen' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Activation Info', action: 'help:activation' },
        { label: 'Unlicense', action: 'help:unlicense' },
        { separator: true, label: '' },
        { label: 'About vizmatic', action: 'help:about' },
      ],
    },
  ]), []);

  const runTitleMenuAction = (action: string) => {
    setOpenTitleMenu(null);
    handleMenuAction(action);
  };

  return (
    <div ref={appRootRef} style={{ padding: 2 }}>
      <div className="app-titlebar" ref={titlebarRef}>
        <div className="app-titlebar__left">
          <img className="app-titlebar__logo" src={assetHref('ui/vizmatic_noText_logo.png')} alt="" />
          <div className="app-titlebar__menus">
            {titleMenus.map((menu) => (
              <div key={menu.label} className="app-titlebar__menu-group">
                <button
                  type="button"
                  className={`app-titlebar__menu-btn${openTitleMenu === menu.label ? ' is-open' : ''}`}
                  onClick={() => setOpenTitleMenu((prev) => (prev === menu.label ? null : menu.label))}
                >
                  {menu.label}
                </button>
                {openTitleMenu === menu.label && (
                  <div className="app-titlebar__menu-dropdown">
                    {menu.items.map((item, idx) => item.separator ? (
                      <div key={`${menu.label}-sep-${idx}`} className="app-titlebar__menu-separator" />
                    ) : (
                      <button
                        key={`${menu.label}-${item.label}`}
                        type="button"
                        className="app-titlebar__menu-item"
                        onClick={() => item.action && runTitleMenuAction(item.action)}
                        disabled={
                          (item.action === 'layer:moveUp' && !(selectedLayerId && layers.findIndex((l) => l.id === selectedLayerId) > 0))
                          || (item.action === 'layer:moveDown' && !(selectedLayerId && layers.findIndex((l) => l.id === selectedLayerId) < (layers.length - 1)))
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="app-titlebar__title">vizmatic</div>
        <div className="app-titlebar__right">
          <div className="app-titlebar__dock-buttons">
            <button type="button" className={`app-titlebar__window-btn${previewDockMode === 'top' ? ' is-active' : ''}`} title="Dock Top" onClick={() => runTitleMenuAction('dock:top')}>
              <MaterialIcon name="top_panel_open" ariaHidden />
            </button>
            <button type="button" className={`app-titlebar__window-btn${previewDockMode === 'left' ? ' is-active' : ''}`} title="Dock Left" onClick={() => runTitleMenuAction('dock:left')}>
              <MaterialIcon name="left_panel_open" ariaHidden />
            </button>
            <button type="button" className={`app-titlebar__window-btn${previewDockMode === 'bottom' ? ' is-active' : ''}`} title="Dock Bottom" onClick={() => runTitleMenuAction('dock:bottom')}>
              <MaterialIcon name="bottom_panel_open" ariaHidden />
            </button>
            <button type="button" className={`app-titlebar__window-btn${previewDockMode === 'right' ? ' is-active' : ''}`} title="Dock Right" onClick={() => runTitleMenuAction('dock:right')}>
              <MaterialIcon name="right_panel_open" ariaHidden />
            </button>
            <button
              type="button"
              className={`app-titlebar__window-btn${previewDockMode === 'detached' ? ' is-active' : ''}`}
              title={previewDockMode === 'detached' ? 'Re-attach Preview' : 'Detach Preview'}
              onClick={() => runTitleMenuAction(previewDockMode === 'detached' ? 'dock:top' : 'dock:detach')}
            >
              <MaterialIcon name={previewDockMode === 'detached' ? 'call_merge' : 'open_in_new'} ariaHidden />
            </button>
          </div>
          <button type="button" className="app-titlebar__window-btn" title="Minimize" onClick={() => void minimizeWindow()}>
            <MaterialIcon name="remove" ariaHidden />
          </button>
          <button type="button" className="app-titlebar__window-btn" title={isMaximized ? 'Restore' : 'Maximize'} onClick={() => void toggleMaximizeWindow()}>
            <MaterialIcon name={isMaximized ? 'filter_none' : 'crop_square'} ariaHidden />
          </button>
          <button type="button" className="app-titlebar__window-btn is-close" title="Close" onClick={() => void closeWindow()}>
            <MaterialIcon name="close" ariaHidden />
          </button>
        </div>
      </div>
      <div className={`grid workspace workspace--${previewDockMode}`}>

        {/* Preview Row */}
        <div className="right section-block preview-block" style={{ opacity: renderLocked ? 0.8 : 1 }}>
          <div className="section-header">
            {editingProjectName ? (
              <input
                type="text"
                value={projectNameDraft}
                onChange={(e) => setProjectNameDraft(e.target.value)}
                onBlur={applyProjectRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyProjectRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelProjectRename();
                  }
                }}
                autoFocus
                style={{
                  margin: '1px 0px',
                  minWidth: 220,
                  maxWidth: 430,
                  height: 28,
                  padding: '2px 10px 2px 0px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontFamily: "Laritza",
                  fontSize: 22,
                  fontWeight: 400,
                  lineHeight: 1,
                }}
                aria-label="Project name"
              />
            ) : (
              <button
                type="button"
                onClick={beginProjectRename}
                title="Rename project"
                style={{
                  minWidth: 220,
                  maxWidth: 430,
                  margin: '0px 0px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: '#1a2c46',
                  color: 'var(--text)',
                  fontFamily: "Laritza",
                  fontSize: 22,
                  fontWeight: 400,
                  lineHeight: 1,
                  cursor: 'text',
                  padding: '8px 0px 2px 0px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {getProjectName()}
              </button>
            )}
            <button className="pill-btn pill-btn--icon" type="button" onClick={handleNewProject} title="New Project" aria-label="New Project" disabled={renderLocked}>
              <MaterialIcon name="note_add" ariaHidden />
            </button>
            <button className="pill-btn pill-btn--icon" type="button" onClick={handleLoadProject} title="Load Project" aria-label="Load Project" disabled={projectLocked || renderLocked}>
              <MaterialIcon name="folder_open" ariaHidden />
            </button>
            <button className="pill-btn pill-btn--icon" type="button" onClick={handleSaveProjectAs} title="Save Project As" aria-label="Save Project As" disabled={projectLocked || renderLocked}>
              <MaterialIcon name="save_as" ariaHidden />
            </button>
            <button className="pill-btn pill-btn--icon" type="button" onClick={handleSaveProject} title="Save Project" aria-label="Save Project" disabled={projectLocked || renderLocked}>
              <MaterialIcon name="save" ariaHidden />
            </button>
            <button className="pill-btn pill-btn--icon" type="button" onClick={() => void openMediaLibraryWindow()} title="Open Media Library" aria-label="Open Media Library" disabled={renderLocked}>
              <MaterialIcon name="video_library" ariaHidden />
            </button>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px 0 2px' }} />
            {(!isRendering) && (
              <button className="pill-btn pill-btn--icon" type="button" onClick={handleStartRender} disabled={projectLocked || !session.projectSavePath || renderLocked} title="Render" aria-label="Render">
                <MaterialIcon name="movie" ariaHidden />
              </button>
            )}
            {(isRendering) && (
              <button className="pill-btn pill-btn--icon" type="button" onClick={() => cancelRender()} disabled={projectLocked || !isRendering} title="Cancel Render" aria-label="Cancel Render">
                <MaterialIcon name="cancel" ariaHidden />
              </button>
            )}
            {(isRendering || renderTotalMs > 0) && (
              <div style={{ height: 18, width: 160, background: '#222', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, (renderTotalMs > 0 ? (renderElapsedMs / renderTotalMs) * 100 : 0))).toFixed(1)}%`, background: '#3f51b5' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: '#d8def6', fontWeight: 600 }}>
                  <span>Elapsed {formatClock(renderElapsedMs / 1000)}</span>
                  {isRendering && (
                    <span>[ Task {renderElapsedMs > 0 ? 2 : 1} of 2 ]</span>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="collapse-btn" type="button" onClick={() => toggleSection('preview')} aria-label="Toggle preview" disabled={renderLocked}>
                <MaterialIcon name={collapsed.preview ? 'expand_more' : 'expand_less'} ariaHidden />
              </button>
            </div>
            {projectLocked && (
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  bottom: 2,
                  left: 2,
                  right: 44,
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.7), rgba(239, 68, 68, 0.7))',
                  color: '#0b0f16',
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '0 12px',
                  zIndex: 2,
                  cursor: 'pointer',
                  boxShadow: '0 10px 18px rgba(239, 68, 68, 0.35)',
                }}
                onClick={() => setLicenseModalOpen(true)}
              >
                Trial Edition: Click here to upgrade to the Full Version.
              </div>
            )}
          </div>
          {!collapsed.preview && (
            <div className="section-body" style={{ padding: 0 }}>
              <div ref={previewContainerRef} style={{ display: 'flex', justifyContent: 'center', background: '#0b0f16', borderRadius: 8, position: 'relative' }}>
                <video
                  ref={previewVideoElRef}
                  muted
                  playsInline
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: Math.max(1, canvasSize.width * Math.min(previewHeight / canvasSize.height, previewContainerWidth ? (previewContainerWidth / canvasSize.width) : Infinity)),
                    height: Math.max(1, canvasSize.height * Math.min(previewHeight / canvasSize.height, previewContainerWidth ? (previewContainerWidth / canvasSize.width) : Infinity)),
                    objectFit: 'contain',
                    borderRadius: 8,
                    background: '#0b0f16',
                    zIndex: 1,
                  }}
                />
                <canvas
                  ref={previewCanvasRef}
                  style={{
                    width: Math.max(1, canvasSize.width * Math.min(previewHeight / canvasSize.height, previewContainerWidth ? (previewContainerWidth / canvasSize.width) : Infinity)),
                    height: Math.max(1, canvasSize.height * Math.min(previewHeight / canvasSize.height, previewContainerWidth ? (previewContainerWidth / canvasSize.width) : Infinity)),
                    display: 'block',
                    borderRadius: 8,
                    background: 'transparent',
                    position: 'relative',
                    zIndex: 2,
                  }}
                />
              </div>
              <div
                role="presentation"
                onMouseDown={(e) => {
                  previewResizeRef.current = { startY: e.clientY, startH: previewHeight };
                }}
                style={{ height: 8, cursor: 'row-resize' }}
              />
            </div>
          )}
        </div>

        {/* Media Row */}
        <div className="right section-block media-block" style={{ opacity: renderLocked ? 0.35 : (hasAudio ? 1 : 0.6), pointerEvents: renderLocked ? 'none' : 'auto' }}>
          <div className="section-header">
            <PillIconButton icon="video_call" label="Add Video" onClick={handleBrowseVideos} disabled={!hasAudio} />
            <PillIconButton icon="graphic_eq" label="Visualizer" onClick={() => startNewLayer('spectrograph')} disabled={!hasAudio} />
            <PillIconButton icon="text_fields" label="Text" onClick={() => startNewLayer('text')} disabled={!hasAudio} />
            <PillIconButton icon="image" label="Image" onClick={() => startNewLayer('image')} disabled={!hasAudio} />
            <PillIconButton icon="blur_on" label="Particles" onClick={() => startNewLayer('particles')} disabled={!hasAudio} />

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="pill-btn pill-btn--icon"
                type="button"
                aria-label={canvasPreset === 'landscape' ? 'Switch to portrait canvas' : 'Switch to landscape canvas'}
                title={canvasPreset === 'landscape' ? 'Canvas: Landscape (click for Portrait)' : 'Canvas: Portrait (click for Landscape)'}
                onClick={() => setCanvasPreset((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))}
                disabled={renderLocked}
              >
                <img
                  className="pill-btn__img"
                  src={assetHref('ui/icon-rotate.png')}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = assetHref('ui/icon-landscape.png');
                  }}
                  alt=""
                  style={{
                    transform: `rotate(${canvasPreset === 'portrait' ? 90 : 0}deg)`,
                    transition: 'transform 150ms ease',
                  }}
                />
              </button>
              <button className="collapse-btn" type="button" onClick={() => toggleSection('audio')} aria-label="Toggle media">
                <MaterialIcon name={collapsed.audio ? 'expand_more' : 'expand_less'} ariaHidden />
              </button>
            </div>
          </div>
          {!collapsed.audio && (
            <div className="section-body" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
              <div
                style={{ position: 'relative' }}
                onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) handleDroppedMedia(e.dataTransfer);
                }}
              >
                <OverviewWaveform
                  duration={audioDuration}
                  playhead={session.playhead ?? 0}
                  onSeek={(t: number) => setSession((prev) => ({ ...prev, playhead: t }))}
                  peaks={overviewPeaks}
                  hasAudio={!!session.audioPath}
                  zoom={timelineZoom}
                  scroll={timelineScroll}
                  onEmptyClick={handleBrowseAudio}
                />
                <div style={{ position: 'absolute', left: 8, top: 6, flexDirection: 'column' }}>
                  <button className="pill-btn pill-btn--compact pill-btn--glass" style={{ position: 'relative', top: '25px', width: '46px', height: '46px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} type="button" title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => waveRef.current?.toggle()} disabled={!session.audioPath}>
                    <MaterialIcon name={isPlaying ? 'pause' : 'play_arrow'} size={30} ariaHidden />
                  </button>
                </div>

                {hasAudio && (
                  <button
                    className="pill-btn pill-btn--icon pill-btn--glass"
                    type="button"
                    title="Replace audio"
                    aria-label="Replace audio"
                    onClick={handleBrowseAudio}
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: 6,
                      width: 20,
                      height: 20,
                      minWidth: 20,
                      minHeight: 20,
                      borderRadius: '50%',
                      padding: 0,
                    }}
                  >
                    <MaterialIcon name="refresh" size={18} ariaHidden />
                  </button>
                )}

                <div style={{ position: 'absolute', left: 8, bottom: 6, opacity: hasAudio ? 1 : 0.4, pointerEvents: hasAudio ? 'auto' : 'none' }}>
                  <div className="pill-btn pill-btn--glass" style={{ padding: '2px 6px', marginTop: 3 }}>
                    <VolumeSlider value={volume} onChange={(v) => setVolume(Math.min(1, Math.max(0, v)))} width={150} />
                  </div>
                </div>

                <div style={{ position: 'absolute', right: 8, top: 9, display: 'flex', alignItems: 'center', gap: 4, opacity: hasAudio ? 1 : 0.4, pointerEvents: hasAudio ? 'auto' : 'none' }}>
                  <div className="pill-btn pill-btn--glass" role="group" aria-label="Timeline zoom" style={{ padding: '2px 6px' }}>
                    <button className="pill-btn pill-btn--compact" style={{ border: '0px', padding: '0px' }} type="button" onClick={() => { setTimelineZoom((z) => Math.max(0.25, z / 2)); setTimelineScroll(0); }} aria-label="Zoom out" disabled={!hasAudio}>
                      <MaterialIcon name="zoom_out" ariaHidden />
                    </button>
                    <span className="muted" style={{ minWidth: 48, lineHeight: 0.6, textAlign: 'center', fontSize: 12, marginTop: 3 }}>{Math.round(timelineZoom * 100)}%</span>
                    <button className="pill-btn pill-btn--compact" style={{ border: '0px', padding: '0px' }} type="button" onClick={() => { setTimelineZoom((z) => Math.min(8, z * 2)); setTimelineScroll(0); }} aria-label="Zoom in" disabled={!hasAudio}>
                      <MaterialIcon name="zoom_in" ariaHidden />
                    </button>
                  </div>
                  <button className="pill-btn pill-btn--glass pill-btn--compact" type="button" onClick={() => { setTimelineZoom(1); setTimelineScroll(0); }} disabled={!hasAudio}>
                    <span style={{ marginLeft: 3, marginRight: 3, display: 'inline-flex' }}>
                      <MaterialIcon name="center_focus_strong" ariaHidden />
                    </span>
                    <span className="pill-btn__label">Fit</span>
                  </button>
                </div>

                <div className="time-pill" style={{ position: 'absolute', right: 8, bottom: 6 }}>
                  <span>{formatClock(session.playhead ?? 0)}</span>
                  <span>/</span>
                  <span>{formatClock(audioDuration)}</span>
                </div>
                <Waveform
                  ref={waveRef as any}
                  srcPath={session.audioPath ?? ''}
                  playhead={session.playhead ?? 0}
                  onPlayheadChange={(t) => setSession((prev) => ({ ...prev, playhead: t }))}
                  onDurationChange={(d) => setAudioDuration(d)}
                  onPlayingChange={(p) => setIsPlaying(p)}
                  volume={volume}
                  useElementVolume={false}
                  hideBuiltInControls
                  hideCanvas
                  onAudioElement={(el) => { setAudioEl(el); }}
                />
                {!hasAudio && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#e7b77a', fontWeight: 700, textAlign: 'center' }}>
                      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontFamily: 'Laritza, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif', fontSize: 20, letterSpacing: 2, marginBottom: 8 }}>
                          Drag file or click to browse
                        </div>
                        <button
                          className="pill-btn pill-btn--glass"
                          type="button"
                          onClick={handleBrowseAudio}
                          style={{ pointerEvents: 'auto' }}
                        >
                          <MaterialIcon name="library_music" ariaHidden />
                          <span className="pill-btn__label">Load Audio</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 4, opacity: hasAudio ? 1 : 0.4, pointerEvents: hasAudio ? 'auto' : 'none' }}>
                {(session.videoPaths?.length ?? 0) > 0 ? (
                  <Storyboard
                    segments={clipSegments.map((seg, idx) => ({
                      id: seg.id,
                      path: seg.path,
                      index: idx,
                      label: clipNames[seg.path] ?? seg.path,
                      duration: seg.duration,
                      start: seg.start ?? 0,
                      trimStart: seg.trimStart,
                      trimEnd: seg.trimEnd,
                      sourceDuration: seg.sourceDuration,
                      fillMethod: seg.fillMethod,
                      missing: missingPaths.has(seg.path),
                    }))}
                    totalDuration={timelineDuration}
                    zoom={timelineZoom}
                    scroll={timelineScroll}
                    playhead={session.playhead ?? 0}
                    onReorder={handleReorderClips}
                    onRemove={removeClipAt}
                    onTrimDrag={(id, update) => applyClipTrimDrag(id, update)}
                    onContextMenu={(seg, x, y) => openClipContextMenu(seg.id, seg.path, seg.index, x, y)}
                    onDoubleClick={(seg) => handleClipEdit(seg.id, seg.path, seg.index)}
                  />
                ) : null}
              </div>
              {session.audioPath && (
                <div style={{ marginTop: 4, padding: '2px 8px' }}>
                  <div style={{ height: 12, background: '#1e2432', borderRadius: 6, position: 'relative' }} onClick={(e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    setTimelineScroll(pct);
                  }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: `${Math.min(1, Math.max(0, timelineScroll)) * Math.max(0, 1 - 1 / Math.max(1, timelineZoom)) * 100}%`,
                        top: 2,
                        height: 8,
                        width: `${Math.min(100, (1 / Math.max(1, timelineZoom)) * 100)}%`,
                        background: '#3f51b5',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const onMove = (ev: MouseEvent) => {
                          const rect = (e.currentTarget!.parentElement as HTMLDivElement).getBoundingClientRect();
                          const pct = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
                          setTimelineScroll(pct);
                        };
                        const onUp = () => {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Layers Row */}
        {layers.length > 0 && (
        <div className="right section-block layers-block" style={{ opacity: workflowLocked || renderLocked ? 0.35 : 1, pointerEvents: workflowLocked || renderLocked ? 'none' : 'auto', marginTop: -8 }}>
          <div className="section-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {layers.map((layer, idx) => (
                    <div
                      key={layer.id}
                      onClick={() => openEditLayer(layer)}
                      onDragOver={(e) => {
                        if (layerDragId && layerDragId !== layer.id) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (layerDragId && layerDragId !== layer.id) {
                          moveLayerToIndex(layerDragId, idx);
                          setLayerDragId(null);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        background: selectedLayerId === layer.id ? hexToRgba(layer.color, 0.16) : 'var(--panel-alt)',
                        border: `1px solid ${selectedLayerId === layer.id ? hexToRgba(layer.color, 0.45) : 'var(--border)'}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setLayerDragId(layer.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setLayerDragId(null)}
                        title="Reorder layer"
                        style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20 }}
                      >
                        <MaterialIcon name="drag_indicator" ariaHidden />
                      </div>
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: layer.color }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>
                          {layer.type === 'text'
                            ? 'Text Layer'
                            : layer.type === 'image'
                              ? 'Image Layer'
                              : layer.type === 'particles'
                                ? 'Particles Layer'
                                : 'Spectrograph Layer'}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {layer.type === 'text'
                            ? `Text: ${(layer as any).text ?? ''} @ (${Math.round(layer.x * 100)}%, ${Math.round(layer.y * 100)}%), font ${(layer as any).font ?? ''} ${(layer as any).fontSize ?? ''}`
                            : layer.type === 'image'
                              ? `Image: ${(layer as any).imagePath ? ((layer as any).imagePath as string).split(/[\\/]/).pop() : 'None'} @ (${Math.round(layer.x * 100)}%, ${Math.round(layer.y * 100)}%)`
                              : layer.type === 'particles'
                                ? `Particles @ (${Math.round(layer.x * 100)}%, ${Math.round(layer.y * 100)}%)`
                                : `Mode: ${(layer as any).mode ?? 'bar'} @ (${Math.round(layer.x * 100)}%, ${Math.round(layer.y * 100)}%)`}
                        </div>
                      </div>
                      <button className="pill-btn" type="button" onClick={(e) => { e.stopPropagation(); openEditLayer(layer); }}>Edit</button>
                      <button className="pill-btn" type="button" onClick={(e) => { e.stopPropagation(); duplicateLayer(layer); }}>Duplicate</button>
                      <button className="pill-btn" type="button" onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}>Delete</button>
                    </div>
              ))}
            </div>
            {layerDialogOpen && (
                <div className="panel" style={{ marginTop: 10, padding: 12, background: selectedLayer ? hexToRgba(selectedLayer.color, 0.12) : 'var(--panel-alt)', borderColor: selectedLayer ? hexToRgba(selectedLayer.color, 0.35) : 'var(--border)' }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Type
                      <select
                        className="pill-select"
                        value={layerDraft.type ?? 'spectrograph'}
                        onChange={(e) => {
                          const nextType = e.target.value as LayerType;
                          const prev = layerDraft;
                          updateLayerDraftField({
                            type: nextType,
                            mode: nextType === 'spectrograph' ? (prev.mode as any) ?? 'bar' : undefined,
                            pathMode: nextType === 'spectrograph' ? (prev.pathMode as any) ?? 'straight' : undefined,
                            barCount: nextType === 'spectrograph' ? (prev.barCount ?? 96) : undefined,
                            barWidthPct: nextType === 'spectrograph' ? (prev.barWidthPct ?? 0.8) : undefined,
                            dotCount: nextType === 'spectrograph' ? (prev.dotCount ?? 96) : undefined,
                            solidPointCount: nextType === 'spectrograph' ? (prev.solidPointCount ?? 96) : undefined,
                            freqScale: nextType === 'spectrograph' ? (prev.freqScale ?? 'log') : undefined,
                            ampScale: nextType === 'spectrograph' ? (prev.ampScale ?? 'log') : undefined,
                            averaging: nextType === 'spectrograph' ? (prev.averaging ?? 2) : undefined,
                            mirrorX: nextType === 'spectrograph' ? (prev.mirrorX ?? false) : undefined,
                            mirrorY: nextType === 'spectrograph' ? (prev.mirrorY ?? false) : undefined,
                            text: nextType === 'text' ? (prev.text ?? 'Text') : undefined,
                            font: nextType === 'text' ? (prev.font ?? 'Segoe UI') : undefined,
                            fontSize: nextType === 'text' ? (prev.fontSize ?? 12) : undefined,
                            imagePath: nextType === 'image' ? (prev.imagePath ?? '') : undefined,
                            motionAffected: nextType === 'image' ? (prev.motionAffected ?? true) : undefined,
                            direction: nextType === 'particles' ? (prev.direction ?? 0) : undefined,
                            speed: nextType === 'particles' ? (prev.speed ?? 60) : undefined,
                            sizeMin: nextType === 'particles' ? (prev.sizeMin ?? 2) : undefined,
                            sizeMax: nextType === 'particles' ? (prev.sizeMax ?? 6) : undefined,
                            opacityMin: nextType === 'particles' ? (prev.opacityMin ?? 0.3) : undefined,
                            opacityMax: nextType === 'particles' ? (prev.opacityMax ?? 0.9) : undefined,
                            audioResponsive: nextType === 'particles' ? (prev.audioResponsive ?? true) : undefined,
                            particleCount: nextType === 'particles' ? (prev.particleCount ?? 200) : undefined,
                          } as unknown as Partial<LayerConfig>);
                        }}
                      >
                        <option value="spectrograph">Standard Spectrograph</option>
                        <option value="text">Text</option>
                        <option value="image">Image</option>
                        <option value="particles">Particles</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Color
                      <input type="color" value={layerDraft.color ?? '#ffffff'} onChange={(e) => updateLayerDraftField({ color: e.target.value })} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Outline Color
                      <input type="color" value={layerDraft.outlineColor ?? '#000000'} onChange={(e) => updateLayerDraftField({ outlineColor: e.target.value })} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Outline Width
                      <input type="range" min={0} max={20} value={layerDraft.outlineWidth ?? 0} onChange={(e) => updateLayerDraftField({ outlineWidth: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Outline Width (px)', layerDraft.outlineWidth ?? 0, 0, 20, (v) => updateLayerDraftField({ outlineWidth: v }))}
                      >
                        {layerDraft.outlineWidth ?? 0}px
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Glow Color
                      <input type="color" value={layerDraft.glowColor ?? '#ffffff'} onChange={(e) => updateLayerDraftField({ glowColor: e.target.value })} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Glow Amount
                      <input type="range" min={0} max={50} value={layerDraft.glowAmount ?? 0} onChange={(e) => updateLayerDraftField({ glowAmount: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Glow Amount (px)', layerDraft.glowAmount ?? 0, 0, 50, (v) => updateLayerDraftField({ glowAmount: v }))}
                      >
                        {layerDraft.glowAmount ?? 0}px
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Glow Opacity
                      <input type="range" min={0} max={1} step={0.05} value={layerDraft.glowOpacity ?? 0.4} onChange={(e) => updateLayerDraftField({ glowOpacity: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Glow Opacity (0..1)', layerDraft.glowOpacity ?? 0.4, 0, 1, (v) => updateLayerDraftField({ glowOpacity: v }))}
                      >
                        {(layerDraft.glowOpacity ?? 0.4).toFixed(2)}
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Shadow Color
                      <input type="color" value={layerDraft.shadowColor ?? '#000000'} onChange={(e) => updateLayerDraftField({ shadowColor: e.target.value })} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Shadow Distance
                      <input type="range" min={0} max={50} value={layerDraft.shadowDistance ?? 0} onChange={(e) => updateLayerDraftField({ shadowDistance: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Shadow Distance (px)', layerDraft.shadowDistance ?? 0, 0, 50, (v) => updateLayerDraftField({ shadowDistance: v }))}
                      >
                        {layerDraft.shadowDistance ?? 0}px
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      X (%)
                      <input type="range" min={-100} max={100} value={Math.round((layerDraft.x ?? 0) * 100)} onChange={(e) => updateLayerDraftField({ x: Math.min(100, Math.max(-100, Number(e.target.value))) / 100 })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('X (%)', Math.round((layerDraft.x ?? 0) * 100), -100, 100, (v) => updateLayerDraftField({ x: v / 100 }))}
                      >
                        {Math.round((layerDraft.x ?? 0) * 100)}%
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Y (%)
                      <input type="range" min={-100} max={100} value={Math.round((layerDraft.y ?? 0) * 100)} onChange={(e) => updateLayerDraftField({ y: Math.min(100, Math.max(-100, Number(e.target.value))) / 100 })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Y (%)', Math.round((layerDraft.y ?? 0) * 100), -100, 100, (v) => updateLayerDraftField({ y: v / 100 }))}
                      >
                        {Math.round((layerDraft.y ?? 0) * 100)}%
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Rotate
                      <input type="range" min={0} max={360} value={Math.round(layerDraft.rotate ?? 0)} onChange={(e) => updateLayerDraftField({ rotate: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Rotate (deg)', Math.round(layerDraft.rotate ?? 0), 0, 360, (v) => updateLayerDraftField({ rotate: v }))}
                      >
                        {Math.round(layerDraft.rotate ?? 0)}deg
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Transparency
                      <input type="range" min={0} max={100} value={Math.round((layerDraft.opacity ?? 1) * 100)} onChange={(e) => updateLayerDraftField({ opacity: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Transparency (%)', Math.round((layerDraft.opacity ?? 1) * 100), 0, 100, (v) => updateLayerDraftField({ opacity: v / 100 }))}
                      >
                        {Math.round((layerDraft.opacity ?? 1) * 100)}%
                      </span>
                    </label>
                    {layerDraft.type === 'spectrograph' && (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Path
                          <select
                            className="pill-select"
                            value={layerDraft.pathMode ?? 'straight'}
                            onChange={(e) => updateLayerDraftField({ pathMode: e.target.value as 'straight' | 'circular' })}
                          >
                            <option value="straight">Straight</option>
                            <option value="circular">Circular</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Frequency Scale
                          <select
                            className="pill-select"
                            value={layerDraft.freqScale ?? 'log'}
                            onChange={(e) => updateLayerDraftField({ freqScale: e.target.value as 'lin' | 'log' | 'rlog' })}
                          >
                            <option value="lin">Linear</option>
                            <option value="log">Log</option>
                            <option value="rlog">Reverse Log</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Amplitude Scale
                          <select
                            className="pill-select"
                            value={layerDraft.ampScale ?? 'log'}
                            onChange={(e) => updateLayerDraftField({ ampScale: e.target.value as 'lin' | 'sqrt' | 'cbrt' | 'log' })}
                          >
                            <option value="lin">Linear</option>
                            <option value="sqrt">Sqrt</option>
                            <option value="cbrt">Cbrt</option>
                            <option value="log">Log</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Averaging
                          <input type="range" min={1} max={10} value={layerDraft.averaging ?? 2} onChange={(e) => updateLayerDraftField({ averaging: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Averaging', layerDraft.averaging ?? 2, 1, 10, (v) => updateLayerDraftField({ averaging: v }))}
                          >
                            {layerDraft.averaging ?? 2}
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Mirror X
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.mirrorX}
                            onClick={() => updateLayerDraftField({ mirrorX: !layerDraft.mirrorX })}
                          >
                            <span>{layerDraft.mirrorX ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Mirror Y
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.mirrorY}
                            onClick={() => updateLayerDraftField({ mirrorY: !layerDraft.mirrorY })}
                          >
                            <span>{layerDraft.mirrorY ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Mode
                          <select
                            className="pill-select"
                        value={layerDraft.mode ?? 'bar'}
                        onChange={(e) => updateLayerDraftField({ mode: e.target.value as 'bar' | 'line' | 'solid' | 'dots' })}
                      >
                        <option value="bar">Bar</option>
                        <option value="line">Line</option>
                        <option value="solid">Solid</option>
                        <option value="dots">Dots</option>
                      </select>
                    </label>
                    {(layerDraft.mode ?? 'bar') === 'bar' && (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Bar Count
                          <input type="range" min={8} max={256} value={layerDraft.barCount ?? 96} onChange={(e) => updateLayerDraftField({ barCount: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Bar Count', layerDraft.barCount ?? 96, 8, 256, (v) => updateLayerDraftField({ barCount: v }))}
                          >
                            {layerDraft.barCount ?? 96}
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Bar Width (%)
                          <input type="range" min={10} max={100} value={Math.round((layerDraft.barWidthPct ?? 0.8) * 100)} onChange={(e) => updateLayerDraftField({ barWidthPct: Number(e.target.value) / 100 })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Bar Width (%)', Math.round((layerDraft.barWidthPct ?? 0.8) * 100), 10, 100, (v) => updateLayerDraftField({ barWidthPct: v / 100 }))}
                          >
                            {Math.round((layerDraft.barWidthPct ?? 0.8) * 100)}%
                          </span>
                        </label>
                      </>
                    )}
                    {(layerDraft.mode ?? 'bar') === 'dots' && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        Dot Count
                        <input type="range" min={8} max={256} value={layerDraft.dotCount ?? 96} onChange={(e) => updateLayerDraftField({ dotCount: Number(e.target.value) })} />
                        <span
                          className="muted"
                          style={{ fontSize: 12 }}
                          onDoubleClick={() => promptNumeric('Dot Count', layerDraft.dotCount ?? 96, 8, 256, (v) => updateLayerDraftField({ dotCount: v }))}
                        >
                          {layerDraft.dotCount ?? 96}
                        </span>
                      </label>
                    )}
                    {(layerDraft.mode ?? 'bar') === 'solid' && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        Solid Points
                        <input type="range" min={8} max={256} value={layerDraft.solidPointCount ?? 96} onChange={(e) => updateLayerDraftField({ solidPointCount: Number(e.target.value) })} />
                        <span
                          className="muted"
                          style={{ fontSize: 12 }}
                          onDoubleClick={() => promptNumeric('Solid Points', layerDraft.solidPointCount ?? 96, 8, 256, (v) => updateLayerDraftField({ solidPointCount: v }))}
                        >
                          {layerDraft.solidPointCount ?? 96}
                        </span>
                      </label>
                    )}
                  </>
                )}
                {layerDraft.type === 'spectrograph' && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Width (px)
                      <input type="range" min={50} max={4000} value={Math.round(layerDraft.width ?? canvasSize.width)} onChange={(e) => updateLayerDraftField({ width: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Width (px)', Math.round(layerDraft.width ?? canvasSize.width), 50, 4000, (v) => updateLayerDraftField({ width: v }))}
                      >
                        {Math.round(layerDraft.width ?? canvasSize.width)} px
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Height (px)
                      <input type="range" min={50} max={3000} value={Math.round(layerDraft.height ?? canvasSize.height)} onChange={(e) => updateLayerDraftField({ height: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Height (px)', Math.round(layerDraft.height ?? canvasSize.height), 50, 3000, (v) => updateLayerDraftField({ height: v }))}
                      >
                        {Math.round(layerDraft.height ?? canvasSize.height)} px
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Invert
                      <button
                        className="pill-btn"
                        type="button"
                        aria-pressed={!!layerDraft.invert}
                        onClick={() => updateLayerDraftField({ invert: !layerDraft.invert })}
                      >
                        <span>{layerDraft.invert ? 'On' : 'Off'}</span>
                      </button>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Reverse
                      <button
                        className="pill-btn"
                        type="button"
                        aria-pressed={!!layerDraft.reverse}
                        onClick={() => updateLayerDraftField({ reverse: !layerDraft.reverse })}
                      >
                        <span>{layerDraft.reverse ? 'On' : 'Off'}</span>
                      </button>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Low Cut (Hz)
                      <input type="range" min={10} max={500} value={layerDraft.lowCutHz ?? 40} onChange={(e) => updateLayerDraftField({ lowCutHz: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('Low Cut (Hz)', layerDraft.lowCutHz ?? 40, 10, 500, (v) => updateLayerDraftField({ lowCutHz: v }))}
                      >
                        {layerDraft.lowCutHz ?? 40} Hz
                      </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      High Cut (Hz)
                      <input type="range" min={2000} max={20000} step={100} value={layerDraft.highCutHz ?? 16000} onChange={(e) => updateLayerDraftField({ highCutHz: Number(e.target.value) })} />
                      <span
                        className="muted"
                        style={{ fontSize: 12 }}
                        onDoubleClick={() => promptNumeric('High Cut (Hz)', layerDraft.highCutHz ?? 16000, 2000, 20000, (v) => updateLayerDraftField({ highCutHz: v }))}
                      >
                        {layerDraft.highCutHz ?? 16000} Hz
                      </span>
                    </label>
                  </>
                    )}
                    {layerDraft.type === 'image' && (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240 }}>
                          Image File
                          <input type="text" value={layerDraft.imagePath ?? ''} readOnly />
                          <button className="pill-btn" type="button" onClick={handlePickImageForLayer}>
                            <span>Browse</span>
                          </button>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Width (px)
                          <input type="range" min={20} max={4000} value={Math.round(layerDraft.width ?? 320)} onChange={(e) => updateLayerDraftField({ width: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Width (px)', Math.round(layerDraft.width ?? 320), 20, 4000, (v) => updateLayerDraftField({ width: v }))}
                          >
                            {Math.round(layerDraft.width ?? 320)} px
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Height (px)
                          <input type="range" min={20} max={3000} value={Math.round(layerDraft.height ?? 320)} onChange={(e) => updateLayerDraftField({ height: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Height (px)', Math.round(layerDraft.height ?? 320), 20, 3000, (v) => updateLayerDraftField({ height: v }))}
                          >
                            {Math.round(layerDraft.height ?? 320)} px
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Invert
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.invert}
                            onClick={() => updateLayerDraftField({ invert: !layerDraft.invert })}
                          >
                            <span>{layerDraft.invert ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Reverse
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.reverse}
                            onClick={() => updateLayerDraftField({ reverse: !layerDraft.reverse })}
                          >
                            <span>{layerDraft.reverse ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Motion Affected
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.motionAffected}
                            onClick={() => updateLayerDraftField({ motionAffected: !layerDraft.motionAffected })}
                          >
                            <span>{layerDraft.motionAffected ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                      </>
                    )}
                    {layerDraft.type === 'particles' && (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Direction (deg)
                          <input type="range" min={0} max={360} value={Math.round(layerDraft.direction ?? 0)} onChange={(e) => updateLayerDraftField({ direction: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Direction (deg)', Math.round(layerDraft.direction ?? 0), 0, 360, (v) => updateLayerDraftField({ direction: v }))}
                          >
                            {Math.round(layerDraft.direction ?? 0)}deg
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Speed
                          <input type="range" min={0} max={300} value={Math.round(layerDraft.speed ?? 60)} onChange={(e) => updateLayerDraftField({ speed: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Speed', Math.round(layerDraft.speed ?? 60), 0, 300, (v) => updateLayerDraftField({ speed: v }))}
                          >
                            {Math.round(layerDraft.speed ?? 60)}
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Size Min (px)
                          <input type="range" min={1} max={50} value={Math.round(layerDraft.sizeMin ?? 2)} onChange={(e) => updateLayerDraftField({ sizeMin: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Size Min (px)', Math.round(layerDraft.sizeMin ?? 2), 1, 50, (v) => updateLayerDraftField({ sizeMin: v }))}
                          >
                            {Math.round(layerDraft.sizeMin ?? 2)} px
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Size Max (px)
                          <input type="range" min={1} max={80} value={Math.round(layerDraft.sizeMax ?? 6)} onChange={(e) => updateLayerDraftField({ sizeMax: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Size Max (px)', Math.round(layerDraft.sizeMax ?? 6), 1, 80, (v) => updateLayerDraftField({ sizeMax: v }))}
                          >
                            {Math.round(layerDraft.sizeMax ?? 6)} px
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Opacity Min
                          <input type="range" min={0} max={100} value={Math.round((layerDraft.opacityMin ?? 0.3) * 100)} onChange={(e) => updateLayerDraftField({ opacityMin: Number(e.target.value) / 100 })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Opacity Min (%)', Math.round((layerDraft.opacityMin ?? 0.3) * 100), 0, 100, (v) => updateLayerDraftField({ opacityMin: v / 100 }))}
                          >
                            {Math.round((layerDraft.opacityMin ?? 0.3) * 100)}%
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Opacity Max
                          <input type="range" min={0} max={100} value={Math.round((layerDraft.opacityMax ?? 0.9) * 100)} onChange={(e) => updateLayerDraftField({ opacityMax: Number(e.target.value) / 100 })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Opacity Max (%)', Math.round((layerDraft.opacityMax ?? 0.9) * 100), 0, 100, (v) => updateLayerDraftField({ opacityMax: v / 100 }))}
                          >
                            {Math.round((layerDraft.opacityMax ?? 0.9) * 100)}%
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Particle Count
                          <input type="range" min={10} max={1000} value={Math.round(layerDraft.particleCount ?? 200)} onChange={(e) => updateLayerDraftField({ particleCount: Number(e.target.value) })} />
                          <span
                            className="muted"
                            style={{ fontSize: 12 }}
                            onDoubleClick={() => promptNumeric('Particle Count', Math.round(layerDraft.particleCount ?? 200), 10, 1000, (v) => updateLayerDraftField({ particleCount: v }))}
                          >
                            {Math.round(layerDraft.particleCount ?? 200)}
                          </span>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Audio Responsive
                          <button
                            className="pill-btn"
                            type="button"
                            aria-pressed={!!layerDraft.audioResponsive}
                            onClick={() => updateLayerDraftField({ audioResponsive: !layerDraft.audioResponsive })}
                          >
                            <span>{layerDraft.audioResponsive ? 'On' : 'Off'}</span>
                          </button>
                        </label>
                      </>
                    )}
                    {layerDraft.type === 'text' && (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Text
                          <input type="text" value={layerDraft.text ?? ''} onChange={(e) => updateLayerDraftField({ text: e.target.value })} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Font
                          <select
                            className="pill-btn"
                            value={layerDraft.font ?? 'Segoe UI'}
                            onChange={(e) => updateLayerDraftField({ font: e.target.value })}
                            style={{ height: 34, padding: '0 12px' }}
                          >
                            {(() => {
                              const current = layerDraft.font ?? 'Segoe UI';
                              const options = FONT_FACE_OPTIONS.includes(current)
                                ? FONT_FACE_OPTIONS
                                : [current, ...FONT_FACE_OPTIONS];
                              return options.map((name) => (
                                <option value={name} key={name}>{name}</option>
                              ));
                            })()}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Font Size
                          <input type="range" min={8} max={96} value={layerDraft.fontSize ?? 12} onChange={(e) => updateLayerDraftField({ fontSize: Number(e.target.value) })} />
                          <span className="muted" style={{ fontSize: 12 }}>{layerDraft.fontSize ?? 12}px</span>
                        </label>
                      </>
                    )}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="pill-btn" type="button" onClick={undoLayerDraft}>Undo</button>
                    <button className="pill-btn" type="button" onClick={redoLayerDraft}>Redo</button>
                    <button className="pill-btn" type="button" onClick={closeLayerDialog}>Close</button>
                  </div>
                </div>
            )}
          </div>
        </div>
        )}

        {clipEditor && clipEditorDraft && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}
            onClick={closeClipEditor}
          >
            <div
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, width: 620, maxWidth: '94vw' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Clip Properties</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10 }}>
                <label style={{ fontWeight: 600 }}>Path</label>
                <input type="text" readOnly value={clipEditor.path} style={{ width: '100%' }} />
                <label style={{ fontWeight: 600 }}>Timeline Start</label>
                <input
                  type="number"
                  value={clipEditorDraft.timelineStart ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setClipEditorDraft((prev) => {
                      if (!prev) return prev;
                      const safeStart = Number.isFinite(next) ? Math.max(0, next) : 0;
                      const end = prev.timelineEnd ?? safeStart + (prev.duration ?? 0.05);
                      return { ...prev, timelineStart: safeStart, timelineEnd: Math.max(safeStart + 0.05, end) };
                    });
                  }}
                />
                <label style={{ fontWeight: 600 }}>Timeline End</label>
                <input
                  type="number"
                  value={clipEditorDraft.timelineEnd ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setClipEditorDraft((prev) => {
                      if (!prev) return prev;
                      const safeEnd = Number.isFinite(next) ? Math.max(0, next) : 0;
                      const start = prev.timelineStart ?? 0;
                      return { ...prev, timelineEnd: Math.max(start + 0.05, safeEnd) };
                    });
                  }}
                />
                <label style={{ fontWeight: 600 }}>Fill Method</label>
                <select
                  className="pill-select"
                  value={clipEditorDraft.fillMethod ?? 'loop'}
                  onChange={(e) => updateClipEditorDraft({ fillMethod: e.target.value as ClipEdit['fillMethod'] })}
                >
                  <option value="loop">Loop</option>
                  <option value="pingpong">Ping-Pong</option>
                  <option value="stretch">Stretch</option>
                </select>
                <label style={{ fontWeight: 600 }}>Trim Start</label>
                <input
                  type="number"
                  value={clipEditorDraft.trimStart ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setClipEditorDraft((prev) => {
                      if (!prev) return prev;
                      const safeStart = Number.isFinite(next) ? Math.max(0, next) : 0;
                      const end = prev.trimEnd ?? safeStart + 0.05;
                      return { ...prev, trimStart: safeStart, trimEnd: Math.max(safeStart + 0.05, end) };
                    });
                  }}
                />
                <label style={{ fontWeight: 600 }}>Trim End</label>
                <input
                  type="number"
                  value={clipEditorDraft.trimEnd ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setClipEditorDraft((prev) => {
                      if (!prev) return prev;
                      const safeEnd = Number.isFinite(next) ? Math.max(0, next) : 0;
                      const start = prev.trimStart ?? 0;
                      return { ...prev, trimEnd: Math.max(start + 0.05, safeEnd) };
                    });
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, marginTop: 14 }}>
                <label style={{ fontWeight: 600 }}>Hue</label>
                <input
                  type="number"
                  value={clipEditorDraft.hue ?? 0}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(e) => updateClipEditorDraft({ hue: Number(e.target.value) })}
                />
                <label style={{ fontWeight: 600 }}>Contrast</label>
                <input
                  type="number"
                  value={clipEditorDraft.contrast ?? 1}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(e) => updateClipEditorDraft({ contrast: Number(e.target.value) })}
                />
                <label style={{ fontWeight: 600 }}>Brightness</label>
                <input
                  type="number"
                  value={clipEditorDraft.brightness ?? 1}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(e) => updateClipEditorDraft({ brightness: Number(e.target.value) })}
                />
                <label style={{ fontWeight: 600 }}>Rotate</label>
                <input
                  type="number"
                  value={clipEditorDraft.rotate ?? 0}
                  min={0}
                  max={360}
                  step={1}
                  onChange={(e) => updateClipEditorDraft({ rotate: Number(e.target.value) })}
                />
                <label style={{ fontWeight: 600 }}>Flip / Invert</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="pill-btn pill-btn--compact"
                    type="button"
                    aria-pressed={!!clipEditorDraft.flipH}
                    onClick={() => updateClipEditorDraft({ flipH: !clipEditorDraft.flipH })}
                    style={{ borderColor: clipEditorDraft.flipH ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span>Flip H</span>
                  </button>
                  <button
                    className="pill-btn pill-btn--compact"
                    type="button"
                    aria-pressed={!!clipEditorDraft.flipV}
                    onClick={() => updateClipEditorDraft({ flipV: !clipEditorDraft.flipV })}
                    style={{ borderColor: clipEditorDraft.flipV ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span>Flip V</span>
                  </button>
                  <button
                    className="pill-btn pill-btn--compact"
                    type="button"
                    aria-pressed={!!clipEditorDraft.invert}
                    onClick={() => updateClipEditorDraft({ invert: !clipEditorDraft.invert })}
                    style={{ borderColor: clipEditorDraft.invert ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span>Invert</span>
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="pill-btn" type="button" onClick={closeClipEditor}>Cancel</button>
                <button className="pill-btn" type="button" onClick={applyClipEditor}>Save</button>
              </div>
            </div>
          </div>
        )}

        {licenseModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={() => setLicenseModalOpen(false)}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, width: 640, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Upgrade to Full Version</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ background: '#0c1020', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={assetHref('ui/vizmatic_setupWizard_logo.png')}
                    alt="vizmatic logo"
                    style={{ width: '100%', maxWidth: 190, height: 'auto', display: 'block', objectFit: 'contain' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: 'var(--panel)', color: 'var(--text)', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}>
                    <a
                      href={`https://vizmatic.sorryneedboost.com/${machineId ? `?machineId=${encodeURIComponent(machineId)}#purchase` : '#purchase'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-card action-card--purchase"
                      style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 10 }}
                    >
                      <MaterialIcon name="shopping_cart" className="action-card__icon" ariaHidden />
                      <span className="action-card__text">
                        <span className="action-card__label">Unlock full version of Vizmatic</span>
                        <span className="action-card__title">Buy Perpetual License</span>
                      </span>
                    </a>
                    <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.85em', marginTop: 6, lineHeight: 1.5, maxWidth: 500 }}>
                      Lifetime license that unlocks all current and future features for this generation of the vizmatic application.
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, marginBottom: 0, rowGap: 2, verticalAlign: 'bottom', }}>Enter Product Key</div>
                  <div style={{ position: 'relative', verticalAlign: 'top', marginTop: 0, }}>
                    <MaterialIcon name="key" ariaHidden className="pill-icon" />
                    <input
                      type="text"
                      value={licenseKeyInput}
                      onChange={(e) => setLicenseKeyInput(e.target.value)}
                      placeholder="Enter product key provided during purchase or in confirmation email."
                      style={{ width: '100%', padding: '10px 12px 10px 38px', borderRadius: 8, textAlign: 'left', border: '1px solid var(--border)', background: 'var(--panel-alt)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, fontSize: 10, color: 'var(--text-muted)' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, width: '20%',verticalAlign: 'bottom', textAlign: 'right', color: 'var(--text)' }}>Machine ID</div>
                    <div>If asked by support, use the buttons below to copy or view the full key.</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="text"
                      readOnly
                      value={machineId ? `${machineId.slice(0, 8)}-${machineId.slice(-8)}` : 'Loading...'}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-alt)', color: 'var(--text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                    />
                    <button
                      className="pill-btn pill-btn--icon"
                      type="button"
                      title="Copy Machine ID"
                      aria-label="Copy Machine ID"
                      onClick={() => {
                        if (!machineId) return;
                        try {
                          navigator.clipboard.writeText(machineId);
                        } catch {
                          const temp = document.createElement('textarea');
                          temp.value = machineId;
                          temp.style.position = 'fixed';
                          temp.style.top = '-1000px';
                          document.body.appendChild(temp);
                          temp.select();
                          document.execCommand('copy');
                          temp.remove();
                        }
                      }}
                    >
                      <MaterialIcon name="content_copy" ariaHidden />
                    </button>
                    <button
                      className="pill-btn pill-btn--icon"
                      type="button"
                      title="View Full Machine ID"
                      aria-label="View Full Machine ID"
                      onClick={() => setMachineIdModalOpen(true)}
                    >
                      <MaterialIcon name="search" ariaHidden />
                    </button>
                  </div>
                </div>
              </div>
              {licenseError && <div style={{ color: '#c0392b', marginBottom: 10 }}>{licenseError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="pill-btn" type="button" onClick={() => setLicenseModalOpen(false)}>
                  <span>Close</span>
                </button>
                <button className="pill-btn" type="button" onClick={handleValidateLicense} disabled={validatingLicense}>
                  <span>{validatingLicense ? 'Checking...' : 'Activate'}</span>
                </button>
              </div>

            </div>
          </div>
        )}

        {activationSuccessOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={() => setActivationSuccessOpen(false)}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, width: 420, maxWidth: '92vw', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Congratulations!</h3>
              <div style={{ marginTop: 6 }}>Your activation code was accepted and the full version is now unlocked.</div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <button className="pill-btn" type="button" onClick={() => setActivationSuccessOpen(false)}>
                  <span>Continue</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {machineIdModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={() => setMachineIdModalOpen(false)}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, width: 520, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Machine ID</h3>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', wordBreak: 'break-all', padding: 10, background: 'var(--panel-alt)', borderRadius: 8, border: '1px solid var(--border)' }}>
                {machineId || 'Loading...'}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  className="pill-btn"
                  type="button"
                  onClick={() => {
                    if (!machineId) return;
                    try {
                      navigator.clipboard.writeText(machineId);
                    } catch {
                      const temp = document.createElement('textarea');
                      temp.value = machineId;
                      temp.style.position = 'fixed';
                      temp.style.top = '-1000px';
                      document.body.appendChild(temp);
                      temp.select();
                      document.execCommand('copy');
                      temp.remove();
                    }
                  }}
                >
                  <span>Copy to Clipboard</span>
                </button>
                <button className="pill-btn" type="button" onClick={() => setMachineIdModalOpen(false)}>
                  <span>Close</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activationInfoOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={() => setActivationInfoOpen(false)}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, width: 520, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Activation</h3>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{licenseStatus.licensed ? 'Activated' : 'Trial Version'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>Machine ID</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', wordBreak: 'break-all' }}>{machineId || '...'}</div>
                <div style={{ fontWeight: 600 }}>Name</div>
                <div style={{ color: licenseStatus.licensed ? 'inherit' : 'var(--text-muted)', fontStyle: licenseStatus.licensed ? 'normal' : 'italic' }}>
                  {licenseStatus.licensed ? (licenseStatus.name || 'Unknown') : 'Unlicensed'}
                </div>
                <div style={{ fontWeight: 600 }}>Email</div>
                <div style={{ color: licenseStatus.licensed ? 'inherit' : 'var(--text-muted)', fontStyle: licenseStatus.licensed ? 'normal' : 'italic' }}>
                  {licenseStatus.licensed ? (licenseStatus.email || 'Unknown') : 'Unlicensed'}
                </div>
                <div style={{ fontWeight: 600 }}>Date Activated</div>
                <div style={{ color: licenseStatus.licensed ? 'inherit' : 'var(--text-muted)', fontStyle: licenseStatus.licensed ? 'normal' : 'italic' }}>
                  {licenseStatus.licensed
                    ? (licenseStatus.activatedAt ? new Date(licenseStatus.activatedAt).toLocaleDateString() : 'Unknown')
                    : 'Unlicensed'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="pill-btn" type="button" onClick={() => window.open('https://vizmatic.sorryneedboost.com/#purchase', '_blank')}>Product Webpage</button>
                <button className="pill-btn" type="button" onClick={() => { setActivationInfoOpen(false); setLicenseModalOpen(true); }} disabled={licenseStatus.licensed}>
                  Purchase License
                </button>
                <button className="pill-btn" type="button" onClick={() => setActivationInfoOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {isRendering && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 680,
              maxWidth: '94vw',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Rendering Project</h3>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                Elapsed {formatClock(renderElapsedMs / 1000)}
              </div>
              <button className="pill-btn pill-btn--icon" type="button" title="Cancel Render" aria-label="Cancel Render" onClick={() => cancelRender()}>
                <MaterialIcon name="cancel" ariaHidden />
              </button>
            </div>
            <div style={{ height: 18, background: '#222', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, (renderTotalMs > 0 ? (renderElapsedMs / renderTotalMs) * 100 : 0))).toFixed(1)}%`, background: '#3f51b5' }} />
            </div>
            <div style={{ padding: '8px', background: '#0b0b0b', border: '1px solid #333', borderRadius: 4, maxHeight: 220, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 }}>
              {logs.length === 0 ? (
                <div style={{ color: '#777' }}>Render logs will appear here...</div>
              ) : (
                logs.slice(-200).map((l, i) => (<div key={i}>{l}</div>))
              )}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100 }} onClick={closeContextMenu}>
          <div
            style={{
              position: 'absolute',
              top: contextMenu.y,
              left: contextMenu.x,
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 6,
              minWidth: 160,
              boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => startRenameClip(contextMenu.path, contextMenu.index)}>Rename</button>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => handleClipEdit(contextMenu.id, contextMenu.path, contextMenu.index)}>Edit</button>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => handleClipAddToLibrary(contextMenu.path)}>Add to Library</button>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => duplicateClipAt(contextMenu.index)}>Duplicate</button>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => handleClipInfo(contextMenu.path)}>File Info</button>
              <button className="pill-btn pill-btn--compact" type="button" onClick={() => removeClipAt(contextMenu.index)}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRenameTarget(null)}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Rename Clip</h3>
            <input
              type="text"
              style={{ width: '100%', marginBottom: 10 }}
              value={renameTarget.name}
              onChange={(e) => setRenameTarget((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="pill-btn" type="button" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button className="pill-btn" type="button" onClick={applyRenameClip}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
