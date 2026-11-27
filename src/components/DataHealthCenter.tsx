import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldCheck, Wrench } from 'lucide-react';
import {
  DataHealthFixAction,
  DataHealthGroup,
  DataHealthItem,
  DataHealthReport,
} from '../utils/dataHealth';

interface DataHealthCenterProps {
  report: DataHealthReport;
  onOpenItem: (item: DataHealthItem) => void;
  onFix: (action: DataHealthFixAction) => void;
}

const FIX_LABEL: Record<DataHealthFixAction, string> = {
  duplicateSkus: 'Sửa tự động: đánh lại mã VT-... không trùng',
  customerDebtMismatch: 'Sửa tự động: tính lại công nợ từ hóa đơn',
  stockDrift: 'Sửa tự động: đối soát tồn kho theo chứng từ',
};

export const DataHealthCenter: React.FC<DataHealthCenterProps> = ({ report, onOpenItem, onFix }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const healthy = report.totalIssues === 0;

  const toneOf = (g: DataHealthGroup): string => {
    if (g.count === 0) return 'border-emerald-200 bg-emerald-50/50 text-emerald-900';
    if (g.severity === 'error') return 'border-rose-300 bg-rose-50 text-rose-900';
    if (g.severity === 'warning') return 'border-amber-300 bg-amber-50 text-amber-900';
    return 'border-slate-200 bg-slate-50 text-slate-700';
  };

  return (
    <section
      aria-label="Trung tâm sức khỏe dữ liệu"
      className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>Trung tâm sức khỏe dữ liệu</span>
        </h2>
        <span
          className={`px-2.5 py-1 text-xs font-bold rounded-full border ${
            healthy
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {healthy ? 'Dữ liệu khớp 100%' : `${report.totalIssues} điểm cần kiểm tra`}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {report.groups.map((g) => {
          const isOpen = Boolean(expanded[g.id]);
          return (
            <div key={g.id} className={`rounded-lg border p-3 ${toneOf(g)}`}>
              <button
                type="button"
                disabled={g.count === 0}
                onClick={() => setExpanded((prev) => ({ ...prev, [g.id]: !isOpen }))}
                className="w-full flex items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    {g.count === 0 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{g.title}</span>
                  </div>
                  <div className="text-[11px] mt-0.5 opacity-80 leading-snug">{g.description}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-sm font-extrabold">{g.count}</span>
                  {g.count > 0 && (isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                </div>
              </button>

              {g.count > 0 && isOpen && (
                <div className="mt-2.5 space-y-2">
                  {g.fixAction && (
                    <button
                      type="button"
                      onClick={() => onFix(g.fixAction!)}
                      className="w-full px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md inline-flex items-center justify-center gap-1.5"
                    >
                      <Wrench className="w-3 h-3 shrink-0" />
                      <span>{FIX_LABEL[g.fixAction]}</span>
                    </button>
                  )}
                  <div className="max-h-52 overflow-y-auto divide-y divide-black/5 bg-white/70 rounded-md border border-black/5">
                    {g.items.slice(0, 50).map((item) => (
                      <div
                        key={item.id}
                        className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-bold text-slate-900 mr-1.5">{item.code}</span>
                          <span className="text-slate-700">{item.label}</span>
                        </div>
                        {item.tab && (
                          <button
                            type="button"
                            onClick={() => onOpenItem(item)}
                            className="px-2 py-0.5 font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded whitespace-nowrap shrink-0"
                          >
                            Mở chứng từ →
                          </button>
                        )}
                      </div>
                    ))}
                    {g.items.length > 50 && (
                      <div className="px-2.5 py-1.5 text-[11px] text-slate-500">
                        … và {g.items.length - 50} mục khác
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
