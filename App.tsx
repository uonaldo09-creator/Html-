import React, { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence, LayoutGroup, MotionConfig } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { GraduationCap, Sparkles, Search, Eye, EyeOff, Loader2, Mail, Lock, Award, ArrowRight, Check, X, LogOut, ShieldCheck } from 'lucide-react';
import { universities as staticUniversities } from './data';
import { Filters } from './components/Filters';
import { Header } from './components/Header';
import { StickyComparisonBar } from './components/StickyComparisonBar';
import { AnimatedCounter } from './components/AnimatedCounter';
import { ConfettiEffect } from './components/ConfettiEffect';
import type { PaletteTarget } from './components/CommandPalette';
import { UniMark } from './components/UniMark';
import { MaskedReveal, Reveal, ImageReveal } from './components/motion';
const UniversityCard = lazy(() =>
  import('./components/UniversityCard').then((m) => ({ default: m.UniversityCard }))
);
const RecentlyViewed = lazy(() =>
  import('./components/RecentlyViewed').then((m) => ({ default: m.RecentlyViewed }))
);
const SmartRecommendations = lazy(() =>
  import('./components/SmartRecommendations').then((m) => ({ default: m.SmartRecommendations }))
);
const Panorama = lazy(() =>
  import('./components/Panorama').then((m) => ({ default: m.Panorama }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);
const AnalyticsDashboard = lazy(() =>
  import('./components/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard }))
);
const UserProfile = lazy(() =>
  import('./components/UserProfile').then((m) => ({ default: m.UserProfile }))
);
const AdminPortal = lazy(() =>
  import('./components/AdminPortal').then((m) => ({ default: m.AdminPortal }))
);
const ComparisonModal = lazy(() =>
  import('./components/ComparisonModal').then((m) => ({ default: m.ComparisonModal }))
);
const UniversityDetailsModal = lazy(() =>
  import('./components/UniversityDetailsModal').then((m) => ({ default: m.UniversityDetailsModal }))
);
const ROICalculator = lazy(() =>
  import('./components/ROICalculator').then((m) => ({ default: m.ROICalculator }))
);
const KeyboardShortcutsModal = lazy(() =>
  import('./components/KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal }))
);
const LegalModal = lazy(() =>
  import('./components/LegalModal').then((m) => ({ default: m.LegalModal }))
);
const AIAgent = lazy(() =>
  import('./components/AIAgent').then((m) => ({ default: m.AIAgent }))
);
const CounselingWizard = lazy(() =>
  import('./components/CounselingWizard').then((m) => ({ default: m.CounselingWizard }))
);
import { LoginTransition } from './components/LoginTransition';
import { Curtain } from './components/Curtain';
import { SortOption, University, StudentProfile, UniversityFilters } from './types';
import { customFetch as fetch } from './lib/api';
import {
  EXPRESS_SESSION_EXPIRED_EVENT,
  notifyExpressLogout,
  notifyExpressSessionChanged,
} from './lib/convexAuth';
import { deduplicateUniversities } from './lib/utils';

export default function App() {
  const [universities, setUniversities] = useState<University[]>(() => deduplicateUniversities(staticUniversities));
  const [universitiesError, setUniversitiesError] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isAIAgentOpen, setIsAIAgentOpen] = useState(false);
  const [aiAgentInitialQuery, setAiAgentInitialQuery] = useState<string | undefined>(undefined);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | undefined>(undefined);

  const [showTransitionLoader, setShowTransitionLoader] = useState(false);
  const [transitionProgress, setTransitionProgress] = useState(0);
  const [transitionStep, setTransitionStep] = useState('Verifying authentication details...');
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'explore' | 'analytics' | 'profile' | 'admin'>('dashboard');
  const [userRole, setUserRole] = useState<string>('Student');
  const [visitorRole, setVisitorRole] = useState<'parent' | 'student'>('student');
  const [search, setSearch] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const [showComparison, setShowComparison] = useState(() => window.location.pathname === '/compare');
  const [selectedForComparison, setSelectedForComparison] = useState<number[]>(() => {
    const value = new URLSearchParams(window.location.search).get('universities');
    return value ? value.split(',').map(Number).filter(Number.isFinite) : [];
  });
  const [selectedUniversity, setSelectedUniversity] = useState<University | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsOrigin, setDetailsOrigin] = useState<DOMRect | null>(null);
  const [sort, setSort] = useState<SortOption>('match');
  // Bookmarks live on the server (returned by /api/auth/session) so they follow the
  // account, not the browser. Never seed this from localStorage: a stale key would
  // resurrect a previous user's bookmarks on a shared machine after logout.
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [recentlyViewed, setRecentlyViewed] = useState<number[]>(() => {
    try { const s = localStorage.getItem('uni-recent'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [confettiPos, setConfettiPos] = useState({ x: 0, y: 0, active: false });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [commandPaletteRequest, setCommandPaletteRequest] = useState(0);
  const [showROI, setShowROI] = useState(false);
  const [roiUni, setRoiUni] = useState<University | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showLegal, setShowLegal] = useState(false);
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms' | 'contact'>('privacy');
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [booted, setBooted] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });

  const [filters, setFilters] = useState<UniversityFilters>({
    stream: '',
    degree: '',
    major: '',
    degreeLevels: [] as string[],
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

  const getMatchScore = useCallback((uni: University): number | undefined => {
    if (!studentProfile || uni.directoryProfile?.directoryOnly) return undefined;

    const signals: Array<{ matches: boolean; weight: number }> = [];
    const programDetails = [
      ...uni.stream,
      ...uni.degrees,
      ...uni.majors,
      ...uni.popularCourses,
    ].join(' ').toLowerCase();

    if (studentProfile.stream.trim()) {
      signals.push({
        matches: uni.stream.some(stream => stream.toLowerCase().includes(studentProfile.stream.trim().toLowerCase())),
        weight: 20,
      });
    }
    if (studentProfile.preferredCourse.trim()) {
      signals.push({
        matches: programDetails.includes(studentProfile.preferredCourse.trim().toLowerCase()),
        weight: 20,
      });
    }
    if (studentProfile.preferredLocation.trim()) {
      const location = `${uni.location} ${uni.state}`.toLowerCase();
      signals.push({
        matches: location.includes(studentProfile.preferredLocation.trim().toLowerCase()),
        weight: 15,
      });
    }
    if (studentProfile.budget > 0) {
      signals.push({ matches: uni.fee <= studentProfile.budget, weight: 20 });
    }
    if (studentProfile.academicScores.tenth > 0) {
      signals.push({ matches: uni.min10th <= studentProfile.academicScores.tenth, weight: 10 });
    }
    if (studentProfile.academicScores.twelfth > 0) {
      signals.push({ matches: uni.min12th <= studentProfile.academicScores.twelfth, weight: 10 });
    }
    if (studentProfile.entranceExams.length > 0) {
      signals.push({
        matches: studentProfile.entranceExams.some(exam =>
          uni.competitiveExams.some(available => available.toLowerCase() === exam.toLowerCase())
        ),
        weight: 10,
      });
    }
    if (studentProfile.hostelPreference) {
      signals.push({ matches: !!uni.campusMap?.hasHostels, weight: 5 });
    }

    const totalWeight = signals.reduce((total, signal) => total + signal.weight, 0);
    if (totalWeight === 0) return undefined;
    const matchedWeight = signals.reduce((total, signal) => total + (signal.matches ? signal.weight : 0), 0);
    return Math.round((matchedWeight / totalWeight) * 100);
  }, [studentProfile]);

  const filteredUniversities = useMemo(() => {
    return deduplicateUniversities(universities).filter(uni => {
      const matchesSearch = !search ||
        uni.name.toLowerCase().includes(search.toLowerCase()) ||
        uni.location.toLowerCase().includes(search.toLowerCase()) ||
        uni.directoryProfile?.courses.toLowerCase().includes(search.toLowerCase()) ||
        uni.directoryProfile?.sourceName.toLowerCase().includes(search.toLowerCase());

      const matchesStream = !filters.stream || uni.stream.some(s => s.toLowerCase().includes(filters.stream.toLowerCase()));
      const directoryCourses = uni.directoryProfile?.courses.toLowerCase() ?? '';
      const matchesDegree = !filters.degree ||
        uni.degrees.some(d => d.toLowerCase().includes(filters.degree.toLowerCase())) ||
        directoryCourses.includes(filters.degree.toLowerCase());
      const matchesMajor = !filters.major ||
        uni.majors.some(m => m.toLowerCase().includes(filters.major.toLowerCase())) ||
        directoryCourses.includes(filters.major.toLowerCase());
      const matchesState = !filters.state || uni.state.toLowerCase().includes(filters.state.toLowerCase());
      const matchesExam = !filters.exam || uni.competitiveExams.some(e => e.toLowerCase().includes(filters.exam.toLowerCase()));

      const matchesLevel = filters.degreeLevels.length === 0 ||
        filters.degreeLevels.some(level => uni.degreeLevel.includes(level));

      const feeMin = filters.feeMin ? parseInt(filters.feeMin) : 0;
      const feeMax = filters.feeMax ? parseInt(filters.feeMax) : Infinity;
      const matchesFee = uni.directoryProfile?.directoryOnly
        ? !filters.feeMin && !filters.feeMax
        : uni.fee >= feeMin && uni.fee <= feeMax;

      const matchesAICTE = !filters.aicte || uni.aicteApproved;
      const matchesNBA = !filters.nba || uni.nbaAccredited;
      const matchesNMC = !filters.nmc || uni.nmcRecognized;

      const matches10th = !filters.min10th || uni.min10th >= parseInt(filters.min10th);
      const matches12th = !filters.min12th || uni.min12th >= parseInt(filters.min12th);
      const directoryNaacGrade = uni.directoryProfile?.accreditation.match(
        /^NAAC\s+(A\+\+|A\+|A|B\+\+|B\+|B)(?=\s|\(|$)/i,
      )?.[1];
      const matchesNAAC = !filters.naac ||
        uni.naacGrade === filters.naac ||
        directoryNaacGrade?.toLowerCase() === filters.naac.toLowerCase();
      const matchesNIRF = !filters.nirf ||
        (uni.nirfRank > 0 && uni.nirfRank <= parseInt(filters.nirf));

      return matchesSearch && matchesStream && matchesDegree && matchesMajor && matchesState && matchesExam && matchesLevel && matchesFee && matchesAICTE && matchesNBA && matchesNMC && matches10th && matches12th && matchesNAAC && matchesNIRF;
    }).sort((a, b) => {
      if (sort === 'rating') return Number(!!a.directoryProfile?.directoryOnly) - Number(!!b.directoryProfile?.directoryOnly) || b.rating - a.rating;
      if (sort === 'nirf') return Number(a.nirfRank === 0) - Number(b.nirfRank === 0) || a.nirfRank - b.nirfRank;
      if (sort === 'placement') return Number(!!a.directoryProfile?.directoryOnly) - Number(!!b.directoryProfile?.directoryOnly) || b.avgPlacementLPA - a.avgPlacementLPA;
      if (sort === 'feeLow') return Number(!!a.directoryProfile?.directoryOnly) - Number(!!b.directoryProfile?.directoryOnly) || a.fee - b.fee;
      return (getMatchScore(b) ?? b.rating / 5 * 100) - (getMatchScore(a) ?? a.rating / 5 * 100);
    });
  }, [search, filters, sort, getMatchScore, universities]);


  const comparisonList = useMemo(() => {
    return universities.filter(u => selectedForComparison.includes(u.id));
  }, [selectedForComparison, universities]);

  const [hideBanner, setHideBanner] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  const handleResendVerification = async () => {
    if (!userEmail) return;
    setResendStatus('sending');
    try {
      const response = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail })
      });
      if (response.ok) {
        setResendStatus('success');
      } else {
        setResendStatus('error');
      }
    } catch {
      setResendStatus('error');
    }
  };

  // Real, computed catalog credentials — never invented numbers
  const catalogStats = useMemo(() => {
    const metricProfiles = universities.filter((university) => !university.directoryProfile?.directoryOnly);
    return {
      campuses: universities.length,
      programs: metricProfiles.reduce((sum, university) => sum + (Number(university.courses) || 0), 0),
      avgPackage: metricProfiles.length
        ? Math.round((metricProfiles.reduce((sum, university) => sum + (Number(university.avgPlacementLPA) || 0), 0) / metricProfiles.length) * 10) / 10
        : 0,
      metricProfiles: metricProfiles.length,
      directoryProfiles: universities.length - metricProfiles.length,
    };
  }, [universities]);

  const fetchUniversities = useCallback(async () => {
    try {
      const response = await fetch('/api/universities');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setUniversities(deduplicateUniversities(data));
          setUniversitiesError(false);
        }
        else if (!Array.isArray(data)) setUniversitiesError(true);
      }
      else setUniversitiesError(true);
    } catch (err) {
      console.error("Failed to fetch universities from backend database:", err);
      setUniversitiesError(true);
    }
  }, []);

  /**
   * Load the student's saved counseling profile. Authentication rides on the
   * HttpOnly session cookie, so no bearer token is read from localStorage.
   */
  const fetchStudentProfile = useCallback(async () => {
    try {
      const response = await fetch('/api/profile/student');
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'success' && data.profile) {
          setStudentProfile(data.profile);
        }
      }
    } catch (err) {
      console.error("Failed to fetch student profile details:", err);
    }
  }, []);

  const handleWizardComplete = async (profile: StudentProfile) => {
    setStudentProfile(profile);
    try {
      const response = await fetch('/api/profile/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
        credentials: 'include',
      });
      if (response.ok) {
        toast.success("Admissions advisory profile successfully synchronized! Recommendations updated.");
        fetchStudentProfile();
      } else {
        toast.error("Failed to synchronize with cloud database, but local changes have been preserved.");
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      toast.error("Network error. Saved profile locally.");
    }
  };

  useEffect(() => {
    fetchUniversities();
  }, [fetchUniversities]);

  useEffect(() => {
    let isMounted = true;
    import('./data/uttarakhandUniversities')
      .then(({ getUttarakhandUniversityDirectory }) => {
        if (isMounted) {
          setUniversities((current) => [
            ...current,
            ...getUttarakhandUniversityDirectory(current),
          ]);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load the Uttarakhand university directory:", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn && !isGuest) {
      fetchStudentProfile();
    }
  }, [isLoggedIn, isGuest, fetchStudentProfile]);

  /**
   * Resolve the authenticated user from the secure HttpOnly session cookie.
   * This is the single source of truth for whether the user is logged in.
   */
  const resolveSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
      });
      if (!response.ok) {
        setIsLoggedIn(false);
        setUserEmail('');
        setUserName('');
        setUserRole('Student');
        setEmailVerified(false);
        return;
      }
      const data = await response.json();
      if (data.status === 'authenticated') {
        setIsLoggedIn(true);
        if (Array.isArray(data.user.bookmarks)) {
          // Hydrate the starred campus set from the server so a fresh device
          // shows the same bookmarks without any token in localStorage.
          setFavorites(new Set(data.user.bookmarks));
        }
        if (data.user.email) {
          setUserEmail(data.user.email);
        }
        if (data.user.name) {
          setUserName(data.user.name);
        }
        if (data.user.role) {
          setUserRole(data.user.role);
        }
        setEmailVerified(!!data.user.emailVerified);
      } else {
        setIsLoggedIn(false);
        setUserEmail('');
        setUserName('');
        setUserRole('Student');
        setEmailVerified(false);
      }
    } catch {
      setIsLoggedIn(false);
      setUserEmail('');
      setUserName('');
      setUserRole('Student');
      setEmailVerified(false);
    }
  }, []);

  useEffect(() => {
    resolveSession();
  }, [resolveSession]);

  useEffect(() => {
    const handleConvexSessionExpired = () => {
      void resolveSession();
    };
    window.addEventListener(EXPRESS_SESSION_EXPIRED_EVENT, handleConvexSessionExpired);
    return () => window.removeEventListener(EXPRESS_SESSION_EXPIRED_EVENT, handleConvexSessionExpired);
  }, [resolveSession]);

  // Premium AI Chatbot Auto Popup After Login
  useEffect(() => {
    if (isLoggedIn && !isGuest) {
      const alreadyOpened = sessionStorage.getItem('unibot_auto_opened');
      if (!alreadyOpened) {
        const timer = setTimeout(() => {
          setIsAIAgentOpen(true);
          sessionStorage.setItem('unibot_auto_opened', 'true');
        }, 1000); // 1000ms delay matches 800-1200ms
        return () => clearTimeout(timer);
      }
    }
  }, [isLoggedIn, isGuest]);

  const toggleFavorite = useCallback(async (id: number, e?: React.MouseEvent) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else {
        next.add(id);
        if (e) {
          setConfettiPos({ x: e.clientX, y: e.clientY, active: true });
          setTimeout(() => setConfettiPos(p => ({ ...p, active: false })), 1400);
        }
      }
      return next;
    });

    // Bookmark sync is authenticated via the HttpOnly session cookie, so no
    // bearer token needs to be read from localStorage or leaked to the page.
    try {
      await fetch('/api/user/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId: id }),
        credentials: 'include',
      });
    } catch (err) {
      console.error("Failed to sync bookmark with database server:", err);
    }
  }, []);

  const addToRecentlyViewed = useCallback((id: number) => {
    setRecentlyViewed(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 6);
      try { localStorage.setItem('uni-recent', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentlyViewed([]);
    try { localStorage.removeItem('uni-recent'); } catch {}
  }, []);

  const toggleComparison = useCallback((id: number) => {
    if (selectedForComparison.includes(id)) {
      setSelectedForComparison((previous) => previous.filter((selectedId) => selectedId !== id));
      return;
    }
    if (selectedForComparison.length >= 3) {
      toast.info('You can compare up to three campuses at a time. Remove one to add another.');
      return;
    }
    setSelectedForComparison((previous) => [...previous, id]);
  }, [selectedForComparison]);

  const openComparison = useCallback(() => {
    const query = selectedForComparison.length ? `?universities=${selectedForComparison.join(',')}` : '';
    window.history.pushState({}, '', `/compare${query}`);
    setShowComparison(true);
  }, [selectedForComparison]);
  const closeComparison = useCallback(() => {
    if (window.location.pathname === '/compare') window.history.pushState({}, '', '/');
    setShowComparison(false);
  }, []);
  const requestCommandPalette = useCallback(
    () => setCommandPaletteRequest((request) => request + 1),
    []
  );

  const handleViewDetails = useCallback((id: number) => {
    const uni = universities.find(u => u.id === id);
    if (uni) {
      setSelectedUniversity(uni);
      setShowDetails(true);
      addToRecentlyViewed(id);
    }
  }, [universities, addToRecentlyViewed]);

  const closeDetails = useCallback(() => {
    setShowDetails(false);
    setDetailsOrigin(null);
  }, []);

  const handlePaletteRun = (target: PaletteTarget) => {
    if (target.kind === 'tab') setActiveTab(target.tab);
    else if (target.kind === 'unibot') { setAiAgentInitialQuery(undefined); setIsAIAgentOpen(true); }
    else if (target.kind === 'wizard') setIsWizardOpen(true);
    else if (target.kind === 'shortcuts') setShowShortcuts(true);
    else if (target.kind === 'compare') openComparison();
    else if (target.kind === 'role') setVisitorRole(target.role);
    else if (target.kind === 'university') handleViewDetails(target.id);
  };

  const recentUniversities = useMemo(
    () => recentlyViewed.map(id => universities.find(u => u.id === id)).filter(Boolean) as University[],
    [recentlyViewed, universities]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isLoggedIn) requestCommandPalette();
      }
      if (e.key === 'Escape') { setShowDetails(false); setDetailsOrigin(null); closeComparison(); setShowShortcuts(false); setShowROI(false); setIsAIAgentOpen(false); }
      if (!isInput && e.key === '?') setShowShortcuts(p => !p);
      if (!isInput && (e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey) setActiveTab('dashboard');
      if (!isInput && (e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey) setActiveTab('explore');
      if (!isInput && (e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) setIsAIAgentOpen(p => !p);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [closeComparison, isLoggedIn, requestCommandPalette]);

  const handleLoginSuccess = async () => {
    setShowTransitionLoader(true);
    setTransitionProgress(0);
    setTransitionStep('Establishing secure connection...');

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // Step 1: Establish connection & verify credentials
      await delay(400);
      setTransitionProgress(20);
      setTransitionStep('Verifying session & credentials...');

      // Step 2: Resolve the authenticated user from the secure session cookie
      // (the cookie, not the token, is the credential — never expose the token).
      const profilePromise = (async () => {
        await resolveSession();
      })();

      await Promise.all([profilePromise, delay(500)]);
      notifyExpressSessionChanged();
      setTransitionProgress(50);
      setTransitionStep('Syncing profile & personal preferences...');

      // Step 3: Warm the cache with profile, notifications, and the catalog
      const cachePromise = (async () => {
        try {
          await Promise.all([
            fetch('/api/profile/student').catch(() => null),
            fetch('/api/notifications').catch(() => null),
            fetch('/api/universities').catch(() => null),
          ]);
        } catch (e) {
          console.warn("Pre-loading cache warning:", e);
        }
      })();

      await Promise.all([cachePromise, delay(500)]);
      setTransitionProgress(90);
      setTransitionStep('Structuring your workspace...');

      // Step 5: Complete
      await delay(450);
      setTransitionProgress(100);
      setTransitionStep('Welcome back to UniInfo!');
      await delay(250);

      setIsLoggedIn(true);
      setShowTransitionLoader(false);
      setShowRoleSelection(true);

    } catch (err) {
      console.error("Transition loading error:", err);
      // Fallback in case anything fails so user is not stuck
      setIsLoggedIn(true);
      setShowTransitionLoader(false);
    }
  };

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const triggerLogoutConfirmation = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/user/logout', {
        method: 'POST',
        credentials: 'include',
      });
      toast.success(isGuest ? "You have exited the catalog preview." : "Successfully logged out. Your session has been safely cleared.");
    } catch (err) {
      console.warn("Logout request failed:", err);
      toast.error("Logout request was unable to verify with the server, but your local session has been cleared.");
    } finally {
      // The server clears the HttpOnly cookie. Force a clean client state so
      // UI does not linger in a logged-in state while the cookie is dead.
      sessionStorage.removeItem('unibot_auto_opened');
      try { localStorage.removeItem('uni-fav'); } catch {}
      notifyExpressLogout();
      setIsLoggedIn(false);
      setIsGuest(false);
      setUserEmail('');
      setUserName('');
      setUserRole('Student');
      setEmailVerified(false);
      setFavorites(new Set());
      setStudentProfile(undefined);
      setActiveTab('dashboard');
      setIsLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  }, [isGuest]);

  const handleBrowseAsGuest = () => {
    setIsGuest(true);
    setIsLoggedIn(true);
    setActiveTab('dashboard');
  };

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const t = window.setTimeout(() => setBooted(true), 1150);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Curtain />
      <Toaster position="top-right" richColors />
      <AnimatePresence mode="wait">
      {showTransitionLoader ? (
        <motion.div
          key="loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.4 }}
        >
          <LoginTransition
            isLoading={showTransitionLoader}
            progress={transitionProgress}
            currentStep={transitionStep}
          />
        </motion.div>
      ) : !isLoggedIn ? (
        <motion.div
          key="login"
          initial={{ opacity: 0, x: -25 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Login
            onLogin={handleLoginSuccess}
            onBrowseAsGuest={handleBrowseAsGuest}
            onOpenLegal={(tab) => { setLegalTab(tab); setShowLegal(true); }}
            catalogStats={catalogStats}
          />
        </motion.div>
      ) : (
        <motion.div
          key="app"
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="min-h-screen font-sans text-ink maison-stage grain"
          style={{ background: 'radial-gradient(120% 90% at 50% -12%, #17120a 0%, #0d0a07 46%, #080604 100%)' }}
        >
          <Header
            search={search}
            setSearch={setSearch}
            onLogout={triggerLogoutConfirmation}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            visitorRole={visitorRole}
            setVisitorRole={setVisitorRole}
            favoritesCount={favorites.size}
            onShowShortcuts={() => setShowShortcuts(true)}
            userRole={userRole}
            isGuest={isGuest}
            universities={universities}
            onSelectUniversity={handleViewDetails}
            onOpenWizard={() => setIsWizardOpen(true)}
            onOpenCommandPalette={requestCommandPalette}
          />

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {!isGuest && !emailVerified && !hideBanner && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-6 p-4 rounded-xl border border-primary/25 bg-primary/10 text-primary-deep flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/15 rounded-lg text-primary shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <h4 className="font-semibold text-sm">Verify your email address</h4>
                    <p className="text-xs text-primary-deep mt-0.5">
                      Please verify your email address to unlock verified student reviews, administrative backups, and direct academic advisory services.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {resendStatus !== 'success' && (
                    <button
                      onClick={handleResendVerification}
                      disabled={resendStatus === 'sending'}
                      className="px-3.5 py-1.5 text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary-deep rounded-lg transition-colors cursor-pointer border border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {resendStatus === 'sending' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <span>Resend Verification</span>
                      )}
                    </button>
                  )}
                  {resendStatus === 'success' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <Check className="w-4 h-4" />
                      Sent successfully! Check your inbox.
                    </span>
                  )}
                  {resendStatus === 'error' && (
                    <span className="text-xs text-rose-600 font-semibold">
                      Failed to resend. Try again.
                    </span>
                  )}
                  <button
                    onClick={() => setHideBanner(true)}
                    className="p-1.5 hover:bg-muted rounded-lg text-primary hover:text-primary-deep transition-colors cursor-pointer border-none bg-transparent"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            <LayoutGroup id="main-tabs">
              <AnimatePresence mode="wait">
              {activeTab === 'dashboard' ? (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <ConfettiEffect active={confettiPos.active} x={confettiPos.x} y={confettiPos.y} />

                  {/* ─── Hero: stadium camera-preview + rollback ─── */}
                  {booted && (
                    <Suspense fallback={<OverlayLoading label="Loading your campus overview..." />}>
                      <Panorama
                        universities={universities}
                        filteredUniversities={filteredUniversities}
                        catalogStats={catalogStats}
                        visitorRole={visitorRole}
                        hasProfile={!!studentProfile}
                        search={search}
                        onSearchChange={setSearch}
                        onViewDetails={handleViewDetails}
                        selectedForComparison={selectedForComparison}
                        onToggleComparison={toggleComparison}
                        onExplore={() => setActiveTab('explore')}
                        onCompare={openComparison}
                        onUnibot={() => { setAiAgentInitialQuery(undefined); setIsAIAgentOpen(true); }}
                        onSortChange={(v) => setSort(v)}
                        sort={sort}
                        booted={booted}
                      />
                    </Suspense>
                  )}

                  {/* ─── Counseling Wizard CTA Banner ─── */}
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, duration: 0.5 }}
                    className="mb-10 bg-surface border border-line rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-[0_18px_40px_-24px_rgba(16,35,44,0.25)]"
                  >
                    <div className="flex items-center gap-5 text-center md:text-left flex-col sm:flex-row">
                      <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-display text-ink font-semibold text-xl sm:text-[22px] leading-snug">
                          Admissions counseling, matched to you
                        </h3>
                        {studentProfile ? (
                          <div className="mt-2 flex flex-wrap justify-center md:justify-start items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Your active preferences:</span>
                            {[studentProfile.stream, studentProfile.preferredCourse, studentProfile.careerGoals, `₹${(studentProfile.budget || 500000).toLocaleString()}/yr`].filter(Boolean).map((chip) => (
                              <span key={chip} className="px-2.5 py-1 rounded-lg bg-accent border border-primary/10 text-xs font-semibold text-accent-foreground">
                                {chip}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
                            Tell us your target course, specializations, exam scores and budget — we&apos;ll compute a direct eligibility match for every campus.
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setIsWizardOpen(true)}
                      className="px-6 py-3 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary-deep shrink-0 cursor-pointer border-none transition-colors shadow-[0_10px_24px_-12px_rgba(8,6,4,0.4)]"
                    >
                      {studentProfile ? 'Rerun counseling wizard' : 'Launch counseling wizard'}
                    </button>
                  </motion.div>

                  {/* ─── Dashboard Panes ─── */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-14 animate-fade-in">
                    {/* Left Pane: Spotlight (4 cols) */}
                    <div className="lg:col-span-4 space-y-6">
                      <Suspense fallback={<div role="status" className="min-h-32 rounded-2xl bg-surface animate-pulse" />}>
                        <RecentlyViewed
                          universities={recentUniversities}
                          onViewDetails={(id) => handleViewDetails(id)}
                          onClear={clearRecentlyViewed}
                        />
                      </Suspense>
                    </div>

                    {/* Right Pane: Smart Matches (8 cols) */}
                    <div className="lg:col-span-8 space-y-6">
                      <Suspense fallback={<div role="status" className="min-h-48 rounded-2xl bg-surface animate-pulse" />}>
                        <SmartRecommendations
                          onToggleComparison={toggleComparison}
                          selectedForComparison={selectedForComparison}
                          onViewDetails={handleViewDetails}
                          universities={universities}
                          isGuest={isGuest}
                        />
                      </Suspense>
                    </div>
                  </div>

                  <Filters
                    filters={filters}
                    setFilters={setFilters}
                    showMobileFilters={showMobileFilters}
                    setShowMobileFilters={setShowMobileFilters}
                  />

                  <div className="h-10" />

                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <h3 className="font-display text-ink text-[26px] leading-tight font-semibold">
                          {visitorRole === 'parent' ? 'Strategic enrollment report' : 'Recommended universities'}
                        </h3>
                        <p className="text-[13px] font-medium text-muted-foreground mt-0.5">
                          {visitorRole === 'parent'
                            ? 'Verified profiles for informed decisions'
                            : studentProfile ? 'Ranked against your preferences' : 'Explore rankings, fees, and outcomes'}
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-accent border border-primary/10 text-xs font-semibold text-accent-foreground shrink-0">
                        {filteredUniversities.length} {visitorRole === 'parent' ? 'profiles' : 'campuses'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 sm:justify-end">
                      <span className="text-[13px] font-semibold text-muted-foreground hidden sm:block">Sort</span>
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortOption)}
                        className="w-full max-w-full rounded-xl px-4 py-2.5 text-[13px] font-semibold text-ink bg-surface outline-none cursor-pointer transition-colors border border-line focus:border-primary sm:w-auto"
                      >
                        <option value="match">{studentProfile ? 'Profile match' : 'Highest rated'}</option>
                        <option value="rating">{visitorRole === 'parent' ? 'Academic rating' : 'Verified ratings'}</option>
                        <option value="nirf">NIRF rank</option>
                        <option value="placement">{visitorRole === 'parent' ? 'Placement ROI' : 'Avg placement (LPA)'}</option>
                        <option value="feeLow">Fee: low to high</option>
                      </select>
                    </div>
                  </div>

                  {universitiesError && universities.length === 0 ? (
                    <div className="bg-surface border border-line rounded-md p-12 text-center">
                      <h3 className="font-display text-xl font-semibold text-ink mb-2">Unable to load universities</h3>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">Please check your connection and try again.</p>
                      <button type="button" onClick={fetchUniversities} className="mt-6 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary-deep transition-colors cursor-pointer">
                        Try again
                      </button>
                    </div>
                  ) : filteredUniversities.length > 0 ? (
                    <Suspense fallback={<OverlayLoading label="Loading university cards..." />}>
                    <motion.div
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 sm:gap-6"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        visible: {
                          transition: {
                            staggerChildren: 0.1
                          }
                        }
                      }}
                    >
                      {filteredUniversities.map((uni) => (
                        <motion.div
                          key={uni.id}
                          variants={{
                            hidden: { opacity: 0, y: 30 },
                            visible: { opacity: 1, y: 0 }
                          }}
                          transition={{ type: 'spring', damping: 20, stiffness: 100 }}
                        >
                          <UniversityCard
                            university={uni}
                            isSelected={selectedForComparison.includes(uni.id)}
                            onToggleSelection={toggleComparison}
                            onViewDetails={() => handleViewDetails(uni.id)}
                            onViewOrigin={setDetailsOrigin}
                            visitorRole={visitorRole}
                            isFavorite={favorites.has(uni.id)}
                            onToggleFavorite={toggleFavorite}
                            matchScore={getMatchScore(uni)}
                            onOpenROI={(u) => { setRoiUni(u); setShowROI(true); }}
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                    </Suspense>
                  ) : (
                    <div className="bg-surface border border-line rounded-md p-12 text-center">
                      <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                        <Search className="w-8 h-8" />
                      </div>
                      <h3 className="font-display text-xl font-semibold text-ink mb-2">No universities found</h3>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        Try adjusting your filters or search query to find more results.
                      </p>
                      <button
                        onClick={() => setFilters({
                          stream: '', degree: '', major: '', degreeLevels: [], state: '',
                          feeMin: '', feeMax: '', exam: '', aicte: false, nba: false, nmc: false,
                          min10th: '', min12th: '', naac: '', nirf: '',
                        })}
                        className="mt-6 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary-deep transition-colors cursor-pointer"
                      >
                        Reset all filters
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : activeTab === 'analytics' ? (
                <motion.div
                  key="analytics"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Suspense fallback={
                    <div className="flex flex-col items-center justify-center min-h-75 text-muted-foreground">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                      <p className="text-xs font-bold font-mono">Loading Analytics...</p>
                    </div>
                  }>
                    <AnalyticsDashboard />
                  </Suspense>
                </motion.div>
              ) : activeTab === 'profile' ? (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Suspense fallback={
                    <div className="flex flex-col items-center justify-center min-h-75 text-muted-foreground">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                      <p className="text-xs font-bold font-mono">Loading User Profile...</p>
                    </div>
                  }>
                    <UserProfile visitorRole={visitorRole} onLogout={triggerLogoutConfirmation} />
                  </Suspense>
                </motion.div>
              ) : activeTab === 'admin' ? (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Suspense fallback={
                    <div className="flex flex-col items-center justify-center min-h-100 text-muted-foreground">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                      <p className="text-xs font-bold font-mono">Loading Admin Portal...</p>
                    </div>
                  }>
                    <AdminPortal
                      universities={universities}
                      onRefreshUniversities={fetchUniversities}
                      onViewDetails={handleViewDetails}
                    />
                  </Suspense>
                </motion.div>
              ) : (
                <motion.div
                  key="explore"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Reveal distance={26}>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
                      <div>
                        <h2 className="display-section text-ink mb-2">
                          {visitorRole === 'parent' ? 'The accredited directory' : 'Explore all campuses'}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {visitorRole === 'parent'
                            ? 'Regulatory compliance, accreditations and placement credentials, verified per institution.'
                            : 'The full catalog of private campuses across India, each appraised on what matters.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="px-4 py-2 bg-surface border border-line rounded-sm flex items-center gap-2">
                          <span className="meta-label">Showing</span>
                          <span className="text-sm font-semibold text-ink">{filteredUniversities.length} / {universities.length}</span>
                        </div>
                        <label className="sr-only" htmlFor="directory-sort">Sort universities</label>
                        <select
                          id="directory-sort"
                          value={sort}
                          onChange={(e) => setSort(e.target.value as SortOption)}
                          className="rounded-sm px-3 py-2 text-[13px] font-semibold text-ink bg-surface border border-line outline-none focus:border-primary"
                        >
                          <option value="match">{studentProfile ? 'Profile match' : 'Highest rated'}</option>
                          <option value="rating">Highest rated</option>
                          <option value="nirf">NIRF rank</option>
                          <option value="placement">Placement</option>
                          <option value="feeLow">Fee: low to high</option>
                        </select>
                      </div>
                    </div>
                  </Reveal>

                  <Filters
                    filters={filters}
                    setFilters={setFilters}
                    showMobileFilters={showMobileFilters}
                    setShowMobileFilters={setShowMobileFilters}
                  />

                  <Reveal delay={0.1} distance={30}>
                    {filteredUniversities.length > 0 ? (
                      <Suspense fallback={<OverlayLoading label="Loading university cards..." />}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 sm:gap-6">
                        {filteredUniversities.map((uni, idx) => (
                          <UniversityCard
                            key={uni.id}
                            index={idx}
                            university={uni}
                            isSelected={selectedForComparison.includes(uni.id)}
                            onToggleSelection={toggleComparison}
                            onViewDetails={() => handleViewDetails(uni.id)}
                            onViewOrigin={setDetailsOrigin}
                            visitorRole={visitorRole}
                            isFavorite={favorites.has(uni.id)}
                            onToggleFavorite={toggleFavorite}
                            matchScore={getMatchScore(uni)}
                            onOpenROI={(u) => { setRoiUni(u); setShowROI(true); }}
                          />
                        ))}
                      </div>
                      </Suspense>
                    ) : (
                      <div className="bg-surface border border-line rounded-md p-12 text-center">
                        <Search className="w-8 h-8 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                        <h3 className="font-display text-xl font-semibold text-ink mb-2">No campuses match those filters</h3>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                          Try a broader search or clear your filters to see the full directory.
                        </p>
                        <button
                          onClick={() => {
                            setSearch('');
                            setFilters({
                              stream: '', degree: '', major: '', degreeLevels: [], state: '',
                              feeMin: '', feeMax: '', exam: '', aicte: false, nba: false, nmc: false,
                              min10th: '', min12th: '', naac: '', nirf: '',
                            });
                          }}
                          className="mt-6 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary-deep transition-colors cursor-pointer"
                        >
                          Clear search and filters
                        </button>
                      </div>
                    )}
                  </Reveal>
                </motion.div>
              )}
            </AnimatePresence>
          </LayoutGroup>
          </main>



          <Suspense fallback={<OverlayLoading label="Loading comparison..." />}>
            {showComparison && (
              <ComparisonModal
                isOpen={showComparison}
                onClose={closeComparison}
                selectedUniversities={comparisonList}
                onRemove={toggleComparison}
              />
            )}
          </Suspense>

          <Suspense fallback={showDetails ? <OverlayLoading label="Loading university details..." /> : null}>
            {showDetails && selectedUniversity && (
              <UniversityDetailsModal
                isOpen={showDetails}
                onClose={closeDetails}
                university={selectedUniversity}
                origin={detailsOrigin}
                visitorRole={visitorRole}
                isLoggedIn={isLoggedIn && !isGuest}
                onReviewSubmitted={fetchUniversities}
              />
            )}
          </Suspense>

          <AnimatePresence>
            {showShortcuts && (
              <Suspense fallback={<OverlayLoading label="Loading keyboard shortcuts..." />}>
                <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
              </Suspense>
            )}
          </AnimatePresence>

          {isLoggedIn && (
            <Suspense fallback={null}>
              <CommandPalette
                universities={universities}
                activeTab={activeTab}
                visitorRole={visitorRole}
                isAdmin={userRole === 'Admin'}
                isGuest={isGuest}
                compareCount={comparisonList.length}
                onRun={handlePaletteRun}
                openRequest={commandPaletteRequest}
              />
            </Suspense>
          )}

          <AnimatePresence>
            {showROI && roiUni && (
              <Suspense fallback={<OverlayLoading label="Loading return calculator..." />}>
                <ROICalculator
                  onClose={() => { setShowROI(false); setRoiUni(null); }}
                  defaultFee={roiUni.fee}
                  defaultLPA={roiUni.avgPlacementLPA}
                  universityName={roiUni.name}
                />
              </Suspense>
            )}
          </AnimatePresence>

          <StickyComparisonBar
            selected={comparisonList}
            onRemove={toggleComparison}
            onCompare={openComparison}
            onClear={() => setSelectedForComparison([])}
            visitorRole={visitorRole}
          />



          <footer className="border-t border-line py-14 mt-24">
            <div className="max-w-7xl mx-auto px-4 text-center">
              <div className="flex items-center justify-center gap-2.5 mb-4">
                <UniMark size={28} className="text-primary" />
                <span className="font-display text-xl font-semibold text-ink tracking-tight">UniInfo</span>
              </div>
              <p className="text-muted-foreground text-sm mb-6">Private intelligence for choosing where your future begins.</p>
              <div className="flex justify-center gap-8 text-xs font-medium text-muted-foreground">
                <button
                  type="button"
                  onClick={() => { setLegalTab('privacy'); setShowLegal(true); }}
                  className="hover:text-primary transition-colors cursor-pointer bg-transparent border-none outline-none"
                >
                  Privacy Policy
                </button>
                <button
                  type="button"
                  onClick={() => { setLegalTab('terms'); setShowLegal(true); }}
                  className="hover:text-primary transition-colors cursor-pointer bg-transparent border-none outline-none"
                >
                  Terms of Service
                </button>
                <button
                  type="button"
                  onClick={() => { setLegalTab('contact'); setShowLegal(true); }}
                  className="hover:text-primary transition-colors cursor-pointer bg-transparent border-none outline-none"
                >
                  Contact Us
                </button>
              </div>
              <p className="mt-12 text-[10px] font-medium text-muted-foreground/60 tracking-[0.24em]">S.S.D.N</p>
            </div>
          </footer>

          {/* Modals & Advisor Chat */}
          <AnimatePresence>
            {showLogoutConfirm && (
              <motion.div
                key="logout-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian/50 backdrop-blur-sm"
                onClick={() => !isLoggingOut && setShowLogoutConfirm(false)}
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="logout-title"
                  aria-describedby="logout-description"
                  initial={{ scale: 0.95, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 20 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="relative bg-surface border border-line shadow-2xl rounded-2xl p-6 w-full max-w-sm mx-auto text-center overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Quiet accent rule */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-primary/15" />

                  <div className="w-12 h-12 rounded-2xl bg-accent border border-primary/10 flex items-center justify-center text-primary mb-4 mx-auto">
                    {isLoggingOut ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : (
                      <LogOut className="w-5 h-5 text-primary" />
                    )}
                  </div>

                  <h3 id="logout-title" className="font-display text-xl font-semibold tracking-tight text-ink mb-1">
                    {isLoggingOut
                      ? isGuest ? "Closing preview" : "Securing session"
                      : isGuest ? "Exit catalog preview?" : "Sign out of UniInfo?"}
                  </h3>

                  {userEmail && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-line text-[11px] font-mono font-medium text-muted-foreground mb-3 mx-auto">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                      {userEmail}
                    </div>
                  )}

                  <p id="logout-description" className="text-xs text-muted-foreground mb-6 leading-relaxed max-w-60 mx-auto">
                    {isLoggingOut
                      ? isGuest ? "Returning to the sign-in page..." : "Clearing authentication tokens and terminating your secure session with the server..."
                      : isGuest
                        ? "You can return to the campus catalog whenever you are ready."
                        : "Are you sure you want to log out of UniInfo? You will need to sign in again to access reviews, university details, and academic chats."
                    }
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={isLoggingOut}
                      onClick={() => setShowLogoutConfirm(false)}
                      className={`h-10 px-4 text-muted-foreground font-semibold rounded-xl text-xs transition-colors cursor-pointer border border-line ${
                        isLoggingOut ? 'bg-muted text-muted-foreground/50 cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
                      }`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isLoggingOut}
                      onClick={handleLogout}
                      className="h-10 px-4 bg-primary hover:bg-primary-deep text-primary-foreground font-semibold rounded-xl text-xs transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5"
                    >
                      {isLoggingOut ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {isGuest ? "Exiting" : "Signing Out"}
                        </>
                      ) : (
                        isGuest ? "Exit preview" : "Sign Out"
                      )}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isWizardOpen && (
              <Suspense fallback={<OverlayLoading label="Loading counseling guide..." />}>
                <CounselingWizard
                  key="wizard-modal"
                  isOpen={isWizardOpen}
                  onClose={() => setIsWizardOpen(false)}
                  onComplete={handleWizardComplete}
                  initialProfile={studentProfile}
                />
              </Suspense>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isAIAgentOpen && (
              <Suspense fallback={<OverlayLoading label="Loading admissions advisor..." />}>
                <AIAgent
                  key="ai-agent-modal"
                  isOpen={isAIAgentOpen}
                  onClose={() => setIsAIAgentOpen(false)}
                  onSelectUniversity={handleViewDetails}
                  initialQuery={aiAgentInitialQuery}
                  visitorRole={visitorRole}
                  setVisitorRole={setVisitorRole}
                  universities={filteredUniversities}
                  isLoggedIn={isLoggedIn && !isGuest}
                  userName={userName}
                />
              </Suspense>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showRoleSelection && (
              <motion.div
                key="role-selection-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian/70 backdrop-blur-md"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 30 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 30 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  className="relative w-full max-w-2xl bg-surface border border-line shadow-2xl rounded-3xl p-8 text-center overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Hairline accent rule */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-0.75 rounded-b bg-primary" />

                  {/* Icon */}
                  <div className="w-14 h-14 rounded-2xl bg-accent border border-primary/10 flex items-center justify-center mb-6 mx-auto">
                    <Sparkles className="w-7 h-7 text-primary" />
                  </div>

                  <h3 className="font-display text-ink text-[28px] leading-tight font-semibold mb-2">
                    Welcome to UniInfo
                  </h3>
                  <p className="text-sm font-medium text-muted-foreground max-w-lg mx-auto mb-8 leading-relaxed">
                    Choose the lens you want admissions guidance tailored through — you can switch anytime.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* Student Card */}
                    <motion.button
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => {
                        setVisitorRole('student');
                        setAiAgentInitialQuery(undefined);
                        setIsAIAgentOpen(true);
                        setShowRoleSelection(false);
                        toast.success("Welcome, Student! Academic Advisor Chat is ready.", { icon: '🚀' });
                      }}
                      className="p-6 rounded-2xl border border-line hover:border-primary hover:shadow-[0_20px_44px_-22px_rgba(8,6,4,0.18)] bg-muted/40 hover:bg-surface text-left transition-all duration-200 cursor-pointer flex flex-col justify-between group h-full"
                    >
                      <div>
                        <div className="w-10 h-10 rounded-xl bg-surface group-hover:bg-primary group-hover:text-white border border-line text-primary flex items-center justify-center mb-4 transition-colors">
                          <GraduationCap className="w-5 h-5" />
                        </div>
                        <h4 className="font-display text-lg font-semibold text-ink tracking-tight mb-1.5 group-hover:text-primary transition-colors">
                          For students
                        </h4>
                        <p className="text-[13px] text-muted-foreground leading-relaxed font-normal">
                          Compare engineering and medical domains, explore placements, and get instant curriculum guidance matched to your scores.
                        </p>
                      </div>
                      <div className="mt-6 flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                        Launch student advisor
                        <span aria-hidden>→</span>
                      </div>
                    </motion.button>

                    {/* Parent Card */}
                    <motion.button
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => {
                        setVisitorRole('parent');
                        setAiAgentInitialQuery(undefined);
                        setIsAIAgentOpen(true);
                        setShowRoleSelection(false);
                        toast.success("Welcome, Parent! Admissions Authority AI is ready.", { icon: '🛡️' });
                      }}
                      className="p-6 rounded-2xl border border-line hover:border-primary hover:shadow-[0_20px_44px_-22px_rgba(8,6,4,0.18)] bg-muted/40 hover:bg-surface text-left transition-all duration-200 cursor-pointer flex flex-col justify-between group h-full"
                    >
                      <div>
                        <div className="w-10 h-10 rounded-xl bg-surface group-hover:bg-primary group-hover:text-white border border-line text-primary flex items-center justify-center mb-4 transition-colors">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <h4 className="font-display text-lg font-semibold text-ink tracking-tight mb-1.5 group-hover:text-primary transition-colors">
                          For parents
                        </h4>
                        <p className="text-[13px] text-muted-foreground leading-relaxed font-normal">
                          Verify regulatory approvals and placement claims, review campus safety, and run tuition return-on-investment checks.
                        </p>
                      </div>
                      <div className="mt-6 flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                        Launch parent advisor
                        <span aria-hidden>→</span>
                      </div>
                    </motion.button>
                  </div>

                  {/* Skip into the standard dashboard */}
                  <button
                    onClick={() => setShowRoleSelection(false)}
                    className="text-[13px] font-semibold text-muted-foreground hover:text-ink underline-offset-4 hover:underline transition-colors bg-transparent border-none outline-none cursor-pointer"
                  >
                    Explore the dashboard without the assistant
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!isAIAgentOpen && (
              <motion.button
                key="advisor-chat-button"
                id="academic-advisor-chat-trigger"
                initial={{ opacity: 0, scale: 0.8, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 24 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', damping: 22, stiffness: 260 }}
                onClick={() => {
                  setAiAgentInitialQuery(undefined);
                  setIsAIAgentOpen(true);
                }}
                className="fixed bottom-6 right-6 z-40 px-5 h-12 rounded-full flex items-center gap-2.5 text-primary-foreground bg-primary hover:bg-primary-deep shadow-[0_18px_40px_-12px_rgba(8,6,4,0.35)] border border-primary/70 cursor-pointer transition-colors"
                title="Ask UniBot — your private admissions advisor (Press F)"
              >
                <span className="text-[15px] leading-none select-none" aria-hidden>✦</span>
                <span className="text-[12px] font-semibold tracking-[0.12em] select-none">ASK UNIBOT</span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {showLegal && (
        <Suspense fallback={<OverlayLoading label="Loading legal information..." />}>
    <LegalModal
      isOpen={showLegal}
      onClose={() => setShowLegal(false)}
      initialTab={legalTab}
    />
        </Suspense>
      )}
    </AnimatePresence>
    </MotionConfig>
  );
}

function OverlayLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-130 flex items-center justify-center bg-obsidian/40 backdrop-blur-sm"
    >
      <span className="flex items-center gap-3 rounded-xl bg-surface px-5 py-4 text-sm font-semibold text-ink shadow-xl">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

function Login({
  onLogin,
  onBrowseAsGuest,
  onOpenLegal,
  catalogStats,
}: {
  onLogin: () => void;
  onBrowseAsGuest: () => void;
  onOpenLegal: (tab: 'privacy' | 'terms' | 'contact') => void;
  catalogStats: { campuses: number; programs: number; metricProfiles: number; directoryProfiles: number };
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'Student' | 'Parent'>('Student');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loginResendStatus, setLoginResendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [isDevVerifying, setIsDevVerifying] = useState(false);
  const isDevOrLocal =
    typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.includes('.run.app')
    );

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setResetError('Please enter a valid email address.');
      return;
    }

    setIsResetLoading(true);
    try {
      const [{ auth }, { sendPasswordResetEmail }] = await Promise.all([
        import('./lib/firebase'),
        import('firebase/auth'),
      ]);
      await sendPasswordResetEmail(auth, trimmedEmail);
      toast.success('If an account exists with this email, a password reset link has been sent. Please check your inbox.', {
        duration: 6000,
      });
      setResetEmail('');
      setShowResetModal(false);
    } catch (err: any) {
      const errorCode = err?.code || '';
      if (errorCode === 'auth/user-not-found') {
        toast.success('If an account exists with this email, a password reset link has been sent. Please check your inbox.', {
          duration: 6000,
        });
        setResetEmail('');
        setShowResetModal(false);
      } else if (errorCode === 'auth/invalid-email') {
        setResetError('The email address is invalid.');
      } else {
        setResetError(err.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleDevVerifyAndSignIn = async () => {
    setIsDevVerifying(true);
    setError('');
    const trimmedEmail = email.trim();
    try {
      const verifyRes = await fetch('/api/auth/dev-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Failed to auto-verify email.');
      }

      // The session now lives in an HttpOnly cookie set by the server response.
      toast.success('Verified and logged in successfully!');
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Verification or login failed.');
    } finally {
      setIsDevVerifying(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsGoogleLoading(true);
    try {
      let idToken: string | null = null;

      // On localhost or Dev preview URLs where standard Google popups fail or are unauthorized:
      const isDevOrLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.includes('.run.app');

      try {
        const [{ auth, googleProvider, isFirebaseConfigured }, { signInWithPopup }] = await Promise.all([
          import('./lib/firebase'),
          import('firebase/auth'),
        ]);
        if (!isFirebaseConfigured || !auth) {
          throw Object.assign(
            new Error('Google sign-in is not configured for this deployment. Set the VITE_FIREBASE_* environment variables to enable it.'),
            { code: 'app/firebase-not-configured' }
          );
        }
        const result = await signInWithPopup(auth, googleProvider);
        idToken = await result.user.getIdToken();
      } catch (popupErr: any) {
        if (popupErr?.code === 'auth/popup-closed-by-user') {
          throw popupErr;
        }
        if (isDevOrLocal) {
          // In local dev / VS Code Simple Browser where popups are blocked or unauthorized, fallback seamlessly
          idToken = 'mock-google-token-student-google-demo@example.com';
        } else {
          throw popupErr;
        }
      }

      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Google authentication failed. Please try again.');
      }

      // The server sets the HttpOnly session cookie; the client never sees the token.
      onLogin();
    } catch (err: any) {
      const errCode = err?.code || '';
      const errMsg = err?.message || '';

      if (errCode === 'auth/popup-closed-by-user' || /popup-closed-by-user/i.test(errCode) || /popup closed by user/i.test(errMsg)) {
        setError('Google sign-in was cancelled. You can try again or continue with email and password.');
      } else if (errCode === 'auth/account-exists-with-different-credential' || /account-exists-with-different-credential/i.test(errCode) || /account-exists-with-different-credential/i.test(errMsg)) {
        setError('An account already exists with this email address under a different login method. Please sign in using your registered password instead.');
      } else if (errCode === 'auth/popup-blocked' || /popup-blocked/i.test(errCode) || /popup-blocked/i.test(errMsg) || /popup blocked/i.test(errMsg)) {
        setError('The Google Sign-In popup was blocked by your browser. Please enable popups/redirects for this site, or log in with your email and password.');
      } else {
        setError(err.message || 'Failed to sign in with Google.');
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) { setError('Please enter a valid email address.'); return; }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (isSignUp && !/^[A-Z]/.test(password)) {
      setError('Password must start with an uppercase letter.');
      return;
    }
    if (isSignUp && !/\d/.test(password)) {
      setError('Password must contain at least one number.');
      return;
    }
    if (isSignUp && !/[^A-Za-z0-9]/.test(password)) {
      setError('Password must contain at least one special character.');
      return;
    }

    setIsLoading(true);
    try {
      const endpoint = isSignUp ? '/api/register' : '/api/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          name,
          ...(isSignUp ? { accountType: role } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403 && data.emailVerified === false) {
          setError('unverified_email');
          return;
        }
        throw new Error(data.error || 'Authentication failed. Please try again later.');
      }

      if (isSignUp) {
        if (data.user) {
          toast.success(data.message || 'Account registered successfully! Logging you in...', { duration: 4000 });
          onLogin();
          return;
        }
        toast.success(data.message || 'Please verify your email before accessing all features.', {
          duration: 6000,
        });
        setIsSignUp(false);
        setPassword('');
        setError('unverified_email');
      } else {
        onLogin();
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div
      className="relative isolate min-h-screen w-full overflow-hidden px-5 py-8 font-sans sm:px-8 sm:py-12"
      style={{ background: 'radial-gradient(100% 90% at 12% 8%, rgba(201,163,92,0.12), transparent 48%), radial-gradient(120% 100% at 50% 0%, #17130c 0%, #080604 55%, #0a0805 100%)' }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-1/3 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-120 w-120 rounded-full border border-primary/10" />

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.82fr)] lg:gap-20">
        <section aria-labelledby="login-intro" className="order-2 mx-auto w-full max-w-xl lg:order-1">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-10 flex items-center gap-3 select-none"
          >
            <UniMark size={42} className="shrink-0 text-primary" />
            <span className="font-display text-[28px] font-semibold tracking-tight text-ink">UniInfo</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.55 }}
          >
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              A more considered campus search
            </p>
            <h1 id="login-intro" className="max-w-xl font-display text-4xl font-medium leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.6rem]">
              Choose your next chapter with <em className="text-primary">clarity.</em>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-ink/65">
              Bring rankings, fees, programs and outcomes into one place—so you can compare campuses around what matters to you.
            </p>
          </motion.div>

          <div className="mt-9 space-y-4">
            {[
              'Compare the details that shape your decision',
              'Save a shortlist and explore campus profiles',
              'Get guidance through a student or parent lens',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm text-ink/75">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                </span>
                {item}
              </div>
            ))}
          </div>

          <div className="mt-10 grid max-w-md grid-cols-2 overflow-hidden rounded-xl border border-primary/15 bg-white/2.5">
            <div className="p-5">
              <p className="font-display text-3xl text-ink">{catalogStats.campuses}</p>
              <p className="mt-1 text-xs text-ink/55">campuses in this catalog</p>
            </div>
            <div className="border-l border-primary/15 p-5">
              <p className="font-display text-3xl text-ink">{catalogStats.programs.toLocaleString()}</p>
              <p className="mt-1 text-xs text-ink/55">programs with reported counts</p>
            </div>
          </div>
          <p className="mt-3 max-w-md text-[11px] leading-relaxed text-ink/45">
            Program counts and placement averages are supplied for {catalogStats.metricProfiles} profiles; {catalogStats.directoryProfiles} additional directory listings show source-backed details without numeric outcomes.
          </p>
        </section>

        <div className="relative order-1 mx-auto w-full max-w-120 lg:order-2">
          {/* Sign in card */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="auth-panel rounded-2xl border border-line bg-surface p-6 shadow-[0_28px_70px_-32px_rgba(0,0,0,0.7)] sm:p-8"
          >
            {/* Heading */}
            <div className="mb-7 text-left">
              <h2 className="mb-1.5 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
                {isSignUp ? 'Create your account' : 'Sign in to your account'}
              </h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {isSignUp
                  ? 'Set up your profile to get matched with verified campuses.'
                  : 'Welcome back — your shortlist and profile are waiting.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error === 'unverified_email' ? (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl bg-primary/10 border border-primary/25 text-left space-y-2.5"
                >
                  <div className="flex items-start gap-2.5 text-primary-deep">
                    <Mail className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                    <div>
                      <h4 className="font-bold text-sm text-primary-deep">Email Verification Required</h4>
                      <p className="text-xs font-semibold text-primary-deep mt-1 leading-relaxed">
                        To secure your portal, UniInfo requires you to verify your email address before logging in. We have dispatched a fresh secure link to <strong>{email.trim()}</strong>.
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-primary/20">
                    <button
                      type="button"
                      onClick={async () => {
                        setLoginResendStatus('sending');
                        try {
                          const res = await fetch('/api/resend-verification', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: email.trim() }),
                          });
                          if (res.ok) {
                            setLoginResendStatus('success');
                          } else {
                            setLoginResendStatus('error');
                          }
                        } catch {
                          setLoginResendStatus('error');
                        }
                      }}
                      disabled={loginResendStatus === 'sending'}
                      className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 disabled:bg-primary/5 text-primary-deep text-[11px] font-semibold rounded-lg transition-colors cursor-pointer border border-primary/30 flex items-center gap-1 shrink-0"
                    >
                      {loginResendStatus === 'sending' ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : loginResendStatus === 'success' ? (
                        <span>Sent successfully!</span>
                      ) : (
                        <span>Resend Verification Link</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setError('')}
                      className="text-primary hover:text-primary-deep text-[11px] font-semibold underline bg-transparent border-none cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                  {isDevOrLocal && (
                    <div className="mt-3 pt-3 border-t border-primary/20 flex flex-col gap-2">
                      <p className="text-[11px] font-medium text-primary-deep">
                        ⚡ <strong>Developer Sandbox:</strong> Since verification emails are not active in this preview, click below to instantly verify and sign in!
                      </p>
                      <button
                        type="button"
                        onClick={handleDevVerifyAndSignIn}
                        disabled={isDevVerifying}
                        className="w-full h-9 bg-primary hover:bg-primary-deep disabled:bg-primary/60 text-primary-foreground text-xs font-semibold rounded-md transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5"
                      >
                        {isDevVerifying ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Verifying & Signing In...</span>
                          </>
                        ) : (
                          <span>Instant Dev-Verify & Log In</span>
                        )}
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3.5 rounded-xl text-xs font-medium bg-primary/5 border border-primary/25 text-destructive text-left"
                >
                  {error}
                </motion.div>
              )}

              {isSignUp && (
                <div className="space-y-1.5">
                  <label htmlFor="signup-name" className="text-xs font-medium text-muted-foreground block text-left">
                    Your full name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    autoComplete="name"
                    className="w-full h-11 bg-surface border border-ink/30 rounded-none px-4 text-sm font-medium text-ink placeholder:text-muted-foreground/60 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
              )}

              {isSignUp && (
                <div className="space-y-1.5">
                  <label htmlFor="signup-role" className="text-xs font-medium text-muted-foreground block text-left">
                    Portal account role
                  </label>
                  <select
                    id="signup-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full h-11 bg-surface border border-ink/30 rounded-none px-3.5 text-sm font-medium text-ink outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="Student">Student</option>
                    <option value="Parent">Parent</option>
                  </select>
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground block text-left">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoComplete="email"
                    aria-invalid={!!error && error !== 'unverified_email'}
                    className="w-full h-11 bg-surface border border-ink/30 rounded-none pl-10 pr-4 text-sm font-medium text-ink placeholder:text-muted-foreground/60 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-muted-foreground block text-left">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    className="w-full h-11 bg-surface border border-ink/30 rounded-none pl-10 pr-12 text-sm font-medium text-ink placeholder:text-muted-foreground/60 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-ink transition-colors cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {isSignUp && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Use at least 6 characters, starting with a capital letter and including a number and symbol.
                  </p>
                )}

              </div>

              <div className="flex justify-end pt-1">
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(email);
                      setResetError('');
                      setShowResetModal(true);
                    }}
                    className="text-[13px] font-semibold text-primary hover:underline cursor-pointer bg-transparent border-none outline-none"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 text-primary-foreground font-semibold rounded-md flex items-center justify-center gap-2 bg-primary hover:bg-primary-deep active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isSignUp ? 'Registering...' : 'Logging In...'}</span>
                  </>
                ) : (
                  <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
                )}
              </button>

              {/* Google Sign In Option */}
              <div className="relative flex py-2 items-center">
                <div className="grow border-t border-line"></div>
                <span className="shrink mx-4 text-xs font-medium text-muted-foreground">or continue with</span>
                <div className="grow border-t border-line"></div>
              </div>

              <motion.button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isLoading}
                whileHover={{ scale: (isGoogleLoading || isLoading) ? 1 : 1.015 }}
                whileTap={{ scale: (isGoogleLoading || isLoading) ? 1 : 0.985 }}
                className="w-full h-11 border border-line hover:border-primary/50 hover:bg-ink/5 text-ink font-medium rounded-md flex items-center justify-center gap-3 transition-all cursor-pointer text-sm disabled:opacity-50 disabled:cursor-not-allowed bg-muted"
              >
                {isGoogleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582l3.51-3.51C17.764 1.055 14.914 0 12 0 7.354 0 3.307 2.673 1.291 6.555l3.975 3.21z"
                    />
                    <path
                      fill="#4285F4"
                      d="M23.49 12.275c0-.825-.075-1.62-.213-2.39H12v4.51h6.46a5.523 5.523 0 0 1-2.4 3.623l3.77 2.92c2.2-2.03 3.66-5.013 3.66-8.663z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M1.291 6.555A12.026 12.026 0 0 0 0 12c0 1.925.45 3.74 1.246 5.355l4.05-3.136a7.127 7.127 0 0 1-.03-4.454L1.291 6.555z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.97-1.075 7.96-2.915l-3.77-2.92c-1.05.7-2.38 1.115-4.19 1.115-3.22 0-5.944-2.17-6.917-5.09l-4.05 3.136C3.064 21.32 7.12 24 12 24z"
                    />
                  </svg>
                )}
                <span>{isGoogleLoading ? "Connecting to Google..." : "Sign in with Google"}</span>
              </motion.button>
            </form>

            {/* Signup Divider and Hollow Button */}
            <div className="mt-5 pt-5 border-t border-line text-center">
              <p className="text-xs text-muted-foreground mb-3.5">New to UniInfo?</p>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setIsSignUp(!isSignUp);
                }}
                className="w-full h-11 border border-line hover:border-primary/50 hover:bg-ink/5 text-ink font-medium rounded-md text-sm transition-all cursor-pointer"
              >
                {isSignUp ? 'Back to Sign In' : 'Create an Account'}
              </button>
            </div>

            {/* Legal Notice */}
            <p className="text-[11px] text-center text-muted-foreground mt-6 leading-relaxed">
              By signing in, you agree to our{' '}
              <button type="button" onClick={() => onOpenLegal('terms')} className="font-semibold text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer">Terms of Service</button>
              {' '}and{' '}
              <button type="button" onClick={() => onOpenLegal('privacy')} className="font-semibold text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer">Privacy Policy</button>.
            </p>

            {!isSignUp && (
              <div className="mt-5 border-t border-line pt-5 text-center">
                <p className="mb-2 text-xs text-muted-foreground">Still deciding?</p>
                <button
                  type="button"
                  onClick={onBrowseAsGuest}
                  className="w-full rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Explore the catalog without an account
                  <ArrowRight className="ml-2 inline h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </main>

      <AnimatePresence>
        {showResetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
            onClick={() => {
              if (!isResetLoading) setShowResetModal(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="bg-surface rounded-3xl border border-line p-6 sm:p-8 w-full max-w-md shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                disabled={isResetLoading}
                className="absolute right-4 top-4 p-2 text-muted-foreground/80 hover:text-muted-foreground rounded-full hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                {/* Visual Icon */}
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-primary mb-4">
                  <Lock className="w-6 h-6" />
                </div>

                <h3 className="text-xl font-black text-ink mb-2">Forgot Password?</h3>
                <p className="text-xs font-semibold text-muted-foreground/80 mb-6 max-w-sm">
                  No worries! Enter your account email below and we will send you a secure link to reset your password.
                </p>

                <form onSubmit={handleResetPasswordSubmit} className="w-full space-y-4">
                  {resetError && (
                    <div className="p-4 rounded-xl text-xs font-semibold bg-muted border border-red-100 text-destructive text-left">
                      {resetError}
                    </div>
                  )}

                  <div className="space-y-1.5 text-left">
                    <label className="text-xs font-bold text-ink/80 block">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="Enter your registered email"
                        disabled={isResetLoading}
                        className="w-full h-11 bg-surface border border-line rounded-xl pl-10 pr-4 text-sm font-medium text-ink placeholder-muted outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      disabled={isResetLoading}
                      className="flex-1 h-11 border border-line hover:bg-muted text-ink/80 font-bold rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isResetLoading}
                      className="flex-1 h-11 text-white font-semibold rounded-xl flex items-center justify-center gap-2 bg-primary hover:bg-primary-deep active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
                    >
                      {isResetLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <span>Send Link</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
