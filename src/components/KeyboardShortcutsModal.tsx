import React from 'react';
import { motion } from 'framer-motion';
import { X, Command } from 'lucide-react';

const shortcuts = [
  { keys: ['⌘ / Ctrl', 'K'], description: 'Open the command desk' },
  { keys: ['D'], description: 'Go to Admissions Hub' },
  { keys: ['E'], description: 'Go to University Directory' },
  { keys: ['F'], description: 'Toggle AI Advisor' },
  { keys: ['Esc'], description: 'Close any open panel' },
  { keys: ['?'], description: 'Show / hide shortcuts' },
];

interface Props {
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<Props> = ({ onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 30 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-[28px] overflow-hidden"
        style={{
          background: '#0a0a1a',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Command className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-[15px] font-black text-white">Keyboard Shortcuts</h3>
          </div>
          <button onClick={onClose} className="p-1.5 cursor-pointer text-white/35 hover:text-white/70 transition-colors rounded-xl">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="px-6 py-4 space-y-1">
          {shortcuts.map(({ keys, description }, i) => (
            <motion.div
              key={description}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between py-2.5"
              style={{ borderBottom: i < shortcuts.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
            >
              <span className="text-[13px] text-white/55 font-medium">{description}</span>
              <div className="flex items-center gap-1">
                {keys.map((key, ki) => (
                  <React.Fragment key={key}>
                    <kbd
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.55)' }}
                    >
                      {key}
                    </kbd>
                    {ki < keys.length - 1 && (
                      <span className="text-[10px] text-white/25 font-bold mx-0.5">+</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="px-6 pb-5">
          <p className="text-[10px] text-center text-white/20 font-medium">
            Press <kbd className="px-1.5 py-0.5 rounded-md text-[9px] font-bold" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>?</kbd> anytime to toggle this panel
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};
