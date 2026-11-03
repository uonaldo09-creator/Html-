import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Search, LayoutDashboard, BookOpen, User, Sparkles, Compass,
  GraduationCap, Keyboard, ArrowRight, CornerDownLeft, X, ShieldCheck,
} from 'lucide-react';
import { University } from '../types';
import { UniMark } from './UniMark';

export type PaletteTarget =
  | { kind: 'tab'; tab: 'dashboard' | 'explore' | 'profile' | 'analytics' | 'admin' }
  | { kind: 'unibot' }
  | { kind: 'wizard' }
  | { kind: 'shortcuts' }
  | { kind: 'compare' }
  | { kind: 'role'; role: 'student' | 'parent' }
  | { kind: 'university'; id: number };

interface CommandPaletteProps {
  universities: University[];
  activeTab: string;
  visitorRole: 'student' | 'parent';
  isAdmin: boolean;
  isGuest?: boolean;
  compareCount: number;
  onRun: (target: PaletteTarget) => void;
  openRequest: number;
}

interface Cmd {
  id: string;
  label: string;
  note?: string;
  keywords: string;
  icon: React.ReactNode;
  group: string;
  target: PaletteTarget;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  universities,
  activeTab,
  visitorRole,
  isAdmin,
  isGuest = false,
  compareCount,
  onRun,
  openRequest,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const openPalette = () => {
    setOpen(true);
    setQuery('');
    setIndex(0);
  };

  useEffect(() => {
    if (openRequest > 0) openPalette();
  }, [openRequest]);

  // Reset navigation whenever results change
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const jump: Cmd[] = [
      { id: 'tab-dashboard', group: 'Go to', label: visitorRole === 'parent' ? 'Parent desk' : 'Student hub', note: 'dashboard', keywords: 'dashboard home hub start desk student parent', icon: <LayoutDashboard className="w-4 h-4" />, target: { kind: 'tab', tab: 'dashboard' } },
      { id: 'tab-explore', group: 'Go to', label: 'University index', note: 'explore', keywords: 'explore universities index browse catalog campuses', icon: <BookOpen className="w-4 h-4" />, target: { kind: 'tab', tab: 'explore' } },
      ...(!isGuest ? [{ id: 'tab-profile', group: 'Go to', label: 'My profile', note: 'profile', keywords: 'profile me account preferences academic', icon: <User className="w-4 h-4" />, target: { kind: 'tab', tab: 'profile' } as PaletteTarget }] : []),
      ...(isAdmin ? [
        { id: 'tab-analytics', group: 'Go to', label: 'Analytics panel', note: 'analytics', keywords: 'analytics metrics admin', icon: <Compass className="w-4 h-4" />, target: { kind: 'tab', tab: 'analytics' } as PaletteTarget },
        { id: 'tab-admin', group: 'Go to', label: 'Admin portal', note: 'admin', keywords: 'admin portal manage users universities', icon: <ShieldCheck className="w-4 h-4" />, target: { kind: 'tab', tab: 'admin' } as PaletteTarget },
      ] : []),
    ];
    const consult: Cmd[] = [
      { id: 'unibot', group: 'Consult', label: 'Ask UniBot', note: 'your private admissions advisor', keywords: 'ask unibot chat advisor consult counsel ai assistant', icon: <Sparkles className="w-4 h-4" />, target: { kind: 'unibot' } },
      { id: 'wizard', group: 'Consult', label: 'Counseling wizard', note: 'understand your future', keywords: 'wizard counseling consult steps future profile', icon: <Compass className="w-4 h-4" />, target: { kind: 'wizard' } },
      ...(compareCount >= 2 ? [{ id: 'compare', group: 'Consult', label: `Compare ${compareCount} universities`, note: 'open the comparison sheet', keywords: 'compare comparison sheet', icon: <ArrowRight className="w-4 h-4" />, target: { kind: 'compare' } as PaletteTarget }] : []),
    ];
    const config: Cmd[] = [
      { id: 'role', group: 'Configure', label: visitorRole === 'parent' ? 'Switch to student view' : 'Switch to parent view', note: visitorRole === 'parent' ? 'programs, campus life, careers' : 'fees, safety, ROI', keywords: 'switch role student parent view mode', icon: visitorRole === 'parent' ? <GraduationCap className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />, target: { kind: 'role', role: visitorRole === 'parent' ? 'student' : 'parent' } },
      { id: 'shortcuts', group: 'Configure', label: 'Keyboard shortcuts', note: 'a few keys to move faster', keywords: 'shortcuts keys help keyboard', icon: <Keyboard className="w-4 h-4" />, target: { kind: 'shortcuts' } },
    ];

    const unis: Cmd[] = universities
      .filter(u => !q || `${u.name} ${u.location} ${u.state} ${u.stream.join(' ')}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(u => ({
        id: `uni-${u.id}`,
        group: 'Universities',
        label: u.name,
        note: `${u.location} · NIRF #${u.nirfRank} · ₹${(u.fee / 100000).toFixed(2)}L/yr`,
        keywords: u.name,
        icon: <UniMark size={22} />,
        target: { kind: 'university', id: u.id } as PaletteTarget,
      }));

    const commands = [...jump, ...consult, ...config].filter(c => !q || `${c.label} ${c.note} ${c.keywords}`.toLowerCase().includes(q));
    return [...unis, ...commands];
  }, [query, universities, visitorRole, isAdmin, isGuest, compareCount]);

  useEffect(() => setIndex(0), [query, results.length]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  // Scroll the active row into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  const run = (i: number) => {
    const item = results[i];
    if (!item) return;
    onRun(item.target);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(index); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  // Group rows preserving order of first appearance
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Cmd[]>();
    results.forEach(r => {
      if (!map.has(r.group)) { map.set(r.group, []); order.push(r.group); }
      map.get(r.group)!.push(r);
    });
    return order.map(g => ({ group: g, items: map.get(g)! }));
  }, [results]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.15 }}
          className="fixed inset-0 z-[120] bg-obsidian/70 backdrop-blur-sm flex items-start justify-center px-4 pt-[14vh]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command desk"
            initial={{ opacity: 0, y: -12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { type: 'spring', damping: 28, stiffness: 380 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-surface/97 border border-line rounded-md shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85)] overflow-hidden"
          >
            {/* Search row */}
            <div className="flex items-center gap-3 px-5 h-16 border-b border-line">
              <Search className="w-[18px] h-[18px] text-primary shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search universities, or type a command…"
                aria-label="Search universities or commands"
                className="flex-1 bg-transparent outline-none text-[15px] text-ink placeholder:text-muted-foreground/60"
              />
              <kbd className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-2 py-1 rounded border border-line bg-muted/60">
                <X className="w-3 h-3" /> esc
              </kbd>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              role="listbox"
              aria-label="Results"
              className="max-h-[min(52vh,440px)] overflow-y-auto custom-scrollbar py-2"
              onMouseLeave={() => setIndex(-1)}
            >
              {results.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-ink/80">Nothing matches “{query}”.</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Try a course, city, or university name — or clear the search for commands.</p>
                </div>
              )}
              {grouped.map(g => (
                <div key={g.group}>
                  <div className="meta-label px-5 pt-3 pb-1.5">{g.group}</div>
                  {g.items.map((item, localIdx) => {
                    const i = results.indexOf(item);
                    const active = i === index;
                    return (
                      <button
                        key={item.id}
                        data-idx={i}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setIndex(i)}
                        onClick={() => run(i)}
                        className={`w-full flex items-center gap-3.5 px-5 py-2.5 text-left cursor-pointer transition-colors border-l-2 ${
                          active ? 'bg-accent/70 border-primary text-ink' : 'border-transparent text-ink/75 hover:text-ink'
                        }`}
                      >
                        <span className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/70'}`}>
                          {item.icon}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] font-medium truncate">{item.label}</span>
                          {item.note && (
                            <span className="block text-[11px] text-muted-foreground truncate mt-0.5">{item.note}</span>
                          )}
                        </span>
                        {active && <CornerDownLeft className="w-3.5 h-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer keys */}
            <div className="flex items-center gap-5 px-5 py-2.5 border-t border-line bg-muted/30 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded border border-line bg-muted/80 font-mono">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded border border-line bg-muted/80 font-mono">↵</kbd> open</span>
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded border border-line bg-muted/80 font-mono">esc</kbd> dismiss</span>
              <span className="ml-auto hidden sm:block">Every figure shown is from the verified catalog</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};