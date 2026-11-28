import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  get as rtdbGet,
  getDatabase,
  off,
  onDisconnect,
  onValue,
  ref as rtdbRef,
  runTransaction,
  set as rtdbSet,
  update as rtdbUpdate,
} from 'firebase/database';
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
  uploadString,
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  BackupEntry,
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SaleTransaction,
  StaffMember,
  UserRole,
} from '../types';
import { ADMIN_BACKUP_EMAIL, PRIMARY_ADMIN_UID } from '../data/seedData';
import {
  buildVoucherCounterMeta,
  extractMaxVoucherSequence,
  formatDefaultWarehouseNameFromGmail,
  formatVoucherCodeFromSequence,
  getIndependentWarehouseFullPermissions,
  getTodayVietnamDateStr,
} from '../utils/businessLogic';
import {
  AiTokenGrantRecord,
  COMMUNITY_MARKET_PRICES_FILE,
  CommunityMarketPriceBoard,
  CommunityMarketPriceEntry,
  isSharedAiCacheEntryValid,
  SHARED_AI_CACHE_FOLDER,
  SharedAiCacheEntry,
  upsertCommunityMarketPriceBoard,
} from '../utils/geminiReportAssistant';
import {
  ChatUserDirectoryEntry,
  INTERNAL_CHAT_GENERAL_ROOM_ID,
  INTERNAL_CHAT_MAX_FILE_BYTES,
  InternalChatAttachment,
  InternalChatMessage,
  InternalChatMessageType,
  InternalChatRoom,
  classifyChatAttachmentKind,
  sanitizeChatStorageFileName,
} from '../utils/internalChatLogic';
import {
  AdminWarehouseAccountSummary,
  applyIdempotentProductMutation,
  RtdbRecordCollection,
  buildFullKeyedWorkspace,
  buildStorageWorkspacePaths,
  buildWorkspaceDiffUpdates,
  computeWorkspaceFingerprint,
  countWorkspaceBusinessRecords,
  ensureArrayFromRtdb,
  isDestructiveEmptyWorkspaceOverwrite,
  isLegacyArrayWorkspaceLayout,
  mergeWorkspacePayloads,
  normalizeIndependentWarehouseStaffMember,
  normalizeWorkspaceFromRtdb,
  RtdbUserDirectoryProfile,
  RtdbWorkspacePayload,
  sanitizeForRealtimeDb,
  toRtdbRecordKey,
  toRtdbUserDirectoryProfile,
  preservePresenceFields,
} from '../utils/rtdbSyncLogic';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const rtdb = getDatabase(app, firebaseConfig.databaseURL);
export const auth = getAuth(app);
export const storage = getStorage(
  app,
  firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : undefined
);
storage.maxOperationRetryTime = 6000;
storage.maxUploadRetryTime = 10000;

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface CloudSyncResult {
  ok: boolean;
  syncedToCloud: boolean;
  reason?:
    | 'synced'
    | 'rtdb_primary'
    | 'unauthenticated'
    | 'email_unverified'
    | 'invalid_id'
    | 'not_admin'
    | 'paid_locked'
    | 'permission_denied'
    | 'error';
  message?: string;
}

export function sanitizeFirestoreId(id: string): string {
  const cleaned = (id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export function isValidFirestoreId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

export function isCurrentUserAdmin(user: User | null = auth.currentUser): boolean {
  if (!user) return false;
  if (user.uid === PRIMARY_ADMIN_UID) return true;
  return Boolean(
    user.emailVerified && user.email?.toLowerCase() === ADMIN_BACKUP_EMAIL.toLowerCase()
  );
}

export function canWriteToFirestore(user: User | null = auth.currentUser): boolean {
  if (!user) return false;
  return user.uid === PRIMARY_ADMIN_UID || user.emailVerified === true;
}

export function normalizeTimestamp(value: unknown, fallbackIso?: string): string {
  const fallback = fallbackIso || new Date().toISOString();
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    const maybeTs = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return maybeTs.toDate().toISOString();
      } catch {
        return fallback;
      }
    }
    if (typeof maybeTs.seconds === 'number') {
      return new Date(maybeTs.seconds * 1000).toISOString();
    }
  }
  return fallback;
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken);
      }
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

export async function resendVerificationEmail(): Promise<{ ok: boolean; message: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, message: 'Chưa có phiên đăng nhập Firebase.' };
  }
  if (user.emailVerified) {
    return { ok: true, message: 'Email đã được xác minh.' };
  }
  try {
    await sendEmailVerification(user);
    return {
      ok: true,
      message: `Đã gửi lại email xác minh tới ${user.email}. Vui lòng mở hộp thư và xác nhận để bật đồng bộ Cloud.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Không thể gửi email xác minh lúc này.',
    };
  }
}

async function syncAuthenticatedUserToFirestore(
  user: User,
  requestedRole: UserRole,
  fallbackDisplayName?: string,
  fallbackPhone?: string
): Promise<CloudSyncResult> {
  if (!canWriteToFirestore(user)) {
    return { ok: true, syncedToCloud: false, reason: 'email_unverified' };
  }
  if (!isValidFirestoreId(user.uid)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  const isAdmin = isCurrentUserAdmin(user);
  const safeDisplayName = (
    user.displayName ||
    fallbackDisplayName ||
    user.email ||
    'Nhân viên Tâm An'
  ).slice(0, 100);
  const safeEmail = (user.email || 'staff@taman.vn').slice(0, 150);
  const safePhone = (user.phoneNumber || fallbackPhone || '').slice(0, 30);

  try {
    const staffRef = doc(db, 'staff', user.uid);
    const staffSnap = await getDoc(staffRef);

    if (!staffSnap.exists()) {
      // Non-admin users can only self-register as role == 'staff' per firestore.rules
      const createRole: UserRole = isAdmin ? (requestedRole || 'manager') : 'staff';
      await setDoc(staffRef, {
        uid: user.uid,
        displayName: safeDisplayName,
        role: createRole,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = staffSnap.data();
      if (isAdmin) {
        await updateDoc(staffRef, {
          displayName: safeDisplayName,
          role: existingData.role || 'manager',
          active: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(staffRef, {
          displayName: safeDisplayName,
          updatedAt: serverTimestamp(),
        });
      }
    }

    const privateRef = doc(db, 'staff_private', user.uid);
    const privateSnap = await getDoc(privateRef);
    if (!privateSnap.exists()) {
      await setDoc(privateRef, {
        uid: user.uid,
        email: safeEmail.length >= 3 ? safeEmail : 'staff@taman.vn',
        phone: safePhone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(privateRef, {
        email: safeEmail.length >= 3 ? safeEmail : 'staff@taman.vn',
        phone: safePhone,
        updatedAt: serverTimestamp(),
      });
    }

    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Sync staff profile skipped:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export const googleSignInWithRole = async (
  requestedRole: UserRole
): Promise<{ user: User; accessToken: string | null; resolvedRole: UserRole } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;

    const user = result.user;
    const isAdminUser = isCurrentUserAdmin(user);
    const resolvedRole: UserRole = isAdminUser ? 'manager' : requestedRole;

    await syncAuthenticatedUserToFirestore(user, resolvedRole);

    return { user, accessToken: cachedAccessToken, resolvedRole };
  } finally {
    isSigningIn = false;
  }
};

export async function firebaseSignInWithEmailPassword(
  email: string,
  password: string
): Promise<{ user: User; resolvedRole: UserRole }> {
  isSigningIn = true;
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
    const user = credential.user;
    const isAdmin = isCurrentUserAdmin(user);
    const resolvedRole: UserRole = isAdmin ? 'manager' : 'staff';
    await syncAuthenticatedUserToFirestore(user, resolvedRole);
    return { user, resolvedRole };
  } finally {
    isSigningIn = false;
  }
}

export async function firebaseSignUpWithEmailPassword(payload: {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
}): Promise<{ user: User; resolvedRole: UserRole; verificationSent: boolean }> {
  isSigningIn = true;
  try {
    const trimmedEmail = payload.email.trim().toLowerCase();
    const credential = await createUserWithEmailAndPassword(
      auth,
      trimmedEmail,
      payload.password
    );
    const user = credential.user;
    if (payload.displayName.trim()) {
      await updateProfile(user, {
        displayName: payload.displayName.trim(),
      });
    }
    let verificationSent = false;
    try {
      await sendEmailVerification(user);
      verificationSent = true;
    } catch {
      verificationSent = false;
    }

    const isAdmin = isCurrentUserAdmin(user);
    const resolvedRole: UserRole = isAdmin ? 'manager' : 'staff';
    await syncAuthenticatedUserToFirestore(
      user,
      resolvedRole,
      payload.displayName.trim(),
      payload.phone?.trim()
    );
    return { user, resolvedRole, verificationSent };
  } finally {
    isSigningIn = false;
  }
}

export async function firebaseSendPasswordResetEmail(email: string): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();
  await sendPasswordResetEmail(auth, trimmedEmail);
}

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutUser = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ============================================================================
// FIREBASE STORAGE INTEGRATION (Bucket: gapgold-e6b62.firebasestorage.app)
// ============================================================================

export interface FirebaseStorageUploadResult {
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  syncedToCloud: boolean;
}

export async function uploadFileToFirebaseStorage(
  file: File | Blob,
  folder: 'uploads' | 'backups' | 'excel_imports' = 'uploads',
  customFileName?: string
): Promise<FirebaseStorageUploadResult> {
  const safeName = (
    customFileName ||
    (file instanceof File ? file.name : `file_${Date.now()}.json`)
  ).replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const uid = auth.currentUser?.uid || 'local_workspace';
  const storagePath = `${folder}/${uid}/${timestamp}_${safeName}`;

  if (!auth.currentUser) {
    return {
      storagePath,
      downloadUrl: '',
      fileName: safeName,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      syncedToCloud: false,
    };
  }

  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      uploadedByEmail: auth.currentUser.email || ADMIN_BACKUP_EMAIL,
      uploadedAt: new Date().toISOString(),
      originalName: file instanceof File ? file.name : safeName,
    },
  });

  let downloadUrl = '';
  try {
    downloadUrl = await getDownloadURL(snapshot.ref);
  } catch {
    downloadUrl = `gs://${firebaseConfig.storageBucket}/${storagePath}`;
  }

  return {
    storagePath,
    downloadUrl,
    fileName: safeName,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    syncedToCloud: true,
  };
}

export async function uploadBackupToFirebaseStorage(payload: {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  triggerType: 'auto_daily' | 'manual';
  fullSnapshotJson?: string;
  customFileName?: string;
}): Promise<BackupEntry> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName =
    payload.customFileName ||
    `VTNN_TamAn_Backup_${todayStr}_${Date.now().toString().slice(-4)}.json`;
  const totalRecords =
    payload.products.length +
    payload.customers.length +
    payload.sales.length +
    payload.imports.length;

  const backupJson =
    payload.fullSnapshotJson ||
    JSON.stringify(
      {
        storeName: 'VTNN Tâm An - Vật tư Tâm An - Nhà Nông an tâm',
        storageBucket: firebaseConfig.storageBucket,
        backupTargetEmail: ADMIN_BACKUP_EMAIL,
        exportedAt: new Date().toISOString(),
        summary: {
          productsCount: payload.products.length,
          customersCount: payload.customers.length,
          salesCount: payload.sales.length,
          importsCount: payload.imports.length,
        },
        data: payload,
      },
      null,
      2
    );

  const user = auth.currentUser;
  const uid = user?.uid || PRIMARY_ADMIN_UID;
  const storagePath = `backups/${uid}/${fileName}`;
  let storedRefId = `local_backup_${Date.now()}`;

  if (user) {
    try {
      const storageRef = ref(storage, storagePath);
      await uploadString(storageRef, backupJson, 'raw', {
        contentType: 'application/json;charset=utf-8',
        customMetadata: {
          storeName: 'VTNN Tam An',
          targetEmail: ADMIN_BACKUP_EMAIL,
          recordCount: String(totalRecords),
          triggerType: payload.triggerType,
        },
      });
      storedRefId = storagePath;
    } catch (err) {
      console.warn('Firebase Storage backup warning (saved locally):', err);
    }
  }

  const backupId = sanitizeFirestoreId(`bk_${Date.now()}`);
  const entry: BackupEntry = {
    id: backupId,
    fileName,
    driveFileId: storedRefId.slice(0, 128),
    targetEmail: ADMIN_BACKUP_EMAIL,
    recordCount: totalRecords,
    status: 'completed',
    triggerType: payload.triggerType,
    ownerId: uid,
    createdAt: new Date().toISOString(),
  };

  if (canWriteToFirestore(user)) {
    try {
      await setDoc(doc(db, 'backups', entry.id), {
        id: entry.id,
        fileName: entry.fileName.slice(0, 150),
        driveFileId: entry.driveFileId.slice(0, 128),
        targetEmail: entry.targetEmail.slice(0, 150),
        recordCount: Math.max(0, Number(entry.recordCount) || 0),
        status: entry.status,
        triggerType: entry.triggerType,
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn('Firestore backup metadata sync skipped:', error);
    }
  }

  return entry;
}

export const uploadBackupToGoogleDrive = uploadBackupToFirebaseStorage;

export async function deleteBackupFileFromDrive(storagePathOrId: string, backupId?: string): Promise<void> {
  if (
    auth.currentUser &&
    storagePathOrId &&
    (storagePathOrId.startsWith('backups/') || storagePathOrId.startsWith('uploads/'))
  ) {
    try {
      const fileRef = ref(storage, storagePathOrId);
      await deleteObject(fileRef);
    } catch (err) {
      console.warn('Firebase Storage delete warning:', err);
    }
  }
  if (backupId && isCurrentUserAdmin(auth.currentUser) && isValidFirestoreId(backupId)) {
    try {
      await deleteDoc(doc(db, 'backups', backupId));
    } catch {
      // Ignore if local-only or permission scoped
    }
  }
}

// ============================================================================
// SAFE 2-LAYER FIRESTORE SYNC HELPERS (Rule-Compliant, Zero PERMISSION_DENIED)
// ============================================================================

/**
 * Firebase Realtime Database (`/workspaces/{ownerUid}`) is the SINGLE source of truth for business data
 * (products, customers, suppliers, sales, imports, vouchers, stock adjustments).
 * Firestore business-collection sync is permanently disabled to avoid divergent copies.
 */
export const FIRESTORE_BUSINESS_SYNC_ENABLED = false;

export async function syncProductToFirestore(
  product: ProductItem,
  _preferCreate = false
): Promise<CloudSyncResult> {
  if (!FIRESTORE_BUSINESS_SYNC_ENABLED) {
    return { ok: true, syncedToCloud: false, reason: 'rtdb_primary' };
  }
  const user = auth.currentUser;
  if (!canWriteToFirestore(user)) {
    return {
      ok: true,
      syncedToCloud: false,
      reason: user ? 'email_unverified' : 'unauthenticated',
    };
  }
  const safeId = sanitizeFirestoreId(product.id);
  if (!isValidFirestoreId(safeId)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  try {
    const prodRef = doc(db, 'products', safeId);
    const snap = await getDoc(prodRef);

    const payloadBase = {
      code: (product.code || safeId).slice(0, 40),
      name: (product.name || 'Vật tư').slice(0, 150),
      category: (product.category || 'Phân bón').slice(0, 50),
      unit: (product.unit || 'Đơn vị').slice(0, 30),
      importPrice: Math.max(0, Number(product.importPrice) || 0),
      sellPrice: Math.max(0, Number(product.sellPrice) || 0),
      stock: Math.max(0, Number(product.stock) || 0),
      minStock: Math.max(0, Number(product.minStock) || 0),
      supplierName: (product.supplierName || '').slice(0, 150),
    };

    if (!snap.exists()) {
      await setDoc(prodRef, {
        id: safeId,
        ...payloadBase,
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      if (existingData.ownerId !== user!.uid && !isCurrentUserAdmin(user)) {
        return { ok: true, syncedToCloud: false, reason: 'not_admin' };
      }
      await updateDoc(prodRef, {
        ...payloadBase,
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Firestore product sync fallback to local:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export async function syncCustomerToFirestore(
  customer: CustomerProfile,
  _preferCreate = false
): Promise<CloudSyncResult> {
  if (!FIRESTORE_BUSINESS_SYNC_ENABLED) {
    return { ok: true, syncedToCloud: false, reason: 'rtdb_primary' };
  }
  const user = auth.currentUser;
  if (!canWriteToFirestore(user)) {
    return {
      ok: true,
      syncedToCloud: false,
      reason: user ? 'email_unverified' : 'unauthenticated',
    };
  }
  const safeId = sanitizeFirestoreId(customer.id);
  if (!isValidFirestoreId(safeId)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  try {
    const custRef = doc(db, 'customers', safeId);
    const custSnap = await getDoc(custRef);

    const publicFields = {
      code: (customer.code || safeId).slice(0, 40),
      name: (customer.name || 'Khách hàng').slice(0, 120),
      group: (customer.group || 'Nhà nông').slice(0, 40),
      totalPurchased: Math.max(0, Number(customer.totalPurchased) || 0),
      totalDebt: Math.max(0, Number(customer.totalDebt) || 0),
    };

    if (!custSnap.exists()) {
      await setDoc(custRef, {
        id: safeId,
        ...publicFields,
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = custSnap.data();
      if (existingData.ownerId !== user!.uid && !isCurrentUserAdmin(user)) {
        return { ok: true, syncedToCloud: false, reason: 'not_admin' };
      }
      await updateDoc(custRef, {
        ...publicFields,
        updatedAt: serverTimestamp(),
      });
    }

    // customers_private requires phone.size() >= 1 in firestore.rules
    const safePhone = (customer.phone || '').trim() || 'Chưa cập nhật';
    const privRef = doc(db, 'customers_private', safeId);
    const privSnap = await getDoc(privRef);

    const privateFields = {
      phone: safePhone.slice(0, 30),
      email: (customer.email || '').slice(0, 150),
      address: (customer.address || '').slice(0, 250),
      note: (customer.note || '').slice(0, 300),
    };

    if (!privSnap.exists()) {
      await setDoc(privRef, {
        id: safeId,
        ...privateFields,
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(privRef, {
        ...privateFields,
        updatedAt: serverTimestamp(),
      });
    }

    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Firestore customer sync fallback to local:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export async function syncSaleToFirestore(
  sale: SaleTransaction,
  _preferCreate = false,
  relatedProduct?: ProductItem
): Promise<CloudSyncResult> {
  if (!FIRESTORE_BUSINESS_SYNC_ENABLED) {
    return { ok: true, syncedToCloud: false, reason: 'rtdb_primary' };
  }
  const user = auth.currentUser;
  if (!canWriteToFirestore(user)) {
    return {
      ok: true,
      syncedToCloud: false,
      reason: user ? 'email_unverified' : 'unauthenticated',
    };
  }
  const safeId = sanitizeFirestoreId(sale.id);
  const safeProductId = sanitizeFirestoreId(sale.productId);
  const safeCustomerId = sanitizeFirestoreId(sale.customerId);
  if (!isValidFirestoreId(safeId) || !isValidFirestoreId(safeProductId)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  try {
    const saleRef = doc(db, 'sales', safeId);
    const snap = await getDoc(saleRef);

    if (!snap.exists()) {
      // Ensure referenced product exists in Firestore before creating sale (required by firestore.rules)
      const prodSnap = await getDoc(doc(db, 'products', safeProductId));
      if (!prodSnap.exists()) {
        if (relatedProduct) {
          await syncProductToFirestore(relatedProduct, true);
        } else {
          await syncProductToFirestore(
            {
              id: safeProductId,
              code: safeProductId.slice(0, 40),
              name: sale.productName || 'Vật tư',
              category: 'Phân bón',
              unit: sale.unit || 'Đơn vị',
              importPrice: 0,
              sellPrice: Math.max(0, Number(sale.unitPrice) || 0),
              stock: 0,
              minStock: 0,
              supplierName: '',
              ownerId: user!.uid,
              createdAt: sale.createdAt,
              updatedAt: sale.updatedAt,
            },
            true
          );
        }
      }

      await setDoc(saleRef, {
        id: safeId,
        invoiceCode: (sale.invoiceCode || safeId).slice(0, 40),
        customerId: safeCustomerId,
        customerName: (sale.customerName || 'Khách lẻ').slice(0, 120),
        customerPhone: (sale.customerPhone || '').slice(0, 30),
        productId: safeProductId,
        productName: (sale.productName || 'Vật tư').slice(0, 150),
        unit: (sale.unit || 'Đơn vị').slice(0, 30),
        quantity: Math.max(1, Number(sale.quantity) || 1),
        unitPrice: Math.max(0, Number(sale.unitPrice) || 0),
        totalAmount: Math.max(0, Number(sale.totalAmount) || 0),
        paidAmount: Math.max(0, Number(sale.paidAmount) || 0),
        debtAmount: Math.max(0, Number(sale.debtAmount) || 0),
        dueDate: (sale.dueDate || '').slice(0, 30),
        status: sale.status,
        note: (sale.note || '').slice(0, 300),
        staffName: (sale.staffName || '').slice(0, 100),
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      const isAdmin = isCurrentUserAdmin(user);
      if (!isAdmin) {
        if (existingData.ownerId !== user!.uid) {
          return { ok: true, syncedToCloud: false, reason: 'not_admin' };
        }
        if (existingData.status === 'paid') {
          return { ok: true, syncedToCloud: false, reason: 'paid_locked' };
        }
        if (Number(sale.paidAmount) < Number(existingData.paidAmount || 0)) {
          return { ok: true, syncedToCloud: false, reason: 'not_admin' };
        }
      }
      await updateDoc(saleRef, {
        paidAmount: Math.max(0, Number(sale.paidAmount) || 0),
        debtAmount: Math.max(0, Number(sale.debtAmount) || 0),
        status: sale.status,
        note: (sale.note || '').slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    }

    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Firestore sale sync fallback to local:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export async function syncImportToFirestore(
  imp: ImportTransaction,
  _preferCreate = false,
  relatedProduct?: ProductItem
): Promise<CloudSyncResult> {
  if (!FIRESTORE_BUSINESS_SYNC_ENABLED) {
    return { ok: true, syncedToCloud: false, reason: 'rtdb_primary' };
  }
  const user = auth.currentUser;
  if (!canWriteToFirestore(user)) {
    return {
      ok: true,
      syncedToCloud: false,
      reason: user ? 'email_unverified' : 'unauthenticated',
    };
  }
  const safeId = sanitizeFirestoreId(imp.id);
  const safeProductId = sanitizeFirestoreId(imp.productId);
  if (!isValidFirestoreId(safeId) || !isValidFirestoreId(safeProductId)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  try {
    const impRef = doc(db, 'imports', safeId);
    const snap = await getDoc(impRef);

    if (!snap.exists()) {
      const prodSnap = await getDoc(doc(db, 'products', safeProductId));
      if (!prodSnap.exists()) {
        if (relatedProduct) {
          await syncProductToFirestore(relatedProduct, true);
        } else {
          await syncProductToFirestore(
            {
              id: safeProductId,
              code: safeProductId.slice(0, 40),
              name: imp.productName || 'Vật tư',
              category: 'Phân bón',
              unit: imp.unit || 'Đơn vị',
              importPrice: Math.max(0, Number(imp.unitCost) || 0),
              sellPrice: Math.max(0, Number(imp.unitCost) || 0),
              stock: Math.max(0, Number(imp.quantity) || 0),
              minStock: 0,
              supplierName: imp.supplierName || '',
              ownerId: user!.uid,
              createdAt: imp.createdAt,
              updatedAt: imp.updatedAt,
            },
            true
          );
        }
      }

      await setDoc(impRef, {
        id: safeId,
        receiptCode: (imp.receiptCode || safeId).slice(0, 40),
        supplierName: (imp.supplierName || 'Nhà cung cấp').slice(0, 150),
        supplierPhone: (imp.supplierPhone || '').slice(0, 30),
        productId: safeProductId,
        productName: (imp.productName || 'Vật tư').slice(0, 150),
        unit: (imp.unit || 'Đơn vị').slice(0, 30),
        quantity: Math.max(1, Number(imp.quantity) || 1),
        unitCost: Math.max(0, Number(imp.unitCost) || 0),
        totalCost: Math.max(0, Number(imp.totalCost) || 0),
        paidAmount: Math.max(0, Number(imp.paidAmount) || 0),
        debtAmount: Math.max(0, Number(imp.debtAmount) || 0),
        dueDate: (imp.dueDate || '').slice(0, 30),
        status: imp.status,
        note: (imp.note || '').slice(0, 300),
        staffName: (imp.staffName || '').slice(0, 100),
        ownerId: user!.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      const isAdmin = isCurrentUserAdmin(user);
      if (!isAdmin) {
        if (existingData.ownerId !== user!.uid) {
          return { ok: true, syncedToCloud: false, reason: 'not_admin' };
        }
        if (existingData.status === 'paid') {
          return { ok: true, syncedToCloud: false, reason: 'paid_locked' };
        }
        if (Number(imp.paidAmount) < Number(existingData.paidAmount || 0)) {
          return { ok: true, syncedToCloud: false, reason: 'not_admin' };
        }
      }
      await updateDoc(impRef, {
        paidAmount: Math.max(0, Number(imp.paidAmount) || 0),
        debtAmount: Math.max(0, Number(imp.debtAmount) || 0),
        status: imp.status,
        note: (imp.note || '').slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    }

    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Firestore import sync fallback to local:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export async function deleteFirestoreDocIfAdmin(
  collectionName: 'products' | 'customers' | 'customers_private' | 'sales' | 'imports' | 'backups',
  docId: string
): Promise<CloudSyncResult> {
  const user = auth.currentUser;
  if (!isCurrentUserAdmin(user)) {
    return { ok: true, syncedToCloud: false, reason: 'not_admin' };
  }
  const safeId = sanitizeFirestoreId(docId);
  if (!isValidFirestoreId(safeId)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }
  try {
    await deleteDoc(doc(db, collectionName, safeId));
    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch {
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

/**
 * ADMIN ONLY: permanently deletes every legacy business document from Firestore
 * (products, customers, customers_private, sales, imports) after the cutover to Realtime Database.
 */
export async function purgeFirestoreBusinessCollections(): Promise<{
  deleted: number;
  failed: number;
}> {
  const user = auth.currentUser;
  if (!isCurrentUserAdmin(user)) return { deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  const names = ['products', 'customers', 'customers_private', 'sales', 'imports'] as const;
  for (const name of names) {
    try {
      const snap = await getDocs(collection(db, name));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const chunk = docs.slice(i, i + 400);
        try {
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deleted += chunk.length;
        } catch {
          failed += chunk.length;
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

/**
 * Clears ALL business data (products, customers, suppliers, sales, imports, vouchers, stock adjustments,
 * voucher counters, tombstones) of the given workspaces in Realtime Database and stamps `settings/dataWipedAt`.
 * Staff accounts, warehouse list, note templates, VietQR config, audit logs and backups are preserved.
 */
export async function purgeRealtimeBusinessDataForWorkspaces(
  ownerUids: string[],
  wipedAtIso: string,
  actorUid: string,
  actorName: string
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  if (!auth.currentUser) return { ok, failed: ownerUids };
  const uniqueUids = Array.from(
    new Set(ownerUids.map((u) => sanitizeFirestoreId(u)).filter(Boolean))
  );
  await Promise.allSettled(
    uniqueUids.map(async (uid) => {
      try {
        await rtdbUpdate(rtdbRef(rtdb, `workspaces/${uid}`), {
          products: null,
          customers: null,
          suppliers: null,
          sales: null,
          imports: null,
          receiptVouchers: null,
          paymentVouchers: null,
          savedVouchers: null,
          stockAdjustments: null,
          counters: null,
          'settings/deletedRecords': null,
          'settings/dataWipedAt': wipedAtIso,
          'meta/ownerUid': uid,
          'meta/updatedAt': wipedAtIso,
          'meta/updatedByUid': actorUid,
          'meta/updatedByName': actorName,
        });
        ok.push(uid);
      } catch (err) {
        console.warn(
          `purgeRealtimeBusinessDataForWorkspaces(${uid}) warning:`,
          err instanceof Error ? err.message : err
        );
        failed.push(uid);
      }
    })
  );
  return { ok, failed };
}

/**
 * Lightweight presence heartbeat stored on `/users_directory/{uid}` (best-effort; failures are ignored).
 */
export async function touchRealtimePresence(
  uid: string,
  state: { online: boolean; activeWarehouse?: string }
): Promise<boolean> {
  if (!auth.currentUser || !uid) return false;
  const safeUid = sanitizeFirestoreId(uid);
  if (!safeUid) return false;
  try {
    const dirRef = rtdbRef(rtdb, `users_directory/${safeUid}`);
    await rtdbUpdate(dirRef, {
      presenceOnline: state.online,
      lastSeenAt: Date.now(),
      presenceWarehouse: state.activeWarehouse || '',
    });
    if (state.online) {
      void onDisconnect(dirRef)
        .update({ presenceOnline: false, lastSeenAt: Date.now() })
        .catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export async function syncNotificationPrefsToFirestore(
  prefs: NotificationPrefs,
  _preferCreate = false
): Promise<CloudSyncResult> {
  const user = auth.currentUser;
  if (!canWriteToFirestore(user)) {
    return {
      ok: true,
      syncedToCloud: false,
      reason: user ? 'email_unverified' : 'unauthenticated',
    };
  }
  const uid = user!.uid;
  if (!isValidFirestoreId(uid)) {
    return { ok: false, syncedToCloud: false, reason: 'invalid_id' };
  }

  try {
    const prefRef = doc(db, 'notification_prefs', uid);
    const snap = await getDoc(prefRef);
    const clampedLeadDays = Math.min(30, Math.max(1, Math.round(Number(prefs.leadDays) || 5)));

    const fields = {
      debtCustomerEnabled: Boolean(prefs.debtCustomerEnabled),
      debtSupplierEnabled: Boolean(prefs.debtSupplierEnabled),
      lowStockEnabled: Boolean(prefs.lowStockEnabled),
      periodicReportEnabled: Boolean(prefs.periodicReportEnabled),
      browserPushEnabled: Boolean(prefs.browserPushEnabled),
      leadDays: clampedLeadDays,
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      await setDoc(prefRef, { uid, ...fields });
    } else {
      await updateDoc(prefRef, fields);
    }
    return { ok: true, syncedToCloud: true, reason: 'synced' };
  } catch (err) {
    console.warn('Firestore prefs sync fallback to local:', err instanceof Error ? err.message : err);
    return { ok: true, syncedToCloud: false, reason: 'permission_denied' };
  }
}

export async function fetchUserFirestoreData(
  uid: string,
  isAdminUser?: boolean
): Promise<{
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  backups: BackupEntry[];
  notificationPrefs: NotificationPrefs | null;
} | null> {
  if (!auth.currentUser) return null;
  const canReadAll = Boolean(isAdminUser || uid === PRIMARY_ADMIN_UID);

  const buildScopedQuery = (colName: string) =>
    canReadAll
      ? query(collection(db, colName))
      : query(collection(db, colName), where('ownerId', '==', uid));

  type SkippedLegacySnapshot = {
    docs: Array<{ id: string; data: () => any }>;
  };
  const skippedFirestoreQuery = (): Promise<SkippedLegacySnapshot> =>
    Promise.reject(new Error('rtdb_primary'));

  const [prodRes, salesRes, impRes, custRes, custPrivRes, backupRes, prefsRes] =
    await Promise.allSettled([
      // Business data now lives ONLY in Realtime Database — skip legacy Firestore business collections.
      skippedFirestoreQuery(),
      skippedFirestoreQuery(),
      skippedFirestoreQuery(),
      skippedFirestoreQuery(),
      skippedFirestoreQuery(),
      getDocs(buildScopedQuery('backups')),
      getDoc(doc(db, 'notification_prefs', uid)),
    ]);

  const products: ProductItem[] =
    prodRes.status === 'fulfilled'
      ? prodRes.value.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as ProductItem),
            id: data.id || d.id,
            createdAt: normalizeTimestamp(data.createdAt),
            updatedAt: normalizeTimestamp(data.updatedAt),
          };
        })
      : [];

  const sales: SaleTransaction[] =
    salesRes.status === 'fulfilled'
      ? salesRes.value.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as SaleTransaction),
            id: data.id || d.id,
            createdAt: normalizeTimestamp(data.createdAt),
            updatedAt: normalizeTimestamp(data.updatedAt),
          };
        })
      : [];

  const imports: ImportTransaction[] =
    impRes.status === 'fulfilled'
      ? impRes.value.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as ImportTransaction),
            id: data.id || d.id,
            createdAt: normalizeTimestamp(data.createdAt),
            updatedAt: normalizeTimestamp(data.updatedAt),
          };
        })
      : [];

  const privateCustomerMap = new Map<string, { phone?: string; email?: string; address?: string; note?: string }>();
  if (custPrivRes.status === 'fulfilled') {
    for (const d of custPrivRes.value.docs) {
      const data = d.data();
      privateCustomerMap.set(data.id || d.id, {
        phone: data.phone === 'Chưa cập nhật' ? '' : String(data.phone || ''),
        email: String(data.email || ''),
        address: String(data.address || ''),
        note: String(data.note || ''),
      });
    }
  }

  const customers: CustomerProfile[] =
    custRes.status === 'fulfilled'
      ? custRes.value.docs.map((d) => {
          const data = d.data();
          const priv = privateCustomerMap.get(data.id || d.id);
          return {
            ...(data as CustomerProfile),
            id: data.id || d.id,
            phone: priv?.phone ?? String(data.phone || ''),
            email: priv?.email ?? String(data.email || ''),
            address: priv?.address ?? String(data.address || ''),
            note: priv?.note ?? String(data.note || ''),
            createdAt: normalizeTimestamp(data.createdAt),
            updatedAt: normalizeTimestamp(data.updatedAt),
          };
        })
      : [];

  const backups: BackupEntry[] =
    backupRes.status === 'fulfilled'
      ? backupRes.value.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as BackupEntry),
            id: data.id || d.id,
            createdAt: normalizeTimestamp(data.createdAt),
          };
        })
      : [];

  let notificationPrefs: NotificationPrefs | null = null;
  if (prefsRes.status === 'fulfilled' && prefsRes.value.exists()) {
    const pData = prefsRes.value.data();
    notificationPrefs = {
      uid: String(pData.uid || uid),
      debtCustomerEnabled: Boolean(pData.debtCustomerEnabled),
      debtSupplierEnabled: Boolean(pData.debtSupplierEnabled),
      lowStockEnabled: Boolean(pData.lowStockEnabled),
      periodicReportEnabled: Boolean(pData.periodicReportEnabled),
      browserPushEnabled: Boolean(pData.browserPushEnabled),
      leadDays: Math.min(30, Math.max(1, Number(pData.leadDays) || 5)),
      updatedAt: normalizeTimestamp(pData.updatedAt),
    };
  }

  if (
    products.length === 0 &&
    customers.length === 0 &&
    sales.length === 0 &&
    imports.length === 0 &&
    backups.length === 0 &&
    !notificationPrefs
  ) {
    return null;
  }

  return { products, customers, sales, imports, backups, notificationPrefs };
}

// ============================================================================
// SHARED AI KNOWLEDGE CACHE & COMMUNITY MARKET PRICES (/documents/ai_cache/)
// ============================================================================

const COMMUNITY_MARKET_PRICES_LOCAL_KEY = 'vtnn_taman_community_prices_v1';

async function readJsonFromFirebaseStoragePath<T>(storagePath: string): Promise<T | null> {
  const bucket = firebaseConfig.storageBucket;
  if (!bucket || !storagePath) return null;
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
      bucket
    )}/o/${encodeURIComponent(storagePath)}?alt=media`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const headers: Record<string, string> = {};
    if (idToken) {
      headers.Authorization = `Firebase ${idToken}`;
    }
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      return (await res.json()) as T;
    }
  } catch {
    // Fallback to SDK getDownloadURL below
  }

  if (!auth.currentUser) return null;
  try {
    const downloadUrl = await getDownloadURL(ref(storage, storagePath));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(downloadUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function readSharedAiCacheFromFirebaseStorage(
  fileName: string
): Promise<SharedAiCacheEntry | null> {
  if (!fileName || !/^[a-zA-Z0-9_-]+\.json$/.test(fileName)) {
    return null;
  }
  const storagePath = `${SHARED_AI_CACHE_FOLDER}/${fileName}`;
  const parsed = await readJsonFromFirebaseStoragePath<SharedAiCacheEntry>(storagePath);
  if (!isSharedAiCacheEntryValid(parsed)) {
    return null;
  }
  return parsed;
}

export async function writeSharedAiCacheToFirebaseStorage(
  entry: SharedAiCacheEntry
): Promise<boolean> {
  if (!auth.currentUser) {
    return false;
  }
  if (!entry?.cacheFileName || !/^[a-zA-Z0-9_-]+\.json$/.test(entry.cacheFileName)) {
    return false;
  }
  const storagePath = `${SHARED_AI_CACHE_FOLDER}/${entry.cacheFileName}`;
  try {
    const payload = JSON.stringify(entry);
    if (payload.length >= 95 * 1024) {
      return false;
    }
    const fileRef = ref(storage, storagePath);
    await uploadString(fileRef, payload, 'raw', {
      contentType: 'application/json;charset=utf-8',
      customMetadata: {
        category: entry.category,
        canonicalKey: entry.canonicalKey.slice(0, 180),
        updatedAt: entry.updatedAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

function readCommunityMarketPricesFromLocalStorage(): CommunityMarketPriceBoard | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(COMMUNITY_MARKET_PRICES_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommunityMarketPriceBoard;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    const now = Date.now();
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      entries: parsed.entries.filter(
        (e) => e && typeof e.expiresAt === 'number' && e.expiresAt > now
      ),
    };
  } catch {
    return null;
  }
}

function saveCommunityMarketPricesToLocalStorage(board: CommunityMarketPriceBoard): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(COMMUNITY_MARKET_PRICES_LOCAL_KEY, JSON.stringify(board));
  } catch {
    // ignore storage quota errors
  }
}

export async function readCommunityMarketPricesFromFirebaseStorage(): Promise<CommunityMarketPriceBoard | null> {
  const storagePath = `${SHARED_AI_CACHE_FOLDER}/${COMMUNITY_MARKET_PRICES_FILE}`;
  const cloudBoard =
    await readJsonFromFirebaseStoragePath<CommunityMarketPriceBoard>(storagePath);
  const now = Date.now();
  if (cloudBoard && Array.isArray(cloudBoard.entries)) {
    const filtered: CommunityMarketPriceBoard = {
      version: cloudBoard.version || 1,
      updatedAt: cloudBoard.updatedAt || new Date().toISOString(),
      entries: cloudBoard.entries.filter(
        (e) => e && typeof e.expiresAt === 'number' && e.expiresAt > now
      ),
    };
    saveCommunityMarketPricesToLocalStorage(filtered);
    return filtered;
  }
  return readCommunityMarketPricesFromLocalStorage();
}

export async function contributeCommunityMarketPriceToFirebaseStorage(input: {
  topic: CommunityMarketPriceEntry['topic'];
  itemName: string;
  normalizedItem: string;
  priceText: string;
  region?: string;
  rawNote: string;
  contributorName: string;
  contributorUid: string;
}): Promise<{
  ok: boolean;
  board: CommunityMarketPriceBoard;
  savedEntry: CommunityMarketPriceEntry;
  syncedToCloud: boolean;
}> {
  const existing =
    (await readCommunityMarketPricesFromFirebaseStorage()) ||
    readCommunityMarketPricesFromLocalStorage();

  const { board, savedEntry } = upsertCommunityMarketPriceBoard(existing, input);
  saveCommunityMarketPricesToLocalStorage(board);

  let syncedToCloud = false;
  if (auth.currentUser) {
    try {
      const storagePath = `${SHARED_AI_CACHE_FOLDER}/${COMMUNITY_MARKET_PRICES_FILE}`;
      const fileRef = ref(storage, storagePath);
      await uploadString(fileRef, JSON.stringify(board), 'raw', {
        contentType: 'application/json;charset=utf-8',
        customMetadata: {
          updatedAt: board.updatedAt,
          entryCount: String(board.entries.length),
        },
      });
      syncedToCloud = true;
    } catch {
      syncedToCloud = false;
    }
  }

  return { ok: true, board, savedEntry, syncedToCloud };
}

// ============================================================================
// PRIMARY ADMIN AI TOKEN GRANTS (Firestore: /ai_token_grants/{accountId})
// ============================================================================

const LOCAL_TOKEN_GRANTS_STORAGE_KEY = 'vtnn_taman_ai_token_grants_v1';

function readLocalTokenGrantsMap(): Record<string, AiTokenGrantRecord> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(LOCAL_TOKEN_GRANTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, AiTokenGrantRecord>) : {};
  } catch {
    return {};
  }
}

function saveLocalTokenGrant(record: AiTokenGrantRecord): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const map = readLocalTokenGrantsMap();
    map[record.accountId] = record;
    localStorage.setItem(LOCAL_TOKEN_GRANTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function subscribeToAiTokenGrant(
  accountId: string,
  onChange: (grant: AiTokenGrantRecord | null) => void
): () => void {
  const safeId = sanitizeFirestoreId(accountId);
  if (!safeId) {
    onChange(null);
    return () => {};
  }

  const localCached = readLocalTokenGrantsMap()[safeId];
  const todayVn = getTodayVietnamDateStr();
  if (localCached && localCached.date === todayVn) {
    onChange(localCached);
  } else {
    onChange(null);
  }

  if (!auth.currentUser) {
    return () => {};
  }

  const grantRef = doc(db, 'ai_token_grants', safeId);
  return onSnapshot(
    grantRef,
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      const d = snap.data();
      const rec: AiTokenGrantRecord = {
        accountId: String(d.accountId || safeId),
        date: String(d.date || ''),
        bonusTokens: Math.max(0, Number(d.bonusTokens) || 0),
        lastGrantedAmount: Math.max(0, Number(d.lastGrantedAmount) || 0),
        grantedByUid: String(d.grantedByUid || PRIMARY_ADMIN_UID),
        grantedByName: String(d.grantedByName || 'Admin Quản trị'),
        note: String(d.note || ''),
        updatedAt: normalizeTimestamp(d.updatedAt),
      };
      saveLocalTokenGrant(rec);
      onChange(rec.date === getTodayVietnamDateStr() ? rec : null);
    },
    (err) => {
      console.warn('subscribeToAiTokenGrant warning:', err.message);
    }
  );
}

export function subscribeToAllAiTokenGrantsForAdmin(
  onChange: (grantsByAccount: Record<string, AiTokenGrantRecord>) => void
): () => void {
  const user = auth.currentUser;
  if (!user || !isCurrentUserAdmin(user)) {
    onChange({});
    return () => {};
  }

  const todayVn = getTodayVietnamDateStr();
  return onSnapshot(
    collection(db, 'ai_token_grants'),
    (snap) => {
      const map: Record<string, AiTokenGrantRecord> = {};
      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        const rec: AiTokenGrantRecord = {
          accountId: String(d.accountId || docSnap.id),
          date: String(d.date || ''),
          bonusTokens: Math.max(0, Number(d.bonusTokens) || 0),
          lastGrantedAmount: Math.max(0, Number(d.lastGrantedAmount) || 0),
          grantedByUid: String(d.grantedByUid || PRIMARY_ADMIN_UID),
          grantedByName: String(d.grantedByName || 'Admin Quản trị'),
          note: String(d.note || ''),
          updatedAt: normalizeTimestamp(d.updatedAt),
        };
        if (rec.date === todayVn && rec.bonusTokens > 0) {
          map[rec.accountId] = rec;
        }
      }
      onChange(map);
    },
    (err) => {
      console.warn('subscribeToAllAiTokenGrantsForAdmin warning:', err.message);
    }
  );
}

export async function grantAiTokensToAccount(params: {
  targetAccountId: string;
  amount: number;
  grantedByName: string;
  note?: string;
}): Promise<{
  ok: boolean;
  record?: AiTokenGrantRecord;
  syncedToCloud: boolean;
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user || !isCurrentUserAdmin(user)) {
    return {
      ok: false,
      syncedToCloud: false,
      error: 'Chỉ tài khoản Admin quản trị chính mới có quyền cấp thêm token.',
    };
  }

  const safeTargetId = sanitizeFirestoreId(params.targetAccountId);
  const safeAmount = Math.max(1000, Math.min(2000000, Math.round(Number(params.amount) || 0)));
  if (!isValidFirestoreId(safeTargetId) || safeAmount <= 0) {
    return {
      ok: false,
      syncedToCloud: false,
      error: 'Thông tin tài khoản nhận hoặc số token cấp không hợp lệ.',
    };
  }

  const todayVn = getTodayVietnamDateStr();
  const grantRef = doc(db, 'ai_token_grants', safeTargetId);
  let previousTodayBonus = 0;

  try {
    const existingSnap = await getDoc(grantRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData.date === todayVn) {
        previousTodayBonus = Math.max(0, Number(existingData.bonusTokens) || 0);
      }
    }
  } catch {
    const localPrev = readLocalTokenGrantsMap()[safeTargetId];
    if (localPrev && localPrev.date === todayVn) {
      previousTodayBonus = Math.max(0, Number(localPrev.bonusTokens) || 0);
    }
  }

  const nextBonus = Math.min(5000000, previousTodayBonus + safeAmount);
  const safeAdminName = (params.grantedByName || 'Admin Trần Đình Nhất').slice(0, 120) || 'Admin';
  const safeNote = (params.note || `Admin cấp thêm +${safeAmount.toLocaleString('vi-VN')} token`).slice(0, 300);

  const localRecord: AiTokenGrantRecord = {
    accountId: safeTargetId,
    date: todayVn,
    bonusTokens: nextBonus,
    lastGrantedAmount: safeAmount,
    grantedByUid: user.uid,
    grantedByName: safeAdminName,
    note: safeNote,
    updatedAt: new Date().toISOString(),
  };

  try {
    await setDoc(grantRef, {
      accountId: safeTargetId,
      date: todayVn,
      bonusTokens: nextBonus,
      lastGrantedAmount: safeAmount,
      grantedByUid: user.uid,
      grantedByName: safeAdminName,
      note: safeNote,
      updatedAt: serverTimestamp(),
    });
    saveLocalTokenGrant(localRecord);
    return { ok: true, record: localRecord, syncedToCloud: true };
  } catch (err) {
    saveLocalTokenGrant(localRecord);
    return {
      ok: false,
      record: localRecord,
      syncedToCloud: false,
      error: err instanceof Error ? err.message : 'Không thể ghi dữ liệu cấp token lên Cloud.',
    };
  }
}

// ============================================================================
// ZALO-LIKE INTERNAL CHAT (Firestore Realtime + Firebase Storage Media)
// ============================================================================

export async function upsertChatUserDirectoryProfile(profile: {
  uid: string;
  displayName: string;
  warehouseName: string;
  isPrimaryAdmin: boolean;
  roleLabel: string;
}): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  const safeUid = sanitizeFirestoreId(profile.uid || user.uid);
  if (!isValidFirestoreId(safeUid)) return false;

  const isCallerAdmin = isCurrentUserAdmin(user);
  if (safeUid !== user.uid && !isCallerAdmin) {
    return false;
  }

  try {
    await setDoc(doc(db, 'chat_users', safeUid), {
      uid: safeUid,
      displayName: (profile.displayName || 'Thành viên Tâm An').slice(0, 120) || 'Thành viên',
      warehouseName: (profile.warehouseName || 'VTNN Tâm An').slice(0, 150),
      isPrimaryAdmin: isCallerAdmin ? Boolean(profile.isPrimaryAdmin) : false,
      roleLabel: (profile.roleLabel || 'Tài khoản kho').slice(0, 120),
      lastSeenAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('upsertChatUserDirectoryProfile warning:', err instanceof Error ? err.message : err);
    return false;
  }
}

export async function seedExistingStaffToChatDirectoryIfAdmin(): Promise<void> {
  const user = auth.currentUser;
  if (!user || !isCurrentUserAdmin(user)) return;

  try {
    const [staffSnap, chatUsersSnap] = await Promise.all([
      getDocs(collection(db, 'staff')),
      getDocs(collection(db, 'chat_users')),
    ]);
    const existingChatUids = new Set(chatUsersSnap.docs.map((d) => d.id));

    for (const sDoc of staffSnap.docs) {
      const uid = sDoc.id;
      if (existingChatUids.has(uid) || !isValidFirestoreId(uid)) continue;
      const d = sDoc.data();
      const isPrimary = uid === PRIMARY_ADMIN_UID;
      await setDoc(doc(db, 'chat_users', uid), {
        uid,
        displayName: String(d.displayName || 'Thành viên VTNN Tâm An').slice(0, 120),
        warehouseName: isPrimary ? 'Tất cả kho' : 'Kho VTNN Tâm An',
        isPrimaryAdmin: isPrimary,
        roleLabel: isPrimary ? 'Quản lý chính (Admin)' : d.role === 'manager' ? 'Quản lý kho' : 'Nhân viên',
        lastSeenAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('seedExistingStaffToChatDirectoryIfAdmin warning:', err instanceof Error ? err.message : err);
  }
}

export function subscribeToChatUsersDirectory(
  onChange: (users: ChatUserDirectoryEntry[]) => void
): () => void {
  if (!auth.currentUser) {
    onChange([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, 'chat_users'),
    (snap) => {
      const users: ChatUserDirectoryEntry[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          uid: String(d.uid || docSnap.id),
          displayName: String(d.displayName || 'Thành viên'),
          warehouseName: String(d.warehouseName || 'VTNN Tâm An'),
          isPrimaryAdmin: Boolean(d.isPrimaryAdmin) || d.uid === PRIMARY_ADMIN_UID,
          roleLabel: String(d.roleLabel || ''),
          lastSeenAt: normalizeTimestamp(d.lastSeenAt),
        };
      });
      onChange(users);
    },
    (err) => {
      console.warn('subscribeToChatUsersDirectory warning:', err.message);
    }
  );
}

export function subscribeToUserChatRooms(
  currentUid: string,
  isPrimaryAdminUser: boolean,
  onChange: (rooms: InternalChatRoom[]) => void
): () => void {
  if (!auth.currentUser || !currentUid) {
    onChange([]);
    return () => {};
  }

  const roomMap = new Map<string, InternalChatRoom>();
  const emitSorted = () => {
    const sorted = Array.from(roomMap.values()).sort(
      (a, b) => (b.lastMessageAtMs || 0) - (a.lastMessageAtMs || 0)
    );
    onChange(sorted);
  };

  const toRoom = (id: string, d: Record<string, unknown>): InternalChatRoom => ({
    roomId: String(d.roomId || id),
    roomType: d.roomType === 'dm' ? 'dm' : 'group',
    title: String(d.title || 'Trò chuyện nội bộ'),
    participants: Array.isArray(d.participants) ? d.participants.map(String) : [],
    lastMessageText: String(d.lastMessageText || ''),
    lastMessageType:
      (d.lastMessageType as InternalChatMessageType) || 'text',
    lastSenderUid: String(d.lastSenderUid || ''),
    lastSenderName: String(d.lastSenderName || ''),
    lastMessageAtMs: Number(d.lastMessageAtMs) || 0,
    updatedAt: normalizeTimestamp(d.updatedAt),
  });

  const unsubGeneral = onSnapshot(
    doc(db, 'chat_rooms', INTERNAL_CHAT_GENERAL_ROOM_ID),
    (snap) => {
      if (snap.exists()) {
        roomMap.set(snap.id, toRoom(snap.id, snap.data()));
        emitSorted();
      }
    },
    () => {
      // ignore if general room not created yet
    }
  );

  // Single-field query or full collection for Primary Admin (no composite index needed)
  const dmQuery = isPrimaryAdminUser
    ? query(collection(db, 'chat_rooms'))
    : query(collection(db, 'chat_rooms'), where('participants', 'array-contains', currentUid));

  const unsubRooms = onSnapshot(
    dmQuery,
    (snap) => {
      for (const d of snap.docs) {
        roomMap.set(d.id, toRoom(d.id, d.data()));
      }
      emitSorted();
    },
    (err) => {
      console.warn('subscribeToUserChatRooms warning:', err.message);
    }
  );

  return () => {
    unsubGeneral();
    unsubRooms();
  };
}

export function subscribeToChatRoomMessages(
  roomId: string,
  onChange: (messages: InternalChatMessage[]) => void
): () => void {
  if (!auth.currentUser || !isValidFirestoreId(roomId)) {
    onChange([]);
    return () => {};
  }

  const msgQuery = query(
    collection(db, 'chat_rooms', roomId, 'messages'),
    orderBy('createdAtMs', 'asc'),
    limit(200)
  );

  return onSnapshot(
    msgQuery,
    (snap) => {
      const list: InternalChatMessage[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const rawAttachments = Array.isArray(d.attachments) ? d.attachments : [];
        const attachments: InternalChatAttachment[] = rawAttachments.map((att: Record<string, unknown>, idx: number) => ({
          id: String(att.id || `${docSnap.id}_att_${idx}`),
          name: String(att.name || 'tep_dinh_kem'),
          mimeType: String(att.mimeType || 'application/octet-stream'),
          size: Number(att.size) || 0,
          kind:
            att.kind === 'image' || att.kind === 'video' || att.kind === 'document'
              ? att.kind
              : classifyChatAttachmentKind(String(att.mimeType || ''), String(att.name || '')),
          downloadUrl: String(att.downloadUrl || ''),
          storagePath: String(att.storagePath || ''),
        }));
        return {
          id: String(d.id || docSnap.id),
          roomId: String(d.roomId || roomId),
          senderUid: String(d.senderUid || ''),
          senderName: String(d.senderName || 'Thành viên'),
          senderWarehouse: String(d.senderWarehouse || ''),
          text: String(d.text || ''),
          messageType: (d.messageType as InternalChatMessageType) || 'text',
          attachments,
          tokenAmount: Math.max(0, Number(d.tokenAmount) || 0),
          targetUid: String(d.targetUid || ''),
          createdAtMs: Number(d.createdAtMs) || 0,
          createdAt: normalizeTimestamp(d.createdAt),
        };
      });
      onChange(list);
    },
    (err) => {
      console.warn('subscribeToChatRoomMessages warning:', err.message);
    }
  );
}

export async function uploadInternalChatAttachment(
  roomId: string,
  file: File
): Promise<InternalChatAttachment> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Cần đăng nhập Firebase để tải tệp đính kèm lên đám mây.');
  }
  if (!isValidFirestoreId(roomId)) {
    throw new Error('Mã phòng chat không hợp lệ.');
  }
  if (file.size > INTERNAL_CHAT_MAX_FILE_BYTES) {
    throw new Error(`Tệp "${file.name}" vượt quá giới hạn tối đa 25 MB.`);
  }

  const safeName = sanitizeChatStorageFileName(file.name);
  const ts = Date.now();
  const storagePath = `internal_chat_media/${roomId}/${ts}_${safeName}`;
  const fileRef = ref(storage, storagePath);

  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      roomId,
      senderUid: user.uid,
      originalName: file.name.slice(0, 120),
    },
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);
  return {
    id: `att_${ts}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name.normalize('NFC').slice(0, 150) || safeName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: classifyChatAttachmentKind(file.type || '', file.name),
    downloadUrl,
    storagePath,
  };
}

export async function sendInternalChatMessage(params: {
  roomId: string;
  roomType: 'group' | 'dm';
  roomTitle: string;
  participants: string[];
  senderName: string;
  senderWarehouse: string;
  text: string;
  messageType: InternalChatMessageType;
  attachments?: InternalChatAttachment[];
  tokenAmount?: number;
  targetUid?: string;
}): Promise<{ ok: boolean; message?: InternalChatMessage; error?: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Chưa đăng nhập phiên Firebase để gửi tin nhắn.' };
  }
  if (!isValidFirestoreId(params.roomId)) {
    return { ok: false, error: 'Mã phòng chat không hợp lệ.' };
  }

  const nowMs = Date.now();
  const msgId = sanitizeFirestoreId(`msg_${nowMs}_${Math.random().toString(36).slice(2, 7)}`);
  const safeSenderName = (params.senderName || user.displayName || 'Thành viên').slice(0, 120) || 'Thành viên';
  const safeSenderWh = (params.senderWarehouse || 'VTNN Tâm An').slice(0, 150);
  const safeText = (params.text || '').normalize('NFC').trim().slice(0, 4000);
  const attachments = (params.attachments || []).slice(0, 5);
  const safeTokenAmount = Math.max(0, Math.round(Number(params.tokenAmount) || 0));
  const safeTargetUid = (params.targetUid || '').slice(0, 128);

  const previewText = (
    safeText ||
    (attachments.length > 0
      ? `[Đính kèm ${attachments.length} tệp: ${attachments[0].name}]`
      : params.messageType === 'token_request'
      ? `Xin cấp thêm +${safeTokenAmount.toLocaleString('vi-VN')} token A.I`
      : params.messageType === 'token_grant'
      ? `Admin đã cấp +${safeTokenAmount.toLocaleString('vi-VN')} token A.I`
      : '')
  ).slice(0, 500);

  const uniqueParticipants = Array.from(
    new Set([user.uid, ...params.participants.filter((p) => Boolean(p))])
  ).slice(0, 100);

  try {
    await setDoc(doc(db, 'chat_rooms', params.roomId), {
      roomId: params.roomId,
      roomType: params.roomType,
      title: (params.roomTitle || 'Trò chuyện nội bộ').slice(0, 150) || 'Trò chuyện nội bộ',
      participants: uniqueParticipants,
      lastMessageText: previewText,
      lastMessageType: params.messageType,
      lastSenderUid: user.uid,
      lastSenderName: safeSenderName,
      lastMessageAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'chat_rooms', params.roomId, 'messages', msgId), {
      id: msgId,
      roomId: params.roomId,
      senderUid: user.uid,
      senderName: safeSenderName,
      senderWarehouse: safeSenderWh,
      text: safeText,
      messageType: params.messageType,
      attachments,
      tokenAmount: safeTokenAmount,
      targetUid: safeTargetUid,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    });

    return {
      ok: true,
      message: {
        id: msgId,
        roomId: params.roomId,
        senderUid: user.uid,
        senderName: safeSenderName,
        senderWarehouse: safeSenderWh,
        text: safeText,
        messageType: params.messageType,
        attachments,
        tokenAmount: safeTokenAmount,
        targetUid: safeTargetUid,
        createdAtMs: nowMs,
        createdAt: new Date(nowMs).toISOString(),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Không thể gửi tin nhắn lúc này.',
    };
  }
}

export async function downloadChatAttachmentToDevice(
  attachment: Pick<InternalChatAttachment, 'downloadUrl' | 'name' | 'mimeType'>
): Promise<boolean> {
  if (!attachment.downloadUrl || typeof document === 'undefined') {
    return false;
  }

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30000);
    const response = await fetch(attachment.downloadUrl, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
    });
    window.clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = attachment.name || 'tep_vtnn_taman';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    return true;
  } catch {
    try {
      const link = document.createElement('a');
      link.href = attachment.downloadUrl;
      link.download = attachment.name || 'tep_vtnn_taman';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// FIREBASE REALTIME DATABASE SYNC (gapgold-e6b62-default-rtdb)
// ============================================================================

export function subscribeToRtdbConnectionState(
  onConnectedChange: (connected: boolean) => void
): () => void {
  const connRef = rtdbRef(rtdb, '.info/connected');
  const unsub = onValue(
    connRef,
    (snap) => {
      onConnectedChange(Boolean(snap.val()));
    },
    () => {
      onConnectedChange(false);
    }
  );
  return () => {
    off(connRef, 'value', unsub);
  };
}

const legacyLayoutOwnerUids = new Set<string>();

export function isRealtimeWorkspaceLegacyLayout(uid: string): boolean {
  return legacyLayoutOwnerUids.has(sanitizeFirestoreId(uid));
}

const lastStorageWorkspaceFpByUid = new Map<string, string>();
const lastStorageWriteAtByUid = new Map<string, number>();
const inFlightStorageWriteByUid = new Set<string>();
const pendingStorageWriteByUid = new Map<
  string,
  {
    payload: RtdbWorkspacePayload;
    options?: {
      prevPayload?: RtdbWorkspacePayload | null;
      allowIntentionalWipe?: boolean;
      force?: boolean;
      allowMultiWarehouseManager?: boolean;
      allowSharedWarehouseMember?: boolean;
    };
  }
>();
const pendingStorageTimerByUid = new Map<string, ReturnType<typeof setTimeout>>();
const STORAGE_WRITE_COOLDOWN_MS = 25000;

let lastAdminSummaryFp = '';
let lastAdminSummaryWriteAt = 0;
let inFlightAdminSummaryWrite = false;
let pendingAdminSummary: AdminWarehouseAccountSummary[] | null = null;
let pendingAdminSummaryTimer: ReturnType<typeof setTimeout> | null = null;

export async function writeWorkspaceToFirebaseStorage(
  ownerUid: string,
  payload: RtdbWorkspacePayload,
  options?: {
    prevPayload?: RtdbWorkspacePayload | null;
    allowIntentionalWipe?: boolean;
    force?: boolean;
    allowMultiWarehouseManager?: boolean;
    allowSharedWarehouseMember?: boolean;
  }
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !ownerUid) return false;
  const safeUid = sanitizeFirestoreId(ownerUid);
  if (
    user.uid !== safeUid &&
    !isCurrentUserAdmin(user) &&
    !options?.allowMultiWarehouseManager &&
    !options?.allowSharedWarehouseMember
  ) {
    return false;
  }

  const normalizedPayload: RtdbWorkspacePayload = sanitizeForRealtimeDb({
    ...payload,
    auditLogs: (payload.auditLogs || []).slice(0, 500),
    backups: (payload.backups || []).map((b) => ({ ...b, snapshotPayload: undefined })),
  });

  if (
    isDestructiveEmptyWorkspaceOverwrite(
      options?.prevPayload,
      normalizedPayload,
      options?.allowIntentionalWipe
    )
  ) {
    console.warn(
      `[StorageSyncGuard] Blocked destructive empty workspace write for ${safeUid}.`
    );
    return false;
  }

  const recordCount = countWorkspaceBusinessRecords(normalizedPayload);
  const prevRecordCount = countWorkspaceBusinessRecords(options?.prevPayload);
  const prevDeletedCount = options?.prevPayload?.settings?.deletedRecords?.length || 0;
  const nextDeletedCount = normalizedPayload.settings?.deletedRecords?.length || 0;
  const isDeletionSync =
    Boolean(options?.allowIntentionalWipe) ||
    nextDeletedCount > prevDeletedCount ||
    (Boolean(options?.prevPayload) && recordCount < prevRecordCount);
  const bypassCooldown = Boolean(options?.force || isDeletionSync);

  const fp = computeWorkspaceFingerprint(normalizedPayload);
  const nowMs = Date.now();
  if (!bypassCooldown && lastStorageWorkspaceFpByUid.get(safeUid) === fp) {
    return true;
  }

  // If an upload is currently in-flight for this UID, queue this latest payload so it flushes right after!
  if (inFlightStorageWriteByUid.has(safeUid)) {
    pendingStorageWriteByUid.set(safeUid, {
      payload: normalizedPayload,
      options: { ...options, force: bypassCooldown },
    });
    return false;
  }

  // Respect cooldown for routine non-delete edits, BUT schedule a trailing flush instead of dropping!
  const lastWrite = lastStorageWriteAtByUid.get(safeUid) || 0;
  const elapsed = nowMs - lastWrite;
  if (!bypassCooldown && elapsed < STORAGE_WRITE_COOLDOWN_MS) {
    pendingStorageWriteByUid.set(safeUid, { payload: normalizedPayload, options });
    if (!pendingStorageTimerByUid.has(safeUid)) {
      const waitMs = Math.max(800, STORAGE_WRITE_COOLDOWN_MS - elapsed);
      const timer = setTimeout(() => {
        pendingStorageTimerByUid.delete(safeUid);
        const queued = pendingStorageWriteByUid.get(safeUid);
        if (queued) {
          pendingStorageWriteByUid.delete(safeUid);
          void writeWorkspaceToFirebaseStorage(safeUid, queued.payload, {
            ...queued.options,
            force: true,
          });
        }
      }, waitMs);
      pendingStorageTimerByUid.set(safeUid, timer);
    }
    return false;
  }

  // Clear any older pending timer since we are uploading the freshest snapshot now
  const existingTimer = pendingStorageTimerByUid.get(safeUid);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingStorageTimerByUid.delete(safeUid);
  }
  pendingStorageWriteByUid.delete(safeUid);

  const paths = buildStorageWorkspacePaths({
    uid: safeUid,
    email: normalizedPayload.meta?.ownerEmail,
    assignedWarehouse: normalizedPayload.meta?.assignedWarehouse,
  });

  const jsonBody = JSON.stringify(normalizedPayload);
  if (jsonBody.length > 9.5 * 1024 * 1024) {
    return false;
  }

  lastStorageWorkspaceFpByUid.set(safeUid, fp);
  lastStorageWriteAtByUid.set(safeUid, nowMs);
  inFlightStorageWriteByUid.add(safeUid);

  try {
    const metadata = {
      contentType: 'application/json;charset=utf-8',
      customMetadata: {
        ownerUid: safeUid,
        ownerEmail: (normalizedPayload.meta?.ownerEmail || '').slice(0, 120),
        assignedWarehouse: (normalizedPayload.meta?.assignedWarehouse || '').slice(0, 120),
        recordCount: String(recordCount),
        updatedAt: normalizedPayload.meta?.updatedAt || new Date().toISOString(),
      },
    };

    const targetPaths: string[] = [paths.uidPath];
    if (paths.emailPath) targetPaths.push(paths.emailPath);
    // Protect shared warehouse_*.json alias: NEVER let an empty account overwrite another owner's warehouse alias!
    if (
      paths.warehousePath &&
      (recordCount > 0 || (isDeletionSync && prevRecordCount > 0))
    ) {
      targetPaths.push(paths.warehousePath);
    }
    // Only write /backups/{safeUid}/ when caller is the owner or Primary Admin (matches storage.rules)
    if (
      (user.uid === safeUid || isCurrentUserAdmin(user)) &&
      (recordCount > 0 || isDeletionSync)
    ) {
      targetPaths.push(paths.backupPath);
    }

    const results = await Promise.allSettled(
      targetPaths.map((storagePath) =>
        uploadString(ref(storage, storagePath), jsonBody, 'raw', metadata)
      )
    );
    return results.some((r) => r.status === 'fulfilled');
  } finally {
    inFlightStorageWriteByUid.delete(safeUid);
    // Flush any newer snapshot queued while this upload was in flight
    const queued = pendingStorageWriteByUid.get(safeUid);
    if (queued) {
      pendingStorageWriteByUid.delete(safeUid);
      void writeWorkspaceToFirebaseStorage(safeUid, queued.payload, {
        ...queued.options,
        force: true,
      });
    }
  }
}

export async function readWorkspaceFromFirebaseStorage(params: {
  uid: string;
  email?: string | null;
  assignedWarehouse?: string | null;
}): Promise<RtdbWorkspacePayload | null> {
  if (!auth.currentUser || !params.uid) return null;
  const safeUid = sanitizeFirestoreId(params.uid);
  const paths = buildStorageWorkspacePaths({
    uid: safeUid,
    email: params.email,
    assignedWarehouse: params.assignedWarehouse,
  });

  // Read primary uidPath first to avoid unnecessary 404 console warnings on secondary paths
  const rawPrimary = await readJsonFromFirebaseStoragePath<unknown>(paths.uidPath);
  if (rawPrimary && typeof rawPrimary === 'object') {
    const normPrimary = normalizeWorkspaceFromRtdb(rawPrimary, safeUid);
    lastStorageWorkspaceFpByUid.set(safeUid, computeWorkspaceFingerprint(normPrimary));
    if (
      countWorkspaceBusinessRecords(normPrimary) > 0 ||
      (normPrimary.settings?.deletedRecords?.length || 0) > 0
    ) {
      return normPrimary;
    }
  }

  // Fallback to emailPath only if uidPath was missing or completely uninitialized
  if (paths.emailPath) {
    const rawEmail = await readJsonFromFirebaseStoragePath<unknown>(paths.emailPath);
    if (rawEmail && typeof rawEmail === 'object') {
      const normEmail = normalizeWorkspaceFromRtdb(rawEmail, safeUid);
      lastStorageWorkspaceFpByUid.set(safeUid, computeWorkspaceFingerprint(normEmail));
      if (
        countWorkspaceBusinessRecords(normEmail) > 0 ||
        (normEmail.settings?.deletedRecords?.length || 0) > 0
      ) {
        return normEmail;
      }
    }
  }

  return null;
}

export async function readAdminWorkspacesIndexFromFirebaseStorage(): Promise<
  AdminWarehouseAccountSummary[]
> {
  if (!auth.currentUser) return [];
  const parsed = await readJsonFromFirebaseStoragePath<{
    accounts?: AdminWarehouseAccountSummary[];
  }>('documents/workspaces/all_warehouses_summary.json');
  if (parsed && Array.isArray(parsed.accounts)) {
    return parsed.accounts;
  }
  return [];
}

export async function readDesignatedWorkspacesFromFirebaseStorage(
  targets: Array<{ uid: string; email?: string | null; assignedWarehouse?: string | null }>
): Promise<Record<string, RtdbWorkspacePayload>> {
  if (!auth.currentUser || !targets.length) return {};
  const deduped = new Map<
    string,
    { uid: string; email?: string | null; assignedWarehouse?: string | null }
  >();
  for (const t of targets) {
    const safeUid = sanitizeFirestoreId(t.uid);
    if (safeUid && !deduped.has(safeUid)) {
      deduped.set(safeUid, { ...t, uid: safeUid });
    }
  }
  const out: Record<string, RtdbWorkspacePayload> = {};
  await Promise.allSettled(
    Array.from(deduped.values()).map(async (target) => {
      const ws = await readWorkspaceFromFirebaseStorage(target);
      if (ws) {
        out[target.uid] = ws;
      }
    })
  );
  return out;
}

export async function readRealtimeWorkspacesOnce(
  ownerUids: string[] | '__ALL__',
  allowDesignatedAllWarehouses = false
): Promise<Record<string, unknown>> {
  const user = auth.currentUser;
  if (!user) return {};

  if (ownerUids === '__ALL__') {
    if (!isCurrentUserAdmin(user) && !allowDesignatedAllWarehouses) return {};
    try {
      const snap = await rtdbGet(rtdbRef(rtdb, 'workspaces'));
      const val = snap.val();
      return val && typeof val === 'object' ? (val as Record<string, unknown>) : {};
    } catch (err) {
      console.warn('readRealtimeWorkspacesOnce(__ALL__) warning:', err instanceof Error ? err.message : err);
      return {};
    }
  }

  const uniqueUids = Array.from(
    new Set(ownerUids.map((u) => sanitizeFirestoreId(u)).filter(Boolean))
  );
  const out: Record<string, unknown> = {};
  await Promise.allSettled(
    uniqueUids.map(async (safeUid) => {
      try {
        const snap = await rtdbGet(rtdbRef(rtdb, `workspaces/${safeUid}`));
        if (snap.exists()) {
          out[safeUid] = snap.val();
        }
      } catch (err) {
        console.warn(
          `readRealtimeWorkspacesOnce(${safeUid}) warning:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );
  return out;
}

export async function writeAdminWorkspacesIndexToFirebaseStorage(
  summaries: AdminWarehouseAccountSummary[],
  force = false
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !isCurrentUserAdmin(user)) return false;

  const comparableFp = JSON.stringify(
    summaries.map((s) => ({
      uid: s.uid,
      assignedWarehouse: s.assignedWarehouse,
      productsCount: s.productsCount,
      customersCount: s.customersCount,
      salesCount: s.salesCount,
      salesRevenue: s.salesRevenue,
      importsCount: s.importsCount,
    }))
  );
  const nowMs = Date.now();
  if (!force && comparableFp === lastAdminSummaryFp) {
    return true;
  }
  if (inFlightAdminSummaryWrite) {
    pendingAdminSummary = summaries;
    return false;
  }
  const elapsed = nowMs - lastAdminSummaryWriteAt;
  if (!force && elapsed < 15000) {
    pendingAdminSummary = summaries;
    if (!pendingAdminSummaryTimer) {
      pendingAdminSummaryTimer = setTimeout(() => {
        pendingAdminSummaryTimer = null;
        if (pendingAdminSummary) {
          const next = pendingAdminSummary;
          pendingAdminSummary = null;
          void writeAdminWorkspacesIndexToFirebaseStorage(next, true);
        }
      }, Math.max(800, 15000 - elapsed));
    }
    return true;
  }

  if (pendingAdminSummaryTimer) {
    clearTimeout(pendingAdminSummaryTimer);
    pendingAdminSummaryTimer = null;
  }
  pendingAdminSummary = null;
  lastAdminSummaryFp = comparableFp;
  lastAdminSummaryWriteAt = nowMs;
  inFlightAdminSummaryWrite = true;

  try {
    const body = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        totalAccounts: summaries.length,
        accounts: summaries,
      },
      null,
      2
    );
    await uploadString(
      ref(storage, 'documents/workspaces/all_warehouses_summary.json'),
      body,
      'raw',
      {
        contentType: 'application/json;charset=utf-8',
        customMetadata: {
          updatedAt: new Date().toISOString(),
          totalAccounts: String(summaries.length),
        },
      }
    );
    return true;
  } catch {
    return false;
  } finally {
    inFlightAdminSummaryWrite = false;
    if (pendingAdminSummary) {
      const next = pendingAdminSummary;
      pendingAdminSummary = null;
      void writeAdminWorkspacesIndexToFirebaseStorage(next, true);
    }
  }
}

/**
 * Tracks product record keys (`${safeUid}::${recKey}`) that are currently or just finished
 * running an atomic server-side `runTransaction` so the 250ms debounced workspace diff sync
 * does not overwrite the server-committed `stock` / `importPrice` with a pre-transaction snapshot.
 */
const recentAtomicProductLocks = new Map<string, number>();
const ATOMIC_PRODUCT_LOCK_TTL_MS = 1500;

function getActiveSkippedProductKeysForOwner(safeUid: string): Set<string> {
  const now = Date.now();
  const prefix = `${safeUid}::`;
  const skipped = new Set<string>();
  for (const [lockKey, expiresAt] of recentAtomicProductLocks.entries()) {
    if (expiresAt <= now) {
      recentAtomicProductLocks.delete(lockKey);
      continue;
    }
    if (lockKey.startsWith(prefix)) {
      skipped.add(lockKey.slice(prefix.length));
    }
  }
  return skipped;
}

/**
 * Executes an atomic compare-and-swap `runTransaction` on `/workspaces/{ownerUid}/products/{k_prodId}`
 * in Firebase Realtime Database so concurrent sales/imports/cancellations from multiple accounts
 * sharing the same warehouse NEVER lose stock deductions or weighted-average cost updates.
 */
export async function applyAtomicRealtimeProductMutation(params: {
  ownerUid: string;
  productId: string;
  mutationId?: string;
  /** Product BEFORE the mutation (used only when the server has no record and no fallbackResult exists). */
  preMutationProduct?: ProductItem | null;
  /** Already-mutated local product, used verbatim when the server has no record yet. */
  fallbackResult?: ProductItem | null;
  mutate: (currentProduct: ProductItem) => ProductItem;
}): Promise<ProductItem | null> {
  const user = auth.currentUser;
  if (!user || !params.ownerUid || !params.productId) return null;
  const safeUid = sanitizeFirestoreId(params.ownerUid);
  const recKey = toRtdbRecordKey(params.productId);
  const lockKey = `${safeUid}::${recKey}`;
  recentAtomicProductLocks.set(lockKey, Date.now() + ATOMIC_PRODUCT_LOCK_TTL_MS);

  try {
    const prodRef = rtdbRef(rtdb, `workspaces/${safeUid}/products/${recKey}`);
    const txRes = await runTransaction(prodRef, (currentRaw) => {
      const next = applyIdempotentProductMutation({
        currentRaw,
        preMutationProduct: params.preMutationProduct,
        fallbackResult: params.fallbackResult,
        mutationId: params.mutationId,
        mutate: params.mutate,
      });
      if (!next) return currentRaw;
      return next;
    });
    recentAtomicProductLocks.set(lockKey, Date.now() + ATOMIC_PRODUCT_LOCK_TTL_MS);
    if (txRes.committed && txRes.snapshot.exists()) {
      return txRes.snapshot.val() as ProductItem;
    }
    return null;
  } catch (err) {
    recentAtomicProductLocks.delete(lockKey);
    console.warn(
      'applyAtomicRealtimeProductMutation warning:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Atomically reserves the next sequential voucher code (`HD-YYMM-NNN`, `PN-YYMM-NNN`, `PT-...`, `PC-...`, `KK-...`)
 * under `/workspaces/{ownerUid}/counters/{prefix_YYMM}` so two accounts creating orders simultaneously
 * on the same shared warehouse NEVER receive duplicate voucher numbers.
 */
export async function reserveNextRealtimeVoucherCode(params: {
  ownerUid: string;
  prefix: string;
  existingCodes: string[];
  dateInput?: Date;
}): Promise<string | null> {
  const user = auth.currentUser;
  if (!user || !params.ownerUid) return null;
  const safeUid = sanitizeFirestoreId(params.ownerUid);
  const { yymm, counterKey } = buildVoucherCounterMeta(params.prefix, params.dateInput);
  const minBase = extractMaxVoucherSequence(params.prefix, yymm, params.existingCodes);

  try {
    const counterRef = rtdbRef(rtdb, `workspaces/${safeUid}/counters/${counterKey}`);
    const txRes = await runTransaction(counterRef, (currentVal) => {
      const curNum = typeof currentVal === 'number' && Number.isFinite(currentVal) ? currentVal : 0;
      return Math.max(curNum, minBase) + 1;
    });
    if (txRes.committed && txRes.snapshot.exists()) {
      const seq = Number(txRes.snapshot.val());
      if (Number.isFinite(seq) && seq >= 1) {
        return formatVoucherCodeFromSequence(params.prefix, yymm, seq);
      }
    }
    return null;
  } catch (err) {
    console.warn(
      'reserveNextRealtimeVoucherCode warning:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function writeRealtimeWorkspace(
  ownerUid: string,
  payload: RtdbWorkspacePayload,
  prevPayload: RtdbWorkspacePayload | null = null,
  allowIntentionalWipe = false,
  options?: {
    forceStorage?: boolean;
    allowMultiWarehouseManager?: boolean;
    allowSharedWarehouseMember?: boolean;
  }
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !ownerUid) return false;
  const safeUid = sanitizeFirestoreId(ownerUid);
  if (
    user.uid !== safeUid &&
    !isCurrentUserAdmin(user) &&
    !options?.allowMultiWarehouseManager &&
    !options?.allowSharedWarehouseMember
  ) {
    return false;
  }

  try {
    const normalizedPayload: RtdbWorkspacePayload = {
      ...payload,
      auditLogs: (payload.auditLogs || []).slice(0, 500),
      backups: (payload.backups || []).map((b) => ({ ...b, snapshotPayload: undefined })),
    };

    if (
      isDestructiveEmptyWorkspaceOverwrite(
        prevPayload,
        normalizedPayload,
        allowIntentionalWipe
      )
    ) {
      console.warn(
        `[RtdbSyncGuard] Blocked destructive empty workspace overwrite for ${safeUid}.`
      );
      return false;
    }

    const wsRef = rtdbRef(rtdb, `workspaces/${safeUid}`);

    if (legacyLayoutOwnerUids.has(safeUid)) {
      const fullKeyed = buildFullKeyedWorkspace(normalizedPayload);
      await rtdbSet(wsRef, fullKeyed);
      legacyLayoutOwnerUids.delete(safeUid);
    } else if (!prevPayload) {
      // First write without a known server snapshot: MERGE every record with multi-path update instead of
      // `set()` so we never wipe counters/records written meanwhile and never overwrite products locked by a transaction.
      const skipProductKeys = getActiveSkippedProductKeysForOwner(safeUid);
      const emptyPrev: RtdbWorkspacePayload = {
        meta: normalizedPayload.meta,
        products: [],
        customers: [],
        suppliers: [],
        sales: [],
        imports: [],
        receiptVouchers: [],
        paymentVouchers: [],
        savedVouchers: [],
        stockAdjustments: [],
        auditLogs: [],
        backups: [],
        settings: { ...normalizedPayload.settings },
      };
      const firstUpdates = buildWorkspaceDiffUpdates(emptyPrev, normalizedPayload, {
        skipProductKeys: skipProductKeys.size > 0 ? skipProductKeys : undefined,
      });
      await rtdbUpdate(wsRef, firstUpdates);
    } else {
      const skipProductKeys = getActiveSkippedProductKeysForOwner(safeUid);
      const diffUpdates = buildWorkspaceDiffUpdates(prevPayload, normalizedPayload, {
        skipProductKeys: skipProductKeys.size > 0 ? skipProductKeys : undefined,
      });
      await rtdbUpdate(wsRef, diffUpdates);
    }

    // Mirror live workspace to Firebase Storage (/documents/workspaces/ & /backups/{uid}/)
    // Deletions and forced syncs bypass cooldown and overwrite Storage immediately!
    void writeWorkspaceToFirebaseStorage(safeUid, normalizedPayload, {
      prevPayload,
      allowIntentionalWipe,
      force: options?.forceStorage,
      allowMultiWarehouseManager: options?.allowMultiWarehouseManager,
      allowSharedWarehouseMember: options?.allowSharedWarehouseMember,
    });
    return true;
  } catch (err) {
    console.warn('writeRealtimeWorkspace warning:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Writes freshly created/edited business records straight to `/workspaces/{ownerUid}/{collection}/{k_id}`
 * (multi-path update, no debounce) so vouchers like PN/HD/PT/PC are on the server within milliseconds.
 */
export async function upsertRealtimeWorkspaceRecordsImmediately(
  ownerUid: string,
  collectionRecords: Partial<Record<RtdbRecordCollection, Array<{ id: string }>>>,
  options?: { allowMultiWarehouseManager?: boolean; allowSharedWarehouseMember?: boolean }
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !ownerUid) return false;
  const safeUid = sanitizeFirestoreId(ownerUid);
  if (
    !safeUid ||
    (user.uid !== safeUid &&
      !isCurrentUserAdmin(user) &&
      !options?.allowMultiWarehouseManager &&
      !options?.allowSharedWarehouseMember)
  ) {
    return false;
  }
  try {
    const updates: Record<string, unknown> = {};
    const skipProductKeys = getActiveSkippedProductKeysForOwner(safeUid);
    for (const [col, records] of Object.entries(collectionRecords)) {
      for (const rec of (records || []) as Array<{ id: string }>) {
        if (!rec || !rec.id) continue;
        const key = toRtdbRecordKey(rec.id);
        if (col === 'products' && skipProductKeys.has(key)) continue;
        updates[`${col}/${key}`] = sanitizeForRealtimeDb(rec);
      }
    }
    if (Object.keys(updates).length === 0) return true;
    updates['meta/ownerUid'] = safeUid;
    updates['meta/updatedAt'] = new Date().toISOString();
    updates['meta/updatedByUid'] = user.uid;
    await rtdbUpdate(rtdbRef(rtdb, `workspaces/${safeUid}`), updates);
    return true;
  } catch (err) {
    console.warn(
      'upsertRealtimeWorkspaceRecordsImmediately warning:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export function subscribeToDesignatedRealtimeWorkspaces(
  ownerUids: string[],
  onWorkspacesMap: (workspacesMap: Record<string, unknown>) => void
): () => void {
  const user = auth.currentUser;
  const uniqueUids = Array.from(new Set(ownerUids.map((u) => sanitizeFirestoreId(u)).filter(Boolean)));
  if (!user || uniqueUids.length === 0) return () => {};

  const currentMap: Record<string, unknown> = {};
  const unsubs = uniqueUids.map((safeUid) => {
    const wsRef = rtdbRef(rtdb, `workspaces/${safeUid}`);
    const cb = onValue(
      wsRef,
      (snap) => {
        if (snap.exists()) {
          const rawVal = snap.val();
          if (isLegacyArrayWorkspaceLayout(rawVal)) {
            legacyLayoutOwnerUids.add(safeUid);
          } else {
            legacyLayoutOwnerUids.delete(safeUid);
          }
          currentMap[safeUid] = rawVal;
        } else {
          delete currentMap[safeUid];
        }
        onWorkspacesMap({ ...currentMap });
      },
      (err) => {
        console.warn(`subscribeToDesignatedRealtimeWorkspaces(${safeUid}) warning:`, err.message);
      }
    );
    return () => off(wsRef, 'value', cb);
  });

  return () => {
    unsubs.forEach((u) => u());
  };
}

export function subscribeToRealtimeWorkspace(
  ownerUid: string,
  onSnapshotData: (workspace: RtdbWorkspacePayload | null) => void,
  onError?: (err: Error) => void
): () => void {
  const safeUid = sanitizeFirestoreId(ownerUid);
  if (!auth.currentUser || !safeUid) {
    return () => {};
  }
  const wsRef = rtdbRef(rtdb, `workspaces/${safeUid}`);
  const unsub = onValue(
    wsRef,
    (snap) => {
      if (!snap.exists()) {
        legacyLayoutOwnerUids.delete(safeUid);
        onSnapshotData(null);
        return;
      }
      const rawVal = snap.val();
      if (isLegacyArrayWorkspaceLayout(rawVal)) {
        legacyLayoutOwnerUids.add(safeUid);
      } else {
        legacyLayoutOwnerUids.delete(safeUid);
      }
      onSnapshotData(normalizeWorkspaceFromRtdb(rawVal, safeUid));
    },
    (err) => {
      console.warn('subscribeToRealtimeWorkspace warning:', err.message);
      onError?.(err);
    }
  );
  return () => {
    off(wsRef, 'value', unsub);
  };
}

export function subscribeToAllRealtimeWorkspacesForAdmin(
  onWorkspacesMap: (workspacesMap: Record<string, unknown>) => void,
  onError?: (err: Error) => void,
  allowDesignatedAllWarehouses = false
): () => void {
  const user = auth.currentUser;
  if (!user || (!isCurrentUserAdmin(user) && !allowDesignatedAllWarehouses)) {
    return () => {};
  }
  const allRef = rtdbRef(rtdb, 'workspaces');
  const unsub = onValue(
    allRef,
    (snap) => {
      const val = snap.val();
      if (!val || typeof val !== 'object') {
        onWorkspacesMap({});
        return;
      }
      const mapVal = val as Record<string, unknown>;
      for (const [uid, rawWs] of Object.entries(mapVal)) {
        const safeUid = sanitizeFirestoreId(uid);
        if (isLegacyArrayWorkspaceLayout(rawWs)) {
          legacyLayoutOwnerUids.add(safeUid);
        } else {
          legacyLayoutOwnerUids.delete(safeUid);
        }
      }
      onWorkspacesMap(mapVal);
    },
    (err) => {
      console.warn('subscribeToAllRealtimeWorkspacesForAdmin warning:', err.message);
      onError?.(err);
    }
  );
  return () => {
    off(allRef, 'value', unsub);
  };
}

export async function upsertRealtimeUserDirectoryProfile(staff: StaffMember): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !staff.uid) return false;
  const safeUid = sanitizeFirestoreId(staff.uid);
  if (user.uid !== safeUid && !isCurrentUserAdmin(user)) {
    return false;
  }
  try {
    const cleanProfile = toRtdbUserDirectoryProfile({
      ...staff,
      uid: safeUid,
    });
    const dirRef = rtdbRef(rtdb, `users_directory/${safeUid}`);
    let existingPresence: Partial<RtdbUserDirectoryProfile> | null = null;
    try {
      const curSnap = await rtdbGet(dirRef);
      existingPresence = curSnap.exists() ? (curSnap.val() as Partial<RtdbUserDirectoryProfile>) : null;
    } catch {
      existingPresence = null;
    }
    await rtdbSet(dirRef, preservePresenceFields(cleanProfile, existingPresence));
    return true;
  } catch (err) {
    console.warn('upsertRealtimeUserDirectoryProfile warning:', err instanceof Error ? err.message : err);
    return false;
  }
}

export function subscribeToRealtimeUsersDirectory(
  targetUid: string,
  isAdmin: boolean,
  onUsers: (usersMap: Record<string, RtdbUserDirectoryProfile>) => void
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};
  if (isAdmin && isCurrentUserAdmin(user)) {
    const dirRef = rtdbRef(rtdb, 'users_directory');
    const unsub = onValue(
      dirRef,
      (snap) => {
        const val = snap.val();
        onUsers(val && typeof val === 'object' ? (val as Record<string, RtdbUserDirectoryProfile>) : {});
      },
      (err) => {
        console.warn('subscribeToRealtimeUsersDirectory(admin) warning:', err.message);
      }
    );
    return () => {
      off(dirRef, 'value', unsub);
    };
  }

  const safeUid = sanitizeFirestoreId(targetUid || user.uid);
  const singleRef = rtdbRef(rtdb, `users_directory/${safeUid}`);
  const unsub = onValue(
    singleRef,
    (snap) => {
      const val = snap.val();
      if (!val || typeof val !== 'object') {
        onUsers({});
        return;
      }
      onUsers({ [safeUid]: val as RtdbUserDirectoryProfile });
    },
    (err) => {
      console.warn('subscribeToRealtimeUsersDirectory(user) warning:', err.message);
    }
  );
  return () => {
    off(singleRef, 'value', unsub);
  };
}

export async function seedExistingStaffToRealtimeDirectoryIfAdmin(
  localStaffList: StaffMember[]
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !isCurrentUserAdmin(user)) return;

  try {
    const [staffSnap, staffPrivateSnap, existingDirSnap] = await Promise.all([
      getDocs(collection(db, 'staff')),
      getDocs(collection(db, 'staff_private')),
      rtdbGet(rtdbRef(rtdb, 'users_directory')),
    ]);

    const privateByUid = new Map<string, { email: string; phone: string }>();
    for (const pDoc of staffPrivateSnap.docs) {
      const pd = pDoc.data();
      privateByUid.set(pDoc.id, {
        email: String(pd.email || ''),
        phone: String(pd.phone || ''),
      });
    }

    const existingRtdbDir =
      existingDirSnap.exists() && typeof existingDirSnap.val() === 'object'
        ? (existingDirSnap.val() as Record<string, RtdbUserDirectoryProfile>)
        : {};

    const byUid = new Map<string, StaffMember>();
    for (const st of localStaffList) {
      if (st.uid) byUid.set(st.uid, normalizeIndependentWarehouseStaffMember(st));
    }

    // Preserve valid RTDB directory entries — INCLUDING Admin multi-warehouse grants (assignedWarehouses, multiWarehouseGrantedByAdmin, assignedOwnerUids)
    const uidsNeedingDirectorySync = new Set<string>();
    for (const [uid, dir] of Object.entries(existingRtdbDir)) {
      if (!dir || !uid) continue;
      const prev = byUid.get(uid);
      const priv = privateByUid.get(uid);
      const resolvedEmail = dir.email || priv?.email || prev?.email || '';
      const rawWh = (dir.assignedWarehouse || '').trim();
      const validExistingWh =
        rawWh && rawWh !== 'Kho VTNN Tâm An' && rawWh !== 'VTNN Tâm An'
          ? rawWh
          : prev?.assignedWarehouse || '';
      const dirMultiWhs = ensureArrayFromRtdb<string>(dir.assignedWarehouses);
      const resolvedMultiWhs =
        dirMultiWhs.length > 0
          ? dirMultiWhs
          : dir.multiWarehouseGrantedByAdmin === false
          ? undefined
          : prev?.assignedWarehouses;
      const resolvedMultiGrant =
        dir.multiWarehouseGrantedByAdmin !== undefined
          ? Boolean(dir.multiWarehouseGrantedByAdmin)
          : prev?.multiWarehouseGrantedByAdmin;
      const resolvedOwnerUids =
        dir.assignedOwnerUids && typeof dir.assignedOwnerUids === 'object'
          ? dir.assignedOwnerUids
          : prev?.assignedOwnerUids;
      const resolvedCanonicalOwnerUid =
        typeof dir.canonicalOwnerUid === 'string' && dir.canonicalOwnerUid.trim()
          ? dir.canonicalOwnerUid.trim()
          : prev?.canonicalOwnerUid;

      const normalizedExisting = normalizeIndependentWarehouseStaffMember({
        uid,
        username: dir.username || prev?.username || resolvedEmail.split('@')[0] || `user_${uid.slice(0, 6)}`,
        password: '',
        displayName: dir.displayName || prev?.displayName || 'Thành viên VTNN Tâm An',
        phone: dir.phone || priv?.phone || prev?.phone || '',
        email: resolvedEmail,
        role: dir.role || prev?.role || 'staff',
        positionRole: dir.positionRole || prev?.positionRole || 'warehouse_manager',
        permissions: dir.permissions || prev?.permissions,
        assignedWarehouse: validExistingWh,
        assignedWarehouses: resolvedMultiWhs,
        multiWarehouseGrantedByAdmin: resolvedMultiGrant,
        assignedOwnerUids: resolvedOwnerUids,
        canonicalOwnerUid: resolvedCanonicalOwnerUid,
        warehouseRenameCount:
          typeof dir.warehouseRenameCount === 'number' && Number.isFinite(dir.warehouseRenameCount)
            ? Math.max(0, Math.floor(dir.warehouseRenameCount))
            : prev?.warehouseRenameCount,
        active: dir.active !== false,
        createdAt: dir.createdAt || prev?.createdAt || new Date().toISOString(),
        updatedAt: dir.updatedAt || prev?.updatedAt || new Date().toISOString(),
      });
      byUid.set(uid, normalizedExisting);

      // Only mark for write-back if directory was missing email/phone or had an invalid legacy warehouse
      if (
        (!dir.email && resolvedEmail) ||
        (!dir.phone && (priv?.phone || prev?.phone)) ||
        !rawWh ||
        rawWh === 'Kho VTNN Tâm An' ||
        rawWh === 'VTNN Tâm An'
      ) {
        uidsNeedingDirectorySync.add(uid);
      }
    }

    for (const sDoc of staffSnap.docs) {
      const uid = sDoc.id;
      const d = sDoc.data();
      const priv = privateByUid.get(uid);
      const existing = byUid.get(uid);
      const isPrimary = uid === PRIMARY_ADMIN_UID;
      const resolvedEmail = String(d.email || priv?.email || existing?.email || '');
      const resolvedUsername =
        existing?.username ||
        String(d.username || '') ||
        (resolvedEmail.includes('@') ? resolvedEmail.split('@')[0] : `user_${uid.slice(0, 6)}`);

      if (!existing) {
        const autoWh = isPrimary
          ? 'Tất cả kho'
          : d.assignedWarehouse && d.assignedWarehouse !== 'Kho VTNN Tâm An'
          ? String(d.assignedWarehouse)
          : formatDefaultWarehouseNameFromGmail(resolvedEmail || resolvedUsername);

        byUid.set(
          uid,
          normalizeIndependentWarehouseStaffMember({
            uid,
            username: isPrimary ? 'admin' : resolvedUsername,
            password: '',
            displayName: String(d.displayName || resolvedUsername || 'Thành viên VTNN Tâm An'),
            phone: String(d.phone || priv?.phone || ''),
            email: resolvedEmail,
            role: isPrimary ? 'manager' : 'staff',
            positionRole: isPrimary ? 'primary_manager' : 'warehouse_manager',
            permissions: isPrimary ? undefined : getIndependentWarehouseFullPermissions(),
            assignedWarehouse: autoWh,
            active: d.active !== false,
            createdAt: normalizeTimestamp(d.createdAt),
            updatedAt: normalizeTimestamp(d.updatedAt),
          })
        );
        uidsNeedingDirectorySync.add(uid);
      } else if (
        (!existing.email && resolvedEmail) ||
        (!existing.phone && priv?.phone) ||
        (!existing.displayName && d.displayName)
      ) {
        byUid.set(
          uid,
          normalizeIndependentWarehouseStaffMember({
            ...existing,
            email: existing.email || resolvedEmail,
            phone: existing.phone || priv?.phone || '',
            displayName: existing.displayName || String(d.displayName || ''),
          })
        );
        uidsNeedingDirectorySync.add(uid);
      }
    }

    // Also seed brand-new local-only entries that don't yet exist in RTDB directory
    for (const st of localStaffList) {
      if (st.uid && !existingRtdbDir[st.uid]) {
        uidsNeedingDirectorySync.add(st.uid);
      }
    }

    await Promise.all(
      Array.from(uidsNeedingDirectorySync)
        .map((uid) => byUid.get(uid))
        .filter((st): st is StaffMember => Boolean(st))
        .map((st) => upsertRealtimeUserDirectoryProfile(st))
    );
  } catch (err) {
    console.warn('seedExistingStaffToRealtimeDirectoryIfAdmin warning:', err instanceof Error ? err.message : err);
  }
}

