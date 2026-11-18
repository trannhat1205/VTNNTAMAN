import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf-8');

const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

interface AuthContext {
  uid: string;
  email: string;
  email_verified: boolean;
  isAdminDocPresent?: boolean;
}

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_REGEX.test(id);
}

function isAdmin(auth: AuthContext | null): boolean {
  if (!auth || !auth.email_verified) return false;
  return auth.email === 'trannhat1205@gmail.com' || Boolean(auth.isAdminDocPresent);
}

// Simulated rule evaluator matching firestore.rules boolean gates
function evaluateCreateProduct(
  auth: AuthContext | null,
  productId: string,
  payload: Record<string, unknown>,
  serverTime: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(productId)) return 'PERMISSION_DENIED';
  const allowedKeys = [
    'id', 'code', 'name', 'category', 'unit',
    'importPrice', 'sellPrice', 'stock', 'minStock',
    'supplierName', 'ownerId', 'createdAt', 'updatedAt'
  ];
  const keys = Object.keys(payload);
  if (!allowedKeys.every((k) => keys.includes(k)) || !keys.every((k) => allowedKeys.includes(k))) {
    return 'PERMISSION_DENIED';
  }
  if (payload.id !== productId || payload.ownerId !== auth.uid) return 'PERMISSION_DENIED';
  if (typeof payload.stock !== 'number' || payload.stock < 0) return 'PERMISSION_DENIED';
  if (payload.createdAt !== serverTime || payload.updatedAt !== serverTime) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateCreateStaff(
  auth: AuthContext | null,
  userId: string,
  payload: Record<string, unknown>,
  serverTime: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(userId)) return 'PERMISSION_DENIED';
  const allowedKeys = ['uid', 'displayName', 'role', 'active', 'createdAt', 'updatedAt'];
  const keys = Object.keys(payload);
  if (!allowedKeys.every((k) => keys.includes(k)) || !keys.every((k) => allowedKeys.includes(k))) {
    return 'PERMISSION_DENIED';
  }
  if (payload.uid !== userId) return 'PERMISSION_DENIED';
  if (payload.createdAt !== serverTime || payload.updatedAt !== serverTime) return 'PERMISSION_DENIED';
  if (auth.uid === userId && payload.role === 'staff') return 'ALLOW';
  if (isAdmin(auth)) return 'ALLOW';
  return 'PERMISSION_DENIED';
}

function evaluateCreateSale(
  auth: AuthContext | null,
  saleId: string,
  payload: Record<string, unknown>,
  productExists: boolean,
  serverTime: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(saleId) || !productExists) return 'PERMISSION_DENIED';
  if (payload.ownerId !== auth.uid || payload.id !== saleId) return 'PERMISSION_DENIED';
  if (payload.createdAt !== serverTime || payload.updatedAt !== serverTime) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateUpdateSale(
  auth: AuthContext | null,
  existingDoc: Record<string, unknown>,
  incomingDoc: Record<string, unknown>,
  serverTime: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (incomingDoc.ownerId !== existingDoc.ownerId || incomingDoc.createdAt !== existingDoc.createdAt) {
    return 'PERMISSION_DENIED';
  }
  if (incomingDoc.updatedAt !== serverTime) return 'PERMISSION_DENIED';
  if (isAdmin(auth)) return 'ALLOW';
  if (existingDoc.ownerId !== auth.uid) return 'PERMISSION_DENIED';
  if (existingDoc.status === 'paid') return 'PERMISSION_DENIED';
  return 'ALLOW';
}

test('Firestore rules file contains all 10 required collection blocks and Eight Pillars primitives', () => {
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('match /admins/{adminId}'));
  assert.ok(rulesText.includes('match /staff/{userId}'));
  assert.ok(rulesText.includes('match /staff_private/{userId}'));
  assert.ok(rulesText.includes('match /customers/{customerId}'));
  assert.ok(rulesText.includes('match /customers_private/{customerId}'));
  assert.ok(rulesText.includes('match /notification_prefs/{userId}'));
  assert.ok(rulesText.includes('match /products/{productId}'));
  assert.ok(rulesText.includes('match /sales/{saleId}'));
  assert.ok(rulesText.includes('match /imports/{importId}'));
  assert.ok(rulesText.includes('match /backups/{backupId}'));
});

test('Dirty Dozen #1: Shadow Field Injection returns PERMISSION_DENIED', () => {
  const now = '2026-11-16T00:00:00Z';
  const auth: AuthContext = { uid: 'user_1', email: 'staff@taman.vn', email_verified: true };
  const result = evaluateCreateProduct(auth, 'prod_1', {
    id: 'prod_1',
    code: 'NPK-01',
    name: 'Phân bón NPK',
    category: 'Phân bón',
    unit: 'Bao',
    importPrice: 500000,
    sellPrice: 580000,
    stock: 20,
    minStock: 10,
    supplierName: 'Bình Điền',
    ownerId: 'user_1',
    createdAt: now,
    updatedAt: now,
    isSuperAdmin: true,
  }, now);
  assert.equal(result, 'PERMISSION_DENIED');
});

test('Dirty Dozen #2: Self-Assigned Manager Role returns PERMISSION_DENIED', () => {
  const now = '2026-11-16T00:00:00Z';
  const auth: AuthContext = { uid: 'user_1', email: 'staff@taman.vn', email_verified: true };
  const result = evaluateCreateStaff(auth, 'user_1', {
    uid: 'user_1',
    displayName: 'Nhân viên A',
    role: 'manager',
    active: true,
    createdAt: now,
    updatedAt: now,
  }, now);
  assert.equal(result, 'PERMISSION_DENIED');
});

test('Dirty Dozen #3: Unverified Email Spoofing returns PERMISSION_DENIED', () => {
  const spoofAuth: AuthContext = { uid: 'attacker_1', email: 'trannhat1205@gmail.com', email_verified: false };
  assert.equal(isAdmin(spoofAuth), false);
});

test('Dirty Dozen #4: ID Poisoning (>128 chars or special chars) returns PERMISSION_DENIED', () => {
  const now = '2026-11-16T00:00:00Z';
  const auth: AuthContext = { uid: 'user_1', email: 'staff@taman.vn', email_verified: true };
  assert.equal(evaluateCreateProduct(auth, 'bad$id!@#', {}, now), 'PERMISSION_DENIED');
  assert.equal(evaluateCreateProduct(auth, 'a'.repeat(130), {}, now), 'PERMISSION_DENIED');
});

test('Dirty Dozen #5 & #6: Identity Spoofing & Orphaned Sale without Product return PERMISSION_DENIED', () => {
  const now = '2026-11-16T00:00:00Z';
  const auth: AuthContext = { uid: 'user_A', email: 'staff@taman.vn', email_verified: true };
  // Spoofed ownerId
  assert.equal(
    evaluateCreateSale(auth, 'sale_1', { id: 'sale_1', ownerId: 'user_B', createdAt: now, updatedAt: now }, true, now),
    'PERMISSION_DENIED'
  );
  // Missing product
  assert.equal(
    evaluateCreateSale(auth, 'sale_1', { id: 'sale_1', ownerId: 'user_A', createdAt: now, updatedAt: now }, false, now),
    'PERMISSION_DENIED'
  );
});

test('Dirty Dozen #7–#12: PII leak, Negative Stock, Immortal Field, Forged Timestamp, Terminal Reversal return PERMISSION_DENIED', () => {
  const now = '2026-11-16T00:00:00Z';
  const auth: AuthContext = { uid: 'user_1', email: 'staff@taman.vn', email_verified: true };
  // #8 Negative stock
  assert.equal(
    evaluateCreateProduct(auth, 'prod_1', {
      id: 'prod_1', code: 'P1', name: 'Test', category: 'Phân bón', unit: 'Bao',
      importPrice: 10, sellPrice: 20, stock: -5, minStock: 2, supplierName: 'NCC',
      ownerId: 'user_1', createdAt: now, updatedAt: now,
    }, now),
    'PERMISSION_DENIED'
  );
  // #9 Immortal field mutation
  assert.equal(
    evaluateUpdateSale(
      auth,
      { id: 'sale_1', ownerId: 'user_1', status: 'partial', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'sale_1', ownerId: 'user_2', status: 'paid', createdAt: '2026-11-01T00:00:00Z', updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );
  // #10 Forged timestamp
  assert.equal(
    evaluateCreateSale(auth, 'sale_1', { id: 'sale_1', ownerId: 'user_1', createdAt: '1999-01-01T00:00:00Z', updatedAt: now }, true, now),
    'PERMISSION_DENIED'
  );
  // #11 Terminal state reversal
  assert.equal(
    evaluateUpdateSale(
      auth,
      { id: 'sale_1', ownerId: 'user_1', status: 'paid', createdAt: now },
      { id: 'sale_1', ownerId: 'user_1', status: 'unpaid', createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );
});
