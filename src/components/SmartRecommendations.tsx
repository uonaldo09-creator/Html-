import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowRight, Check, AlertCircle, Bookmark, BookmarkCheck, Heart, ThumbsUp, ThumbsDown } from 'lucide-react';
import { University } from '../types';
import { customFetch as fetch } from '../lib/api';

interface SmartRecommendationsProps {
  onToggleComparison: (id: number) => void;
  selectedForComparison: number[];
  onViewDetails: (id: number) => void;
  universities: University[];
  isGuest?: boolean;
}

export const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({
  onToggleComparison,
  selectedForComparison,
  onViewDetails,
  universities,
  isGuest = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchRecommendations = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      // The scoring engine resolves the caller from the HttpOnly session cookie.
      const res = await fetch('/api/recommendations');
      const data = await res.json();
      if (data.status === 'success') {
        setRecommendations(data.recommendations || []);
      } else {
        setErrorMsg(data.error || 'Failed to fetch recommendations.');
      }
    } catch (err) {
      setErrorMsg('Failed to run scoring engine. Fill in your profile details to unlock personal recommendations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-ink/50 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-xs font-medium text-muted-foreground">Computing match scores from the verified catalog…</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-6 rounded-3xl text-center bg-surface border border-line max-w-xl mx-auto space-y-3">
        <AlertCircle className="w-8 h-8 text-muted-foreground/60 mx-auto" />
        <h4 className="text-sm font-bold text-ink">Advisory Preferences Needed</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Please complete your customized advisory profile preferences so that the recommendation engine can calculate match scores, pros/cons, and eligibility metrics!
        </p>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground/70 text-xs">
        {isGuest
          ? 'Sign in and complete your counseling profile to see personalized campus matches.'
          : 'No active recommendations matching your profile yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {recommendations.slice(0, 4).map((rec) => {
          // Find the corresponding static university object
          const uni = universities.find(u => u.id === rec.id);
          if (!uni) return null;

          return (
            <motion.div
              key={rec.id}
              whileHover={{ y: -4 }}
              className="p-6 rounded-3xl relative overflow-hidden transition-all flex flex-col justify-between card-premium"
              style={{
                background: 'rgba(22, 23, 31, 0.92)',
              }}
            >
              <div>
                {/* Upper line: Match percentage badge */}
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div>
                    <h3 className="font-display text-[19px] font-semibold text-ink line-clamp-1">{rec.name}</h3>
                    <p className="text-xs text-muted-foreground font-medium">{uni.location}, {uni.state}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide flex items-center gap-1.5 ${
                      rec.matchPercentage >= 85
                        ? 'bg-primary/15 text-accent-bright border border-primary/30'
                        : rec.matchPercentage >= 65
                        ? 'bg-muted text-muted-foreground border border-line'
                        : 'bg-oxblood/30 text-red-300 border border-oxblood/50'
                    }`}>
                      <span>{rec.matchPercentage}%</span>
                      <span className="text-[9px]">Match</span>
                    </div>
                    <span className="text-[9px] text-muted-foreground/70 font-semibold mt-1">NIRF #{uni.nirfRank || 150}</span>
                  </div>
                </div>

                {/* Score Reasons Explanation */}
                <p className="text-xs text-ink/75 leading-relaxed mb-4 bg-muted/60 p-3 rounded-2xl border border-line italic">
                  "{rec.reasons}"
                </p>

                {/* Pros and Cons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 pt-1">
                  <div>
                    <span className="text-[10px] font-semibold text-success flex items-center gap-1 mb-2">
                      <ThumbsUp className="w-3 h-3" /> Key advantages
                    </span>
                    <ul className="space-y-1.5">
                      {rec.pros.map((pro: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-1.5 text-[11px] text-ink/75 leading-normal">
                          <Check className="w-3 h-3 text-success shrink-0 mt-0.5" />
                          <span>{pro}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    {rec.cons.length > 0 && (
                      <>
                        <span className="text-[10px] font-semibold text-destructive flex items-center gap-1 mb-2">
                          <ThumbsDown className="w-3 h-3" /> Hurdles to weigh
                        </span>
                        <ul className="space-y-1.5">
                          {rec.cons.map((con: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-1.5 text-[11px] text-ink/75 leading-normal">
                              <AlertCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                              <span>{con}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer actions */}
              <div className="border-t border-line pt-4 mt-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-medium">Similar:</span>
                  <div className="flex flex-wrap gap-1">
                    {rec.similarUniversities.map((sim: string, idx: number) => (
                      <span key={idx} className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-line">
                        {sim}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleComparison(uni.id)}
                    className={`p-2 rounded-xl border transition-all cursor-pointer ${
                      selectedForComparison.includes(uni.id)
                        ? 'bg-primary/12 border-primary/30 text-accent-bright'
                        : 'bg-muted border-line text-muted-foreground hover:text-ink'
                    }`}
                    title="Toggle Comparison"
                  >
                    <Heart className={`w-3.5 h-3.5 ${selectedForComparison.includes(uni.id) ? 'fill-accent-bright' : ''}`} />
                  </button>

                  <button
                    onClick={() => onViewDetails(uni.id)}
                    className="flex items-center gap-1 bg-ink/5 hover:bg-ink/10 text-ink font-medium text-[10px] px-3 py-2 rounded-md cursor-pointer transition-all border border-line"
                  >
                    <span>View details</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
