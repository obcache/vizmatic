import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ParameterCanvasPanel } from "./components/ParameterCanvasPanel";
import { VisualizerCanvas } from "./components/VisualizerCanvas";
import { analyzerParameterSchema } from "./config/analyzerParameterSchema";
import {
  loadParameterValues,
  loadUiState,
  saveParameterValues,
  saveUiState,
} from "./lib/storage";
import { readNumber, readString, type ParameterValues } from "./types/parameters";
import { getVisualizerById, visualizerEngines } from "./visualizers/registry";
import "./App.css";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}`;
};

const getInitialVolume = (): number => {
  const stored = loadUiState();
  return clamp(stored?.volume ?? 0.8, 0, 1);
};

function App() {
  const audioElementRef = useRef(new Audio());
  const objectUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const graphConnectedRef = useRef(false);

  const [engineId, setEngineId] = useState(visualizerEngines[0].id);
  const engine = useMemo(() => getVisualizerById(engineId), [engineId]);
  const parameterSchema = useMemo(
    () => [...analyzerParameterSchema, ...engine.parameterSchema],
    [engine],
  );

  const [parameterValues, setParameterValues] = useState<ParameterValues>(() => {
    const initialEngine = visualizerEngines[0];
    const initialSchema = [
      ...analyzerParameterSchema,
      ...initialEngine.parameterSchema,
    ];
    return loadParameterValues(initialSchema);
  });

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [fileName, setFileName] = useState("No audio selected");
  const [hasFile, setHasFile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(getInitialVolume);

  useEffect(() => {
    saveParameterValues(parameterValues);
  }, [parameterValues]);

  const ensureAudioGraph = useCallback(() => {
    const audioElement = audioElementRef.current;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    const audioContext = audioContextRef.current;

    if (!sourceNodeRef.current) {
      sourceNodeRef.current = audioContext.createMediaElementSource(audioElement);
    }

    if (!analyserNodeRef.current) {
      analyserNodeRef.current = audioContext.createAnalyser();
      setAnalyserNode(analyserNodeRef.current);
    }

    if (!gainNodeRef.current) {
      gainNodeRef.current = audioContext.createGain();
      gainNodeRef.current.gain.value = volume;
    }

    if (!graphConnectedRef.current) {
      sourceNodeRef.current.connect(analyserNodeRef.current);
      analyserNodeRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioContext.destination);
      graphConnectedRef.current = true;
    }

    return audioContext;
  }, [volume]);

  useEffect(() => {
    const audio = audioElementRef.current;
    audio.preload = "metadata";

    const syncTime = (): void => {
      setCurrentTime(audio.currentTime);
    };

    const syncDuration = (): void => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const onPlay = (): void => {
      setIsPlaying(true);
    };

    const onPause = (): void => {
      setIsPlaying(false);
    };

    const onEnded = (): void => {
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
    saveUiState({ volume });
  }, [volume]);

  useEffect(() => {
    const analyser = analyserNodeRef.current;
    if (!analyser) {
      return;
    }

    const fftSize = Number(readString(parameterValues, "fftSize", "2048"));
    const minDecibels = readNumber(parameterValues, "minDecibels", -95);
    const maxDecibels = readNumber(parameterValues, "maxDecibels", -10);

    analyser.fftSize = [256, 512, 1024, 2048, 4096, 8192].includes(fftSize)
      ? fftSize
      : 2048;
    analyser.smoothingTimeConstant = clamp(
      readNumber(parameterValues, "smoothingTimeConstant", 0.78),
      0,
      0.99,
    );
    analyser.minDecibels = clamp(minDecibels, -140, -20);
    analyser.maxDecibels = clamp(
      Math.max(analyser.minDecibels + 1, maxDecibels),
      -80,
      0,
    );
  }, [analyserNode, parameterValues]);

  const handleSelectFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const audio = audioElementRef.current;
    audio.pause();
    audio.currentTime = 0;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    audio.src = objectUrl;
    audio.load();

    setFileName(file.name);
    setHasFile(true);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  };

  const handlePlay = async (): Promise<void> => {
    if (!hasFile) {
      return;
    }

    const audioContext = ensureAudioGraph();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    await audioElementRef.current.play();
  };

  const handlePause = (): void => {
    audioElementRef.current.pause();
  };

  const handleStop = (): void => {
    const audio = audioElementRef.current;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
  };

  const handleSeek = (nextTime: number): void => {
    const audio = audioElementRef.current;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleParameterChange = (
    key: string,
    value: string | number | boolean,
  ): void => {
    setParameterValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  return (
    <div className="app-shell">
      <main className="main-panel">
        <header className="app-header">
          <h1>Audio Visualizer Lab</h1>
          <p>
            Compare visual behavior quickly by keeping controls and parameter sets
            decoupled from the renderer implementation.
          </p>
        </header>

        <section className="transport-panel">
          <div className="transport-panel__row">
            <label className="file-picker">
              <span>Audio File</span>
              <input type="file" accept="audio/*" onChange={handleSelectFile} />
            </label>
            <div className="engine-select">
              <span>Renderer</span>
              <select
                value={engine.id}
                onChange={(event) => {
                  const nextEngineId = event.target.value;
                  const nextEngine = getVisualizerById(nextEngineId);
                  const nextSchema = [
                    ...analyzerParameterSchema,
                    ...nextEngine.parameterSchema,
                  ];

                  setEngineId(nextEngineId);
                  setParameterValues(loadParameterValues(nextSchema));
                }}
              >
                {visualizerEngines.map((availableEngine) => (
                  <option key={availableEngine.id} value={availableEngine.id}>
                    {availableEngine.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="selected-file">{fileName}</p>

          <div className="transport-panel__row transport-panel__row--controls">
            <button onClick={handlePlay} disabled={!hasFile}>
              Play
            </button>
            <button onClick={handlePause} disabled={!hasFile || !isPlaying}>
              Pause
            </button>
            <button onClick={handleStop} disabled={!hasFile}>
              Stop
            </button>
            <label className="volume-control">
              <span>Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => {
                  setVolume(Number(event.target.value));
                }}
              />
              <strong>{Math.round(volume * 100)}%</strong>
            </label>
          </div>

          <div className="timeline">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={duration > 0 ? Math.min(currentTime, duration) : 0}
              disabled={!hasFile || duration <= 0}
              onChange={(event) => {
                handleSeek(Number(event.target.value));
              }}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </section>

        <VisualizerCanvas
          analyserNode={analyserNode}
          engine={engine}
          params={parameterValues}
          isPlaying={isPlaying}
        />
      </main>

      <aside className="side-panel">
        <ParameterCanvasPanel
          schema={parameterSchema}
          values={parameterValues}
          onChange={handleParameterChange}
        />
      </aside>
    </div>
  );
}

export default App;
