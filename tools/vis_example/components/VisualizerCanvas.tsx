import { useEffect, useRef } from "react";
import type { ParameterValues } from "../types/parameters";
import type { VisualizerEngine } from "../visualizers/types";

type VisualizerCanvasProps = {
  analyserNode: AnalyserNode | null;
  engine: VisualizerEngine;
  params: ParameterValues;
  isPlaying: boolean;
};

const DEFAULT_FREQUENCY_SIZE = 1024;
const DEFAULT_TIME_SIZE = 2048;

export function VisualizerCanvas({
  analyserNode,
  engine,
  params,
  isPlaying,
}: VisualizerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(analyserNode);
  const engineRef = useRef<VisualizerEngine>(engine);
  const paramsRef = useRef<ParameterValues>(params);
  const isPlayingRef = useRef<boolean>(isPlaying);

  useEffect(() => {
    analyserRef.current = analyserNode;
  }, [analyserNode]);

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let frameHandle = 0;
    let frequencyData = new Uint8Array(DEFAULT_FREQUENCY_SIZE);
    let timeDomainData = new Uint8Array(DEFAULT_TIME_SIZE);

    const render = (timestamp: number): void => {
      const analyser = analyserRef.current;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      if (analyser) {
        if (frequencyData.length !== analyser.frequencyBinCount) {
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
        }

        if (timeDomainData.length !== analyser.fftSize) {
          timeDomainData = new Uint8Array(analyser.fftSize);
        }

        analyser.getByteFrequencyData(frequencyData);
        analyser.getByteTimeDomainData(timeDomainData);
      } else {
        frequencyData.fill(0);
        timeDomainData.fill(128);
      }

      engineRef.current.render({
        ctx: context,
        width,
        height,
        frequencyData,
        timeDomainData,
        isPlaying: isPlayingRef.current,
        timestamp,
        params: paramsRef.current,
      });

      frameHandle = window.requestAnimationFrame(render);
    };

    frameHandle = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, []);

  return (
    <div className="visualizer-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}
