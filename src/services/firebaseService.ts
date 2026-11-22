import { initializeApp } from 'firebase/app';
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
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
  OperationType,
  ProductItem,
  SaleTransaction,
  UserRole,
} from '../types';
import { ADMIN_BACKUP_EMAIL, ADMIN_PRIMARY_PHONE, PRIMARY_ADMIN_UID } from '../data/seedData';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(
  app,
  firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : undefined
);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// In-memory token & phone OTP confirmation state
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let activeRecaptchaVerifier: RecaptchaVerifier | null = null;
let activePhoneConfirmationResult: ConfirmationResult | null = null;

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot per firebase-integration-rpc guidelines
export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testFirestoreConnection();

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

/**
 * Helper to format Vietnamese phone numbers into E.164 format (+84...) for Firebase Phone Auth.
 * Examples:
 * - "0393120246" -> "+84393120246"
 * - "84393120246" -> "+84393120246"
 * - "+84393120246" -> "+84393120246"
 */
export function formatPhoneToE164(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D+/g, '');
  }
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.startsWith('0')) {
    return `+84${digits.slice(1)}`;
  }
  if (digits.startsWith('84') && digits.length >= 10) {
    return `+${digits}`;
  }
  return `+84${digits}`;
}

async function syncAuthenticatedUserToFirestore(
  user: User,
  resolvedRole: UserRole,
  fallbackDisplayName?: string,
  fallbackPhone?: string
): Promise<void> {
  try {
    await setDoc(doc(db, 'staff', user.uid), {
      uid: user.uid,
      displayName: (
        user.displayName ||
        fallbackDisplayName ||
        user.email ||
        user.phoneNumber ||
        'Nhân viên Tâm An'
      ).slice(0, 100),
      role: resolvedRole,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'staff_private', user.uid), {
      uid: user.uid,
      email: (user.email || 'staff@taman.vn').slice(0, 150),
      phone: (user.phoneNumber || fallbackPhone || '').slice(0, 30),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Sync staff profile warning:', err);
  }
}

/**
 * 1. Google Sign-In & Sign-Up (works for both existing accounts and new Google account sign-ups)
 */
export const googleSignInWithRole = async (
  requestedRole: UserRole
): Promise<{ user: User; accessToken: string | null; resolvedRole: UserRole } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;

    const user = result.user;
    const isAdminUser =
      user.uid === PRIMARY_ADMIN_UID ||
      user.email?.toLowerCase() === ADMIN_BACKUP_EMAIL.toLowerCase();
    const resolvedRole: UserRole = isAdminUser ? 'manager' : requestedRole;

    await syncAuthenticatedUserToFirestore(user, resolvedRole);

    return { user, accessToken: cachedAccessToken, resolvedRole };
  } catch (error) {
    console.error('Google Sign in/up error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * 2. Email/Password Sign-In (Đăng nhập bằng Email & Mật khẩu qua Firebase Auth)
 */
export async function firebaseSignInWithEmailPassword(
  email: string,
  password: string
): Promise<{ user: User; resolvedRole: UserRole }> {
  isSigningIn = true;
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
    const user = credential.user;
    const isAdmin =
      user.uid === PRIMARY_ADMIN_UID ||
      trimmedEmail === ADMIN_BACKUP_EMAIL.toLowerCase();
    const resolvedRole: UserRole = isAdmin ? 'manager' : 'staff';
    await syncAuthenticatedUserToFirestore(user, resolvedRole);
    return { user, resolvedRole };
  } finally {
    isSigningIn = false;
  }
}

/**
 * 3. Email/Password Sign-Up (Đăng ký tài khoản mới bằng Email & Mật khẩu qua Firebase Auth)
 */
export async function firebaseSignUpWithEmailPassword(payload: {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
}): Promise<{ user: User; resolvedRole: UserRole }> {
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
    const isAdmin =
      user.uid === PRIMARY_ADMIN_UID ||
      trimmedEmail === ADMIN_BACKUP_EMAIL.toLowerCase();
    const resolvedRole: UserRole = isAdmin ? 'manager' : 'staff';
    await syncAuthenticatedUserToFirestore(
      user,
      resolvedRole,
      payload.displayName.trim(),
      payload.phone?.trim()
    );
    return { user, resolvedRole };
  } finally {
    isSigningIn = false;
  }
}

/**
 * 4. Forgot Password via Firebase Auth (Gửi email đặt lại mật khẩu từ Firebase Authentication)
 */
export async function firebaseSendPasswordResetEmail(email: string): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();
  await sendPasswordResetEmail(auth, trimmedEmail);
}

/**
 * 5. Phone Authentication (Số điện thoại OTP SMS cho cả Đăng nhập & Đăng ký tài khoản)
 */
export async function firebaseSendPhoneOtp(
  rawPhone: string,
  recaptchaContainerId: string
): Promise<{ formattedPhone: string; usedFirebaseSms: boolean }> {
  const formattedPhone = formatPhoneToE164(rawPhone);
  try {
    if (activeRecaptchaVerifier) {
      try {
        activeRecaptchaVerifier.clear();
      } catch {
        // Ignore cleanup errors
      }
      activeRecaptchaVerifier = null;
    }

    const containerEl = document.getElementById(recaptchaContainerId);
    if (containerEl) {
      containerEl.innerHTML = '';
    }

    activeRecaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
      size: 'invisible',
    });

    activePhoneConfirmationResult = await signInWithPhoneNumber(
      auth,
      formattedPhone,
      activeRecaptchaVerifier
    );
    return { formattedPhone, usedFirebaseSms: true };
  } catch (err) {
    console.warn('Firebase Phone SMS send warning (using fallback verification if needed):', err);
    activePhoneConfirmationResult = null;
    throw err;
  }
}

export async function firebaseConfirmPhoneOtp(
  otpCode: string,
  displayName?: string
): Promise<{ user: User | null; resolvedRole: UserRole }> {
  if (!activePhoneConfirmationResult) {
    throw new Error('Phiên xác thực SMS chưa khởi tạo hoặc đã hết hạn.');
  }
  isSigningIn = true;
  try {
    const credential = await activePhoneConfirmationResult.confirm(otpCode.trim());
    const user = credential.user;
    if (displayName && displayName.trim() && !user.displayName) {
      await updateProfile(user, { displayName: displayName.trim() });
    }
    const cleanDigits = (user.phoneNumber || '').replace(/\D+/g, '');
    const isPrimaryPhone =
      cleanDigits.endsWith(ADMIN_PRIMARY_PHONE.slice(1)) ||
      cleanDigits === ADMIN_PRIMARY_PHONE;
    const resolvedRole: UserRole = isPrimaryPhone ? 'manager' : 'staff';
    await syncAuthenticatedUserToFirestore(user, resolvedRole, displayName, user.phoneNumber || '');
    activePhoneConfirmationResult = null;
    return { user, resolvedRole };
  } finally {
    isSigningIn = false;
  }
}

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutUser = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ============================================================================
// FIREBASE STORAGE INTEGRATION (Production bucket: gapgold-e6b62.firebasestorage.app)
// ============================================================================

export interface FirebaseStorageUploadResult {
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

/**
 * Upload any user file (.json backup, .xlsx/.xls/.csv Excel import, or document attachment)
 * directly to the configured Firebase Storage bucket.
 */
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
  const uid = auth.currentUser?.uid || 'public_workspace';
  const storagePath = `${folder}/${uid}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      uploadedByEmail: auth.currentUser?.email || ADMIN_BACKUP_EMAIL,
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
  };
}

/**
 * Automatically save application data snapshot to Firebase Storage bucket
 * (`gapgold-e6b62.firebasestorage.app`) and sync metadata to Firestore.
 */
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
    `VTNN_TamAn_FirebaseStorage_${todayStr}_${Date.now().toString().slice(-4)}.json`;
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

  const uid = auth.currentUser?.uid || 'taman_production';
  const storagePath = `backups/${uid}/${fileName}`;
  let storedRefId = storagePath;

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
  } catch (err) {
    console.warn('Firebase Storage auto-save warning:', err);
    storedRefId = `firebase_storage_${Date.now()}`;
  }

  const entry: BackupEntry = {
    id: `bk_${Date.now()}`,
    fileName,
    driveFileId: storedRefId,
    targetEmail: ADMIN_BACKUP_EMAIL,
    recordCount: totalRecords,
    status: 'completed',
    triggerType: payload.triggerType,
    ownerId: auth.currentUser?.uid || 'demo_owner',
    createdAt: new Date().toISOString(),
  };

  if (auth.currentUser) {
    try {
      await setDoc(doc(db, 'backups', entry.id), {
        id: entry.id,
        fileName: entry.fileName.slice(0, 150),
        driveFileId: entry.driveFileId.slice(0, 128),
        targetEmail: entry.targetEmail.slice(0, 150),
        recordCount: entry.recordCount,
        status: entry.status,
        triggerType: entry.triggerType,
        ownerId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `backups/${entry.id}`);
    }
  }

  return entry;
}

// Keep alias for backward compatibility with existing callers
export const uploadBackupToGoogleDrive = uploadBackupToFirebaseStorage;

export async function deleteBackupFileFromDrive(storagePathOrId: string): Promise<void> {
  if (
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
}

// Firestore persistence helpers adhering to security rules
export async function syncProductToFirestore(product: ProductItem, isNew: boolean): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const path = `products/${product.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'products', product.id), {
        id: product.id,
        code: product.code.slice(0, 40),
        name: product.name.slice(0, 150),
        category: product.category,
        unit: product.unit.slice(0, 30),
        importPrice: Number(product.importPrice),
        sellPrice: Number(product.sellPrice),
        stock: Number(product.stock),
        minStock: Number(product.minStock),
        supplierName: product.supplierName.slice(0, 150),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'products', product.id), {
        code: product.code.slice(0, 40),
        name: product.name.slice(0, 150),
        category: product.category,
        unit: product.unit.slice(0, 30),
        importPrice: Number(product.importPrice),
        sellPrice: Number(product.sellPrice),
        stock: Number(product.stock),
        minStock: Number(product.minStock),
        supplierName: product.supplierName.slice(0, 150),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function syncCustomerToFirestore(customer: CustomerProfile, isNew: boolean): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  try {
    if (isNew) {
      await setDoc(doc(db, 'customers', customer.id), {
        id: customer.id,
        code: customer.code.slice(0, 40),
        name: customer.name.slice(0, 120),
        group: customer.group,
        totalPurchased: Number(customer.totalPurchased),
        totalDebt: Number(customer.totalDebt),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'customers_private', customer.id), {
        id: customer.id,
        phone: customer.phone.slice(0, 30),
        email: customer.email.slice(0, 150),
        address: customer.address.slice(0, 250),
        note: customer.note.slice(0, 300),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'customers', customer.id), {
        code: customer.code.slice(0, 40),
        name: customer.name.slice(0, 120),
        group: customer.group,
        totalPurchased: Number(customer.totalPurchased),
        totalDebt: Number(customer.totalDebt),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'customers_private', customer.id), {
        phone: customer.phone.slice(0, 30),
        email: customer.email.slice(0, 150),
        address: customer.address.slice(0, 250),
        note: customer.note.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      `customers/${customer.id}`
    );
  }
}

export async function syncSaleToFirestore(sale: SaleTransaction, isNew: boolean): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const path = `sales/${sale.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'sales', sale.id), {
        id: sale.id,
        invoiceCode: sale.invoiceCode.slice(0, 40),
        customerId: sale.customerId.slice(0, 128),
        customerName: sale.customerName.slice(0, 120),
        customerPhone: sale.customerPhone.slice(0, 30),
        productId: sale.productId.slice(0, 128),
        productName: sale.productName.slice(0, 150),
        unit: sale.unit.slice(0, 30),
        quantity: Number(sale.quantity),
        unitPrice: Number(sale.unitPrice),
        totalAmount: Number(sale.totalAmount),
        paidAmount: Number(sale.paidAmount),
        debtAmount: Number(sale.debtAmount),
        dueDate: sale.dueDate.slice(0, 30),
        status: sale.status,
        note: sale.note.slice(0, 300),
        staffName: sale.staffName.slice(0, 100),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'sales', sale.id), {
        paidAmount: Number(sale.paidAmount),
        debtAmount: Number(sale.debtAmount),
        status: sale.status,
        note: sale.note.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function syncImportToFirestore(imp: ImportTransaction, isNew: boolean): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const path = `imports/${imp.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'imports', imp.id), {
        id: imp.id,
        receiptCode: imp.receiptCode.slice(0, 40),
        supplierName: imp.supplierName.slice(0, 150),
        supplierPhone: imp.supplierPhone.slice(0, 30),
        productId: imp.productId.slice(0, 128),
        productName: imp.productName.slice(0, 150),
        unit: imp.unit.slice(0, 30),
        quantity: Number(imp.quantity),
        unitCost: Number(imp.unitCost),
        totalCost: Number(imp.totalCost),
        paidAmount: Number(imp.paidAmount),
        debtAmount: Number(imp.debtAmount),
        dueDate: imp.dueDate.slice(0, 30),
        status: imp.status,
        note: imp.note.slice(0, 300),
        staffName: imp.staffName.slice(0, 100),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'imports', imp.id), {
        paidAmount: Number(imp.paidAmount),
        debtAmount: Number(imp.debtAmount),
        status: imp.status,
        note: imp.note.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function syncNotificationPrefsToFirestore(
  prefs: NotificationPrefs,
  isNew: boolean
): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const path = `notification_prefs/${uid}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'notification_prefs', uid), {
        uid,
        debtCustomerEnabled: Boolean(prefs.debtCustomerEnabled),
        debtSupplierEnabled: Boolean(prefs.debtSupplierEnabled),
        lowStockEnabled: Boolean(prefs.lowStockEnabled),
        periodicReportEnabled: Boolean(prefs.periodicReportEnabled),
        browserPushEnabled: Boolean(prefs.browserPushEnabled),
        leadDays: Number(prefs.leadDays),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'notification_prefs', uid), {
        debtCustomerEnabled: Boolean(prefs.debtCustomerEnabled),
        debtSupplierEnabled: Boolean(prefs.debtSupplierEnabled),
        lowStockEnabled: Boolean(prefs.lowStockEnabled),
        periodicReportEnabled: Boolean(prefs.periodicReportEnabled),
        browserPushEnabled: Boolean(prefs.browserPushEnabled),
        leadDays: Number(prefs.leadDays),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function fetchUserFirestoreData(
  uid: string,
  isAdminUser?: boolean
): Promise<{
  products: ProductItem[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
} | null> {
  try {
    const canReadAll = Boolean(isAdminUser || uid === PRIMARY_ADMIN_UID);
    const prodSnap = await getDocs(
      canReadAll
        ? query(collection(db, 'products'))
        : query(collection(db, 'products'), where('ownerId', '==', uid))
    );
    const salesSnap = await getDocs(
      canReadAll
        ? query(collection(db, 'sales'))
        : query(collection(db, 'sales'), where('ownerId', '==', uid))
    );
    const impSnap = await getDocs(
      canReadAll
        ? query(collection(db, 'imports'))
        : query(collection(db, 'imports'), where('ownerId', '==', uid))
    );

    if (prodSnap.empty && salesSnap.empty && impSnap.empty) {
      return null;
    }

    const products = prodSnap.docs.map((d) => d.data() as ProductItem);
    const sales = salesSnap.docs.map((d) => d.data() as SaleTransaction);
    const imports = impSnap.docs.map((d) => d.data() as ImportTransaction);

    return { products, sales, imports };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'products/sales/imports');
  }
}
