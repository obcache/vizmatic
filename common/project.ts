export interface ClipSegment {
  path: string;
  index: number;
  start?: number; // seconds
  trimStart?: number; // seconds
  trimEnd?: number; // seconds
  duration?: number; // seconds
  fillMethod?: 'loop' | 'pingpong' | 'stretch';
  label?: string;
  color?: string;
  hue?: number;
  contrast?: number;
  brightness?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  invert?: boolean;
}

export type LayerType = 'spectrograph' | 'text' | 'image' | 'particles';

export interface LayerConfigBase {
  id: string;
  type: LayerType;
  color: string;
  x: number; // 0..1 relative position
  y: number; // 0..1 relative position
  width?: number; // pixels
  height?: number; // pixels
  rotate?: number; // degrees
  opacity?: number; // 0..1
  reverse?: boolean;
}

export interface SpectrographLayer extends LayerConfigBase {
  type: 'spectrograph';
  mode: 'bar' | 'line' | 'solid' | 'dots';
  vizType?: 'bar' | 'line' | 'dot' | 'solid';
  layout?: 'straight' | 'circle';
  invert?: boolean;
  pathMode?: 'straight' | 'circular';
  freqScale?: 'lin' | 'log' | 'rlog';
  ampScale?: 'lin' | 'sqrt' | 'cbrt' | 'log';
  averaging?: number;
  fftSize?: 256 | 512 | 1024 | 2048 | 4096 | 8192;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirror?: boolean;
  barCount?: number;
  barWidthPct?: number;
  dotCount?: number;
  solidPointCount?: number;
  paddingX?: number;
  paddingY?: number;
  centerYOffset?: number;
  baseRadiusRatio?: number;
  backgroundColor?: string;
  trailAlpha?: number;
  colorMode?: 'gradient' | 'solid';
  primaryColor?: string;
  secondaryColor?: string;
  outlineEnabled?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  glowEnabled?: boolean;
  glowColor?: string;
  glowBlur?: number;
  glowAmount?: number;
  glowOpacity?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowDistance?: number;
  lowCutoffPercent?: number;
  highCutoffPercent?: number;
  intensity?: number;
  responseCurve?: number;
  radialSpin?: number;
  barWidthScale?: number;
  barGap?: number;
  minBarHeight?: number;
  lineWidth?: number;
  dotSize?: number;
  solidFillAlpha?: number;
  lowCutHz?: number;
  highCutHz?: number;
}

export interface TextLayer extends LayerConfigBase {
  type: 'text';
  text: string;
  font: string;
  fontSize: number;
  outlineColor?: string;
  outlineWidth?: number;
  glowColor?: string;
  glowAmount?: number;
  glowOpacity?: number;
  shadowColor?: string;
  shadowDistance?: number;
}

export interface ImageLayer extends LayerConfigBase {
  type: 'image';
  imagePath: string;
  invert?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  glowColor?: string;
  glowAmount?: number;
  glowOpacity?: number;
  shadowColor?: string;
  shadowDistance?: number;
  motionAffected?: boolean;
}

export interface ParticlesLayer extends LayerConfigBase {
  type: 'particles';
  direction?: number; // degrees
  speed?: number; // pixels per second
  sizeMin?: number; // pixels
  sizeMax?: number; // pixels
  opacityMin?: number; // 0..1
  opacityMax?: number; // 0..1
  audioResponsive?: boolean;
  particleCount?: number;
}

export type LayerConfig = SpectrographLayer | TextLayer | ImageLayer | ParticlesLayer;

export interface MediaLibraryItem {
  id: string;
  name: string;
  description?: string;
  path: string;
  duration?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  width?: number;
  height?: number;
}

export interface ProjectSchema {
  version: '1.0';
  audio?: {
    path: string;
    offset?: number; // seconds
  } | null;
  playhead?: number; // seconds
  clips: ClipSegment[];
  output?: {
    path: string;
  };
  layers?: LayerConfig[];
  metadata?: Record<string, unknown>;
}

export const isProjectSchema = (value: unknown): value is ProjectSchema => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ProjectSchema>;
  if (v.version !== '1.0') return false;
  if (!Array.isArray(v.clips)) return false;
  return true;
};
