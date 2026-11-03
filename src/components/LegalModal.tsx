import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldCheck, FileText, Mail, Send, AlertCircle, Phone, MapPin, Globe } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'privacy' | 'terms' | 'contact';
}

export const LegalModal: React.FC<LegalModalProps> = ({ isOpen, onClose, initialTab = 'privacy' }) => {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms' | 'contact'>(initialTab);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copyEmailError, setCopyEmailError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeDialog = React.useCallback(() => onClose(), [onClose]);

  useDialogFocus(isOpen, dialogRef, closeButtonRef, closeDialog);

  // Form State for Contact Us
  const [formData, setFormData] = useState({ name: '', email: '', subject: 'admissions', message: '' });
  const [formStatus, setFormStatus] = useState<'idle' | 'draft' | 'error'>('idle');
  const [draftUrl, setDraftUrl] = useState('');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setFormStatus('idle');
      setDraftUrl('');
      setFormData({ name: '', email: '', subject: 'admissions', message: '' });
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleCopyEmail = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser context.');
      }
      await navigator.clipboard.writeText('support@uniinfo.edu.in');
      setCopiedEmail(true);
      setCopyEmailError(false);
      window.setTimeout(() => setCopiedEmail(false), 2000);
    } catch (error) {
      console.error('Unable to copy the support email address.', error);
      setCopiedEmail(false);
      setCopyEmailError(true);
    }
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    const email = formData.email.trim();
    const message = formData.message.trim();
    if (!name || !email || !message) {
      setFormStatus('error');
      return;
    }

    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Inquiry area: ${formData.subject}`,
      '',
      message,
    ].join('\n');
    setDraftUrl(
      `mailto:support@uniinfo.edu.in?subject=${encodeURIComponent(`UniInfo inquiry: ${formData.subject}`)}&body=${encodeURIComponent(body)}`
    );
    setFormStatus('draft');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        initial={{ scale: 0.95, y: 25 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl rounded-4xl overflow-hidden flex flex-col my-8 h-[85vh] max-h-187.5"
        style={{
          background: 'linear-gradient(170deg, #090919 0%, #060612 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 50px 120px -20px rgba(0,0,0,0.85)',
        }}
      >
        {/* Header with Navigation Link Tabs */}
        <div
          className="px-8 pt-6 pb-2 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
              style={{
                background: activeTab === 'privacy'
                  ? '#c9a35c'
                  : activeTab === 'terms'
                  ? '#2c2a22'
                  : '#2c2a22',
              }}
            >
              {activeTab === 'privacy' && <ShieldCheck className="w-5 h-5 text-white" />}
              {activeTab === 'terms' && <FileText className="w-5 h-5 text-white" />}
              {activeTab === 'contact' && <Mail className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h3 id="legal-modal-title" className="text-lg font-black text-white tracking-tight">
                {activeTab === 'privacy' && 'Privacy Policy'}
                {activeTab === 'terms' && 'Terms of Service'}
                {activeTab === 'contact' && 'Contact Support & Inquiry'}
              </h3>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">UniInfo Registry of Private Colleges</p>
            </div>
          </div>

          {/* Navigation Controller */}
          <div className="flex p-1 rounded-xl bg-surface/5 border border-white/5 shrink-0 self-start md:self-auto">
            {(['privacy', 'terms', 'contact'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider relative cursor-pointer ${
                  activeTab === tab ? 'text-white' : 'text-muted-foreground hover:text-white'
                }`}
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="legalTabActive"
                    className="absolute inset-0 rounded-lg -z-10"
                    style={{
                      background: tab === 'privacy'
                        ? 'rgba(16,185,129,0.2)'
                        : tab === 'terms'
                        ? 'rgba(124,58,237,0.2)'
                        : 'rgba(59,130,246,0.2)',
                      border: tab === 'privacy'
                        ? '1px solid rgba(16,185,129,0.3)'
                        : tab === 'terms'
                        ? '1px solid rgba(124,58,237,0.3)'
                        : '1px solid rgba(59,130,246,0.4)',
                    }}
                  />
                )}
                {tab === 'privacy' ? 'Privacy' : tab === 'terms' ? 'Terms' : 'Contact'}
              </button>
            ))}
          </div>

          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close legal information"
            className="absolute right-6 top-6 p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-surface/5 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 text-muted-foreground/60 scrollbar-thin scrollbar-thumb-white/10">

          {/* ────── PRIVACY POLICY TAB ────── */}
          {activeTab === 'privacy' && (
            <div className="space-y-6 text-sm leading-relaxed font-normal">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-success mb-2">Effective June 2026</p>
                <h4 className="text-white font-extrabold text-base mb-2">1. Commitment to Student & Family Privacy</h4>
                <p>
                  At UniInfo, we hold your personal trust in highest regard. When you discover degree placements, analyze tuition ROI, or converse with our AI Counselor, your data remains fully protected. This policy outlines how your parameters are processed.
                </p>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">2. Data Ingestion & Purpose</h4>
                <p>We ingest user selections and academic profiles solely to run eligibility predictions and match scores:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1.5 text-muted-foreground">
                  <li><strong className="text-muted-foreground/50">Academic Profiles:</strong> Entrance percentages (10th/12th), JEE/CET scores, stream preferences, and financial budget variables.</li>
                  <li><strong className="text-muted-foreground/50">AI Counselor Interactions:</strong> Prompt inputs and questions regarding private colleges, sports budgets, placement statistics, or hostel facilities.</li>
                  <li><strong className="text-muted-foreground/50">Favorites & History:</strong> Localized persistent state tracking shortlisted institutions to generate custom recommendation portfolios.</li>
                </ul>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">3. Storage & local Persistence</h4>
                <p>
                  All catalog searches, filter states, and recently reviewed lists are cached in your local web platform storage space. Account login verification tokens are strictly checked via the secure backend session store. We do not sell, rent, or leak your details to random admission consultants or brokers.
                </p>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">4. Third-Party API Guardrails</h4>
                <p>
                  Our smart advisory conversation routing utilizes secure, server-side AI models. While generating answers, only contextual academic factors or question texts are sent to the API. No permanent user identifying attributes are indexed for telemetry.
                </p>
              </div>
            </div>
          )}

          {/* ────── TERMS OF SERVICE TAB ────── */}
          {activeTab === 'terms' && (
            <div className="space-y-6 text-sm leading-relaxed font-normal">
              <div>
                <p className="text-[12px] font-medium text-muted-foreground mb-2">Last updated: June 2026</p>
                <h4 className="text-white font-extrabold text-base mb-2">1. Engagement License & Use</h4>
                <p>
                  By accessing the UniInfo system as a visitor, parent, or student, you represent that you are accessing Indian educational registries in good faith to guide career discovery and enrollment planning.
                </p>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">2. Prohibited Interactions</h4>
                <p>To preserve secure performance benchmarks across our platform, you agree NOT to:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1.5 text-muted-foreground">
                  <li>Automate bots to scrape university datasets, placement reports, or fees matrix.</li>
                  <li>Inflict rapid payload floods on the AI Advisor counseling endpoints.</li>
                  <li>Submit misleading board percentages to force-manipulate the recommendation scoring math.</li>
                </ul>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">3. Academic Information Disclaimer</h4>
                <p>
                  UniInfo provides calculated placement ROI ratios, NAAC grade insights, NBA accreditations, and minimum criteria metrics for educational reference only. While we perform daily verification audits, fee modules and cutoff ranks may be adjusted by private institutional boards. Users are advised to cross-verify criteria with offtake guidelines prior to submitting application funds.
                </p>
              </div>

              <div>
                <h4 className="text-white font-extrabold text-base mb-2">4. Account Integrity</h4>
                <p>
                  You are responsible for securing individual login parameters and verifying state configurations. Credentials must not be shared with corporate admission brokers.
                </p>
              </div>
            </div>
          )}

          {/* ────── CONTACT US TAB ────── */}
          {activeTab === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
              {/* Form Side */}
              <div className="md:col-span-3 space-y-4">
                <h4 className="text-white font-extrabold text-base">Send Us a Secure Message</h4>

                {formStatus === 'draft' ? (
                  <motion.div
                    role="status"
                    aria-live="polite"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-6 rounded-2xl bg-success/10 border border-success/30 text-center space-y-3"
                  >
                    <Mail className="w-10 h-10 text-success mx-auto" />
                    <p className="text-sm font-bold text-white">Your email draft is ready</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your message has not been sent. Open it in your email app and send it to contact UniInfo support.
                    </p>
                    <a
                      href={draftUrl}
                      className="inline-flex px-4 py-2 mt-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-success hover:bg-success/85 text-white transition-colors"
                    >
                      Open email draft
                    </a>
                    <button
                      onClick={() => { setFormStatus('idle'); setDraftUrl(''); }}
                      className="px-4 py-2 mt-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-success hover:bg-success/85 text-white transition-colors cursor-pointer"
                    >
                      New Message
                    </button>
                  </motion.div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    {formStatus === 'error' && (
                      <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Please fill in all standard field inputs.
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="contact-name" className="block text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1.5">Full Name</label>
                        <input
                          id="contact-name"
                          type="text"
                          required
                          value={formData.name}
                          onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                          placeholder="Rohit Sharma"
                          autoComplete="name"
                          className="w-full text-xs h-10 px-3.5 rounded-xl text-white outline-none focus:ring-1 focus:ring-primary transition-all border border-white/5 bg-surface/5"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-email" className="block text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1.5">Email Address</label>
                        <input
                          id="contact-email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                          placeholder="rohit@gmail.com"
                          autoComplete="email"
                          className="w-full text-xs h-10 px-3.5 rounded-xl text-white outline-none focus:ring-1 focus:ring-primary transition-all border border-white/5 bg-surface/5"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="contact-subject" className="block text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1.5">Department / Inquiry Area</label>
                      <select
                        id="contact-subject"
                        value={formData.subject}
                        onChange={e => setFormData(p => ({ ...p, subject: e.target.value }))}
                        className="w-full text-xs h-10 px-3 rounded-xl text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary transition-all border border-white/5 bg-surface/5"
                      >
                        <option value="admissions" className="bg-surface">University Admissions Guidance</option>
                        <option value="ai" className="bg-surface">AI Counselor Feedback</option>
                        <option value="data" className="bg-surface">Accreditation/Placement Correction</option>
                        <option value="general" className="bg-surface">General Platforms Help</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="contact-message" className="block text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1.5">Your Message / Case details</label>
                      <textarea
                        id="contact-message"
                        required
                        value={formData.message}
                        onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                        rows={4}
                        placeholder="Please elaborate on your branch interests, exam score guidelines or any other queries..."
                        className="w-full text-xs p-3.5 rounded-xl text-white outline-none focus:ring-1 focus:ring-primary transition-all border border-white/5 bg-surface/5 resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-500/15"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Prepare email draft
                    </button>
                  </form>
                )}
              </div>

              {/* Info Side */}
              <div className="md:col-span-2 space-y-6">
                <div>
                  <h4 className="text-white font-extrabold text-base mb-3">Direct Contact Info</h4>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 text-xs text-muted-foreground">
                      <Phone className="w-4 h-4 text-accent-bright shrink-0 mt-0.5" />
                      <div>
                        <p className="font-extrabold text-muted-foreground/50">Admission Desk Helpline</p>
                        <p className="mt-0.5">+91 1800-419-3000</p>
                        <p className="text-[10px] text-muted-foreground font-medium">Mon - Sat (9:00 AM - 6:00 PM)</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 text-xs text-muted-foreground">
                      <Mail className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      <div>
                        <p className="font-extrabold text-muted-foreground/50">Official Communication Desk</p>
                        <button
                          onClick={handleCopyEmail}
                          className="mt-1 flex items-center gap-1.5 text-accent-bright hover:text-accent-bright/80 transition-colors cursor-pointer text-left rounded focus:outline-none"
                        >
                          support@uniinfo.edu.in
                          <span aria-live="polite" className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-surface/5">
                            {copiedEmail ? 'Copied!' : copyEmailError ? 'Copy failed' : 'Copy'}
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 text-xs text-muted-foreground">
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="font-extrabold text-muted-foreground/50">Main Office location</p>
                        <p className="mt-0.5">Edu Tech Enclave, Phase 3, Bandra Kurla Complex</p>
                        <p className="text-muted-foreground">Mumbai, Maharashtra - 400051</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface/5 border border-white/5 text-xs text-muted-foreground space-y-2">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-accent-bright" />
                    Verified Institution Registry
                  </p>
                  <p className="leading-relaxed">
                    UniInfo is an academic catalog directory database assisting in matching student requirements. No direct commission stands is maintained.
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div
          className="px-8 py-4 bg-surface/[0.02] shrink-0 flex items-center justify-between text-xs text-muted-foreground font-bold uppercase tracking-wider"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span>UniInfo Academic Portal 2026</span>
          <span className="text-[9px] font-black text-muted-foreground tracking-widest">S.S.D.N</span>
        </div>
      </motion.div>
    </motion.div>
  );
};
