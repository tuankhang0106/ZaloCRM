<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">Tài khoản Zalo</h1>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="showAddDialog = true">Thêm Zalo</v-btn>
    </div>

    <v-card>
      <v-data-table :headers="headers" :items="accounts" :loading="loading" no-data-text="Chưa có tài khoản Zalo nào">
        <template #item.status="{ item }">
          <v-chip :color="statusColor(item.liveStatus || item.status)" size="small" variant="flat">
            {{ statusText(item.liveStatus || item.status) }}
          </v-chip>
        </template>
        <template #item.actions="{ item }">
          <div class="d-flex align-center justify-end" style="gap: 4px;">
            <v-btn v-if="authStore.isAdmin" icon size="small" variant="tonal" color="primary" title="Phân quyền truy cập" @click="openAccess(item)">
              <v-icon>mdi-shield-account</v-icon>
            </v-btn>
            <v-btn v-if="authStore.isAdmin" icon size="small" color="success" @click="syncContacts(item.id)" title="Đồng bộ danh bạ Zalo" :loading="syncing === item.id">
              <v-icon>mdi-account-sync</v-icon>
            </v-btn>

            <!-- Pending Friend Requests Button with badge -->
            <v-btn
              v-if="item.liveStatus === 'connected'"
              icon
              size="small"
              color="purple"
              title="Lời mời kết bạn đang chờ"
              @click="openPendingRequests(item)"
            >
              <v-badge
                v-if="pendingCounts[item.id] > 0"
                :content="pendingCounts[item.id]"
                color="error"
                floating
              >
                <v-icon>mdi-account-clock</v-icon>
              </v-badge>
              <v-icon v-else>mdi-account-clock</v-icon>
            </v-btn>

            <v-btn v-if="item.liveStatus !== 'connected'" icon size="small" color="primary" @click="loginAccount(item.id)" title="Đăng nhập QR">
              <v-icon>mdi-qrcode</v-icon>
            </v-btn>
            <v-btn v-if="item.liveStatus === 'disconnected' && item.sessionData" icon size="small" color="info" @click="reconnectAccount(item.id)" title="Kết nối lại">
              <v-icon>mdi-refresh</v-icon>
            </v-btn>
            <!-- Disconnect button when connected -->
            <v-btn
              v-if="authStore.isAdmin && (item.liveStatus === 'connected' || item.status === 'connected')"
              icon
              size="small"
              color="amber-darken-2"
              title="Đăng xuất / Ngắt kết nối (Giữ lại lịch sử chat)"
              :loading="disconnecting === item.id"
              @click="handleDirectDisconnect(item)"
            >
              <v-icon>mdi-link-off</v-icon>
            </v-btn>
            <v-btn v-if="authStore.isAdmin" icon size="small" color="error" @click="confirmDelete(item)" title="Xóa / Ngắt kết nối">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Add account dialog -->
    <v-dialog v-model="showAddDialog" max-width="400">
      <v-card>
        <v-card-title>Thêm tài khoản Zalo</v-card-title>
        <v-card-text>
          <v-text-field v-model="newAccountName" label="Tên hiển thị (VD: Zalo Sale Hương)" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showAddDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="adding" @click="handleAddAccount">Thêm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- QR Code dialog -->
    <v-dialog v-model="showQRDialog" max-width="400" persistent>
      <v-card class="text-center pa-4">
        <v-card-title>Quét QR để đăng nhập Zalo</v-card-title>
        <v-card-text>
          <div v-if="qrImage" class="mb-4 d-flex justify-center">
            <div style="background: #ffffff; padding: 14px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.15);">
              <img :src="'data:image/png;base64,' + qrImage" alt="QR Code" style="max-width: 260px; width: 100%; display: block;" />
            </div>
          </div>
          <div v-else-if="qrScanned" class="mb-4">
            <v-icon icon="mdi-check-circle" size="64" color="success" />
            <p class="text-h6 mt-2">Đã quét! Xác nhận trên điện thoại...</p>
            <p v-if="scannedName" class="text-body-2">{{ scannedName }}</p>
          </div>
          <div v-else class="mb-4">
            <v-progress-circular indeterminate color="primary" size="64" />
            <p class="mt-2">Đang tạo QR code...</p>
          </div>
          <v-alert v-if="qrError" type="error" density="compact" class="mt-2">{{ qrError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="cancelQR">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Enhanced Delete / Deactivate dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="520">
      <v-card style="border-radius: 16px;">
        <v-card-title class="d-flex align-center pa-4" style="border-bottom: 1px solid rgba(255,255,255,0.08);">
          <v-icon color="warning" class="mr-2">mdi-alert-circle-outline</v-icon>
          <span class="text-h6">Quản lý: {{ deleteTarget?.displayName || deleteTarget?.id }}</span>
        </v-card-title>
        
        <v-card-text class="pa-4">
          <v-alert
            v-if="targetStats.loading"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            Đang kiểm tra dữ liệu liên quan...
          </v-alert>
          <v-alert
            v-else
            type="info"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <div class="font-weight-medium">Dữ liệu liên quan đến tài khoản Zalo này:</div>
            <div class="text-body-2 mt-1">
              💬 <strong>{{ targetStats.conversationCount }}</strong> cuộc hội thoại &bull; 
              📨 <strong>{{ targetStats.messageCount }}</strong> tin nhắn đã lưu
            </div>
          </v-alert>

          <p class="text-body-2 mb-3">Vui lòng chọn hình thức xử lý:</p>

          <v-radio-group v-model="deleteMode" density="compact" hide-details>
            <v-radio value="disconnect" color="primary">
              <template #label>
                <div class="py-1">
                  <div class="font-weight-bold text-body-2 text-primary">Ngắt kết nối & Vô hiệu hóa (Khuyên dùng)</div>
                  <div class="text-caption text-grey">Dừng nhận/gửi tin nhắn, ngắt kết nối nhưng <strong>bảo tồn 100% lịch sử chat</strong> và dữ liệu khách hàng.</div>
                </div>
              </template>
            </v-radio>
            <v-divider class="my-2" />
            <v-radio value="purge" color="error">
              <template #label>
                <div class="py-1">
                  <div class="font-weight-bold text-body-2 text-error">Xóa vĩnh viễn (Xóa sạch toàn bộ)</div>
                  <div class="text-caption text-error-lighten-1">Xóa tài khoản và <strong>xóa toàn bộ {{ targetStats.conversationCount }} cuộc hội thoại, {{ targetStats.messageCount }} tin nhắn</strong> khỏi CRM. Không thể hoàn tác!</div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>

          <v-checkbox
            v-if="deleteMode === 'purge'"
            v-model="confirmPurgeCheck"
            color="error"
            density="compact"
            class="mt-3"
            label="Tôi hiểu hành động này sẽ xóa vĩnh viễn toàn bộ lịch sử chat và không thể hoàn tác."
            hide-details
          />
        </v-card-text>

        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" @click="showDeleteDialog = false">Hủy</v-btn>
          <v-btn
            v-if="deleteMode === 'disconnect'"
            color="warning"
            variant="flat"
            :loading="deleting"
            prepend-icon="mdi-link-off"
            @click="handleDeleteAccount"
          >
            Ngắt kết nối an toàn
          </v-btn>
          <v-btn
            v-else
            color="error"
            variant="flat"
            :loading="deleting"
            :disabled="!confirmPurgeCheck"
            prepend-icon="mdi-delete-forever"
            @click="handleDeleteAccount"
          >
            Xóa vĩnh viễn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Access control dialog -->
    <ZaloAccessDialog
      v-model="showAccessDialog"
      :account-id="accessTarget?.id ?? ''"
      :account-name="accessTarget?.displayName ?? accessTarget?.id ?? ''"
    />

    <!-- Pending Friend Requests Dialog -->
    <v-dialog v-model="showPendingDialog" max-width="560" scrollable>
      <v-card class="rounded-xl">
        <v-card-title class="d-flex align-center justify-space-between pa-4" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="purple-lighten-2">mdi-account-clock</v-icon>
            <span class="text-subtitle-1 font-weight-bold text-foreground">
              Lời mời kết bạn [{{ pendingAccountName }}]
            </span>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showPendingDialog = false" />
        </v-card-title>

        <v-card-text class="pa-3">
          <!-- Loading -->
          <div v-if="loadingPending" class="text-center py-8">
            <v-progress-circular indeterminate color="purple" size="40" />
            <p class="text-caption text-grey mt-2">Đang tải...</p>
          </div>

          <!-- Empty -->
          <div v-else-if="pendingRequests.length === 0" class="text-center py-8">
            <v-icon size="48" color="grey" class="mb-2">mdi-account-check-outline</v-icon>
            <p class="text-body-2 text-grey">Không có lời mời kết bạn nào đang chờ</p>
          </div>

          <!-- List of requests -->
          <div v-else class="d-flex flex-column" style="gap: 10px;">
            <v-card
              v-for="req in pendingRequests"
              :key="req.uid"
              variant="outlined"
              class="pa-3 rounded-lg"
              style="background: rgba(var(--v-theme-surface), 0.6); border-color: rgba(var(--v-border-color), var(--v-border-opacity));"
            >
              <div class="d-flex align-start" style="gap: 12px;">
                <v-avatar size="48" color="grey-darken-3" style="border: 2px solid rgba(var(--v-theme-primary), 0.3); flex-shrink: 0;">
                  <v-img v-if="req.avatar" :src="req.avatar" />
                  <v-icon v-else size="24" color="primary">mdi-account</v-icon>
                </v-avatar>

                <div class="flex-grow-1 min-width-0">
                  <p class="text-subtitle-2 font-weight-bold text-foreground mb-0">{{ req.displayName }}</p>
                  <p class="text-caption text-grey mb-1">UID: {{ req.uid }}</p>
                  <div v-if="req.message" class="text-caption pa-2 rounded" style="background: rgba(var(--v-theme-surface-variant), 0.5); font-style: italic;">
                    "{{ req.message }}"
                  </div>
                </div>

                <div class="d-flex flex-column" style="gap: 6px; flex-shrink: 0;">
                  <v-btn
                    color="success"
                    size="small"
                    variant="flat"
                    class="text-none font-weight-bold"
                    :loading="processingUid === req.uid && lastAction === 'accept'"
                    :disabled="!!processingUid"
                    @click="handleAccept(req)"
                  >
                    <v-icon start size="14">mdi-check</v-icon>
                    Đồng ý
                  </v-btn>
                  <v-btn
                    color="error"
                    size="small"
                    variant="outlined"
                    class="text-none font-weight-bold"
                    :loading="processingUid === req.uid && lastAction === 'reject'"
                    :disabled="!!processingUid"
                    @click="handleReject(req)"
                  >
                    <v-icon start size="14">mdi-close</v-icon>
                    Từ chối
                  </v-btn>
                </div>
              </div>
            </v-card>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000" location="top">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useZaloAccounts, type ZaloAccount } from '@/composables/use-zalo-accounts';
import { useAuthStore } from '@/stores/auth';
import ZaloAccessDialog from '@/components/settings/ZaloAccessDialog.vue';
import { api } from '@/api/index';
import { io } from 'socket.io-client';

const {
  accounts, loading, adding, deleting,
  showQRDialog, qrImage, qrScanned, scannedName, qrError,
  statusColor, statusText,
  fetchAccounts, addAccount, loginAccount, reconnectAccount, deleteAccount,
  disconnectAccount, getAccountStats,
  cancelQR, setupSocket,
} = useZaloAccounts();

const authStore = useAuthStore();
const router = useRouter();

const showAddDialog = ref(false);
const syncing = ref<string | null>(null);
const showDeleteDialog = ref(false);
const showAccessDialog = ref(false);
const newAccountName = ref('');
const deleteTarget = ref<ZaloAccount | null>(null);
const accessTarget = ref<ZaloAccount | null>(null);

// Enhanced delete/disconnect state
const deleteMode = ref<'disconnect' | 'purge'>('disconnect');
const confirmPurgeCheck = ref(false);
const targetStats = ref({ loading: false, conversationCount: 0, messageCount: 0 });
const disconnecting = ref<string | null>(null);

// Pending friend requests
const showPendingDialog = ref(false);
const pendingAccountId = ref('');
const pendingAccountName = ref('');
const pendingRequests = ref<any[]>([]);
const loadingPending = ref(false);
const processingUid = ref('');
const lastAction = ref('');
const pendingCounts = ref<Record<string, number>>({});

const snackbar = ref({ show: false, text: '', color: 'success' });

const headers = [
  { title: 'Tên', key: 'displayName', sortable: true },
  { title: 'Zalo UID', key: 'zaloUid' },
  { title: 'SĐT', key: 'phone' },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

async function syncContacts(accountId: string) {
  syncing.value = accountId;
  try {
    const res = await api.post(`/zalo-accounts/${accountId}/sync-contacts`);
    snackbar.value = { show: true, text: `Đồng bộ thành công: ${res.data.created} mới, ${res.data.updated} cập nhật`, color: 'success' };
  } catch (err: any) {
    snackbar.value = { show: true, text: 'Đồng bộ thất bại: ' + (err.response?.data?.error || err.message), color: 'error' };
  } finally {
    syncing.value = null;
  }
}

async function handleAddAccount() {
  const ok = await addAccount(newAccountName.value);
  if (ok) {
    showAddDialog.value = false;
    newAccountName.value = '';
  }
}

async function handleDirectDisconnect(account: ZaloAccount) {
  disconnecting.value = account.id;
  try {
    const ok = await disconnectAccount(account.id);
    if (ok) {
      snackbar.value = {
        show: true,
        text: `Đã ngắt kết nối tài khoản "${account.displayName || account.id}". Lịch sử chat được giữ nguyên.`,
        color: 'info'
      };
    } else {
      snackbar.value = { show: true, text: 'Không thể ngắt kết nối', color: 'error' };
    }
  } finally {
    disconnecting.value = null;
  }
}

async function confirmDelete(account: ZaloAccount) {
  deleteTarget.value = account;
  deleteMode.value = 'disconnect';
  confirmPurgeCheck.value = false;
  targetStats.value = { loading: true, conversationCount: 0, messageCount: 0 };
  showDeleteDialog.value = true;

  const stats = await getAccountStats(account.id);
  targetStats.value = { loading: false, ...stats };
}

function openAccess(account: ZaloAccount) {
  accessTarget.value = account;
  showAccessDialog.value = true;
}

async function handleDeleteAccount() {
  if (!deleteTarget.value) return;
  const isPurge = deleteMode.value === 'purge';
  const targetName = deleteTarget.value.displayName || deleteTarget.value.id;
  const ok = await deleteAccount(deleteTarget.value, isPurge);
  if (ok) {
    snackbar.value = {
      show: true,
      text: isPurge
        ? `Đã xóa vĩnh viễn tài khoản "${targetName}" và toàn bộ lịch sử chat.`
        : `Đã ngắt kết nối tài khoản "${targetName}". Lịch sử chat được bảo toàn.`,
      color: isPurge ? 'warning' : 'success'
    };
    showDeleteDialog.value = false;
    deleteTarget.value = null;
  }
}

async function openPendingRequests(account: ZaloAccount) {
  pendingAccountId.value = account.id;
  pendingAccountName.value = account.displayName || account.id;
  showPendingDialog.value = true;
  loadingPending.value = true;
  pendingRequests.value = [];
  try {
    const res = await api.get(`/zalo-accounts/${account.id}/friend-requests`);
    pendingRequests.value = res.data.requests || [];
    pendingCounts.value[account.id] = pendingRequests.value.length;
  } catch (err: any) {
    snackbar.value = { show: true, text: err.response?.data?.error || 'Lỗi khi tải lời mời từ Zalo', color: 'error' };
  } finally {
    loadingPending.value = false;
  }
}

async function handleAccept(req: any) {
  processingUid.value = req.uid;
  lastAction.value = 'accept';
  try {
    const res = await api.post(`/zalo-accounts/${pendingAccountId.value}/accept-friend-request`, {
      uid: req.uid,
      displayName: req.displayName,
      avatar: req.avatar,
    });
    pendingRequests.value = pendingRequests.value.filter(r => r.uid !== req.uid);
    pendingCounts.value[pendingAccountId.value] = pendingRequests.value.length;
    snackbar.value = { show: true, text: `Đã kết bạn với ${req.displayName}!`, color: 'success' };
    if (res.data?.conversationId) {
      showPendingDialog.value = false;
      router.push(`/chat?convId=${res.data.conversationId}`);
    }
  } catch (err: any) {
    snackbar.value = { show: true, text: err.response?.data?.error || 'Lỗi khi chấp nhận kết bạn', color: 'error' };
  } finally {
    processingUid.value = '';
    lastAction.value = '';
  }
}

async function handleReject(req: any) {
  processingUid.value = req.uid;
  lastAction.value = 'reject';
  try {
    await api.post(`/zalo-accounts/${pendingAccountId.value}/reject-friend-request`, {
      uid: req.uid,
    });
    pendingRequests.value = pendingRequests.value.filter(r => r.uid !== req.uid);
    pendingCounts.value[pendingAccountId.value] = pendingRequests.value.length;
    snackbar.value = { show: true, text: `Đã từ chối lời mời từ ${req.displayName}`, color: 'info' };
  } catch (err: any) {
    snackbar.value = { show: true, text: err.response?.data?.error || 'Lỗi khi từ chối', color: 'error' };
  } finally {
    processingUid.value = '';
    lastAction.value = '';
  }
}

async function fetchAccountsAndCounts() {
  await fetchAccounts();
  for (const account of accounts.value) {
    if (account.liveStatus === 'connected') {
      try {
        const res = await api.get(`/zalo-accounts/${account.id}/friend-requests`);
        pendingCounts.value[account.id] = (res.data?.requests || []).length;
      } catch (_) {}
    }
  }
}

onMounted(() => {
  fetchAccountsAndCounts();
  setupSocket();

  // Listen for real-time friend requests to update badge counts
  const socket = io({ transports: ['websocket', 'polling'] });
  socket.on('zalo:friend_request', (data: any) => {
    if (data?.accountId) {
      pendingCounts.value[data.accountId] = (pendingCounts.value[data.accountId] || 0) + 1;
      // Also add to open dialog if it's for the same account
      if (showPendingDialog.value && pendingAccountId.value === data.accountId) {
        const mappedReq = {
          uid: data.senderUid,
          displayName: data.senderName,
          avatar: data.senderAvatar,
          message: data.message,
        };
        const exists = pendingRequests.value.find(r => r.uid === mappedReq.uid);
        if (!exists) pendingRequests.value.unshift(mappedReq);
      }
    }
  });
});
</script>

