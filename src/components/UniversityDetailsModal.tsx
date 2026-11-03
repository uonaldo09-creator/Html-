import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Star, Users, BookOpen, Briefcase, Award, CheckCircle2,
  Phone, Globe, Mail, Sparkles, Loader2, MessageSquare, Quote,
  BrainCircuit, Compass, Map, Building2, GraduationCap, ChevronDown, ChevronUp
} from 'lucide-react';
import { University } from '../types';
import { customFetch as fetch } from '../lib/api';
import { AnimatedCounter } from './AnimatedCounter';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface UniversityDetailsModalProps {
  university: University | null;
  isOpen: boolean;
  onClose: () => void;
  /** Viewport rect of the card that opened this prospectus — the modal rises out of it */
  origin?: DOMRect | null;
  visitorRole?: 'parent' | 'student';
  isLoggedIn?: boolean;
  onReviewSubmitted?: () => void;
}

type DirectoryTab = 'profile' | 'programs' | 'sources';

export const UniversityDetailsModal: React.FC<UniversityDetailsModalProps> = ({
  university,
  isOpen,
  onClose,
  origin,
  visitorRole = 'student',
  isLoggedIn = false,
  onReviewSubmitted
}) => {
  const [website, setWebsite] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [directoryTab, setDirectoryTab] = useState<DirectoryTab>('profile');
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'map' | 'alumni'>('info');
  const [selectedZone, setSelectedZone] = useState<string>('academic-block');

  const [localUniversity, setLocalUniversity] = useState<University | null>(null);
  const [ratingInput, setRatingInput] = useState(5);
  const [commentInput, setCommentInput] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    scholarships: false,
    hostel: false,
    faculty: false,
    admission: false,
    documents: false,
    prosCons: false,
    career: false,
    studentLife: false,
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    setLocalUniversity(university);
  }, [university]);

  useDialogFocus(isOpen, dialogRef, closeButtonRef, onClose);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localUniversity) return;
    setIsSubmittingReview(true);
    setReviewError(null);

    try {
      const response = await fetch(`/api/universities/${localUniversity.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating: ratingInput, comment: commentInput })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit review.');
      }

      // Success
      setCommentInput('');
      setRatingInput(5);

      // Update local university state
      if (localUniversity) {
        const updatedReviews = [data.review, ...(localUniversity.reviews || [])];
        setLocalUniversity({
          ...localUniversity,
          reviews: updatedReviews,
          rating: data.newRating
        });
      }

      if (onReviewSubmitted) {
        onReviewSubmitted();
      }
    } catch (err: any) {
      setReviewError(err.message || 'An error occurred.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  useEffect(() => {
    if (isOpen && university) {
      setActiveTab('info');
      setDirectoryTab('profile');
      setSelectedZone(university.campusMap?.zones?.[0]?.id || 'academic-block');
      setWebsite(university.website || null);
      setIsSearching(false);
    }
  }, [isOpen, university]);

  if (!university) return null;

  const isGov = university.type === 'Government';

  // Reliable Fallback Map Data
  const defaultCampusMap = {
    acreage: 120,
    established: 1995,
    hasHostels: true,
    totalBuildings: 34,
    zones: [
      {
        id: "academic-block",
        name: "Main Academic Core",
        description: "The primary high-spec lecture towers, technical workshop wings, and smart classrooms.",
        capacity: "3,500 students",
        highlights: ["Digital learning theatres", "Spacious computational center", "Creative brainstorming zones"],
        type: "academic" as const
      },
      {
        id: "research-park",
        name: "Emerging Fields Research Hub",
        description: "A collaborative facility hosting state-recognized startup prototypes, IoT clusters, and innovation spaces.",
        capacity: "8 specialized departments",
        highlights: ["Advanced hardware testing suite", "Venture mentoring booths", "Industrial computing desk"],
        type: "research" as const
      },
      {
        id: "residential",
        name: "Student Hostels",
        description: "Comfortable and spacious living blocks styled with dedicated common halls and full internet connectivity.",
        capacity: "2,500 residents",
        highlights: ["High-speed Wi-Fi integration", "Hygienic campus cafeterias", "Indoor gaming corners"],
        type: "residential" as const
      },
      {
        id: "recreational",
        name: "Campus Activity Plaza",
        description: "Lively outdoor amphitheatre and manicured lawns hosting student cultural clubs, festivals, and debates.",
        capacity: "1,500 capacity",
        highlights: ["Lush landscaping steps", "Central student cafeteria", "Sports athletic fields"],
        type: "recreational" as const
      }
    ]
  };

  // Reliable Fallback Alumni Data
  const defaultAlumniStories = [
    {
      id: 901,
      name: "Pranav Mital",
      role: "Lead Cloud Infrastructure Architect",
      company: "Google Cloud",
      graduationYear: 2014,
      quote: "The deep technical exploration and guidance at our premium campus laid the foundations of cloud scalability and gave me the courage to challenge standard compute bounds.",
      image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200",
      achievementBadge: "Systems Pioneer"
    },
    {
      id: 902,
      name: "Aishwarya Sen",
      role: "Co-Founder & Chief Designer",
      company: "Nexus Experience Labs",
      graduationYear: 2017,
      quote: "The rich, multi-disciplinary peer collaborations and hackathons built my core leadership instincts, making my journey to starting a premium venture natural and seamless.",
      image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200",
      achievementBadge: "30 Under 30"
    }
  ];

  const campusMap = university.campusMap;
  const mapData = campusMap && Array.isArray(campusMap.zones) && campusMap.zones.length > 0
    ? campusMap
    : { ...defaultCampusMap, ...campusMap, zones: defaultCampusMap.zones };
  const alumniList = university.alumniStories || defaultAlumniStories;
  const activeZone = mapData.zones.find(z => z.id === selectedZone) || mapData.zones[0];

  const getZoneIcon = (zoneId: string, zoneType: string) => {
    const id = (zoneId || '').toLowerCase();
    const type = (zoneType || '').toLowerCase();

    if (id.includes('academic') || type.includes('academic') || type.includes('study')) {
      return <BookOpen className="w-4 h-4 text-primary shrink-0" />;
    }
    if (id.includes('research') || type.includes('research') || id.includes('park') || type.includes('tech')) {
      return <BrainCircuit className="w-4 h-4 text-primary shrink-0" />;
    }
    if (id.includes('residential') || type.includes('residential') || id.includes('hostel') || type.includes('living')) {
      return <Building2 className="w-4 h-4 text-success shrink-0" />;
    }
    if (id.includes('recreational') || type.includes('recreational') || id.includes('sports') || type.includes('social') || type.includes('activity')) {
      return <Compass className="w-4 h-4 text-primary shrink-0" />;
    }
    return <CheckCircle2 className="w-4 h-4 text-pink-500 shrink-0" />;
  };

  const targetUni = localUniversity || university;

  if (isOpen && university?.directoryProfile?.directoryOnly) {
    const profile = university.directoryProfile;
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-[110] isolate flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-0 bg-obsidian/95 backdrop-blur-sm"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="university-details-title"
            initial={
              origin
                ? {
                    opacity: 0.3,
                    scale: Math.max(0.28, Math.min(origin.width / 760, 0.92)),
                    x: origin.left + origin.width / 2 - (typeof window !== 'undefined' ? window.innerWidth : 0) / 2,
                    y: origin.top + origin.height / 2 - (typeof window !== 'undefined' ? window.innerHeight : 0) / 2,
                  }
                : { opacity: 0, scale: 0.9, y: 24 }
            }
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={origin
              ? { duration: 0.55, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-4xl bg-surface rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="relative h-60 sm:h-72 shrink-0 bg-charcoal">
              <img
                src={university.image}
                alt={university.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />
              <motion.button
                ref={closeButtonRef}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                aria-label={`Close ${university.name} details`}
                className="absolute top-6 right-6 p-2 bg-surface/10 hover:bg-surface/20 backdrop-blur-md text-white rounded-full transition-colors z-10 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </motion.button>
              <div className="absolute bottom-6 left-8 right-8">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  <span className="text-[11px] font-medium tracking-widest text-accent-bright">
                    ACADEMIC INTELLIGENCE · DIRECTORY LISTING
                  </span>
                  <span className="px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] bg-surface/10 text-white/85">
                    {university.type}
                  </span>
                </div>
                <h2 id="university-details-title" className="font-display text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-3">
                  {university.name}
                </h2>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] font-medium text-white/75">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-white/50" />
                    {university.location}
                  </span>
                  <span className="w-px h-3 bg-surface/20" />
                  <span>{profile.established}</span>
                </div>
              </div>
            </div>

            <div className="flex border-b border-line bg-muted/60 p-2 gap-2 shrink-0 z-10 sticky top-0 sm:px-6">
              {([
                ['profile', 'Profile & Credentials', Award],
                ['programs', 'Programs & Fees', BookOpen],
                ['sources', 'Sources', Globe],
              ] as const).map(([tab, label, Icon]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDirectoryTab(tab)}
                  aria-pressed={directoryTab === tab}
                  className={`flex-1 py-3 px-2 sm:px-4 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer outline-none ${
                    directoryTab === tab
                      ? 'bg-accent text-accent-foreground border border-primary/30'
                      : 'text-muted-foreground hover:text-ink hover:bg-accent/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 sm:p-10">
              {directoryTab === 'profile' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
                  {[
                    ['Established', profile.established],
                    ['Accreditation', profile.accreditation],
                    ['Rankings', profile.rankings],
                  ].map(([label, value]) => (
                    <section key={label} className="p-5 bg-muted rounded-2xl border border-line">
                      <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">{label}</h3>
                      <p className="text-sm font-semibold text-ink leading-relaxed">{value}</p>
                    </section>
                  ))}
                </div>
              )}

              {directoryTab === 'programs' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
                  {[
                    ['Programs', profile.courses],
                    ['Approximate fees', profile.feeRange],
                    ['Scholarships', profile.scholarships],
                  ].map(([label, value]) => (
                    <section key={label} className="p-5 bg-muted rounded-2xl border border-line">
                      <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">{label}</h3>
                      <p className="text-sm font-semibold text-ink leading-relaxed">{value}</p>
                    </section>
                  ))}
                </div>
              )}

              {directoryTab === 'sources' && (
                <div className="space-y-6 animate-fade-in">
                  <section className="p-6 bg-muted rounded-2xl border border-line">
                    <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">Source & verification</h3>
                    <p className="text-sm font-semibold text-ink leading-relaxed">{profile.sourceNote}</p>
                  </section>
                  {university.website && (
                    <a
                      href={university.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      <Globe className="w-4 h-4" />
                      Visit official website
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] isolate flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-0 bg-obsidian/95 backdrop-blur-sm"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="university-details-title"
            initial={
              origin
                ? {
                    // Rise out of the card the reader came from — the shared-element moment
                    opacity: 0.3,
                    scale: Math.max(0.28, Math.min(origin.width / 760, 0.92)),
                    x: origin.left + origin.width / 2 - (typeof window !== 'undefined' ? window.innerWidth : 0) / 2,
                    y: origin.top + origin.height / 2 - (typeof window !== 'undefined' ? window.innerHeight : 0) / 2,
                  }
                : { opacity: 0, scale: 0.9, y: 24 }
            }
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={
              origin
                ? { duration: 0.55, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
            }
            className="relative z-10 w-full max-w-4xl bg-surface rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Hero Section */}
            <div className="relative h-60 sm:h-72 shrink-0">
              <img
                src={university.image}
                alt={university.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

              <motion.button
                ref={closeButtonRef}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                aria-label={`Close ${university.name} details`}
                className="absolute top-6 right-6 p-2 bg-surface/10 hover:bg-surface/20 backdrop-blur-md text-white rounded-full transition-colors z-10 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </motion.button>

              <div className="absolute bottom-6 left-8 right-8">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  <span className="text-[11px] font-medium tracking-widest text-accent-bright">
                    ACADEMIC INTELLIGENCE · 2026
                  </span>
                  <span className={`px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${
                    isGov ? 'bg-primary text-primary-foreground' : 'bg-surface/10 text-white/85'
                  }`}>
                    {university.type}
                  </span>
                  {university.nirfRank <= 30 && (
                    <span className="bg-primary/20 border border-primary/35 text-accent-bright px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] flex items-center gap-1.5">
                      <Award className="w-3 h-3" />
                      NIRF #{university.nirfRank}
                    </span>
                  )}
                </div>
                <h2 id="university-details-title" className="font-display text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-3">
                  {university.name}
                </h2>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] font-medium text-white/75">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-white/50" />
                    {university.location}
                  </span>
                  <span className="w-px h-3 bg-surface/20" />
                  <span>NAAC {university.naacGrade}</span>
                  <span className="w-px h-3 bg-surface/20" />
                  <span>
                    ₹<AnimatedCounter target={university.fee / 100000} decimals={2} />L / year
                  </span>
                  <span className="w-px h-3 bg-surface/20" />
                  <span>
                    <AnimatedCounter target={university.avgPlacementLPA} /> LPA average package
                  </span>
                </div>
              </div>
            </div>

            {/* Persistent Navigation Tabs Bar */}
            <div className="flex border-b border-line bg-muted/60 p-2 gap-2 shrink-0 z-10 sticky top-0 sm:px-6">
              <button
                onClick={() => setActiveTab('info')}
                className={`flex-1 py-3 px-2 sm:px-4 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer outline-none ${
                    activeTab === 'info'
                      ? 'bg-accent text-accent-foreground border border-primary/30'
                      : 'text-muted-foreground hover:text-ink hover:bg-accent/50'
                  }`}
              >
                <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                <span className="truncate">
                  {visitorRole === 'parent' ? 'Admissions Audit & Safety Checks' : 'Overview & Admissions'}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('map')}
                className={`flex-1 py-3 px-2 sm:px-4 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer outline-none ${
                    activeTab === 'map'
                      ? 'bg-accent text-accent-foreground border border-primary/30'
                      : 'text-muted-foreground hover:text-ink hover:bg-accent/50'
                  }`}
              >
                <Map className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                <span className="truncate">
                  {visitorRole === 'parent' ? 'Campus Infrastructure Security' : 'Campus Map & Size'}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('alumni')}
                className={`flex-1 py-3 px-2 sm:px-4 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer outline-none ${
                    activeTab === 'alumni'
                      ? 'bg-accent text-accent-foreground border border-primary/30'
                      : 'text-muted-foreground hover:text-ink hover:bg-accent/50'
                  }`}
              >
                <GraduationCap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                <span className="truncate">
                  {visitorRole === 'parent' ? 'Placement ROI & Alumni' : 'Featured Alumni'}
                </span>
              </button>
            </div>

            {/* Scrollable Context Area */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-10">
              {/* TAB 1: OVERVIEW & STATS */}
              {activeTab === 'info' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 animate-fade-in">
                  {/* Left Column */}
                  <div className="lg:col-span-2 space-y-10">
                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="p-4 bg-muted rounded-3xl border border-line">
                        <div className="flex items-center gap-1.5 text-bronze mb-1">
                          <Star className="w-4 h-4 fill-current" />
                          <span className="text-base font-black">{university.rating}</span>
                        </div>
                        <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Rating</div>
                      </div>
                      <div className="p-4 bg-muted rounded-3xl border border-line">
                        <div className="flex items-center gap-1.5 text-primary mb-1">
                          <Users className="w-4 h-4" />
                          <span className="text-base font-black">{university.students}</span>
                        </div>
                        <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Students</div>
                      </div>
                      <div className="p-4 bg-muted rounded-3xl border border-line">
                        <div className="flex items-center gap-1.5 text-primary mb-1">
                          <BookOpen className="w-4 h-4" />
                          <span className="text-base font-black">{university.courses}</span>
                        </div>
                        <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Courses</div>
                      </div>
                      <div className="p-4 bg-muted rounded-3xl border border-line">
                        <div className="flex items-center gap-1.5 text-success mb-1">
                          <Briefcase className="w-4 h-4" />
                          <span className="text-base font-black">₹{university.avgPlacementLPA} L</span>
                        </div>
                        <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Avg LPA</div>
                      </div>
                    </div>

                    {/* Expert Insight */}
                    {university.expertInsight && (
                      <div className="bg-linear-to-br from-surface-2 to-surface p-6 sm:p-8 rounded-2xl border border-line shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl -translate-y-1/2 translate-x-1/2" />
                        <div className="relative z-10">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
                              <BrainCircuit className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-0.5 block">Expert Analysis</span>
                              <h4 className="text-lg font-black text-white">Institutional Insight</h4>
                            </div>
                          </div>
                          <p className="text-muted-foreground/60 font-medium leading-relaxed italic border-l-2 border-primary/40 pl-4 text-sm sm:text-base">
                            "{university.expertInsight}"
                          </p>
                          <div className="mt-6 pt-6 border-t border-line flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 bg-[#c9a35c] rounded-full animate-pulse" />
                              <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Verified Expert Review</span>
                            </div>
                            <span className="text-[9px] font-black text-primary uppercase tracking-widest font-mono">UniInfo Premium</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* About */}
                    <div>
                      <h3 className="text-xl font-black text-ink mb-4 flex items-center gap-2 font-display">
                        <Award className="w-5 h-5 text-primary" />
                        About the Institution
                      </h3>
                      <p className="text-ink/80 leading-relaxed font-semibold text-sm">
                        {university.name} is a premier {university.type.toLowerCase()} institution located in {university.location}.
                        Known for its excellence in {university.stream.join(', ')}, it offers a wide range of programs
                        including {university.degrees.join(', ')}. The university is recognized for its
                        rigorous academic standards and strong industry connections, reflected in its impressive
                        average placement of {university.avgPlacementLPA} LPA.
                      </p>
                    </div>

                    {/* Popular Courses */}
                    <div>
                      <h3 className="text-xl font-black text-ink mb-4 flex items-center gap-2 font-display">
                        <BookOpen className="w-5 h-5 text-primary" />
                        Popular Courses
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {university.popularCourses.map((course, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-4 bg-surface border border-line rounded-2xl shadow-sm hover:border-primary/30 transition-colors">
                            <div className="w-2 h-2 bg-primary rounded-full" />
                            <span className="text-sm font-bold text-ink/85">{course}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Specializations */}
                    <div>
                      <h3 className="text-xl font-black text-ink mb-4 font-display">Specializations</h3>
                      <div className="flex flex-wrap gap-2">
                        {university.majors.map((major, idx) => (
                          <span key={idx} className="px-4 py-2 bg-accent text-accent-foreground border border-primary/15 rounded-xl text-xs font-bold shadow-sm">
                            {major}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Detailed University Metrics & Information Accordions */}
                    <div className="space-y-4">
                      <h3 className="text-xl font-black text-ink mb-2 font-display flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Comprehensive Admissions & Campus Audit
                      </h3>
                      <p className="text-xs text-muted-foreground font-medium mb-4">
                        Review specialized institutional evaluations, admission prerequisites, pros and cons, and student amenities.
                      </p>

                      {/* 1. Scholarships & Financial Aid */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('scholarships')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Scholarships & Financial Aid</span>
                          </div>
                          {openSections.scholarships ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.scholarships && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            Merit-based scholarships are available for students scoring &gt;90% in 12th board exams or achieving top ranks in entrance examinations (e.g. JEE/NEET/CUET fees waivers). Sports quota concessions of 25% and socio-economic support programs offering up to 50% tuition waiver are actively verified and supported in the central registration system.
                          </div>
                        )}
                      </div>

                      {/* 2. Hostel & Accommodation */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('hostel')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Hostel & Accommodation Details</span>
                          </div>
                          {openSections.hostel ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.hostel && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            Excellent residential amenities for both boys and girls are established. Premium rooms are fully equipped with modular bunk systems, private study alcoves, clean hygiene-verified communal restrooms, recreation tables, and robust 24/7 network connectivity. The central cafeteria serves balanced food daily.
                          </div>
                        )}
                      </div>

                      {/* 3. Faculty & Academic Standards */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('faculty')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Faculty & Mentorship Quality</span>
                          </div>
                          {openSections.faculty ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.faculty && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            The academic team is highly qualified, with over 75% of professors holding PhD credentials from premier national institutes or international universities. A robust student-faculty ratio of 1:15 is maintained, promoting deep intellectual mentorship, research-based capstones, and industry-oriented project support.
                          </div>
                        )}
                      </div>

                      {/* 4. Admission Process */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('admission')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <GraduationCap className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Admission Process (Step-by-Step)</span>
                          </div>
                          {openSections.admission ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.admission && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold space-y-2">
                            <p className="font-extrabold">1. Online Registration:</p> Submit profile, basic 10th/12th academic markers, and chosen stream choice via the central portal.
                            <p className="font-extrabold">2. Score Submission:</p> Upload verified competitive entrance scorecard (JEE Main, NEET, CUET, or state level exam).
                            <p className="font-extrabold">3. Interactive Counseling:</p> Participate in structural seat allocation rounds aligned with academic cutoff bounds.
                            <p className="font-extrabold">4. Handshake Verification & Seat Confirmation:</p> Present original physical archives, complete the initial fee transaction, and confirm registration.
                          </div>
                        )}
                      </div>

                      {/* 5. Required Documents */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('documents')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Required Admission Documents</span>
                          </div>
                          {openSections.documents ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.documents && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            <ul className="list-disc pl-4 space-y-1">
                              <li>Secondary School (10th) Certificate & marksheets</li>
                              <li>Senior Secondary (12th) Marksheets & passing credentials</li>
                              <li>Entrance Exam scorecard and official registration card</li>
                              <li>Transfer Certificate (TC) & Migration Certificate</li>
                              <li>National identity passport (Aadhaar, PAN, or Voter card copy)</li>
                              <li>6 recent passport-sized photographs</li>
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* 6. Pros & Cons Analysis */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('prosCons')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Award className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Pros & Cons Checklist</span>
                          </div>
                          {openSections.prosCons ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.prosCons && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold space-y-3">
                            <div className="bg-forest/40 p-2.5 rounded-xl border border-forest">
                              <span className="text-success font-extrabold uppercase text-[10px] block mb-1">👍 Institutional Pros:</span>
                              <ul className="list-disc pl-4 space-y-1 text-ink/75">
                                <li>Stellar placement records with strong Fortune 500 tech tie-ups.</li>
                                <li>High-specification hardware labs and active state incubators.</li>
                                <li>Lush, beautiful, safe, and fully gated academic layout.</li>
                              </ul>
                            </div>
                            <div className="bg-oxblood/25 p-2.5 rounded-xl border border-oxblood/40">
                              <span className="text-red-300 font-semibold text-[10px] block mb-1">Hurdles to weigh</span>
                              <ul className="list-disc pl-4 space-y-1 text-ink/75">
                                <li>Highly competitive academic environment and high stress thresholds.</li>
                                <li>Strict attendance monitoring systems (&gt;75% mandatory class compliance).</li>
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 7. Career Opportunities & Nearby Companies */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('career')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Briefcase className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Career Trajectories & Surrounding Employers</span>
                          </div>
                          {openSections.career ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.career && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            Graduates typically land key technical positions including Systems Architects, Product Developers, Security analysts, Biotech researchers, and financial modelers. The campus is strategic and near tech hubs, hosting recruiter handshakes from major players including Google, Amazon, Microsoft, TCS, Infosys, Cognizant, Wipro, L&T, and HDFC Group.
                          </div>
                        )}
                      </div>

                      {/* 8. Student Life & Campus Culture */}
                      <div className="border border-line rounded-2xl overflow-hidden shadow-sm bg-surface">
                        <button
                          type="button"
                          onClick={() => toggleSection('studentLife')}
                          className="w-full flex items-center justify-between p-4 bg-muted hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Compass className="w-4 h-4 text-primary" />
                            <span className="text-sm font-black text-ink">Student Life & Cultural Clubs</span>
                          </div>
                          {openSections.studentLife ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {openSections.studentLife && (
                          <div className="p-4 border-t border-line text-xs sm:text-sm text-muted-foreground leading-relaxed font-semibold">
                            Campus life is highly vibrant with over 20 active recreational chapters including robotics, photography, literature, and athletics. The university calendar hosts major national engineering symposiums, creative arts galas, sports tournaments, hackathons, and local community outreach programs, giving students a balanced, life-enriching experience.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Reviews */}
                    <div>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-black text-ink flex items-center gap-2 font-display">
                          <MessageSquare className="w-5 h-5 text-primary" />
                          Student Reviews
                        </h3>
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-accent text-accent-foreground rounded-full border border-primary/25">
                          <Star className="w-4 h-4 fill-current" />
                          <span className="text-xs font-black">{targetUni.rating}</span>
                          <span className="text-[10px] font-medium text-muted-foreground font-mono">({targetUni.reviews?.length || 0})</span>
                        </div>
                      </div>

                      {/* Verified Student Review Form */}
                      <div className="mb-6 p-5 bg-muted border border-line rounded-4xl">
                        <h4 className="text-xs font-black text-ink mb-2 font-display uppercase tracking-widest">Write a Verified Review</h4>
                        {isLoggedIn ? (
                          <form onSubmit={handleReviewSubmit} className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-muted-foreground">Rating:</span>
                              <div className="flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    type="button"
                                    key={star}
                                    onClick={() => setRatingInput(star)}
                                    className="p-0.5 hover:scale-110 transition-transform"
                                  >
                                    <Star
                                      className={`w-5 h-5 ${
                                        star <= ratingInput ? 'text-bronze fill-current' : 'text-muted-foreground/40'
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <textarea
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                placeholder="Write your experience with academics, infrastructure, or campus life..."
                                className="w-full min-h-17.5 p-3 text-xs bg-surface border border-line rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary text-ink/75 font-semibold"
                                required
                              />
                            </div>
                            {reviewError && (
                              <p className="text-[10px] font-bold text-primary">{reviewError}</p>
                            )}
                            <button
                              type="submit"
                              disabled={isSubmittingReview}
                              className="w-full py-2.5 bg-primary hover:bg-primary-deep disabled:bg-primary/60 text-white font-bold text-xs rounded-2xl shadow-sm transition-all flex items-center justify-center gap-1"
                            >
                              {isSubmittingReview ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Submitting...
                                </>
                              ) : (
                                'Submit Verified Review'
                              )}
                            </button>
                          </form>
                        ) : (
                          <div className="text-center py-2">
                            <p className="text-xs text-muted-foreground font-semibold mb-1">
                              Only authenticated students can write verified campus reviews.
                            </p>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                              Log in to share your experience
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        {(targetUni.reviews || []).map((review) => (
                          <div key={review.id} className="p-5 bg-surface border border-line rounded-4xl shadow-sm hover:border-primary/30 transition-all">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <img
                                  src={review.avatar || `https://i.pravatar.cc/150?u=${review.user}`}
                                  alt={review.user}
                                  className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
                                  referrerPolicy="no-referrer"
                                />
                                <div>
                                  <div className="text-sm font-black text-ink">{review.user}</div>
                                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-mono">{review.date}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                {[...Array(5)].map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`w-3 h-3 ${i < review.rating ? 'text-bronze fill-current' : 'text-muted-foreground/30'}`}
                                  />
                                ))}
                              </div>
                            </div>
                            <div className="relative">
                              <Quote className="absolute -top-2 -left-2 w-4 h-4 text-white/90 fill-current" />
                              <p className="text-xs sm:text-sm text-muted-foreground font-semibold leading-relaxed pl-4 italic">
                                "{review.comment}"
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-8">
                    {/* Admission Info Panel */}
                    <div className="p-6 bg-slate-900 rounded-4xl text-white">
                      <h3 className="text-lg font-black mb-6 flex items-center gap-2 font-display">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Admission Info
                      </h3>
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest font-mono">Annual Fee</span>
                          <span className="text-lg font-black text-primary">₹{(university.fee / 100000).toFixed(1)} Lakh</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest font-mono">Min. 12th %</span>
                          <span className="text-lg font-black">{university.min12th}%</span>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest font-mono block">Exams Accepted</span>
                          <div className="flex flex-wrap gap-1.5">
                            {university.competitiveExams.map((exam, idx) => (
                              <span key={idx} className="px-3 py-1 bg-surface/10 rounded-lg text-[10px] font-black">
                                {exam}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 mt-8">
                        <motion.button
                          whileHover={{ scale: 1.03, rotateX: -5, rotateY: 5 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => window.open(website || university.website || '#', '_blank')}
                          className="w-full py-4 bg-primary hover:bg-primary-deep text-white font-black rounded-2xl transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          Apply Now
                          <Globe className="w-4 h-4" />
                        </motion.button>

                        {university.virtualTourUrl && (
                          <motion.button
                            whileHover={{ scale: 1.03, rotateX: -5, rotateY: 5 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => window.open(university.virtualTourUrl, '_blank')}
                            className="w-full py-4 bg-primary hover:bg-primary-deep text-primary-foreground font-semibold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                          >
                            Virtual Tour
                            <Compass className="w-4 h-4" />
                          </motion.button>
                        )}


                      </div>
                    </div>

                    {/* Contact details */}
                    <div className="p-6 bg-muted rounded-4xl border border-line">
                      <h3 className="text-lg font-black text-ink mb-6 font-display">Contact Details</h3>
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center shadow-sm border border-line">
                            <Phone className="w-4 h-4 text-primary font-black" />
                          </div>
                          <span className="text-sm font-bold">{university.phone || 'Not available'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center shadow-sm border border-line">
                            <Mail className="w-4 h-4 text-primary" />
                          </div>
                          <span className="text-xs sm:text-sm font-bold truncate">Not available</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center shadow-sm border border-line">
                            <Globe className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex flex-col">
                            {website ? (
                              <a
                                href={website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-bold hover:text-primary transition-colors flex items-center gap-2"
                              >
                                {website.replace(/^https?:\/\/(www\.)?/, '')}
                              </a>
                            ) : (
                              <span className="text-sm font-bold">Not available</span>
                            )}
                            {isSearching && <span className="text-[10px] font-medium text-muted-foreground">Verifying...</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Accreditations */}
                    <div className="flex flex-wrap gap-2.5">
                      {university.aicteApproved && (
                        <div className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-[11px] font-semibold border border-primary/15">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                          AICTE APPROVED
                        </div>
                      )}
                      {university.nbaAccredited && (
                        <div className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-[11px] font-semibold border border-primary/15">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                          NBA ACCREDITED
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: INTERACTIVE CAMPUS MAP */}
              {activeTab === 'map' && (
                <div className="space-y-8 animate-fade-in">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-line pb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Map className="w-5 h-5 text-primary" />
                        <h3 className="text-xl font-black text-ink font-display">Interactive Campus Visualizer</h3>
                      </div>
                      <p className="text-sm text-muted-foreground font-semibold">Explore key zones of {university.name} with premium facility metrics.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <div className="px-4 py-2.5 bg-accent border border-primary/25 rounded-xl flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" />
                        <span className="text-[10px] font-medium text-muted-foreground tracking-wider font-mono">Est.</span>
                        <span className="text-sm font-semibold text-accent-foreground font-mono">{mapData.established}</span>
                      </div>
                      <div className="px-4 py-2.5 bg-forest/40 border border-forest rounded-xl flex items-center gap-2">
                        <Map className="w-4 h-4 text-success" />
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider font-mono">Size</span>
                        <span className="text-sm font-black text-success font-mono">{mapData.acreage} Acres</span>
                      </div>
                    </div>
                  </div>

                  {/* Campus Map Columns */}
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    {/* Visualizer blueprint Grid representation */}
                    <div className="lg:col-span-3 space-y-4">
                      <div className="relative bg-[#17130c] rounded-4xl overflow-hidden border border-[rgba(251,247,238,0.14)] p-6 flex flex-col h-80 justify-between shadow-2xl">
                        {/* Blueprint decorative engineering grid overlay */}
                        <div
                          className="absolute inset-0 pointer-events-none opacity-20"
                          style={{
                            backgroundImage: "linear-gradient(rgba(201,163,92,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(201,163,92,0.16) 1px, transparent 1px)",
                            backgroundSize: "20px 20px"
                          }}
                        />
                        {/* Glowing highlights */}
                        <div className="absolute top-0 left-0 w-32 h-32 bg-primary/10 blur-3xl pointer-events-none" />
                        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[rgba(201,163,92,0.16)] blur-3xl pointer-events-none" />

                        <div className="relative z-10 flex items-center justify-between">
                          <div className="text-[9px] font-sans text-primary tracking-widest flex items-center gap-1.5 font-black uppercase">
                            <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                            CAMPUS ZONES OVERVIEW
                          </div>
                          <span className="text-[9px] font-mono text-accent-bright font-medium">Detailed plan</span>
                        </div>

                        {/* Visualizer map Quadrants */}
                        <div className="relative z-10 grid grid-cols-2 gap-4 my-auto h-44">
                          {mapData.zones.map((zone) => {
                            const isSelected = selectedZone === zone.id;
                            return (
                              <button
                                key={zone.id}
                                onClick={() => setSelectedZone(zone.id)}
                                className={`relative rounded-2xl border transition-all flex flex-col justify-between p-4 cursor-pointer overflow-hidden group outline-none ${
                                  isSelected
                                    ? 'border-primary bg-primary/20 text-white shadow-[0_0_20px_rgba(8,6,4,0.25)] scale-[1.02]'
                                    : 'border-white/10 bg-white/5 text-cream/60 hover:border-primary/50 hover:text-cream'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-sans tracking-widest uppercase opacity-70 font-black">
                                    {zone.id === 'academic-block' && 'ACADEMIC ZONE'}
                                    {zone.id === 'research-park' && 'RESEARCH BLOCK'}
                                    {zone.id === 'residential' && 'CAMPUS HOUSING'}
                                    {zone.id === 'recreational' && 'RECREATIONAL AREA'}
                                  </span>
                                  {isSelected && (
                                    <motion.div
                                      layoutId="activeGlow"
                                      className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_rgba(8,6,4,0.8)]"
                                    />
                                  )}
                                </div>
                                <div className="text-left font-mono">
                                  <h4 className="text-xs font-black truncate">{zone.name}</h4>
                                  <span className="text-[8px] opacity-40 uppercase tracking-widest block mt-0.5">{zone.type}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <div className="relative z-10 flex items-center justify-between text-[10px] font-sans text-muted-foreground font-bold uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-[#c9a35c] rounded-full" />
                            STATUS: ACCREDITED FACILITY
                          </span>
                          <span>{mapData.totalBuildings} CAMPUS BUILDINGS</span>
                        </div>
                      </div>

                      {/* Informational Guidelines banner */}
                      <div className="bg-muted rounded-2xl p-4 border border-line flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground font-semibold leading-relaxed">
                          Click any physical quadrant above representing major departments inside {university.name}'s boundary to inspect active capacity, Highlights, and specific infrastructure roles on the inspector board.
                        </p>
                      </div>
                    </div>

                    {/* Zone Inspector board */}
                    <div className="lg:col-span-2">
                      <div className="bg-surface border border-line rounded-4xl p-6 shadow-sm flex flex-col justify-between h-full min-h-80">
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="px-3.5 py-1 bg-accent text-accent-foreground rounded-full text-[9px] font-medium tracking-wide">
                              {activeZone.type}
                            </span>
                            <span className="text-[10px] font-black text-muted-foreground font-sans uppercase tracking-wider">
                              {activeZone.id === 'academic-block' && 'Primary Infrastructure'}
                              {activeZone.id === 'research-park' && 'Innovation Hub'}
                              {activeZone.id === 'residential' && 'Campus Living'}
                              {activeZone.id === 'recreational' && 'Community Services'}
                            </span>
                          </div>

                          <h4 className="text-base sm:text-lg font-black text-ink mb-2">{activeZone.name}</h4>
                          <p className="text-xs sm:text-sm text-muted-foreground font-semibold leading-relaxed mb-6">{activeZone.description}</p>

                          <div className="space-y-2.5 mb-6">
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Zone Highlights:</div>
                            <motion.div
                              key={selectedZone}
                              variants={{
                                hidden: { opacity: 0 },
                                show: {
                                  opacity: 1,
                                  transition: {
                                    staggerChildren: 0.08,
                                    delayChildren: 0.05
                                  }
                                }
                              }}
                              initial="hidden"
                              animate="show"
                              className="zone-highlights-list space-y-2.5"
                            >
                              {activeZone.highlights.map((h, i) => (
                                <motion.div
                                  key={i}
                                  variants={{
                                    hidden: { opacity: 0, y: 12 },
                                    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 15 } }
                                  }}
                                  whileHover={{
                                    scale: 1.025,
                                    y: -2,
                                    borderColor: "rgba(139, 92, 246, 0.4)",
                                    boxShadow: "0 10px 25px -5px rgba(124, 58, 237, 0.12), 0 0 12px 1px rgba(124, 58, 237, 0.08)"
                                  }}
                                  className="flex items-start gap-3.5 text-xs sm:text-sm text-ink/75 font-extrabold bg-muted/70 hover:bg-surface border border-line rounded-2xl p-3.5 transition-all duration-300 shadow-sm cursor-pointer group/item text-left"
                                >
                                  <div className="p-1.5 bg-surface rounded-xl border border-line/50 shadow-sm group-hover/item:border-primary/40 group-hover/item:bg-accent transition-colors shrink-0 flex items-center justify-center">
                                    {getZoneIcon(activeZone.id, activeZone.type)}
                                  </div>
                                  <span className="mt-0.5 leading-relaxed text-ink font-medium group-hover/item:text-ink transition-colors">
                                    {h}
                                  </span>
                                </motion.div>
                              ))}
                            </motion.div>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-line flex justify-between items-center bg-muted -mx-6 -mb-6 p-5 rounded-b-[28px]">
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest font-mono">Assigned Capacity</span>
                          <span className="text-xs sm:text-sm font-black text-ink">{activeZone.capacity || 'Flexible occupancy'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: FEATURED ALUMNI SUCCESS STORIES */}
              {activeTab === 'alumni' && (
                <div className="space-y-8 animate-fade-in">
                  <div className="border-b border-line pb-6">
                    <div className="flex items-center gap-2 mb-1">
                      <GraduationCap className="w-5 h-5 text-primary" />
                      <h3 className="text-xl font-black text-ink font-display">Featured Alumni Success Stories</h3>
                    </div>
                    <p className="text-sm text-muted-foreground font-semibold">Discover dynamic pathways and career trajectories of graduates from {university.name}.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {alumniList.map((alumnus, idx) => (
                      <motion.div
                        key={alumnus.id || idx}
                        whileHover={{ y: -3 }}
                        className="bg-surface border border-line rounded-xl p-6 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between"
                      >
                        <div>
                          {/* Profile Header Block */}
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={alumnus.image}
                                alt={alumnus.name}
                                className="w-12 h-12 rounded-xl object-cover border-2 border-primary/25 shadow-sm shrink-0"
                                referrerPolicy="no-referrer"
                              />
                              <div>
                                <h4 className="text-sm font-black text-ink leading-tight">{alumnus.name}</h4>
                                <p className="text-[11px] text-muted-foreground font-bold mt-0.5 leading-none">{alumnus.role}</p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="px-2.5 py-1 bg-accent border border-primary/25 text-accent-foreground text-[9px] font-medium rounded-md font-mono">
                                Class of '{alumnus.graduationYear % 100}
                              </span>
                              {alumnus.achievementBadge && (
                                <span className="px-2 py-0.5 bg-accent border border-primary/25 text-accent-foreground text-[8px] font-medium rounded uppercase tracking-wider font-mono">
                                  {alumnus.achievementBadge}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quote blocks */}
                          <div className="relative bg-muted p-4 rounded-2xl border border-line mb-4 h-32 flex items-center overflow-y-auto">
                            <Quote className="absolute top-2 right-3 w-8 h-8 text-white/90 fill-current opacity-40 pointer-events-none" />
                            <p className="text-xs text-muted-foreground font-semibold leading-relaxed italic relative z-10">
                              "{alumnus.quote}"
                            </p>
                          </div>
                        </div>

                        {/* Current Placement */}
                        <div className="flex items-center justify-between text-[10px] font-black tracking-wider uppercase border-t border-line pt-4 text-muted-foreground">
                          <span>Professional Sector</span>
                          <span className="text-primary font-mono">{alumnus.company}</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
