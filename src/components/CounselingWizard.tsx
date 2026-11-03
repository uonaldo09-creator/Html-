import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Award,
  DollarSign,
  MapPin,
  Check,
  X,
  Sparkles,
  Sliders,
  HelpCircle,
  TrendingUp,
  UserCheck
} from 'lucide-react';
import { StudentProfile } from '../types';

interface CounselingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (profile: StudentProfile) => void;
  initialProfile?: StudentProfile;
}

const STREAMS = [
  { id: 'Science', name: 'Science & Engineering', desc: 'Engineering, Computing, Physics, Chemistry' },
  { id: 'Medical', name: 'Medical & Biotech', desc: 'Medicine, Biology, Genetic Sciences, Nursing' },
  { id: 'Commerce', name: 'Commerce & Management', desc: 'Business, Economics, Finance, Marketing' },
  { id: 'Arts', name: 'Arts & Humanities', desc: 'Literature, Psychology, Design, History' }
];

const DEGREES_BY_STREAM: Record<string, string[]> = {
  Science: ['B.Tech', 'M.Tech', 'B.Sc', 'M.Sc', 'Ph.D'],
  Medical: ['MBBS', 'B.Sc Biotech', 'B.Pharm', 'M.Sc Biotech', 'M.D.'],
  Commerce: ['BBA', 'MBA', 'B.Com', 'M.Com', 'Chartered Accountancy'],
  Arts: ['BA', 'MA', 'B.Des', 'M.Des', 'Ph.D']
};

const POPULAR_MAJORS: Record<string, string[]> = {
  Science: ['Computer Science', 'Artificial Intelligence', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Physics'],
  Medical: ['General Medicine', 'Biotechnology', 'Pharmacology', 'Bioinformatics', 'Microbiology'],
  Commerce: ['Finance', 'Marketing', 'Business Analytics', 'International Business', 'Investment Banking'],
  Arts: ['Clinical Psychology', 'Graphic Design', 'Economics', 'English Literature', 'Product Design']
};

export const CounselingWizard: React.FC<CounselingWizardProps> = ({
  isOpen,
  onClose,
  onComplete,
  initialProfile
}) => {
  // 1. Wizard step index (1-based)
  const [step, setStep] = useState(1);
  const totalSteps = 6;

  // 2. Local StudentProfile State initialized with defaults or initialProfile
  const [profile, setProfile] = useState<StudentProfile>(() => {
    return initialProfile || {
      stream: 'Science',
      budget: 500000,
      preferredLocation: '',
      preferredCourse: 'B.Tech',
      entranceExams: ['JEE'],
      hostelPreference: false,
      placementPriority: 'High',
      academicScores: {
        tenth: 85,
        twelfth: 85
      },
      careerGoals: '',
      examRanks: {
        JEE: '',
        BITSAT: '',
        NEET: '',
        MET: '',
        CLAT: ''
      }
    };
  });

  if (!isOpen) return null;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      // Final submission
      onComplete(profile);
      onClose();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const updateProfile = <K extends keyof StudentProfile>(key: K, value: StudentProfile[K]) => {
    setProfile(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleExamToggle = (exam: string) => {
    const currentExams = profile.entranceExams || [];
    if (currentExams.includes(exam)) {
      updateProfile('entranceExams', currentExams.filter(e => e !== exam));
    } else {
      updateProfile('entranceExams', [...currentExams, exam]);
    }
  };

  const updateExamRank = (exam: string, rank: string) => {
    const currentRanks = profile.examRanks || {};
    updateProfile('examRanks', {
      ...currentRanks,
      [exam]: rank
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-obsidian/70 backdrop-blur-md"
      />

      {/* Modal Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl z-10 flex flex-col max-h-[90vh]"
        style={{
          background: 'rgba(13, 13, 11, 0.98)',
          border: '1px solid rgba(8, 6, 4, 0.18)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)'
        }}
      >

        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display text-[19px] font-semibold text-ink leading-tight">Let&apos;s understand your future.</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">A private consultation — six questions, one clear picture</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-accent text-muted-foreground hover:text-ink transition-all cursor-pointer border-none bg-transparent"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-px bg-muted w-full relative shrink-0">
          <motion.div
            className="absolute left-0 top-0 bottom-0 bg-primary"
            initial={{ width: '0%' }}
            animate={{ width: `${(step / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Wizard Step Content - Scrollable */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* STEP 1: Stream & Course */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">01</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">What is your desired field of study?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Select your stream and specific degree level to align search targets.</p>
                  </div>

                  {/* Streams Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {STREAMS.map(streamItem => {
                      const isSelected = profile.stream === streamItem.id;
                      return (
                        <button
                          key={streamItem.id}
                          onClick={() => {
                            // Automatically update degree level when switching streams
                            const defaultDegree = DEGREES_BY_STREAM[streamItem.id][0];
                            setProfile(prev => ({
                              ...prev,
                              stream: streamItem.id,
                              preferredCourse: defaultDegree
                            }));
                          }}
                          className={`p-4 rounded-2xl text-left border transition-colors cursor-pointer flex flex-col ${
                            isSelected
                              ? 'bg-primary/10 border-primary/45'
                              : 'bg-muted/50 border-line hover:border-primary/35'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[14px] font-medium text-ink">{streamItem.name}</span>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                <Check className="w-2.5 h-2.5 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{streamItem.desc}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Degree Selector */}
                  <div className="space-y-2 pt-2">
                    <label className="meta-label block">Target degree program</label>
                    <div className="flex flex-wrap gap-2">
                      {DEGREES_BY_STREAM[profile.stream].map(degree => {
                        const isSelected = profile.preferredCourse === degree;
                        return (
                          <button
                            key={degree}
                            onClick={() => updateProfile('preferredCourse', degree)}
                            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/50 text-muted-foreground hover:bg-accent hover:text-ink'
                            }`}
                          >
                            {degree}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Branch / Major Preference */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">02</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">Which branch or specialization do you prefer?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Specify your target majors. Quick suggestions are provided based on your study stream.</p>
                  </div>

                  {/* Career Goal Text Input */}
                  <div className="space-y-2">
                    <label className="meta-label block">Specific branch or specialization</label>
                    <input
                      type="text"
                      placeholder="e.g. Computer Science, Artificial Intelligence, Business Analytics..."
                      value={profile.careerGoals} // temporarily using career goals or standard text
                      onChange={(e) => updateProfile('careerGoals', e.target.value)}
                      className="w-full bg-muted/60 border border-line rounded-md px-4 py-3 text-xs text-ink focus:outline-none focus:border-primary placeholder:text-muted-foreground/60"
                    />
                  </div>

                  {/* Recommendations suggestion chips */}
                  <div className="space-y-2 pt-2">
                    <label className="meta-label block">Recommended specializations</label>
                    <p className="text-[10px] text-muted-foreground/70 leading-none mb-2">Tap a suggestion to autofill your focus</p>
                    <div className="flex flex-wrap gap-2">
                      {POPULAR_MAJORS[profile.stream].map(major => (
                        <button
                          key={major}
                          onClick={() => updateProfile('careerGoals', major)}
                          className={`px-3 py-2 rounded-xl text-[12px] font-medium border transition-colors cursor-pointer ${
                            profile.careerGoals === major
                              ? 'bg-primary/15 border-primary/40 text-accent-bright'
                              : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-accent hover:text-ink'
                          }`}
                        >
                          {major}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Academic Profile */}
              {step === 3 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">03</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">What is your high-school academic profile?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Provide your percentages to verify board exam eligibility alignment.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                    {/* Tenth grade score */}
                    <div className="p-5 rounded-md bg-muted/50 border border-line space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-ink/90">10th grade score</span>
                        <span className="text-sm font-bold text-accent-bright">{profile.academicScores.tenth}%</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        step="1"
                        value={profile.academicScores.tenth}
                        onChange={(e) => updateProfile('academicScores', {
                          ...profile.academicScores,
                          tenth: Number(e.target.value)
                        })}
                        className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                      />
                      <p className="text-[10px] text-muted-foreground/80 leading-relaxed">Required for NIRF scoring alignment and eligibility thresholds.</p>
                    </div>

                    {/* Twelfth grade score */}
                    <div className="p-5 rounded-md bg-muted/50 border border-line space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-ink/90">12th grade score</span>
                        <span className="text-sm font-bold text-accent-bright">{profile.academicScores.twelfth}%</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        step="1"
                        value={profile.academicScores.twelfth}
                        onChange={(e) => updateProfile('academicScores', {
                          ...profile.academicScores,
                          twelfth: Number(e.target.value)
                        })}
                        className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                      />
                      <p className="text-[10px] text-muted-foreground/80 leading-relaxed">Direct threshold matching for highly competitive private streams.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Exam Scores & Ranks */}
              {step === 4 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">04</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">Which competitive entrance exams have you taken?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Specify your active entrance exams and optionally input scores/ranks to match cutoffs.</p>
                  </div>

                  {/* Exams List */}
                  <div className="space-y-3.5">
                    {['JEE', 'BITSAT', 'NEET', 'MET', 'CLAT'].map((exam) => {
                      const isChecked = profile.entranceExams.includes(exam);
                      return (
                        <div
                          key={exam}
                          className={`p-4 rounded-2xl border transition-all ${
                            isChecked ? 'bg-muted/60 border-primary/40' : 'bg-transparent border-line'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <label className="flex items-center gap-3 text-xs font-bold text-ink cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleExamToggle(exam)}
                                className="w-4 h-4 rounded bg-muted/60 border-line accent-primary cursor-pointer"
                              />
                              <span className="text-sm font-medium text-ink">{exam} exam</span>
                            </label>

                            {isChecked && (
                              <div className="flex items-center gap-2 max-w-[200px]">
                                <span className="text-[10px] font-medium text-muted-foreground shrink-0">Rank or score</span>
                                <input
                                  type="text"
                                  placeholder="e.g. 14500 or 290"
                                  value={profile.examRanks?.[exam] || ''}
                                  onChange={(e) => updateExamRank(exam, e.target.value)}
                                  className="w-full bg-surface border border-line rounded-md px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-primary text-right font-mono font-medium"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 5: Tuition Budget Plan */}
              {step === 5 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">05</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">What is your annual tuition budget range?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Specify financial parameters. We will map this to real college tuition models.</p>
                  </div>

                  <div className="p-6 rounded-3xl bg-surface/5 border border-white/5 space-y-5 pt-8">
                    <div className="flex justify-between items-baseline">
                      <span className="meta-label">Annual tuition limit</span>
                      <span className="font-display text-lg font-semibold text-accent-bright font-mono">₹{profile.budget.toLocaleString()}/year</span>
                    </div>

                    <input
                      type="range"
                      min="50000"
                      max="2000000"
                      step="50000"
                      value={profile.budget}
                      onChange={(e) => updateProfile('budget', Number(e.target.value))}
                      className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                    />

                    {/* Scale markers description */}
                    <div className="grid grid-cols-3 text-[10px] font-medium text-muted-foreground/70 pt-1">
                      <span>₹50,000</span>
                      <span className="text-center">₹1,000,000</span>
                      <span className="text-right">₹2,000,000+</span>
                    </div>

                    {/* Dynamic Advisory Guidance */}
                    <div className="p-4 rounded-md bg-obsidian/70 border border-line flex gap-3 text-[11px] leading-relaxed text-ink/80">
                      <TrendingUp className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        {profile.budget < 250000 && (
                          <span><strong>Budget Insights:</strong> Highly compatible with top-tier Govt state engineering/commerce departments and highly-subsidized universities.</span>
                        )}
                        {profile.budget >= 250000 && profile.budget < 700000 && (
                          <span><strong>Budget Insights:</strong> Aligned with core premium private setups (like UPES or SNU) and competitive autonomous board-affiliated branches.</span>
                        )}
                        {profile.budget >= 700000 && (
                          <span><strong>Budget Insights:</strong> Elite range. Supports flexible options at elite international private campuses, fully featured hostel quarters, and medical streams.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 6: Lifestyle & Final Summary */}
              {step === 6 && (
                <div className="space-y-5">
                  <div className="text-center md:text-left">
                    <span className="font-display text-[15px] text-primary">06</span><span className="meta-label ml-2">of 6</span>
                    <h3 className="font-display text-[22px] font-semibold text-ink mt-2.5">Lifestyle choices and placement goals</h3>
                    <p className="text-xs text-muted-foreground mt-1">Specify accommodation and priorities before finalizing recommendations.</p>
                  </div>

                  <div className="space-y-4">
                    {/* Location Preference */}
                    <div className="space-y-1">
                      <label className="meta-label block">Preferred location or state</label>
                      <input
                        type="text"
                        placeholder="e.g. Karnataka, Maharashtra, Delhi NCR, or 'Anywhere'"
                        value={profile.preferredLocation}
                        onChange={(e) => updateProfile('preferredLocation', e.target.value)}
                        className="w-full bg-muted/60 border border-line rounded-md px-4 py-3 text-xs text-ink focus:outline-none focus:border-primary placeholder:text-muted-foreground/60"
                      />
                    </div>

                    {/* Placement Priority dropdown */}
                    <div className="space-y-1">
                      <label className="meta-label block">Placement package priority</label>
                      <select
                        value={profile.placementPriority}
                        onChange={(e) => updateProfile('placementPriority', e.target.value)}
                        className="w-full bg-muted/60 border border-line rounded-md px-4 py-3 text-xs text-ink focus:outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="High" className="bg-surface">High priority — elite package is the main target</option>
                        <option value="Medium" className="bg-surface">Medium priority — balanced research and entrepreneurship</option>
                        <option value="Low" className="bg-surface">Low priority — focus on academics or post-graduation</option>
                      </select>
                    </div>

                    {/* Hostel Facility Pref toggle */}
                    <div className="p-4 rounded-md bg-muted/50 border border-line flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs font-medium text-ink">Hostel accommodation needed</label>
                        <p className="text-[10px] text-muted-foreground leading-none">Filter to institutions with verified hostels</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateProfile('hostelPreference', !profile.hostelPreference)}
                        className={`w-11 h-6 rounded-full transition-all flex items-center p-0.5 cursor-pointer ${
                          profile.hostelPreference ? 'bg-primary justify-end' : 'bg-muted justify-start'
                        }`}
                      >
                        <motion.div
                          layout
                          className="w-5 h-5 rounded-full bg-surface shadow-sm"
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Profile Ready Notice */}
                  <div className="p-4 rounded-md bg-primary/10 border border-primary/25 flex gap-3 text-xs text-ink/80">
                    <UserCheck className="w-4 h-4 text-accent-bright shrink-0 mt-0.5" />
                    <div>
                      <strong>Advisory profile complete:</strong> ready to compute matching alignment across verified campuses. Hit <strong>Generate Matching</strong> to save.
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-line flex items-center justify-between relative z-10 bg-obsidian/70 shrink-0">
          <button
            onClick={handleBack}
            disabled={step === 1}
            className={`flex items-center gap-1 text-[13px] font-semibold px-4 py-2.5 rounded-xl border-none bg-transparent transition-colors cursor-pointer ${
              step === 1 ? 'text-muted-foreground/40 cursor-not-allowed' : 'text-muted-foreground hover:bg-accent hover:text-ink'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 text-[13px] font-semibold px-6 py-3 rounded-md cursor-pointer text-primary-foreground bg-primary hover:bg-primary-deep transition-colors border-none shadow-[0_12px_28px_-14px_rgba(8,6,4,0.35)]"
          >
            <span>{step === totalSteps ? 'Generate Matching' : 'Next Step'}</span>
            {step < totalSteps && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
