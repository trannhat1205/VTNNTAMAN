import React, { useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
  title?: string;
}

interface DetectedBarcodeItem {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeItem[]>;
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

/**
 * Lightweight camera & USB barcode scanner modal without external dependencies:
 * - Uses native BarcodeDetector + rear camera stream when available.
 * - Always provides an auto-focused manual/USB scanner input field as 100% fallback.
 */
export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onDetected,
  title = 'Quét Mã Vạch / Barcode Sản Phẩm',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [cameraStatus, setCameraStatus] = useState<string>(
    'Đang khởi tạo camera quét mã vạch...'
  );

  useEffect(() => {
    if (!isOpen) return;
    setManualCode('');
    const focusTimer = window.setTimeout(() => {
      manualInputRef.current?.focus();
    }, 100);

    let active = true;
    let stream: MediaStream | null = null;
    let intervalId: number | null = null;

    const startCamera = async () => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        if (active) {
          setCameraStatus(
            'Thiết bị hoặc trình duyệt chưa hỗ trợ truy cập camera. Hãy dùng máy quét USB hoặc gõ mã vào ô bên dưới.'
          );
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        const win = window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor };
        if (!win.BarcodeDetector) {
          setCameraStatus(
            'Camera đã bật (trình duyệt này chưa hỗ trợ nhận diện tự động BarcodeDetector). Hãy dùng đầu đọc USB hoặc nhập tay vào ô bên dưới.'
          );
          return;
        }

        const detector = new win.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'],
        });
        setCameraStatus('Đưa mã vạch vào khung hình để tự động nhận diện...');

        intervalId = window.setInterval(async () => {
          if (!active || !videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            const match = barcodes.find((b) => b.rawValue && b.rawValue.trim());
            if (match?.rawValue) {
              const code = match.rawValue.trim();
              active = false;
              if (intervalId !== null) window.clearInterval(intervalId);
              stream?.getTracks().forEach((t) => t.stop());
              onDetected(code);
              onClose();
            }
          } catch {
            // ignore transient frame read errors
          }
        }, 250);
      } catch {
        if (active) {
          setCameraStatus(
            'Không thể mở camera (chưa cấp quyền hoặc không có camera). Hãy dùng máy quét USB hoặc nhập tay vào ô bên dưới.'
          );
        }
      }
    };

    void startCamera();

    return () => {
      active = false;
      window.clearTimeout(focusTimer);
      if (intervalId !== null) window.clearInterval(intervalId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, onClose, onDetected]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.trim();
    if (!cleaned) return;
    onDetected(cleaned);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-4 py-3.5 border-b border-slate-200 bg-emerald-50/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-700 shrink-0" />
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ quét mã vạch"
            className="p-1.5 text-slate-400 hover:text-slate-700 bg-white rounded-lg border border-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-slate-800">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
            />
            <div className="pointer-events-none absolute inset-6 border-2 border-emerald-400/75 rounded-lg" />
          </div>

          <div className="text-[11px] text-slate-600 leading-snug">{cameraStatus}</div>

          <form onSubmit={handleManualSubmit} className="space-y-2 pt-1 border-t border-slate-200">
            <label htmlFor="manual-barcode-input" className="block text-xs font-semibold text-slate-700">
              Quét bằng đầu đọc USB hoặc nhập nhanh mã vạch / mã VT:
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={manualInputRef}
                id="manual-barcode-input"
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Đưa mã vạch vào camera hoặc bắn máy quét USB rồi nhấn Enter..."
                className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shrink-0"
              >
                Áp dụng
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
