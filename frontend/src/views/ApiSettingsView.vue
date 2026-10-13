<template>
  <div style="max-width: 700px;">
    <h1 class="text-h5 mb-4">
      <v-icon class="mr-2" color="primary">mdi-api</v-icon>
      API & Webhook
    </h1>

    <!-- API Key section -->
    <v-card class="mb-4">
      <v-card-title class="text-body-1">API Key</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="apiKey"
          label="API Key"
          readonly
          append-inner-icon="mdi-content-copy"
          @click:append-inner="copyKey"
        />
        <v-btn
          color="primary"
          variant="outlined"
          prepend-icon="mdi-refresh"
          :loading="generatingKey"
          @click="generateKey"
        >
          Tạo key mới
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Webhook section -->
    <v-card class="mb-4">
      <v-card-title class="text-body-1">Webhook</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="webhookUrl"
          label="Webhook URL"
          placeholder="https://your-server.com/webhook"
          class="mb-2"
        />
        <v-text-field
          v-model="webhookSecret"
          label="Secret (HMAC)"
          type="password"
          class="mb-3"
        />
        <div class="d-flex gap-2">
          <v-btn color="primary" :loading="saving" @click="saveWebhook">Lưu</v-btn>
          <v-btn variant="outlined" :loading="testing" @click="testWebhook">Test Webhook</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- Google Gemini AI section -->
    <v-card class="mb-4">
      <v-card-title class="text-body-1 d-flex align-center">
        <v-icon size="18" class="mr-1" color="primary">mdi-sparkles</v-icon>
        Google Gemini AI
      </v-card-title>
      <v-card-text>
        <div class="text-caption text-grey mb-3">
          Cấu hình API Key của Google Gemini để sử dụng tính năng tóm tắt thông minh lịch sử cuộc trò chuyện. Lấy API Key miễn phí tại <a href="https://aistudio.google.com/" target="_blank" class="text-primary font-weight-medium text-decoration-none">Google AI Studio</a>.
        </div>
        <v-text-field
          v-model="geminiApiKey"
          label="Gemini API Key"
          type="password"
          placeholder="Nhập Google Gemini API Key tại đây..."
          class="mb-3"
        />
        <v-btn color="primary" :loading="savingGemini" @click="saveGemini">Lưu API Key</v-btn>
      </v-card-text>
    </v-card>

    <!-- Trợ lý AI section -->
    <v-card class="mb-4" style="border: 1px solid rgba(var(--v-theme-primary), 0.2) !important; background: rgba(var(--v-theme-primary), 0.03) !important;">
      <v-card-title class="text-body-1 d-flex align-center py-3">
        <v-icon size="18" class="mr-2" color="primary">mdi-robot-outline</v-icon>
        <span class="font-weight-bold text-primary">Trợ lý AI Tự động (Gemini Bot)</span>
      </v-card-title>
      <v-card-text>
        <div class="text-caption text-grey mb-3">
          Hệ thống AI tự động trả lời tin nhắn của khách hàng mới để khai thác nhu cầu nhanh chóng. AI sẽ tự động tạm dừng hoạt động ngay khi có nhân viên chat từ CRM.
        </div>

        <!-- AI Toggle -->
        <div class="d-flex align-center justify-space-between px-3 py-2 rounded mb-4" 
             style="border: 1px solid rgba(var(--v-theme-primary), 0.15); background: rgba(var(--v-theme-primary), 0.04);">
          <div class="d-flex align-center">
            <v-icon icon="mdi-robot" :color="aiEnabled ? 'primary' : 'grey'" class="mr-2" size="20" />
            <div class="d-flex flex-column">
              <span class="text-caption font-weight-bold text-foreground" style="line-height: 1.2;">Bật/Tắt Chatbot Tự động</span>
              <span class="text-grey" style="font-size: 0.65rem;">
                {{ aiEnabled ? 'AI đang trực chat phục vụ khách hàng mới' : 'Trợ lý AI đang tắt toàn cục' }}
              </span>
            </div>
          </div>
          <v-switch
            v-model="aiEnabled"
            color="primary"
            hide-details
            inset
            density="compact"
            class="ma-0 pa-0"
          />
        </div>

        <!-- AI Time Scheduler -->
        <div class="mb-4">
          <label class="text-caption font-weight-bold text-foreground d-block mb-1">Khung giờ trực chat của AI</label>
          <v-select
            v-model="aiScheduleType"
            :items="scheduleOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
          />
          <div class="text-caption text-grey" style="font-size: 0.72rem; line-height: 1.35;">
            <span v-if="aiScheduleType === '24_7'">
              <v-icon size="12" class="mr-1" color="primary">mdi-calendar-check</v-icon>
              <strong>Trực 24/7:</strong> AI hoạt động liên tục bất kể ngày đêm và giờ hành chính.
            </span>
            <span v-else-if="aiScheduleType === 'off_hours'">
              <v-icon size="12" class="mr-1" color="warning">mdi-calendar-clock</v-icon>
              <strong>Ngoài giờ hành chính:</strong> AI chỉ tự động trực ngoài khung giờ (08:00 - 17:30) từ Thứ 2 - Thứ 6; hoạt động 24/24 trong Thứ 7, Chủ Nhật.
            </span>
          </div>
        </div>

        <!-- AI System Prompt -->
        <div class="mb-4">
          <label class="text-caption font-weight-bold text-foreground d-block mb-1">Chỉ dẫn phản hồi (System Prompt)</label>
          <v-textarea
            v-model="aiPrompt"
            rows="6"
            density="compact"
            variant="outlined"
            placeholder="Nhập hướng dẫn chi tiết cho trợ lý AI..."
            auto-grow
            style="font-family: monospace; font-size: 0.8rem;"
          />
          <div class="text-caption text-grey" style="font-size: 0.72rem;">
            Hướng dẫn chi tiết cho AI cách xưng hô, hỏi loại sản phẩm (áo/mũ/đồng phục), số lượng, và xin file ảnh logo qua chat.
          </div>
        </div>

        <!-- Knowledge Base -->
        <div class="mb-4">
          <label class="text-caption font-weight-bold text-foreground d-block mb-1">Cơ sở tri thức (Knowledge Base)</label>
          <v-textarea
            v-model="aiKnowledgeBase"
            rows="4"
            density="compact"
            variant="outlined"
            placeholder="Nhập cơ sở tri thức về xưởng..."
            auto-grow
            style="font-size: 0.8rem;"
          />
          <div class="text-caption text-grey" style="font-size: 0.72rem;">
            Thông tin xưởng may, loại vải, thời gian hoàn thành... giúp AI trả lời chính xác thông tin doanh nghiệp.
          </div>
        </div>

        <!-- Nhóm Zalo Nhận Thông Báo -->
        <div class="mb-4">
          <label class="text-caption font-weight-bold text-foreground d-block mb-1">
            <v-icon size="14" class="mr-1" color="primary">mdi-bell-outline</v-icon>
            Nhóm Zalo nhận thông báo khách mới
          </label>
          <v-select
            v-model="selectedGroupValue"
            :items="groupItems"
            item-title="title"
            item-value="value"
            density="compact"
            variant="outlined"
            placeholder="Chọn nhóm Zalo nhận thông báo..."
            class="mb-2"
            @update:model-value="onGroupSelected"
          />
          
          <!-- Manual Group ID Input -->
          <v-text-field
            v-if="selectedGroupValue === 'manual'"
            v-model="manualGroupId"
            label="Nhập Zalo Group Uid thủ công"
            placeholder="Ví dụ: 7577688716448872085"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          
          <div class="text-caption text-grey" style="font-size: 0.72rem; line-height: 1.35;">
            Khi có khách hàng mới nhắn tin, hệ thống sẽ tự động gửi thông báo trực tiếp vào nhóm chat Zalo này để nhân viên kịp thời vào hỗ trợ.
          </div>
        </div>

        <!-- Save Button -->
        <v-btn
          color="primary"
          block
          :loading="savingAi"
          @click="saveAiSettings"
          prepend-icon="mdi-robot"
          variant="flat"
          class="font-weight-bold text-subtitle-2 rounded-lg"
        >
          Lưu cấu hình Trợ lý AI
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- API Docs -->
    <v-card>
      <v-card-title class="text-body-1">API Documentation</v-card-title>
      <v-card-text>
        <pre style="font-size: 12px; overflow-x: auto; white-space: pre-wrap;">Header: X-API-Key: your-key

GET  /api/public/contacts
POST /api/public/contacts
GET  /api/public/conversations
POST /api/public/messages/send
GET  /api/public/appointments
POST /api/public/appointments

Webhook events:
- message.received
- message.sent
- contact.created
- zalo.connected
- zalo.disconnected</pre>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" :timeout="3000">
      {{ snack.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '@/api';

const apiKey = ref('');
const generatingKey = ref(false);
const webhookUrl = ref('');
const webhookSecret = ref('');
const geminiApiKey = ref('');
const saving = ref(false);
const savingGemini = ref(false);
const testing = ref(false);

// AI Assistant States
const aiEnabled = ref(false);
const aiPrompt = ref('');
const aiKnowledgeBase = ref('');
const aiScheduleType = ref('24_7');
const savingAi = ref(false);

// Zalo Group Alert States
const aiAlertGroupId = ref('');
const aiAlertGroupName = ref('');
const selectedGroupValue = ref('');
const manualGroupId = ref('');
const zaloGroups = ref<any[]>([]);

const groupItems = computed(() => {
  const list = zaloGroups.value.map(g => ({
    title: `${g.name} (Zalo: ${g.zaloAccountName})`,
    value: g.externalThreadId,
    name: g.name
  }));
  list.unshift({ title: '❌ Không gửi thông báo', value: '', name: '' });
  list.push({ title: '🔧 Nhập ID nhóm thủ công...', value: 'manual', name: 'Nhập thủ công' });
  return list;
});

function onGroupSelected(val: string) {
  if (val !== 'manual') {
    const found = groupItems.value.find(item => item.value === val);
    aiAlertGroupId.value = val;
    aiAlertGroupName.value = found ? found.name : '';
  } else {
    aiAlertGroupId.value = manualGroupId.value;
    aiAlertGroupName.value = 'Nhập thủ công';
  }
}

const scheduleOptions = [
  { label: 'Trực 24/7 (AI luôn trả lời tin nhắn mới)', value: '24_7' },
  { label: 'Ngoài giờ hành chính (AI trực đêm & cuối tuần)', value: 'off_hours' },
];

const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

async function loadApiKey() {
  try {
    const res = await api.get('/settings/api-key');
    apiKey.value = res.data.apiKey ?? '';
  } catch {
    apiKey.value = '';
  }
}

async function loadWebhook() {
  try {
    const res = await api.get('/settings/webhook');
    webhookUrl.value = res.data.webhookUrl ?? '';
    webhookSecret.value = res.data.webhookSecret ?? '';
    geminiApiKey.value = res.data.geminiApiKey ?? '';
  } catch {
    webhookUrl.value = '';
    webhookSecret.value = '';
    geminiApiKey.value = '';
  }
}

async function loadZaloGroups() {
  try {
    const res = await api.get('/settings/ai/groups');
    zaloGroups.value = res.data ?? [];
  } catch (err) {
    console.error('Failed to load Zalo groups:', err);
  }
}

async function loadAiSettings() {
  try {
    const res = await api.get('/settings/ai');
    aiEnabled.value = res.data.aiEnabled ?? false;
    aiPrompt.value = res.data.aiPrompt ?? '';
    aiKnowledgeBase.value = res.data.aiKnowledgeBase ?? '';
    aiAlertGroupId.value = res.data.aiAlertGroupId ?? '';
    aiAlertGroupName.value = res.data.aiAlertGroupName ?? '';
    
    // Determine selected dropdown value
    if (!aiAlertGroupId.value) {
      selectedGroupValue.value = '';
    } else {
      const inList = zaloGroups.value.some(g => g.externalThreadId === aiAlertGroupId.value);
      if (inList) {
        selectedGroupValue.value = aiAlertGroupId.value;
      } else {
        selectedGroupValue.value = 'manual';
        manualGroupId.value = aiAlertGroupId.value;
      }
    }
    
    let sched = { type: '24_7' };
    if (res.data.aiSchedule) {
      try {
        sched = JSON.parse(res.data.aiSchedule);
      } catch (e) {
        console.error('Failed to parse aiSchedule', e);
      }
    }
    aiScheduleType.value = sched.type || '24_7';
  } catch (err) {
    console.error('Failed to load AI settings:', err);
  }
}

async function saveAiSettings() {
  savingAi.value = true;
  try {
    const aiSchedule = JSON.stringify({
      type: aiScheduleType.value,
      customRanges: []
    });

    let targetGroupId = aiAlertGroupId.value;
    let targetGroupName = aiAlertGroupName.value;

    if (selectedGroupValue.value === 'manual') {
      targetGroupId = manualGroupId.value;
      targetGroupName = 'Nhập thủ công';
    } else if (selectedGroupValue.value === '') {
      targetGroupId = '';
      targetGroupName = '';
    }

    await api.post('/settings/ai', {
      aiEnabled: aiEnabled.value,
      aiPrompt: aiPrompt.value,
      aiKnowledgeBase: aiKnowledgeBase.value,
      aiSchedule,
      aiAlertGroupId: targetGroupId,
      aiAlertGroupName: targetGroupName
    });
    showSnack('Đã lưu cấu hình Trợ lý AI');
  } catch (err) {
    showSnack('Lưu cấu hình AI thất bại', 'error');
    console.error('Failed to save AI settings:', err);
  } finally {
    savingAi.value = false;
  }
}

async function saveGemini() {
  savingGemini.value = true;
  try {
    await api.put('/settings/webhook', {
      geminiApiKey: geminiApiKey.value,
    });
    showSnack('Đã lưu cấu hình Google Gemini API Key');
  } catch {
    showSnack('Lưu thất bại', 'error');
  } finally {
    savingGemini.value = false;
  }
}

async function generateKey() {
  generatingKey.value = true;
  try {
    const res = await api.post('/settings/api-key/generate');
    apiKey.value = res.data.apiKey ?? '';
    showSnack('API key mới đã được tạo');
  } catch {
    showSnack('Tạo key thất bại', 'error');
  } finally {
    generatingKey.value = false;
  }
}

async function copyKey() {
  if (!apiKey.value) return;
  await navigator.clipboard.writeText(apiKey.value);
  showSnack('Đã sao chép API key');
}

async function saveWebhook() {
  saving.value = true;
  try {
    await api.put('/settings/webhook', {
      webhookUrl: webhookUrl.value,
      webhookSecret: webhookSecret.value,
    });
    showSnack('Đã lưu cấu hình webhook');
  } catch {
    showSnack('Lưu thất bại', 'error');
  } finally {
    saving.value = false;
  }
}

async function testWebhook() {
  testing.value = true;
  try {
    await api.post('/settings/webhook/test');
    showSnack('Gửi test webhook thành công');
  } catch {
    showSnack('Test webhook thất bại', 'error');
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  await loadZaloGroups();
  await Promise.all([loadApiKey(), loadWebhook(), loadAiSettings()]);
});
</script>
