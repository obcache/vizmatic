import { canvas2dBarsEngine } from "./canvas2dBarsEngine";
import { canvas2dOrbitEngine } from "./canvas2dOrbitEngine";
import type { VisualizerEngine } from "./types";

export const visualizerEngines: VisualizerEngine[] = [
  canvas2dBarsEngine,
  canvas2dOrbitEngine,
];

export const getVisualizerById = (engineId: string): VisualizerEngine => {
  return (
    visualizerEngines.find((engine) => engine.id === engineId) ??
    visualizerEngines[0]
  );
};
