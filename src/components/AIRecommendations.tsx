import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, BrainCircuit } from 'lucide-react';
import { universities } from '../data';
import { UniversityCard } from './UniversityCard';
import { customFetch as fetch } from '../lib/api';

interface AIRecommendationsProps {
  filters: any;
  search: string;
  onToggleComparison: (id: number) => void;
  selectedForComparison: number[];
  onViewDetails: (id: number) => void;
}

export const AIRecommendations: React.FC<AIRecommendationsProps> = ({
  filters,
  search,
  onToggleComparison,
  selectedForComparison,
  onViewDetails
}) => {
  const [recommendations, setRecommendations] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reasoning, setReasoning] = useState('');

  const generateRecommendations = async () => {
    // Only generate if there's some intent (search or filters)
    const hasIntent = search || Object.values(filters).some(v =>
      Array.isArray(v) ? v.length > 0 : (v !== '' && v !== false)
    );

    if (!hasIntent) {
      setRecommendations([]);
      setReasoning('');
      return;
    }

    setIsLoading(true);
    try {
      const simplifiedUnis = universities.map(u => ({
        id: u.id,
        name: u.name,
        fee: u.fee,
        location: u.location
      }));

      const systemPrompt = `You are an expert advisor. Respond with ONLY JSON:
{
  "recommendedIds": [number, number, number],
  "reasoning": "1-sentence explanation of academic fit and placement potential"
}
Rules:
- Pick exactly 3 IDs from the list
- No markdown, code blocks, or extra text`;

      const userPrompt = `Pick 3 matching private universities.
Search: "${search}"
Filters: ${JSON.stringify(filters)}
Unis: ${JSON.stringify(simplifiedUnis)}`;

      // 🔒 Call secure backend route
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }, // 🎯 Forces JSON output
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const apiData = await response.json();
      const text = apiData.choices?.[0]?.message?.content;

      if (text) {
        try {
          const data = JSON.parse(text);
          setRecommendations(data.recommendedIds || []);
          setReasoning(data.reasoning || '');
        } catch (parseError) {
          console.error('Failed to parse AI response:', text);
          // Fallback: try to extract JSON from the response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const data = JSON.parse(jsonMatch[0]);
              setRecommendations(data.recommendedIds || []);
              setReasoning(data.reasoning || '');
            } catch {
              setRecommendations([]);
              setReasoning('');
            }
          }
        }
      }
    } catch (error) {
      console.error('AI Recommendations Error:', error);
      setRecommendations([]);
      setReasoning('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      generateRecommendations();
    }, 1000); // Debounce
    return () => clearTimeout(timer);
  }, [filters, search]);

  if (recommendations.length === 0 && !isLoading) return null;

  return (
    <section className="mb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-surface border border-line rounded-[20px] flex items-center justify-center shadow-[0_18px_40px_-28px_rgba(8,6,4,0.3)]">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-2xl font-semibold text-ink tracking-tight leading-none">Tailored recommendations</h3>
            <p className="text-xs text-muted-foreground mt-1.5">Institution suggestions matched to your parameters</p>
          </div>
        </div>
        {isLoading && (
          <div className="flex items-center gap-3 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-[13px] font-semibold border border-primary/15">
            <Loader2 className="w-4 h-4 animate-spin" />
            Analyzing Data...
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"
          >
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[450px] bg-surface border border-line rounded-[32px] animate-pulse" />
            ))}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            {reasoning && (
              <div className="space-y-4">
                <motion.div
                  initial={{ rotateX: 20, opacity: 0 }}
                  animate={{ rotateX: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 15 }}
                  className="bg-surface border border-line p-6 rounded-[32px] flex items-start gap-4"
                >
                  <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shrink-0">
                    <BrainCircuit className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-primary mb-1 block">AI consultant recommendation</span>
                    <p className="text-sm font-semibold text-ink leading-relaxed italic">
                      "{reasoning}"
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {universities
                .filter(u => recommendations.includes(u.id))
                .map(uni => (
                  <UniversityCard
                    key={uni.id}
                    university={uni}
                    isSelected={selectedForComparison.includes(uni.id)}
                    onToggleSelection={onToggleComparison}
                    onViewDetails={() => onViewDetails(uni.id)}
                  />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
