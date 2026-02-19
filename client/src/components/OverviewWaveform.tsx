import { useEffect, useRef } from 'react';

export interface OverviewWaveformProps {
  duration: number; // seconds
  playhead: number; // seconds
  onSeek: (seconds: number) => void;
  peaks?: number[]; // optional normalized 0..1 peaks
  hasAudio: boolean;
  zoom: number;
  scroll: number; // 0..1
  onEmptyClick?: () => void;
}

const OverviewWaveform = ({ duration, playhead, onSeek, peaks, hasAudio, zoom, scroll, onEmptyClick }: OverviewWaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth || 800;
      const logicalHeight = canvas.parentElement ? canvas.parentElement.clientHeight : canvas.clientHeight || 64;
      canvas.width = Math.floor(logicalWidth * dpr);
      canvas.height = Math.floor(logicalHeight * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const width = logicalWidth;
      const height = logicalHeight;
      const contentWidth = width * Math.max(1, zoom);
      const viewStart = Math.max(0, Math.min(1, scroll)) * Math.max(0, contentWidth - width);

      ctx.clearRect(0, 0, width, height);
      // Background
      ctx.fillStyle = hasAudio ? '#0f121c' : '#1c1f26';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = hasAudio ? '#6a7bd6' : '#4f5564';
      ctx.globalAlpha = hasAudio ? 0.18 : 0.12;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      const hasPeaks = !!(peaks && peaks.length > 0);
      const maxPeak = hasPeaks ? Math.max(...peaks!, 0) : 0;
      if (hasPeaks) {
        const mid = height / 2;
        const barW = contentWidth / peaks!.length;
        ctx.fillStyle = '#7ea5ff';
        for (let i = 0; i < peaks!.length; i++) {
          const raw = Math.max(0, Math.min(1, peaks![i]));
          const v = maxPeak > 0 ? raw / maxPeak : raw;
          const h = Math.max(2, Math.floor(v * (height - 8)));
          const x = i * barW - viewStart;
          if (x + barW < 0 || x > width) continue;
          ctx.fillRect(x, mid - Math.floor(h / 2), Math.max(1, barW), h);
        }
      }

      // Grid / time markers
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      const markerStep = duration > 0 ? 30 : 10; // seconds
      const totalMarkers = duration > 0 ? Math.floor(duration / markerStep) + 1 : Math.max(4, Math.floor(contentWidth / 80));
      for (let i = 0; i <= totalMarkers; i++) {
        const t = duration > 0 ? Math.min(duration, i * markerStep) : (i / totalMarkers) * 100;
        const pct = duration > 0 ? t / duration : i / totalMarkers;
        const gxContent = Math.floor(pct * contentWidth) + 0.5;
        const gx = gxContent - viewStart;
        if (gx < -20 || gx > width + 20) continue;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
        if (duration > 0 && i !== 0) {
          const mins = Math.floor(t / 60);
          const secs = Math.floor(t % 60);
          ctx.fillStyle = '#c5cbe3';
          ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, gx, height - 2);
        }
      }

      // Playhead line
      const pct = duration > 0 ? Math.max(0, Math.min(1, playhead / duration)) : 0;
      const x = Math.floor(pct * contentWidth) - viewStart;
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255, 204, 0, 0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
      ctx.restore();

      // Empty-state messaging is rendered in the parent overlay.
    };

    draw();
    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [duration, playhead, peaks, hasAudio, zoom, scroll]);

  const seekFromPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasAudio) {
      onEmptyClick?.();
      return;
    }
    if (duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const contentWidth = width * Math.max(1, zoom);
    const viewStart = Math.max(0, Math.min(1, scroll)) * Math.max(0, contentWidth - width);
    const x = e.clientX - rect.left;
    const globalX = x + viewStart;
    const t = (globalX / contentWidth) * duration;
    onSeek(Math.max(0, Math.min(duration, t)));
  };
  const onMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (e.button !== 0) return;
    seekFromPointer(e);
  };
  const onClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    // Keep click path as fallback; mouse down is primary for custom-chrome windows.
    seekFromPointer(e);
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={64}
      style={{ width: '100%', height: 120, display: 'block', borderRadius: 4, background: 'transparent', cursor: duration > 0 ? 'pointer' : 'default' }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    />
  );
};

export default OverviewWaveform;
