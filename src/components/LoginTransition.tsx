import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { UniMark } from './UniMark';

interface LoginTransitionProps {
  isLoading: boolean;
  progress: number;
  currentStep: string;
  onComplete?: () => void;
}

export function LoginTransition({
  isLoading,
  progress,
  currentStep,
  onComplete,
}: LoginTransitionProps) {
  const prefersReducedMotion = useReducedMotion();
  const [percent, setPercent] = useState(0);

  // Smoothly interpolate percentage updates to prevent jarring jumps
  useEffect(() => {
    let animationFrameId: number;
    const start = percent;
    const end = Math.min(Math.max(progress, 0), 100);
    const duration = 400; // ms
    const startTime = performance.now();

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      const current = Math.round(start + (end - start) * ease);
      setPercent(current);

      if (t < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        if (current >= 100 && !isLoading && onComplete) {
          onComplete();
        }
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [progress, isLoading, onComplete]);

  // SVG parameters for progress ring
  const radius = 110;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Signing you in"
      className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-surface overflow-hidden select-none"
    >
      {/* Faint gold wash — tone, not decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-140 h-140 rounded-full bg-primary/[0.06] blur-[120px] pointer-events-none" />

      {/* Quiet progress ring + mark */}
      <div className="relative flex items-center justify-center w-70 h-70">
        <svg className="absolute w-60 h-60 -rotate-90" viewBox="0 0 240 240">
          {/* Static track */}
          <circle
            cx="120"
            cy="120"
            r={radius}
            className="stroke-muted fill-transparent"
            strokeWidth="1.5"
          />
          {/* Active arc */}
          <motion.circle
            cx="120"
            cy="120"
            r={radius}
            className="stroke-primary fill-transparent"
            strokeWidth="2"
            strokeLinecap="round"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: strokeDashoffset,
            }}
            transition={prefersReducedMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 60, damping: 15 }}
          />
        </svg>

        {/* Seal mark */}
        <div className="absolute w-16 h-16 rounded-md border border-primary/30 bg-surface flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <UniMark size={40} className="text-primary" />
        </div>
      </div>

      {/* Step text */}
      <div className="mt-4 text-center px-6 max-w-sm h-14 flex flex-col justify-center">
        <motion.p
          key={currentStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="text-sm sm:text-base font-normal text-ink/90"
        >
          {currentStep}
        </motion.p>
      </div>

      {/* Percentage */}
      <span className="mt-3 text-xs font-mono font-medium text-primary tracking-[0.15em]">
        {percent}%
      </span>
    </div>
  );
}