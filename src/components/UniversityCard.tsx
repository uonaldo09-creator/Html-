import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Heart, MapPin, ShieldCheck } from 'lucide-react';
import { University } from '../types';
import { MatchReveal } from './MatchReveal';
import { getSafeLogo } from '../lib/utils';

interface UniversityCardProps {
  university: University;
  index?: number;
  isSelected?: boolean;
  onToggleSelection?: (id: number) => void;
  onViewDetails?: () => void;
  /** Reports the card's viewport rect before opening, so the prospectus can rise out of the card */
  onViewOrigin?: (rect: DOMRect) => void;
  visitorRole?: 'parent' | 'student';
  isFavorite?: boolean;
  onToggleFavorite?: (id: number, e: React.MouseEvent) => void;
  matchScore?: number;
  onOpenROI?: (university: University) => void;
}

export const UniversityCard = React.memo<UniversityCardProps>(({
  university,
  index = 0,
  isSelected,
  onToggleSelection,
  onViewDetails,
  onViewOrigin,
  isFavorite = false,
  onToggleFavorite,
  matchScore,
  onOpenROI,
}) => {
  const cardRef = useRef<HTMLElement>(null);
  const locationLabel = university.location.toLowerCase().includes(university.state.toLowerCase())
    ? university.location
    : `${university.location} · ${university.state}`;

  const open = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const el = cardRef.current;
    if (el && onViewOrigin) onViewOrigin(el.getBoundingClientRect());
    onViewDetails?.();
  };

  return (
    <motion.article
      ref={cardRef}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      tabIndex={0}
      role="group"
      aria-label={`${university.name} campus profile and actions`}
      className={`card-premium rounded-md overflow-hidden group cursor-pointer ${
        isSelected ? 'selected' : ''
      }`}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface p-2 shadow-sm">
              <img
                src={getSafeLogo(university.name, university.logo)}
                alt={`${university.name} logo`}
                loading="lazy"
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = getSafeLogo(university.name, null);
                }}
              />
            </div>
            <div className="min-w-0">
          <h3 className="display-card min-h-[2.95rem] text-ink group-hover:text-primary transition-colors line-clamp-2">
            {university.name}
          </h3>
              <p className="meta-label mt-2 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" aria-hidden="true" /> {locationLabel}
              </p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">{university.type} University</p>
            </div>
          </div>
          {university.naacGrade && university.naacGrade !== 'Not listed' && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary" title="Reported NAAC grade">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> NAAC {university.naacGrade}
            </span>
          )}
        </div>
        <p className="mt-5 min-h-10 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {university.expertInsight || university.directoryProfile?.courses || 'Explore programs, admissions, and verified university information.'}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {university.directoryProfile?.directoryOnly ? (
            <>
              <div className="rounded-lg border border-line bg-surface p-3">
                <div className="text-xs font-semibold text-ink line-clamp-2">{university.directoryProfile.established}</div>
                <div className="meta-label mt-1.5">established</div>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3">
                <div className="text-xs font-semibold text-ink line-clamp-2">{university.directoryProfile.accreditation}</div>
                <div className="meta-label mt-1.5">accreditation</div>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3">
                <div className="text-xs font-semibold text-ink">{university.courses > 0 ? university.courses : '—'}</div>
                <div className="meta-label mt-1.5">programs</div>
              </div>
            </>
          ) : (
            <>
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="tnum text-base font-semibold text-ink whitespace-nowrap">{university.fee > 0 ? `₹${(university.fee / 100000).toFixed(2)}L` : '—'}</div>
              <div className="meta-label mt-1.5 whitespace-nowrap">annual fee</div>
            </div>
            <div>
              <div className="tnum text-[16px] font-semibold text-ink leading-tight whitespace-nowrap">{university.nirfRank > 0 ? `#${university.nirfRank}` : '—'}</div>
              <div className="meta-label mt-1.5 whitespace-nowrap">nirf</div>
            </div>
            <div>
              <div className="tnum text-[16px] font-semibold text-ink leading-tight whitespace-nowrap">{university.avgPlacementLPA > 0 ? university.avgPlacementLPA : '—'} {university.avgPlacementLPA > 0 && <span className="text-[11px] font-medium text-muted-foreground">LPA</span>}</div>
              <div className="meta-label mt-1.5 whitespace-nowrap">avg package</div>
            </div>
            </>
          )}
          </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
          {matchScore !== undefined && !university.directoryProfile?.directoryOnly ? (
            <span className="flex items-center gap-2.5 shrink-0">
              <MatchReveal score={matchScore} />
              <span className="meta-label">match</span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/80 shrink-0 whitespace-nowrap">
              {university.directoryProfile?.directoryOnly
                ? "Courses, fees & source details"
                : `${university.courses > 0 ? `${university.courses} programs` : 'Profile details available'}`}
            </span>
          )}
          <span className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleSelection?.(university.id); }}
              aria-pressed={!!isSelected}
              aria-label={`${isSelected ? 'Remove' : 'Add'} ${university.name} ${isSelected ? 'from' : 'to'} comparison`}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                isSelected
                  ? 'text-primary border-primary/40 bg-primary/10'
                  : 'text-muted-foreground border-line hover:text-ink hover:border-line-strong bg-transparent'
              }`}
            >
              {isSelected ? 'Selected' : 'Compare'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(university.id, e); }}
              aria-label={isFavorite ? `Remove ${university.name} from shortlist` : `Save ${university.name}`}
              aria-pressed={isFavorite}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${isFavorite ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line text-muted-foreground hover:text-ink'}`}
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} /> Save
            </button>
          </span>
        </div>
        <button
              type="button"
          onClick={open}
          aria-label={`View ${university.name} details`}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent-bright"
        >
          View University <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </motion.article>
  );
});