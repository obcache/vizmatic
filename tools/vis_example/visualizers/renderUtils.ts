import { readNumber } from "../types/parameters";
import type { ParameterValues } from "../types/parameters";

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const toRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const safeAlpha = clamp(alpha, 0, 1);

  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  return `rgba(0, 0, 0, ${safeAlpha})`;
};

export const averageWindow = (
  data: Uint8Array,
  start: number,
  end: number,
): number => {
  let sum = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    sum += data[index];
    count += 1;
  }

  return count === 0 ? 0 : sum / count;
};

export const getCutoffWindow = (data: Uint8Array, params: ParameterValues): Uint8Array => {
  const low = clamp(readNumber(params, "lowCutoffPercent", 0), 0, 0.95);
  const requestedHigh = clamp(readNumber(params, "highCutoffPercent", 1), 0.05, 1);
  const high = Math.max(low + 0.01, requestedHigh);
  const start = Math.floor(low * data.length);
  const end = Math.max(start + 1, Math.floor(high * data.length));
  return data.subarray(start, end);
};

export const sampleToUnitArray = (
  data: Uint8Array,
  sampleCount: number,
  responseCurve: number,
  intensity: number,
): number[] => {
  const output: number[] = [];
  const binsPerSample = data.length / sampleCount;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const start = Math.floor(sampleIndex * binsPerSample);
    const end = Math.max(start + 1, Math.floor((sampleIndex + 1) * binsPerSample));
    const avg = averageWindow(data, start, end) / 255;
    const curved = Math.pow(avg, Math.max(0.0001, responseCurve)) * intensity;
    output.push(clamp(curved, 0, 1.75));
  }

  return output;
};

export const applyEffects = (
  ctx: CanvasRenderingContext2D,
  params: ParameterValues,
): void => {
  const glowEnabled = params.glowEnabled === true;
  const glowColor =
    typeof params.glowColor === "string" ? params.glowColor : "#9ce7ff";
  const glowBlur = readNumber(params, "glowBlur", 20);
  const shadowEnabled = params.shadowEnabled === true;
  const shadowColor =
    typeof params.shadowColor === "string" ? params.shadowColor : "#101726";
  const shadowBlur = readNumber(params, "shadowBlur", 6);

  if (glowEnabled) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowBlur;
  } else if (shadowEnabled) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
};

export const getPaintStyle = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: ParameterValues,
): CanvasGradient | string => {
  const colorMode =
    typeof params.colorMode === "string" ? params.colorMode : "gradient";
  const primaryColor =
    typeof params.primaryColor === "string" ? params.primaryColor : "#66f0ff";
  const secondaryColor =
    typeof params.secondaryColor === "string"
      ? params.secondaryColor
      : "#6e4dff";

  if (colorMode === "solid") {
    return primaryColor;
  }

  const gradient = ctx.createLinearGradient(0, height, width, 0);
  gradient.addColorStop(0, secondaryColor);
  gradient.addColorStop(1, primaryColor);
  return gradient;
};

export const clearWithTrail = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: ParameterValues,
): void => {
  const bgColor =
    typeof params.backgroundColor === "string" ? params.backgroundColor : "#050816";
  const trailAlpha = clamp(readNumber(params, "trailAlpha", 0.35), 0, 1);
  ctx.fillStyle = toRgba(bgColor, trailAlpha);
  ctx.fillRect(0, 0, width, height);
};
