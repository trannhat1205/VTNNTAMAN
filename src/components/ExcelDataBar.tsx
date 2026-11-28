import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import type { ImportTransaction, ProductItem, SaleTransaction } from '../types';
import {
  ExcelModuleType,
  downloadExcelTemplate,
  parseUploadedExcelRows,
} from '../utils/exportReports';
import {
  ExcelImportPreviewResult,
  validateAndPreviewExcelImportRows,
} from '../utils/smartInsights';
import { uploadFileToFirebaseStorage } from '../services/firebaseService';

export interface ExcelValidationContext {
  products?: ProductItem[];
  sales?: SaleTransaction[];
  imports?: ImportTransaction[];
  lockedWarehouse?: string | null;
  defaultWarehouse?: string;
}

interface ExcelDataBarProps {
  moduleType: ExcelModuleType;
  moduleTitle: string;
  onImportRows: (rows: Record<string, unknown>[]) => number;
  onExportCurrentData?: () => string;
  validationContext?: ExcelValidationContext;
}

export const ExcelDataBar: React.FC<ExcelDataBarProps> = ({
  moduleType,
  moduleTitle,
  onImportRows,
  onExportCurrentData,
  validationContext,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success');
  const [pendingPreview, setPendingPreview] = useState<{
    file: File;
    result: ExcelImportPreviewResult;
  } | null>(null);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'issues'>('all');
  const [isConfirming, setIsConfirming] = useState(false);

  const handleDownloadSample = () => {
    const file = downloadExcelTemplate(moduleType);
    setStatusTone('success');
    setStatusMsg(`Đã tải file mẫu: ${file}. Hãy điền thông tin rồi bấm "Tải Lên Từ Excel"!`);
  };

  const handleExport = () => {
    if (!onExportCurrentData) return;
    const file = onExportCurrentData();
    setStatusTone('success');
    setStatusMsg(`Đã xuất dữ liệu ${moduleTitle} ra file: ${file}`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawRows = await parseUploadedExcelRows(file);
      const previewResult = validateAndPreviewExcelImportRows({
        moduleType,
        rows: rawRows,
        existingProducts: validationContext?.products,
        existingSales: validationContext?.sales,
        existingImports: validationContext?.imports,
        lockedWarehouse: validationContext?.lockedWarehouse,
        defaultWarehouse: validationContext?.defaultWarehouse,
      });
      setPreviewFilter(previewResult.errorCount > 0 ? 'all' : 'all');
      setPendingPreview({ file, result: previewResult });
    } catch (err) {
      setStatusTone('error');
      setStatusMsg(
        err instanceof Error
          ? `Lỗi đọc file Excel: ${err.message}`
          : 'Không thể đọc tệp Excel. Vui lòng chọn đúng định dạng .xlsx, .xls hoặc .csv'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingPreview || pendingPreview.result.validCount === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      const { file, result } = pendingPreview;
      const uploadRes = await uploadFileToFirebaseStorage(file, 'excel_imports').catch(() => ({
        syncedToCloud: false,
      }));
      const count = onImportRows(result.validNormalizedRows);
      setPendingPreview(null);
      setStatusTone(count > 0 ? 'success' : 'error');
      setStatusMsg(
        count > 0
          ? uploadRes.syncedToCloud
            ? `Đã kiểm duyệt & nạp thành công ${count} dòng hợp lệ từ "${file.name}" vào ${moduleTitle} (đã lưu bản gốc lên Cloud)${
                result.errorCount > 0 ? ` · Bỏ qua ${result.errorCount} dòng lỗi.` : '!'
              }`
            : `Đã kiểm duyệt & nạp thành công ${count} dòng hợp lệ từ "${file.name}" vào ${moduleTitle}${
                result.errorCount > 0 ? ` · Bỏ qua ${result.errorCount} dòng lỗi.` : '!'
              }`
          : `Không có dòng dữ liệu nào được nạp từ "${file.name}".`
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const displayedPreviewRows = useMemo(() => {
    if (!pendingPreview) return [];
    return pendingPreview.result.rows.filter((r) => {
      if (previewFilter === 'valid') return r.status === 'valid';
      if (previewFilter === 'issues') return r.status === 'error' || r.warnings.length > 0;
      return true;
    });
  }, [pendingPreview, previewFilter]);

  return (
    <>
      <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {statusMsg && (
          <div
            className={`text-xs font-medium flex items-center gap-1.5 min-w-0 ${
              statusTone === 'error' ? 'text-rose-700' : 'text-emerald-800'
            }`}
          >
            {statusTone === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadSample}
            className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Tải Mẫu Excel (.xlsx)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
            aria-label={`Tải file Excel dữ liệu ${moduleTitle}`}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Tải Lên Từ Excel (Có Xem Trước)</span>
          </button>

          {onExportCurrentData && (
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-600" />
              <span>Xuất Dữ Liệu Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Excel Preview & Line-by-Line Error Inspector Modal (Phase 4A) */}
      {pendingPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Xem trước dữ liệu Excel ${moduleTitle}`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-emerald-50/80 border-b border-emerald-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Xem Trước &amp; Kiểm Lỗi Từng Dòng Excel — {moduleTitle}</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Tệp: <strong className="font-mono text-slate-900">{pendingPreview.file.name}</strong> · Kiểm tra kỹ các dòng báo đỏ hoặc cảnh báo vàng trước khi xác nhận nạp vào sổ.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingPreview(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                aria-label="Đóng xem trước Excel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* KPI & Filter Strip */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-white border border-slate-200 font-semibold text-slate-700">
                  Tổng dòng dữ liệu: <strong>{pendingPreview.result.totalNonEmptyRows}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 font-semibold text-emerald-800">
                  Hợp lệ: <strong>{pendingPreview.result.validCount}</strong>
                </span>
                <span
                  className={`px-2.5 py-1 rounded-md border font-semibold ${
                    pendingPreview.result.errorCount > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  Dòng lỗi (sẽ bỏ qua): <strong>{pendingPreview.result.errorCount}</strong>
                </span>
                {pendingPreview.result.warningCount > 0 && (
                  <span className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 font-semibold text-amber-800">
                    Lưu ý kiểm tra: <strong>{pendingPreview.result.warningCount}</strong>
                  </span>
                )}
              </div>

              <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
                {(
                  [
                    { id: 'all', label: `Tất cả (${pendingPreview.result.totalNonEmptyRows})` },
                    { id: 'valid', label: `Hợp lệ (${pendingPreview.result.validCount})` },
                    {
                      id: 'issues',
                      label: `Lỗi / Lưu ý (${
                        pendingPreview.result.rows.filter(
                          (r) => r.status === 'error' || r.warnings.length > 0
                        ).length
                      })`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPreviewFilter(tab.id)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                      previewFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview Rows Table */}
            <div className="flex-1 overflow-auto">
              {pendingPreview.result.totalNonEmptyRows === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 space-y-2">
                  <p className="font-semibold text-rose-700">
                    Tệp Excel đang trống hoặc không có dòng dữ liệu nào ở Sheet đầu tiên.
                  </p>
                  <p>Hãy bấm &quot;Tải Mẫu Excel (.xlsx)&quot; để xem đúng tiêu đề cột mẫu.</p>
                </div>
              ) : displayedPreviewRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Không có dòng nào trong bộ lọc này.
                </div>
              ) : (
                <table className="w-full min-w-[780px] text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-2xs">
                    <tr className="text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3 w-[68px] whitespace-nowrap">Dòng #</th>
                      <th className="py-2.5 px-3 w-[115px] whitespace-nowrap">Trạng thái</th>
                      {pendingPreview.result.columns.map((col) => (
                        <th key={col} className="py-2.5 px-3 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                      <th className="py-2.5 px-3 min-w-[220px]">Chi tiết kiểm tra / Báo lỗi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {displayedPreviewRows.map((row) => (
                      <tr
                        key={row.excelRowNumber}
                        className={
                          row.status === 'error'
                            ? 'bg-rose-50/60'
                            : row.warnings.length > 0
                            ? 'bg-amber-50/40'
                            : 'hover:bg-slate-50'
                        }
                      >
                        <td className="py-2 px-3 font-mono font-bold text-slate-600 whitespace-nowrap align-top">
                          #{row.excelRowNumber}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap align-top">
                          {row.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 font-bold text-[10px]">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span>Lỗi — Bỏ qua</span>
                            </span>
                          ) : row.warnings.length > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200 font-semibold text-[10px]">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>Hợp lệ (Lưu ý)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-[10px]">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>Hợp lệ ✓</span>
                            </span>
                          )}
                        </td>
                        {row.cells.map((cell, cIdx) => (
                          <td
                            key={`${row.excelRowNumber}-${cIdx}`}
                            className="py-2 px-3 text-slate-800 max-w-[180px] truncate align-top"
                            title={cell}
                          >
                            {cell}
                          </td>
                        ))}
                        <td className="py-2 px-3 align-top space-y-0.5">
                          {row.errors.map((err, eIdx) => (
                            <div key={eIdx} className="text-rose-700 font-semibold">
                              • {err}
                            </div>
                          ))}
                          {row.warnings.map((w, wIdx) => (
                            <div key={wIdx} className="text-amber-800">
                              • {w}
                            </div>
                          ))}
                          {row.errors.length === 0 && row.warnings.length === 0 && (
                            <span className="text-emerald-700">Đủ dữ liệu chuẩn</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-600">
                {pendingPreview.result.errorCount > 0
                  ? `Các dòng báo đỏ (${pendingPreview.result.errorCount} dòng) sẽ tự động được bỏ qua để bảo vệ tồn kho & công nợ.`
                  : 'Tất cả dòng dữ liệu đều hợp lệ, sẵn sàng ghi nhận vào hệ thống.'}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setPendingPreview(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  disabled={pendingPreview.result.validCount === 0 || isConfirming}
                  onClick={() => void handleConfirmImport()}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-xs flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isConfirming
                      ? 'Đang nạp dữ liệu...'
                      : `Xác nhận nạp ${pendingPreview.result.validCount} dòng hợp lệ`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
