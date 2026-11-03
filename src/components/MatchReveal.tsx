import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

interface MatchRevealProps {
  /** Match score 0–100 */
  score: number;
  /** Diameter of the ring in px */
  size?: number;
  /** Ring stroke width */
  stroke?: number;
  className?: string;
}

/**
 * The one orchestrated motion moment of the product: when a card enters the
 * viewport, a hairline gold ring draws closed around a numeral that counts up
 * from zero. Fires exactly once per card; honours prefers-reduced-motion.
 */
export const MatchReveal: React.FC<MatchRevealProps> = ({
  score,
  size = 56,
  stroke = 1.4,
  className = '',
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const [inView, setInView] = useState(false);
  const [count, setCount] = useState(0);

  const clamped = Math.max(0, Math.min(Math.round(score), 100));
  const r = (size - stroke) / 2 - 1.5;
  const C = 2 * Math.PI * r;

  // Trigger exactly once when the ring is substantially on screen. Uses a
  // lightweight visibility check (belt and braces over IntersectionObserver,
  // which some embedded webviews never fire) and stops polling once lit.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isMostlyVisible = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const rect = el.getBoundingClientRect();
      return rect.top < vh * 0.96 && rect.bottom > vh * 0.04;
    };

    if (isMostlyVisible()) {
      setInView(true);
      return;
    }

    const poll = window.setInterval(() => {
      if (isMostlyVisible()) {
        setInView(true);
        window.clearInterval(poll);
      }
    }, 350);

    const onScroll = () => {
      if (isMostlyVisible()) {
        setInView(true);
        window.clearInterval(poll);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
      }
    };
    const onResize = () => onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Count the numeral once, eased; reduced motion jumps straight to the figure
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setCount(clamped);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const duration = 1500;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4); // easeOutQuart
      setCount(Math.round(eased * clamped));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, clamped, reduce]);

  const dashOffset = inView ? 0 : C;

  return (
    <span
      ref={ref}
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
      >
        {/* Static hairline track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        {/* Gold arc that draws closed on view */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span
        className="tnum font-display text-primary leading-none relative"
        style={{ fontSize: Math.max(15, Math.round(size * 0.34)) }}
      >
        {count}
      </span>
    </span>
  );
};