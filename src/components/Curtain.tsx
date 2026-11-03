import React, { useEffect, useState } from 'react';
import { UniMark } from './UniMark';

/**
 * The maison opening: black lacquer holds ONE gold seal — ring drawn
 * stroke-by-stroke — then the stage panels part vertically like a curtain
 * and the seal fades as the site is revealed beneath. The composition is
 * rendered exactly once. Skipped under prefers-reduced-motion.
 */
export const Curtain: React.FC = () => {
  const [phase, setPhase] = useState<'hold' | 'part' | 'done'>('hold');

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPhase('done');
      return;
    }
    const t1 = window.setTimeout(() => setPhase('part'), 1650);
    const t2 = window.setTimeout(() => setPhase('done'), 1650 + 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === 'done') return null;

  const parting = phase === 'part';

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none" aria-hidden="true">
      {/* stage panels — plain lacquer, gold hairline riding the seam */}
      <div
        className="absolute inset-x-0 top-0 h-1/2"
        style={{
          background: 'linear-gradient(180deg, #0a0805 0%, #0d0a07 100%)',
          animation: parting ? 'part-up 1.05s cubic-bezier(0.83, 0, 0.17, 1) forwards' : undefined,
        }}
      >
        <div className="absolute bottom-0 inset-x-0 h-px gold-rule" style={{ animationDelay: '0.55s' }} />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: 'linear-gradient(0deg, #0a0805 0%, #0d0a07 100%)',
          animation: parting ? 'part-down 1.05s cubic-bezier(0.83, 0, 0.17, 1) forwards' : undefined,
        }}
      >
        <div className="absolute top-0 inset-x-0 h-px gold-rule" style={{ animationDelay: '0.55s' }} />
      </div>

      {/* the single seal composition, centered over the seam */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          animation: parting ? 'seal-fade 0.5s ease forwards' : undefined,
        }}
      >
        <div
          className="flex flex-col items-center gap-5 select-none"
          style={{ animation: 'seal-breathe 2.6s ease-in-out infinite' }}
        >
          <div className="relative">
            <svg width="104" height="104" viewBox="0 0 104 104" fill="none" aria-hidden="true">
              <circle
                cx="52" cy="52" r="50"
                stroke="#c9a35c"
                strokeWidth="1"
                fill="none"
                strokeDasharray="420"
                style={{ animation: 'seal-draw 1.5s cubic-bezier(0.65, 0, 0.35, 1) 0.1s both' }}
              />
              <circle cx="52" cy="52" r="44" stroke="rgba(201,163,92,0.28)" strokeWidth="0.75" fill="none" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <UniMark size={40} className="text-gold" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2.5">
            <span className="font-display text-[30px] tracking-[0.02em] text-cream" style={{ fontWeight: 500 }}>
              UniInfo
            </span>
            <span className="text-[9.5px] font-mono tracking-[0.34em] uppercase text-gold/70">
              Private university intelligence
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
