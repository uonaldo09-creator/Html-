import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Save, User, Shield, GraduationCap, DollarSign, Award, CheckCircle2, AlertCircle, Loader2, LogOut } from 'lucide-react';
import { customFetch as fetch } from '../lib/api';

interface UserProfileProps {
  visitorRole: 'parent' | 'student';
  onLogout?: () => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ visitorRole, onLogout }) => {
  const isParent = visitorRole === 'parent';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Student states
  const [stream, setStream] = useState('Science');
  const [studentBudget, setStudentBudget] = useState(500000);
  const [preferredLocation, setPreferredLocation] = useState('');
  const [preferredCourse, setPreferredCourse] = useState('');
  const [entranceExams, setEntranceExams] = useState<string[]>([]);
  const [hostelPreference, setHostelPreference] = useState(false);
  const [placementPriority, setPlacementPriority] = useState('High');
  const [tenthScore, setTenthScore] = useState(85);
  const [twelfthScore, setTwelfthScore] = useState(85);
  const [careerGoals, setCareerGoals] = useState('');

  // Parent states
  const [parentBudget, setParentBudget] = useState(800000);
  const [preferredStateCity, setPreferredStateCity] = useState('');
  const [safetyPreference, setSafetyPreference] = useState('High');
  const [roiPreference, setRoiPreference] = useState('High');
  const [scholarshipPreference, setScholarshipPreference] = useState('Yes');
  const [distancePreference, setDistancePreference] = useState('Moderate');
  const [accommodationPreference, setAccommodationPreference] = useState('Hostel');

  // Input validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const endpoint = isParent ? '/api/profile/parent' : '/api/profile/student';
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.status === 'success' && data.profile) {
        const p = data.profile;
        if (isParent) {
          setParentBudget(p.budget || 800000);
          setPreferredStateCity(p.preferredStateCity || '');
          setSafetyPreference(p.safetyPreference || 'High');
          setRoiPreference(p.roiPreference || 'High');
          setScholarshipPreference(p.scholarshipPreference || 'Yes');
          setDistancePreference(p.distancePreference || 'Moderate');
          setAccommodationPreference(p.accommodationPreference || 'Hostel');
        } else {
          setStream(p.stream || 'Science');
          setStudentBudget(p.budget || 500000);
          setPreferredLocation(p.preferredLocation || '');
          setPreferredCourse(p.preferredCourse || '');
          setEntranceExams(p.entranceExams || []);
          setHostelPreference(p.hostelPreference || false);
          setPlacementPriority(p.placementPriority || 'High');
          if (p.academicScores) {
            setTenthScore(p.academicScores.tenth || 85);
            setTwelfthScore(p.academicScores.twelfth || 85);
          }
          setCareerGoals(p.careerGoals || '');
        }
      }
    } catch (err) {
      console.error("Error loading profile data", err);
      setErrorMsg('Failed to fetch existing profile details.');
    } finally {
      setLoading(false);
    }
  }, [isParent]);

  // Reload whenever the viewer switches between parent and student advisory mode.
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleCheckboxChange = (exam: string) => {
    if (entranceExams.includes(exam)) {
      setEntranceExams(prev => prev.filter(e => e !== exam));
    } else {
      setEntranceExams(prev => [...prev, exam]);
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!isParent) {
      if (tenthScore < 0 || tenthScore > 100) errs.tenth = 'Score must be between 0 and 100%';
      if (twelfthScore < 0 || twelfthScore > 100) errs.twelfth = 'Score must be between 0 and 100%';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    const payload = isParent ? {
      budget: parentBudget,
      preferredStateCity,
      safetyPreference,
      roiPreference,
      scholarshipPreference,
      distancePreference,
      accommodationPreference
    } : {
      stream,
      budget: studentBudget,
      preferredLocation,
      preferredCourse,
      entranceExams,
      hostelPreference,
      placementPriority,
      academicScores: { tenth: tenthScore, twelfth: twelfthScore },
      careerGoals
    };

    try {
      const endpoint = isParent ? '/api/profile/parent' : '/api/profile/student';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg('Your profile guidelines have been updated successfully! Recommendations are now synchronized.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setErrorMsg(data.error || 'Failed to update profile configurations.');
      }
    } catch (err) {
      setErrorMsg('Network error while saving profile parameters.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/80 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-accent-bright" />
        <p className="text-xs font-mono">Loading your customized advisory profile...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header card */}
      <div className="p-6 rounded-3xl mb-8 relative overflow-hidden"
        style={{
          background: '#1a150d',
          border: '1px solid rgba(8,6,4,0.25)'
        }}>
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
            {isParent ? <Shield className="w-6 h-6 text-white" /> : <User className="w-6 h-6 text-white" />}
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-ink">
              {isParent ? 'Parent Advisory Profile' : 'Student Academic Profile'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {isParent
                ? 'Specify budget limits, location safety guidelines, and priority preferences to match with parent recommendations.'
                : 'Enter your preferred streams, entrance exams, and academic scores to compute direct eligibility alignments.'}
            </p>
          </div>
        </div>
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

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* General info cards */}
          {!isParent ? (
            <>
              {/* STUDENT FORM FIELDS */}
              <div className="p-6 rounded-3xl space-y-4"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.2)' }}>
                <h3 className="text-sm font-black text-ink uppercase tracking-wider flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-accent-bright" /> Academic Goals
                </h3>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Stream of Study</label>
                  <select
                    value={stream}
                    onChange={(e) => setStream(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Science" className="bg-surface">Science / Engineering</option>
                    <option value="Medical" className="bg-surface">Medical / Biotech</option>
                    <option value="Commerce" className="bg-surface">Commerce / Business</option>
                    <option value="Arts" className="bg-surface">Arts / Humanities</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Preferred Course</label>
                  <input
                    type="text"
                    placeholder="e.g. B.Tech Computer Science, MBBS, BBA"
                    value={preferredCourse}
                    onChange={(e) => setPreferredCourse(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Placement Priority</label>
                  <select
                    value={placementPriority}
                    onChange={(e) => setPlacementPriority(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="High" className="bg-surface">High Priority (Aim for Elite LPA)</option>
                    <option value="Medium" className="bg-surface">Medium Priority (Balanced Placement & Research)</option>
                    <option value="Low" className="bg-surface">Low Priority (Post-Graduation focus)</option>
                  </select>
                </div>
              </div>

              <div className="p-6 rounded-3xl space-y-4"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.2)' }}>
                <h3 className="text-sm font-black text-ink uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-success" /> Financials & Location
                </h3>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase">Maximum Fee Budget (Annual)</label>
                    <span className="text-xs font-mono font-bold text-success">₹{studentBudget.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min="100000"
                    max="2000000"
                    step="50000"
                    value={studentBudget}
                    onChange={(e) => setStudentBudget(Number(e.target.value))}
                    className="w-full h-1 bg-ink/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Preferred Location / State</label>
                  <input
                    type="text"
                    placeholder="e.g. Karnataka, Delhi NCR, Maharashtra"
                    value={preferredLocation}
                    onChange={(e) => setPreferredLocation(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="hostelPref"
                    checked={hostelPreference}
                    onChange={(e) => setHostelPreference(e.target.checked)}
                    className="w-4 h-4 bg-ink/5 border-ink/15 rounded accent-primary cursor-pointer"
                  />
                  <label htmlFor="hostelPref" className="text-xs text-ink/80 cursor-pointer font-medium select-none">
                    Requires on-campus hostel facility
                  </label>
                </div>
              </div>

              <div className="p-6 rounded-3xl space-y-4 md:col-span-2"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.2)' }}>
                <h3 className="text-sm font-black text-ink uppercase tracking-wider flex items-center gap-2">
                  <Award className="w-4 h-4 text-yellow-400" /> Academic Eligibility (Validation Check)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase">10th Class Percentage</label>
                    <input
                      type="number"
                      placeholder="e.g. 92"
                      value={tenthScore}
                      onChange={(e) => setTenthScore(Number(e.target.value))}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                    {validationErrors.tenth && (
                      <p className="text-[10px] text-destructive font-medium">{validationErrors.tenth}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase">12th Class Percentage</label>
                    <input
                      type="number"
                      placeholder="e.g. 94"
                      value={twelfthScore}
                      onChange={(e) => setTwelfthScore(Number(e.target.value))}
                      className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                    />
                    {validationErrors.twelfth && (
                      <p className="text-[10px] text-destructive font-medium">{validationErrors.twelfth}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase block">Registered Entrance Exams</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                    {['JEE', 'BITSAT', 'NEET', 'CLAT', 'NATA', 'UCEED', 'SAT', 'CAT'].map((exam) => (
                      <label key={exam} className="flex items-center gap-2 text-xs text-ink/80 cursor-pointer hover:text-ink transition-all select-none">
                        <input
                          type="checkbox"
                          checked={entranceExams.includes(exam)}
                          onChange={() => handleCheckboxChange(exam)}
                          className="w-3.5 h-3.5 bg-ink/5 border-ink/15 rounded accent-primary cursor-pointer"
                        />
                        <span>{exam}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Advisory Career Goals & Brief Bio</label>
                  <textarea
                    rows={3}
                    placeholder="Write a brief statement about your ideal job or post-graduate dreams..."
                    value={careerGoals}
                    onChange={(e) => setCareerGoals(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none p-3 text-xs text-ink focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* PARENT FORM FIELDS */}
              <div className="p-6 rounded-3xl space-y-4"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.2)' }}>
                <h3 className="text-sm font-black text-ink uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-success" /> Budget & Logistics
                </h3>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase">Max Acceptable Budget (Annual)</label>
                    <span className="text-xs font-mono font-bold text-success">₹{parentBudget.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min="200000"
                    max="3000000"
                    step="50000"
                    value={parentBudget}
                    onChange={(e) => setParentBudget(Number(e.target.value))}
                    className="w-full h-1 bg-ink/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Preferred State or City</label>
                  <input
                    type="text"
                    placeholder="e.g. Maharashtra, Bangalore, Chennai"
                    value={preferredStateCity}
                    onChange={(e) => setPreferredStateCity(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Scholarship Dependency</label>
                  <select
                    value={scholarshipPreference}
                    onChange={(e) => setScholarshipPreference(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Yes" className="bg-surface">Highly Critical (Requires scholarships/financial aid)</option>
                    <option value="Preferred" className="bg-surface">Preferred (Helpful but not dealbreaker)</option>
                    <option value="No" className="bg-surface">No Dependency (Can fund full fees)</option>
                  </select>
                </div>
              </div>

              <div className="p-6 rounded-3xl space-y-4"
                style={{ background: '#1a150d', border: '1px solid rgba(8,6,4,0.2)' }}>
                <h3 className="text-sm font-black text-ink uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-4 h-4 text-accent-bright" /> Priorities & Accommodation
                </h3>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Campus Safety Preference</label>
                  <select
                    value={safetyPreference}
                    onChange={(e) => setSafetyPreference(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="High" className="bg-surface">Very High (Top focus on CCTV, gated campus, wardens)</option>
                    <option value="Medium" className="bg-surface">Standard safety regulations</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">ROI (Return on Investment) Priority</label>
                  <select
                    value={roiPreference}
                    onChange={(e) => setRoiPreference(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="High" className="bg-surface">Top Priority (High placements relative to fees)</option>
                    <option value="Medium" className="bg-surface">Moderate ROI acceptable</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase">Accommodation Preference</label>
                  <select
                    value={accommodationPreference}
                    onChange={(e) => setAccommodationPreference(e.target.value)}
                    className="w-full bg-ink/5 border border-ink/15 rounded-none px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Hostel" className="bg-surface">Verified On-Campus Hostel</option>
                    <option value="PG" className="bg-surface">Off-Campus PG / Rental</option>
                    <option value="DayScholar" className="bg-surface">Day Scholar (Local resident)</option>
                  </select>
                </div>
              </div>
            </>
          )}

        </div>

        {/* Form Submit Row */}
        <div className="flex justify-end pt-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-primary-deep text-primary-foreground font-semibold text-xs px-8 py-3.5 rounded-md cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Saving Guidelines...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4 text-white" />
                <span>Save and Update Advisory Guidelines</span>
              </>
            )}
          </motion.button>
        </div>
      </form>

      {onLogout && (
        <div
          className="mt-8 p-6 rounded-3xl border border-primary/15 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ background: 'rgba(239, 68, 68, 0.02)' }}
        >
          <div className="text-center sm:text-left">
            <h3 className="text-sm font-black text-destructive uppercase tracking-wider flex items-center justify-center sm:justify-start gap-2">
              <Shield className="w-4 h-4 text-destructive" /> Account Settings
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Terminate your active UniInfo session and clear cached academic recommendations.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onLogout}
            type="button"
            className="flex items-center gap-2 bg-primary/10 hover:bg-primary/15 text-destructive border border-primary/20 font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl cursor-pointer shadow-sm transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out from UniInfo</span>
          </motion.button>
        </div>
      )}
    </div>
  );
};
