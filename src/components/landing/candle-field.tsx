"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { generateCandles } from "./candle-data";

const CANDLES = generateCandles();

/** Spotlight radius in CSS px: full color at the cursor, none at the edge. */
const RADIUS = 120;
/** Wicks are drawn in segments this long, so the spotlight colors part of a wick, not a whole column. */
const SEGMENT = 4;
const WICK_ALPHA = 0.35;
const INTRO_STAGGER = 22;
const INTRO_GROW = 600;
const INTRO_MARKER = 200;
const DRIFT_PX = 2;
const DRIFT_PERIOD = 7000;
/** The glow center follows the pointer with this time constant; intensity fades out over about 400ms. */
const FOLLOW_TAU = 120;
const FADE_IN_TAU = 80;
const FADE_OUT_TAU = 400 / 3;
const PAD_X = 12;
const PAD_Y = 28;

type Rgb = [number, number, number];

interface Colors {
  candle: Rgb;
  guide: Rgb;
  glow: Rgb;
}

const FALLBACK: Colors = { candle: [229, 229, 229], guide: [43, 41, 45], glow: [113, 208, 131] };

/** Resolves any CSS color (hex, rgb, color-mix) to RGB through a 1px canvas. */
function resolveColor(probe: CanvasRenderingContext2D, value: string, fallback: Rgb): Rgb {
  if (!value) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** The theme tokens `--candle`, `--candle-guide` and `--candle-glow` (theme.css). */
function readColors(el: HTMLElement): Colors {
  const style = getComputedStyle(el);
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return FALLBACK;
  return {
    candle: resolveColor(probe, style.getPropertyValue("--candle").trim(), FALLBACK.candle),
    guide: resolveColor(probe, style.getPropertyValue("--candle-guide").trim(), FALLBACK.guide),
    glow: resolveColor(probe, style.getPropertyValue("--candle-glow").trim(), FALLBACK.glow),
  };
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v: number) => v * v * (3 - 2 * v);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A 4-point star: tall, narrow points with concave sides, centered on (x, y). */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const h = 6 * scale;
  const w = 3.5 * scale;
  const k = 0.18;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.quadraticCurveTo(x + w * k, y - h * k, x + w, y);
  ctx.quadraticCurveTo(x + w * k, y + h * k, x, y + h);
  ctx.quadraticCurveTo(x - w * k, y + h * k, x - w, y);
  ctx.quadraticCurveTo(x - w * k, y - h * k, x, y - h);
  ctx.fill();
}

/**
 * The landing hero's field of thin candlesticks: a deterministic upward walk that draws in left to
 * right, drifts slowly, and glows only within a soft 120px spotlight around the pointer or finger.
 * Lines and small markers only. The loop pauses while the tab is hidden or the field is off screen;
 * reduced motion gets the final still frame, with the spotlight color but no movement or scaling.
 */
export function CandleField({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const el = wrap;
    const surface = canvas;
    const g = ctx;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colors = readColors(el);
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Where the pointer is, then the eased glow center and spotlight strength that chase it.
    const target = { x: 0, y: 0, inside: false };
    const glow = { x: 0, y: 0, intensity: 0 };

    const start = performance.now();
    let last = start;
    let frame = 0;
    let onScreen = true;

    function resize() {
      const rect = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(height * dpr);
    }

    function draw(now: number) {
      const elapsed = reduced ? Number.POSITIVE_INFINITY : now - start;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;

      const n = CANDLES.length;
      const step = (width - PAD_X * 2) / (n - 1);
      const span = height - PAD_Y * 2;
      const toY = (v: number) => PAD_Y + (1 - v) * span;
      const lit = glow.intensity > 0.002;
      const lightAt = (x: number, y: number) =>
        lit ? glow.intensity * smoothstep(clamp01(1 - Math.hypot(x - glow.x, y - glow.y) / RADIUS)) : 0;

      g.lineWidth = 1;
      // Dotted guides sit behind everything and never light up.
      g.strokeStyle = rgba(colors.guide, 1);
      g.setLineDash([1, 3]);
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = Math.round(PAD_X + i * step) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, height);
      }
      g.stroke();
      g.setLineDash([]);

      for (let i = 0; i < n; i++) {
        const c = CANDLES[i]!;
        const x = Math.round(PAD_X + i * step) + 0.5;
        const grow = easeOut(clamp01((elapsed - i * INTRO_STAGGER) / INTRO_GROW));
        if (grow <= 0) continue;
        const drift = reduced ? 0 : DRIFT_PX * Math.sin((now / DRIFT_PERIOD) * Math.PI * 2 + i * 0.7);
        const yLow = toY(c.low) + drift;
        const yHigh = toY(c.high) + drift;
        const yClose = toY(c.close) + drift;
        // The wick grows up from its base.
        const yTop = yLow + (yHigh - yLow) * grow;
        const reach = Math.max(yLow - yClose, yClose - yHigh, 1);

        if (!lit || Math.abs(x - glow.x) > RADIUS) {
          // Out of the spotlight: one stroke, brightest at the marker and fading toward both ends.
          const gradient = g.createLinearGradient(0, yHigh, 0, yLow);
          gradient.addColorStop(0, rgba(colors.candle, WICK_ALPHA * 0.2));
          gradient.addColorStop(clamp01((yClose - yHigh) / (yLow - yHigh || 1)), rgba(colors.candle, WICK_ALPHA));
          gradient.addColorStop(1, rgba(colors.candle, WICK_ALPHA * 0.2));
          g.strokeStyle = gradient;
          g.beginPath();
          g.moveTo(x, yLow);
          g.lineTo(x, yTop);
          g.stroke();
        } else {
          // Within reach of the spotlight: each short segment takes its own distance to the glow center.
          for (let y0 = yLow; y0 > yTop; y0 -= SEGMENT) {
            const y1 = Math.max(y0 - SEGMENT, yTop);
            const ym = (y0 + y1) / 2;
            const t = lightAt(x, ym);
            const taper = 0.2 + 0.8 * (1 - Math.min(Math.abs(ym - yClose) / reach, 1));
            g.strokeStyle = rgba(mix(colors.candle, colors.glow, t), (WICK_ALPHA + (1 - WICK_ALPHA) * t) * taper);
            g.beginPath();
            g.moveTo(x, y0);
            g.lineTo(x, y1);
            g.stroke();
          }
        }

        const markerAlpha = clamp01((elapsed - i * INTRO_STAGGER - INTRO_GROW) / INTRO_MARKER);
        if (markerAlpha <= 0) continue;
        const t = lightAt(x, yClose);
        g.fillStyle = rgba(mix(colors.candle, colors.glow, t), markerAlpha);
        star(g, x, yClose, reduced ? 1 : 1 + 0.25 * t);
      }
    }

    function step(now: number) {
      const dt = Math.min(now - last, 64);
      last = now;
      if (reduced) {
        glow.x = target.x;
        glow.y = target.y;
        glow.intensity = target.inside ? 1 : 0;
      } else {
        const follow = 1 - Math.exp(-dt / FOLLOW_TAU);
        glow.x += (target.x - glow.x) * follow;
        glow.y += (target.y - glow.y) * follow;
        const tau = target.inside ? FADE_IN_TAU : FADE_OUT_TAU;
        glow.intensity += ((target.inside ? 1 : 0) - glow.intensity) * (1 - Math.exp(-dt / tau));
      }
      draw(now);
    }

    function loop(now: number) {
      step(now);
      frame = requestAnimationFrame(loop);
    }

    // Reduced motion has nothing moving on its own, so it draws only when something changes.
    function play() {
      if (reduced || frame !== 0 || !onScreen || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }

    function pause() {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function refresh() {
      if (reduced || frame === 0) step(performance.now());
    }

    function onMove(event: PointerEvent) {
      const rect = el.getBoundingClientRect();
      target.x = event.clientX - rect.left;
      target.y = event.clientY - rect.top;
      // Start from the pointer rather than wherever the glow last faded out.
      if (!target.inside && glow.intensity < 0.05) {
        glow.x = target.x;
        glow.y = target.y;
      }
      target.inside = true;
      if (reduced) refresh();
    }

    function onLeave() {
      target.inside = false;
      if (reduced) refresh();
    }

    // A finger lifting ends its spotlight; a mouse button release does not.
    function onUp(event: PointerEvent) {
      if (event.pointerType !== "mouse") onLeave();
    }

    function onVisibility() {
      if (document.hidden) pause();
      else play();
    }

    resize();
    refresh();
    play();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      refresh();
    });
    resizeObserver.observe(el);

    const intersection = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) play();
      else pause();
    });
    intersection.observe(el);

    // The theme toggle swaps the `.dark` class on <html>: re-read the candle colors.
    const themeObserver = new MutationObserver(() => {
      colors = readColors(el);
      refresh();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    document.addEventListener("visibilitychange", onVisibility);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);
    el.addEventListener("pointerup", onUp);

    return () => {
      pause();
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      el.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={cn("relative touch-pan-y select-none", className)}
      style={{
        // Every edge fades into the page, so the field never meets the layout with a hard line.
        maskImage:
          "linear-gradient(to right, transparent, black 12%, black 88%, transparent), linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
}
