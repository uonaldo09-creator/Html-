import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChevronRight, X } from 'lucide-react';
import { University } from '../types';
import { getSafeLogo, handleLogoError } from '../lib/utils';

interface Props {
  universities: University[];
  onViewDetails: (id: number) => void;
  onClear: () => void;
}

export const RecentlyViewed = React.memo<Props>(({ universities, onViewDetails, onClear }) => {
  if (universities.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="meta-label">Recently viewed</span>
          </div>
          <button
            onClick={onClear}
            className="text-[10px] font-semibold text-muted-foreground hover:text-muted-foreground cursor-pointer flex items-center gap-1 transition-colors"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>

        <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {universities.map((uni, i) => (
            <motion.button
              key={uni.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onViewDetails(uni.id)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl shrink-0 cursor-pointer group transition-all"
              style={{
                background: 'rgba(23,23,20,0.92)',
                border: '1px solid rgba(44,42,34,0.9)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
              whileHover={{ scale: 1.02, boxShadow: '0 6px 20px rgba(8,6,4,0.16)' }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-7 h-7 rounded-md bg-charcoal-raised border border-line overflow-hidden flex items-center justify-center shrink-0">
                <img
                  src={getSafeLogo(uni.name, uni.logo)}
                  alt={uni.name}
                  className="w-6 h-6 object-contain"
                  onError={(e) => handleLogoError(e, uni.name)}
                />
              </div>
              <div className="text-left">
                <div className="text-[11px] font-semibold text-ink max-w-27.5 truncate leading-none">{uni.name}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{uni.location}</div>
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
            </motion.button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
});
