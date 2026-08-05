"use client";
// The blockDAG decoration, in two forms.
//
// DESKTOP (>= lg) — "rail": a narrow graph pinned in the left margin,
// outside the content column, moving at 1.35x scroll so it parallaxes and
// feels a little independent. Unchanged from what is deployed.
//
// MOBILE (< lg) — "backdrop": there is no left margin at that width, so the
// graph becomes a full-width layer BEHIND the hero and cards. It is a
// STATIC SVG IN NORMAL DOCUMENT FLOW, and that is the whole point — see
// MobileBackdrop below for why a fixed canvas with a scroll handler
// stutters no matter how well it is throttled.
//
// The two forms therefore share almost nothing at runtime: the rail is a
// canvas with an rAF loop, the backdrop is markup the browser scrolls for
// free. Only the geometry constants and the PRNG are common.
//
// SIMULATED. No node is contacted — the page must look alive whether or not
// a node is reachable. Wiring real TN10 data later means replacing
// `spawnRound` (rail) and the generator in MobileBackdrop.
//
// COST: the rail runs one capped rAF loop that SUSPENDS itself once the
// camera settles, and stops entirely when the tab is hidden or the layer is
// display:none (as it is below lg). Under prefers-reduced-motion it never
// starts a loop. The backdrop has no loop and no scroll listener at all.
import { useEffect, useRef } from "react";

const ROW_H = 52;
const NODE = 6.5; // square — these are blocks
const NODE_R = 1.6;
const FRAME_MS = 1000 / 30;
const FADE_MS = 800;
const MAX_BLOCKS = 900;
const SETTLE_PX = 0.15;
const TEAL = "73, 234, 203";

/** Behind body text, so deliberately under half the rail's strength. */
const MOBILE_INTENSITY = 0.45;
/** Mobile backdrop geometry — wider spacing than the rail because it spans
 * the whole width rather than a 132px column. */
const M_ROW_H = 56;
const M_LANE_W = 34;

interface Block {
  wy: number;
  dx: number; // px offset from the layer's horizontal centre
  born: number;
  parents: Block[];
}

interface Mode {
  /** >1 parallaxes; exactly 1 is lockstep with the page. */
  scrollFactor: number;
  /** Easing constant, or null to snap (required for true lockstep). */
  ease: number | null;
  laneW: number;
  intensity: number;
  /** Generate down to this fraction of the layer height. */
  genAhead: number;
  /** Rail rounds cluster on the centre; the backdrop scatters across the
   * full width. */
  spread: "centred" | "wide";
}

const RAIL: Mode = {
  scrollFactor: 1.35,
  ease: 220,
  laneW: 18,
  intensity: 1,
  genAhead: 0.78,
  spread: "centred",
};

function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function useDagLayer(
  mode: Mode,
  seed: number,
  wrapRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = makeRand(seed);

    let blocks: Block[] = [];
    let frontier: Block[] = [];
    let deepestY = 0;
    let camera = 0;
    let cssW = 0;
    let cssH = 0;

    /** Uneven by design: mostly 2-5 with an occasional spike toward 7. A
     * flat uniform roll still reads as a metronome. */
    const roundSize = () => {
      let n = 2 + Math.floor(rand() * 4);
      if (rand() < 0.22) n += 1 + Math.floor(rand() * 2);
      return Math.min(7, n);
    };

    const spawnRound = (now: number) => {
      const count = roundSize();
      const round: Block[] = [];
      let offsets: number[];
      if (mode.spread === "centred") {
        // Anchored on the centre whatever the size, so a burst does not
        // shift the column sideways.
        offsets = Array.from(
          { length: count },
          (_, i) => (i - (count - 1) / 2) * mode.laneW
        );
      } else {
        // Scatter across the full width so it reads as a backdrop rather
        // than a column that happens to be centred.
        const laneCount = Math.max(3, Math.round(cssW / mode.laneW) - 1);
        const pool = Array.from({ length: laneCount }, (_, i) => i);
        const take = Math.min(count, laneCount);
        const chosen: number[] = [];
        for (let c = 0; c < take; c++) {
          chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
        }
        chosen.sort((a, b) => a - b);
        offsets = chosen.map((i) => (i - (laneCount - 1) / 2) * mode.laneW);
      }

      for (const dx of offsets) {
        const parents: Block[] = [];
        if (frontier.length) {
          const want = Math.min(frontier.length, 1 + Math.floor(rand() * 3));
          if (mode.spread === "wide") {
            // Nearest parents: across a wide band, random parents produce
            // long crossing edges that read as clutter behind text.
            const cand = [...frontier].sort(
              (p, q) => Math.abs(p.dx - dx) - Math.abs(q.dx - dx)
            );
            for (let p = 0; p < want; p++) parents.push(cand[p]);
          } else {
            const pool = [...frontier];
            for (let p = 0; p < want; p++) {
              parents.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
            }
          }
        }
        round.push({ wy: deepestY, dx, born: now, parents });
      }
      blocks.push(...round);
      frontier = round;
      deepestY += ROW_H;
      if (blocks.length > MAX_BLOCKS) blocks = blocks.slice(-MAX_BLOCKS);
    };

    const measure = () => {
      const r = wrap.getBoundingClientRect();
      cssW = Math.max(1, r.width);
      cssH = Math.max(1, r.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const fillTo = (targetWorldY: number, now: number) => {
      let guard = 0;
      while (deepestY < targetWorldY && guard++ < 400) spawnRound(now);
    };

    const cameraTarget = () => window.scrollY * mode.scrollFactor;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      const cx = cssW / 2;
      const I = mode.intensity;
      const sx = (b: Block) => cx + b.dx;
      const sy = (b: Block) => b.wy - camera;
      const alphaOf = (b: Block) =>
        reduced ? 1 : Math.min(1, (now - b.born) / FADE_MS);

      ctx.lineWidth = 1;
      for (const b of blocks) {
        const y2 = sy(b);
        if (y2 < -ROW_H * 2 || y2 > cssH + ROW_H * 2) continue;
        const a = alphaOf(b);
        if (a <= 0) continue;
        const x2 = sx(b);
        for (const p of b.parents) {
          const x1 = sx(p);
          const y1 = sy(p);
          ctx.strokeStyle = `rgba(${TEAL}, ${0.15 * a * I})`;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          const my = (y1 + y2) / 2;
          ctx.bezierCurveTo(x1, my, x2, my, x2, y2);
          ctx.stroke();
        }
      }

      for (const b of blocks) {
        const y = sy(b);
        if (y < -ROW_H || y > cssH + ROW_H) continue;
        const a = alphaOf(b);
        if (a <= 0) continue;
        const x = sx(b);
        const age = now - b.born;
        if (!reduced && age < FADE_MS) {
          const g = 1 - age / FADE_MS;
          const s = NODE + 7 * g;
          ctx.beginPath();
          ctx.roundRect(x - s / 2, y - s / 2, s, s, NODE_R + 1.5);
          ctx.fillStyle = `rgba(${TEAL}, ${0.09 * g * I})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.roundRect(x - NODE / 2, y - NODE / 2, NODE, NODE, NODE_R);
        ctx.fillStyle = `rgba(${TEAL}, ${0.5 * a * I})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${TEAL}, ${0.75 * a * I})`;
        ctx.stroke();
      }
    };

    measure();

    // ---- reduced motion: one static snapshot, no loop, no scroll ----
    if (reduced) {
      const render = () => {
        measure();
        blocks = [];
        frontier = [];
        deepestY = 0;
        camera = 0;
        fillTo(cssH * 2, 0);
        draw(FADE_MS);
      };
      render();
      const ro = new ResizeObserver(render);
      ro.observe(wrap);
      return () => ro.disconnect();
    }

    let raf = 0;
    let lastFrame = 0;
    let visible = true;
    let running = false;

    const anyFading = (now: number) =>
      blocks.length > 0 && now - blocks[blocks.length - 1].born < FADE_MS;

    const tick = (now: number) => {
      if (now - lastFrame < FRAME_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(80, now - lastFrame);
      lastFrame = now;

      const target = cameraTarget();
      if (mode.ease === null) {
        // LOCKSTEP: snap. Easing would visibly trail the content.
        camera = target;
      } else {
        camera += (target - camera) * Math.min(1, dt / mode.ease);
      }

      // Scroll-driven generation: scrolling down is what reveals more DAG.
      fillTo(camera + cssH * mode.genAhead, now);
      draw(now);

      if (Math.abs(target - camera) < SETTLE_PX && !anyFading(now)) {
        camera = target;
        draw(now);
        running = false;
        raf = 0;
        return; // suspend until the next scroll
      }
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      lastFrame = performance.now() - FRAME_MS;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    // Seed so the layer is never empty, back-dating births so the initial
    // graph is settled rather than blooming all at once.
    const t0 = performance.now();
    let seeded = 0;
    camera = cameraTarget();
    while (deepestY < camera + cssH * mode.genAhead) {
      spawnRound(t0 - FADE_MS - seeded * 45);
      seeded++;
    }
    draw(t0);

    const onScroll = () => wake();
    window.addEventListener("scroll", onScroll, { passive: true });

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) {
          // Paint immediately; do not wait for a frame that may be throttled.
          draw(performance.now());
          wake();
        } else stop();
      },
      { threshold: 0 }
    );
    io.observe(wrap);
    /** Resize clears the canvas — setting canvas.width always does — so
     * redraw SYNCHRONOUSLY here rather than relying on the rAF loop. A
     * background/occluded tab throttles rAF, and depending on it left the
     * rail blank until the next scroll. Found while verifying in a
     * non-foreground automated window, 2026-08-05. */
    const redraw = () => {
      measure();
      fillTo(camera + cssH * mode.genAhead, performance.now());
      draw(performance.now());
    };
    const ro = new ResizeObserver(() => {
      redraw();
      wake();
    });
    ro.observe(wrap);
    const onVisibility = () => (document.hidden ? stop() : wake());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, seed, wrapRef, canvasRef]);
}

const EDGE_MASK =
  "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)";

/**
 * MOBILE BACKDROP — in the document, not on top of it.
 *
 * WHY THIS IS NOT A CANVAS WITH A SCROLL HANDLER. The previous version was
 * position:fixed with a JS camera tracking window.scrollY. Even snapped
 * (no easing) that stutters: native scrolling is composited off the main
 * thread, so a main-thread repaint always lands a frame or more behind the
 * content it is supposed to be locked to. Throttling or easing the handler
 * reduces the symptom and cannot remove it — the two are simply not on the
 * same clock.
 *
 * Since the mobile brief is LOCKSTEP — no parallax, no independent motion —
 * the element does not need to know about scrolling at all. It is an
 * absolutely-positioned child spanning the page, so the browser scrolls it
 * as part of the document. Perfect sync by construction, and ZERO scroll
 * listeners, zero rAF, zero repaint while scrolling.
 *
 * SVG rather than canvas, because this now spans the whole page rather
 * than one viewport: a full-height canvas at device pixel ratio would be
 * tens of megabytes on a phone. The SVG is generated once, is a few
 * hundred static nodes, and costs nothing to scroll.
 *
 * Trade-off taken deliberately: no scroll-driven reveal on mobile. Doing
 * that without a scroll handler needs animation-timeline, which is not
 * broadly supported yet. Per the brief, smoothness beats the reveal here.
 */
function MobileBackdrop() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let last = "";
    const build = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      // Regenerating on every sub-pixel resize would be wasteful; only
      // rebuild when the box meaningfully changes.
      const key = `${Math.round(w / 8)}x${Math.round(h / 40)}`;
      if (key === last) return;
      last = key;

      const rand = makeRand(0xba5e);
      const laneCount = Math.max(3, Math.round(w / M_LANE_W) - 1);
      const rowCount = Math.ceil(h / M_ROW_H) + 1;
      const laneX = (i: number) =>
        w / 2 + (i - (laneCount - 1) / 2) * M_LANE_W;

      type P = { x: number; y: number };
      let prev: P[] = [];
      const rects: string[] = [];
      let edges = "";

      for (let r = 0; r < rowCount; r++) {
        const y = r * M_ROW_H;
        // Same uneven parallelism as the rail: mostly a few, sometimes more.
        const count = Math.min(laneCount, 2 + Math.floor(rand() * 5));
        const pool = Array.from({ length: laneCount }, (_, i) => i);
        const chosen: number[] = [];
        for (let c = 0; c < count; c++) {
          chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
        }
        chosen.sort((a, b) => a - b);
        const row: P[] = chosen.map((i) => ({ x: laneX(i), y }));

        for (const b of row) {
          if (prev.length) {
            const want = Math.min(prev.length, 1 + Math.floor(rand() * 3));
            // Nearest parents: across a wide band random ones make long
            // crossing edges that read as clutter behind text.
            const cand = [...prev].sort(
              (m, n) => Math.abs(m.x - b.x) - Math.abs(n.x - b.x)
            );
            for (let k = 0; k < want; k++) {
              const p0 = cand[k];
              const my = (p0.y + b.y) / 2;
              edges += `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}C${p0.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
            }
          }
          rects.push(
            `<rect x="${(b.x - NODE / 2).toFixed(1)}" y="${(b.y - NODE / 2).toFixed(1)}" width="${NODE}" height="${NODE}" rx="${NODE_R}"/>`
          );
        }
        prev = row;
      }

      const I = MOBILE_INTENSITY;
      // Built from numbers this component generated — no external input
      // reaches this string.
      host.innerHTML =
        `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" ` +
        `xmlns="http://www.w3.org/2000/svg" style="display:block">` +
        `<path d="${edges}" stroke="rgba(${TEAL},${(0.15 * I).toFixed(3)})" stroke-width="1"/>` +
        `<g fill="rgba(${TEAL},${(0.5 * I).toFixed(3)})" stroke="rgba(${TEAL},${(0.75 * I).toFixed(3)})" stroke-width="1">` +
        rects.join("") +
        `</g></svg>`;
    };

    build();
    // The page grows as content settles; rebuild when it does. This is the
    // ONLY observer — nothing here listens to scroll.
    const ro = new ResizeObserver(build);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{
        zIndex: -1,
        // Fixed-pixel fades: the element is page-height, so percentage
        // stops would dissolve enormous regions of it.
        maskImage:
          "linear-gradient(to bottom, transparent 0, black 140px, black calc(100% - 140px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0, black 140px, black calc(100% - 140px), transparent 100%)",
      }}
      className="lg:hidden pointer-events-none select-none absolute inset-0 overflow-hidden opacity-70"
    />
  );
}

export function DagVisual() {
  const railWrap = useRef<HTMLDivElement | null>(null);
  const railCanvas = useRef<HTMLCanvasElement | null>(null);

  useDagLayer(RAIL, 0xda6, railWrap, railCanvas);

  return (
    <>
      {/* DESKTOP: left-margin rail. `left` is derived from the same 42rem
          column the layout centres, so it tracks the content column at any
          width without ever overlapping it. */}
      <div
        ref={railWrap}
        aria-hidden
        style={{
          left: "calc((100vw - 42rem) / 2 - 9.75rem)",
          maskImage: EDGE_MASK,
          WebkitMaskImage: EDGE_MASK,
        }}
        className="hidden lg:block pointer-events-none select-none fixed top-0 z-0 h-screen w-[8.25rem]"
      >
        <canvas ref={railCanvas} className="block h-full w-full opacity-70" />
      </div>

      <MobileBackdrop />
    </>
  );
}
