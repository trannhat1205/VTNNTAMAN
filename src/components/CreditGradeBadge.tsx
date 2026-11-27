import React from 'react';
import type { CreditGrade } from '../utils/smartInsights';

const GRADE_STYLE: Record<CreditGrade, { cls: string; label: string }> = {
  A: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-300', label: 'Tín dụng tốt: không có nợ quá hạn' },
  B: { cls: 'bg-sky-50 text-sky-800 border-sky-300', label: 'Nợ quá hạn tối đa 30 ngày' },
  C: { cls: 'bg-amber-50 text-amber-800 border-amber-300', label: 'Nợ quá hạn 31–60 ngày' },
  D: { cls: 'bg-rose-50 text-rose-800 border-rose-300', label: 'Rủi ro: quá hạn trên 60 ngày hoặc quá hạn quá nửa dư nợ' },
};

export const CreditGradeBadge: React.FC<{ grade: CreditGrade; className?: string }> = ({
  grade,
  className = '',
}) => (
  <span
    title={GRADE_STYLE[grade].label}
    className={`inline-flex items-center px-1.5 py-0 rounded border text-[10px] font-bold leading-4 ${GRADE_STYLE[grade].cls} ${className}`}
  >
    Hạng {grade}
  </span>
);
