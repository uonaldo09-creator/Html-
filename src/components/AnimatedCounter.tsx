import React, { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useInViewOnce } from './motion';

interface Props {
  target: number;
  suffix?: string;
  prefix?: string;
  /** Decimal places for figures like ₹3.20L */
  decimals?: number;
  duration?: number;
  className?: string;
}

export const AnimatedCounter: React.FC<Props> = ({
  target,
  suffix = '',
  prefix = '',
  decimals = 0,
  duration = 1800,
  className = '',
}) => {
  const [count, setCount] = useState(0);
  const { ref, inView } = useInViewOnce<HTMLSpanElement>();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce) { setCount(target); return; }
    const t0 = performance.now();
    let raf = 0;
    let stopped = false;
    const finish = () => { setCount(target); stopped = true; };
    const step = (ts: number) => {
      if (stopped) return;
      const progress = Math.min((ts - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setCount(eased * target);
      if (progress < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    // Interval fallback: some embedded webviews never advance rAF frames.
    const tick = () => {
      if (stopped) return;
      const progress = Math.min((performance.now() - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setCount(eased * target);
      if (progress >= 1) { setCount(target); stopped = true; }
    };
    raf = requestAnimationFrame(step);
    const interval = window.setInterval(tick, 33);
    const safety = window.setTimeout(finish, duration + 400);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
      window.clearTimeout(safety);
    };
  }, [inView, target, duration, reduce]);

  const display = decimals > 0
    ? count.toFixed(decimals)
    : Math.floor(count).toLocaleString('en-IN');

  return (
    <span ref={ref} className={className} aria-label={`${prefix}${target}${suffix}`}>
      {prefix}{display}{suffix}
    </span>
  );
};