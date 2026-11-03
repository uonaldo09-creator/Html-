import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, Compass, Search } from 'lucide-react';
import { University, SortOption } from '../types';
import { UniversityCard } from './UniversityCard';

type PanoramaProps = {
  universities: University[];
  filteredUniversities: University[];
  catalogStats: { campuses: number; programs: number; avgPackage: number; metricProfiles: number; directoryProfiles: number };
  visitorRole: 'parent' | 'student';
  hasProfile: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onViewDetails: (id: number) => void;
  selectedForComparison: number[];
  onToggleComparison: (id: number) => void;
  onExplore: () => void;
  onCompare: () => void;
  onUnibot: () => void;
  onSortChange: (v: SortOption) => void;
  sort: SortOption;
  booted: boolean;
};

const FRAME_DURATION = 360;
const STAGGER = 90;
const REVEAL_ROWS = 4;

export const Panorama: React.FC<PanoramaProps> = ({
  universities,
  filteredUniversities,
  catalogStats,
  visitorRole,
  hasProfile,
  search,
  onSearchChange,
  onViewDetails,
  selectedForComparison,
  onToggleComparison,
  onExplore,
  onCompare,
  onUnibot,
  onSortChange,
  sort,
  booted,
}) => {
  const [frame, setFrame] = useState({ angle: 0, gamma: 0 });
  const [round, setRound] = useState<0 | 1 | 2>(0);

  const camPreview = useMemo(() => {
    if (!booted || round !== 1) return { perspective: 'none', rotateX: 0, rotateY: 0, scale: 1, opacity: 1 };
    const kx = Math.sin(frame.angle) * 0.6;
    const ky = Math.sin(frame.gamma) * 0.2;
    return {
      perspective: '540px',
      rotateX: ky,
      rotateY: kx,
      scale: 1 + Math.sin(frame.angle * 2 + 0.6) * 0.06,
      opacity: 0.65 + (Math.sin(frame.angle + 1.3) * 0.35 + 0.35) * 0.4,
    };
  }, [frame, booted, round]);

  const camRollback = useMemo(() => {
    if (!booted || round !== 2) return { opacity: 1, clipPath: 'inset(0 0 0% 0)', scale: 1 };
    const t = Math.sin(frame.angle) * 0.5 + 0.5;
    return {
      opacity: 0.2 + t * 0.8,
      clipPath: `inset(0 ${100 - t * 80}%, 0 0)`,
      scale: 0.92 + t * 0.08,
    };
  }, [frame, booted, round]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && search.trim()) onExplore();
    },
    [search, onExplore],
  );

  // live counter
  const liveCount = useRef(0);
  const [live, setLive] = useState(0);
  useEffect(() => {
    liveCount.current = 0;
    const iv = window.setInterval(() => {
      liveCount.current += 1;
      setLive(liveCount.current);
      if (liveCount.current >= catalogStats.campuses) window.clearInterval(iv);
    }, 28);
    return () => window.clearInterval(iv);
  }, [catalogStats.campuses]);

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!booted) return;
    setStarted(true);
  }, [booted]);

  useEffect(() => {
    if (!started || round === 2) return;
    let animationFrameId = 0;
    let active = true;
    const loop = () => {
      if (!active) return;
      setFrame((f) => ({
        angle: f.angle + 0.006,
        gamma: f.gamma + 0.004,
      }));
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [started, round]);

  // camera frame progression on the hero board
  useEffect(() => {
    if (!booted) return;
    const t0 = window.setTimeout(() => setRound(1), FRAME_DURATION);
    const t1 = window.setTimeout(() => setRound(2), FRAME_DURATION * 2);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [booted]);

  const cards = useMemo(() => {
    return filteredUniversities.map((uni, idx) => (
      <motion.div
        key={uni.id}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * STAGGER / 1000, duration: 0.5, ease: 'easeOut' }}
        className="w-full"
      >
        <UniversityCard
          university={uni}
          index={idx}
          isSelected={selectedForComparison.includes(uni.id)}
          onToggleSelection={onToggleComparison}
          onViewDetails={() => onViewDetails(uni.id)}
          visitorRole={visitorRole}
        />
      </motion.div>
    ));
  }, [filteredUniversities, visitorRole, onViewDetails, selectedForComparison, onToggleComparison]);

  const storyComponents = useMemo(() => {
    return universities.slice(0, REVEAL_ROWS).map((uni) => (
      <div key={uni.id} className="flex items-center gap-4 px-4 py-3">
        <div className="relative w-16 h-16 rounded-full overflow-hidden bg-surface border border-line">
          <img
            src={uni.image}
            alt={uni.name}
            className="w-full h-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="flex flex-col">
          <span className="font-display text-lg font-semibold leading-tight text-ink">{uni.name}</span>
          <span className="text-xs text-muted-foreground">{uni.location}, {uni.state}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-primary tracking-wide">NIRF #{uni.nirfRank}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
        </div>
      </div>
    ));
  }, [universities]);

  return (
    <motion.div
      className="relative w-full"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08, duration: 0.7 }}
    >
      {/* wiper gate: camera PREVIEW + ROLLBACK */}
      <AnimatePresence mode="wait">
        {booted && (
          <motion.div
            key={round}
            className="absolute inset-0 pointer-events-none z-20"
            initial={round === 1 ? { opacity: 0.7, scale: 0.98, filter: 'blur(8px)' } : { opacity: 0, scale: 1.02, filter: 'blur(0px)' }}
            animate={{
              opacity: round === 1 ? 0.85 : 0,
              scale: round === 1 ? 1 + Math.sin(frame.angle * 4) * 0.03 : 1,
              filter: round === 2 ? 'blur(3px)' : 'blur(0px)',
              transition: { duration: 0.5 },
            }}
          >
            {/* camera-preview gradient overlay */}
            <motion.div
              className="absolute inset-0"
              style={{
                ...camPreview,
                background: 'radial-gradient(100% 80% at 50% 50%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.1) 60%, transparent 70%)',
              }}
            />

            {/* camera-rollback reveal strip */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 h-full pointer-events-none"
              style={{ ...camRollback, clipPath: camRollback.clipPath, transition: `clip-path ${FRAME_DURATION}ms cubic-bezier(0.65,0,0.35,1), opacity ${FRAME_DURATION}ms ease, transform ${FRAME_DURATION}ms ease` }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(135deg, rgba(0,0,0,${0.2 + Math.sin(frame.angle) * 0.1}) 0%, rgba(0,0,0,${0.1 + Math.sin(frame.angle * 2) * 0.05}) 50%, rgba(0,0,0,${0.4}) 100%)`,
                  backdropFilter: 'blur(1px)',
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* grain mask */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          maskImage: 'linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.5) 100%)',
          WebkitMaskImage: 'linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.5) 100%)',
        }}
      >
        <div
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0, transparent 120px, rgba(0,0,0,0.03) 120px, rgba(0,0,0,0.03) 121px), repeating-linear-gradient(90deg, transparent 0, transparent 120px, rgba(0,0,0,0.03) 120px, rgba(0,0,0,0.03) 121px)',
          }}
          className="absolute inset-0 w-full h-full"
        />
      </div>

      {/* hero board */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
        {/* header */}
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground"
            >
              {visitorRole === 'parent' ? 'Strategic enrollment report' : 'Recommended universities'}
            </motion.span>
            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.5 }}
              className="font-display text-ink text-3xl font-semibold mt-1 tracking-tight"
            >
              {visitorRole === 'parent'
                ? 'Your shortlist'
                : hasProfile ? 'Matched to your profile' : 'Explore the catalog'}
            </motion.h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-muted-foreground hidden sm:block">Sort</span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="rounded-xl px-4 py-2 text-[13px] font-semibold text-ink bg-surface border border-line outline-none transition-colors hover:border-ink/60 focus:border-primary cursor-pointer"
            >
              <option value="match">{hasProfile ? 'Profile match' : 'Highest rated'}</option>
              <option value="rating">{visitorRole === 'parent' ? 'Academic rating' : 'Verified ratings'}</option>
              <option value="nirf">NIRF rank</option>
              <option value="placement">{visitorRole === 'parent' ? 'Placement ROI' : 'Avg placement (LPA)'}</option>
              <option value="feeLow">Fee: low to high</option>
            </select>
          </div>
        </div>

        {/* live counter */}
        <motion.div
          className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.4 }}
        >
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="font-medium">
            {live} / {catalogStats.campuses} campuses · {catalogStats.programs.toLocaleString()} counted programs · ₹{catalogStats.avgPackage} LPA avg across {catalogStats.metricProfiles} profiles
          </span>
          <span className="sr-only">
            Program totals and placement average are available for {catalogStats.metricProfiles} catalog profiles.
            {catalogStats.directoryProfiles} additional directory profiles have no verified outcome metrics.
          </span>
        </motion.div>

        {/* story rows: camera PREVIEW */}
        <AnimatePresence>
          {round === 1 && (
            <motion.div
              key="story"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              {booted && storyComponents}
            </motion.div>
          )}
        </AnimatePresence>

        {/* live card grid: ROLLBACK reveal */}
        <AnimatePresence>
          {round === 2 && booted && filteredUniversities.length > 0 && (
            <motion.div
              key="grid"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.7, staggerChildren: 0.06 }}
            >
              {cards}
            </motion.div>
          )}
        </AnimatePresence>

        {/* empty state */}
        {!booted || filteredUniversities.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center bg-surface rounded-2xl border border-line"
          >
            <Compass className="w-8 h-8 text-muted-foreground mb-3" />
            <h3 className="font-display text-xl font-semibold text-ink mb-2">No universities found</h3>
            <p className="text-sm text-muted-foreground max-w-xs">Adjust your filters or search to find more campuses.</p>
          </motion.div>
        ) : null}
      </div>

      {/* marquee ticker */}
      <div className="relative z-10 mt-10 overflow-hidden border-y border-line bg-surface py-3">
        <div className="marquee-track flex items-center shrink-0">
          {[0, 1, 2].map((copy) => (
            <div key={copy} className="flex items-center shrink-0">
              {universities.map((u) => (
                <span key={`${copy}-${u.id}`} className="flex items-center gap-6 px-6">
                  <span className="font-display text-xl text-ink/80 whitespace-nowrap">{u.name}</span>
                  <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground whitespace-nowrap">NIRF #{u.nirfRank}</span>
                  <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* search object */}
      <div className="relative z-10 mt-6 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          className="relative group"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: booted ? 1.1 : 0, duration: 0.7, ease: 'easeOut' }}
        >
          <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
            <Search className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-primary" />
            What are you looking for?
          </label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Computer Science in India under ₹4L…"
              className="w-full h-14 bg-surface border border-ink/30 pl-12 pr-16 text-[15px] font-medium text-ink placeholder:text-muted-foreground/70 outline-none transition-all duration-200 hover:border-ink/60 focus:border-primary shadow-[0_12px_32px_-18px_rgba(0,0,0,0.35)]"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center font-mono text-[10px] font-semibold text-muted-foreground px-2 py-1 border border-line bg-paper">
              ↵ explore
            </kbd>
          </div>
        </motion.div>
      </div>

      {/* action buttons */}
      <div className="relative z-10 mt-4 flex items-center justify-center gap-x-10 gap-y-4 pb-6 flex-wrap">
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          onClick={onExplore}
          className="text-[13px] font-semibold tracking-[0.14em] text-primary hover:text-accent-bright transition-colors cursor-pointer bg-transparent border-none underline underline-offset-4 decoration-1 decoration-ink/30 hover:decoration-primary"
        >
          EXPLORE
        </motion.button>
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.6 }}
          onClick={onCompare}
          className="text-[13px] font-semibold tracking-[0.14em] text-muted-foreground hover:text-ink transition-colors cursor-pointer bg-transparent border-none underline underline-offset-4 decoration-1 decoration-ink/20 hover:decoration-primary"
        >
          COMPARE
        </motion.button>
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.46, duration: 0.6 }}
          onClick={onUnibot}
          className="text-[13px] font-semibold tracking-[0.14em] text-muted-foreground hover:text-ink transition-colors cursor-pointer bg-transparent border-none underline underline-offset-4 decoration-1 decoration-ink/20 hover:decoration-primary"
        >
          ASK UNIBOT
        </motion.button>
      </div>

      {/* backdrop canvas */}
      <div
        className="absolute inset-0 -z-10 pointer-events-none overflow-hidden"
        style={{
          background: 'radial-gradient(120% 90% at 50% -12%, #17120a 0%, #0d0a07 46%, #080604 100%)',
        }}
      >
        <motion.div
          className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-30 blur-3xl"
          animate={{
            x: Math.sin(frame.angle) * 40,
            y: Math.cos(frame.angle * 1.4) * 20,
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          style={{
            background: 'radial-gradient(circle, rgba(201,163,92,0.25) 0%, transparent 60%)',
          }}
        />
        <motion.div
          className="absolute -bottom-32 -left-32 w-[320px] h-80 rounded-full opacity-20 blur-3xl"
          animate={{
            x: Math.cos(frame.angle * 1.2) * 50,
            y: Math.sin(frame.angle * 0.9) * 30,
          }}
          transition={{ duration: 11, repeat: Infinity, ease: 'linear' }}
          style={{
            background: 'radial-gradient(circle, rgba(201,163,92,0.3) 0%, transparent 60%)',
          }}
        />
      </div>
    </motion.div>
  );
};
