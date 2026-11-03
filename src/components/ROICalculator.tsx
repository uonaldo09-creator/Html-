import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, Calculator, Info } from 'lucide-react';

interface Props {
  onClose: () => void;
  defaultFee?: number;
  defaultLPA?: number;
  universityName?: string;
}

export const ROICalculator: React.FC<Props> = ({
  onClose,
  defaultFee = 500000,
  defaultLPA = 8,
  universityName,
}) => {
  const [feeLakhs, setFeeLakhs] = useState(parseFloat((defaultFee / 100000).toFixed(1)));
  const [lpa, setLpa] = useState(defaultLPA);
  const [years, setYears] = useState(4);
  const [livingLakhs, setLivingLakhs] = useState(2);

  const totalCost = (feeLakhs + livingLakhs) * years * 100000;
  const yearlyIncome = lpa * 100000;
  const monthlyIncome = Math.round(yearlyIncome / 12 / 1000);
  const breakEven = totalCost / yearlyIncome;
  const roi5yr = ((yearlyIncome * 5 - totalCost) / totalCost) * 100;
  const roi10yr = ((yearlyIncome * 10 - totalCost) / totalCost) * 100;

  const verdict =
    breakEven <= 3 ? { text: 'Exceptional ROI — You recover investment extremely fast.', icon: '🔥', color: '#34d399' } :
    breakEven <= 5 ? { text: 'Solid Investment — Very good return within 5 years.', icon: '✅', color: '#34d399' } :
    breakEven <= 8 ? { text: 'Moderate ROI — Consider scholarships to improve returns.', icon: '⚠️', color: '#fbbf24' } :
    { text: 'High break-even — Look for higher-paying programs or fee waivers.', icon: '⚠️', color: '#f87171' };

  const Slider = ({ label, value, setter, min, max, step, display }: any) => (
    <div>
      <div className="flex justify-between items-center mb-2">
        <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</label>
        <span className="text-[13px] font-semibold text-primary">{display(value)}</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={e => setter(parseFloat(e.target.value))}
          className="w-full cursor-pointer appearance-none h-1.5 rounded-full outline-none"
          style={{
            background: `linear-gradient(to right, #c9a35c ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.12) 0%)`,
            accentColor: '#c9a35c',
          }}
        />
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 24 }}
        transition={{ type: 'spring', damping: 20, stiffness: 200 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-120 rounded-4xl overflow-hidden"
        style={{
          background: '#0a0a1a',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Calculator className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black text-white leading-none">ROI Calculator</h3>
                {universityName && (
                  <p className="text-[10px] text-white/35 font-medium mt-0.5 max-w-200 truncate">{universityName}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 cursor-pointer text-white/35 hover:text-white/70 transition-colors rounded-xl">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sliders */}
        <div className="px-6 py-5 space-y-4">
          <Slider label="Annual Fee (₹ Lakhs)" value={feeLakhs} setter={setFeeLakhs} min={0.5} max={25} step={0.5} display={(v: number) => `₹${v}L`} />
          <Slider label="Expected Package (LPA)" value={lpa} setter={setLpa} min={3} max={50} step={0.5} display={(v: number) => `₹${v}L`} />
          <Slider label="Course Duration (Years)" value={years} setter={setYears} min={2} max={6} step={1} display={(v: number) => `${v} yrs`} />
          <Slider label="Annual Living Cost (₹ Lakhs)" value={livingLakhs} setter={setLivingLakhs} min={0.5} max={6} step={0.5} display={(v: number) => `₹${v}L`} />
        </div>

        {/* Results */}
        <div className="px-6 pb-6">
          <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.14)' }}>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { val: `₹${(totalCost / 100000).toFixed(1)}L`, label: 'Total Cost' },
                { val: `${breakEven.toFixed(1)} yrs`, label: 'Break Even', color: verdict.color },
                { val: `₹${monthlyIncome}K/mo`, label: 'Monthly' },
                { val: `+${roi5yr.toFixed(0)}%`, label: '5-Yr ROI', color: '#34d399' },
              ].map(item => (
                <div key={item.label} className="py-1">
                  <div className="text-[15px] font-black" style={{ color: item.color || '#fff' }}>{item.val}</div>
                  <div className="text-[8px] text-white/35 uppercase tracking-wider font-bold mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>

            <div
              className="flex items-start gap-3 p-3.5 rounded-xl"
              style={{ background: `${verdict.color}10`, border: `1px solid ${verdict.color}22` }}
            >
              <span className="text-lg leading-none mt-0.5">{verdict.icon}</span>
              <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {verdict.text}
              </p>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-white/25 font-medium">
              <Info className="w-3.5 h-3.5 shrink-0" />
              Assumes 6% annual salary growth over 10 years. Results are indicative.
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
