import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocatePaymentAcrossCartItems,
  bindProductNoteToProduct,
  buildVietQrImageUrl,
  buildZaloInvoiceAndDosageMessage,
  clearOfflineQueueStorage,
  DEFAULT_PRODUCT_NOTE_TEMPLATES,
  deleteProductNoteTemplate,
  enqueueOfflineQueueItem,
  findInvoiceGroupSales,
  isValidVietQrConfig,
  loadOfflineQueue,
  OFFLINE_QUEUE_STORAGE_KEY,
  PosCartDraftItem,
  sanitizeVietQrText,
  upsertProductNoteTemplate,
  upsertQuickCartProductQuantity,
  validateCartInventory,
} from './smartPosFeatures';
import { ProductItem, SaleTransaction, VietQrBankConfig } from '../types';

const mockProducts: ProductItem[] = [
  {
    id: 'p1',
    code: 'VT-01',
    name: 'Phân bón NPK 20-20-15',
    category: 'Phân bón',
    unit: 'Bao 50kg',
    importPrice: 700000,
    sellPrice: 850000,
    stock: 10,
    minStock: 2,
    supplierName: 'NCC A',
    warehouseName: 'Tâm An Mỹ Ngãi',
    dosageGuide: 'Rải gốc 15-25 kg / công 1.000m².',
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'p2',
    code: 'VT-02',
    name: 'Thuốc trừ sâu Sinh Học',
    category: 'Thuốc BVTV',
    unit: 'Chai',
    importPrice: 90000,
    sellPrice: 120000,
    stock: 5,
    minStock: 2,
    supplierName: 'NCC B',
    warehouseName: 'Tâm An Mỹ Ngãi',
    dosageGuide: 'Pha 25ml / bình 25 lít nước.',
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

describe('Priority 1 — Multi-Item POS Cart Allocation & Inventory Validation', () => {
  it('allocates combined partial payment across multiple items without rounding drift', () => {
    const items: PosCartDraftItem[] = [
      {
        id: 'c1',
        productId: 'p1',
        productName: 'Phân bón NPK 20-20-15',
        unit: 'Bao 50kg',
        quantity: 2,
        unitPrice: 850000,
        discountAmount: 50000,
      },
      {
        id: 'c2',
        productId: 'p2',
        productName: 'Thuốc trừ sâu Sinh Học',
        unit: 'Chai',
        quantity: 3,
        unitPrice: 120000,
        discountAmount: 0,
      },
    ];

    const result = allocatePaymentAcrossCartItems(items, 1800000);
    assert.equal(result.grossTotal, 2060000);
    assert.equal(result.totalDiscount, 50000);
    assert.equal(result.netTotal, 2010000);
    assert.equal(result.totalPaid, 1800000);
    assert.equal(result.totalDebt, 210000);
    assert.equal(result.status, 'partial');

    const sumPaid = result.items.reduce((s, r) => s + r.paidAmount, 0);
    const sumDebt = result.items.reduce((s, r) => s + r.debtAmount, 0);
    assert.equal(sumPaid, 1800000);
    assert.equal(sumDebt, 210000);
    assert.equal(result.items[0].status, 'paid');
    assert.equal(result.items[1].status, 'partial');
    assert.equal(result.items[1].paidAmount, 150000);
    assert.equal(result.items[1].debtAmount, 210000);
  });

  it('validates cumulative stock across duplicate products and gift SKUs', () => {
    const oversellGiftCart: PosCartDraftItem[] = [
      {
        id: 'c1',
        productId: 'p2',
        productName: 'Thuốc trừ sâu Sinh Học',
        unit: 'Chai',
        quantity: 4,
        unitPrice: 120000,
        giftProductId: 'p2',
        giftProductName: 'Thuốc trừ sâu Sinh Học',
        giftQuantity: 2,
      },
    ];
    const invalidRes = validateCartInventory(mockProducts, oversellGiftCart);
    assert.equal(invalidRes.valid, false);
    assert.match(invalidRes.error || '', /chỉ còn 5/);

    const validCart: PosCartDraftItem[] = [
      {
        id: 'c1',
        productId: 'p1',
        productName: 'Phân bón NPK 20-20-15',
        unit: 'Bao 50kg',
        quantity: 2,
        unitPrice: 850000,
      },
      {
        id: 'c2',
        productId: 'p2',
        productName: 'Thuốc trừ sâu Sinh Học',
        unit: 'Chai',
        quantity: 5,
        unitPrice: 120000,
      },
    ];
    assert.equal(validateCartInventory(mockProducts, validCart).valid, true);
  });

  it('groups sales sharing the same invoiceGroupId or invoiceCode', () => {
    const base: SaleTransaction = {
      id: 's1',
      invoiceCode: 'HD-2611-001',
      invoiceGroupId: 'invgrp_1',
      customerId: 'cust1',
      customerName: 'Nguyễn Văn A',
      customerPhone: '0912345678',
      productId: 'p1',
      productName: 'NPK',
      unit: 'Bao',
      quantity: 1,
      unitPrice: 850000,
      totalAmount: 850000,
      paidAmount: 850000,
      debtAmount: 0,
      dueDate: '2026-11-26',
      status: 'paid',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-26T00:00:00Z',
      updatedAt: '2026-11-26T00:00:00Z',
    };
    const allSales: SaleTransaction[] = [
      base,
      { ...base, id: 's2', productId: 'p2', productName: 'Thuốc trừ sâu' },
      { ...base, id: 's3', invoiceCode: 'HD-2611-002', invoiceGroupId: 'invgrp_2' },
    ];
    const grouped = findInvoiceGroupSales(allSales, base);
    assert.equal(grouped.length, 2);
  });

  it('quick-picks, updates, validates stock, and removes items directly into shared POS cart', () => {
    let cart: PosCartDraftItem[] = [];
    const add1 = upsertQuickCartProductQuantity(cart, mockProducts[0], 2, mockProducts);
    assert.equal(add1.error, undefined);
    assert.equal(add1.items.length, 1);
    assert.equal(add1.items[0].quantity, 2);
    assert.equal(add1.items[0].dosageGuide, 'Rải gốc 15-25 kg / công 1.000m².');
    cart = add1.items;

    const add2 = upsertQuickCartProductQuantity(cart, mockProducts[1], 3, mockProducts);
    assert.equal(add2.error, undefined);
    assert.equal(add2.items.length, 2);
    cart = add2.items;

    const overStock = upsertQuickCartProductQuantity(cart, mockProducts[1], 99, mockProducts);
    assert.ok(overStock.error);
    assert.equal(overStock.items[1].quantity, 3);

    const remove1 = upsertQuickCartProductQuantity(cart, mockProducts[0], 0, mockProducts);
    assert.equal(remove1.error, undefined);
    assert.equal(remove1.items.length, 1);
    assert.equal(remove1.items[0].productId, 'p2');
  });
});

describe('Priority 2 — Dynamic VietQR Generation & Vietnamese Sanitization', () => {
  it('sanitizes Vietnamese diacritics and generates valid img.vietqr.io URL', () => {
    assert.equal(
      sanitizeVietQrText('Thanh toán HĐ-2611-001 Đặng Văn Đạt'),
      'Thanh toan HD-2611-001 Dang Van Dat'
    );

    const cfg: VietQrBankConfig = {
      bankCode: 'AGRIBANK',
      bankBin: '970405',
      accountNumber: '6501 2345 6789',
      accountName: 'Cửa Hàng Tâm An',
      template: 'compact2',
    };
    assert.equal(isValidVietQrConfig(cfg), true);

    const url = buildVietQrImageUrl(cfg, {
      amount: 1250000,
      addInfo: 'TT HD-2611-001 Nguyễn Văn Đạt',
    });
    assert.ok(url.startsWith('https://img.vietqr.io/image/970405-650123456789-compact2.png?'));
    assert.ok(url.includes('amount=1250000'));
    assert.ok(url.includes('addInfo=TT+HD-2611-001+Nguyen+Van+Dat'));
    assert.ok(url.includes('accountName=CUA+HANG+TAM+AN'));
  });
});

describe('Priority 3 — Dosage & Spraying Guide Zalo Invoice Formatter', () => {
  it('includes itemized products, dosage instructions, and VietQR details in Zalo message', () => {
    const { message, zaloUrl } = buildZaloInvoiceAndDosageMessage({
      storeName: 'Tâm An Mỹ Ngãi',
      invoiceCode: 'HD-2611-010',
      customerName: 'Chú Ba Nông Dân',
      customerPhone: '+84 912 345 678',
      dateStr: '2026-11-26',
      items: [
        {
          productName: 'Thuốc trừ sâu Sinh Học',
          quantity: 2,
          unit: 'Chai',
          unitPrice: 120000,
          totalAmount: 240000,
          dosageGuide: 'Pha 25ml / bình 25 lít nước, phun chiều mát.',
        },
      ],
      totalAmount: 240000,
      paidAmount: 100000,
      debtAmount: 140000,
      dueDate: '2026-12-03',
      bankConfig: {
        bankCode: 'VCB',
        accountNumber: '0123456789',
        accountName: 'VTNN TAM AN',
      },
    });

    assert.equal(zaloUrl, 'https://zalo.me/0912345678');
    assert.ok(message.includes('HƯỚNG DẪN LIỀU LƯỢNG & CÁCH PHA PHUN'));
    assert.ok(message.includes('Pha 25ml / bình 25 lít nước'));
    assert.ok(message.includes('Vietcombank'));
    assert.ok(message.includes('0123456789'));
  });

  it('creates, edits, deletes reusable product note templates and remembers note bound to product', () => {
    const { templates: afterCreate, savedTemplate } = upsertProductNoteTemplate(
      DEFAULT_PRODUCT_NOTE_TEMPLATES,
      {
        title: 'Diệt mầm kích rễ lúa',
        category: 'Công dụng & Liều lượng',
        content: 'Pha 1 cặp / công 1.000m², phun sau sạ 1-3 ngày giúp diệt cỏ dại và kích rễ khỏe.',
      }
    );
    assert.equal(afterCreate.length, DEFAULT_PRODUCT_NOTE_TEMPLATES.length + 1);
    assert.equal(afterCreate[0].title, 'Diệt mầm kích rễ lúa');

    const { templates: afterEdit } = upsertProductNoteTemplate(
      afterCreate,
      {
        title: 'Diệt mầm kích rễ lúa (Chuẩn)',
        category: 'Công dụng & Liều lượng',
        content: 'Pha 1 cặp / công, phun 1-3 NSS.',
      },
      savedTemplate.id
    );
    assert.equal(afterEdit[0].title, 'Diệt mầm kích rễ lúa (Chuẩn)');

    const { updatedProducts, updatedProduct } = bindProductNoteToProduct(
      mockProducts,
      'p1',
      afterEdit[0].content
    );
    assert.equal(updatedProduct?.dosageGuide, 'Pha 1 cặp / công, phun 1-3 NSS.');
    assert.equal(updatedProducts[0].dosageGuide, 'Pha 1 cặp / công, phun 1-3 NSS.');

    const afterDelete = deleteProductNoteTemplate(afterEdit, savedTemplate.id);
    assert.equal(afterDelete.length, DEFAULT_PRODUCT_NOTE_TEMPLATES.length);
  });
});

describe('Priority 4 — Offline Queue Local Persistence & Clear', () => {
  it('enqueues, loads, and clears offline operations safely', () => {
    const storeMap = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
    };

    let queue = loadOfflineQueue(fakeStorage);
    assert.equal(queue.length, 0);

    queue = enqueueOfflineQueueItem(
      queue,
      { actionType: 'multi_sale', label: 'Hóa đơn POS HD-2611-005 (3 món)' },
      fakeStorage
    );
    assert.equal(queue.length, 1);
    assert.ok(storeMap.has(OFFLINE_QUEUE_STORAGE_KEY));

    const reloaded = loadOfflineQueue(fakeStorage);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].actionType, 'multi_sale');

    clearOfflineQueueStorage(fakeStorage);
    assert.equal(loadOfflineQueue(fakeStorage).length, 0);
  });
});
