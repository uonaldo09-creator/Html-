import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Cinematic motion primitives for UniInfo.
 *
 * The video language this product is built on: elements are physically placed
 * into the scene — lines of type clip up from beneath a mask, images reveal
 * through a wipe, and sections assemble themselves as the reader scrolls.
 * Everything runs on transform/opacity only, honours prefers-reduced-motion,
 * and fires exactly once.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** True once the element is substantially on screen. IO-backed with a
 *  lightweight rect-check fallback (some embedded webviews never fire IO). */
export function useInViewOnce<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isVisible = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const rect = el.getBoundingClientRect();
      return rect.top < vh * 0.94 && rect.bottom > vh * 0.06;
    };

    if (isVisible()) { setInView(true); return; }

    let poll: number | undefined;
    const done = () => {
      setInView(true);
      if (poll) window.clearInterval(poll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    const onScroll = () => { if (isVisible()) done(); };
    poll = window.setInterval(onScroll, 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      if (poll) window.clearInterval(poll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return { ref, inView };
}

interface MaskedRevealProps {
  children: React.ReactNode;
  /** Seconds to wait before the mask lifts */
  delay?: number;
  duration?: number;
  className?: string;
  as?: 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'p';
}

/**
 * The signature text reveal: the line sits inside an overflow-hidden mask and
 * rises out of it, so the type reads as physically placed, not faded. The
 * inner element is padded (and the mask compensated) so serif descenders and
 * italic overhang are never clipped. Stagger siblings with `delay`.
 */
export const MaskedReveal: React.FC<MaskedRevealProps> = ({
  children,
  delay = 0,
  duration = 0.9,
  className = '',
  as = 'div',
}) => {
  const reduce = useReducedMotion();
  const Comp = (motion as any)[as] ?? motion.div;

  return (
    <Comp
      className={className}
      style={{ overflow: 'hidden' }}
    >
      <motion.span
        style={{
          display: 'block',
          padding: '0 0.05em 0.12em',
          margin: '0 -0.05em -0.12em',
          willChange: 'transform',
        }}
        initial={reduce ? false : { y: '112%' }}
        animate={{ y: '0%' }}
        exit={{ y: '112%' }}
        transition={{ delay, duration, ease: EASE }}
      >
        {children}
      </motion.span>
    </Comp>
  );
};

interface RevealProps {
  children: React.ReactNode;
  /** Stagger offset in seconds (for sibling cascades) */
  delay?: number;
  /** Extra vertical travel — larger feels more deliberate */
  distance?: number;
  className?: string;
  once?: boolean;
}

/**
 * Quiet section reveal: content rises into place the first time it scrolls
 * into view. The restrained default for everything that isn't a hero moment.
 */
export const Reveal: React.FC<RevealProps> = ({
  children,
  delay = 0,
  distance = 22,
  className = '',
}) => {
  const reduce = useReducedMotion();
  const { ref, inView } = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} className={className}>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: distance }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: distance }}
        transition={{ delay, duration: 0.8, ease: EASE }}
      >
        {children}
      </motion.div>
    </div>
  );
};

interface ImageRevealProps {
  src: string;
  alt: string;
  className?: string;
  /** Wipe direction — vertical (clip from bottom) or horizontal */
  direction?: 'up' | 'left';
  delay?: number;
  imgClassName?: string;
}

/**
 * Photographic reveal: the image is held in a mask that wipes open, then the
 * photograph itself settles in with a slow scale. Used for the prospectus
 * image strips and any hero imagery.
 */
export const ImageReveal: React.FC<ImageRevealProps> = ({
  src,
  alt,
  className = '',
  direction = 'up',
  delay = 0,
  imgClassName = '',
}) => {
  const reduce = useReducedMotion();
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const clip = direction === 'up' ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)';

  return (
    <div ref={ref} className={`overflow-hidden ${className}`} style={{ willChange: 'clip-path' }}>
      <motion.img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={imgClassName}
        initial={reduce ? false : { clipPath: clip, scale: 1.08 }}
        animate={inView ? { clipPath: 'inset(0 0 0% 0)', scale: 1 } : { clipPath: clip, scale: 1.08 }}
        transition={{ delay, duration: 1.1, ease: EASE }}
      />
    </div>
  );
};