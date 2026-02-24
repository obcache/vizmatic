import type { ParameterDefinition, ParameterValues } from "../types/parameters";

export type VisualizerFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  frequencyData: Uint8Array;
  timeDomainData: Uint8Array;
  isPlaying: boolean;
  timestamp: number;
  params: ParameterValues;
};

export type VisualizerEngine = {
  id: string;
  label: string;
  parameterSchema: ParameterDefinition[];
  render: (frame: VisualizerFrame) => void;
};
