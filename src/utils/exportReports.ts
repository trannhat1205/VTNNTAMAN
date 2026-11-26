import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  ReportModuleCategory,
  SaleTransaction,
  SavedVoucherRecord,
  VietQrBankConfig,
} from '../types';
import {
  buildVietQrImageUrl,
  isValidVietQrConfig,
  resolveVietnamBankLabel,
  sanitizeVietQrText,
} from './smartPosFeatures';
import {
  evaluateDebtUrgency,
  evaluateStockAlert,
  formatVND,
  getTodayVietnamDateStr,
  ProductStockMovementLedger,
  ReceivedItemReportRow,
  resolveSaleGiftUnitCost,
  resolveSaleUnitCost,
  SmartReportRecommendation,
  TaxAuthorityFinancialStatementResult,
} from './businessLogic';

const FONT_FAMILY = '"Plus Jakarta Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Preload logo image in browser for drawing on PDF canvas
let cachedLogoImage: HTMLImageElement | null = null;
if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = '/assets/logo-taman.png?v=3';
  img.onload = () => {
    cachedLogoImage = img;
  };
}

export function formatCurrencyPlain(amount: number): string {
  const safe = Math.round(Number(amount) || 0);
  return `${safe.toLocaleString('vi-VN')} VNĐ`;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const clean = (text || '').trim();
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = `${currentLine} ${word}`;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

interface CanvasTableColumn {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

function drawCanvasTable(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  columns: CanvasTableColumn[],
  rows: string[][],
  headerBgColor: string
): number {
  const padX = 12;
  const padY = 11;
  const lineHeight = 19;

  // 1. Draw Table Header
  ctx.font = `700 13px ${FONT_FAMILY}`;
  let headerLinesMax = 1;
  const wrappedHeaders = columns.map((col) => {
    const lines = wrapCanvasText(ctx, col.header, col.width - padX * 2);
    if (lines.length > headerLinesMax) headerLinesMax = lines.length;
    return lines;
  });

  const headerHeight = Math.max(42, headerLinesMax * lineHeight + padY * 2);
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  ctx.fillStyle = headerBgColor;
  ctx.fillRect(startX, startY, totalWidth, headerHeight);

  let colX = startX;
  columns.forEach((col, cIdx) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 13px ${FONT_FAMILY}`;
    const lines = wrappedHeaders[cIdx];
    lines.forEach((line, lIdx) => {
      const textY = startY + padY + 13 + lIdx * lineHeight;
      if (col.align === 'right') {
        ctx.textAlign = 'right';
        ctx.fillText(line, colX + col.width - padX, textY);
      } else if (col.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(line, colX + col.width / 2, textY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(line, colX + padX, textY);
      }
    });
    colX += col.width;
  });

  // 2. Draw Body Rows
  let currentY = startY + headerHeight;

  rows.forEach((row, rIdx) => {
    ctx.font = `500 13px ${FONT_FAMILY}`;
    let maxRowLines = 1;
    const wrappedCells = columns.map((col, cIdx) => {
      const cellText = row[cIdx] ?? '';
      const lines = wrapCanvasText(ctx, cellText, col.width - padX * 2);
      if (lines.length > maxRowLines) maxRowLines = lines.length;
      return lines;
    });

    const rowHeight = Math.max(40, maxRowLines * lineHeight + padY * 2);

    // Alternating subtle background
    ctx.fillStyle = rIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
    ctx.fillRect(startX, currentY, totalWidth, rowHeight);

    // Cell borders & text
    let cellX = startX;
    columns.forEach((col, cIdx) => {
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, currentY, col.width, rowHeight);

      ctx.fillStyle = '#1E293B';
      ctx.font = `500 13px ${FONT_FAMILY}`;
      const lines = wrappedCells[cIdx];
      lines.forEach((line, lIdx) => {
        const textY = currentY + padY + 13 + lIdx * lineHeight;
        if (col.align === 'right') {
          ctx.textAlign = 'right';
          ctx.fillText(line, cellX + col.width - padX, textY);
        } else if (col.align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(line, cellX + col.width / 2, textY);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(line, cellX + padX, textY);
        }
      });

      cellX += col.width;
    });

    currentY += rowHeight;
  });

  ctx.textAlign = 'left';
  return currentY;
}

function drawVoucherHeaderOnCanvas(
  ctx: CanvasRenderingContext2D,
  pageWidth: number,
  title: string,
  voucherCode: string,
  dateStr: string
): number {
  const marginX = 52;
  let textStartX = marginX;

  if (cachedLogoImage) {
    try {
      ctx.drawImage(cachedLogoImage, marginX, 36, 54, 54);
      textStartX = marginX + 66;
    } catch {
      textStartX = marginX;
    }
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#15803D';
  ctx.font = `800 20px ${FONT_FAMILY}`;
  ctx.fillText('CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN', textStartX, 58);

  ctx.fillStyle = '#475569';
  ctx.font = `500 13px ${FONT_FAMILY}`;
  ctx.fillText('Vật tư Tâm An - Nhà Nông an tâm', textStartX, 80);

  // Divider line
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, 102);
  ctx.lineTo(pageWidth - marginX, 102);
  ctx.stroke();

  // Centered Voucher Title with full Vietnamese diacritics
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `800 22px ${FONT_FAMILY}`;
  ctx.fillText(title.toUpperCase(), pageWidth / 2, 138);

  ctx.fillStyle = '#334155';
  ctx.font = `600 13px ${FONT_FAMILY}`;
  ctx.fillText(`Mã phiếu: ${voucherCode}`, pageWidth / 2, 162);
  ctx.font = `500 13px ${FONT_FAMILY}`;
  ctx.fillText(`Ngày lập: ${dateStr}`, pageWidth / 2, 182);

  ctx.textAlign = 'left';
  return 214;
}

function drawSignatureFooterOnCanvas(
  ctx: CanvasRenderingContext2D,
  pageWidth: number,
  startY: number,
  leftRole: string,
  rightRole: string,
  leftName?: string,
  rightName?: string
) {
  const y = startY > 880 ? startY + 46 : Math.min(940, startY + 46);
  const leftCenterX = pageWidth * 0.26;
  const rightCenterX = pageWidth * 0.74;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 14px ${FONT_FAMILY}`;
  ctx.fillText(leftRole.toUpperCase(), leftCenterX, y);
  ctx.fillText(rightRole.replace(/^ĐẠI DIỆN\s+/i, '').toUpperCase(), rightCenterX, y);

  ctx.fillStyle = '#64748B';
  ctx.font = `400 12.5px ${FONT_FAMILY}`;
  ctx.fillText('(Ký, ghi rõ họ tên)', leftCenterX, y + 20);
  ctx.fillText('(Ký, ghi rõ họ tên)', rightCenterX, y + 20);

  if (leftName) {
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 13.5px ${FONT_FAMILY}`;
    ctx.fillText(leftName, leftCenterX, y + 96);
  }
  if (rightName) {
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 13.5px ${FONT_FAMILY}`;
    ctx.fillText(rightName.replace(/\s*\(.*?\)\s*/g, '').trim(), rightCenterX, y + 96);
  }

  ctx.textAlign = 'left';
}

function saveCanvasAsA4PDF(
  orientation: 'portrait' | 'landscape',
  fileName: string,
  title: string,
  drawCallback: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): string {
  if (typeof document === 'undefined') {
    return fileName;
  }

  const logicalWidth = orientation === 'portrait' ? 794 : 1123;
  const logicalHeight = orientation === 'portrait' ? 1123 : 794;
  const scale = 2.5; // High-DPI crisp Vietnamese typography

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(logicalWidth * scale);
  canvas.height = Math.round(logicalHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return fileName;

  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  drawCallback(ctx, logicalWidth, logicalHeight);

  const dataUrl = canvas.toDataURL('image/png', 1.0);

  // Store latest rendered Vietnamese PDF preview so user & tests can verify diacritics visually
  if (typeof window !== 'undefined') {
    (
      window as unknown as {
        __lastExportedPdfPreview?: { fileName: string; title: string; dataUrl: string };
      }
    ).__lastExportedPdfPreview = {
      fileName,
      title,
      dataUrl,
    };
    window.dispatchEvent(
      new CustomEvent('taman-pdf-exported', {
        detail: { fileName, title, dataUrl },
      })
    );
  }

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const pdfWidthMm = orientation === 'portrait' ? 210 : 297;
  const pdfHeightMm = orientation === 'portrait' ? 297 : 210;

  doc.addImage(dataUrl, 'PNG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
  doc.save(fileName);
  return fileName;
}

/**
 * Multi-page A4 canvas renderer that prevents row truncation (`.slice`) on reports
 * by slicing a tall logical canvas cleanly across consecutive A4 pages.
 */
function saveTallCanvasAsMultiPageA4PDF(
  orientation: 'portrait' | 'landscape',
  fileName: string,
  title: string,
  requiredLogicalHeight: number,
  drawCallback: (ctx: CanvasRenderingContext2D, width: number, totalHeight: number) => void
): string {
  if (typeof document === 'undefined') {
    return fileName;
  }

  const logicalWidth = orientation === 'portrait' ? 794 : 1123;
  const pageLogicalHeight = orientation === 'portrait' ? 1123 : 794;
  const totalLogicalHeight = Math.max(pageLogicalHeight, Math.ceil(requiredLogicalHeight));
  const scale =
    totalLogicalHeight * 2.5 > 16000 ? Math.max(1.2, 16000 / totalLogicalHeight) : 2.5;

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.round(logicalWidth * scale);
  fullCanvas.height = Math.round(totalLogicalHeight * scale);
  const ctx = fullCanvas.getContext('2d');
  if (!ctx) return fileName;

  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, logicalWidth, totalLogicalHeight);
  drawCallback(ctx, logicalWidth, totalLogicalHeight);

  const pageCount = Math.max(1, Math.ceil(totalLogicalHeight / pageLogicalHeight));
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const pdfWidthMm = orientation === 'portrait' ? 210 : 297;
  const pdfHeightMm = orientation === 'portrait' ? 297 : 210;

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = Math.round(logicalWidth * scale);
    sliceCanvas.height = Math.round(pageLogicalHeight * scale);
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) continue;
    sliceCtx.fillStyle = '#FFFFFF';
    sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);

    const srcY = Math.round(pageIdx * pageLogicalHeight * scale);
    const availableSrcH = Math.max(0, fullCanvas.height - srcY);
    const copyH = Math.min(sliceCanvas.height, availableSrcH);
    if (copyH > 0) {
      sliceCtx.drawImage(
        fullCanvas,
        0,
        srcY,
        fullCanvas.width,
        copyH,
        0,
        0,
        sliceCanvas.width,
        copyH
      );
    }

    const pageDataUrl = sliceCanvas.toDataURL('image/png', 1.0);
    if (pageIdx === 0 && typeof window !== 'undefined') {
      (
        window as unknown as {
          __lastExportedPdfPreview?: { fileName: string; title: string; dataUrl: string };
        }
      ).__lastExportedPdfPreview = {
        fileName,
        title,
        dataUrl: pageDataUrl,
      };
      window.dispatchEvent(
        new CustomEvent('taman-pdf-exported', {
          detail: { fileName, title, dataUrl: pageDataUrl },
        })
      );
    }

    if (pageIdx > 0) {
      doc.addPage();
    }
    doc.addImage(pageDataUrl, 'PNG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
  }

  doc.save(fileName);
  return fileName;
}

export interface SaleInvoiceLineItem {
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  giftProductName?: string;
  giftUnit?: string;
  giftQuantity?: number;
  dosageGuide?: string;
}

function loadVietQrImageSafely(url: string, timeoutMs = 2400): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || !url) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (img: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(img);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      window.clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = url;
  });
}

// 1. Phiếu in Hóa đơn Bán hàng — Hỗ trợ nhiều mặt hàng POS, Hướng dẫn liều lượng & VietQR động
export function exportSaleInvoicePDF(sale: {
  invoiceCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  giftProductName?: string;
  giftUnit?: string;
  giftQuantity?: number;
  dosageGuide?: string;
  items?: SaleInvoiceLineItem[];
  bankQrConfig?: VietQrBankConfig | null;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  dueDate: string;
  note: string;
  warehouseName?: string;
  staffName: string;
  createdAt: string;
}): string {
  const dateStr = (sale.createdAt || new Date().toISOString()).slice(0, 10);
  const fileName = `PhieuBanHang_${sale.invoiceCode}_${dateStr}.pdf`;

  const lineItems: SaleInvoiceLineItem[] =
    sale.items && sale.items.length > 0
      ? sale.items
      : [
          {
            productName: sale.productName,
            unit: sale.unit,
            quantity: sale.quantity,
            unitPrice: sale.unitPrice,
            discountAmount: sale.discountAmount,
            giftProductName: sale.giftProductName,
            giftUnit: sale.giftUnit,
            giftQuantity: sale.giftQuantity,
            dosageGuide: sale.dosageGuide,
          },
        ];

  const dosageEntries = lineItems
    .filter((item) => (item.dosageGuide || '').trim().length > 0)
    .map((item) => ({
      productName: item.productName,
      guide: (item.dosageGuide || '').trim(),
    }));

  const hasValidBank = isValidVietQrConfig(sale.bankQrConfig);
  const qrPayable = sale.debtAmount > 0 ? sale.debtAmount : sale.totalAmount;
  const qrAddInfo = sanitizeVietQrText(`TT ${sale.invoiceCode} ${sale.customerName}`, 48);

  const renderInvoicePdf = (qrImg: HTMLImageElement | null) => {
    const drawContent = (ctx: CanvasRenderingContext2D, pageWidth: number, withQrImg: boolean) => {
      const marginX = 52;
      let y = drawVoucherHeaderOnCanvas(
        ctx,
        pageWidth,
        'PHIẾU HÓA ĐƠN BÁN HÀNG',
        sale.invoiceCode,
        dateStr
      );

      ctx.fillStyle = '#0F172A';
      ctx.font = `500 14px ${FONT_FAMILY}`;
      ctx.fillText(`Khách hàng: ${sale.customerName}`, marginX, y);
      y += 24;
      ctx.fillText(`Số điện thoại: ${sale.customerPhone || '---'}`, marginX, y);
      y += 24;
      if (sale.customerAddress) {
        ctx.fillText(`Địa chỉ: ${sale.customerAddress}`, marginX, y);
        y += 24;
      }
      ctx.fillText(
        `Kho xuất bán: ${sale.warehouseName || 'Tâm An Mỹ Ngãi'} | Nhân viên: ${sale.staffName}`,
        marginX,
        y
      );
      y += 22;

      const columns: CanvasTableColumn[] = [
        { header: 'STT', width: 50, align: 'center' },
        { header: 'Tên Vật Tư Nông Nghiệp', width: 250, align: 'left' },
        { header: 'Đơn Vị', width: 90, align: 'left' },
        { header: 'Số Lượng', width: 80, align: 'center' },
        { header: 'Đơn Giá (VNĐ)', width: 110, align: 'right' },
        { header: 'Thành Tiền (VNĐ)', width: 110, align: 'right' },
      ];

      const rows: string[][] = [];
      let rowIndex = 1;
      for (const item of lineItems) {
        const grossAmount = item.quantity * item.unitPrice;
        rows.push([
          String(rowIndex++),
          item.productName,
          item.unit,
          String(item.quantity),
          item.unitPrice.toLocaleString('vi-VN'),
          grossAmount.toLocaleString('vi-VN'),
        ]);
        if (item.giftProductName && (item.giftQuantity || 0) > 0) {
          rows.push([
            String(rowIndex++),
            `[QUÀ TẶNG KM] ${item.giftProductName}`,
            item.giftUnit || 'CÁI',
            String(item.giftQuantity),
            '0',
            '0 (Tặng KM)',
          ]);
        }
      }

      const tableEndY = drawCanvasTable(ctx, marginX, y, columns, rows, '#15803D');

      let summaryY = tableEndY + 30;
      const rightEdge = pageWidth - marginX;
      const totalDiscount =
        sale.discountAmount !== undefined
          ? sale.discountAmount
          : lineItems.reduce((sum, item) => sum + (item.discountAmount || 0), 0);

      ctx.textAlign = 'right';
      ctx.font = `700 14.5px ${FONT_FAMILY}`;

      if (totalDiscount > 0) {
        ctx.fillStyle = '#B45309';
        ctx.fillText(
          `Giảm giá bán khuyến mãi: -${formatCurrencyPlain(totalDiscount)}`,
          rightEdge,
          summaryY
        );
        summaryY += 24;
      }

      ctx.fillStyle = '#0F172A';
      ctx.fillText(`Tổng thành tiền: ${formatCurrencyPlain(sale.totalAmount)}`, rightEdge, summaryY);

      ctx.fillStyle = '#15803D';
      ctx.fillText(
        `Khách đã thanh toán: ${formatCurrencyPlain(sale.paidAmount)}`,
        rightEdge,
        summaryY + 26
      );

      ctx.fillStyle = sale.debtAmount > 0 ? '#DC2626' : '#0F172A';
      ctx.fillText(
        `Còn ghi nợ: ${formatCurrencyPlain(sale.debtAmount)}`,
        rightEdge,
        summaryY + 52
      );

      ctx.textAlign = 'left';
      ctx.font = `500 13.5px ${FONT_FAMILY}`;
      ctx.fillStyle = '#334155';
      if (sale.debtAmount > 0 && sale.dueDate) {
        ctx.fillText(`Hạn thanh toán công nợ: ${sale.dueDate}`, marginX, summaryY + 26);
      }
      if (sale.note) {
        const noteLines = wrapCanvasText(ctx, `Ghi chú: ${sale.note}`, 370).slice(0, 2);
        noteLines.forEach((line, idx) => {
          ctx.fillText(line, marginX, summaryY + 52 + idx * 18);
        });
      }

      let cursorY = summaryY + 86;

      // Dosage & Spraying Instructions Box
      if (dosageEntries.length > 0) {
        const boxWidth = pageWidth - marginX * 2;
        const wrappedBlocks = dosageEntries.map((entry) => ({
          title: entry.productName,
          lines: wrapCanvasText(ctx, `• ${entry.productName}: ${entry.guide}`, boxWidth - 28),
        }));
        const totalTextLines = wrappedBlocks.reduce((s, b) => s + b.lines.length, 0);
        const boxHeight = 36 + totalTextLines * 19 + 12;

        ctx.fillStyle = '#F0FDF4';
        ctx.strokeStyle = '#86EFAC';
        ctx.lineWidth = 1.2;
        ctx.fillRect(marginX, cursorY, boxWidth, boxHeight);
        ctx.strokeRect(marginX, cursorY, boxWidth, boxHeight);

        ctx.fillStyle = '#166534';
        ctx.font = `700 13px ${FONT_FAMILY}`;
        ctx.fillText('HƯỚNG DẪN LIỀU LƯỢNG & CÁCH PHA PHUN AN TOÀN', marginX + 14, cursorY + 22);

        let textY = cursorY + 42;
        ctx.fillStyle = '#1E293B';
        ctx.font = `500 12.5px ${FONT_FAMILY}`;
        for (const block of wrappedBlocks) {
          for (const line of block.lines) {
            ctx.fillText(line, marginX + 14, textY);
            textY += 19;
          }
        }
        cursorY += boxHeight + 16;
      }

      // Dynamic VietQR Bank Transfer Box
      if (hasValidBank && sale.bankQrConfig) {
        const boxWidth = pageWidth - marginX * 2;
        const showImg = Boolean(withQrImg && qrImg);
        const boxHeight = showImg ? 136 : 94;
        ctx.fillStyle = '#F8FAFC';
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.2;
        ctx.fillRect(marginX, cursorY, boxWidth, boxHeight);
        ctx.strokeRect(marginX, cursorY, boxWidth, boxHeight);

        const textStartX = showImg ? marginX + 132 : marginX + 14;
        if (showImg && qrImg) {
          ctx.drawImage(qrImg, marginX + 12, cursorY + 10, 110, 116);
        }

        ctx.fillStyle = '#0F766E';
        ctx.font = `700 13px ${FONT_FAMILY}`;
        ctx.fillText('CHUYỂN KHOẢN NHANH VIETQR', textStartX, cursorY + 24);

        ctx.fillStyle = '#0F172A';
        ctx.font = `600 12.5px ${FONT_FAMILY}`;
        ctx.fillText(
          `Ngân hàng: ${resolveVietnamBankLabel(sale.bankQrConfig.bankCode)}  |  Số TK: ${sale.bankQrConfig.accountNumber}`,
          textStartX,
          cursorY + 46
        );
        if (sale.bankQrConfig.accountName) {
          ctx.fillText(`Chủ tài khoản: ${sale.bankQrConfig.accountName}`, textStartX, cursorY + 66);
        }
        ctx.font = `500 12px ${FONT_FAMILY}`;
        ctx.fillStyle = '#334155';
        ctx.fillText(
          `Số tiền: ${formatCurrencyPlain(qrPayable)}  |  Nội dung CK: ${qrAddInfo}`,
          textStartX,
          cursorY + (sale.bankQrConfig.accountName ? 86 : 68)
        );
        cursorY += boxHeight + 16;
      }

      drawSignatureFooterOnCanvas(
        ctx,
        pageWidth,
        cursorY + 8,
        'KHÁCH MUA HÀNG',
        'ĐẠI DIỆN VTNN TÂM AN',
        sale.customerName,
        sale.staffName
      );
    };

    try {
      saveCanvasAsA4PDF('portrait', fileName, 'PHIẾU HÓA ĐƠN BÁN HÀNG', (ctx, pageWidth) =>
        drawContent(ctx, pageWidth, Boolean(qrImg))
      );
    } catch {
      // Safe fallback if browser marks external VietQR image canvas as tainted
      saveCanvasAsA4PDF('portrait', fileName, 'PHIẾU HÓA ĐƠN BÁN HÀNG', (ctx, pageWidth) =>
        drawContent(ctx, pageWidth, false)
      );
    }
  };

  if (hasValidBank && sale.bankQrConfig && qrPayable > 0 && typeof window !== 'undefined') {
    const qrUrl = buildVietQrImageUrl(sale.bankQrConfig, {
      amount: qrPayable,
      addInfo: qrAddInfo,
    });
    void loadVietQrImageSafely(qrUrl, 2400).then((img) => renderInvoicePdf(img));
    return fileName;
  }

  renderInvoicePdf(null);
  return fileName;
}

// 2. Phiếu in Thu tiền Khách hàng (PDF Tiếng Việt có dấu 100%)
export function exportCustomerReceiptPDF(receipt: {
  voucherCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  invoiceCode: string;
  previousDebt: number;
  collectedAmount: number;
  remainingDebt: number;
  paymentMethod: string;
  note: string;
  staffName: string;
  createdAt: string;
}): string {
  const dateStr = (receipt.createdAt || new Date().toISOString()).slice(0, 10);
  const fileName = `PhieuThuKhachHang_${receipt.voucherCode}_${dateStr}.pdf`;

  return saveCanvasAsA4PDF(
    'portrait',
    fileName,
    'PHIẾU THU TIỀN KHÁCH HÀNG',
    (ctx, pageWidth) => {
      const marginX = 52;
      let y = drawVoucherHeaderOnCanvas(
        ctx,
        pageWidth,
        'PHIẾU THU TIỀN KHÁCH HÀNG',
        receipt.voucherCode,
        dateStr
      );

      ctx.fillStyle = '#0F172A';
      ctx.font = `500 14px ${FONT_FAMILY}`;
      ctx.fillText(`Họ tên người nộp tiền: ${receipt.customerName}`, marginX, y);
      y += 24;
      ctx.fillText(`Số điện thoại: ${receipt.customerPhone || '---'}`, marginX, y);
      y += 24;
      if (receipt.customerAddress) {
        ctx.fillText(`Địa chỉ: ${receipt.customerAddress}`, marginX, y);
        y += 24;
      }
      ctx.fillText(`Chứng từ / Hóa đơn gốc: ${receipt.invoiceCode}`, marginX, y);
      y += 24;
      ctx.fillText(`Hình thức thanh toán: ${receipt.paymentMethod}`, marginX, y);
      y += 22;

      const columns: CanvasTableColumn[] = [
        { header: 'Nội Dung Thu Tiền', width: 270, align: 'left' },
        { header: 'Dư Nợ Trước Thu (VNĐ)', width: 140, align: 'right' },
        { header: 'Số Tiền Thu Kỳ Này (VNĐ)', width: 140, align: 'right' },
        { header: 'Dư Nợ Còn Lại (VNĐ)', width: 140, align: 'right' },
      ];

      const tableEndY = drawCanvasTable(
        ctx,
        marginX,
        y,
        columns,
        [
          [
            receipt.note || `Thu tiền công nợ hóa đơn ${receipt.invoiceCode}`,
            receipt.previousDebt.toLocaleString('vi-VN'),
            receipt.collectedAmount.toLocaleString('vi-VN'),
            receipt.remainingDebt.toLocaleString('vi-VN'),
          ],
        ],
        '#15803D'
      );

      const summaryY = tableEndY + 34;
      ctx.font = `700 15px ${FONT_FAMILY}`;
      ctx.fillStyle = '#15803D';
      ctx.fillText(
        `XÁC NHẬN ĐÃ THU: ${formatCurrencyPlain(receipt.collectedAmount)}`,
        marginX,
        summaryY
      );

      ctx.font = `600 14px ${FONT_FAMILY}`;
      ctx.fillStyle = receipt.remainingDebt > 0 ? '#DC2626' : '#0F172A';
      ctx.fillText(
        `Dư nợ còn lại sau khi thu: ${formatCurrencyPlain(receipt.remainingDebt)}`,
        marginX,
        summaryY + 26
      );

      drawSignatureFooterOnCanvas(
        ctx,
        pageWidth,
        summaryY + 55,
        'NGƯỜI NỘP TIỀN (KHÁCH HÀNG)',
        'NGƯỜI LẬP PHIẾU THU',
        receipt.customerName,
        receipt.staffName
      );
    }
  );
}

// 3. Phiếu in Thanh toán tiền Nhà cung cấp (PDF Tiếng Việt có dấu 100%)
export function exportSupplierPaymentPDF(payment: {
  voucherCode: string;
  supplierName: string;
  supplierPhone: string;
  receiptCode: string;
  previousDebt: number;
  paidAmount: number;
  remainingDebt: number;
  paymentMethod: string;
  note: string;
  staffName: string;
  createdAt: string;
}): string {
  const dateStr = (payment.createdAt || new Date().toISOString()).slice(0, 10);
  const fileName = `PhieuThanhToanNCC_${payment.voucherCode}_${dateStr}.pdf`;

  return saveCanvasAsA4PDF(
    'portrait',
    fileName,
    'PHIẾU THANH TOÁN TIỀN NHÀ CUNG CẤP',
    (ctx, pageWidth) => {
      const marginX = 52;
      let y = drawVoucherHeaderOnCanvas(
        ctx,
        pageWidth,
        'PHIẾU THANH TOÁN TIỀN NHÀ CUNG CẤP',
        payment.voucherCode,
        dateStr
      );

      ctx.fillStyle = '#0F172A';
      ctx.font = `500 14px ${FONT_FAMILY}`;
      ctx.fillText(`Đơn vị thụ hưởng (NCC): ${payment.supplierName}`, marginX, y);
      y += 24;
      ctx.fillText(`Số điện thoại NCC: ${payment.supplierPhone || '---'}`, marginX, y);
      y += 24;
      ctx.fillText(`Theo phiếu nhập kho số: ${payment.receiptCode}`, marginX, y);
      y += 24;
      ctx.fillText(`Phương thức chi trả: ${payment.paymentMethod}`, marginX, y);
      y += 22;

      const columns: CanvasTableColumn[] = [
        { header: 'Diễn Giải Thanh Toán', width: 270, align: 'left' },
        { header: 'Công Nợ NCC Trước Trả (VNĐ)', width: 140, align: 'right' },
        { header: 'Số Tiền Thanh Toán (VNĐ)', width: 140, align: 'right' },
        { header: 'Công Nợ NCC Còn Lại (VNĐ)', width: 140, align: 'right' },
      ];

      const tableEndY = drawCanvasTable(
        ctx,
        marginX,
        y,
        columns,
        [
          [
            payment.note || `Thanh toán công nợ phiếu nhập ${payment.receiptCode}`,
            payment.previousDebt.toLocaleString('vi-VN'),
            payment.paidAmount.toLocaleString('vi-VN'),
            payment.remainingDebt.toLocaleString('vi-VN'),
          ],
        ],
        '#B45309'
      );

      const summaryY = tableEndY + 34;
      ctx.font = `700 15px ${FONT_FAMILY}`;
      ctx.fillStyle = '#B45309';
      ctx.fillText(
        `TỔNG SỐ TIỀN ĐÃ CHI TRẢ NCC: ${formatCurrencyPlain(payment.paidAmount)}`,
        marginX,
        summaryY
      );

      ctx.font = `600 14px ${FONT_FAMILY}`;
      ctx.fillStyle = '#0F172A';
      ctx.fillText(
        `Công nợ NCC còn lại: ${formatCurrencyPlain(payment.remainingDebt)}`,
        marginX,
        summaryY + 26
      );

      drawSignatureFooterOnCanvas(
        ctx,
        pageWidth,
        summaryY + 55,
        'ĐẠI DIỆN NHÀ CUNG CẤP',
        'CHỦ CỬA HÀNG / NGƯỜI CHI',
        payment.supplierName,
        payment.staffName
      );
    }
  );
}

// 4. Phiếu in Nhập hàng / Nhập kho (PDF Tiếng Việt có dấu 100%)
export function exportImportReceiptPDF(imp: {
  receiptCode: string;
  supplierName: string;
  supplierPhone: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  paidAmount: number;
  debtAmount: number;
  dueDate: string;
  note: string;
  warehouseName?: string;
  staffName: string;
  createdAt: string;
}): string {
  const dateStr = (imp.createdAt || new Date().toISOString()).slice(0, 10);
  const fileName = `PhieuNhapKho_${imp.receiptCode}_${dateStr}.pdf`;

  return saveCanvasAsA4PDF(
    'portrait',
    fileName,
    'PHIẾU NHẬP KHO VẬT TƯ NÔNG NGHIỆP',
    (ctx, pageWidth) => {
      const marginX = 52;
      let y = drawVoucherHeaderOnCanvas(
        ctx,
        pageWidth,
        'PHIẾU NHẬP KHO VẬT TƯ NÔNG NGHIỆP',
        imp.receiptCode,
        dateStr
      );

      ctx.fillStyle = '#0F172A';
      ctx.font = `500 14px ${FONT_FAMILY}`;
      ctx.fillText(`Nhà cung cấp: ${imp.supplierName}`, marginX, y);
      y += 24;
      ctx.fillText(`Số điện thoại NCC: ${imp.supplierPhone || '---'}`, marginX, y);
      y += 24;
      ctx.fillText(
        `Kho nhập hàng: ${imp.warehouseName || 'Tâm An Mỹ Ngãi'} | Người nhập: ${imp.staffName}`,
        marginX,
        y
      );
      y += 22;

      const columns: CanvasTableColumn[] = [
        { header: 'STT', width: 50, align: 'center' },
        { header: 'Tên Vật Tư Nhập Kho', width: 250, align: 'left' },
        { header: 'Đơn Vị', width: 90, align: 'left' },
        { header: 'Số Lượng Nhập', width: 80, align: 'center' },
        { header: 'Giá Nhập (VNĐ)', width: 110, align: 'right' },
        { header: 'Thành Tiền (VNĐ)', width: 110, align: 'right' },
      ];

      const tableEndY = drawCanvasTable(
        ctx,
        marginX,
        y,
        columns,
        [
          [
            '1',
            imp.productName,
            imp.unit,
            String(imp.quantity),
            imp.unitCost.toLocaleString('vi-VN'),
            imp.totalCost.toLocaleString('vi-VN'),
          ],
        ],
        '#0F172A'
      );

      const summaryY = tableEndY + 32;
      const rightEdge = pageWidth - marginX;

      ctx.textAlign = 'right';
      ctx.font = `700 14.5px ${FONT_FAMILY}`;
      ctx.fillStyle = '#0F172A';
      ctx.fillText(`Tổng giá trị nhập kho: ${formatCurrencyPlain(imp.totalCost)}`, rightEdge, summaryY);

      ctx.fillStyle = '#15803D';
      ctx.fillText(
        `Đã thanh toán NCC: ${formatCurrencyPlain(imp.paidAmount)}`,
        rightEdge,
        summaryY + 26
      );

      ctx.fillStyle = imp.debtAmount > 0 ? '#DC2626' : '#0F172A';
      ctx.fillText(`Còn nợ NCC: ${formatCurrencyPlain(imp.debtAmount)}`, rightEdge, summaryY + 52);

      ctx.textAlign = 'left';
      ctx.font = `500 13.5px ${FONT_FAMILY}`;
      ctx.fillStyle = '#334155';
      if (imp.debtAmount > 0 && imp.dueDate) {
        ctx.fillText(`Hạn thanh toán công nợ NCC: ${imp.dueDate}`, marginX, summaryY + 26);
      }
      if (imp.note) {
        ctx.fillText(`Ghi chú: ${imp.note}`, marginX, summaryY + 52);
      }

      drawSignatureFooterOnCanvas(
        ctx,
        pageWidth,
        summaryY + 75,
        'NGƯỜI GIAO HÀNG (NCC)',
        'THỦ KHO / NGƯỜI NHẬN',
        imp.supplierName,
        imp.staffName
      );
    }
  );
}

export function exportPeriodicReportExcel(params: {
  periodLabel: string;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
}): string {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);

  const totalRevenue = params.sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCollected = params.sales.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalCustomerDebt = params.sales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = params.imports.reduce((sum, i) => sum + i.totalCost, 0);
  const totalSupplierDebt = params.imports.reduce((sum, i) => sum + i.debtAmount, 0);

  // Sheet 1: Tổng quan
  const summaryRows = [
    ['CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN - NHÀ NÔNG AN TÂM'],
    [`BÁO CÁO ĐỊNH KỲ: ${params.periodLabel.toUpperCase()}`],
    [`Ngày xuất báo cáo: ${today}`],
    [],
    ['CHỈ TIÊU TÀI CHÍNH & KHO', 'GIÁ TRỊ (VNĐ / SỐ LƯỢNG)'],
    ['Tổng doanh thu bán hàng', totalRevenue],
    ['Đã thu tiền khách hàng', totalCollected],
    ['Tổng công nợ phải thu khách hàng', totalCustomerDebt],
    ['Tổng giá trị nhập kho', totalImportCost],
    ['Tổng công nợ phải trả Nhà cung cấp', totalSupplierDebt],
    ['Tổng số mặt hàng trong kho', params.products.length],
    ['Tổng số khách hàng trong hệ thống', params.customers.length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong_Quan');

  // Sheet 2: Nhật ký Bán hàng
  const salesRows = params.sales.map((s, idx) => ({
    STT: idx + 1,
    'Mã Hóa Đơn': s.invoiceCode,
    'Kho Xuất Bán': s.warehouseName || 'Tâm An Mỹ Ngãi',
    'Khách Hàng': s.customerName,
    'Số Điện Thoại': s.customerPhone,
    'Sản Phẩm': s.productName,
    'Đơn Vị': s.unit,
    'Số Lượng': s.quantity,
    'Đơn Giá (đ)': s.unitPrice,
    'Thành Tiền (đ)': s.totalAmount,
    'Đã Thu (đ)': s.paidAmount,
    'Còn Nợ (đ)': s.debtAmount,
    'Hạn Thanh Toán': s.dueDate,
    'Trạng Thái':
      s.status === 'paid' ? 'Đã thanh toán' : s.status === 'partial' ? 'Trả một phần' : 'Ghi nợ',
    'Nhân Viên': s.staffName,
    'Ghi Chú': s.note,
  }));
  const wsSales = XLSX.utils.json_to_sheet(salesRows);
  XLSX.utils.book_append_sheet(wb, wsSales, 'Nhat_Ky_Ban_Hang');

  // Sheet 3: Nhật ký Nhập hàng & Công nợ NCC
  const importRows = params.imports.map((i, idx) => ({
    STT: idx + 1,
    'Mã Phiếu Nhập': i.receiptCode,
    'Kho Nhập Hàng': i.warehouseName || 'Tâm An Mỹ Ngãi',
    'Nhà Cung Cấp': i.supplierName,
    'SĐT NCC': i.supplierPhone,
    'Sản Phẩm': i.productName,
    'Đơn Vị': i.unit,
    'Số Lượng Nhập': i.quantity,
    'Giá Nhập (đ)': i.unitCost,
    'Tổng Tiền Nhập (đ)': i.totalCost,
    'Đã Trả NCC (đ)': i.paidAmount,
    'Còn Nợ NCC (đ)': i.debtAmount,
    'Hạn Trả Nợ NCC': i.dueDate,
    'Trạng Thái':
      i.status === 'paid' ? 'Đã tất toán' : i.status === 'partial' ? 'Trả một phần' : 'Chưa trả',
    'Người Nhập': i.staffName,
  }));
  const wsImports = XLSX.utils.json_to_sheet(importRows);
  XLSX.utils.book_append_sheet(wb, wsImports, 'Nhap_Kho_Cong_No_NCC');

  // Sheet 4: Tồn kho Vật tư
  const stockRows = params.products.map((p, idx) => {
    const alert = evaluateStockAlert(p);
    return {
      STT: idx + 1,
      'Mã VT': p.code,
      'Kho Lưu Trữ': p.warehouseName || 'Tâm An Mỹ Ngãi',
      'Tên Vật Tư Nông Nghiệp': p.name,
      'Nhóm Hàng': p.category,
      'Đơn Vị': p.unit,
      'Tồn Kho Hiện Tại': p.stock,
      'Mức Tối Thiểu': p.minStock,
      'Cảnh Báo Kho':
        alert === 'out_of_stock'
          ? 'HẾT HÀNG - CẦN NHẬP NGAY'
          : alert === 'low_stock'
          ? 'SẮP HẾT HÀNG'
          : 'Đủ hàng',
      'Giá Nhập (đ)': p.importPrice,
      'Giá Bán (đ)': p.sellPrice,
      'Nhà Cung Cấp Chính': p.supplierName,
    };
  });
  const wsStock = XLSX.utils.json_to_sheet(stockRows);
  XLSX.utils.book_append_sheet(wb, wsStock, 'Ton_Kho_VTNN');

  // Sheet 5: Hồ sơ Khách hàng & Công nợ
  const customerRows = params.customers.map((c, idx) => ({
    STT: idx + 1,
    'Mã KH': c.code,
    'Họ Tên Khách Hàng': c.name,
    'Số Điện Thoại': c.phone,
    Email: c.email,
    'Địa Chỉ': c.address,
    'Nhóm Khách': c.group,
    'Tổng Mua (đ)': c.totalPurchased,
    'Nợ Hiện Tại (đ)': c.totalDebt,
    'Ghi Chú': c.note,
  }));
  const wsCustomers = XLSX.utils.json_to_sheet(customerRows);
  XLSX.utils.book_append_sheet(wb, wsCustomers, 'Danh_Sach_Khach_Hang');

  const fileName = `BaoCao_VTNN_TamAn_${today}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// Báo cáo định kỳ tổng hợp (PDF Tiếng Việt có dấu 100%)
export function exportPeriodicReportPDF(params: {
  periodLabel: string;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `BaoCao_VTNN_TamAn_${today}.pdf`;

  const totalRevenue = params.sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCustomerDebt = params.sales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = params.imports.reduce((sum, i) => sum + i.totalCost, 0);
  const totalSupplierDebt = params.imports.reduce((sum, i) => sum + i.debtAmount, 0);

  const estimatedPeriodicHeight =
    260 +
    Math.max(1, params.sales.length) * 44 +
    90 +
    Math.max(1, params.imports.length) * 44 +
    80;

  return saveTallCanvasAsMultiPageA4PDF(
    'landscape',
    fileName,
    `BÁO CÁO TỔNG HỢP (${params.periodLabel})`,
    estimatedPeriodicHeight,
    (ctx, pageWidth) => {
      const marginX = 44;
      ctx.fillStyle = '#15803D';
      ctx.font = `800 20px ${FONT_FAMILY}`;
      ctx.fillText('VẬT TƯ NÔNG NGHIỆP TÂM AN — NHÀ NÔNG AN TÂM', marginX, 42);

      ctx.fillStyle = '#0F172A';
      ctx.font = `700 15px ${FONT_FAMILY}`;
      ctx.fillText(
        `BÁO CÁO TỔNG HỢP DOANH THU, TỒN KHO & CÔNG NỢ (${params.periodLabel})`,
        marginX,
        66
      );

      ctx.fillStyle = '#475569';
      ctx.font = `500 12.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `Ngày xuất: ${today} | Sao lưu Google Drive: trannhat1205@gmail.com`,
        marginX,
        86
      );

      // KPI Summary Table
      const kpiCols: CanvasTableColumn[] = [
        { header: 'Tổng Doanh Thu Bán Hàng', width: 258, align: 'right' },
        { header: 'Công Nợ Phải Thu Khách Hàng', width: 258, align: 'right' },
        { header: 'Tổng Giá Trị Nhập Kho', width: 258, align: 'right' },
        { header: 'Công Nợ Phải Trả Nhà Cung Cấp', width: 260, align: 'right' },
      ];

      let y = drawCanvasTable(
        ctx,
        marginX,
        102,
        kpiCols,
        [
          [
            formatVND(totalRevenue),
            formatVND(totalCustomerDebt),
            formatVND(totalImportCost),
            formatVND(totalSupplierDebt),
          ],
        ],
        '#15803D'
      );

      // Sales Table
      y += 24;
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 14px ${FONT_FAMILY}`;
      ctx.fillText('1. NHẬT KÝ BÁN HÀNG & CÔNG NỢ KHÁCH HÀNG', marginX, y);
      y += 12;

      const salesCols: CanvasTableColumn[] = [
        { header: 'Mã HĐ', width: 100, align: 'left' },
        { header: 'Kho Xuất', width: 135, align: 'left' },
        { header: 'Khách Hàng', width: 175, align: 'left' },
        { header: 'Vật Tư Nông Nghiệp', width: 225, align: 'left' },
        { header: 'SL', width: 80, align: 'center' },
        { header: 'Thành Tiền', width: 110, align: 'right' },
        { header: 'Đã Thu', width: 105, align: 'right' },
        { header: 'Còn Nợ', width: 104, align: 'right' },
      ];

      y = drawCanvasTable(
        ctx,
        marginX,
        y,
        salesCols,
        params.sales.map((s) => [
          s.invoiceCode,
          s.warehouseName || 'Tâm An Mỹ Ngãi',
          s.customerName,
          s.productName,
          `${s.quantity} ${s.unit}`,
          s.totalAmount.toLocaleString('vi-VN'),
          s.paidAmount.toLocaleString('vi-VN'),
          s.debtAmount.toLocaleString('vi-VN'),
        ]),
        '#0F172A'
      );

      // Imports Table
      y += 24;
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 14px ${FONT_FAMILY}`;
      ctx.fillText('2. NHẬT KÝ NHẬP HÀNG & CÔNG NỢ NHÀ CUNG CẤP', marginX, y);
      y += 12;

      const impCols: CanvasTableColumn[] = [
        { header: 'Mã Phiếu', width: 100, align: 'left' },
        { header: 'Kho Nhập', width: 135, align: 'left' },
        { header: 'Nhà Cung Cấp', width: 220, align: 'left' },
        { header: 'Vật Tư Nhập', width: 205, align: 'left' },
        { header: 'SL', width: 80, align: 'center' },
        { header: 'Tổng Tiền Nhập', width: 110, align: 'right' },
        { header: 'Còn Nợ NCC', width: 105, align: 'right' },
        { header: 'Tình Trạng', width: 79, align: 'center' },
      ];

      drawCanvasTable(
        ctx,
        marginX,
        y,
        impCols,
        params.imports.map((i) => {
          const { urgency } = evaluateDebtUrgency(i.dueDate, i.debtAmount);
          return [
            i.receiptCode,
            i.warehouseName || 'Tâm An Mỹ Ngãi',
            i.supplierName,
            i.productName,
            `${i.quantity} ${i.unit}`,
            i.totalCost.toLocaleString('vi-VN'),
            i.debtAmount.toLocaleString('vi-VN'),
            i.debtAmount <= 0
              ? 'Đã trả'
              : urgency === 'overdue'
              ? 'Quá hạn'
              : urgency === 'due_soon'
              ? 'Sắp hạn'
              : 'Chưa hạn',
          ];
        }),
        '#B45309'
      );
    }
  );
}

export type ExcelModuleType = 'sales' | 'imports' | 'inventory' | 'customers' | 'debts';

// Download Sample Excel Template (.xlsx) for any data-entry module
export function downloadExcelTemplate(moduleType: ExcelModuleType): string {
  const wb = XLSX.utils.book_new();
  let fileName = 'Mau_Du_Lieu_VTNN_TamAn.xlsx';

  const todayStr = getTodayVietnamDateStr();
  if (moduleType === 'sales') {
    const sampleRows = [
      {
        'Kho Xuất Bán': 'Tâm An Mỹ Ngãi',
        'Tên Khách Hàng': 'Ông Nguyễn Văn Hòa',
        'Số Điện Thoại KH': '0913456789',
        'Nhóm KH': 'Đại lý cấp 2',
        'Tên Vật Tư Nông Nghiệp': 'GAP DIỆT MẦM KÍCH RỄ',
        'Đơn Vị': 'CẶP',
        'Số Lượng Bán': 5,
        'Đơn Giá Bán (VNĐ)': 350000,
        'Khách Đã Trả (VNĐ)': 1750000,
        'Hạn Thanh Toán Nợ (YYYY-MM-DD)': todayStr,
        'Ghi Chú Đơn Hàng': 'Mẫu nhập đơn bán hàng từ Excel',
      },
      {
        'Kho Xuất Bán': 'Tâm An Cao Lãnh',
        'Tên Khách Hàng': 'Bà Trần Thị Bích',
        'Số Điện Thoại KH': '0907654321',
        'Nhóm KH': 'Nhà nông',
        'Tên Vật Tư Nông Nghiệp': 'Phân bón NPK 20-20-15+TE Đầu Trâu',
        'Đơn Vị': 'Bao 50kg',
        'Số Lượng Bán': 4,
        'Đơn Giá Bán (VNĐ)': 760000,
        'Khách Đã Trả (VNĐ)': 1500000,
        'Hạn Thanh Toán Nợ (YYYY-MM-DD)': todayStr,
        'Ghi Chú Đơn Hàng': 'Ghi nợ phần còn lại hẹn cuối vụ trả',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Ban_Hang');
    fileName = 'Mau_Nhap_Don_Ban_Hang_TamAn.xlsx';
  } else if (moduleType === 'imports') {
    const sampleRows = [
      {
        'Kho Nhập Hàng': 'Tâm An Mỹ Ngãi',
        'Mã Vật Tư': 'VT-GAP01',
        'Tên Vật Tư Nhập Kho': 'GAP DIỆT MẦM KÍCH RỄ',
        'Nhóm Vật Tư': 'Thuốc BVTV',
        'Đơn Vị Tính': 'CẶP',
        'Nhà Cung Cấp': 'Công ty CP Bảo vệ Thực vật Sài Gòn (SPC)',
        'SĐT Nhà Cung Cấp': '02838642030',
        'Số Lượng Nhập': 30,
        'Đơn Giá Nhập (VNĐ)': 285000,
        'Giá Bán Lẻ Đề Xuất (VNĐ)': 350000,
        'Đã Thanh Toán NCC (VNĐ)': 5000000,
        'Hạn Trả Nợ NCC (YYYY-MM-DD)': todayStr,
        'Ghi Chú Lô Nhập': 'Nhập bổ sung kho vụ Đông Xuân',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Nhap_Kho');
    fileName = 'Mau_Nhap_Kho_NCC_TamAn.xlsx';
  } else if (moduleType === 'inventory') {
    const sampleRows = [
      {
        'Kho Lưu Trữ': 'Tâm An Mỹ Ngãi',
        'Mã VT': 'VT-KALI08',
        'Tên Vật Tư Nông Nghiệp': 'Phân bón Kali Phú Mỹ (K2O 61%)',
        'Nhóm Vật Tư': 'Phân bón',
        'Đơn Vị Tính': 'Bao 50kg',
        'Giá Nhập (VNĐ)': 590000,
        'Giá Bán Lẻ (VNĐ)': 665000,
        'Tồn Kho Ban Đầu': 40,
        'Mức Cảnh Báo Tối Thiểu': 12,
        'Nhà Cung Cấp Chính': 'Tổng Công ty Phân bón & Hóa chất Dầu khí (PVFCCo)',
      },
      {
        'Kho Lưu Trữ': 'Tâm An Cao Lãnh',
        'Mã VT': 'VT-BVTV09',
        'Tên Vật Tư Nông Nghiệp': 'Thuốc dưỡng hạt Amistar Top 325SC',
        'Nhóm Vật Tư': 'Thuốc BVTV',
        'Đơn Vị Tính': 'Chai 250ml',
        'Giá Nhập (VNĐ)': 225000,
        'Giá Bán Lẻ (VNĐ)': 265000,
        'Tồn Kho Ban Đầu': 30,
        'Mức Cảnh Báo Tối Thiểu': 10,
        'Nhà Cung Cấp Chính': 'Công ty TNHH Syngenta Việt Nam',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Ton_Kho_Vat_Tu');
    fileName = 'Mau_Danh_Muc_Vat_Tu_TamAn.xlsx';
  } else if (moduleType === 'customers') {
    const sampleRows = [
      {
        'Mã KH': 'KH-006',
        'Họ Tên Khách Hàng': 'Ông Võ Văn Mười',
        'Số Điện Thoại': '0918223344',
        Email: 'muoivo.nongdan@gmail.com',
        'Địa Chỉ': 'Ấp Hòa Bình, Xã Hòa An, TP. Cao Lãnh, Đồng Tháp',
        'Nhóm Khách Hàng': 'Nhà nông',
        'Ghi Chú': 'Canh tác 4ha lúa Đài Thơm 8',
      },
      {
        'Mã KH': 'KH-007',
        'Họ Tên Khách Hàng': 'Đại lý VTNN Minh Phát',
        'Số Điện Thoại': '0903889900',
        Email: 'minhphat.vtnn@gmail.com',
        'Địa Chỉ': 'Thị trấn Mỹ An, Huyện Tháp Mười, Đồng Tháp',
        'Nhóm Khách Hàng': 'Đại lý cấp 2',
        'Ghi Chú': 'Lấy sỉ thuốc BVTV & Phân NPK định kỳ',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Khach_Hang');
    fileName = 'Mau_Ho_So_Khach_Hang_TamAn.xlsx';
  } else if (moduleType === 'debts') {
    const yymm = `${todayStr.slice(2, 4)}${todayStr.slice(5, 7)}`;
    const sampleRows = [
      {
        'Loại Công Nợ (KH / NCC)': 'KH',
        'Mã Hóa Đơn / Mã Phiếu Nhập': `HD-${yymm}-001`,
        'Tên Đối Tác': 'Ông Nguyễn Văn Hòa',
        'Số Tiền Thanh Toán Đợt Này (VNĐ)': 2000000,
        'Ghi Chú Thanh Toán': 'Thu nợ một phần qua chuyển khoản',
      },
      {
        'Loại Công Nợ (KH / NCC)': 'NCC',
        'Mã Hóa Đơn / Mã Phiếu Nhập': `PN-${yymm}-001`,
        'Tên Đối Tác': 'Công ty CP Phân bón Bình Điền',
        'Số Tiền Thanh Toán Đợt Này (VNĐ)': 5000000,
        'Ghi Chú Thanh Toán': 'Chuyển khoản trả nợ lô phân NPK',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Thu_Tra_Cong_No');
    fileName = 'Mau_Cap_Nhat_Cong_No_TamAn.xlsx';
  }

  XLSX.writeFile(wb, fileName);
  return fileName;
}

// Export current module data to Excel (.xlsx)
export function exportModuleDataExcel(params: {
  moduleType: ExcelModuleType;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
}): string {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);
  let fileName = `DuLieu_${params.moduleType}_${today}.xlsx`;

  if (params.moduleType === 'sales') {
    const rows = params.sales.map((s) => ({
      'Mã Hóa Đơn': s.invoiceCode,
      'Kho Xuất Bán': s.warehouseName || 'Tâm An Mỹ Ngãi',
      'Tên Khách Hàng': s.customerName,
      'Số Điện Thoại KH': s.customerPhone,
      'Tên Vật Tư Nông Nghiệp': s.productName,
      'Đơn Vị': s.unit,
      'Số Lượng Bán': s.quantity,
      'Đơn Giá Bán (VNĐ)': s.unitPrice,
      'Thành Tiền (VNĐ)': s.totalAmount,
      'Khách Đã Trả (VNĐ)': s.paidAmount,
      'Còn Nợ (VNĐ)': s.debtAmount,
      'Hạn Thanh Toán Nợ (YYYY-MM-DD)': s.dueDate,
      'Ghi Chú Đơn Hàng': s.note,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Nhat_Ky_Ban_Hang');
    fileName = `NhatKy_BanHang_TamAn_${today}.xlsx`;
  } else if (params.moduleType === 'imports') {
    const rows = params.imports.map((i) => ({
      'Mã Phiếu Nhập': i.receiptCode,
      'Kho Nhập Hàng': i.warehouseName || 'Tâm An Mỹ Ngãi',
      'Tên Vật Tư Nhập Kho': i.productName,
      'Đơn Vị Tính': i.unit,
      'Nhà Cung Cấp': i.supplierName,
      'SĐT Nhà Cung Cấp': i.supplierPhone,
      'Số Lượng Nhập': i.quantity,
      'Đơn Giá Nhập (VNĐ)': i.unitCost,
      'Tổng Tiền Nhập (VNĐ)': i.totalCost,
      'Đã Thanh Toán NCC (VNĐ)': i.paidAmount,
      'Còn Nợ NCC (VNĐ)': i.debtAmount,
      'Hạn Trả Nợ NCC (YYYY-MM-DD)': i.dueDate,
      'Ghi Chú Lô Nhập': i.note,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Nhat_Ky_Nhap_Kho');
    fileName = `NhatKy_NhapKho_TamAn_${today}.xlsx`;
  } else if (params.moduleType === 'inventory') {
    const rows = params.products.map((p) => ({
      'Mã VT': p.code,
      'Kho Lưu Trữ': p.warehouseName || 'Tâm An Mỹ Ngãi',
      'Tên Vật Tư Nông Nghiệp': p.name,
      'Nhóm Vật Tư': p.category,
      'Đơn Vị Tính': p.unit,
      'Giá Nhập (VNĐ)': p.importPrice,
      'Giá Bán Lẻ (VNĐ)': p.sellPrice,
      'Tồn Kho Ban Đầu': p.stock,
      'Mức Cảnh Báo Tối Thiểu': p.minStock,
      'Nhà Cung Cấp Chính': p.supplierName,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Ton_Kho_Vat_Tu');
    fileName = `TonKho_VatTu_TamAn_${today}.xlsx`;
  } else if (params.moduleType === 'customers') {
    const rows = params.customers.map((c) => ({
      'Mã KH': c.code,
      'Họ Tên Khách Hàng': c.name,
      'Số Điện Thoại': c.phone,
      Email: c.email,
      'Địa Chỉ': c.address,
      'Nhóm Khách Hàng': c.group,
      'Tổng Mua (VNĐ)': c.totalPurchased,
      'Dư Nợ Hiện Tại (VNĐ)': c.totalDebt,
      'Ghi Chú': c.note,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Ho_So_Khach_Hang');
    fileName = `DanhSach_KhachHang_TamAn_${today}.xlsx`;
  } else if (params.moduleType === 'debts') {
    const rows = [
      ...params.sales
        .filter((s) => s.debtAmount > 0)
        .map((s) => ({
          'Loại Công Nợ (KH / NCC)': 'KH',
          'Mã Hóa Đơn / Mã Phiếu Nhập': s.invoiceCode,
          'Tên Đối Tác': s.customerName,
          'Số Điện Thoại': s.customerPhone,
          'Dư Nợ Hiện Tại (VNĐ)': s.debtAmount,
          'Hạn Thanh Toán': s.dueDate,
          'Số Tiền Thanh Toán Đợt Này (VNĐ)': 0,
          'Ghi Chú Thanh Toán': s.note,
        })),
      ...params.imports
        .filter((i) => i.debtAmount > 0)
        .map((i) => ({
          'Loại Công Nợ (KH / NCC)': 'NCC',
          'Mã Hóa Đơn / Mã Phiếu Nhập': i.receiptCode,
          'Tên Đối Tác': i.supplierName,
          'Số Điện Thoại': i.supplierPhone,
          'Dư Nợ Hiện Tại (VNĐ)': i.debtAmount,
          'Hạn Thanh Toán': i.dueDate,
          'Số Tiền Thanh Toán Đợt Này (VNĐ)': 0,
          'Ghi Chú Thanh Toán': i.note,
        })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Bang_Cong_No');
    fileName = `Bang_CongNo_TamAn_${today}.xlsx`;
  }

  XLSX.writeFile(wb, fileName);
  return fileName;
}

// Parse an uploaded .xlsx / .xls / .csv file into JSON rows
export async function parseUploadedExcelRows(
  file: File
): Promise<Record<string, unknown>[]> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

// 5. Phiếu Tổng Hợp Danh Sách Các Mặt Hàng Đã Nhận & Còn Nợ (Từ ngày ... Đến ngày ...) — PDF
export function exportCombinedReceivedItemsAndDebtPDF(params: {
  voucherCode?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  fromDate: string;
  toDate: string;
  items: ReceivedItemReportRow[];
  onlyUnpaid?: boolean;
  collectedThisSession?: number;
  staffName: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const code = params.voucherCode || `PTH-${Date.now().toString().slice(-4)}`;
  const periodLabel = `${params.fromDate || 'Đầu kỳ'} đến ${params.toDate || today}`;
  const fileName = `PhieuTongHop_HangDaNhan_CongNo_${params.fromDate || 'All'}_${params.toDate || today}.pdf`;

  const totalQty = params.items.reduce((s, r) => s + r.quantity, 0);
  const totalAmount = params.items.reduce((s, r) => s + r.totalAmount, 0);
  const totalPaid = params.items.reduce((s, r) => s + r.paidAmount, 0);
  const totalDebt = params.items.reduce((s, r) => s + r.debtAmount, 0);
  const collectedNow = Math.max(0, Number(params.collectedThisSession) || 0);
  const finalRemainingDebt = Math.max(0, totalDebt - collectedNow);

  const estimatedCombinedHeight = 260 + Math.max(1, params.items.length) * 44 + 260;

  return saveTallCanvasAsMultiPageA4PDF(
    'landscape',
    fileName,
    params.onlyUnpaid
      ? 'PHIẾU TỔNG HỢP HÀNG HÓA CÒN NỢ & THU NỢ'
      : 'PHIẾU TỔNG HỢP CÁC MẶT HÀNG ĐÃ NHẬN & CÔNG NỢ',
    estimatedCombinedHeight,
    (ctx, pageWidth) => {
      const marginX = 44;
      ctx.fillStyle = '#15803D';
      ctx.font = `800 19px ${FONT_FAMILY}`;
      ctx.fillText('CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN — NHÀ NÔNG AN TÂM', marginX, 38);

      ctx.fillStyle = '#0F172A';
      ctx.font = `800 16px ${FONT_FAMILY}`;
      ctx.fillText(
        params.onlyUnpaid
          ? `PHIẾU TỔNG HỢP DANH SÁCH HÀNG HÓA CÒN NỢ & THU NỢ (TỪ NGÀY ${periodLabel.toUpperCase()})`
          : `BÁO CÁO & PHIẾU TỔNG HỢP CÁC MẶT HÀNG ĐÃ NHẬN (TỪ NGÀY ${periodLabel.toUpperCase()})`,
        marginX,
        62
      );

      ctx.fillStyle = '#334155';
      ctx.font = `600 12.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `Mã phiếu tổng hợp: ${code}  |  Khách hàng / Đối tác: ${params.customerName}  |  SĐT: ${
          params.customerPhone || '---'
        }  |  Người lập: ${params.staffName}`,
        marginX,
        84
      );
      if (params.customerAddress) {
        ctx.font = `500 12px ${FONT_FAMILY}`;
        ctx.fillText(`Địa chỉ: ${params.customerAddress}`, marginX, 102);
      }

      const columns: CanvasTableColumn[] = [
        { header: 'STT', width: 42, align: 'center' },
        { header: 'Ngày Nhận', width: 92, align: 'center' },
        { header: 'Mã HĐ', width: 96, align: 'left' },
        { header: 'Khách Hàng', width: 150, align: 'left' },
        { header: 'Tên Mặt Hàng Đã Nhận', width: 220, align: 'left' },
        { header: 'SL & ĐVT', width: 88, align: 'center' },
        { header: 'Đơn Giá', width: 92, align: 'right' },
        { header: 'Thành Tiền', width: 102, align: 'right' },
        { header: 'Đã Trả', width: 88, align: 'right' },
        { header: 'Còn Nợ', width: 95, align: 'right' },
      ];

      const displayRows = params.items.map((item, idx) => [
        String(idx + 1),
        item.date,
        item.invoiceCode,
        item.customerName,
        item.productName,
        `${item.quantity} ${item.unit}`,
        item.unitPrice.toLocaleString('vi-VN'),
        item.totalAmount.toLocaleString('vi-VN'),
        item.paidAmount.toLocaleString('vi-VN'),
        item.debtAmount.toLocaleString('vi-VN'),
      ]);

      const tableStartY = params.customerAddress ? 114 : 98;
      const tableEndY = drawCanvasTable(
        ctx,
        marginX,
        tableStartY,
        columns,
        displayRows.length > 0
          ? displayRows
          : [['1', today, '---', params.customerName, 'Không có mặt hàng trong kỳ', '0', '0', '0', '0', '0']],
        '#15803D'
      );

      const summaryY = tableEndY + 26;
      ctx.font = `700 13.5px ${FONT_FAMILY}`;
      ctx.fillStyle = '#0F172A';
      ctx.fillText(
        `Tổng số mặt hàng đã nhận: ${params.items.length} dòng (${totalQty} đơn vị)   |   Tổng thành tiền: ${formatCurrencyPlain(
          totalAmount
        )}`,
        marginX,
        summaryY
      );

      ctx.fillStyle = '#15803D';
      ctx.fillText(
        `Đã thanh toán trước: ${formatCurrencyPlain(totalPaid)}${
          collectedNow > 0 ? `   |   Thu nợ đợt này: ${formatCurrencyPlain(collectedNow)}` : ''
        }`,
        marginX,
        summaryY + 22
      );

      ctx.fillStyle = finalRemainingDebt > 0 ? '#DC2626' : '#15803D';
      ctx.font = `800 14.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `TỔNG CÔNG NỢ CÒN LẠI PHẢI THU: ${formatCurrencyPlain(finalRemainingDebt)}`,
        marginX,
        summaryY + 46
      );

      drawSignatureFooterOnCanvas(
        ctx,
        pageWidth,
        summaryY + 60,
        'KHÁCH HÀNG XÁC NHẬN HÀNG ĐÃ NHẬN & CÔNG NỢ',
        'ĐẠI DIỆN VTNN TÂM AN',
        params.customerName,
        params.staffName
      );
    }
  );
}

// 6. Xuất Excel Danh Sách Tổng Hợp Các Mặt Hàng Đã Nhận & Còn Nợ (Từ ngày ... Đến ngày ...)
export function exportCombinedReceivedItemsAndDebtExcel(params: {
  customerName: string;
  fromDate: string;
  toDate: string;
  items: ReceivedItemReportRow[];
  onlyUnpaid?: boolean;
  staffName: string;
}): string {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);
  const totalAmount = params.items.reduce((s, r) => s + r.totalAmount, 0);
  const totalPaid = params.items.reduce((s, r) => s + r.paidAmount, 0);
  const totalDebt = params.items.reduce((s, r) => s + r.debtAmount, 0);

  const rows = params.items.map((item, idx) => ({
    STT: idx + 1,
    'Ngày Nhận Hàng': item.date,
    'Mã Hóa Đơn': item.invoiceCode,
    'Kho Xuất': item.warehouseName,
    'Khách Hàng': item.customerName,
    'Số Điện Thoại': item.customerPhone,
    'Tên Mặt Hàng Đã Nhận': item.productName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Đơn Giá (VNĐ)': item.unitPrice,
    'Thành Tiền (VNĐ)': item.totalAmount,
    'Đã Thanh Toán (VNĐ)': item.paidAmount,
    'Còn Nợ (VNĐ)': item.debtAmount,
    'Hạn Thanh Toán': item.dueDate || '---',
    'Nhân Viên': item.staffName,
    'Ghi Chú': item.note,
  }));

  rows.push({
    STT: rows.length + 1,
    'Ngày Nhận Hàng': `${params.fromDate} -> ${params.toDate}`,
    'Mã Hóa Đơn': 'TỔNG CỘNG',
    'Kho Xuất': '',
    'Khách Hàng': params.customerName,
    'Số Điện Thoại': '',
    'Tên Mặt Hàng Đã Nhận': `Tổng hợp ${params.items.length} mặt hàng đã nhận`,
    'Đơn Vị Tính': '',
    'Số Lượng': params.items.reduce((s, r) => s + r.quantity, 0),
    'Đơn Giá (VNĐ)': 0,
    'Thành Tiền (VNĐ)': totalAmount,
    'Đã Thanh Toán (VNĐ)': totalPaid,
    'Còn Nợ (VNĐ)': totalDebt,
    'Hạn Thanh Toán': '',
    'Nhân Viên': params.staffName,
    'Ghi Chú': params.onlyUnpaid ? 'Danh sách hàng hóa còn nợ' : 'Tất cả mặt hàng đã nhận',
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Hang_Da_Nhan_Cong_No');

  const fileName = `BaoCao_HangHoaDaNhan_CongNo_${params.fromDate || 'All'}_${params.toDate || today}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// 7. Xuất Báo Cáo Tổng Hợp Chuyên Nghiệp Từ Ngày ... Đến Ngày ... (Theo Phân Quyền Nhân Viên / Quản Lý) — Excel
export function exportComprehensiveDateRangeReportExcel(params: {
  fromDate: string;
  toDate: string;
  staffName: string;
  staffRoleLabel: string;
  warehouseLabel: string;
  allowedCategories: ReportModuleCategory[];
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  savedVouchers?: SavedVoucherRecord[];
  recommendations?: SmartReportRecommendation[];
}): string {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);
  const periodText = `Từ ngày ${params.fromDate} đến ngày ${params.toDate}`;

  const receiptVouchers = params.receiptVouchers || [];
  const paymentVouchers = params.paymentVouchers || [];
  const totalRevenue = params.sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCollected = params.sales.reduce((sum, s) => sum + s.paidAmount, 0);
  const otherReceiptInflow = receiptVouchers
    .filter((rv) => !rv.isDebtSettlement)
    .reduce((sum, rv) => sum + rv.amount, 0);
  const totalCashInflow = totalCollected + otherReceiptInflow;
  const totalCustomerDebt = params.sales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = params.imports.reduce((sum, i) => sum + i.totalCost, 0);
  const totalPaidSupplier = params.imports.reduce((sum, i) => sum + i.paidAmount, 0);
  const operatingPaymentOutflow = paymentVouchers
    .filter((pv) => !pv.isDebtSettlement)
    .reduce((sum, pv) => sum + pv.amount, 0);
  const totalCashOutflow = totalPaidSupplier + operatingPaymentOutflow;
  const netCashflow = totalCashInflow - totalCashOutflow;
  const totalSupplierDebt = params.imports.reduce((sum, i) => sum + i.debtAmount, 0);

  const canSeeProfit = params.allowedCategories.includes('financial_profit');
  const estimatedGrossProfit = params.sales.reduce((sum, sale) => {
    const cost = Math.round(resolveSaleUnitCost(sale, params.products) * sale.quantity);
    const giftCost =
      sale.giftQuantity && sale.giftQuantity > 0
        ? Math.round(resolveSaleGiftUnitCost(sale, params.products) * sale.giftQuantity)
        : 0;
    return sum + (sale.totalAmount - cost - giftCost);
  }, 0);

  // Sheet 1: Tổng hợp & Đề xuất báo cáo cấp trên
  const overviewRows: (string | number)[][] = [
    ['CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN — NHÀ NÔNG AN TÂM'],
    [`BÁO CÁO TỔNG HỢP CHUYÊN SÂU (${periodText.toUpperCase()})`],
    [`Người lập báo cáo: ${params.staffName} (${params.staffRoleLabel})`],
    [`Phạm vi kho phụ trách: ${params.warehouseLabel} | Ngày xuất: ${today}`],
    [],
    ['CHỈ TIÊU TỔNG HỢP TRONG KỲ', 'GIÁ TRỊ (VNĐ / ĐƠN VỊ)'],
  ];

  if (params.allowedCategories.includes('sales_log')) {
    overviewRows.push(
      ['Tổng số hóa đơn bán hàng trong kỳ', params.sales.length],
      ['Tổng doanh thu bán hàng', totalRevenue],
      ['Đã thu tiền khách hàng', totalCollected]
    );
  }
  if (params.allowedCategories.includes('debts_receivable_payable')) {
    overviewRows.push(
      ['Công nợ phải thu khách hàng phát sinh trong kỳ', totalCustomerDebt],
      ['Công nợ phải trả Nhà cung cấp phát sinh trong kỳ', totalSupplierDebt]
    );
  }
  if (params.allowedCategories.includes('imports_log')) {
    overviewRows.push(
      ['Tổng số phiếu nhập kho trong kỳ', params.imports.length],
      ['Tổng giá trị nhập hàng', totalImportCost],
      ['Đã thanh toán Nhà cung cấp', totalPaidSupplier]
    );
  }
  if (params.allowedCategories.includes('cashflow_treasury')) {
    overviewRows.push(
      ['Tổng dòng tiền vào (Thu bán hàng + Thu khác)', totalCashInflow],
      ['Tổng dòng tiền ra (Trả NCC + Chi vận hành)', totalCashOutflow],
      ['Dòng tiền ròng (Tổng thu - Tổng chi)', netCashflow]
    );
  }
  if (params.allowedCategories.includes('inventory_stock')) {
    overviewRows.push(['Tổng số mặt hàng quản lý trong kho', params.products.length]);
  }
  if (canSeeProfit) {
    overviewRows.push(['Lợi nhuận gộp ước tính (Chỉ Quản lý chính)', Math.round(estimatedGrossProfit)]);
  }

  if (params.recommendations && params.recommendations.length > 0) {
    overviewRows.push([], ['ĐỀ XUẤT BÁO CÁO & HÀNH ĐỘNG TỐT NHẤT TRONG KỲ', 'MỨC ƯU TIÊN', 'CHI TIẾT & HÀNH ĐỘNG ĐỀ XUẤT']);
    params.recommendations.forEach((rec) => {
      overviewRows.push([
        rec.title,
        rec.priority === 'high' ? 'KHẨN CẤP' : rec.priority === 'medium' ? 'QUAN TRỌNG' : 'ĐỊNH KỲ',
        `${rec.summary} -> Hành động: ${rec.suggestedAction}`,
      ]);
    });
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewRows), 'Tong_Hop_De_Xuat');

  // Sheet 2: Nhật ký bán hàng
  if (params.allowedCategories.includes('sales_log')) {
    const salesRows = params.sales.map((s, idx) => ({
      STT: idx + 1,
      'Ngày Bán': (s.createdAt || '').slice(0, 10),
      'Mã Hóa Đơn': s.invoiceCode,
      'Kho Xuất Bán': s.warehouseName || 'Tâm An Mỹ Ngãi',
      'Khách Hàng': s.customerName,
      'SĐT Khách Hàng': s.customerPhone,
      'Mặt Hàng Đã Nhận': s.productName,
      'Đơn Vị': s.unit,
      'Số Lượng': s.quantity,
      'Đơn Giá (VNĐ)': s.unitPrice,
      'Thành Tiền (VNĐ)': s.totalAmount,
      'Đã Thu (VNĐ)': s.paidAmount,
      'Còn Nợ (VNĐ)': s.debtAmount,
      'Hạn Thanh Toán': s.dueDate,
      'Nhân Viên Lập': s.staffName,
      'Liên Kết Kiểm Tra Chi Tiết': `Mục Nhật ký Bán hàng -> Mã ${s.invoiceCode}`,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), 'Nhat_Ky_Ban_Hang');
  }

  // Sheet 3: Nhật ký nhập hàng
  if (params.allowedCategories.includes('imports_log')) {
    const importRows = params.imports.map((i, idx) => ({
      STT: idx + 1,
      'Ngày Nhập': (i.createdAt || '').slice(0, 10),
      'Mã Phiếu Nhập': i.receiptCode,
      'Kho Nhập Hàng': i.warehouseName || 'Tâm An Mỹ Ngãi',
      'Nhà Cung Cấp': i.supplierName,
      'SĐT NCC': i.supplierPhone,
      'Vật Tư Nhập Kho': i.productName,
      'Đơn Vị': i.unit,
      'Số Lượng Nhập': i.quantity,
      'Giá Nhập (VNĐ)': i.unitCost,
      'Tổng Tiền Nhập (VNĐ)': i.totalCost,
      'Đã Trả NCC (VNĐ)': i.paidAmount,
      'Còn Nợ NCC (VNĐ)': i.debtAmount,
      'Hạn Trả Nợ NCC': i.dueDate,
      'Nhân Viên Nhập': i.staffName,
      'Liên Kết Kiểm Tra Chi Tiết': `Mục Nhật ký Nhập hàng -> Mã ${i.receiptCode}`,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(importRows), 'Nhat_Ky_Nhap_Hang');
  }

  // Sheet 4: Quản lý tồn kho
  if (params.allowedCategories.includes('inventory_stock')) {
    const stockRows = params.products.map((p, idx) => {
      const alert = evaluateStockAlert(p);
      return {
        STT: idx + 1,
        'Mã Vật Tư': p.code,
        'Kho Lưu Trữ': p.warehouseName || 'Tâm An Mỹ Ngãi',
        'Tên Vật Tư Nông Nghiệp': p.name,
        'Nhóm Hàng': p.category,
        'Đơn Vị': p.unit,
        'Tồn Kho Hiện Tại': p.stock,
        'Định Mức Tối Thiểu': p.minStock,
        'Trạng Thái Kho':
          alert === 'out_of_stock'
            ? 'HẾT HÀNG'
            : alert === 'low_stock'
            ? 'SẮP HẾT HÀNG'
            : 'Đủ định mức',
        'Giá Nhập (VNĐ)': p.importPrice,
        'Giá Bán (VNĐ)': p.sellPrice,
        'Giá Trị Tồn Kho (VNĐ)': p.stock * p.importPrice,
        'Nhà Cung Cấp': p.supplierName,
        'Liên Kết Kiểm Tra Chi Tiết': `Mục Quản lý Tồn kho -> Mã ${p.code}`,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), 'Quan_Ly_Ton_Kho');
  }

  // Sheet 5: Quản lý khách hàng & Mặt hàng đã nhận
  if (params.allowedCategories.includes('customers_items')) {
    const custRows = params.customers.map((c, idx) => ({
      STT: idx + 1,
      'Mã KH': c.code,
      'Họ Tên Khách Hàng': c.name,
      'Số Điện Thoại': c.phone,
      'Nhóm Khách Hàng': c.group,
      'Địa Chỉ': c.address,
      'Tổng Mua Tích Lũy (VNĐ)': c.totalPurchased,
      'Dư Nợ Hiện Tại (VNĐ)': c.totalDebt,
      'Ghi Chú': c.note,
      'Liên Kết Kiểm Tra Chi Tiết': `Mục Quản lý Khách hàng -> Mã ${c.code}`,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custRows), 'Quan_Ly_Khach_Hang');
  }

  // Sheet 6: Hàng hóa còn nợ & Quản lý công nợ
  if (params.allowedCategories.includes('debts_receivable_payable')) {
    const unpaidRows = [
      ...params.sales
        .filter((s) => s.debtAmount > 0)
        .map((s, idx) => ({
          STT: idx + 1,
          'Loại Công Nợ': 'Phải thu Khách hàng',
          'Ngày Chứng Từ': (s.createdAt || '').slice(0, 10),
          'Mã Chứng Từ': s.invoiceCode,
          'Đối Tác / Khách Hàng': s.customerName,
          'Số Điện Thoại': s.customerPhone,
          'Mặt Hàng Còn Nợ': `${s.productName} (${s.quantity} ${s.unit})`,
          'Tổng Giá Trị (VNĐ)': s.totalAmount,
          'Đã Thanh Toán (VNĐ)': s.paidAmount,
          'Dư Nợ Còn Lại (VNĐ)': s.debtAmount,
          'Hạn Hẹn Trả Nợ': s.dueDate,
          'Liên Kết Kiểm Tra Chi Tiết': `Mục Quản lý Công nợ -> Mã ${s.invoiceCode}`,
        })),
      ...params.imports
        .filter((i) => i.debtAmount > 0)
        .map((i, idx) => ({
          STT: idx + 1,
          'Loại Công Nợ': 'Phải trả Nhà cung cấp',
          'Ngày Chứng Từ': (i.createdAt || '').slice(0, 10),
          'Mã Chứng Từ': i.receiptCode,
          'Đối Tác / Khách Hàng': i.supplierName,
          'Số Điện Thoại': i.supplierPhone,
          'Mặt Hàng Còn Nợ': `${i.productName} (${i.quantity} ${i.unit})`,
          'Tổng Giá Trị (VNĐ)': i.totalCost,
          'Đã Thanh Toán (VNĐ)': i.paidAmount,
          'Dư Nợ Còn Lại (VNĐ)': i.debtAmount,
          'Hạn Hẹn Trả Nợ': i.dueDate,
          'Liên Kết Kiểm Tra Chi Tiết': `Mục Quản lý Công nợ -> Mã ${i.receiptCode}`,
        })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unpaidRows), 'Hang_Con_No_Cong_No');
  }

  // Sheet 7: Thu - Chi Dòng Tiền
  if (params.allowedCategories.includes('cashflow_treasury')) {
    const cashRows = [
      ...params.sales
        .filter((s) => s.paidAmount > 0)
        .map((s) => ({
          'Ngày Giao Dịch': (s.createdAt || '').slice(0, 10),
          'Loại Dòng Tiền': 'THU TIỀN BÁN HÀNG / THU NỢ KH',
          'Mã Chứng Từ': s.invoiceCode,
          'Đối Tác': s.customerName,
          'Nội Dung': `Thu tiền bán ${s.quantity} ${s.unit} ${s.productName}`,
          'Số Tiền Thu (+ VNĐ)': s.paidAmount,
          'Số Tiền Chi (- VNĐ)': 0,
          'Kho': s.warehouseName || 'Tâm An Mỹ Ngãi',
        })),
      ...receiptVouchers
        .filter((rv) => !rv.isDebtSettlement && rv.amount > 0)
        .map((rv) => ({
          'Ngày Giao Dịch': (rv.createdAt || '').slice(0, 10),
          'Loại Dòng Tiền': `PHIẾU THU KHÁC (${rv.groupName})`,
          'Mã Chứng Từ': rv.voucherCode,
          'Đối Tác': rv.partnerName,
          'Nội Dung': rv.note || rv.groupName,
          'Số Tiền Thu (+ VNĐ)': rv.amount,
          'Số Tiền Chi (- VNĐ)': 0,
          'Kho': rv.warehouseName || 'Tâm An Mỹ Ngãi',
        })),
      ...params.imports
        .filter((i) => i.paidAmount > 0)
        .map((i) => ({
          'Ngày Giao Dịch': (i.createdAt || '').slice(0, 10),
          'Loại Dòng Tiền': 'CHI TIỀN NHẬP KHO / TRẢ NỢ NCC',
          'Mã Chứng Từ': i.receiptCode,
          'Đối Tác': i.supplierName,
          'Nội Dung': `Chi trả nhập ${i.quantity} ${i.unit} ${i.productName}`,
          'Số Tiền Thu (+ VNĐ)': 0,
          'Số Tiền Chi (- VNĐ)': i.paidAmount,
          'Kho': i.warehouseName || 'Tâm An Mỹ Ngãi',
        })),
      ...paymentVouchers
        .filter((pv) => !pv.isDebtSettlement && pv.amount > 0)
        .map((pv) => ({
          'Ngày Giao Dịch': (pv.createdAt || '').slice(0, 10),
          'Loại Dòng Tiền': `PHIẾU CHI VẬN HÀNH (${pv.groupName})`,
          'Mã Chứng Từ': pv.voucherCode,
          'Đối Tác': pv.partnerName,
          'Nội Dung': pv.note || pv.groupName,
          'Số Tiền Thu (+ VNĐ)': 0,
          'Số Tiền Chi (- VNĐ)': pv.amount,
          'Kho': pv.warehouseName || 'Tâm An Mỹ Ngãi',
        })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cashRows), 'Thu_Chi_Dong_Tien');
  }

  // Sheet 8: Báo cáo tài chính & Lợi nhuận (Chỉ Quản lý chính)
  if (canSeeProfit) {
    const finRows = params.sales.map((s, idx) => {
      const unitCost = resolveSaleUnitCost(s, params.products);
      const giftCost =
        s.giftQuantity && s.giftQuantity > 0
          ? Math.round(resolveSaleGiftUnitCost(s, params.products) * s.giftQuantity)
          : 0;
      const totalCost = Math.round(unitCost * s.quantity) + giftCost;
      const profit = s.totalAmount - totalCost;
      return {
        STT: idx + 1,
        'Ngày Bán': (s.createdAt || '').slice(0, 10),
        'Mã Hóa Đơn': s.invoiceCode,
        'Khách Hàng': s.customerName,
        'Mặt Hàng': s.productName,
        'Số Lượng': `${s.quantity} ${s.unit}`,
        'Doanh Thu Bán (VNĐ)': s.totalAmount,
        'Giá Vốn & KM Ước Tính (VNĐ)': totalCost,
        'Lợi Nhuận Gộp (VNĐ)': profit,
        'Tỷ Suất LN (%)': s.totalAmount > 0 ? `${Math.round((profit / s.totalAmount) * 100)}%` : '0%',
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finRows), 'Bao_Cao_Tai_Chinh');
  }

  const fileName = `BaoCao_TongHop_TamAn_${params.fromDate || 'All'}_den_${params.toDate || today}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// 8. Xuất Báo Cáo Tổng Hợp Chuyên Nghiệp Từ Ngày ... Đến Ngày ... — PDF
export function exportComprehensiveDateRangeReportPDF(params: {
  fromDate: string;
  toDate: string;
  staffName: string;
  staffRoleLabel: string;
  warehouseLabel: string;
  allowedCategories: ReportModuleCategory[];
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = `Từ ${params.fromDate || 'Đầu kỳ'} đến ${params.toDate || today}`;
  const fileName = `BaoCao_TongHop_TamAn_${params.fromDate || 'All'}_den_${params.toDate || today}.pdf`;

  const receiptVouchers = params.receiptVouchers || [];
  const paymentVouchers = params.paymentVouchers || [];
  const totalRevenue = params.sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCollected = params.sales.reduce((sum, s) => sum + s.paidAmount, 0);
  const otherReceiptInflow = receiptVouchers
    .filter((rv) => !rv.isDebtSettlement)
    .reduce((sum, rv) => sum + rv.amount, 0);
  const totalCashInflow = totalCollected + otherReceiptInflow;
  const totalCustomerDebt = params.sales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = params.imports.reduce((sum, i) => sum + i.totalCost, 0);
  const totalPaidSupplier = params.imports.reduce((sum, i) => sum + i.paidAmount, 0);
  const operatingPaymentOutflow = paymentVouchers
    .filter((pv) => !pv.isDebtSettlement)
    .reduce((sum, pv) => sum + pv.amount, 0);
  const totalCashOutflow = totalPaidSupplier + operatingPaymentOutflow;
  const netCashflow = totalCashInflow - totalCashOutflow;
  const totalSupplierDebt = params.imports.reduce((sum, i) => sum + i.debtAmount, 0);

  const estimatedCompHeight =
    260 +
    Math.max(1, params.sales.length) * 44 +
    90 +
    Math.max(1, params.imports.length) * 44 +
    80;

  return saveTallCanvasAsMultiPageA4PDF(
    'landscape',
    fileName,
    `BÁO CÁO TỔNG HỢP (${periodLabel})`,
    estimatedCompHeight,
    (ctx, pageWidth) => {
      const marginX = 44;
      ctx.fillStyle = '#15803D';
      ctx.font = `800 19px ${FONT_FAMILY}`;
      ctx.fillText('CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN — NHÀ NÔNG AN TÂM', marginX, 38);

      ctx.fillStyle = '#0F172A';
      ctx.font = `800 15.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `BÁO CÁO TỔNG HỢP CÔNG VIỆC & KINH DOANH (${periodLabel.toUpperCase()})`,
        marginX,
        62
      );

      ctx.fillStyle = '#334155';
      ctx.font = `600 12px ${FONT_FAMILY}`;
      ctx.fillText(
        `Người lập báo cáo: ${params.staffName} (${params.staffRoleLabel})  |  Kho phụ trách: ${params.warehouseLabel}  |  Ngày xuất: ${today}`,
        marginX,
        82
      );

      const kpiCols: CanvasTableColumn[] = [
        { header: 'Doanh Thu Bán Hàng', width: 205, align: 'right' },
        { header: 'Thực Thu Tiền Hàng', width: 205, align: 'right' },
        { header: 'Nợ Phải Thu KH', width: 205, align: 'right' },
        { header: 'Tổng Giá Trị Nhập Kho', width: 210, align: 'right' },
        { header: 'Nợ Phải Trả NCC', width: 210, align: 'right' },
      ];

      let y = drawCanvasTable(
        ctx,
        marginX,
        96,
        kpiCols,
        [
          [
            formatVND(totalRevenue),
            formatVND(totalCollected),
            formatVND(totalCustomerDebt),
            formatVND(totalImportCost),
            formatVND(totalSupplierDebt),
          ],
        ],
        '#15803D'
      );

      // Section 1: Danh sách mặt hàng đã nhận & còn nợ trong kỳ
      y += 22;
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 13.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `1. DANH SÁCH MẶT HÀNG ĐÃ BÁN / KHÁCH ĐÃ NHẬN & CÔNG NỢ TRONG KỲ (${params.sales.length} ĐƠN)`,
        marginX,
        y
      );
      y += 10;

      const salesCols: CanvasTableColumn[] = [
        { header: 'Ngày', width: 88, align: 'center' },
        { header: 'Mã HĐ', width: 98, align: 'left' },
        { header: 'Khách Hàng', width: 170, align: 'left' },
        { header: 'Mặt Hàng Đã Nhận', width: 230, align: 'left' },
        { header: 'SL', width: 85, align: 'center' },
        { header: 'Thành Tiền', width: 120, align: 'right' },
        { header: 'Đã Thu', width: 120, align: 'right' },
        { header: 'Còn Nợ', width: 124, align: 'right' },
      ];

      y = drawCanvasTable(
        ctx,
        marginX,
        y,
        salesCols,
        params.sales.map((s) => [
          (s.createdAt || '').slice(0, 10),
          s.invoiceCode,
          s.customerName,
          s.productName,
          `${s.quantity} ${s.unit}`,
          s.totalAmount.toLocaleString('vi-VN'),
          s.paidAmount.toLocaleString('vi-VN'),
          s.debtAmount.toLocaleString('vi-VN'),
        ]),
        '#0F172A'
      );

      // Section 2: Nhập kho & Dòng tiền
      y += 22;
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 13.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `2. NHẬT KÝ NHẬP HÀNG & THU - CHI DÒNG TIỀN (Dòng tiền ròng: ${formatVND(
          netCashflow
        )})`,
        marginX,
        y
      );
      y += 10;

      const impCols: CanvasTableColumn[] = [
        { header: 'Ngày Nhập', width: 88, align: 'center' },
        { header: 'Mã Phiếu', width: 98, align: 'left' },
        { header: 'Nhà Cung Cấp', width: 220, align: 'left' },
        { header: 'Vật Tư Nhập Kho', width: 210, align: 'left' },
        { header: 'SL', width: 85, align: 'center' },
        { header: 'Tổng Tiền Nhập', width: 112, align: 'right' },
        { header: 'Đã Trả NCC', width: 110, align: 'right' },
        { header: 'Còn Nợ NCC', width: 112, align: 'right' },
      ];

      drawCanvasTable(
        ctx,
        marginX,
        y,
        impCols,
        params.imports.map((i) => [
          (i.createdAt || '').slice(0, 10),
          i.receiptCode,
          i.supplierName,
          i.productName,
          `${i.quantity} ${i.unit}`,
          i.totalCost.toLocaleString('vi-VN'),
          i.paidAmount.toLocaleString('vi-VN'),
          i.debtAmount.toLocaleString('vi-VN'),
        ]),
        '#B45309'
      );
    }
  );
}

// 9. In Báo Cáo Tài Chính Năm theo chuẩn Biểu mẫu Cơ Quan Thuế (Mẫu B02-DN / B01-DN / B03-DN) — PDF A4
export function exportTaxAuthorityFinancialReportPDF(params: {
  statement: TaxAuthorityFinancialStatementResult;
  staffName: string;
  warehouseLabel: string;
}): string {
  const { statement, staffName, warehouseLabel } = params;
  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = `Năm tài chính ${statement.fiscalYear} (Từ ${statement.fromDate || `${statement.fiscalYear}-01-01`} đến ${statement.toDate || `${statement.fiscalYear}-12-31`})`;
  const fileName = `BaoCao_TaiChinh_Thue_Nam_${statement.fiscalYear}_VTNN_TamAn.pdf`;

  return saveCanvasAsA4PDF(
    'portrait',
    fileName,
    `BÁO CÁO TÀI CHÍNH NĂM ${statement.fiscalYear} (MẪU CƠ QUAN THUẾ)`,
    (ctx, pageWidth) => {
      const marginX = 36;
      const contentWidth = pageWidth - marginX * 2; // 722px

      // Top Header: Left (Reporting Unit) & Right (National Motto + Tax Form Code)
      ctx.textAlign = 'left';
      ctx.fillStyle = '#15803D';
      ctx.font = `800 13.5px ${FONT_FAMILY}`;
      ctx.fillText('ĐƠN VỊ: CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN', marginX, 34);

      ctx.fillStyle = '#334155';
      ctx.font = `600 11px ${FONT_FAMILY}`;
      ctx.fillText(`Phạm vi kho: ${warehouseLabel}`, marginX, 51);
      ctx.fillText('Lĩnh vực: Phân phối Phân bón, Thuốc BVTV & Giống cây trồng', marginX, 66);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 12px ${FONT_FAMILY}`;
      ctx.fillText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', pageWidth - marginX, 34);
      ctx.font = `700 11.5px ${FONT_FAMILY}`;
      ctx.fillText('Độc lập - Tự do - Hạnh phúc', pageWidth - marginX, 50);
      ctx.fillStyle = '#475569';
      ctx.font = `600 10.5px ${FONT_FAMILY}`;
      ctx.fillText(
        'Mẫu số: B02-DN / B01-DN (Biểu mẫu Báo cáo Tài chính Thuế)',
        pageWidth - marginX,
        66
      );

      // Divider
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marginX, 78);
      ctx.lineTo(pageWidth - marginX, 78);
      ctx.stroke();

      // Main Title
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 17.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `BÁO CÁO TÀI CHÍNH & KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM ${statement.fiscalYear}`,
        pageWidth / 2,
        102
      );
      ctx.fillStyle = '#334155';
      ctx.font = `600 11.5px ${FONT_FAMILY}`;
      ctx.fillText(
        `Kỳ báo cáo: Từ ngày ${statement.fromDate || `${statement.fiscalYear}-01-01`} đến ngày ${
          statement.toDate || `${statement.fiscalYear}-12-31`
        }  |  Đơn vị tính: Đồng Việt Nam (VNĐ)`,
        pageWidth / 2,
        120
      );

      // Compact Table Helper with multi-line text wrapping for full 16-row fit on A4 Portrait without any column overlap
      const drawCompactTaxTable = (
        startY: number,
        headerBg: string,
        columns: { header: string; width: number; align: 'left' | 'center' | 'right' }[],
        rows: { cells: string[]; highlight?: boolean }[]
      ): number => {
        const padX = 7;
        const padY = 5;
        const lineH = 13.5;
        const headerH = 26;
        ctx.fillStyle = headerBg;
        ctx.fillRect(marginX, startY, contentWidth, headerH);

        let colX = marginX;
        columns.forEach((col) => {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `700 10.5px ${FONT_FAMILY}`;
          const textY = startY + 17;
          if (col.align === 'right') {
            ctx.textAlign = 'right';
            ctx.fillText(col.header, colX + col.width - padX, textY);
          } else if (col.align === 'center') {
            ctx.textAlign = 'center';
            ctx.fillText(col.header, colX + col.width / 2, textY);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(col.header, colX + padX, textY);
          }
          colX += col.width;
        });

        let curY = startY + headerH;
        rows.forEach((r, idx) => {
          ctx.font = `${r.highlight ? '700' : '500'} 10.5px ${FONT_FAMILY}`;
          let maxRowLines = 1;
          const wrappedRowCells = columns.map((col, cIdx) => {
            const rawText = r.cells[cIdx] ?? '';
            const lines = wrapCanvasText(ctx, rawText, Math.max(20, col.width - padX * 2));
            if (lines.length > maxRowLines) maxRowLines = lines.length;
            return lines;
          });

          const rowH = Math.max(24, maxRowLines * lineH + padY * 2 + 1);
          ctx.fillStyle = r.highlight
            ? '#ECFDF5'
            : idx % 2 === 1
            ? '#F8FAFC'
            : '#FFFFFF';
          ctx.fillRect(marginX, curY, contentWidth, rowH);

          let cX = marginX;
          columns.forEach((col, cIdx) => {
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(cX, curY, col.width, rowH);

            ctx.fillStyle = r.highlight ? '#065F46' : '#0F172A';
            ctx.font = `${r.highlight ? '700' : '500'} 10.5px ${FONT_FAMILY}`;
            const cellLines = wrappedRowCells[cIdx];
            const blockHeight = (cellLines.length - 1) * lineH;
            const firstLineY = curY + rowH / 2 - blockHeight / 2 + 3.5;

            cellLines.forEach((lineStr, lIdx) => {
              const textY = firstLineY + lIdx * lineH;
              if (col.align === 'right') {
                ctx.textAlign = 'right';
                ctx.fillText(lineStr, cX + col.width - padX, textY);
              } else if (col.align === 'center') {
                ctx.textAlign = 'center';
                ctx.fillText(lineStr, cX + col.width / 2, textY);
              } else {
                ctx.textAlign = 'left';
                ctx.fillText(lineStr, cX + padX, textY);
              }
            });
            cX += col.width;
          });
          curY += rowH;
        });

        ctx.textAlign = 'left';
        return curY;
      };

      // Section I: BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH (MẪU B02-DN)
      let y = 138;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 12px ${FONT_FAMILY}`;
      ctx.fillText(
        'PHẦN I. BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM (MẪU B02-DN / KÊ KHAI THUẾ)',
        marginX,
        y
      );
      y += 7;

      const cols: { header: string; width: number; align: 'left' | 'center' | 'right' }[] = [
        { header: 'Mã số', width: 44, align: 'center' },
        { header: 'Chỉ tiêu Báo cáo Tài chính', width: 350, align: 'left' },
        { header: 'T.Minh', width: 52, align: 'center' },
        { header: 'Căn cứ chứng từ', width: 108, align: 'center' },
        { header: 'Số tiền (VNĐ)', width: 116, align: 'right' },
        { header: 'Tỷ lệ', width: 52, align: 'right' },
      ];

      y = drawCompactTaxTable(
        y,
        '#15803D',
        cols,
        statement.incomeStatementLines.map((line) => ({
          highlight: line.isHighlightRow,
          cells: [
            line.code,
            line.title,
            line.noteCode,
            line.recordCountLabel,
            Math.round(line.amount).toLocaleString('vi-VN'),
            `${line.ratioToNetRevenuePct}%`,
          ],
        }))
      );

      // Section II: BẢNG CÂN ĐỐI TÀI SẢN, TỒN KHO, CÔNG NỢ & DÒNG TIỀN (MẪU B01-DN & B03-DN)
      y += 18;
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 12px ${FONT_FAMILY}`;
      ctx.fillText(
        'PHẦN II. BẢNG CÂN ĐỐI TÀI SẢN, HÀNG TỒN KHO, CÔNG NỢ & DÒNG TIỀN CUỐI KỲ (MẪU B01-DN / B03-DN)',
        marginX,
        y
      );
      y += 7;

      y = drawCompactTaxTable(
        y,
        '#0F172A',
        cols,
        statement.balanceAndCashflowLines.map((line) => ({
          highlight: line.isHighlightRow,
          cells: [
            line.code,
            line.title,
            line.noteCode,
            line.recordCountLabel,
            Math.round(line.amount).toLocaleString('vi-VN'),
            `${line.ratioToNetRevenuePct}%`,
          ],
        }))
      );

      // Summary Verification Note
      y += 16;
      ctx.fillStyle = '#334155';
      ctx.font = `600 10.5px ${FONT_FAMILY}`;
      const commitNotes = wrapCanvasText(
        ctx,
        `• Cam kết đối chiếu số liệu: Báo cáo được tổng hợp trực tiếp từ ${statement.filteredSales.length} hóa đơn bán, ${statement.filteredImports.length} phiếu nhập kho, ${statement.allFilteredReceiptVouchers.length} phiếu thu, ${statement.allFilteredPaymentVouchers.length} phiếu chi và ${statement.inventoryValuationRows.length} danh mục tồn kho.`,
        contentWidth
      );
      commitNotes.forEach((line) => {
        ctx.fillText(line, marginX, y);
        y += 14;
      });
      ctx.fillText(
        `• Kỳ báo cáo: ${periodLabel}  |  Ngày lập biểu: ${today}`,
        marginX,
        y
      );

      // 3-Column Official Tax Authority Signature Block
      const sigY = Math.min(990, y + 28);
      const col1X = pageWidth * 0.2;
      const col2X = pageWidth * 0.5;
      const col3X = pageWidth * 0.8;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 12.5px ${FONT_FAMILY}`;
      ctx.fillText('NGƯỜI LẬP BIỂU', col1X, sigY);
      ctx.fillText('KẾ TOÁN / KIỂM SOÁT', col2X, sigY);
      ctx.fillText('ĐẠI DIỆN ĐƠN VỊ / CHỦ HỘ KD', col3X, sigY);

      ctx.fillStyle = '#64748B';
      ctx.font = `400 11px ${FONT_FAMILY}`;
      ctx.fillText('(Ký, ghi rõ họ tên)', col1X, sigY + 17);
      ctx.fillText('(Ký, ghi rõ họ tên)', col2X, sigY + 17);
      ctx.fillText('(Ký, ghi rõ họ tên và đóng dấu)', col3X, sigY + 17);

      ctx.fillStyle = '#0F172A';
      ctx.font = `700 12.5px ${FONT_FAMILY}`;
      ctx.fillText(staffName, col1X, sigY + 86);
      ctx.fillText(staffName, col3X, sigY + 86);
      ctx.textAlign = 'left';
    }
  );
}

// 10. Xuất Hồ Sơ Báo Cáo Tài Chính Năm theo chuẩn Cơ Quan Thuế (Excel .xlsx 5 Sheet chi tiết)
export function exportTaxAuthorityFinancialReportExcel(params: {
  statement: TaxAuthorityFinancialStatementResult;
  staffName: string;
  warehouseLabel: string;
}): string {
  const { statement, staffName, warehouseLabel } = params;
  const today = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Báo cáo Tài chính Tổng hợp (Mẫu B02-DN & B01-DN / B03-DN)
  const mainSheetRows: (string | number)[][] = [
    ['CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN — CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'],
    [`BÁO CÁO TÀI CHÍNH & KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM ${statement.fiscalYear} (MẪU B02-DN / B01-DN / B03-DN)`],
    [
      `Kỳ báo cáo: Từ ngày ${statement.fromDate || `${statement.fiscalYear}-01-01`} đến ngày ${
        statement.toDate || `${statement.fiscalYear}-12-31`
      } | Kho: ${warehouseLabel} | Người lập: ${staffName} | Ngày xuất: ${today}`,
    ],
    [],
    ['PHẦN I. BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM (MẪU B02-DN)'],
    [
      'Mã Số',
      'Chỉ Tiêu Báo Cáo Tài Chính',
      'Thuyết Minh',
      'Công Thức & Phương Pháp Tính',
      'Số Lượng Chứng Từ Gốc',
      'Số Tiền Kỳ Báo Cáo (VNĐ)',
      'Tỷ Trọng / Doanh Thu Thuần (%)',
    ],
    ...statement.incomeStatementLines.map((l) => [
      l.code,
      l.title,
      l.noteCode,
      l.formulaText,
      l.recordCountLabel,
      l.amount,
      `${l.ratioToNetRevenuePct}%`,
    ]),
    [],
    ['PHẦN II. BẢNG CÂN ĐỐI TÀI SẢN, HÀNG TỒN KHO, CÔNG NỢ & LƯU CHUYỂN DÒNG TIỀN (MẪU B01-DN / B03-DN)'],
    [
      'Mã Số',
      'Chỉ Tiêu Tài Sản - Tồn Kho - Công Nợ - Dòng Tiền',
      'Tài Khoản / Mẫu',
      'Công Thức & Phương Pháp Tính',
      'Số Lượng Chứng Từ Gốc',
      'Số Dư Cuối Kỳ (VNĐ)',
      'Tỷ Trọng / Doanh Thu Thuần (%)',
    ],
    ...statement.balanceAndCashflowLines.map((l) => [
      l.code,
      l.title,
      l.noteCode,
      l.formulaText,
      l.recordCountLabel,
      l.amount,
      `${l.ratioToNetRevenuePct}%`,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mainSheetRows), 'BCTC_Thue_B02_B01');

  // Sheet 2: Bảng kê chi tiết Doanh thu, Giảm trừ, Giá vốn & Lãi gộp từng hóa đơn (Mã 01, 02, 10, 11, 20, 131)
  const saleAuditSheet = statement.saleCogsBreakdown.map((row, idx) => ({
    STT: idx + 1,
    'Ngày Hóa Đơn': (row.sale.createdAt || '').slice(0, 10),
    'Mã Hóa Đơn': row.sale.invoiceCode,
    'Kho Xuất Bán': row.sale.warehouseName || 'Tâm An Mỹ Ngãi',
    'Khách Hàng': row.sale.customerName,
    'SĐT Khách Hàng': row.sale.customerPhone,
    'Mặt Hàng Vật Tư': row.sale.productName,
    'Số Lượng': `${row.sale.quantity} ${row.sale.unit}`,
    'Đơn Giá Bán (VNĐ)': row.sale.unitPrice,
    'Doanh Thu Gộp [Mã 01] (VNĐ)': row.grossAmountBeforeDiscount,
    'Giảm Giá KM [Mã 02] (VNĐ)': row.discountAmount,
    'Doanh Thu Thuần [Mã 10] (VNĐ)': row.netRevenueAmount,
    'Giá Vốn Hàng Bán [Mã 11a] (VNĐ)': row.productCogsAmount,
    'Quà Tặng Khuyến Mãi': row.sale.giftProductName
      ? `${row.sale.giftProductName} (${row.sale.giftQuantity || 0} ${row.sale.giftUnit || ''})`
      : 'Không',
    'Giá Vốn Quà KM [Mã 11b] (VNĐ)': row.giftCogsAmount,
    'Tổng Giá Vốn [Mã 11] (VNĐ)': row.totalCogsAmount,
    'Lợi Nhuận Gộp [Mã 20] (VNĐ)': row.grossProfitAmount,
    'Tỷ Suất Lãi Gộp (%)': `${row.grossMarginPct}%`,
    'Thực Thu (VNĐ)': row.sale.paidAmount,
    'Còn Nợ KH [Mã 131] (VNĐ)': row.sale.debtAmount,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(saleAuditSheet),
    'ChiTiet_DoanhThu_GiaVon'
  );

  // Sheet 3: Bảng kê chi tiết Hàng tồn kho cuối kỳ theo giá vốn (Mã 156)
  const inventoryAuditSheet = statement.inventoryValuationRows.map((row, idx) => ({
    STT: idx + 1,
    'Mã Vật Tư': row.product.code,
    'Tên Vật Tư Nông Nghiệp': row.product.name,
    'Nhóm Hàng': row.product.category,
    'Kho Lưu Trữ': row.product.warehouseName || 'Tâm An Mỹ Ngãi',
    'Đơn Vị Tính': row.product.unit,
    'Số Lượng Tồn Kho': row.stockQuantity,
    'Đơn Giá Vốn Nhập Kho (VNĐ)': row.unitImportCost,
    'Thành Tiền Giá Trị Tồn Kho [Mã 156] (VNĐ)': row.totalInventoryCostValue,
    'Đơn Giá Bán Lẻ Tham Chiếu (VNĐ)': row.unitRetailPrice,
    'Giá Trị Bán Lẻ Ước Tính (VNĐ)': row.totalEstimatedRetailValue,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(inventoryAuditSheet),
    'ChiTiet_TonKho_Ma156'
  );

  // Sheet 4: Bảng kê Phiếu chi vận hành (Mã 24) & Phiếu thu nhập khác (Mã 31)
  const voucherAuditSheet = [
    ...statement.operatingPaymentVouchers.map((pv, idx) => ({
      STT: idx + 1,
      'Chỉ Tiêu BCTC': 'Mã 24 - Chi phí bán hàng & vận hành',
      'Ngày Chứng Từ': (pv.createdAt || '').slice(0, 10),
      'Mã Phiếu': pv.voucherCode,
      'Nhóm Thu / Chi': pv.groupName,
      'Đối Tác / Người Nhận': pv.partnerName,
      'Số Điện Thoại': pv.partnerPhone,
      'Hình Thức': pv.paymentMethod,
      'Số Tiền (VNĐ)': pv.amount,
      'Kho': pv.warehouseName,
      'Ghi Chú': pv.note,
    })),
    ...statement.otherIncomeReceiptVouchers.map((rv, idx) => ({
      STT: idx + 1,
      'Chỉ Tiêu BCTC': 'Mã 31 - Thu nhập khác (Thưởng CK NCC / Hỗ trợ)',
      'Ngày Chứng Từ': (rv.createdAt || '').slice(0, 10),
      'Mã Phiếu': rv.voucherCode,
      'Nhóm Thu / Chi': rv.groupName,
      'Đối Tác / Người Nộp': rv.partnerName,
      'Số Điện Thoại': rv.partnerPhone,
      'Hình Thức': rv.paymentMethod,
      'Số Tiền (VNĐ)': rv.amount,
      'Kho': rv.warehouseName,
      'Ghi Chú': rv.note,
    })),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(voucherAuditSheet),
    'ChiTiet_ChiPhi24_ThuKhac31'
  );

  // Sheet 5: Bảng kê Nhập kho & Công nợ phải trả Nhà cung cấp (Mã 331)
  const supplierAuditSheet = statement.filteredImports.map((imp, idx) => ({
    STT: idx + 1,
    'Ngày Nhập Kho': (imp.createdAt || '').slice(0, 10),
    'Mã Phiếu Nhập': imp.receiptCode,
    'Kho Nhập': imp.warehouseName || 'Tâm An Mỹ Ngãi',
    'Nhà Cung Cấp': imp.supplierName,
    'SĐT NCC': imp.supplierPhone,
    'Mặt Hàng Nhập': imp.productName,
    'Số Lượng': `${imp.quantity} ${imp.unit}`,
    'Đơn Giá Nhập (VNĐ)': imp.unitCost,
    'Tổng Tiền Nhập (VNĐ)': imp.totalCost,
    'Đã Thanh Toán NCC (VNĐ)': imp.paidAmount,
    'Còn Nợ Phải Trả NCC [Mã 331] (VNĐ)': imp.debtAmount,
    'Hạn Thanh Toán': imp.dueDate,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(supplierAuditSheet),
    'ChiTiet_NhapKho_NoNCC331'
  );

  const fileName = `BaoCao_TaiChinh_Thue_Nam_${statement.fiscalYear}_VTNN_TamAn.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// 11. Xuất Thẻ Kho Chi Tiết Xuất - Nhập - Tồn Theo Vật Tư — Excel
export function exportProductStockCardExcel(
  ledger: ProductStockMovementLedger,
  periodLabel = 'Toàn thời gian'
): string {
  const wb = XLSX.utils.book_new();
  const { product } = ledger;
  const safeCode = (product.code || 'VT').replace(/[^a-zA-Z0-9_-]/g, '_');

  const summarySheet: (string | number)[][] = [
    ['CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN — THẺ KHO XUẤT NHẬP TỒN'],
    [`Vật tư: [${product.code}] ${product.name} (${product.unit})`],
    [`Kho lưu trữ: ${product.warehouseName || 'Tâm An Mỹ Ngãi'} · Kỳ xem: ${periodLabel}`],
    [],
    ['CHỈ TIÊU CÂN ĐỐI KHO', 'SỐ LƯỢNG', 'ĐƠN VỊ / GIÁ TRỊ'],
    ['Tồn đầu kỳ', ledger.openingStock, product.unit],
    ['Tổng nhập kho trong kỳ (+)', ledger.periodImportQty, `${ledger.periodImportValue.toLocaleString('vi-VN')} VNĐ`],
    ['Tổng xuất bán trong kỳ (-)', ledger.periodExportSaleQty, `${ledger.periodExportRevenue.toLocaleString('vi-VN')} VNĐ`],
    ['Tổng xuất quà tặng KM (-)', ledger.periodExportGiftQty, product.unit],
    ...(ledger.periodExportAdjustmentQty
      ? [['Kiểm kê điều chỉnh giảm (-)', ledger.periodExportAdjustmentQty, product.unit]]
      : []),
    ['Tồn cuối kỳ', ledger.closingStock, product.unit],
    ['Tồn kho thực tế hiện tại', product.stock, product.unit],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), 'Can_Doi_XNT');

  const detailRows = ledger.movementsInPeriod.map((m, idx) => ({
    STT: idx + 1,
    'Ngày Giao Dịch': (m.dateIso || '').slice(0, 16).replace('T', ' '),
    'Loại Nghiệp Vụ':
      m.type === 'import'
        ? 'Nhập kho (+)'
        : m.type === 'stocktake_in'
        ? 'Kiểm kê dôi (+)'
        : m.type === 'stocktake_out'
        ? 'Kiểm kê hao hụt (-)'
        : m.type === 'gift_export'
        ? 'Xuất quà tặng KM (-)'
        : 'Xuất bán hàng (-)',
    'Mã Chứng Từ': m.voucherCode,
    'Đối Tác (NCC / Khách hàng)': m.partnerName,
    SĐT: m.partnerPhone,
    'Kho Hàng': m.warehouseName,
    [`Nhập (+ ${product.unit})`]: m.qtyIn,
    [`Xuất (- ${product.unit})`]: m.qtyOut,
    [`Tồn Sau Giao Dịch (${product.unit})`]: m.balanceAfter,
    'Đơn Giá (VNĐ)': m.unitPriceOrCost,
    'Thành Tiền (VNĐ)': m.totalValue,
    'Người Thực Hiện': m.staffName,
    'Ghi Chú': m.note,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      detailRows.length > 0
        ? detailRows
        : [
            {
              'Thông báo': 'Chưa có phát sinh nhập/xuất nào trong khoảng thời gian đã chọn.',
            },
          ]
    ),
    'Chi_Tiet_Xuat_Nhap_Ton'
  );

  const today = getTodayVietnamDateStr();
  const fileName = `TheKho_XuatNhapTon_${safeCode}_${today}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// 12. Xuất Danh Sách Đề Xuất Nhập Hàng Thông Minh — Excel
export function exportSmartReorderExcel(
  items: import('./businessLogic').SmartReorderSuggestionItem[],
  warehouseLabel = 'Tất cả kho'
): string {
  const wb = XLSX.utils.book_new();
  const today = getTodayVietnamDateStr();
  const rows = items.map((item, idx) => ({
    STT: idx + 1,
    'Mã VT': item.product.code,
    'Tên Vật Tư': item.product.name,
    'ĐVT': item.product.unit,
    'Kho': item.product.warehouseName || warehouseLabel,
    'Tồn Hiện Tại': item.product.stock,
    'Tồn Tối Thiểu': item.product.minStock,
    'Bán 30 Ngày': item.soldQtyLookback,
    'Tốc Độ/Ngày': Number(item.dailyVelocity.toFixed(2)),
    'Còn Đủ Bán (Ngày)': item.daysOfStockLeft !== null ? item.daysOfStockLeft : '—',
    'Đề Xuất Đặt': item.suggestedOrderQty,
    'Đơn Giá Nhập (VNĐ)': item.product.importPrice,
    'Dự Kiến Tiền Hàng (VNĐ)': item.estimatedCost,
    'Nhà Cung Cấp': item.product.supplierName,
    'Lý Do Đề Xuất': item.reason,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rows.length > 0 ? rows : [{ 'Thông báo': 'Chưa có vật tư cần đề xuất nhập thêm.' }]
    ),
    'De_Xuat_Nhap_Hang'
  );
  const fileName = `DeXuat_DatHang_NCC_${today}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// 13. In Hóa Đơn / Phiếu Thu-Chi Khổ Nhiệt K58 (58mm) & K80 (80mm) — Hỗ trợ Nhiều mặt hàng, Liều lượng & VietQR
export function exportThermalReceiptPDF(params: {
  paperWidthMm: 58 | 80;
  storeName?: string;
  voucherTitle: string;
  voucherCode: string;
  dateStr: string;
  partnerLabel: string;
  partnerName: string;
  partnerPhone?: string;
  productName?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  discountAmount?: number;
  dosageGuide?: string;
  items?: SaleInvoiceLineItem[];
  bankQrConfig?: VietQrBankConfig | null;
  totalLabel: string;
  totalAmount: number;
  paidLabel: string;
  paidAmount: number;
  debtLabel: string;
  remainingDebt: number;
  dueDate?: string;
  staffName: string;
  note?: string;
}): string {
  const safeCode = String(params.voucherCode || 'BILL').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `Bill_K${params.paperWidthMm}_${safeCode}_${params.dateStr.slice(0, 10)}.pdf`;
  if (typeof document === 'undefined') return fileName;

  const lineItems: SaleInvoiceLineItem[] =
    params.items && params.items.length > 0
      ? params.items
      : params.productName
      ? [
          {
            productName: params.productName,
            unit: params.unit || '',
            quantity: params.quantity ?? 1,
            unitPrice: params.unitPrice ?? 0,
            discountAmount: params.discountAmount,
            dosageGuide: params.dosageGuide,
          },
        ]
      : [];

  const dosageEntries = lineItems
    .filter((i) => (i.dosageGuide || '').trim().length > 0)
    .map((i) => ({ name: i.productName, guide: (i.dosageGuide || '').trim() }));

  const hasValidBank = isValidVietQrConfig(params.bankQrConfig);
  const qrPayable = params.remainingDebt > 0 ? params.remainingDebt : params.totalAmount;
  const qrAddInfo = sanitizeVietQrText(`TT ${params.voucherCode} ${params.partnerName}`, 48);

  const renderThermal = (qrImg: HTMLImageElement | null) => {
    const drawAndExport = (allowQrImg: boolean) => {
      const logicalWidth = params.paperWidthMm === 58 ? 380 : 520;
      const estimatedExtraHeight =
        lineItems.length * 72 + dosageEntries.length * 64 + (hasValidBank ? 320 : 0);
      const logicalHeight = Math.max(720, 480 + estimatedExtraHeight);
      const scale = 2.5;
      const marginX = 18;
      const contentWidth = logicalWidth - marginX * 2;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(logicalWidth * scale);
      canvas.height = Math.round(logicalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(scale, scale);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      const baseSize = params.paperWidthMm === 58 ? 13 : 14.5;
      let y = 28;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 ${baseSize + 3}px ${FONT_FAMILY}`;
      ctx.fillText((params.storeName || 'VTNN TÂM AN').toUpperCase(), logicalWidth / 2, y);
      y += 20;

      ctx.font = `500 ${baseSize - 2}px ${FONT_FAMILY}`;
      ctx.fillStyle = '#475569';
      ctx.fillText('Vật tư Tâm An — Nhà Nông an tâm', logicalWidth / 2, y);
      y += 18;

      ctx.font = `800 ${baseSize + 2}px ${FONT_FAMILY}`;
      ctx.fillStyle = '#0F172A';
      ctx.fillText(params.voucherTitle.toUpperCase(), logicalWidth / 2, y + 6);
      y += 24;

      ctx.font = `600 ${baseSize - 1}px ${FONT_FAMILY}`;
      ctx.fillText(`Số: ${params.voucherCode}  |  ${params.dateStr.slice(0, 16)}`, logicalWidth / 2, y);
      y += 16;

      const drawDashedLine = (lineY: number) => {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(marginX, lineY);
        ctx.lineTo(logicalWidth - marginX, lineY);
        ctx.stroke();
        ctx.restore();
      };

      drawDashedLine(y);
      y += 20;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#0F172A';
      ctx.font = `600 ${baseSize}px ${FONT_FAMILY}`;
      const partnerLines = wrapCanvasText(
        ctx,
        `${params.partnerLabel}: ${params.partnerName}`,
        contentWidth
      );
      partnerLines.forEach((line) => {
        ctx.fillText(line, marginX, y);
        y += 18;
      });
      if (params.partnerPhone) {
        ctx.font = `400 ${baseSize - 1}px ${FONT_FAMILY}`;
        ctx.fillText(`SĐT: ${params.partnerPhone}`, marginX, y);
        y += 18;
      }
      ctx.font = `400 ${baseSize - 1}px ${FONT_FAMILY}`;
      ctx.fillText(`Thu ngân: ${params.staffName}`, marginX, y);
      y += 14;

      drawDashedLine(y);
      y += 20;

      if (lineItems.length > 0) {
        lineItems.forEach((item, idx) => {
          ctx.fillStyle = '#0F172A';
          ctx.font = `700 ${baseSize}px ${FONT_FAMILY}`;
          const prodLines = wrapCanvasText(
            ctx,
            lineItems.length > 1 ? `${idx + 1}. ${item.productName}` : item.productName,
            contentWidth
          );
          prodLines.forEach((line) => {
            ctx.fillText(line, marginX, y);
            y += 18;
          });
          const qty = item.quantity ?? 1;
          const price = item.unitPrice ?? 0;
          ctx.font = `400 ${baseSize - 1}px ${FONT_FAMILY}`;
          ctx.fillText(`${qty} ${item.unit || ''} x ${formatCurrencyPlain(price)}`, marginX, y);
          ctx.textAlign = 'right';
          ctx.font = `700 ${baseSize}px ${FONT_FAMILY}`;
          ctx.fillText(formatCurrencyPlain(qty * price), logicalWidth - marginX, y);
          ctx.textAlign = 'left';
          y += 18;

          if (item.discountAmount && item.discountAmount > 0) {
            ctx.font = `400 ${baseSize - 1}px ${FONT_FAMILY}`;
            ctx.fillText('Chiết khấu / Giảm:', marginX, y);
            ctx.textAlign = 'right';
            ctx.fillText(`-${formatCurrencyPlain(item.discountAmount)}`, logicalWidth - marginX, y);
            ctx.textAlign = 'left';
            y += 17;
          }
          if (item.giftProductName && (item.giftQuantity || 0) > 0) {
            ctx.font = `500 ${baseSize - 2}px ${FONT_FAMILY}`;
            ctx.fillStyle = '#15803D';
            wrapCanvasText(
              ctx,
              `+ Tặng KM: ${item.giftQuantity} ${item.giftUnit || ''} ${item.giftProductName}`,
              contentWidth
            ).forEach((line) => {
              ctx.fillText(line, marginX, y);
              y += 16;
            });
            ctx.fillStyle = '#0F172A';
          }
          if (idx < lineItems.length - 1) {
            y += 4;
          }
        });
        drawDashedLine(y);
        y += 20;
      }

      const drawAmountRow = (label: string, amount: number, bold = false) => {
        ctx.fillStyle = '#0F172A';
        ctx.font = `${bold ? 800 : 500} ${bold ? baseSize + 1 : baseSize}px ${FONT_FAMILY}`;
        ctx.fillText(label, marginX, y);
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrencyPlain(amount), logicalWidth - marginX, y);
        ctx.textAlign = 'left';
        y += 22;
      };

      drawAmountRow(params.totalLabel, params.totalAmount, true);
      drawAmountRow(params.paidLabel, params.paidAmount, false);
      drawAmountRow(params.debtLabel, params.remainingDebt, params.remainingDebt > 0);

      if (params.remainingDebt > 0 && params.dueDate) {
        ctx.font = `600 ${baseSize - 1}px ${FONT_FAMILY}`;
        ctx.fillText(`Hạn thanh toán: ${params.dueDate}`, marginX, y);
        y += 18;
      }
      if (params.note) {
        ctx.font = `400 ${baseSize - 2}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#475569';
        wrapCanvasText(ctx, `Ghi chú: ${params.note}`, contentWidth)
          .slice(0, 2)
          .forEach((line) => {
            ctx.fillText(line, marginX, y);
            y += 16;
          });
      }

      // Dosage & Spraying Instructions Section on Thermal Receipt
      if (dosageEntries.length > 0) {
        y += 4;
        drawDashedLine(y);
        y += 18;
        ctx.fillStyle = '#166534';
        ctx.font = `800 ${baseSize - 1}px ${FONT_FAMILY}`;
        ctx.fillText('HƯỚNG DẪN PHA PHUN / SỬ DỤNG:', marginX, y);
        y += 18;
        ctx.fillStyle = '#0F172A';
        ctx.font = `500 ${baseSize - 2}px ${FONT_FAMILY}`;
        for (const entry of dosageEntries) {
          wrapCanvasText(ctx, `• ${entry.name}: ${entry.guide}`, contentWidth).forEach((line) => {
            ctx.fillText(line, marginX, y);
            y += 16;
          });
        }
      }

      // Dynamic VietQR Block on Thermal Receipt
      if (hasValidBank && params.bankQrConfig) {
        y += 6;
        drawDashedLine(y);
        y += 18;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0F766E';
        ctx.font = `800 ${baseSize - 1}px ${FONT_FAMILY}`;
        ctx.fillText('QUÉT MÃ VIETQR CHUYỂN KHOẢN', logicalWidth / 2, y);
        y += 12;

        if (allowQrImg && qrImg) {
          const qrSize = params.paperWidthMm === 58 ? 160 : 200;
          ctx.drawImage(qrImg, (logicalWidth - qrSize) / 2, y, qrSize, qrSize + 14);
          y += qrSize + 26;
        } else {
          y += 10;
        }

        ctx.fillStyle = '#0F172A';
        ctx.font = `700 ${baseSize - 2}px ${FONT_FAMILY}`;
        ctx.fillText(
          `${resolveVietnamBankLabel(params.bankQrConfig.bankCode)} - ${params.bankQrConfig.accountNumber}`,
          logicalWidth / 2,
          y
        );
        y += 16;
        if (params.bankQrConfig.accountName) {
          ctx.font = `600 ${baseSize - 2}px ${FONT_FAMILY}`;
          ctx.fillText(params.bankQrConfig.accountName, logicalWidth / 2, y);
          y += 16;
        }
        ctx.font = `500 ${baseSize - 2}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#334155';
        ctx.fillText(`ND: ${qrAddInfo}`, logicalWidth / 2, y);
        y += 14;
        ctx.textAlign = 'left';
      }

      y += 6;
      drawDashedLine(y);
      y += 22;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = `600 ${baseSize - 1}px ${FONT_FAMILY}`;
      ctx.fillText('Cảm ơn Quý khách — Hẹn gặp lại!', logicalWidth / 2, y);

      const usedLogicalHeight = Math.max(360, Math.min(logicalHeight, y + 26));
      const outCanvas = document.createElement('canvas');
      outCanvas.width = canvas.width;
      outCanvas.height = Math.round(usedLogicalHeight * scale);
      const outCtx = outCanvas.getContext('2d');
      if (outCtx) {
        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
        outCtx.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          outCanvas.height,
          0,
          0,
          outCanvas.width,
          outCanvas.height
        );
      }

      const dataUrl = (outCtx ? outCanvas : canvas).toDataURL('image/png', 1.0);
      if (typeof window !== 'undefined') {
        (
          window as unknown as {
            __lastExportedPdfPreview?: { fileName: string; title: string; dataUrl: string };
          }
        ).__lastExportedPdfPreview = {
          fileName,
          title: `${params.voucherTitle} (K${params.paperWidthMm})`,
          dataUrl,
        };
        window.dispatchEvent(
          new CustomEvent('taman-pdf-exported', {
            detail: { fileName, title: `${params.voucherTitle} (K${params.paperWidthMm})`, dataUrl },
          })
        );
      }

      const heightMm = Math.round((usedLogicalHeight / logicalWidth) * params.paperWidthMm * 10) / 10;
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [params.paperWidthMm, heightMm],
        compress: true,
      });
      doc.addImage(dataUrl, 'PNG', 0, 0, params.paperWidthMm, heightMm, undefined, 'FAST');
      doc.save(fileName);
    };

    try {
      drawAndExport(Boolean(qrImg));
    } catch {
      drawAndExport(false);
    }
  };

  if (hasValidBank && params.bankQrConfig && qrPayable > 0 && typeof window !== 'undefined') {
    const qrUrl = buildVietQrImageUrl(params.bankQrConfig, {
      amount: qrPayable,
      addInfo: qrAddInfo,
    });
    void loadVietQrImageSafely(qrUrl, 2400).then((img) => renderThermal(img));
    return fileName;
  }

  renderThermal(null);
  return fileName;
}



