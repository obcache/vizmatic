import { readBoolean, readNumber, readString } from "../types/parameters";
import { rendererParameterSchema } from "./rendererParameterSchema";
import {
  applyEffects,
  clamp,
  clearWithTrail,
  getPaintStyle,
  toRgba,
} from "./renderUtils";
import type { VisualizerEngine, VisualizerFrame } from "./types";

const toWaveSamples = (
  data: Uint8Array,
  sampleCount: number,
  intensity: number,
  responseCurve: number,
): number[] => {
  const samples: number[] = [];
  const stride = data.length / sampleCount;

  for (let index = 0; index < sampleCount; index += 1) {
    const sourceIndex = Math.floor(index * stride);
    const centered = Math.abs((data[sourceIndex] - 128) / 128);
    const curved = Math.pow(centered, Math.max(0.0001, responseCurve)) * intensity;
    samples.push(clamp(curved, 0, 1.75));
  }

  return samples;
};

const renderOrbit = (frame: VisualizerFrame): void => {
  const { ctx, width, height, timeDomainData, params, timestamp } = frame;
  const layout = readString(params, "layout", "straight");
  const vizType = readString(params, "vizType", "bar");
  const centerYOffset = readNumber(params, "centerYOffset", 0);
  const opacity = clamp(readNumber(params, "opacity", 1), 0.05, 1);
  const responseCurve = readNumber(params, "responseCurve", 0.9);
  const intensity = readNumber(params, "intensity", 1.1);
  const paddingX = readNumber(params, "paddingX", 24);
  const paddingY = readNumber(params, "paddingY", 22);
  const lineWidth = readNumber(params, "lineWidth", 2);
  const dotSize = readNumber(params, "dotSize", 3);
  const mirror = readBoolean(params, "mirror", true);
  const solidFillAlpha = readNumber(params, "solidFillAlpha", 0.35);
  const radialSpin = readNumber(params, "radialSpin", 0);
  const spinOffset = radialSpin * timestamp * 0.002;

  clearWithTrail(ctx, width, height, params);
  ctx.strokeStyle = getPaintStyle(ctx, width, height, params);
  ctx.fillStyle = getPaintStyle(ctx, width, height, params);
  applyEffects(ctx, params);
  ctx.globalAlpha = opacity;

  if (layout === "circle") {
    const sampleCount = 200;
    const samples = toWaveSamples(timeDomainData, sampleCount, intensity, responseCurve);
    const centerX = width / 2;
    const centerY = height / 2 + centerYOffset * height;
    const baseRadius =
      Math.min(width, height) * clamp(readNumber(params, "baseRadiusRatio", 0.22), 0.05, 0.48);
    const amplitudeSpace = Math.max(4, Math.min(width, height) * 0.32 - baseRadius - paddingY);
    const step = (Math.PI * 2) / sampleCount;

    if (vizType === "dot") {
      ctx.beginPath();
      for (let index = 0; index < sampleCount; index += 1) {
        const angle = index * step + spinOffset;
        const radius = baseRadius + samples[index] * amplitudeSpace;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        ctx.moveTo(x + dotSize, y);
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return;
    }

    if (vizType === "bar") {
      for (let index = 0; index < sampleCount; index += 1) {
        const angle = index * step + spinOffset;
        const radius = baseRadius + samples[index] * amplitudeSpace;
        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * radius;
        const y2 = centerY + Math.sin(angle) * radius;

        ctx.lineWidth = Math.max(1, readNumber(params, "barWidthScale", 1) * 2.2);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return;
    }

    ctx.beginPath();
    for (let index = 0; index <= sampleCount; index += 1) {
      const sample = samples[index % sampleCount];
      const angle = index * step + spinOffset;
      const radius = baseRadius + sample * amplitudeSpace;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();

    if (vizType === "solid") {
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = previousAlpha * solidFillAlpha;
      ctx.fill();
      ctx.globalAlpha = previousAlpha;
    } else {
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  const sampleCount = Math.max(24, Math.floor((width - paddingX * 2) / 5));
  const samples = toWaveSamples(timeDomainData, sampleCount, intensity, responseCurve);
  const stepX = (width - paddingX * 2) / Math.max(1, sampleCount - 1);
  const baseline = mirror
    ? height / 2 + centerYOffset * height
    : height - paddingY + centerYOffset * height;
  const amplitudeSpace = mirror
    ? Math.max(4, height * 0.42 - paddingY)
    : Math.max(4, baseline - paddingY);

  if (vizType === "dot") {
    ctx.beginPath();
    for (let index = 0; index < sampleCount; index += 1) {
      const x = paddingX + index * stepX;
      const displacement = samples[index] * amplitudeSpace;
      const y = baseline - displacement;
      ctx.moveTo(x + dotSize, y);
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      if (mirror) {
        const my = baseline + displacement;
        ctx.moveTo(x + dotSize, my);
        ctx.arc(x, my, dotSize, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  if (vizType === "bar") {
    const barGap = readNumber(params, "barGap", 2);
    const barWidthScale = readNumber(params, "barWidthScale", 1);
    const minBarHeight = readNumber(params, "minBarHeight", 2);
    const baseWidth =
      (width - paddingX * 2 - barGap * Math.max(0, sampleCount - 1)) / sampleCount;
    const barWidth = Math.max(1, baseWidth * barWidthScale);

    ctx.beginPath();
    for (let index = 0; index < sampleCount; index += 1) {
      const x = paddingX + index * (baseWidth + barGap) + (baseWidth - barWidth) * 0.5;
      const heightUnit = minBarHeight + samples[index] * amplitudeSpace;
      ctx.rect(x, baseline - heightUnit, barWidth, heightUnit);
      if (mirror) {
        ctx.rect(x, baseline, barWidth, heightUnit);
      }
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  for (let index = 0; index < sampleCount; index += 1) {
    const x = paddingX + stepX * index;
    const y = baseline - samples[index] * amplitudeSpace;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  if (vizType === "solid") {
    ctx.lineTo(width - paddingX, baseline);
    ctx.lineTo(paddingX, baseline);
    ctx.closePath();
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = previousAlpha * solidFillAlpha;
    ctx.fill();
    ctx.globalAlpha = previousAlpha;
    if (readBoolean(params, "outlineEnabled", false)) {
      ctx.strokeStyle = readString(params, "outlineColor", "#f4f7ff");
      ctx.lineWidth = readNumber(params, "outlineWidth", 1.5);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    if (mirror) {
      ctx.beginPath();
      for (let index = 0; index < sampleCount; index += 1) {
        const x = paddingX + stepX * index;
        const y = baseline + samples[index] * amplitudeSpace;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  if (mirror && vizType === "solid") {
    ctx.beginPath();
    for (let index = 0; index < sampleCount; index += 1) {
      const x = paddingX + stepX * index;
      const y = baseline + samples[index] * amplitudeSpace;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(width - paddingX, baseline);
    ctx.lineTo(paddingX, baseline);
    ctx.closePath();
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = previousAlpha * solidFillAlpha;
    ctx.fillStyle = toRgba(readString(params, "primaryColor", "#66f0ff"), 0.75);
    ctx.fill();
    ctx.globalAlpha = previousAlpha;
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

export const canvas2dOrbitEngine: VisualizerEngine = {
  id: "canvas2d-orbit",
  label: "Canvas2D Orbit",
  parameterSchema: rendererParameterSchema,
  render: renderOrbit,
};
