import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import {
  ExcelModuleType,
  downloadExcelTemplate,
  parseUploadedExcelRows,
} from '../utils/exportReports';

interface ExcelDataBarProps {
  moduleType: ExcelModuleType;
  moduleTitle: string;
  onImportRows: (rows: Record<string, unknown>[]) => number;
  onExportCurrentData?: () => string;
}

export const ExcelDataBar: React.FC<ExcelDataBarProps> = ({
  moduleType,
  moduleTitle,
  onImportRows,
  onExportCurrentData,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleDownloadSample = () => {
    const file = downloadExcelTemplate(moduleType);
    setStatusMsg(`Đã tải file mẫu: ${file}. Hãy điền thông tin rồi bấm "Tải lên từ Excel"!`);
  };

  const handleExport = () => {
    if (!onExportCurrentData) return;
    const file = onExportCurrentData();
    setStatusMsg(`Đã xuất dữ liệu ${moduleTitle} ra file: ${file}`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseUploadedExcelRows(file);
      const count = onImportRows(rows);
      setStatusMsg(
        count > 0
          ? `Đã tải lên thành công ${count} dòng dữ liệu vào mục ${moduleTitle} từ file "${file.name}"!`
          : `Không tìm thấy dòng dữ liệu hợp lệ trong file "${file.name}". Vui lòng kiểm tra theo mẫu Excel.`
      );
    } catch (err) {
      setStatusMsg(
        err instanceof Error
          ? `Lỗi đọc file Excel: ${err.message}`
          : 'Không thể đọc tệp Excel. Vui lòng chọn đúng định dạng .xlsx hoặc .xls'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
      {statusMsg && (
        <div className="text-xs text-emerald-800 font-medium flex items-center gap-1.5 min-w-0">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
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
          <span>Tải Lên Từ Excel</span>
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
  );
};
