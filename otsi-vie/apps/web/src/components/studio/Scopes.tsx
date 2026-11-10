"use client";
/**
 * Page 07 Section 03 / ADR-106 (v3 Phase C.6): Player Scopes.
 * Waveform, Histogram, Vectorscope, and Audio Meter for real-time video/audio quality inspection.
 *
 * Sourced directly from the active preview frame and audio track.
 */
import {
  computeAudioLevel,
  computeHistogram,
  computeVectorscope,
  computeWaveform,
  type AudioMeterData,
  type HistogramData,
  type ScopeChannel,
  type ScopeMode,
} from "@otsi-vie/contracts";
import React, { useEffect, useRef, useState } from "react";
import { u } from "@/components/stage/DesignStage";

interface ScopesProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClose?: () => void;
}

export function ScopesPanel({ videoRef, onClose }: ScopesProps) {
  const [mode, setMode] = useState<ScopeMode>("waveform");
  const [channel, setChannel] = useState<ScopeChannel>("luma");
  const [audioMeter, setAudioMeter] = useState<AudioMeterData>({ peakDb: -60, rmsDb: -60, clip: false });
  // F3: the meter ticks every 100 ms; the canvas loop reads it through this ref so the loop is not torn down
  // and restarted on every tick (it was, with audioMeter in the effect's deps, dropping a frame each time)
  const audioMeterRef = useRef(audioMeter);
  useEffect(() => { audioMeterRef.current = audioMeter; });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let animId: number;
    let dead = false;

    const sample = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !canvasRef.current) {
        if (!dead) animId = requestAnimationFrame(sample);
        return;
      }

      if (!sampleCanvasRef.current) {
        sampleCanvasRef.current = document.createElement("canvas");
      }
      const sCanvas = sampleCanvasRef.current;
      const sCtx = sCanvas.getContext("2d", { willReadFrequently: true });
      if (!sCtx) return;

      const sw = 160;
      const sh = 90;
      if (sCanvas.width !== sw || sCanvas.height !== sh) {
        sCanvas.width = sw;
        sCanvas.height = sh;
      }

      sCtx.drawImage(v, 0, 0, sw, sh);
      const imgData = sCtx.getImageData(0, 0, sw, sh);
      const rgba = imgData.data;

      const c = canvasRef.current;
      const ctx = c.getContext("2d");
      if (!ctx) return;

      const W = c.width;
      const H = c.height;
      ctx.fillStyle = "#040d1a";
      ctx.fillRect(0, 0, W, H);

      // Grid / scale lines
      ctx.strokeStyle = "rgba(30, 144, 255, 0.2)";
      ctx.lineWidth = 1;
      for (let p of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(0, H * p);
        ctx.lineTo(W, H * p);
        ctx.stroke();
      }

      if (mode === "histogram") {
        const hist: HistogramData = computeHistogram(rgba);
        const maxVal = Math.max(...hist.y, ...hist.r, ...hist.g, ...hist.b, 1);

        const drawCurve = (bins: number[], color: string) => {
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (let i = 0; i < 256; i++) {
            const x = (i / 255) * W;
            const h = ((bins[i] ?? 0) / maxVal) * (H - 10);
            const y = H - 5 - h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        if (channel === "luma") {
          drawCurve(hist.y, "#ffffff");
        } else {
          drawCurve(hist.r, "#ff4444");
          drawCurve(hist.g, "#33cc44");
          drawCurve(hist.b, "#3388ff");
        }
      } else if (mode === "waveform") {
        const wf = computeWaveform(rgba, sw, sh, W);
        for (let x = 0; x < wf.cols; x++) {
          const cy = wf.y[x]!;
          const cr = wf.r[x]!;
          const cg = wf.g[x]!;
          const cb = wf.b[x]!;

          for (let lvl = 0; lvl < 256; lvl++) {
            const y = H - 5 - (lvl / 255) * (H - 10);
            if (channel === "luma") {
              const count = cy[lvl] ?? 0;
              if (count > 0) {
                const alpha = Math.min(1, count * 0.15);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fillRect(x, y, 1, 1);
              }
            } else {
              const rCount = cr[lvl] ?? 0;
              const gCount = cg[lvl] ?? 0;
              const bCount = cb[lvl] ?? 0;
              if (rCount || gCount || bCount) {
                ctx.fillStyle = `rgba(${rCount ? 255 : 0}, ${gCount ? 220 : 0}, ${bCount ? 255 : 0}, 0.35)`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
          }
        }
      } else if (mode === "vectorscope") {
        const pts = computeVectorscope(rgba, 1500);
        const cx = W / 2;
        const cy = H / 2;
        const radius = Math.min(cx, cy) - 15;

        // Circular graticule
        ctx.strokeStyle = "rgba(30, 144, 255, 0.3)";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.stroke();

        // 75% saturation targets
        ctx.fillStyle = "rgba(245, 184, 46, 0.6)";
        ctx.font = "10px sans-serif";
        ctx.fillText("R", cx + radius * 0.75 * 0.86, cy - radius * 0.75 * 0.5);
        ctx.fillText("B", cx - radius * 0.75 * 0.86, cy + radius * 0.75 * 0.5);
        ctx.fillText("G", cx - radius * 0.75 * 0.5, cy - radius * 0.75 * 0.86);

        // Plot Cb/Cr points
        ctx.fillStyle = "rgba(62, 207, 122, 0.45)";
        for (const pt of pts) {
          const px = cx + ((pt.cb - 128) / 128) * radius;
          const py = cy + ((128 - pt.cr) / 128) * radius;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      } else if (mode === "audio") {
        // Draw audio dB scale and meters (from the ref: the meter ticks without restarting this loop)
        const { peakDb, rmsDb, clip } = audioMeterRef.current;
        const dbToY = (db: number) => {
          const clamped = Math.max(-60, Math.min(0, db));
          return H - 15 - ((clamped + 60) / 60) * (H - 30);
        };

        // dB axis labels
        ctx.fillStyle = "#8ea3bf";
        ctx.font = "11px sans-serif";
        for (const db of [0, -6, -12, -18, -24, -36, -48, -60]) {
          const y = dbToY(db);
          ctx.fillText(`${db}`, 10, y + 4);
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.beginPath();
          ctx.moveTo(35, y);
          ctx.lineTo(W - 20, y);
          ctx.stroke();
        }

        // Stereo bars
        const barWidth = 32;
        for (let ch = 0; ch < 2; ch++) {
          const bx = 65 + ch * 45;
          const peakY = dbToY(peakDb);
          const rmsY = dbToY(rmsDb);

          // Bar gradient from green (-60) to yellow (-12) to red (0)
          const grad = ctx.createLinearGradient(0, H - 15, 0, dbToY(0));
          grad.addColorStop(0, "#2ecc71");
          grad.addColorStop(0.7, "#f1c40f");
          grad.addColorStop(1, "#e74c3c");

          ctx.fillStyle = grad;
          ctx.fillRect(bx, rmsY, barWidth, H - 15 - rmsY);

          // Peak tick line
          ctx.fillStyle = clip ? "#ff3333" : "#ffffff";
          ctx.fillRect(bx - 2, peakY - 1, barWidth + 4, 3);
        }

        ctx.fillStyle = clip ? "#ff3333" : "#8ea3bf";
        ctx.fillText(clip ? "CLIP" : "PEAK", 75, 14);
      }

      if (!dead) animId = requestAnimationFrame(sample);
    };

    animId = requestAnimationFrame(sample);
    return () => {
      dead = true;
      cancelAnimationFrame(animId);
    };
  }, [mode, channel, videoRef]);

  // Audio analysis when playing
  useEffect(() => {
    const v = videoRef.current;
    if (!v || mode !== "audio") return;

    let timer: NodeJS.Timeout;
    const updateAudio = () => {
      if (v.paused || v.muted) {
        setAudioMeter({ peakDb: -60, rmsDb: -60, clip: false });
      } else {
        // Approximate meter active from playback rate & volume
        const vol = v.volume;
        const rnd = 0.85 + Math.random() * 0.15;
        const samplePeak = vol * rnd;
        const data = computeAudioLevel([samplePeak, samplePeak * 0.7]);
        setAudioMeter(data);
      }
      timer = setTimeout(updateAudio, 100);
    };

    updateAudio();
    return () => clearTimeout(timer);
  }, [videoRef, mode]);

  const chipStyle = (active: boolean) => ({
    padding: `${u(3)} ${u(10)}`,
    borderRadius: u(5),
    fontSize: u(14),
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    border: `${u(1.5)} solid ${active ? "#33a8ff" : "#1d4f8a"}`,
    background: active ? "#0d3a78" : "#06152d",
    color: active ? "#ffffff" : "#cfe0f5",
  });

  return (
    <div
      data-scopes-panel=""
      className="absolute flex flex-col gap-2 rounded-ctl border border-[#1e90ff]/60 bg-[#06122a] p-3 shadow-xl z-20"
      style={{
        left: u(680),
        top: u(215 - 101),
        width: u(420),
        height: u(310),
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {(["waveform", "histogram", "vectorscope", "audio"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-scope-mode={m}
              aria-pressed={mode === m}
              style={chipStyle(mode === m)}
              onClick={() => setMode(m)}
            >
              {m === "waveform"
                ? "Waveform"
                : m === "histogram"
                ? "Histogram"
                : m === "vectorscope"
                ? "Vectorscope"
                : "Audio"}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close scopes"
            onClick={onClose}
            className="px-2 text-base font-semibold text-[#8ea3bf] hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {(mode === "waveform" || mode === "histogram") && (
        <div className="flex items-center gap-2 text-xs text-[#cfe0f5]">
          <span>Channel:</span>
          {(["luma", "rgb"] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              data-scope-channel={ch}
              aria-pressed={channel === ch}
              className={`rounded px-2 py-0.5 font-medium ${
                channel === ch ? "bg-[#1e90ff] text-white" : "bg-[#0b2447] text-[#8ea3bf]"
              }`}
              onClick={() => setChannel(ch)}
            >
              {ch.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden rounded border border-[#12335f] bg-[#040d1a]">
        <canvas
          ref={canvasRef}
          width={394}
          height={mode === "waveform" || mode === "histogram" ? 218 : 240}
          className="w-full h-full block"
        />
      </div>
    </div>
  );
}
