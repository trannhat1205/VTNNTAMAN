export const INTERNAL_CHAT_GENERAL_ROOM_ID = 'general_all_staff';
export const INTERNAL_CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const INTERNAL_CHAT_MAX_ATTACHMENTS = 5;
export const INTERNAL_CHAT_AUTO_DOWNLOAD_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export type InternalChatAttachmentKind = 'image' | 'video' | 'document';

export interface InternalChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: InternalChatAttachmentKind;
  downloadUrl: string;
  storagePath: string;
}

export type InternalChatMessageType = 'text' | 'media' | 'token_request' | 'token_grant';

export interface InternalChatMessage {
  id: string;
  roomId: string;
  senderUid: string;
  senderName: string;
  senderWarehouse: string;
  text: string;
  messageType: InternalChatMessageType;
  attachments: InternalChatAttachment[];
  tokenAmount: number;
  targetUid: string;
  createdAtMs: number;
  createdAt: string;
}

export interface InternalChatRoom {
  roomId: string;
  roomType: 'group' | 'dm';
  title: string;
  participants: string[];
  lastMessageText: string;
  lastMessageType: InternalChatMessageType;
  lastSenderUid: string;
  lastSenderName: string;
  lastMessageAtMs: number;
  updatedAt: string;
}

export interface ChatUserDirectoryEntry {
  uid: string;
  displayName: string;
  warehouseName: string;
  isPrimaryAdmin: boolean;
  roleLabel: string;
  lastSeenAt: string;
}

function sanitizeUidSegment(uid: string): string {
  return (uid || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 56);
}

/**
 * Deterministic 1-on-1 DM room ID matching Firestore & Storage security rules:
 * `dm_${first}__${second}` where `first` and `second` are lexicographically sorted UIDs.
 */
export function buildDirectChatRoomId(uidA: string, uidB: string): string {
  const a = sanitizeUidSegment(uidA);
  const b = sanitizeUidSegment(uidB);
  if (!a || !b || a === b) {
    return '';
  }
  const [first, second] = a < b ? [a, b] : [b, a];
  return `dm_${first}__${second}`;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'heic',
  'heif',
  'avif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'm4v',
  '3gp',
  'ogv',
]);

export function classifyChatAttachmentKind(
  mimeType: string,
  fileName: string
): InternalChatAttachmentKind {
  const lowerMime = (mimeType || '').trim().toLowerCase();
  if (lowerMime.startsWith('image/')) {
    return 'image';
  }
  if (lowerMime.startsWith('video/')) {
    return 'video';
  }
  const ext = (fileName || '').split('.').pop()?.trim().toLowerCase() || '';
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  return 'document';
}

export function validateChatAttachmentFile(file: {
  name: string;
  size: number;
  type?: string;
}): { ok: boolean; error?: string; kind: InternalChatAttachmentKind } {
  const kind = classifyChatAttachmentKind(file.type || '', file.name || '');
  if (!file.name || !file.name.trim()) {
    return { ok: false, error: 'Tệp không có tên hợp lệ.', kind };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: `Tệp "${file.name}" bị rỗng (0 byte).`, kind };
  }
  if (file.size > INTERNAL_CHAT_MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `Tệp "${file.name}" vượt quá giới hạn tối đa 25 MB (${formatChatFileSize(
        file.size
      )}).`,
      kind,
    };
  }
  return { ok: true, kind };
}

export function formatChatFileSize(bytes: number): string {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
}

export function sanitizeChatStorageFileName(fileName: string): string {
  const raw = (fileName || 'file').normalize('NFC').trim();
  const dotIdx = raw.lastIndexOf('.');
  const base = dotIdx > 0 ? raw.slice(0, dotIdx) : raw;
  const ext = dotIdx > 0 ? raw.slice(dotIdx + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) : '';
  const safeBase =
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'tep_dinh_kem';
  return ext ? `${safeBase}.${ext.toLowerCase()}` : safeBase;
}

export function shouldAutoDownloadAttachment(params: {
  enabled: boolean;
  senderUid: string;
  currentUid: string;
  attachmentId: string;
  downloadedIds: Set<string>;
  messageCreatedAtMs: number;
  sessionStartedAtMs: number;
}): boolean {
  if (!params.enabled) return false;
  if (!params.attachmentId || !params.currentUid) return false;
  if (params.senderUid === params.currentUid) return false;
  if (params.downloadedIds.has(params.attachmentId)) return false;

  const isLiveMessage = params.messageCreatedAtMs >= params.sessionStartedAtMs - 5000;
  const isRecentUnreadMessage =
    params.sessionStartedAtMs - params.messageCreatedAtMs <=
    INTERNAL_CHAT_AUTO_DOWNLOAD_RECENT_WINDOW_MS;

  return isLiveMessage || isRecentUnreadMessage;
}
