import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, IndianRupee, Briefcase, Award, CheckCircle2, Phone, BookOpen, GitCompare } from 'lucide-react';
import { University } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface ComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUniversities: University[];
  onRemove: (id: number) => void;
}

export const ComparisonModal: React.FC<ComparisonModalProps> = ({ isOpen, onClose, selectedUniversities, onRemove }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useDialogFocus(isOpen, dialogRef, closeButtonRef, onClose);

  const bestValues = React.useMemo(() => {
    if (selectedUniversities.length < 2) return null;

    const naacWeights: Record<string, number> = {
      'A++': 7, 'A+': 6, 'A': 5, 'B++': 4, 'B+': 3, 'B': 2, 'C': 1
    };
    const bestOf = (values: number[], direction: 'min' | 'max') => {
      const reported = values.filter((value) => value > 0);
      if (reported.length === 0) return null;
      return direction === 'min' ? Math.min(...reported) : Math.max(...reported);
    };
    return {
      rating: bestOf(selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? 0 : u.rating), 'max'),
      fee: bestOf(selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? 0 : u.fee), 'min'),
      placement: bestOf(selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? 0 : u.avgPlacementLPA), 'max'),
      nirf: bestOf(selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? 0 : u.nirfRank), 'min'),
      naac: bestOf(selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? 0 : naacWeights[u.naacGrade] || 0), 'max')
    };
  }, [selectedUniversities]);

  const BestBadge = () => (
    <span className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-semibold tracking-[0.08em] rounded-full shadow-lg z-10">
      LEADING
    </span>
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-obsidian/60 backdrop-blur-sm"
        />

        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="comparison-title"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-6xl bg-surface rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 bg-charcoal border-b border-line flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center">
                <GitCompare className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h2 id="comparison-title" className="font-display text-lg font-semibold tracking-tight leading-none text-ink">The comparison sheet</h2>
                <p className="text-[11px] text-muted-foreground mt-1.5">A quiet side-by-side of what actually matters</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                ref={closeButtonRef}
                onClick={onClose}
                aria-label="Close comparison"
                className="p-2 rounded-full hover:bg-ink/5 transition-colors cursor-pointer border-none bg-transparent"
              >
                <X className="w-5 h-5 text-muted-foreground/80" />
              </button>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="flex-1 overflow-x-auto p-6 bg-surface">
            {selectedUniversities.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-20">
                <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4 text-muted-foreground">
                  <Award className="w-8 h-8" />
                </div>
                <h3 className="font-display text-xl font-semibold text-ink mb-2">Nothing to compare yet</h3>
                <p className="text-muted-foreground max-w-xs">Select at least two universities to build a comparison sheet.</p>
              </div>
            ) : (
              <table className="w-full border-collapse min-w-[800px]">
                <thead>
                  <tr>
                    <th className="p-4 text-left bg-surface border-b border-line rounded-tl-md w-48">
                      <span className="meta-label">Metric</span>
                    </th>
                    {selectedUniversities.map((uni) => (
                      <th key={uni.id} className="p-4 text-center bg-surface border-b border-line relative group min-w-[200px]">
                        <button
                          onClick={() => onRemove(uni.id)}
                          aria-label={`Remove ${uni.name} from comparison`}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="flex flex-col items-center gap-3">
                          <img src={uni.image} alt={uni.name} className="w-16 h-16 rounded-xl object-cover shadow-sm" />
                          <span className="font-display text-[15px] font-semibold text-ink line-clamp-2">{uni.name}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-surface">
                  {/* Rating */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-bronze" />
                        Rating
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => {
                      const reported = !uni.directoryProfile?.directoryOnly && uni.rating > 0;
                      const isBest = reported && bestValues?.rating !== null && bestValues?.rating === uni.rating;
                      return (
                        <td key={uni.id} className={`p-4 text-center relative ${isBest ? 'bg-primary/8' : ''}`}>
                          {isBest && <BestBadge />}
                          <div className="space-y-2">
                            <div className={`flex items-center justify-center gap-1 font-semibold ${isBest ? 'text-accent-bright' : 'text-ink'}`}>
                              {reported ? uni.rating : 'Not reported'}
                              {reported && <Star className={`w-3 h-3 fill-current ${isBest ? 'text-primary' : 'text-bronze'}`} />}
                            </div>
                            {reported && <div className="h-px w-full bg-muted rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(uni.rating / 5) * 100}%` }}
                                className={`h-full ${isBest ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                              />
                            </div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {/* Fee */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <IndianRupee className="w-4 h-4 text-primary" />
                        Annual fee
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => {
                      const directoryOnly = !!uni.directoryProfile?.directoryOnly;
                      const reported = !directoryOnly && uni.fee > 0;
                      const isBest = reported && bestValues?.fee !== null && bestValues?.fee === uni.fee;
                      return (
                        <td key={uni.id} className={`p-4 text-center relative ${isBest ? 'bg-primary/8' : ''}`}>
                          {isBest && <BestBadge />}
                          <div className="space-y-2">
                            <span className={`font-semibold ${isBest ? 'text-accent-bright' : 'text-ink'}`}>
                              {directoryOnly
                                ? uni.directoryProfile?.feeRange || 'Not reported'
                                : reported ? `₹${(uni.fee / 100000).toFixed(1)} Lakh` : 'Not reported'}
                            </span>
                            {reported && <div className="h-px w-full bg-muted rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(uni.fee / 1000000) * 100}%` }}
                                className={`h-full ${isBest ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                              />
                            </div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {/* Placement */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-primary" />
                        Average package
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => {
                      const reported = !uni.directoryProfile?.directoryOnly && uni.avgPlacementLPA > 0;
                      const isBest = reported && bestValues?.placement !== null && bestValues?.placement === uni.avgPlacementLPA;
                      return (
                        <td key={uni.id} className={`p-4 text-center relative ${isBest ? 'bg-primary/8' : ''}`}>
                          {isBest && <BestBadge />}
                          <div className="space-y-2">
                            <span className={`font-semibold ${isBest ? 'text-accent-bright' : 'text-ink'}`}>
                              {reported ? `${uni.avgPlacementLPA} LPA` : 'Not reported'}
                            </span>
                            {reported && <div className="h-px w-full bg-muted rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(uni.avgPlacementLPA / 15) * 100}%` }}
                                className={`h-full ${isBest ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                              />
                            </div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {/* NIRF Rank */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-primary" />
                        NIRF rank
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => {
                      const reported = !uni.directoryProfile?.directoryOnly && uni.nirfRank > 0;
                      const isBest = reported && bestValues?.nirf !== null && bestValues?.nirf === uni.nirfRank;
                      return (
                        <td key={uni.id} className={`p-4 text-center relative ${isBest ? 'bg-primary/8' : ''}`}>
                          {isBest && <BestBadge />}
                          <span className={`font-semibold ${isBest ? 'text-accent-bright' : 'text-ink/70'}`}>
                            {uni.directoryProfile?.directoryOnly
                              ? uni.directoryProfile.rankings
                              : reported ? `#${uni.nirfRank}` : 'Not reported'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  {/* NAAC Grade */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-success" />
                        NAAC grade
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => {
                      const naacWeights: Record<string, number> = {
                        'A++': 7, 'A+': 6, 'A': 5, 'B++': 4, 'B+': 3, 'B': 2, 'C': 1
                      };
                      const reported = !uni.directoryProfile?.directoryOnly && !!naacWeights[uni.naacGrade];
                      const isBest = reported && bestValues?.naac !== null && bestValues?.naac === naacWeights[uni.naacGrade];
                      return (
                        <td key={uni.id} className={`p-4 text-center relative ${isBest ? 'bg-primary/8' : ''}`}>
                          {isBest && <BestBadge />}
                          <span className={`px-3 py-1 rounded-md font-semibold text-sm ${isBest ? 'bg-primary/20 text-accent-bright' : 'bg-primary/10 text-primary'}`}>
                            {uni.directoryProfile?.directoryOnly
                              ? uni.directoryProfile.accreditation
                              : reported ? uni.naacGrade : 'Not reported'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  {/* Contact Info */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-primary" />
                        Contact
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => (
                      <td key={uni.id} className="p-4 text-center">
                        <span className="text-sm font-medium text-ink/75">{uni.phone}</span>
                      </td>
                    ))}
                  </tr>
                  {/* Competitive Exams */}
                  <tr className="border-b border-line">
                    <td className="p-4 font-medium text-ink/70 bg-muted/60">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-primary" />
                        Exams accepted
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => (
                      <td key={uni.id} className="p-4 text-center">
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {uni.competitiveExams.map((exam, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-medium">
                              {exam}
                            </span>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                  {/* Accreditations */}
                  <tr>
                    <td className="p-4 font-medium text-ink/70 bg-muted/60 rounded-bl-md">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        Accreditations
                      </div>
                    </td>
                    {selectedUniversities.map((uni) => (
                      <td key={uni.id} className="p-4 text-center">
                        <div className="flex flex-wrap justify-center gap-2">
                          {uni.aicteApproved ? (
                            <span className="text-[10px] font-black text-accent-foreground bg-accent px-2 py-1 rounded-md">AICTE</span>
                          ) : null}
                          {uni.nbaAccredited ? (
                            <span className="text-[10px] font-black text-accent-foreground bg-accent px-2 py-1 rounded-md">NBA</span>
                          ) : null}
                          {uni.nmcRecognized ? (
                            <span className="text-[10px] font-black text-accent-foreground bg-accent px-2 py-1 rounded-md">NMC</span>
                          ) : null}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 bg-surface border-t border-line flex justify-end gap-3 shrink-0">
            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="px-6 py-3 bg-muted text-muted-foreground font-medium text-xs rounded-md hover:bg-accent transition-all cursor-pointer"
            >
              Close
            </motion.button>
            {selectedUniversities.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  const headers = ['Metric', ...selectedUniversities.map(u => u.name)];
                  const rows = [
                    ['Rating', ...selectedUniversities.map(u => u.rating)],
                    ['Annual Fee', ...selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? u.directoryProfile.feeRange : u.fee > 0 ? `₹${(u.fee / 100000).toFixed(1)} Lakh` : 'Not reported')],
                    ['Avg Placement', ...selectedUniversities.map(u => !u.directoryProfile?.directoryOnly && u.avgPlacementLPA > 0 ? `${u.avgPlacementLPA} LPA` : 'Not reported')],
                    ['NIRF Rank', ...selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? u.directoryProfile.rankings : u.nirfRank > 0 ? `#${u.nirfRank}` : 'Not reported')],
                    ['NAAC Grade', ...selectedUniversities.map(u => u.directoryProfile?.directoryOnly ? u.directoryProfile.accreditation : u.naacGrade || 'Not reported')],
                    ['Contact', ...selectedUniversities.map(u => u.phone)],
                    ['Exams', ...selectedUniversities.map(u => u.competitiveExams.join(', '))],
                  ];

                  const csvContent = [
                    headers.join(','),
                    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
                  ].join('\n');

                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const link = document.createElement('a');
                  const url = URL.createObjectURL(blob);
                  link.setAttribute('href', url);
                  link.setAttribute('download', `university_comparison_${new Date().getTime()}.csv`);
                  link.style.visibility = 'hidden';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="px-6 py-3 bg-primary text-primary-foreground font-semibold text-[13px] rounded-xl shadow-lg hover:shadow-primary/20 transition-all cursor-pointer"
              >
                Export Comparison Data
              </motion.button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
