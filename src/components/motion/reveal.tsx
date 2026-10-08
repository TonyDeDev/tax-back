"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * Fades its block up once, the first time 15% of it is on screen. Hairlines inside marked
 * `data-hairline` draw in from the left (src/app/globals.css). Without JavaScript nothing is hidden.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.revealed = "";
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal className={className}>
      {children}
    </div>
  );
}
