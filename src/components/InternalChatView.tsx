import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Coins,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { StaffMember } from '../types';
import { PRIMARY_ADMIN_UID } from '../data/seedData';
import {
  auth,
  downloadChatAttachmentToDevice,
  grantAiTokensToAccount,
  seedExistingStaffToChatDirectoryIfAdmin,
  sendInternalChatMessage,
  subscribeToAllAiTokenGrantsForAdmin,
  subscribeToChatRoomMessages,
  subscribeToChatUsersDirectory,
  subscribeToUserChatRooms,
  uploadInternalChatAttachment,
} from '../services/firebaseService';
import { canAccountCreateStaff, getPositionRoleLabel } from '../utils/businessLogic';
import { AiTokenGrantRecord } from '../utils/geminiReportAssistant';
import {
  ChatUserDirectoryEntry,
  INTERNAL_CHAT_GENERAL_ROOM_ID,
  INTERNAL_CHAT_MAX_ATTACHMENTS,
  InternalChatAttachment,
  InternalChatMessage,
  InternalChatRoom,
  buildDirectChatRoomId,
  formatChatFileSize,
  shouldAutoDownloadAttachment,
  validateChatAttachmentFile,
} from '../utils/internalChatLogic';

interface InternalChatViewProps {
  currentStaff: StaffMember;
  staffList: StaffMember[];
  initialSelectedRoomId?: string | null;
  onConsumeInitialRoomId?: () => void;
  onUnreadCountChange?: (count: number) => void;
  onOpenGeminiChat?: () => void;
  onNotifyToast?: (msg: string) => void;
}

const AUTO_DOWNLOAD_PREF_KEY = 'vtnn_taman_chat_auto_download_v1';

function loadDownloadedAttachmentIds(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(`vtnn_taman_chat_downloaded_atts_v1_${uid}`);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDownloadedAttachmentIds(uid: string, ids: Set<string>): void {
  try {
    const arr = Array.from(ids).slice(-400);
    localStorage.setItem(`vtnn_taman_chat_downloaded_atts_v1_${uid}`, JSON.stringify(arr));
  } catch {
    // ignore storage errors
  }
}

function loadRoomLastReadMap(uid: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`vtnn_taman_chat_last_read_v1_${uid}`);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveRoomLastReadMap(uid: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(`vtnn_taman_chat_last_read_v1_${uid}`, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function formatMessageTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name: string): string {
  const parts = (name || 'TA').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

export const InternalChatView: React.FC<InternalChatViewProps> = ({
  currentStaff,
  staffList,
  initialSelectedRoomId,
  onConsumeInitialRoomId,
  onUnreadCountChange,
  onOpenGeminiChat,
  onNotifyToast,
}) => {
  const isPrimaryAdmin = useMemo(() => canAccountCreateStaff(currentStaff), [currentStaff]);
  const currentUid = useMemo(() => {
    const fbUid = auth.currentUser?.uid;
    if (fbUid && !isPrimaryAdmin) return fbUid;
    return isPrimaryAdmin ? PRIMARY_ADMIN_UID : fbUid || currentStaff.uid;
  }, [currentStaff.uid, isPrimaryAdmin]);

  const [chatDirectory, setChatDirectory] = useState<ChatUserDirectoryEntry[]>([]);
  const [rooms, setRooms] = useState<InternalChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    initialSelectedRoomId || INTERNAL_CHAT_GENERAL_ROOM_ID
  );
  const [mobileShowThread, setMobileShowThread] = useState<boolean>(Boolean(initialSelectedRoomId));
  const [searchTerm, setSearchTerm] = useState('');
  const [messages, setMessages] = useState<InternalChatMessage[]>([]);
  const [composerText, setComposerText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);

  // Auto-download state
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_DOWNLOAD_PREF_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(() =>
    loadDownloadedAttachmentIds(currentUid)
  );
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const sessionStartedAtRef = useRef<number>(Date.now());
  const autoDownloadQueueRef = useRef<Set<string>>(new Set());

  // Token grant / request UI state
  const [adminTokenGrantsMap, setAdminTokenGrantsMap] = useState<Record<string, AiTokenGrantRecord>>(
    {}
  );
  const [showTokenPanel, setShowTokenPanel] = useState(false);
  const [customTokenAmount, setCustomTokenAmount] = useState<string>('10000');
  const [tokenNote, setTokenNote] = useState<string>('');
  const [isGrantingToken, setIsGrantingToken] = useState(false);

  // Unread tracking
  const [lastReadMap, setLastReadMap] = useState<Record<string, number>>(() =>
    loadRoomLastReadMap(currentUid)
  );

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDownloadedIds(loadDownloadedAttachmentIds(currentUid));
    setLastReadMap(loadRoomLastReadMap(currentUid));
  }, [currentUid]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_PREF_KEY, String(autoDownloadEnabled));
    } catch {
      // ignore
    }
  }, [autoDownloadEnabled]);

  useEffect(() => {
    if (initialSelectedRoomId) {
      setSelectedRoomId(initialSelectedRoomId);
      setMobileShowThread(true);
      onConsumeInitialRoomId?.();
    }
  }, [initialSelectedRoomId, onConsumeInitialRoomId]);

  // Subscribe to directory, rooms & admin token grants
  useEffect(() => {
    const unsubDir = subscribeToChatUsersDirectory(setChatDirectory);
    const unsubRooms = subscribeToUserChatRooms(currentUid, isPrimaryAdmin, setRooms);
    const unsubGrants = isPrimaryAdmin
      ? subscribeToAllAiTokenGrantsForAdmin(setAdminTokenGrantsMap)
      : () => {};

    if (isPrimaryAdmin) {
      void seedExistingStaffToChatDirectoryIfAdmin();
    }

    return () => {
      unsubDir();
      unsubRooms();
      unsubGrants();
    };
  }, [currentUid, isPrimaryAdmin]);

  // Subscribe to active room messages
  useEffect(() => {
    if (!selectedRoomId) return;
    setMessages([]);
    const unsub = subscribeToChatRoomMessages(selectedRoomId, setMessages);
    return () => unsub();
  }, [selectedRoomId]);

  // Mark active room as read when messages update
  useEffect(() => {
    if (!selectedRoomId) return;
    const latestRoom = rooms.find((r) => r.roomId === selectedRoomId);
    const latestMsgMs = messages[messages.length - 1]?.createdAtMs || 0;
    const targetMs = Math.max(latestRoom?.lastMessageAtMs || 0, latestMsgMs, Date.now());
    setLastReadMap((prev) => {
      if ((prev[selectedRoomId] || 0) >= targetMs) return prev;
      const next = { ...prev, [selectedRoomId]: targetMs };
      saveRoomLastReadMap(currentUid, next);
      return next;
    });
  }, [selectedRoomId, messages, rooms, currentUid]);

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedRoomId]);

  // Merge remote chat_users directory + local staffList + pinned Admin entry
  const peerUsers = useMemo<ChatUserDirectoryEntry[]>(() => {
    const map = new Map<string, ChatUserDirectoryEntry>();

    // Always ensure Primary Admin exists so non-admin users can always message Admin to request tokens
    map.set(PRIMARY_ADMIN_UID, {
      uid: PRIMARY_ADMIN_UID,
      displayName: 'Trần Đình Nhất (Admin Chính)',
      warehouseName: 'Tất cả kho',
      isPrimaryAdmin: true,
      roleLabel: 'Quản trị chính · Cấp Token A.I',
      lastSeenAt: '',
    });

    for (const st of staffList) {
      if (!st.uid) continue;
      const isAdminEntry = st.uid === PRIMARY_ADMIN_UID || canAccountCreateStaff(st);
      map.set(st.uid, {
        uid: st.uid,
        displayName: isAdminEntry ? `${st.displayName} (Admin Chính)` : st.displayName,
        warehouseName: st.assignedWarehouse || 'VTNN Tâm An',
        isPrimaryAdmin: isAdminEntry,
        roleLabel: getPositionRoleLabel(st.positionRole),
        lastSeenAt: st.updatedAt || '',
      });
    }

    for (const remote of chatDirectory) {
      if (!remote.uid) continue;
      map.set(remote.uid, {
        ...remote,
        displayName:
          remote.isPrimaryAdmin && !remote.displayName.includes('Admin')
            ? `${remote.displayName} (Admin Chính)`
            : remote.displayName,
      });
    }

    map.delete(currentUid);

    return Array.from(map.values()).sort((a, b) => {
      if (a.isPrimaryAdmin !== b.isPrimaryAdmin) return a.isPrimaryAdmin ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'vi');
    });
  }, [chatDirectory, staffList, currentUid]);

  const roomsById = useMemo(() => {
    const map = new Map<string, InternalChatRoom>();
    for (const r of rooms) {
      map.set(r.roomId, r);
    }
    return map;
  }, [rooms]);

  // Calculate unread rooms count for App badge
  const unreadRoomIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      if (
        r.roomId !== selectedRoomId &&
        r.lastSenderUid &&
        r.lastSenderUid !== currentUid &&
        r.lastMessageAtMs > (lastReadMap[r.roomId] || 0)
      ) {
        set.add(r.roomId);
      }
    }
    return set;
  }, [rooms, selectedRoomId, currentUid, lastReadMap]);

  useEffect(() => {
    onUnreadCountChange?.(unreadRoomIds.size);
  }, [unreadRoomIds.size, onUnreadCountChange]);

  // Auto-download incoming attachments from other users to user's phone/PC
  useEffect(() => {
    if (!autoDownloadEnabled || messages.length === 0) return;

    const toDownload: Array<{ att: InternalChatAttachment }> = [];
    for (const msg of messages) {
      if (!msg.attachments || msg.attachments.length === 0) continue;
      for (const att of msg.attachments) {
        if (autoDownloadQueueRef.current.has(att.id)) continue;
        if (
          shouldAutoDownloadAttachment({
            enabled: autoDownloadEnabled,
            senderUid: msg.senderUid,
            currentUid,
            attachmentId: att.id,
            downloadedIds,
            messageCreatedAtMs: msg.createdAtMs,
            sessionStartedAtMs: sessionStartedAtRef.current,
          })
        ) {
          toDownload.push({ att });
        }
      }
    }

    if (toDownload.length === 0) return;

    let cancelled = false;
    const processDownloads = async () => {
      for (const item of toDownload) {
        if (cancelled) break;
        const { att } = item;
        autoDownloadQueueRef.current.add(att.id);
        setDownloadingIds((prev) => new Set(prev).add(att.id));
        const ok = await downloadChatAttachmentToDevice(att);
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(att.id);
          return next;
        });
        if (ok) {
          setDownloadedIds((prev) => {
            const next = new Set(prev).add(att.id);
            saveDownloadedAttachmentIds(currentUid, next);
            return next;
          });
          onNotifyToast?.(`Đã tự động tải về máy: ${att.name}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    };

    void processDownloads();
    return () => {
      cancelled = true;
    };
  }, [messages, autoDownloadEnabled, currentUid, downloadedIds, onNotifyToast]);

  const activeConversationMeta = useMemo(() => {
    if (selectedRoomId === INTERNAL_CHAT_GENERAL_ROOM_ID) {
      return {
        roomId: INTERNAL_CHAT_GENERAL_ROOM_ID,
        roomType: 'group' as const,
        title: 'Nhóm chung VTNN Tâm An',
        subtitle: `${peerUsers.length + 1} tài khoản nội bộ · Đồng bộ thời gian thực`,
        peer: null as ChatUserDirectoryEntry | null,
        participants: [currentUid, ...peerUsers.map((p) => p.uid)],
      };
    }

    const matchedPeer = peerUsers.find(
      (p) => buildDirectChatRoomId(currentUid, p.uid) === selectedRoomId
    );
    const existingRoom = roomsById.get(selectedRoomId);
    const title =
      matchedPeer?.displayName ||
      existingRoom?.title ||
      'Trò chuyện riêng';
    const subtitle = matchedPeer
      ? `${matchedPeer.warehouseName} · ${matchedPeer.roleLabel || 'Tài khoản nội bộ'}`
      : 'Trò chuyện nội bộ 1-1';
    const participants = matchedPeer
      ? [currentUid, matchedPeer.uid]
      : existingRoom?.participants || [currentUid];

    return {
      roomId: selectedRoomId,
      roomType: 'dm' as const,
      title,
      subtitle,
      peer: matchedPeer || null,
      participants,
    };
  }, [selectedRoomId, peerUsers, roomsById, currentUid]);

  const filteredPeers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = !q
      ? peerUsers
      : peerUsers.filter(
          (p) =>
            p.displayName.toLowerCase().includes(q) ||
            p.warehouseName.toLowerCase().includes(q)
        );
    // Sort by most recent DM activity, keeping Primary Admin pinned near top for non-admin
    return [...list].sort((a, b) => {
      if (!isPrimaryAdmin && a.isPrimaryAdmin !== b.isPrimaryAdmin) {
        return a.isPrimaryAdmin ? -1 : 1;
      }
      const roomA = roomsById.get(buildDirectChatRoomId(currentUid, a.uid));
      const roomB = roomsById.get(buildDirectChatRoomId(currentUid, b.uid));
      const timeDiff = (roomB?.lastMessageAtMs || 0) - (roomA?.lastMessageAtMs || 0);
      if (timeDiff !== 0) return timeDiff;
      return a.displayName.localeCompare(b.displayName, 'vi');
    });
  }, [peerUsers, searchTerm, isPrimaryAdmin, roomsById, currentUid]);

  const handleQueueFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const validToAdd: File[] = [];
    for (const file of incoming) {
      const check = validateChatAttachmentFile(file);
      if (!check.ok) {
        onNotifyToast?.(check.error || 'Tệp không hợp lệ.');
        continue;
      }
      validToAdd.push(file);
    }

    if (validToAdd.length === 0) return;
    setPendingFiles((prev) => {
      const combined = [...prev, ...validToAdd];
      if (combined.length > INTERNAL_CHAT_MAX_ATTACHMENTS) {
        onNotifyToast?.(`Chỉ gửi tối đa ${INTERNAL_CHAT_MAX_ATTACHMENTS} tệp trong một lần.`);
      }
      return combined.slice(0, INTERNAL_CHAT_MAX_ATTACHMENTS);
    });
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanText = composerText.trim();
    if ((!cleanText && pendingFiles.length === 0) || isSending) return;

    setIsSending(true);
    try {
      const uploadedAttachments: InternalChatAttachment[] = [];
      for (let idx = 0; idx < pendingFiles.length; idx++) {
        const file = pendingFiles[idx];
        setUploadStatusText(`Đang tải tệp ${idx + 1}/${pendingFiles.length}: ${file.name}...`);
        const uploaded = await uploadInternalChatAttachment(activeConversationMeta.roomId, file);
        uploadedAttachments.push(uploaded);
      }

      setUploadStatusText('Đang gửi tin nhắn...');
      const res = await sendInternalChatMessage({
        roomId: activeConversationMeta.roomId,
        roomType: activeConversationMeta.roomType,
        roomTitle: activeConversationMeta.title,
        participants: activeConversationMeta.participants,
        senderName: currentStaff.displayName,
        senderWarehouse: currentStaff.assignedWarehouse || 'VTNN Tâm An',
        text: cleanText,
        messageType: uploadedAttachments.length > 0 ? 'media' : 'text',
        attachments: uploadedAttachments,
      });

      if (!res.ok) {
        onNotifyToast?.(res.error || 'Không gửi được tin nhắn. Vui lòng kiểm tra kết nối.');
      } else {
        setComposerText('');
        setPendingFiles([]);
      }
    } catch (err) {
      onNotifyToast?.(
        err instanceof Error ? err.message : 'Lỗi tải tệp lên Firebase Storage.'
      );
    } finally {
      setIsSending(false);
      setUploadStatusText('');
    }
  };

  const handleSendTokenRequest = async (amount: number) => {
    if (isGrantingToken || isPrimaryAdmin) return;
    const safeAmount = Math.max(1000, Math.round(amount));
    const peerUid = activeConversationMeta.peer?.uid || PRIMARY_ADMIN_UID;
    const dmRoomId = buildDirectChatRoomId(currentUid, peerUid) || activeConversationMeta.roomId;

    setIsGrantingToken(true);
    const res = await sendInternalChatMessage({
      roomId: dmRoomId,
      roomType: 'dm',
      roomTitle: activeConversationMeta.peer?.displayName || 'Trần Đình Nhất (Admin Chính)',
      participants: [currentUid, peerUid],
      senderName: currentStaff.displayName,
      senderWarehouse: currentStaff.assignedWarehouse || 'VTNN Tâm An',
      text:
        tokenNote.trim() ||
        `Xin Admin cấp thêm +${safeAmount.toLocaleString('vi-VN')} token Trợ lý A.I cho kho ${
          currentStaff.assignedWarehouse || 'VTNN Tâm An'
        } hôm nay.`,
      messageType: 'token_request',
      tokenAmount: safeAmount,
      targetUid: currentUid,
    });
    setIsGrantingToken(false);

    if (res.ok) {
      setShowTokenPanel(false);
      setTokenNote('');
      onNotifyToast?.('Đã gửi yêu cầu xin cấp thêm Token cho Admin quản trị chính.');
    } else {
      onNotifyToast?.(res.error || 'Không gửi được yêu cầu cấp token.');
    }
  };

  const handleAdminGrantTokens = async (targetUid: string, targetName: string, amount: number) => {
    if (!isPrimaryAdmin || isGrantingToken) return;
    const safeAmount = Math.max(1000, Math.min(2000000, Math.round(Number(amount) || 0)));
    if (!targetUid || safeAmount <= 0) return;

    setIsGrantingToken(true);
    const grantRes = await grantAiTokensToAccount({
      targetAccountId: targetUid,
      amount: safeAmount,
      grantedByName: currentStaff.displayName || 'Admin Trần Đình Nhất',
      note: tokenNote.trim() || undefined,
    });

    if (!grantRes.ok && !grantRes.syncedToCloud) {
      setIsGrantingToken(false);
      onNotifyToast?.(grantRes.error || 'Không thể cấp thêm token lúc này.');
      return;
    }

    const dmRoomId = buildDirectChatRoomId(currentUid, targetUid) || activeConversationMeta.roomId;
    await sendInternalChatMessage({
      roomId: dmRoomId,
      roomType: 'dm',
      roomTitle: targetName || 'Tài khoản kho',
      participants: [currentUid, targetUid],
      senderName: currentStaff.displayName || 'Admin Quản trị',
      senderWarehouse: 'Tất cả kho',
      text: `Admin đã cấp thêm +${safeAmount.toLocaleString('vi-VN')} token Trợ lý A.I cho ${targetName} (Tổng cộng thêm hôm nay: +${(
        grantRes.record?.bonusTokens || safeAmount
      ).toLocaleString('vi-VN')} token).${tokenNote.trim() ? ` Ghi chú: ${tokenNote.trim()}` : ''}`,
      messageType: 'token_grant',
      tokenAmount: safeAmount,
      targetUid,
    });

    setIsGrantingToken(false);
    setShowTokenPanel(false);
    setTokenNote('');
    onNotifyToast?.(
      `Đã cấp thêm +${safeAmount.toLocaleString('vi-VN')} token A.I cho ${targetName}.`
    );
  };

  const handleManualDownloadAttachment = async (att: InternalChatAttachment) => {
    setDownloadingIds((prev) => new Set(prev).add(att.id));
    const ok = await downloadChatAttachmentToDevice(att);
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.delete(att.id);
      return next;
    });
    if (ok) {
      setDownloadedIds((prev) => {
        const next = new Set(prev).add(att.id);
        saveDownloadedAttachmentIds(currentUid, next);
        return next;
      });
      onNotifyToast?.(`Đã tải về máy: ${att.name}`);
    } else {
      onNotifyToast?.(`Không tải được tệp "${att.name}". Vui lòng thử lại.`);
    }
  };

  const generalRoom = roomsById.get(INTERNAL_CHAT_GENERAL_ROOM_ID);
  const targetPeerBonusToday = activeConversationMeta.peer
    ? adminTokenGrantsMap[activeConversationMeta.peer.uid]?.bonusTokens || 0
    : 0;

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[580px] bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
      {/* LEFT ZALO-STYLE CONVERSATION SIDEBAR */}
      <aside
        className={`${
          mobileShowThread ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-84 shrink-0 flex-col border-r border-slate-200 bg-white`}
      >
        {/* Top Zalo-Blue Header & Search */}
        <div className="p-3.5 border-b border-slate-200 bg-gradient-to-r from-[#0068FF] to-[#0054CC] text-white">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <MessageCircle className="w-4 h-4 text-white" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold truncate">Chat nội bộ Tâm An</h2>
                <p className="text-[11px] text-blue-100 truncate">
                  {peerUsers.length + 1} tài khoản · Gửi ảnh, video, tài liệu
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm tên tài khoản hoặc kho..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white text-slate-800 placeholder:text-slate-400 text-xs focus:outline-none shadow-xs"
            />
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {/* Pinned Group Room */}
          <button
            type="button"
            onClick={() => {
              setSelectedRoomId(INTERNAL_CHAT_GENERAL_ROOM_ID);
              setMobileShowThread(true);
              setShowTokenPanel(false);
            }}
            className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition cursor-pointer ${
              selectedRoomId === INTERNAL_CHAT_GENERAL_ROOM_ID
                ? 'bg-[#E5F0FF] border-l-4 border-[#0068FF]'
                : 'hover:bg-slate-50'
            }`}
          >
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0068FF] to-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-bold text-slate-900 truncate">
                  Nhóm chung VTNN Tâm An
                </span>
                {generalRoom?.lastMessageAtMs ? (
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {formatMessageTime(generalRoom.lastMessageAtMs)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className="text-[11px] text-slate-500 truncate">
                  {generalRoom?.lastMessageText || 'Giao lưu, chia sẻ thông tin giữa các kho'}
                </p>
                {unreadRoomIds.has(INTERNAL_CHAT_GENERAL_ROOM_ID) && (
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                )}
              </div>
            </div>
          </button>

          {/* Direct 1-on-1 Accounts */}
          <div className="px-3.5 py-2 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Tài khoản nội bộ ({filteredPeers.length})
          </div>

          {filteredPeers.map((peer) => {
            const dmRoomId = buildDirectChatRoomId(currentUid, peer.uid);
            const room = roomsById.get(dmRoomId);
            const isSelected = selectedRoomId === dmRoomId;
            const hasUnread = unreadRoomIds.has(dmRoomId);
            const peerBonus = isPrimaryAdmin
              ? adminTokenGrantsMap[peer.uid]?.bonusTokens || 0
              : 0;

            return (
              <button
                key={peer.uid}
                type="button"
                onClick={() => {
                  if (dmRoomId) {
                    setSelectedRoomId(dmRoomId);
                    setMobileShowThread(true);
                    setShowTokenPanel(false);
                  }
                }}
                className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#E5F0FF] border-l-4 border-[#0068FF]'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    peer.isPrimaryAdmin
                      ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {getInitials(peer.displayName)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate flex items-center gap-1">
                      <span className="truncate">{peer.displayName}</span>
                      {peer.isPrimaryAdmin && (
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      )}
                    </span>
                    {room?.lastMessageAtMs ? (
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatMessageTime(room.lastMessageAtMs)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-1.5 mt-0.5">
                    <p
                      className={`text-[11px] truncate ${
                        hasUnread ? 'font-bold text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {room?.lastMessageText || peer.warehouseName || 'Nhấn để nhắn tin'}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      {peerBonus > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                          +{peerBonus.toLocaleString('vi-VN')}t
                        </span>
                      )}
                      {hasUnread && <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT ZALO-STYLE ACTIVE CONVERSATION PANE */}
      <section
        className={`${
          mobileShowThread ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col min-w-0 bg-[#EEF2F7] relative`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          handleQueueFiles(e.dataTransfer.files);
        }}
      >
        {/* Conversation Header */}
        <header className="px-4 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileShowThread(false)}
              className="md:hidden p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100"
              aria-label="Quay lại danh sách chat"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                activeConversationMeta.roomType === 'group'
                  ? 'bg-gradient-to-br from-[#0068FF] to-emerald-500 text-white'
                  : activeConversationMeta.peer?.isPrimaryAdmin
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {activeConversationMeta.roomType === 'group' ? (
                <Users className="w-4 h-4" />
              ) : (
                getInitials(activeConversationMeta.title)
              )}
            </div>

            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                {activeConversationMeta.title}
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                {activeConversationMeta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-download toggle */}
            <label
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/70 border border-slate-200 text-[11px] font-semibold text-slate-700 cursor-pointer select-none"
              title="Khi bật, ảnh, video và tài liệu mới nhận từ người khác sẽ tự động tải về điện thoại/máy tính của bạn"
            >
              <input
                type="checkbox"
                checked={autoDownloadEnabled}
                onChange={(e) => setAutoDownloadEnabled(e.target.checked)}
                className="accent-[#0068FF] rounded cursor-pointer"
              />
              <Download className="w-3.5 h-3.5 text-[#0068FF]" />
              <span>Tự động lưu file về máy</span>
            </label>

            {/* Primary Admin: Grant Tokens button for 1-on-1 DM */}
            {isPrimaryAdmin &&
              activeConversationMeta.roomType === 'dm' &&
              activeConversationMeta.peer && (
                <button
                  type="button"
                  onClick={() => setShowTokenPanel((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>
                    Cấp Token A.I
                    {targetPeerBonusToday > 0
                      ? ` (+${targetPeerBonusToday.toLocaleString('vi-VN')})`
                      : ''}
                  </span>
                </button>
              )}

            {/* Non-admin: Request Token button when chatting with Primary Admin */}
            {!isPrimaryAdmin && activeConversationMeta.peer?.isPrimaryAdmin && (
              <button
                type="button"
                onClick={() => setShowTokenPanel((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>Xin cấp thêm Token</span>
              </button>
            )}
          </div>
        </header>

        {/* Expandable Token Grant / Request Drawer inside Chat */}
        {showTokenPanel && activeConversationMeta.peer && (
          <div className="px-4 py-3 bg-white border-b border-slate-200 shadow-xs z-10">
            {isPrimaryAdmin ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-emerald-600" />
                    <span>
                      Cấp thêm Token Trợ lý A.I cho {activeConversationMeta.peer.displayName}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      (Đã cấp hôm nay: +{targetPeerBonusToday.toLocaleString('vi-VN')} token)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTokenPanel(false)}
                    className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {[10000, 20000, 50000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      disabled={isGrantingToken}
                      onClick={() =>
                        handleAdminGrantTokens(
                          activeConversationMeta.peer!.uid,
                          activeConversationMeta.peer!.displayName,
                          amt
                        )
                      }
                      className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      +{amt.toLocaleString('vi-VN')} token
                    </button>
                  ))}

                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1000}
                      max={2000000}
                      step={1000}
                      value={customTokenAmount}
                      onChange={(e) => setCustomTokenAmount(e.target.value)}
                      placeholder="Số token"
                      className="w-28 px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
                    />
                    <input
                      type="text"
                      value={tokenNote}
                      onChange={(e) => setTokenNote(e.target.value)}
                      placeholder="Ghi chú (tùy chọn)"
                      className="w-40 px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs text-slate-700"
                    />
                    <button
                      type="button"
                      disabled={isGrantingToken}
                      onClick={() =>
                        handleAdminGrantTokens(
                          activeConversationMeta.peer!.uid,
                          activeConversationMeta.peer!.displayName,
                          Number(customTokenAmount) || 10000
                        )
                      }
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {isGrantingToken ? 'Đang cấp...' : 'Cấp ngay'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-amber-600" />
                    <span>Gửi yêu cầu xin Admin chính cấp thêm Token Trợ lý A.I hôm nay</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTokenPanel(false)}
                    className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[10000, 20000, 50000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      disabled={isGrantingToken}
                      onClick={() => handleSendTokenRequest(amt)}
                      className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      Xin +{amt.toLocaleString('vi-VN')} token
                    </button>
                  ))}
                  <input
                    type="text"
                    value={tokenNote}
                    onChange={(e) => setTokenNote(e.target.value)}
                    placeholder="Lý do xin cấp thêm (tùy chọn)..."
                    className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs text-slate-700"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Drag & Drop Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 bg-[#0068FF]/15 backdrop-blur-2xs border-2 border-dashed border-[#0068FF] flex items-center justify-center pointer-events-none">
            <div className="bg-white px-6 py-4 rounded-2xl shadow-lg text-center">
              <Paperclip className="w-8 h-8 text-[#0068FF] mx-auto mb-1.5" />
              <div className="text-sm font-bold text-slate-900">Thả ảnh, video hoặc tài liệu để gửi</div>
            </div>
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-8">
              <div className="w-14 h-14 rounded-3xl bg-white shadow-xs border border-slate-200 flex items-center justify-center text-[#0068FF] mb-3">
                <MessageCircle className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                Bắt đầu trò chuyện tại {activeConversationMeta.title}
              </h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Nhắn tin trực tiếp, gửi hình ảnh, video, tài liệu qua lại giữa các kho VTNN Tâm An. Dữ liệu gửi tới sẽ được tự động lưu về máy của bạn khi bật chế độ tự động tải.
              </p>
              {!isPrimaryAdmin && activeConversationMeta.peer?.isPrimaryAdmin && (
                <button
                  type="button"
                  onClick={() => setShowTokenPanel(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <Coins className="w-4 h-4" />
                  <span>Gửi yêu cầu xin Admin cấp thêm Token</span>
                </button>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.senderUid === currentUid;
              const isTokenReq = msg.messageType === 'token_request';
              const isTokenGrant = msg.messageType === 'token_grant';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                >
                  {!isMine && (
                    <div className="text-[11px] font-semibold text-slate-500 px-1 mb-1">
                      {msg.senderName}
                      {msg.senderWarehouse ? ` · ${msg.senderWarehouse}` : ''}
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] sm:max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-xs ${
                      isTokenGrant
                        ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                        : isTokenReq
                        ? 'bg-amber-50 border border-amber-300 text-amber-950'
                        : isMine
                        ? 'bg-[#E5F1FF] border border-[#C7E0FF] text-slate-900 rounded-tr-sm'
                        : 'bg-white border border-slate-200/80 text-slate-900 rounded-tl-sm'
                    }`}
                  >
                    {/* Special Token Request Card */}
                    {isTokenReq && (
                      <div className="mb-2 pb-2 border-b border-amber-200/80">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                          <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            Yêu cầu cấp +{msg.tokenAmount.toLocaleString('vi-VN')} token A.I
                          </span>
                        </div>
                        {isPrimaryAdmin && msg.senderUid !== currentUid && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={isGrantingToken}
                              onClick={() =>
                                handleAdminGrantTokens(
                                  msg.senderUid,
                                  msg.senderName,
                                  msg.tokenAmount || 10000
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              Cấp +{ (msg.tokenAmount || 10000).toLocaleString('vi-VN') }
                            </button>
                            <button
                              type="button"
                              disabled={isGrantingToken}
                              onClick={() =>
                                handleAdminGrantTokens(msg.senderUid, msg.senderName, 20000)
                              }
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              +20.000
                            </button>
                            <button
                              type="button"
                              disabled={isGrantingToken}
                              onClick={() =>
                                handleAdminGrantTokens(msg.senderUid, msg.senderName, 50000)
                              }
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              +50.000
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Special Token Grant Card */}
                    {isTokenGrant && (
                      <div className="mb-1.5 pb-1.5 border-b border-emerald-200 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          Đã cấp +{msg.tokenAmount.toLocaleString('vi-VN')} token A.I
                        </span>
                        {onOpenGeminiChat && !isMine && (
                          <button
                            type="button"
                            onClick={onOpenGeminiChat}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Mở Trợ lý A.I</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Message Text */}
                    {msg.text && (
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    )}

                    {/* Attachments (Images, Videos, Documents) */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`${msg.text ? 'mt-2' : ''} space-y-2`}>
                        {msg.attachments.map((att) => {
                          const isSaved = downloadedIds.has(att.id);
                          const isBusy = downloadingIds.has(att.id);

                          return (
                            <div
                              key={att.id}
                              className="rounded-xl bg-white/90 border border-slate-200/90 overflow-hidden"
                            >
                              {att.kind === 'image' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxImage({ url: att.downloadUrl, name: att.name })
                                  }
                                  className="block w-full text-left cursor-zoom-in"
                                >
                                  <img
                                    src={att.downloadUrl}
                                    alt={att.name}
                                    loading="lazy"
                                    className="max-h-64 w-full object-cover bg-slate-100"
                                  />
                                </button>
                              )}

                              {att.kind === 'video' && (
                                <video
                                  src={att.downloadUrl}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="max-h-72 w-full bg-black"
                                />
                              )}

                              <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  {att.kind === 'image' ? (
                                    <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
                                  ) : att.kind === 'video' ? (
                                    <Film className="w-4 h-4 text-purple-600 shrink-0" />
                                  ) : (
                                    <FileText className="w-4 h-4 text-emerald-700 shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-800 truncate">
                                      {att.name}
                                    </div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                                      <span>{formatChatFileSize(att.size)}</span>
                                      {isBusy ? (
                                        <span className="text-blue-600 font-semibold">
                                          · Đang tự động lưu về máy...
                                        </span>
                                      ) : isSaved ? (
                                        <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                                          <Check className="w-3 h-3" /> Đã lưu về máy
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleManualDownloadAttachment(att)}
                                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#E5F0FF] text-[#0068FF] font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>{isSaved ? 'Tải lại' : 'Tải về'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-1 text-[10px] text-slate-400 text-right">
                      {formatMessageTime(msg.createdAtMs)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Pending Attachments Preview Strip */}
        {pendingFiles.length > 0 && (
          <div className="px-4 py-2 bg-white border-t border-slate-200 flex items-center gap-2 overflow-x-auto">
            {pendingFiles.map((file, idx) => (
              <div
                key={`${file.name}_${idx}`}
                className="shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs"
              >
                <span className="font-semibold text-slate-800 max-w-[140px] truncate">
                  {file.name}
                </span>
                <span className="text-[10px] text-slate-500">
                  {formatChatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingFiles((prev) => prev.filter((_, pIdx) => pIdx !== idx))
                  }
                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                  aria-label={`Bỏ tệp ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Composer Bar */}
        <form
          onSubmit={handleSend}
          className="px-3 sm:px-4 py-3 bg-white border-t border-slate-200 space-y-2"
        >
          {uploadStatusText && (
            <div className="text-[11px] font-semibold text-[#0068FF] px-1">
              {uploadStatusText}
            </div>
          )}

          {/* Hidden File Inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleQueueFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleQueueFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={docInputRef}
            type="file"
            accept="*/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleQueueFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <button
              type="button"
              disabled={isSending}
              onClick={() => imageInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0068FF] transition cursor-pointer"
            >
              <ImageIcon className="w-4 h-4 text-blue-600" />
              <span>Hình ảnh</span>
            </button>
            <button
              type="button"
              disabled={isSending}
              onClick={() => videoInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-purple-700 transition cursor-pointer"
            >
              <Film className="w-4 h-4 text-purple-600" />
              <span>Video</span>
            </button>
            <button
              type="button"
              disabled={isSending}
              onClick={() => docInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-emerald-700 transition cursor-pointer"
            >
              <Paperclip className="w-4 h-4 text-emerald-700" />
              <span>Tài liệu</span>
            </button>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.files || []);
                if (items.length > 0) {
                  handleQueueFiles(items);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={`Nhắn tin tới ${activeConversationMeta.title}... (Enter để gửi, hỗ trợ dán/kéo-thả ảnh, video, tài liệu)`}
              className="flex-1 resize-none bg-slate-50 focus:bg-white border border-slate-200 focus:border-[#0068FF] rounded-2xl px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending || (!composerText.trim() && pendingFiles.length === 0)}
              className="px-4 py-2.5 rounded-2xl bg-[#0068FF] hover:bg-[#0054CC] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Gửi</span>
            </button>
          </div>
        </form>
      </section>

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-4xl w-full flex items-center justify-between text-white mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-bold truncate">{lightboxImage.name}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void downloadChatAttachmentToDevice({
                    downloadUrl: lightboxImage.url,
                    name: lightboxImage.name,
                    mimeType: 'image/*',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0068FF] hover:bg-[#0054CC] text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải về máy</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <img
            src={lightboxImage.url}
            alt={lightboxImage.name}
            className="max-h-[82vh] max-w-full rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
