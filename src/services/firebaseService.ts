import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
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
import { ADMIN_BACKUP_EMAIL } from '../data/seedData';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory token cache per workspace-integration guidelines (never stored in localStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

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

export const googleSignInWithRole = async (
  requestedRole: UserRole
): Promise<{ user: User; accessToken: string; resolvedRole: UserRole } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không lấy được quyền truy cập OAuth từ Google.');
    }
    cachedAccessToken = credential.accessToken;

    const user = result.user;
    const isAdminEmail =
      user.email?.toLowerCase() === ADMIN_BACKUP_EMAIL.toLowerCase() && user.emailVerified;
    const resolvedRole: UserRole = isAdminEmail ? requestedRole : 'staff';

    // Sync staff public + private profile in Firestore
    try {
      await setDoc(doc(db, 'staff', user.uid), {
        uid: user.uid,
        displayName: (user.displayName || user.email || 'Nhân viên Tâm An').slice(0, 100),
        role: resolvedRole,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'staff_private', user.uid), {
        uid: user.uid,
        email: (user.email || 'staff@taman.vn').slice(0, 150),
        phone: (user.phoneNumber || '').slice(0, 30),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `staff/${user.uid}`);
    }

    return { user, accessToken: cachedAccessToken, resolvedRole };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutUser = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

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

export async function uploadBackupToGoogleDrive(payload: {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  triggerType: 'auto_daily' | 'manual';
}): Promise<BackupEntry> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName = `VTNN_TamAn_Backup_${todayStr}_${Date.now().toString().slice(-4)}.json`;
  const totalRecords =
    payload.products.length +
    payload.customers.length +
    payload.sales.length +
    payload.imports.length;

  const backupJson = JSON.stringify(
    {
      storeName: 'VTNN Tâm An - Vật tư Tâm An - Nhà Nông an tâm',
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

  let driveFileId = `local_sync_${Date.now()}`;
  const token = await getAccessToken();

  if (token) {
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      description: `Sao lưu tự động dữ liệu bán hàng & kho VTNN Tâm An (${ADMIN_BACKUP_EMAIL})`,
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([backupJson], { type: 'application/json' }));

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive API lỗi (${res.status}): ${errText}`);
    }
    const driveData = await res.json();
    if (driveData?.id) {
      driveFileId = String(driveData.id);
    }
  }

  const entry: BackupEntry = {
    id: `bk_${Date.now()}`,
    fileName,
    driveFileId,
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

export async function deleteBackupFileFromDrive(
  driveFileId: string
): Promise<void> {
  const token = await getAccessToken();
  if (token && !driveFileId.startsWith('local_') && !driveFileId.startsWith('drive_auto_')) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Không thể xóa tệp trên Google Drive (${res.status})`);
    }
  }
}

export async function fetchUserFirestoreData(uid: string): Promise<{
  products: ProductItem[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
} | null> {
  try {
    const prodSnap = await getDocs(query(collection(db, 'products'), where('ownerId', '==', uid)));
    const salesSnap = await getDocs(query(collection(db, 'sales'), where('ownerId', '==', uid)));
    const impSnap = await getDocs(query(collection(db, 'imports'), where('ownerId', '==', uid)));

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
