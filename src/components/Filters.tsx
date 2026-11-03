import React, { useCallback, useRef } from 'react';
import { SlidersHorizontal, X, GraduationCap, IndianRupee, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { UniversityFilters } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface FiltersProps {
  filters: UniversityFilters;
  setFilters: React.Dispatch<React.SetStateAction<UniversityFilters>>;
  showMobileFilters: boolean;
  setShowMobileFilters: (show: boolean) => void;
}

export const Filters = React.memo<FiltersProps>(({ filters, setFilters, showMobileFilters, setShowMobileFilters }) => {
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileFilters = useCallback(() => setShowMobileFilters(false), [setShowMobileFilters]);

  useDialogFocus(showMobileFilters, mobileDialogRef, mobileCloseButtonRef, closeMobileFilters);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFilters({ ...filters, [name]: val });
  };

  const clearFilters = () => {
    setFilters({
      stream: '',
      degree: '',
      major: '',
      degreeLevels: [],
      state: '',
      feeMin: '',
      feeMax: '',
      exam: '',
      aicte: false,
      nba: false,
      nmc: false,
      min10th: '',
      min12th: '',
      naac: '',
      nirf: '',
    });
  };

  const renderFilterContent = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {/* Academic Profile Section */}
        <motion.div
          whileHover={{ translateZ: 20, rotateX: -2, rotateY: 2 }}
          style={{ transformStyle: 'preserve-3d', perspective: '1000px' }}
          className="md:col-span-2 lg:col-span-2 bg-surface p-6 rounded-3xl border border-line shadow-sm"
        >
          <h3 className="text-[15px] font-bold text-ink mb-6 flex items-center gap-2">
            <GraduationCap className="w-4 h-4" />
            Academic Profile
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Stream
                <input
                  type="text"
                  name="stream"
                  value={filters.stream}
                  onChange={handleChange}
                  placeholder="e.g., Engineering"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Degree
                <input
                  type="text"
                  name="degree"
                  value={filters.degree}
                  onChange={handleChange}
                  placeholder="e.g., B.Tech"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Major or subject
                <input
                  type="text"
                  name="major"
                  value={filters.major}
                  onChange={handleChange}
                  placeholder="e.g., Computer Science"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">10th score (%)
                <input
                  type="number"
                  name="min10th"
                  value={filters.min10th}
                  onChange={handleChange}
                  placeholder="Min %"
                  min="0"
                  max="100"
                  step="0.01"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">12th score (%)
                <input
                  type="number"
                  name="min12th"
                  value={filters.min12th}
                  onChange={handleChange}
                  placeholder="Min %"
                  min="0"
                  max="100"
                  step="0.01"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Entrance exam
                <input
                  type="text"
                  name="exam"
                  value={filters.exam}
                  onChange={handleChange}
                  placeholder="e.g., JEE Main"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <fieldset className="space-y-2 border-0 p-0 sm:col-span-2">
              <legend className="meta-label ml-1">Degree level</legend>
              <div className="flex gap-4">
                {['UG', 'PG'].map(level => (
                  <label key={level} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.degreeLevels.includes(level)}
                      onChange={(event) => setFilters({
                        ...filters,
                        degreeLevels: event.target.checked
                          ? [...filters.degreeLevels, level]
                          : filters.degreeLevels.filter((selected: string) => selected !== level),
                      })}
                      className="h-4 w-4 rounded border-line bg-muted text-primary focus:ring-primary/20"
                    />
                    {level}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </motion.div>

        {/* Budget & Location Section */}
        <motion.div
          whileHover={{ translateZ: 20, rotateX: -2, rotateY: -2 }}
          style={{ transformStyle: 'preserve-3d', perspective: '1000px' }}
          className="md:col-span-1 lg:col-span-2 bg-surface p-6 rounded-3xl border border-line shadow-sm"
        >
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-success mb-6 flex items-center gap-2">
            <IndianRupee className="w-4 h-4" />
            Budget & Location
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Min fee (₹)
                <input
                  type="number"
                  name="feeMin"
                  value={filters.feeMin}
                  onChange={handleChange}
                  placeholder="e.g., 50000"
                  min="0"
                  step="1000"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">Max fee (₹)
                <input
                  type="number"
                  name="feeMax"
                  value={filters.feeMax}
                  onChange={handleChange}
                  placeholder="e.g., 300000"
                  min="0"
                  step="1000"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="meta-label ml-1 block">State
                <input
                  type="text"
                  name="state"
                  value={filters.state}
                  onChange={handleChange}
                  placeholder="e.g., Karnataka"
                  className="mt-1.5 w-full h-11 bg-muted border border-line rounded-xl px-4 text-sm font-medium focus:bg-surface focus:border-primary outline-none transition-all"
                />
              </label>
            </div>
          </div>
        </motion.div>

        {/* Accreditation Section */}
        <motion.div
          whileHover={{ translateZ: 20, scale: 1.01 }}
          style={{ transformStyle: 'preserve-3d', perspective: '1000px' }}
          className="lg:col-span-4 bg-surface border border-line p-6 rounded-3xl text-ink"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-[13px] font-medium text-ink">Accreditation and quality</h3>
                <p className="text-[10px] font-medium text-muted-foreground">Filter by national rankings and approvals</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="aicte"
                  checked={filters.aicte}
                  onChange={handleChange}
                  className="w-5 h-5 rounded-lg border-line bg-muted text-primary focus:ring-primary/20 cursor-pointer"
                />
                <span className="text-xs font-bold uppercase tracking-wider">AICTE</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="nba"
                  checked={filters.nba}
                  onChange={handleChange}
                  className="w-5 h-5 rounded-lg border-line bg-muted text-primary focus:ring-primary/20 cursor-pointer"
                />
                <span className="text-xs font-bold uppercase tracking-wider">NBA</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="nmc"
                  checked={filters.nmc}
                  onChange={handleChange}
                  className="w-5 h-5 rounded-lg border-line bg-muted text-primary focus:ring-primary/20 cursor-pointer"
                />
                <span className="text-xs font-bold uppercase tracking-wider">NMC</span>
              </label>
              <div className="h-8 w-px bg-ink/10 hidden md:block" />
              <div className="flex items-center gap-3">
                <label className="meta-label flex items-center gap-3">NIRF rank
                  <input
                    type="number"
                    name="nirf"
                    value={filters.nirf}
                    onChange={handleChange}
                    placeholder="Max Rank"
                    className="w-24 h-9 bg-muted border border-line rounded-lg px-3 text-xs font-bold focus:border-primary outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <label className="meta-label flex items-center gap-3">NAAC grade
                  <select
                    name="naac"
                    value={filters.naac}
                    onChange={handleChange}
                    className="h-9 bg-muted border border-line rounded-lg px-3 text-xs font-bold focus:border-primary outline-none cursor-pointer"
                  >
                    <option value="">Any Grade</option>
                    <option value="A++">A++</option>
                    <option value="A+">A+</option>
                    <option value="A">A</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="flex justify-between items-center pt-4">
        <button
          onClick={clearFilters}
          className="text-xs font-medium text-muted-foreground hover:text-destructive transition-colors flex items-center gap-2 cursor-pointer"
        >
          <X className="w-4 h-4" />
          Reset all
        </button>
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-medium text-muted-foreground/70">Powered by UniInfo</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mb-8">
      {/* Desktop Filters */}
      <div className="hidden lg:block bg-surface/70 backdrop-blur-xl border border-line/90 rounded-4xl p-8 shadow-[0_15px_50px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-md">
            <SlidersHorizontal className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-display text-[20px] font-semibold text-ink leading-none">Match controls</h2>
            <p className="text-[11px] text-muted-foreground mt-1.5">Narrow the directory by the criteria that matter to you</p>
          </div>
        </div>
        {renderFilterContent()}
      </div>

      {/* Mobile Filters Toggle */}
      <div className="lg:hidden flex gap-2">
        <button
          type="button"
          onClick={() => setShowMobileFilters(true)}
          aria-expanded={showMobileFilters}
          aria-controls="mobile-filters-dialog"
          className="flex-1 h-12 bg-surface border border-line rounded-2xl flex items-center justify-center gap-2 font-bold text-ink/75 shadow-sm active:scale-95 transition-transform cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          Filters
          {Object.values(filters).filter(v =>
            (Array.isArray(v) ? v.length > 0 : (v !== '' && v !== false))
          ).length > 0 && (
            <span className="w-5 h-5 bg-primary text-white text-[11px] rounded-full flex items-center justify-center">
              {Object.values(filters).filter(v =>
                (Array.isArray(v) ? v.length > 0 : (v !== '' && v !== false))
              ).length}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Filters Modal */}
      <AnimatePresence>
        {showMobileFilters && (
          <motion.div
            id="mobile-filters-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filters-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 bg-obsidian/70 backdrop-blur-sm lg:hidden flex items-end"
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowMobileFilters(false);
            }}
          >
            <motion.div
              ref={mobileDialogRef}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full bg-surface rounded-t-4xl p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-5 h-5 text-primary" />
                  <h2 id="mobile-filters-title" className="text-xl font-bold text-ink">Filters</h2>
                </div>
                <button
                  ref={mobileCloseButtonRef}
                  onClick={() => setShowMobileFilters(false)}
                  aria-label="Close filters"
                  className="p-2 rounded-full bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {renderFilterContent()}
              <button
                onClick={() => setShowMobileFilters(false)}
                className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl mt-8 cursor-pointer"
              >
                Show Results
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
