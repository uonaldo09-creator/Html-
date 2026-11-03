import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Search, GraduationCap, LogOut, Sparkles, LayoutDashboard, BookOpen, Heart, Keyboard, BarChart3, User, Bell, Check, Menu, X, type LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { University } from '../types';
import { customFetch as fetch } from '../lib/api';
import { getSafeLogo, handleLogoError } from '../lib/utils';
import { UniMark } from './UniMark';

interface HeaderProps {
  search: string;
  setSearch: (s: string) => void;
  onLogout: () => void;
  activeTab: 'dashboard' | 'explore' | 'analytics' | 'profile' | 'admin';
  setActiveTab: (tab: 'dashboard' | 'explore' | 'analytics' | 'profile' | 'admin') => void;
  visitorRole: 'parent' | 'student';
  setVisitorRole: (role: 'parent' | 'student') => void;
  favoritesCount?: number;
  onShowShortcuts?: () => void;
  userRole?: string;
  isGuest?: boolean;
  universities: University[];
  onSelectUniversity: (id: number) => void;
  onOpenWizard?: () => void;
  onOpenCommandPalette?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  search, setSearch, onLogout,
  activeTab, setActiveTab, visitorRole, setVisitorRole,
  favoritesCount = 0,
  onShowShortcuts,
  userRole,
  isGuest = false,
  universities,
  onSelectUniversity,
  onOpenWizard,
  onOpenCommandPalette,
}) => {
  const isParent = visitorRole === 'parent';
  const commandShortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl+K';
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      // Authenticated via the HttpOnly session cookie — no token in localStorage.
      const res = await fetch('/api/notifications');
      if (!res.ok) {
        setNotifications([]);
        return;
      }
      const data = await res.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
      }
    } catch (e) {
      console.warn("Notifications check failed:", e);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = async (id: number) => {
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (e) {
      console.warn("Mark as read failed:", e);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return universities.filter(uni =>
      uni.name.toLowerCase().includes(q) ||
      uni.location.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [search, universities]);

  const tabs: Array<{ id: 'dashboard' | 'explore' | 'analytics' | 'profile' | 'admin'; label: string; icon: LucideIcon }> = [
    { id: 'dashboard', label: isParent ? 'Parent Desk' : 'Student Hub', icon: LayoutDashboard },
    { id: 'explore', label: 'University Index', icon: BookOpen },
  ];

  if (!isGuest) {
    tabs.push({ id: 'profile', label: 'My Profile', icon: User });
  }

  if (userRole === 'Admin') {
    tabs.push({ id: 'analytics', label: 'Analytics Panel', icon: BarChart3 });
    tabs.push({ id: 'admin', label: 'Admin Portal', icon: GraduationCap });
  }


  return (
    <header className="sticky top-4 z-50 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mb-8">
      <div
        className="rounded-[28px] px-5 transition-all"
        style={{
          background: 'rgba(13, 10, 7, 0.72)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(201, 163, 92, 0.14)',
          boxShadow: '0 18px 40px -24px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(201, 163, 92, 0.08)',
        }}
      >
        <div className="flex items-center justify-between h-17 gap-3">

          {/* ─── Logo ─── */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setActiveTab('dashboard')}
            aria-label="Go to dashboard"
            className="flex items-center gap-3 shrink-0 cursor-pointer select-none border-0 bg-transparent p-0 text-left"
          >
            <UniMark size={34} className="text-primary shrink-0" />
            <div className="hidden sm:block">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[22px] font-semibold text-ink tracking-tight">UniInfo</span>
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
                  style={{ borderColor: 'rgba(201, 163, 92, 0.3)', color: '#a8813d', background: 'rgba(201, 163, 92, 0.07)' }}
                >
                  {isParent ? 'Parent portal' : 'Student hub'}
                </span>
              </div>
            </div>
          </motion.button>

          {/* ─── Role Switcher ─── */}
          <div
            className="hidden sm:flex p-1 rounded-2xl relative shrink-0"
            style={{ background: 'rgba(201, 163, 92, 0.05)', border: '1px solid rgba(201, 163, 92, 0.16)' }}
          >
            {(['student', 'parent'] as const).map((role) => {
              const active = visitorRole === role;
              return (
                <button
                  key={role}
                  onClick={() => setVisitorRole(role)}
                  aria-pressed={active}
                  className="relative px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors duration-200 z-10 cursor-pointer"
                  style={{ color: active ? '#0d0a07' : 'rgba(201, 163, 92, 0.62)' }}
                >
                  {active && (
                    <motion.div
                      layoutId="roleActive"
                      className="absolute inset-0 rounded-[10px] bg-primary"
                      transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }}
                    />
                  )}
                  <span className="relative z-10">{role === 'student' ? 'Student' : 'Parent'}</span>
                </button>
              );
            })}
          </div>

          {/* ─── Search ─── */}
          <div className="flex-1 max-w-sm hidden lg:block" ref={containerRef}>
            <div className="relative group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors" style={{ color: 'rgba(201, 163, 92, 0.42)' }} />
              <input
                ref={searchRef}
                type="text"
                aria-label={isParent ? 'Search universities by placement or accreditation' : 'Search universities, programs, or locations'}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setIsOpen(true);
                }}
                onFocus={(e) => {
                  setIsOpen(true);
                  e.target.style.border = '1px solid #f2ead9';
                  e.target.style.background = 'rgba(8, 6, 4, 0.55)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(201,163,92,0.22)';
                }}
                onBlur={(e) => {
                  e.target.style.border = '1px solid rgba(201, 163, 92, 0.18)';
                  e.target.style.background = 'rgba(8, 6, 4, 0.55)';
                  e.target.style.boxShadow = 'none';
                }}
                placeholder={isParent ? 'Search verified placements, accreditations…' : 'Search universities, programs, locations…'}
                className="w-full h-10 rounded-2xl pl-10 pr-16 text-[12px] font-medium outline-none transition-all"
                style={{
                  background: 'rgba(8, 6, 4, 0.55)',
                  border: '1px solid rgba(201, 163, 92, 0.24)',
                  color: '#f2ead9',
                  boxShadow: 'inset 0 1px 0 rgba(201,163,92,0.05), 0 1px 2px rgba(201,163,92,0.06)',
                }}
              />
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenCommandPalette?.(); }}
                aria-label="Open command desk"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold px-2 py-1 rounded-md cursor-pointer transition-colors border"
                style={{ background: 'rgba(201, 163, 92, 0.07)', color: '#a8813d', border: '1px solid rgba(201, 163, 92, 0.2)' }}
                title={`Open the command desk (${commandShortcut})`}
              >
                {commandShortcut}
              </button>

              {/* Predictive Search Dropdown */}
              <AnimatePresence>
                {isOpen && suggestions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 right-0 mt-2 rounded-2xl overflow-hidden shadow-2xl z-50 text-left border"
                    style={{
                      background: '#1a150d',
                      borderColor: 'rgba(201, 163, 92, 0.16)',
                    }}
                  >
                    <div className="py-2 max-h-80 overflow-y-auto custom-scrollbar">
                      <div className="px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground border-b border-ink/10 mb-1 flex justify-between items-center">
                        <span>{suggestions.length} {suggestions.length === 1 ? 'match' : 'matches'}</span>
                        <span className="text-[10px] text-muted-foreground/60 font-normal">Predictive search</span>
                      </div>
                      {suggestions.map((uni) => (
                        <button
                          key={uni.id}
                          onClick={() => {
                            onSelectUniversity(uni.id);
                            setSearch('');
                            setIsOpen(false);
                          }}
                          className="w-full text-left px-3.5 py-2.5 flex items-center gap-3 hover:bg-ink/5 transition-colors group cursor-pointer border-b border-ink/10 last:border-0"
                        >
                          <img
                            src={getSafeLogo(uni.name, uni.logo)}
                            alt={uni.name}
                            className="w-8 h-8 rounded-lg bg-surface shrink-0 object-contain p-0.5"
                            referrerPolicy="no-referrer"
                            onError={(e) => handleLogoError(e, uni.name)}
                          />
                          <div className="min-w-0 flex-1">
                            <h4 className="text-[13px] font-semibold text-ink group-hover:text-primary transition-colors truncate">
                              {uni.name}
                            </h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-muted-foreground/80 truncate">
                                📍 {uni.location}, {uni.state}
                              </span>
                              <span className="text-[9px] text-muted-foreground shrink-0">•</span>
                              <span className="text-[9px] font-bold text-primary font-mono shrink-0">
                                ★ {uni.rating.toFixed(1)}
                              </span>
                              <span className="text-[9px] text-muted-foreground shrink-0">•</span>
                              <span className="text-[9px] text-muted-foreground/80 shrink-0">
                                NIRF #{uni.nirfRank}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ─── Nav tabs ─── */}
          <nav className="hidden md:flex items-center gap-1">
            {tabs.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors duration-200 cursor-pointer"
                  style={{ color: active ? '#f2ead9' : 'rgba(201, 163, 92, 0.62)' }}
                >
                  {active && (
                    <motion.div
                      layoutId="tabActive"
                      className="absolute inset-0 rounded-xl"
                      style={{ background: 'rgba(201, 163, 92, 0.08)', border: '1px solid rgba(201, 163, 92, 0.2)' }}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10 hidden xl:inline">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* ─── Right actions ─── */}
          <div className="flex items-center gap-2 shrink-0">

            {/* Keyboard shortcuts button */}
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={onShowShortcuts}
              aria-label="Show keyboard shortcuts"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-xl cursor-pointer transition-all"
              style={{ background: 'rgba(201, 163, 92, 0.04)', border: '1px solid rgba(201, 163, 92, 0.16)', color: 'rgba(201, 163, 92, 0.6)' }}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="w-4 h-4" />
            </motion.button>

            {/* Notifications Dropdown */}
            <div className="relative" ref={notifRef}>
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={showNotifications}
                className="relative flex items-center justify-center w-9 h-9 rounded-xl cursor-pointer transition-all"
                style={{ background: 'rgba(201, 163, 92, 0.04)', border: '1px solid rgba(201, 163, 92, 0.16)', color: 'rgba(201, 163, 92, 0.6)' }}
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[9px] font-bold text-white flex items-center justify-center animate-bounce">
                    {unreadCount}
                  </span>
                )}
              </motion.button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="absolute right-0 mt-2 w-80 rounded-2xl p-4 shadow-2xl z-50 overflow-hidden"
                    style={{
                      background: '#1a150d',
                      border: '1px solid rgba(201, 163, 92, 0.16)'
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-ink/10 pb-2 mb-2">
                      <h3 className="text-[13px] font-bold text-ink">Notifications</h3>
                      {unreadCount > 0 && (
                        <span className="text-[11px] font-semibold text-accent-bright bg-accent-bright/10 px-2 py-0.5 rounded-full">
                          {unreadCount} new
                        </span>
                      )}
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {notifications.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground/70 text-xs">
                          No alerts or notifications yet.
                        </div>
                      ) : (
                        notifications.map((notif) => (
                          <div
                            key={notif.id}
                            onClick={() => handleMarkAsRead(notif.id)}
                            className={`p-2.5 rounded-xl transition-all cursor-pointer text-left ${notif.read ? 'bg-ink/5 opacity-60' : 'bg-ink/5 hover:bg-ink/10'}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <h4 className="text-xs font-bold text-ink">{notif.title}</h4>
                              {!notif.read && <Check className="w-3 h-3 text-emerald-700 shrink-0 mt-0.5" />}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{notif.message}</p>
                            <span className="text-[9px] text-muted-foreground/60 block mt-1">
                              {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Counseling Wizard CTA */}
            {onOpenWizard && (
              <button
                onClick={onOpenWizard}
                className="hidden xl:flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition-colors border-none text-primary-foreground bg-primary hover:bg-primary-deep"
              >
                <Sparkles className="w-4 h-4" />
                <span>Counseling wizard</span>
              </button>
            )}

            {/* Favorites count badge */}
            {favoritesCount > 0 && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl cursor-pointer"
                style={{ background: 'rgba(201, 163, 92, 0.08)', border: '1px solid rgba(201, 163, 92, 0.28)' }}
                title={`${favoritesCount} shortlisted`}
              >
                <Heart className="w-3.5 h-3.5 fill-accent-bright text-accent-bright" />
                <span className="text-[11px] font-semibold text-accent-bright">{favoritesCount}</span>
              </motion.div>
            )}

            {/* Logout (hidden on mobile, in drawer instead) */}
            <motion.button
              whileHover={{ scale: 1.08, color: '#a8813d' }}
              whileTap={{ scale: 0.92 }}
              onClick={onLogout}
              className="hidden md:flex items-center justify-center w-9 h-9 rounded-xl cursor-pointer transition-all"
              style={{ background: 'rgba(201, 163, 92, 0.04)', border: '1px solid rgba(201, 163, 92, 0.16)', color: 'rgba(201, 163, 92, 0.6)' }}
              aria-label={isGuest ? "Exit catalog preview" : "Sign out"}
              title={isGuest ? "Exit preview" : "Sign out"}
            >
              <LogOut className="w-4 h-4" />
            </motion.button>

            {/* Hamburger Menu Button (visible on mobile only) */}
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={isDrawerOpen}
              className="flex md:hidden items-center justify-center w-9 h-9 rounded-xl cursor-pointer transition-all"
              style={{ background: 'rgba(201, 163, 92, 0.04)', border: '1px solid rgba(201, 163, 92, 0.16)', color: 'rgba(201, 163, 92, 0.6)' }}
              title="Menu"
            >
              <Menu className="w-5 h-5 text-muted-foreground" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* ─── Mobile Slide-out Drawer ─── */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-obsidian/70 backdrop-blur-sm z-50 md:hidden"
            />

            {/* Sliding panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-72.5 sm:w-80 bg-surface border-l border-line p-6 z-50 md:hidden flex flex-col h-full overflow-y-auto"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-ink/10 pb-4 mb-6 shrink-0">
                <div className="flex items-center gap-2.5">
                  <UniMark size={28} className="text-primary shrink-0" />
                  <span className="text-sm font-semibold text-ink tracking-tight">UniInfo menu</span>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1.5 rounded-lg bg-ink/5 hover:bg-ink/10 text-muted-foreground hover:text-ink transition-colors cursor-pointer border-none"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Role Switcher inside Drawer (visible on mobile only) */}
              <div className="mb-6 shrink-0 sm:hidden">
                <span className="meta-label block mb-2">Your perspective</span>
                <div
                  className="flex p-1 rounded-xl"
                  style={{ background: 'rgba(201, 163, 92, 0.04)', border: '1px solid rgba(201, 163, 92, 0.12)' }}
                >
                  {(['student', 'parent'] as const).map((role) => {
                    const active = visitorRole === role;
                    return (
                      <button
                        key={role}
                        onClick={() => setVisitorRole(role)}
                        className="flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200 cursor-pointer border-none bg-transparent"
                        style={{ color: active ? '#0d0a07' : 'rgba(201, 163, 92, 0.62)', background: active ? 'var(--color-primary)' : 'transparent' }}
                      >
                        {role === 'student' ? 'Student' : 'Parent'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mobile Search inside Drawer */}
              <div className="mb-6 shrink-0 lg:hidden">
                <span className="meta-label block mb-2">Quick campus search</span>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search programs, fees..."
                    className="w-full h-10 rounded-xl pl-9 pr-4 text-[13px] font-medium outline-none bg-ink/5 border border-ink/15 text-ink focus:border-primary transition-all"
                  />
                </div>
                {/* Predictive search suggestions inside drawer */}
                {search.trim() && suggestions.length > 0 && (
                  <div className="mt-2 bg-surface border border-ink/15 rounded-xl p-1 divide-y divide-ink/10 max-h-40 overflow-y-auto">
                    {suggestions.map((uni) => (
                      <button
                        key={uni.id}
                        onClick={() => {
                          onSelectUniversity(uni.id);
                          setSearch('');
                          setIsDrawerOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-accent-bright hover:bg-ink/5 rounded-lg transition-colors flex items-center justify-between"
                      >
                        <span className="truncate">{uni.name}</span>
                        <span className="text-[9px] text-primary font-mono font-bold">★ {uni.rating.toFixed(1)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Navigation Tabs List */}
              <div className="space-y-1.5 flex-1">
                <span className="meta-label block mb-2">Navigate</span>
                {tabs.map(({ id, label, icon: Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setActiveTab(id);
                        setIsDrawerOpen(false);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer border ${
                        active
                          ? 'bg-ink/5 border-ink/20 text-ink'
                          : 'bg-transparent border-transparent text-muted-foreground hover:text-ink hover:bg-ink/5'
                      }`}
                    >
                      <Icon className="w-4 h-4 text-accent-bright shrink-0" />
                      <span>{label}</span>
                    </button>
                  );
                })}

                {/* Shortlisted Favorites row inside Drawer */}
                {favoritesCount > 0 && (
                  <button
                    onClick={() => {
                      setActiveTab('explore');
                      setIsDrawerOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 bg-accent-bright/10 border border-accent-bright/25 text-accent-bright rounded-xl text-[13px] font-medium hover:bg-accent-bright/15 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Heart className="w-4 h-4 fill-accent-bright text-accent-bright shrink-0" />
                      <span>Shortlisted</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-accent-bright text-primary-foreground text-[10px] font-semibold">{favoritesCount}</span>
                  </button>
                )}
              </div>

              {/* Bottom Actions of Drawer */}
              <div className="border-t border-ink/10 pt-4 mt-6 space-y-3 shrink-0">
                {/* Counseling Wizard inside Drawer */}
                {onOpenWizard && (
                  <button
                    onClick={() => {
                      onOpenWizard();
                      setIsDrawerOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold text-primary-foreground shadow-md transition-colors border-none bg-primary"
                  >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>Counseling wizard</span>
                  </button>
                )}

                {/* Shortcuts trigger inside Drawer */}
                {onShowShortcuts && (
                  <button
                    onClick={() => {
                      onShowShortcuts();
                      setIsDrawerOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-ink/5 border border-ink/10 text-muted-foreground hover:text-ink rounded-xl text-xs font-black uppercase tracking-widest hover:bg-ink/10 transition-all cursor-pointer"
                  >
                    <Keyboard className="w-4 h-4 text-muted-foreground" />
                    <span>Keyboard Guides</span>
                  </button>
                )}

                {/* Sign Out inside Drawer */}
                <button
                  onClick={() => {
                    onLogout();
                    setIsDrawerOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-[rgba(197,65,27,0.06)] border border-[rgba(197,65,27,0.2)] text-primary rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[rgba(197,65,27,0.1)] transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-primary" />
                  <span>{isGuest ? 'Exit preview' : 'Sign out'}</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
};
