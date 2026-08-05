"use client";
// Left-rail blockDAG — Kaspa building blocks in parallel, down the margin.
//
// PLACEMENT: pinned to the VIEWPORT (position: fixed) in the left margin,
// entirely outside the centred content column, so it is always visible and
// can never overlap the hero. The value proposition stays the focal point;
// this is living texture in the periphery.
//
// MOTION IS ENTIRELY SCROLL-DRIVEN. There is no timer and no self-motion:
// if the page is still, the graph is still. The camera is a function of
// scroll position alone, moved at ~1.35x page speed so the rail parallaxes
// — fast enough to feel a little independent and give depth, slow enough
// to stay obviously tied to the scroll. The value is eased toward its
// target rather than applied 1:1, which is what keeps it smooth.
//
// BLOCKS MATERIALISE IN VIEW. Generation is tied to scroll depth, not to a
// clock: as the camera advances, rounds are created just inside the lower
// part of the rail and fade in where you can see them, instead of streaming
// up from below the edge. Scroll further, more of the DAG exists; stop, and
// nothing new appears.
//
// PARALLELISM SHOWS IN THE COUNT, NOT THE SPEED — rounds hold 2-7 blocks,
// unevenly, each citing several parents, so it stays a woven DAG.
//
// SIMULATED. No node is contacted: the page must look alive whether or not
// a node is reachable. Wiring real TN10 data later means replacing
// `spawnRound` alone.
//
// COST: one canvas, one rAF loop capped at ~30fps that SUSPENDS ITSELF as
// soon as the camera settles and nothing is still fading — so an idle page
// costs nothing at all. Also stopped when the tab is hidden or the rail is
// not displayed. Under prefers-reduced-motion it never starts a loop.
import { useEffect, useRef } from "react";

const ROW_H = 52; // vertical distance between rounds
const LANE_W = 18; // horizontal distance between parallel blocks
const NODE = 6.5; // block edge length (SQUARE — these are blocks)
const NODE_R = 1.6; // corner radius
const FRAME_MS = 1000 / 30; // framerate cap
const FADE_MS = 800;
const MAX_BLOCKS = 900;
/** Above 1 so the rail drifts faster than the page — the parallax that
 * gives it depth. Well under 2 so it never feels detached. */
const SCROLL_FACTOR = 1.35;
/** Generate down to this fraction of the rail height, i.e. INSIDE the
 * visible area, so new blocks fade in where they can be seen. */
const GEN_AHEAD = 0.78;
/** Camera is considered settled below this, at which point the loop stops. */
const SETTLE_PX = 0.15;

const TEAL = "73, 234, 203";

interface Block {
  wy: number;
  lane: number; // fractional, centred on 0
  born: number;
  parents: Block[];
}

function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function DagVisual() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = makeRand(0xda6);

    let blocks: Block[] = [];
    let frontier: Block[] = [];
    let deepestY = 0;
    let camera = 0;
    let cssW = 0;
    let cssH = 0;

    /** Uneven by design. Mostly 2-5 with an occasional spike toward 7 — a
     * flat uniform roll still reads as a metronome, whereas a rare burst
     * reads as a network under varying load. */
    const roundSize = () => {
      let n = 2 + Math.floor(rand() * 4); // 2-5
      if (rand() < 0.22) n += 1 + Math.floor(rand() * 2); // spike to 6-7
      return Math.min(7, n);
    };

    const spawnRound = (now: number) => {
      const count = roundSize();
      const round: Block[] = [];
      for (let i = 0; i < count; i++) {
        // Centred on lane 0 whatever the size, so the column stays anchored
        // instead of drifting sideways when a burst lands.
        const lane = i - (count - 1) / 2;
        const parents: Block[] = [];
        if (frontier.length) {
          const want = Math.min(frontier.length, 1 + Math.floor(rand() * 3));
          const pool = [...frontier];
          for (let p = 0; p < want; p++) {
            parents.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
          }
        }
        round.push({ wy: deepestY, lane, born: now, parents });
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

    /** Extend the DAG to a world depth. Called only from scroll-driven
     * camera movement — never on a timer. */
    const fillTo = (targetWorldY: number, now: number) => {
      let guard = 0;
      while (deepestY < targetWorldY && guard++ < 400) spawnRound(now);
    };

    const cameraTarget = () => window.scrollY * SCROLL_FACTOR;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      const cx = cssW / 2;
      const sx = (b: Block) => cx + b.lane * LANE_W;
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
          ctx.strokeStyle = `rgba(${TEAL}, ${0.15 * a})`;
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
        // Brief square halo as a block materialises, then it settles.
        if (!reduced && age < FADE_MS) {
          const g = 1 - age / FADE_MS;
          const s = NODE + 7 * g;
          ctx.beginPath();
          ctx.roundRect(x - s / 2, y - s / 2, s, s, NODE_R + 1.5);
          ctx.fillStyle = `rgba(${TEAL}, ${0.09 * g})`;
          ctx.fill();
        }
        // SQUARE blocks — they are blocks, so they read as blocks.
        ctx.beginPath();
        ctx.roundRect(x - NODE / 2, y - NODE / 2, NODE, NODE, NODE_R);
        ctx.fillStyle = `rgba(${TEAL}, ${0.5 * a})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${TEAL}, ${0.75 * a})`;
        ctx.stroke();
      }
    };

    measure();

    // ---- reduced motion: one static, faded snapshot. No loop, no scroll ----
    if (reduced) {
      const render = () => {
        measure();
        fillTo(cssH * 2, 0);
        camera = 0;
        draw(FADE_MS);
      };
      render();
      const ro = new ResizeObserver(render);
      ro.observe(wrap);
      return () => ro.disconnect();
    }

    // ---- animated ----
    let raf = 0;
    let lastFrame = 0;
    let visible = true;
    let running = false;

    const anyFading = (now: number) =>
      blocks.length > 0 && now - blocks[blocks.length - 1].born < FADE_MS;

    const tick = (now: number) => {
      if (now - lastFrame < FRAME_MS) {
        raf = requestAnimationFrame(tick); // framerate cap
        return;
      }
      const dt = Math.min(80, now - lastFrame);
      lastFrame = now;

      const target = cameraTarget();
      // Ease toward the scroll-derived target. This is the whole motion
      // model — there is no clock term, so a still page is a still graph.
      camera += (target - camera) * Math.min(1, dt / 220);

      // Scroll-driven generation: new rounds land INSIDE the visible area
      // and fade in there, rather than streaming up from below the edge.
      fillTo(camera + cssH * GEN_AHEAD, now);

      draw(now);

      // SUSPEND when there is nothing left to animate. The next scroll
      // wakes it. An idle page costs zero frames.
      if (Math.abs(target - camera) < SETTLE_PX && !anyFading(now)) {
        camera = target;
        draw(now);
        running = false;
        raf = 0;
        return;
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

    // Seed so the rail is never empty, back-dating births so the initial
    // graph is settled rather than blooming all at once on arrival.
    const t0 = performance.now();
    let seeded = 0;
    camera = cameraTarget();
    while (deepestY < camera + cssH * GEN_AHEAD) {
      spawnRound(t0 - FADE_MS - seeded * 45);
      seeded++;
    }
    draw(t0);

    const onScroll = () => wake();
    window.addEventListener("scroll", onScroll, { passive: true });

    // The rail is display:none below lg, so this also guarantees no loop
    // on phones even if the component mounts.
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) wake();
        else stop();
      },
      { threshold: 0 }
    );
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      measure();
      wake();
    });
    ro.observe(wrap);
    const onVisibility = () => {
      if (document.hidden) stop();
      else wake();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    // MOBILE DEGRADATION: removed outright below lg (1024px). The content
    // column is 42rem; the rail plus its gutter needs ~10rem of free margin
    // per side, which only exists from ~1024px up. Below that it would
    // squeeze the hero, and a cramped sliver of half-drawn graph is worse
    // than none.
    //
    // Precisely what "removed" means, since it is easy to overclaim: the
    // component still mounts and the effect still runs once — React does
    // not skip a display:none subtree. What does NOT happen is the
    // expensive part. A display:none element has no box, so the
    // IntersectionObserver reports it as not intersecting and the rAF loop
    // is suspended immediately; getBoundingClientRect returns 0x0, so the
    // canvas is clamped to 1x1 and the seed pass creates a single round.
    // Net cost on a phone is one trivial draw and two observers, and it
    // heals itself on rotation or resize because those observers stay live.
    //
    // FIXED to the viewport, with `left` derived from the same 42rem column
    // the layout centres, so the rail tracks the content at any width
    // without overlapping it.
    <div
      ref={wrapRef}
      aria-hidden
      style={{
        left: "calc((100vw - 42rem) / 2 - 9.75rem)",
        // Dissolve into the page at both edges instead of hard-cutting at
        // the viewport boundary.
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
      }}
      className="hidden lg:block pointer-events-none select-none fixed top-0 z-0 h-screen w-[8.25rem]"
    >
      <canvas ref={canvasRef} className="block h-full w-full opacity-70" />
    </div>
  );
}
