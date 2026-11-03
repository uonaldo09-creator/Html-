import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  angle: number;
  velocity: number;
  isTriangle: boolean;
}

interface Props {
  active: boolean;
  x?: number;
  y?: number;
}

const COLORS = ['#c9a35c', '#a8813d', '#c9a46a', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f87171', '#6e4a20', '#fb923c'];

export const ConfettiEffect: React.FC<Props> = ({ active, x = 0, y = 0 }) => {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    setKey(k => k + 1);
    const count = 30;
    const ps: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      x,
      y,
      color: COLORS[i % COLORS.length],
      size: Math.random() * 8 + 4,
      angle: (i * (360 / count)) + (Math.random() - 0.5) * 40,
      velocity: Math.random() * 150 + 80,
      isTriangle: Math.random() > 0.66,
    }));
    setParticles(ps);
  }, [active, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
      <AnimatePresence>
        {particles.map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const dx = Math.cos(rad) * p.velocity;
          const dy = Math.sin(rad) * p.velocity;

          const baseStyle: React.CSSProperties = p.isTriangle
            ? {
                position: 'absolute',
                left: p.x,
                top: p.y,
                width: 0,
                height: 0,
                borderLeft: `${p.size / 2}px solid transparent`,
                borderRight: `${p.size / 2}px solid transparent`,
                borderBottom: `${p.size}px solid ${p.color}`,
                backgroundColor: 'transparent',
              }
            : {
                position: 'absolute',
                left: p.x - p.size / 2,
                top: p.y - p.size / 2,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                borderRadius: Math.random() > 0.5 ? '50%' : '2px',
              };

          return (
            <motion.div
              key={`${key}-${p.id}`}
              style={baseStyle}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
              animate={{
                x: dx,
                y: dy + 120,
                opacity: 0,
                rotate: Math.random() * 540 - 270,
                scale: 0.1,
              }}
              transition={{ duration: 0.9, ease: [0.25, 0.46, 0.45, 0.94] }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
