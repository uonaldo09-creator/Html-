import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GitCompare, ChevronRight, Trash2 } from 'lucide-react';
import { University } from '../types';
import { getSafeLogo, handleLogoError } from '../lib/utils';

interface Props {
  selected: University[];
  onRemove: (id: number) => void;
  onCompare: () => void;
  onClear: () => void;
  visitorRole: 'parent' | 'student';
}

export const StickyComparisonBar: React.FC<Props> = ({ selected, onRemove, onCompare, onClear, visitorRole }) => {
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 240 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4"
        >
          <div
            className="rounded-2xl px-5 py-3 flex items-center gap-4 border border-white/10"
            style={{
              background: 'rgba(13,13,11,0.96)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 24px 60px -20px rgba(0,0,0,0.7)',
            }}
          >
            {/* Label */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center">
                <GitCompare className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[12px] font-semibold text-white hidden sm:block">
                Compare
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                {selected.length}/3
              </span>
            </div>

            {/* Selected universities */}
            <div className="flex-1 flex items-center gap-2 overflow-x-auto min-w-0">
              {selected.map((uni) => (
                <motion.div
                  key={uni.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl shrink-0"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="w-5 h-5 rounded-md bg-surface overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      src={getSafeLogo(uni.name, uni.logo)}
                      alt={uni.name}
                      className="w-full h-full object-contain"
                      onError={(e) => handleLogoError(e, uni.name)}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-white/80 max-w-25 truncate">{uni.name}</span>
                  <button
                    onClick={() => onRemove(uni.id)}
                    aria-label={`Remove ${uni.name} from comparison`}
                    className="cursor-pointer text-white/30 hover:text-rose-400 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}

              {selected.length < 3 && (
                <div
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl shrink-0"
                  style={{ border: '1px dashed rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.22)' }}
                >
                  <span className="text-[10px] font-semibold">+ Add {3 - selected.length} more</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={onClear}
                aria-label="Clear comparison shortlist"
                className="p-2 cursor-pointer text-white/30 hover:text-white/60 transition-colors rounded-xl"
                title="Clear all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onCompare}
                disabled={selected.length < 2}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-primary-foreground bg-primary hover:bg-primary-deep cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Compare now
                <ChevronRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
