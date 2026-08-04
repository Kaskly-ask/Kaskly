"use client";
// World-space specular sheen driver (glass diagnosis 2026-08-04): the
// pure-CSS route (background-attachment: fixed) mispaints alongside
// backdrop-filter in Chromium, so this is the agreed fallback — an
// rAF-throttled scroll listener sliding the sheen layer via a CSS
// variable. Parallax is deliberately subtle (~15% of scroll — a drift,
// not a slide) and disabled under prefers-reduced-motion.
import { useEffect } from "react";

const PARALLAX = 0.15;

export function SheenController() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      document.documentElement.style.setProperty(
        "--sheen-shift",
        `${window.scrollY * PARALLAX}px`
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
