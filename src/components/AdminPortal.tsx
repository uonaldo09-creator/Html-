import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, Users, School, MessageSquare, History, Search, Edit2, Trash2, Plus, CheckCircle2, AlertCircle, Loader2, Save, ExternalLink, Globe, GraduationCap, MapPin, DollarSign, RefreshCw, Activity, HeartPulse, BarChart3
} from 'lucide-react';
import { University } from '../types';
import { getApiMetricsSummary, customFetch as fetch } from '../lib/api';
import { getSafeLogo, handleLogoError } from '../lib/utils';

interface AdminPortalProps {
  universities: University[];
  onRefreshUniversities: () => void;
  onViewDetails: (id: number) => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  universities,
  onRefreshUniversities,
  onViewDetails
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'universities' | 'reviews' | 'audit' | 'api_metrics'>('universities');
  const [apiMetrics, setApiMetrics] = useState<any>(null);

  const loadApiMetrics = () => {
    try {
      const summary = getApiMetricsSummary();
      setApiMetrics(summary);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadApiMetrics();
    window.addEventListener('api_metrics_updated', loadApiMetrics);
    return () => {
      window.removeEventListener('api_metrics_updated', loadApiMetrics);
    };
  }, []);

  // Status states
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // ---------------- USER MANAGEMENT ----------------
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users'); // we can write /api/admin/users in server.ts
      const data = await res.json();
      if (data.status === 'success') {
        setUsers(data.users || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateRole = async (email: string, role: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg(`Role for ${email} updated to ${role} successfully.`);
        fetchUsers();
      } else {
        setErrorMsg(data.error || 'Failed to update role.');
      }
    } catch (err) {
      setErrorMsg('Failed to update user role.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------- UNIVERSITY MANAGEMENT ----------------
  const [uniSearch, setUniSearch] = useState('');
  const [showUniForm, setShowUniForm] = useState(false);
  const [editingUniId, setEditingUniId] = useState<number | null>(null);

  // Form Fields
  const [uniId, setUniId] = useState('');
  const [uniName, setUniName] = useState('');
  const [uniLocation, setUniLocation] = useState('');
  const [uniState, setUniState] = useState('');
  const [uniType, setUniType] = useState('Private');
  const [uniFee, setUniFee] = useState(300000);
  const [uniRating, setUniRating] = useState('4.2');
  const [uniStudents, setUniStudents] = useState('2,500+');
  const [uniCourses, setUniCourses] = useState(15);
  const [uniLogo, setUniLogo] = useState('');
  const [uniImage, setUniImage] = useState('');
  const [uniCategories, setUniCategories] = useState<string[]>(['Engineering']);
  const [uniStream, setUniStream] = useState<string[]>(['Science']);
  const [uniDegrees, setUniDegrees] = useState<string[]>(['B.Tech']);
  const [uniMajors, setUniMajors] = useState<string[]>(['Computer Science']);
  const [uniPopularCourses, setUniPopularCourses] = useState<string[]>([]);
  const [uniPhone, setUniPhone] = useState('+91 9999 111122');
  const [uniCompetitiveExams, setUniCompetitiveExams] = useState<string[]>(['JEE']);
  const [uniMin10th, setUniMin10th] = useState(60);
  const [uniMin12th, setUniMin12th] = useState(60);
  const [uniNaacGrade, setUniNaacGrade] = useState('A');
  const [uniNirfRank, setUniNirfRank] = useState(120);
  const [uniAicteApproved, setUniAicteApproved] = useState(true);
  const [uniNbaAccredited, setUniNbaAccredited] = useState(false);
  const [uniNmcRecognized, setUniNmcRecognized] = useState(false);
  const [uniAvgPlacementLPA, setUniAvgPlacementLPA] = useState('5.5');
  const [uniWebsite, setUniWebsite] = useState('');
  const [uniVirtualTour, setUniVirtualTour] = useState('');
  const [uniExpertInsight, setUniExpertInsight] = useState('');

  const openAddUni = () => {
    setEditingUniId(null);
    setUniId((universities.reduce((max, u) => u.id > max ? u.id : max, 0) + 1).toString());
    setUniName('');
    setUniLocation('');
    setUniState('');
    setUniType('Private');
    setUniFee(300000);
    setUniRating('4.2');
    setUniStudents('2,500+');
    setUniCourses(15);
    setUniLogo('');
    setUniImage('');
    setUniCategories(['Engineering']);
    setUniStream(['Science']);
    setUniDegrees(['B.Tech']);
    setUniMajors(['Computer Science']);
    setUniPopularCourses([]);
    setUniPhone('+91 9999 111122');
    setUniCompetitiveExams(['JEE']);
    setUniMin10th(60);
    setUniMin12th(60);
    setUniNaacGrade('A');
    setUniNirfRank(120);
    setUniAicteApproved(true);
    setUniNbaAccredited(false);
    setUniNmcRecognized(false);
    setUniAvgPlacementLPA('5.5');
    setUniWebsite('');
    setUniVirtualTour('');
    setUniExpertInsight('');
    setShowUniForm(true);
  };

  const openEditUni = (uni: any) => {
    setEditingUniId(uni.id);
    setUniId(uni.id.toString());
    setUniName(uni.name);
    setUniLocation(uni.location);
    setUniState(uni.state);
    setUniType(uni.type);
    setUniFee(uni.fee);
    setUniRating(uni.rating.toString());
    setUniStudents(uni.students || '2,000+');
    setUniCourses(uni.courses || 10);
    setUniLogo(uni.logo || '');
    setUniImage(uni.image || '');
    setUniCategories(uni.categories || []);
    setUniStream(uni.stream || []);
    setUniDegrees(uni.degrees || []);
    setUniMajors(uni.majors || []);
    setUniPopularCourses(uni.popularCourses || []);
    setUniPhone(uni.phone || '+91 9999 111122');
    setUniCompetitiveExams(uni.competitiveExams || []);
    setUniMin10th(uni.min10th || 50);
    setUniMin12th(uni.min12th || 50);
    setUniNaacGrade(uni.naacGrade || 'B');
    setUniNirfRank(uni.nirfRank || 150);
    setUniAicteApproved(uni.aicteApproved !== false);
    setUniNbaAccredited(uni.nbaAccredited === true);
    setUniNmcRecognized(uni.nmcRecognized === true);
    setUniAvgPlacementLPA(uni.avgPlacementLPA ? uni.avgPlacementLPA.toString() : '4.5');
    setUniWebsite(uni.website || '');
    setUniVirtualTour(uni.virtualTourUrl || '');
    setUniExpertInsight(uni.expertInsight || '');
    setShowUniForm(true);
  };

  const handleSaveUniversity = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    const payload = {
      id: uniId,
      name: uniName,
      location: uniLocation,
      state: uniState,
      type: uniType,
      fee: uniFee,
      rating: uniRating,
      students: uniStudents,
      courses: uniCourses,
      logo: uniLogo,
      image: uniImage,
      categories: uniCategories,
      stream: uniStream,
      degrees: uniDegrees,
      majors: uniMajors,
      popularCourses: uniPopularCourses,
      phone: uniPhone,
      competitiveExams: uniCompetitiveExams,
      min10th: uniMin10th,
      min12th: uniMin12th,
      naacGrade: uniNaacGrade,
      nirfRank: uniNirfRank,
      aicteApproved: uniAicteApproved,
      nbaAccredited: uniNbaAccredited,
      nmcRecognized: uniNmcRecognized,
      avgPlacementLPA: uniAvgPlacementLPA,
      website: uniWebsite,
      virtualTourUrl: uniVirtualTour,
      expertInsight: uniExpertInsight
    };

    try {
      const res = await fetch('/api/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg(`University configs saved successfully.`);
        setShowUniForm(false);
        onRefreshUniversities();
      } else {
        setErrorMsg(data.error || 'Failed to save university configurations.');
      }
    } catch (err) {
      setErrorMsg('Network error while saving university configurations.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUniversity = async (id: number) => {
    if (!window.confirm("Are you absolutely sure you want to delete this university configuration permanently? This is irreversible.")) return;
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/admin/universities/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg("University removed successfully.");
        onRefreshUniversities();
      } else {
        setErrorMsg(data.error || 'Failed to delete university.');
      }
    } catch (err) {
      setErrorMsg('Failed to complete university deletion request.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------- REVIEWS MODERATION ----------------
  const [reviews, setReviews] = useState<any[]>([]);

  const fetchReviews = async () => {
    try {
      const res = await fetch('/api/admin/reviews'); // we can write /api/admin/reviews in server.ts
      const data = await res.json();
      if (data.status === 'success') {
        setReviews(data.reviews || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteReview = async (id: number) => {
    if (!window.confirm("Delete this review from university listings?")) return;
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg("Review removed successfully.");
        fetchReviews();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ---------------- AUDIT LOGS ----------------
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearch, setAuditSearch] = useState('');

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs'); // we can write /api/admin/audit-logs in server.ts
      const data = await res.json();
      if (data.status === 'success') {
        setAuditLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'users') fetchUsers();
    if (activeSubTab === 'reviews') fetchReviews();
    if (activeSubTab === 'audit') fetchAuditLogs();
    if (activeSubTab === 'api_metrics') loadApiMetrics();
  }, [activeSubTab]);

  const filteredUnis = universities.filter(u =>
    u.name.toLowerCase().includes(uniSearch.toLowerCase()) ||
    u.location.toLowerCase().includes(uniSearch.toLowerCase())
  );

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.name && u.name.toLowerCase().includes(userSearch.toLowerCase()))
  );

  const filteredAudits = auditLogs.filter(log =>
    log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
    log.userEmail.toLowerCase().includes(auditSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header Panel */}
      <div className="p-6 rounded-3xl mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{
          background: '#1a150d',
          border: '1px solid rgba(8,6,4,0.25)'
        }}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-destructive animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-ink">System administrative panel</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Configure university catalogs, moderate student and parent reviews, alter user security credentials, and review chronological compliance audits.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            if (activeSubTab === 'users') fetchUsers();
            if (activeSubTab === 'reviews') fetchReviews();
            if (activeSubTab === 'audit') fetchAuditLogs();
            if (activeSubTab === 'api_metrics') loadApiMetrics();
            onRefreshUniversities();
          }}
          className="flex items-center gap-1.5 bg-ink/5 hover:bg-ink/10 px-3.5 py-2 rounded-xl text-[11px] font-bold text-ink/80 cursor-pointer border border-ink/10"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Synchronize Cache</span>
        </button>
      </div>

      {successMsg && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl mb-6 bg-emerald-500/10 border border-emerald-500/30 text-success flex items-center gap-3"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-xs font-semibold">{successMsg}</span>
        </motion.div>
      )}

      {errorMsg && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl mb-6 bg-primary/10 border border-primary/30 text-destructive flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-xs font-semibold">{errorMsg}</span>
        </motion.div>
      )}

      {/* Sub Tabs Selection Row */}
      <div className="flex flex-wrap gap-2 mb-8 bg-ink/5 p-1.5 rounded-2xl border border-ink/10 w-fit">
        {[
          { id: 'universities', label: 'University catalog', icon: School },
          { id: 'users', label: 'Registered users', icon: Users },
          { id: 'reviews', label: 'Review Moderation', icon: MessageSquare },
          { id: 'audit', label: 'Audit Logs', icon: History },
          { id: 'api_metrics', label: 'API Monitor', icon: Activity }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveSubTab(tab.id as any);
                setSuccessMsg('');
                setErrorMsg('');
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                isActive
                  ? 'bg-primary text-white shadow-md shadow-rose-900/20'
                  : 'text-muted-foreground hover:text-ink hover:bg-ink/5'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">

        {/* ======================= UNIVERSITIES CATALOG SUB-TAB ======================= */}
        {activeSubTab === 'universities' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="relative w-full sm:max-w-md">
                <Search className="absolute left-4 top-3.5 w-4 h-4 text-muted-foreground/70" />
                <input
                  type="text"
                  placeholder="Filter universities catalog..."
                  value={uniSearch}
                  onChange={(e) => setUniSearch(e.target.value)}
                  className="w-full bg-ink/5 border border-ink/15 rounded-none pl-11 pr-4 py-3 text-xs text-ink focus:outline-none focus:border-primary"
                />
              </div>

              <button
                onClick={openAddUni}
                className="flex items-center gap-2 bg-primary text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-2xl cursor-pointer shadow-lg hover:bg-primary-deep"
              >
                <Plus className="w-4 h-4 text-ink" />
                <span>Add New Institution</span>
              </button>
            </div>

            {showUniForm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-6 rounded-3xl space-y-6"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.25)' }}
              >
                <div className="flex justify-between items-center border-b border-ink/15 pb-4">
                  <h3 className="text-sm font-black text-ink uppercase tracking-wider">
                    {editingUniId ? `Edit: ${uniName}` : 'Register New University'}
                  </h3>
                  <button
                    onClick={() => setShowUniForm(false)}
                    className="text-xs font-bold text-muted-foreground/80 hover:text-ink cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <form onSubmit={handleSaveUniversity} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Unique ID (Sequence Number)</label>
                    <input
                      type="number"
                      required
                      disabled={!!editingUniId}
                      value={uniId}
                      onChange={(e) => setUniId(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Institution Name</label>
                    <input
                      type="text"
                      required
                      value={uniName}
                      onChange={(e) => setUniName(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">City / Location</label>
                    <input
                      type="text"
                      required
                      value={uniLocation}
                      onChange={(e) => setUniLocation(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">State</label>
                    <input
                      type="text"
                      required
                      value={uniState}
                      onChange={(e) => setUniState(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Type</label>
                    <select
                      value={uniType}
                      onChange={(e) => setUniType(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="Private" className="bg-surface">Private</option>
                      <option value="Deemed" className="bg-surface">Deemed University</option>
                      <option value="State Private" className="bg-surface">State Private</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Annual Tuition Fee (INR)</label>
                    <input
                      type="number"
                      required
                      value={uniFee}
                      onChange={(e) => setUniFee(Number(e.target.value))}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">NIRF Rank</label>
                    <input
                      type="number"
                      required
                      value={uniNirfRank}
                      onChange={(e) => setUniNirfRank(Number(e.target.value))}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Average Placement Package (LPA in INR)</label>
                    <input
                      type="text"
                      required
                      value={uniAvgPlacementLPA}
                      onChange={(e) => setUniAvgPlacementLPA(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Campus Map Cover Image URL</label>
                    <input
                      type="text"
                      placeholder="e.g. https://picsum.photos/seed/bits/800/500"
                      value={uniImage}
                      onChange={(e) => setUniImage(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Logo Brand URL</label>
                    <input
                      type="text"
                      placeholder="e.g. https://logo.clearbit.com/bits-pilani.ac.in"
                      value={uniLogo}
                      onChange={(e) => setUniLogo(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Official Website URL</label>
                    <input
                      type="text"
                      placeholder="e.g. https://www.bits-pilani.ac.in"
                      value={uniWebsite}
                      onChange={(e) => setUniWebsite(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Virtual Tour Video Link</label>
                    <input
                      type="text"
                      placeholder="e.g. https://youtube.com/watch?v=tour"
                      value={uniVirtualTour}
                      onChange={(e) => setUniVirtualTour(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Advisory Expert Insights</label>
                    <textarea
                      rows={3}
                      value={uniExpertInsight}
                      onChange={(e) => setUniExpertInsight(e.target.value)}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none p-3 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="flex flex-wrap gap-4 md:col-span-2 border-t border-ink/10 pt-4">
                    <label className="flex items-center gap-2 text-xs text-ink/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={uniAicteApproved}
                        onChange={(e) => setUniAicteApproved(e.target.checked)}
                        className="w-4 h-4 bg-ink/5 border border-ink/15 rounded accent-red-500 cursor-pointer"
                      />
                      <span>AICTE Regulatory Approval</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-ink/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={uniNbaAccredited}
                        onChange={(e) => setUniNbaAccredited(e.target.checked)}
                        className="w-4 h-4 bg-ink/5 border border-ink/15 rounded accent-red-500 cursor-pointer"
                      />
                      <span>NBA Accreditation status</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-ink/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={uniNmcRecognized}
                        onChange={(e) => setUniNmcRecognized(e.target.checked)}
                        className="w-4 h-4 bg-ink/5 border border-ink/15 rounded accent-red-500 cursor-pointer"
                      />
                      <span>NMC Recognized</span>
                    </label>
                  </div>

                  <div className="md:col-span-2 flex justify-end gap-2 pt-4 border-t border-ink/10">
                    <button
                      type="button"
                      onClick={() => setShowUniForm(false)}
                      className="bg-ink/5 hover:bg-ink/10 text-ink text-xs font-bold px-5 py-3 rounded-xl transition-all cursor-pointer border border-ink/10"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-primary text-white text-xs font-bold px-6 py-3 rounded-xl cursor-pointer transition-all disabled:opacity-50"
                    >
                      {loading ? 'Saving configs...' : 'Save Catalog configuration'}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* University list grid */}
            <div className="overflow-x-auto rounded-3xl border border-ink/15 bg-ink/5">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/15 bg-obsidian/70">
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">ID</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">University</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Location</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">NIRF</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Placements</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Annual Fee</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {filteredUnis.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-xs text-muted-foreground/70">
                        No universities found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredUnis.map((uni) => (
                      <tr key={uni.id} className="hover:bg-ink/5 transition-colors">
                        <td className="p-4 text-xs font-mono text-muted-foreground">{uni.id}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={getSafeLogo(uni.name, uni.logo)}
                              alt="logo"
                              className="w-8 h-8 rounded-lg bg-ink/10 p-0.5 object-contain"
                              referrerPolicy="no-referrer"
                              onError={(e) => handleLogoError(e, uni.name)}
                            />
                            <div>
                              <h4 className="text-xs font-bold text-ink">{uni.name}</h4>
                              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-black">{uni.type}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-xs text-ink/70">{uni.location}, {uni.state}</td>
                        <td className="p-4 text-xs text-primary-deep font-bold">#{uni.nirfRank || '150'}</td>
                        <td className="p-4 text-xs text-success font-black">{uni.avgPlacementLPA || '4.5'} LPA</td>
                        <td className="p-4 text-xs font-mono text-ink/80">₹{uni.fee?.toLocaleString()}</td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditUni(uni)}
                              className="p-2 rounded-lg bg-ink/5 hover:bg-ink/10 text-muted-foreground hover:text-ink cursor-pointer"
                              title="Edit config"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteUniversity(uni.id)}
                              className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-destructive cursor-pointer"
                              title="Delete config"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* ======================= USER ACCOUNTS SUB-TAB ======================= */}
        {activeSubTab === 'users' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="space-y-6"
          >
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-4 top-3.5 w-4 h-4 text-muted-foreground/70" />
              <input
                type="text"
                placeholder="Search registered users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full bg-ink/5 border border-ink/15 rounded-none pl-11 pr-4 py-3 text-xs text-ink focus:outline-none focus:border-primary"
              />
            </div>

            <div className="overflow-x-auto rounded-3xl border border-ink/15 bg-ink/5">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/15 bg-obsidian/70">
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Name / Email</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Status</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Registration Date</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Role</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-xs text-muted-foreground/70">
                        No registered users fetched yet. Make sure server API is active.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((usr) => (
                      <tr key={usr.email} className="hover:bg-ink/5 transition-colors">
                        <td className="p-4">
                          <div>
                            <h4 className="text-xs font-bold text-ink">{usr.name || 'Anonymous User'}</h4>
                            <span className="text-[10px] text-muted-foreground/80 font-mono">{usr.email}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${usr.emailVerified ? 'bg-emerald-500/10 text-success' : 'bg-primary/10 text-primary-deep'}`}>
                            {usr.emailVerified ? 'Verified' : 'Unverified'}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">
                          {new Date(usr.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-xs font-bold text-accent-bright">
                          {usr.role}
                        </td>
                        <td className="p-4 text-right">
                          <select
                            value={usr.role}
                            onChange={(e) => handleUpdateRole(usr.email, e.target.value)}
                            className="bg-ink/5 border border-ink/15 rounded-none px-2 py-1 text-xs text-ink cursor-pointer focus:outline-none"
                          >
                            <option value="Student" className="bg-surface">Student</option>
                            <option value="Parent" className="bg-surface">Parent</option>
                            <option value="Counselor" className="bg-surface">Counselor</option>
                            <option value="Admin" className="bg-surface">Admin</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* ======================= REVIEWS MODERATION SUB-TAB ======================= */}
        {activeSubTab === 'reviews' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {reviews.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground/70 md:col-span-2 bg-ink/5 rounded-3xl border border-ink/15">
                  No reviews submitted for moderation yet.
                </div>
              ) : (
                reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-5 rounded-3xl bg-ink/5 border border-ink/15 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-destructive">Review #{rev.id}</span>
                          <h4 className="text-xs font-bold text-ink mt-1">By: {rev.userEmail}</h4>
                        </div>
                        <span className="text-xs text-yellow-400 font-bold">★ {rev.rating}</span>
                      </div>
                      <p className="text-xs text-ink/70 leading-relaxed bg-ink/5 p-3 rounded-xl border border-ink/10">
                        "{rev.comment}"
                      </p>
                      <span className="text-[9.5px] text-muted-foreground/70 block">Submitted on: {new Date(rev.createdAt).toLocaleDateString()}</span>
                    </div>

                    <div className="flex justify-end pt-3 border-t border-ink/10">
                      <button
                        onClick={() => handleDeleteReview(rev.id)}
                        className="flex items-center gap-1 bg-primary/10 hover:bg-primary/20 text-destructive text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-xl cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Review</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {/* ======================= AUDIT SECURITY LOGS SUB-TAB ======================= */}
        {activeSubTab === 'audit' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="space-y-6"
          >
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-4 top-3.5 w-4 h-4 text-muted-foreground/70" />
              <input
                type="text"
                placeholder="Search action logs..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full bg-ink/5 border border-ink/15 rounded-none pl-11 pr-4 py-3 text-xs text-ink focus:outline-none focus:border-primary"
              />
            </div>

            <div className="overflow-x-auto rounded-3xl border border-ink/15 bg-ink/5">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/15 bg-obsidian/70">
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Timestamp</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">User Account</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Action</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Status</th>
                    <th className="p-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10 font-mono text-[11px]">
                  {filteredAudits.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-xs text-muted-foreground/70">
                        No matching system logs recorded in the session.
                      </td>
                    </tr>
                  ) : (
                    filteredAudits.map((log) => (
                      <tr key={log.id} className="hover:bg-ink/5 transition-colors">
                        <td className="p-4 text-muted-foreground/80">
                          {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="p-4 text-ink/90">{log.userEmail || 'system'}</td>
                        <td className="p-4 font-bold text-accent-bright">{log.action}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold ${log.status === 'success' ? 'bg-emerald-500/10 text-success' : 'bg-primary/10 text-destructive'}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="p-4 text-muted-foreground max-w-xs truncate" title={JSON.stringify(log.details)}>
                          {JSON.stringify(log.details)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* ======================= API METRICS MONITOR SUB-TAB ======================= */}
        {activeSubTab === 'api_metrics' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="space-y-6"
          >
            {/* Health Overview Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">

              {/* Card 1: Status */}
              <div className="p-5 rounded-3xl bg-muted border border-ink/15 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Backend Status</span>
                  <div className="p-2 rounded-xl bg-primary/10 text-accent-bright">
                    <HeartPulse className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        !apiMetrics || apiMetrics.totalRequests === 0 ? 'bg-muted' : apiMetrics.successRate >= 95 ? 'bg-emerald-400' : 'bg-primary'
                      }`}></span>
                      <span className={`relative inline-flex rounded-full h-3 w-3 ${
                        !apiMetrics || apiMetrics.totalRequests === 0 ? 'bg-muted0' : apiMetrics.successRate >= 95 ? 'bg-emerald-500' : 'bg-primary'
                      }`}></span>
                    </span>
                    <span className="text-lg font-black text-ink">
                      {!apiMetrics || apiMetrics.totalRequests === 0 ? 'STANDBY' : apiMetrics.successRate >= 95 ? 'HEALTHY' : 'ATTENTION'}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 font-bold mt-1 uppercase tracking-wider">Client-side API Gateway</p>
                </div>
              </div>

              {/* Card 2: Request Count */}
              <div className="p-5 rounded-3xl bg-muted border border-ink/15 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Total Transactions</span>
                  <div className="p-2 rounded-xl bg-muted text-ink/70">
                    <Activity className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-black text-ink">
                    {apiMetrics?.totalRequests || 0}
                  </span>
                  <p className="text-[10px] text-muted-foreground/70 font-bold mt-1 uppercase tracking-wider">Active telemetry stream</p>
                </div>
              </div>

              {/* Card 3: Avg Latency */}
              <div className="p-5 rounded-3xl bg-muted border border-ink/15 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Average Response Time</span>
                  <div className="p-2 rounded-xl bg-primary/10 text-primary-deep">
                    <History className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-black text-ink">
                    {apiMetrics?.avgLatency || 0} <span className="text-xs font-bold text-muted-foreground/80">ms</span>
                  </span>
                  <p className="text-[10px] text-muted-foreground/70 font-bold mt-1 uppercase tracking-wider">
                    {!apiMetrics || apiMetrics.avgLatency === 0 ? 'No Data' : apiMetrics.avgLatency < 150 ? 'Lightning Fast ⚡' : apiMetrics.avgLatency < 400 ? 'Averaging OK ⏱️' : 'Latency Spillover ⚠️'}
                  </p>
                </div>
              </div>

              {/* Card 4: Success Rate */}
              <div className="p-5 rounded-3xl bg-muted border border-ink/15 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Success Rate</span>
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-black text-success">
                    {apiMetrics?.successRate || 100}%
                  </span>
                  <p className="text-[10px] text-muted-foreground/70 font-bold mt-1 uppercase tracking-wider">
                    {apiMetrics?.errorCount || 0} failures intercepted
                  </p>
                </div>
              </div>

            </div>

            {/* Endpoints breakdown bento grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Endpoint Stats Column */}
              <div className="lg:col-span-2 p-6 rounded-3xl bg-muted border border-ink/15 space-y-4">
                <div className="flex items-center gap-2 border-b border-ink/15 pb-3">
                  <BarChart3 className="w-4 h-4 text-destructive" />
                  <h3 className="text-xs font-black text-ink uppercase tracking-wider">Registered Route Stats</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-ink/10 text-muted-foreground/70 font-black uppercase text-[9.5px] tracking-widest">
                        <th className="py-2.5">Endpoint Path</th>
                        <th className="py-2.5 text-center">Hits</th>
                        <th className="py-2.5 text-center">Avg Latency</th>
                        <th className="py-2.5 text-right">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/10 font-mono">
                      {!apiMetrics || Object.keys(apiMetrics.endpointBreakdown).length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-xs text-muted-foreground/60 font-sans">
                            No endpoint transactions monitored yet. Execute actions in the app!
                          </td>
                        </tr>
                      ) : (
                        Object.keys(apiMetrics.endpointBreakdown).map((key) => {
                          const route = apiMetrics.endpointBreakdown[key];
                          const [method, path] = key.split(' ');
                          return (
                            <tr key={key} className="hover:bg-ink/5 transition-colors">
                              <td className="py-3 pr-2 flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                  method === 'GET' ? 'bg-muted text-ink/70 border border-line' :
                                  method === 'POST' ? 'bg-primary/15 text-accent-bright border border-primary/10' :
                                  'bg-primary/15 text-destructive border border-primary/10'
                                }`}>
                                  {method}
                                </span>
                                <span className="text-ink/80 select-all font-semibold tracking-tight text-[11px]">{path}</span>
                              </td>
                              <td className="py-3 text-center text-ink">{route.count}</td>
                              <td className="py-3 text-center">
                                <span className={`font-bold ${
                                  route.avgLatency < 150 ? 'text-success' :
                                  route.avgLatency < 500 ? 'text-primary-deep' : 'text-destructive'
                                }`}>
                                  {route.avgLatency}ms
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <span className={`font-bold ${route.successRate >= 90 ? 'text-success' : 'text-destructive'}`}>
                                  {route.successRate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Live Request Stream Column */}
              <div className="p-6 rounded-3xl bg-muted border border-ink/15 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-ink/15 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-accent-bright animate-pulse" />
                      <h3 className="text-xs font-black text-ink uppercase tracking-wider">Live Request Stream</h3>
                    </div>
                    <span className="text-[9px] bg-ink/5 text-muted-foreground/70 px-2 py-0.5 rounded font-bold uppercase tracking-wider font-mono">
                      Last {apiMetrics?.recentLogs?.length || 0}
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                    {!apiMetrics || apiMetrics.recentLogs.length === 0 ? (
                      <div className="py-12 text-center text-xs text-muted-foreground/60">
                        No transactions logged in current session.
                      </div>
                    ) : (
                      apiMetrics.recentLogs.slice(0, 30).map((log: any) => (
                        <div key={log.id} className="p-2.5 rounded-2xl bg-ink/5 border border-ink/10 hover:border-ink/15 transition-all flex items-center justify-between gap-3 text-[11px] font-mono">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded ${
                                log.method === 'GET' ? 'bg-muted text-ink/70' :
                                log.method === 'POST' ? 'bg-primary/10 text-accent-bright' :
                                'bg-primary/10 text-destructive'
                              }`}>
                                {log.method}
                              </span>
                              <span className="text-ink/80 font-bold truncate tracking-tight text-[10px]">{log.url}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground/70 mt-1">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-extrabold ${
                              log.status >= 200 && log.status < 300 ? 'bg-emerald-500/10 text-success' :
                              log.status === 0 ? 'bg-primary/10 text-primary animate-pulse' : 'bg-primary/10 text-destructive'
                            }`}>
                              {log.status === 0 ? 'ERR' : log.status}
                            </span>
                            <div className="text-[10px] text-muted-foreground font-semibold mt-1">
                              {log.latency}ms
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-ink/10 pt-4 mt-4 flex items-center justify-between text-[10px] text-muted-foreground/70 font-bold uppercase tracking-wider">
                  <span>Dynamic Telemetry Feed</span>
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </div>
              </div>

            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};
