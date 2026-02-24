import { readBoolean, readNumber, readString } from "../types/parameters";
import { rendererParameterSchema } from "./rendererParameterSchema";
import {
  applyEffects,
  clamp,
  clearWithTrail,
  getCutoffWindow,
  getPaintStyle,
  sampleToUnitArray,
} from "./renderUtils";
import type { VisualizerEngine, VisualizerFrame } from "./types";

const drawOutline = (
  ctx: CanvasRenderingContext2D,
  params: Record<string, string | number | boolean>,
): void => {
  if (!readBoolean(params, "outlineEnabled", false)) {
    return;
  }

  ctx.strokeStyle = readString(params, "outlineColor", "#f4f7ff");
  ctx.lineWidth = readNumber(params, "outlineWidth", 1.5);
  ctx.stroke();
};

const drawStraightBars = (
  frame: VisualizerFrame,
  samples: number[],
  baseline: number,
  amplitudeSpace: number,
): void => {
  const { ctx, width, params } = frame;
  const paddingX = readNumber(params, "paddingX", 24);
  const barGap = readNumber(params, "barGap", 2);
  const barWidthScale = readNumber(params, "barWidthScale", 1);
  const minBarHeight = readNumber(params, "minBarHeight", 2);
  const mirror = readBoolean(params, "mirror", true);
  const availableWidth = Math.max(1, width - paddingX * 2);
  const baseWidth =
    (availableWidth - barGap * Math.max(0, samples.length - 1)) / samples.length;
  const barWidth = Math.max(1, baseWidth * barWidthScale);

  ctx.beginPath();
  for (let index = 0; index < samples.length; index += 1) {
    const x = paddingX + index * (baseWidth + barGap) + (baseWidth - barWidth) * 0.5;
    const height = minBarHeight + samples[index] * amplitudeSpace;

    ctx.rect(x, baseline - height, barWidth, height);
    if (mirror) {
      ctx.rect(x, baseline, barWidth, height);
    }
  }
  ctx.fill();
  drawOutline(ctx, params);
};

const drawStraightPathType = (
  frame: VisualizerFrame,
  samples: number[],
  baseline: number,
  amplitudeSpace: number,
): void => {
  const { ctx, width, params } = frame;
  const vizType = readString(params, "vizType", "bar");
  const paddingX = readNumber(params, "paddingX", 24);
  const mirror = readBoolean(params, "mirror", true);
  const lineWidth = readNumber(params, "lineWidth", 2);
  const dotSize = readNumber(params, "dotSize", 3);
  const solidFillAlpha = readNumber(params, "solidFillAlpha", 0.35);
  const stepX = (width - paddingX * 2) / Math.max(1, samples.length - 1);

  if (vizType === "dot") {
    ctx.beginPath();
    for (let index = 0; index < samples.length; index += 1) {
      const x = paddingX + stepX * index;
      const y = baseline - samples[index] * amplitudeSpace;
      ctx.moveTo(x + dotSize, y);
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      if (mirror) {
        const my = baseline + samples[index] * amplitudeSpace;
        ctx.moveTo(x + dotSize, my);
        ctx.arc(x, my, dotSize, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    drawOutline(ctx, params);
    return;
  }

  ctx.beginPath();
  for (let index = 0; index < samples.length; index += 1) {
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
    drawOutline(ctx, params);
  } else {
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    if (mirror) {
      ctx.beginPath();
      for (let index = 0; index < samples.length; index += 1) {
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
    for (let index = 0; index < samples.length; index += 1) {
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
    ctx.fill();
    ctx.globalAlpha = previousAlpha;
    drawOutline(ctx, params);
  }
};

const drawCircleType = (
  frame: VisualizerFrame,
  samples: number[],
  centerX: number,
  centerY: number,
  baseRadius: number,
  amplitudeSpace: number,
): void => {
  const { ctx, params, timestamp } = frame;
  const vizType = readString(params, "vizType", "bar");
  const lineWidth = readNumber(params, "lineWidth", 2);
  const dotSize = readNumber(params, "dotSize", 3);
  const solidFillAlpha = readNumber(params, "solidFillAlpha", 0.35);
  const minBarHeight = readNumber(params, "minBarHeight", 2);
  const radialSpin = readNumber(params, "radialSpin", 0);
  const spinOffset = radialSpin * (timestamp * 0.0015);
  const stepAngle = (Math.PI * 2) / samples.length;

  if (vizType === "bar") {
    const barWidthScale = readNumber(params, "barWidthScale", 1);
    for (let index = 0; index < samples.length; index += 1) {
      const angle = index * stepAngle + spinOffset;
      const outerRadius = baseRadius + minBarHeight + samples[index] * amplitudeSpace;
      const x1 = centerX + Math.cos(angle) * baseRadius;
      const y1 = centerY + Math.sin(angle) * baseRadius;
      const x2 = centerX + Math.cos(angle) * outerRadius;
      const y2 = centerY + Math.sin(angle) * outerRadius;

      ctx.lineWidth = Math.max(1, barWidthScale * 2.5);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    return;
  }

  if (vizType === "dot") {
    ctx.beginPath();
    for (let index = 0; index < samples.length; index += 1) {
      const angle = index * stepAngle + spinOffset;
      const radius = baseRadius + samples[index] * amplitudeSpace;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      ctx.moveTo(x + dotSize, y);
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
    }
    ctx.fill();
    drawOutline(ctx, params);
    return;
  }

  ctx.beginPath();
  for (let index = 0; index <= samples.length; index += 1) {
    const sample = samples[index % samples.length];
    const angle = index * stepAngle + spinOffset;
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
    drawOutline(ctx, params);
    return;
  }

  ctx.lineWidth = lineWidth;
  ctx.stroke();
};

const renderSpectrum = (frame: VisualizerFrame): void => {
  const { ctx, width, height, frequencyData, params } = frame;
  const layout = readString(params, "layout", "straight");
  const vizType = readString(params, "vizType", "bar");
  const centerYOffset = readNumber(params, "centerYOffset", 0);
  const opacity = clamp(readNumber(params, "opacity", 1), 0.05, 1);
  const responseCurve = readNumber(params, "responseCurve", 0.9);
  const intensity = readNumber(params, "intensity", 1.1);
  const paddingY = readNumber(params, "paddingY", 22);
  const mirror = readBoolean(params, "mirror", true);

  clearWithTrail(ctx, width, height, params);

  const activeWindow = getCutoffWindow(frequencyData, params);
  const sampleCount =
    layout === "circle"
      ? 180
      : Math.max(18, Math.floor((width - readNumber(params, "paddingX", 24) * 2) / 6));
  const samples = sampleToUnitArray(activeWindow, sampleCount, responseCurve, intensity);
  ctx.fillStyle = getPaintStyle(ctx, width, height, params);
  ctx.strokeStyle = getPaintStyle(ctx, width, height, params);
  applyEffects(ctx, params);
  ctx.globalAlpha = opacity;

  if (layout === "circle") {
    const centerX = width / 2;
    const centerY = height / 2 + centerYOffset * height;
    const baseRadius =
      Math.min(width, height) * clamp(readNumber(params, "baseRadiusRatio", 0.22), 0.05, 0.48);
    const amplitudeSpace = Math.max(6, Math.min(width, height) * 0.34 - paddingY - baseRadius);
    drawCircleType(frame, samples, centerX, centerY, baseRadius, amplitudeSpace);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  const baseline = mirror
    ? height / 2 + centerYOffset * height
    : height - paddingY + centerYOffset * height;
  const topLimit = paddingY;
  const bottomLimit = height - paddingY;
  const amplitudeSpace = mirror
    ? Math.max(4, Math.min(Math.abs(baseline - topLimit), Math.abs(bottomLimit - baseline)))
    : Math.max(4, baseline - topLimit);

  if (vizType === "bar") {
    drawStraightBars(frame, samples, baseline, amplitudeSpace);
  } else {
    drawStraightPathType(frame, samples, baseline, amplitudeSpace);
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

export const canvas2dBarsEngine: VisualizerEngine = {
  id: "canvas2d-spectrum",
  label: "Canvas2D Spectrum",
  parameterSchema: rendererParameterSchema,
  render: renderSpectrum,
};
