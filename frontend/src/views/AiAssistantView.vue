<template>
  <div class="ai-assistant-page d-flex flex-column h-100">
    <!-- Header -->
    <div class="d-flex align-center justify-space-between mb-3 flex-wrap gap-3">
      <div>
        <h1 class="text-h5 font-weight-bold d-flex align-center mb-1">
          <v-icon color="primary" class="mr-2" size="26">mdi-robot-outline</v-icon>
          Trợ lý AI (Gemini Bot)
        </h1>
        <p class="text-caption text-muted mb-0">
          Huấn luyện kịch bản phản hồi, cơ sở tri thức sản phẩm & kiểm tra trực tiếp trong khung chat
        </p>
      </div>

      <!-- Main Tabs Switcher: Huấn luyện vs Khung chat -->
      <v-tabs v-model="currentTab" density="compact" color="primary" class="rounded-pill border">
        <v-tab value="train" prepend-icon="mdi-school-outline" class="text-none font-weight-medium">
          Huấn luyện & Tri thức
        </v-tab>
        <v-tab value="chat" prepend-icon="mdi-message-text-outline" class="text-none font-weight-medium">
          Khung chat thử nghiệm
        </v-tab>
      </v-tabs>
    </div>

    <!-- TAB 1: HUẤN LUYỆN NỘI DUNG & DỮ LIỆU TRI THỨC -->
    <div v-show="currentTab === 'train'" class="flex-grow-1 overflow-y-auto pr-1">
      <v-row dense>
        <!-- Card 1: Trạng thái & Bật tắt toàn cục -->
        <v-col cols="12">
          <v-card class="pa-4 rounded-xl mb-3 elevation-1">
            <div class="d-flex align-center justify-space-between flex-wrap gap-3">
              <div class="d-flex align-center gap-3">
                <v-avatar size="44" :color="aiEnabled ? 'primary' : 'grey-darken-3'">
                  <v-icon icon="mdi-robot" color="white" size="24" />
                </v-avatar>
                <div>
                  <div class="d-flex align-center gap-2">
                    <span class="text-subtitle-1 font-weight-bold text-foreground">
                      Trạng thái Trực chat Tự động
                    </span>
                    <v-chip
                      size="x-small"
                      :color="aiEnabled ? 'success' : 'grey'"
                      variant="flat"
                      class="font-weight-bold"
                    >
                      {{ aiEnabled ? 'ĐANG HOẠT ĐỘNG' : 'ĐANG TẮT' }}
                    </v-chip>
                  </div>
                  <p class="text-caption text-muted mb-0">
                    {{ aiEnabled ? 'AI đang tự động tiếp đón & thu thập thông tin khách hàng mới' : 'Trợ lý AI đang tắt toàn cục. Nhân viên sẽ tự tiếp nhận.' }}
                  </p>
                </div>
              </div>

              <div class="d-flex align-center gap-4">
                <v-switch
                  v-model="aiEnabled"
                  color="primary"
                  hide-details
                  inset
                  density="compact"
                />
              </div>
            </div>

            <v-divider class="my-3" />

            <!-- Khung giờ & Nhóm thông báo -->
            <v-row dense>
              <v-col cols="12" md="6">
                <label class="text-caption font-weight-bold text-foreground d-block mb-1">
                  <v-icon size="14" class="mr-1" color="primary">mdi-clock-outline</v-icon>
                  Khung giờ trực chat của AI
                </label>
                <v-select
                  v-model="aiScheduleType"
                  :items="scheduleOptions"
                  item-title="label"
                  item-value="value"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>

              <v-col cols="12" md="6">
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
                  hide-details
                  @update:model-value="onGroupSelected"
                />
              </v-col>
            </v-row>
          </v-card>
        </v-col>

        <!-- Card 2: System Prompt (Chỉ dẫn phản hồi) -->
        <v-col cols="12">
          <v-card class="pa-4 rounded-xl mb-3 elevation-1">
            <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-2">
              <div class="d-flex align-center gap-2">
                <v-icon color="primary" size="20">mdi-account-voice</v-icon>
                <span class="text-subtitle-1 font-weight-bold text-foreground">
                  1. Chỉ dẫn phản hồi & Tính cách (System Prompt)
                </span>
              </div>

              <!-- Quick prompt templates -->
              <div class="d-flex align-center gap-1.5 flex-wrap">
                <span class="text-caption text-muted mr-1">Mẫu có sẵn:</span>
                <v-btn
                  size="x-small"
                  variant="flat"
                  color="primary"
                  class="text-none font-weight-medium rounded-pill"
                  prepend-icon="mdi-star"
                  @click="applyPromptTemplate('b2b_routing')"
                >
                  Định tuyến B2B 8 Ngành (Khuyên dùng)
                </v-btn>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  color="info"
                  class="text-none font-weight-medium rounded-pill"
                  @click="applyPromptTemplate('garment')"
                >
                  Xưởng may & Đồng phục
                </v-btn>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  color="success"
                  class="text-none font-weight-medium rounded-pill"
                  @click="applyPromptTemplate('gifts')"
                >
                  Quà tặng doanh nghiệp
                </v-btn>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  color="secondary"
                  class="text-none font-weight-medium rounded-pill"
                  @click="applyPromptTemplate('cskh')"
                >
                  CSKH chuyên nghiệp
                </v-btn>
              </div>
            </div>

            <p class="text-caption text-muted mb-2">
              Quy định vai trò, thứ tự ưu tiên (Khiếu nại > Đòi nhân viên > Hỏi đơn > Báo giá), chuỗi slot 8 ngành và bảng giải quyết xung đột.
            </p>

            <v-textarea
              v-model="aiPrompt"
              rows="7"
              density="compact"
              variant="outlined"
              placeholder="Nhập chỉ dẫn phản hồi chi tiết cho trợ lý AI..."
              auto-grow
              class="font-mono"
              style="font-size: 0.85rem;"
            />
          </v-card>
        </v-col>

        <!-- Card 3: Cơ sở tri thức (Knowledge Base) -->
        <v-col cols="12">
          <v-card class="pa-4 rounded-xl mb-3 elevation-1">
            <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-2">
              <div class="d-flex align-center gap-2">
                <v-icon color="success" size="20">mdi-database-outline</v-icon>
                <span class="text-subtitle-1 font-weight-bold text-foreground">
                  2. Cơ sở tri thức doanh nghiệp (Knowledge Base)
                </span>
              </div>
              <v-btn
                size="x-small"
                variant="outlined"
                color="success"
                prepend-icon="mdi-plus"
                class="text-none font-weight-medium rounded-pill"
                @click="appendSampleKnowledge"
              >
                Chèn thông tin may mẫu chuẩn
              </v-btn>
            </div>

            <p class="text-caption text-muted mb-2">
              Cung cấp chi tiết về năng lực xưởng, chất liệu vải, thời gian sản xuất, bảng size và chính sách cọc/đổi trả để AI trả lời khách chính xác.
            </p>

            <v-textarea
              v-model="aiKnowledgeBase"
              rows="5"
              density="compact"
              variant="outlined"
              placeholder="Nhập thông tin sản phẩm, loại vải, tiến độ hoàn thành, chính sách cọc..."
              auto-grow
              style="font-size: 0.85rem;"
            />
          </v-card>
        </v-col>

        <!-- Card 4: Kịch bản câu hỏi & câu trả lời mẫu (Few-shot Q&A) -->
        <v-col cols="12">
          <v-card class="pa-4 rounded-xl mb-4 elevation-1">
            <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-2">
              <div class="d-flex align-center gap-2">
                <v-icon color="warning" size="20">mdi-frequently-asked-questions</v-icon>
                <span class="text-subtitle-1 font-weight-bold text-foreground">
                  3. Kịch bản câu hỏi & câu trả lời mẫu (Q&A Training)
                </span>
              </div>
              <v-btn
                size="small"
                variant="outlined"
                color="primary"
                prepend-icon="mdi-plus"
                class="text-none font-weight-medium rounded-lg"
                @click="addQAPair"
              >
                Thêm cặp câu hỏi - trả lời
              </v-btn>
            </div>

            <p class="text-caption text-muted mb-3">
              Huấn luyện AI cách phản xạ chính xác với các câu hỏi thường gặp nhất từ khách hàng:
            </p>

            <!-- Q&A Pairs List -->
            <div class="d-flex flex-column gap-2 mb-2">
              <v-card
                v-for="(qa, idx) in qaList"
                :key="idx"
                variant="outlined"
                class="pa-3 rounded-lg"
                style="background: rgba(var(--v-theme-surface), 0.5);"
              >
                <div class="d-flex align-center justify-space-between mb-2">
                  <span class="text-caption font-weight-bold text-primary">
                    #{{ idx + 1 }}. Tình huống mẫu
                  </span>
                  <v-btn
                    icon="mdi-trash-can-outline"
                    variant="text"
                    size="x-small"
                    color="error"
                    title="Xoá kịch bản này"
                    @click="removeQAPair(idx)"
                  />
                </div>

                <v-text-field
                  v-model="qa.question"
                  label="Khách hỏi:"
                  density="compact"
                  variant="outlined"
                  class="mb-2"
                  hide-details
                />

                <v-textarea
                  v-model="qa.answer"
                  label="AI trả lời mẫu:"
                  rows="2"
                  density="compact"
                  variant="outlined"
                  auto-grow
                  hide-details
                />
              </v-card>
            </div>
          </v-card>
        </v-col>

        <!-- Save Sticky Action Bar -->
        <v-col cols="12">
          <div class="d-flex align-center justify-end gap-3 py-2">
            <v-btn
              variant="outlined"
              color="primary"
              prepend-icon="mdi-play-circle-outline"
              class="text-none font-weight-bold rounded-lg px-4"
              @click="saveAndTestChat"
            >
              Lưu & Thử nghiệm trong Khung chat
            </v-btn>

            <v-btn
              color="primary"
              variant="flat"
              prepend-icon="mdi-content-save"
              :loading="saving"
              class="text-none font-weight-bold rounded-lg px-6"
              @click="saveSettings"
            >
              Lưu cấu hình Huấn luyện
            </v-btn>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- TAB 2: KHUNG CHAT THỬ NGHIỆM -->
    <div v-show="currentTab === 'chat'" class="flex-grow-1 d-flex flex-column h-100 overflow-hidden">
      <!-- Toolbar state switcher within chat view -->
      <div class="d-flex align-center justify-space-between mb-2 flex-wrap gap-2">
        <span class="text-caption text-muted">
          Thử nghiệm phản xạ của AI dựa trên tri thức đã huấn luyện:
        </span>

        <div class="d-flex align-center flex-wrap gap-1">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            class="text-none rounded-pill"
            @click="testSampleQuery('May 200 áo polo công ty thêu logo ngực')"
          >
            Áo thun Polo
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="info"
            class="text-none rounded-pill"
            @click="testSampleQuery('Lớp em cần 42 áo lớp form rộng oversize')"
          >
            Áo lớp
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="success"
            class="text-none rounded-pill"
            @click="testSampleQuery('Công ty chị cần 120 sơ mi nam nữ công sở')"
          >
            Sơ mi công sở
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="warning"
            class="text-none rounded-pill"
            @click="testSampleQuery('Cho chị đặt 30 áo bếp trưởng màu đen tay dài')"
          >
            Áo bếp
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="cyan"
            class="text-none rounded-pill"
            @click="testSampleQuery('Phòng khám chị đặt 60 bộ scrub xanh navy')"
          >
            Scrub y tế
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="deep-orange"
            class="text-none rounded-pill"
            @click="testSampleQuery('Nhà máy cần 100 bộ bảo hộ chống tĩnh điện')"
          >
            Bảo hộ LĐ
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="purple"
            class="text-none rounded-pill"
            @click="testSampleQuery('Bên chị cần 250 giftset bình giữ nhiệt ngân sách 200k/bộ')"
          >
            Quà tặng DN
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="error"
            class="text-none rounded-pill"
            @click="testSampleQuery('Đơn áo bên tôi giao thiếu 10 cái và sai size')"
          >
            Khiếu nại
          </v-btn>
        </div>
      </div>

      <!-- Embedded AiAssistantChat component -->
      <v-card class="flex-grow-1 rounded-xl d-flex flex-column overflow-hidden chat-card-frame elevation-1">
        <AiAssistantChat
          ref="chatRef"
          :starter-prompts="[
            'May 200 áo polo công ty thêu logo ngực',
            'Lớp em cần đặt 42 áo lớp polo oversize',
            'Công ty chị cần 120 sơ mi nam nữ vải bamboo',
            'Bên chị cần 250 giftset bình giữ nhiệt ngân sách 200k/bộ'
          ]"
          @send="handleUserSend"
          @stop="handleStop"
        />
      </v-card>
    </div>

    <!-- Global Toast Snackbar -->
    <v-snackbar
      v-model="toast.show"
      :color="toast.color"
      timeout="3000"
      location="top center"
    >
      {{ toast.message }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '@/api';
import AiAssistantChat from '@/components/chat/AiAssistantChat.vue';

const currentTab = ref<'train' | 'chat'>('train');
const chatRef = ref<InstanceType<typeof AiAssistantChat> | null>(null);

// AI Form Settings
const aiEnabled = ref(true);
const aiPrompt = ref('');
const aiKnowledgeBase = ref('');
const aiScheduleType = ref('24_7');
const selectedGroupValue = ref('');
const zaloGroups = ref<any[]>([]);
const saving = ref(false);

// Q&A Pairs
interface QAPair {
  question: string;
  answer: string;
}

const qaList = ref<QAPair[]>([
  {
    question: 'Dạ em đang cần may áo thun ạ',
    answer: 'Dạ mình muốn may áo thun cổ tròn hay áo polo có cổ ạ?'
  },
  {
    question: 'Lớp em cần 42 áo lớp',
    answer: 'Dạ lớp mình muốn áo cổ tròn hay áo polo ạ?'
  },
  {
    question: 'Công ty chị cần sơ mi công sở',
    answer: 'Dạ mình may sơ mi cho nam, nữ hay cả hai ạ?'
  },
  {
    question: 'Khách sạn cần may đồng phục buồng phòng',
    answer: 'Dạ mình dự kiến may khoảng bao nhiêu bộ đồng phục buồng phòng ạ?'
  },
  {
    question: 'Cho chị đặt 30 áo bếp trưởng màu đen',
    answer: 'Dạ mình muốn áo bếp trưởng tay ngắn hay tay dài ạ?'
  },
  {
    question: 'Phòng khám chị đặt 60 bộ scrub',
    answer: 'Dạ mình muốn scrub màu gì ạ?'
  },
  {
    question: 'Nhà máy cần 100 bộ bảo hộ chống tĩnh điện',
    answer: 'Dạ bên mình cần đáp ứng tiêu chuẩn chống tĩnh điện cụ thể nào ạ? Em sẽ chuyển chuyên viên xác minh trước khi phản hồi khả năng đáp ứng.'
  },
  {
    question: 'Bên chị cần quà tặng nhân viên',
    answer: 'Dạ mình đã có loại quà muốn làm hay cần em tư vấn theo ngân sách ạ?'
  },
  {
    question: 'Anh cần 20 bộ áo bếp và 30 áo phục vụ',
    answer: 'Dạ em ghi nhận 20 bộ đồng phục bếp và 30 áo phục vụ. Mình muốn tư vấn hạng mục nào trước ạ?'
  },
  {
    question: 'Đơn áo polo bên tôi giao thiếu 10 cái',
    answer: 'Dạ em xin ghi nhận tình trạng giao thiếu. Mình cho em xin mã đơn hàng để bộ phận phụ trách kiểm tra hỗ trợ ngay ạ?'
  }
]);

const scheduleOptions = [
  { label: 'Trực 24/7 (AI luôn trả lời tin nhắn mới)', value: '24_7' },
  { label: 'Ngoài giờ hành chính (AI trực đêm & cuối tuần)', value: 'off_hours' },
];

const groupItems = computed(() => {
  const list = zaloGroups.value.map(g => ({
    title: `${g.name} (Zalo: ${g.zaloAccountName})`,
    value: g.externalThreadId,
    name: g.name
  }));
  list.unshift({ title: '❌ Không gửi thông báo', value: '', name: '' });
  return list;
});

const toast = ref({
  show: false,
  message: '',
  color: 'success',
});

function showToast(message: string, color = 'success') {
  toast.value = { show: true, message, color };
}

onMounted(async () => {
  await loadAiConfig();
});

async function loadAiConfig() {
  try {
    const [resSettings, resGroups] = await Promise.all([
      api.get('/settings/ai'),
      api.get('/settings/ai/groups').catch(() => ({ data: [] }))
    ]);

    zaloGroups.value = resGroups.data || [];
    
    if (resSettings.data) {
      aiEnabled.value = resSettings.data.aiEnabled ?? true;
      aiPrompt.value = resSettings.data.aiPrompt || getDefaultPrompt();
      aiKnowledgeBase.value = resSettings.data.aiKnowledgeBase || getDefaultKB();
      selectedGroupValue.value = resSettings.data.aiAlertGroupId || '';
      
      try {
        const sched = JSON.parse(resSettings.data.aiSchedule || '{}');
        aiScheduleType.value = sched.type || '24_7';
      } catch {
        aiScheduleType.value = '24_7';
      }
    }
  } catch (err) {
    console.error('Failed to load AI config:', err);
    aiPrompt.value = getDefaultPrompt();
    aiKnowledgeBase.value = getDefaultKB();
  }
}

function getDefaultPrompt(): string {
  return `VAI TRÒ & NHIỆM VỤ:
Bạn là Trợ lý AI định tuyến và tư vấn khách hàng B2B cho xưởng sản xuất đồng phục và quà tặng doanh nghiệp.
Bạn KHÔNG phải bộ chào hỏi: phần mềm CRM đã có automation chào hỏi độc lập.

QUY TẮC PHẢN HỒI:
1. Xưng hô: Luôn xưng là "em" và gọi khách là "anh/chị". Tuyệt đối không xưng là bot/robot hay nhắc tên thương hiệu lạ.
2. Ngắn gọn, súc tích (1 - 3 câu), ưu tiên ĐÚNG MỘT CÂU HỎI CHÍNH ở mỗi lượt để khách dễ trả lời.
3. Không tự chào lần 2 nếu khách đã vào mạch trao đổi hoặc đã được chào trước đó.
4. Đọc kỹ ngữ cảnh: Không hỏi lại những thông tin khách đã cung cấp (kiểu áo, số lượng, chất liệu, logo, ngày nhận).
5. Phủ định: Nếu khách nói "không phải polo, làm cổ tròn" -> lập tức loại bỏ polo và ghi nhận cổ tròn.

THỨ TỰ ƯU TIÊN XỬ LÝ (INTENTS):
1. KHIEU_NAI (Hàng lỗi, giao thiếu, sai size): Tiếp nhận nhẹ nhàng, xin mã đơn/bằng chứng ảnh để chuyển bộ phận giải quyết, tuyệt đối không chèo kéo bán hàng mới.
2. YEU_CAU_NHAN_VIEN (Đòi gặp sale, người thật): Lịch sự xác nhận chuyển thông tin cho chuyên viên liên hệ ngay.
3. THEO_DOI_DON (Hỏi đơn cũ): Xin mã đơn hàng để đối soát thông tin.
4. KET_THUC / TU_CHOI: Cảm ơn lịch sự, dừng tư vấn, không tiếp tục spam khách.
5. HOI_GIA / DAT_HANG: TUYỆT ĐỐI KHÔNG TỰ BỊA GIÁ, không tự bịa chiết khấu hay phí ship. Thu thập đủ kiểu dáng, số lượng, in/thêu để báo phòng kinh doanh gửi báo giá chính xác nhất.

THỨ TỰ HỎI THEO 8 NGÀNH HÀNG:
- Đồng phục áo thun (DH_AO_THUN): Loại áo (cổ tròn hay polo có cổ) -> Số lượng -> Chất liệu -> In/thêu logo -> Ngày cần nhận -> Size/Địa điểm.
- Nhóm - Lớp (DH_NHOM_LOP): Mục đích (lớp, nhóm, teambuilding) -> Kiểu áo -> Số lượng -> Thiết kế in -> Ngày cần nhận -> Size.
- Công sở (DH_CONG_SO): Hạng mục (sơ mi, vest, quần tây, chân váy, gile) -> Đối tượng (nam/nữ) -> Số lượng -> Kiểu dáng -> Chất liệu/Logo -> Ngày nhận.
- Nhà hàng - Khách sạn (DH_NHA_HANG_KS): Bộ phận (phục vụ, lễ tân, buồng phòng, cafe, bar, resort) -> Hạng mục đồ -> Số lượng -> Màu sắc/Logo -> Ngày nhận.
- Đồng phục bếp (DH_BEP): Hạng mục (áo bếp, quần, tạp dề, nón) -> Số lượng -> Dáng áo (ngắn/dài tay) -> Chất liệu -> Logo/Màu -> Ngày nhận.
- Y tế (DH_Y_TE): Hạng mục (blouse hay scrub) -> Bộ phận/Khoa -> Số lượng -> Màu sắc/Chất liệu -> Logo -> Ngày nhận.
- Bảo hộ lao động (BAO_HO_LD): Môi trường/Tiêu chuẩn an toàn -> Hạng mục -> Số lượng -> Chất liệu/Tính năng -> Logo -> Ngày nhận.
- Quà tặng doanh nghiệp (QUA_TANG_DN): Loại quà (bình giữ nhiệt, ly sứ, bút, sổ, túi canvas, giftset...) -> Mục đích -> Số lượng -> Ngân sách/phần -> Logo -> Ngày nhận.

BẢNG XỬ LÝ XUNG ĐỘT (AMBIGUITIES):
- "áo lớp polo" -> Xếp vào Nhóm-lớp.
- "áo polo quán cafe" / "áo sơ mi lễ tân" -> Xếp vào Nhà hàng - Khách sạn.
- "áo bếp nhà hàng" / "tạp dề đầu bếp" -> Xếp vào Bếp.
- "tạp dề", "nón", "đồng phục" đứng đơn lẻ chưa rõ -> Hỏi làm rõ nhu cầu sử dụng cho bộ phận nào.
- Yêu cầu tiêu chuẩn an toàn / chống tĩnh điện / phòng mổ: Tiếp nhận tiêu chuẩn kỹ thuật để chuyển bộ phận chuyên môn, không tự cam kết chứng chỉ.`;
}

function getDefaultKB(): string {
  return `CƠ SỞ TRI THỨC 8 NGÀNH HÀNG ĐỒNG PHỤC & QUÀ TẶNG B2B:

1. ĐỒNG PHỤC ÁO THUN (DH_AO_THUN):
- Kiểu dáng: Áo polo (cổ trụ, cổ bẻ), áo cổ tròn (t-shirt), áo cổ tim, áo tay dài, áo sự kiện.
- Vải may polo: Cá sấu cotton 100%, cá sấu poly 4 chiều, poly Thái cao cấp, cá sấu mè, cá sấu kim cương.
- Vải may cổ tròn: Cotton 100% 4 chiều, cotton 65/35, thun mè thể thao, thun lạnh co giãn.
- Kỹ thuật logo: Thêu vi tính ngực trái/sau lưng, in lụa, in pet chuyển nhiệt sắc nét, in decal ép nhiệt.

2. ĐỒNG PHỤC NHÓM - LỚP (DH_NHOM_LOP):
- Kiểu dáng: Áo lớp form rộng oversize, tay lỡ, polo lớp phối bo cổ dệt, áo đi biển họa tiết, áo teambuilding.
- Hỗ trợ: Miễn phí lên mẫu thiết kế 3D, hỗ trợ chỉnh sửa market không giới hạn.
- Cá nhân hóa: Hỗ trợ in tên riêng, số áo hoặc slogan độc quyền từng thành viên.

3. ĐỒNG PHỤC CÔNG SỞ (DH_CONG_SO):
- Hạng mục: Áo sơ mi nam/nữ (dài tay/ngắn tay), bộ vest, áo blazer, quần tây/quần âu, chân váy bút chì/chữ A, áo gile.
- Chất liệu sơ mi: Vải kate Ý, kate Mỹ, bamboo sợi tre kháng khuẩn, lụa co giãn chống nhăn.
- Chất liệu vest & quần: Vải tuyết mưa, wool pha cao cấp, cashmere giữ form đứng dáng.

4. ĐỒNG PHỤC NHÀ HÀNG - KHÁCH SẠN (DH_NHA_HANG_KS):
- Bộ phận: Phục vụ bàn, lễ tân (receptionist), buồng phòng (housekeeping), pha chế (barista/bartender), tạp dề quán cafe, đồng phục resort.
- Màu sắc: Phối màu theo đúng hệ thống nhận diện thương hiệu hoặc màu phong thủy nhà hàng.

5. ĐỒNG PHỤC BẾP (DH_BEP):
- Hạng mục: Áo bếp trưởng, áo bếp phó, áo phụ bếp (tay ngắn/tay dài, khuy bấm hoặc cài chéo), quần bếp kẻ/đen, tạp dề bếp, nón chef/nón bánh.
- Chất liệu: Vải kaki dày dặn, kaki cotton chịu nhiệt tốt, chống bám dầu mỡ và dễ giặt tẩy.

6. ĐỒNG PHỤC Y TẾ (DH_Y_TE):
- Hạng mục: Áo blouse trắng bác sĩ/dược sĩ (dài/ngắn), bộ scrub phẫu thuật, đồng phục điều dưỡng/y tá, đồng phục nha khoa, phòng khám đa khoa, xét nghiệm.
- Chất liệu: Vải lon Mỹ, kate for, thun cotton y tế co giãn thoáng mát, thấm hút mồ hôi.

7. BẢO HỘ LAO ĐỘNG (BAO_HO_LD):
- Hạng mục: Quần áo công nhân sản xuất, đồng phục kỹ sư/kỹ thuật, áo gile phản quang, áo khoác bảo hộ, đồ thợ hàn, đồ xưởng cơ khí, giày/nón/găng tay PPE.
- Chất liệu & tính năng: Vải kaki Pangrim Hàn Quốc, kaki Nam Định, kaki chống cháy nhẹ, sợi phản quang đạt chuẩn ban đêm.

8. QUÀ TẶNG DOANH NGHIỆP (QUA_TANG_DN):
- Danh mục: Bình giữ nhiệt inox in/khắc logo, ly sứ in logo, bút bi quảng cáo, bút ký kim loại cao cấp, sổ tay bìa da, túi vải canvas/tote, nón kết, ô dù cầm tay gấp gọn, móc khóa, giftset hộp quà combo sang trọng.
- Ngân sách: Tư vấn linh hoạt theo mức ngân sách từ bình dân (20k - 50k) đến cao cấp (200k - 1.000k/phần).

CHÍNH SÁCH VẬN HÀNH & NĂNG LỰC:
- Nhận đơn từ 10 sản phẩm đến 50.000 sản phẩm.
- Thời gian sản xuất tiêu chuẩn: 3 - 5 ngày làm việc. Có hỗ trợ nhận đơn may gấp theo thỏa thuận.
- Quy trình: Tư vấn nhu cầu -> Lên market 3D duyệt mẫu -> Đặt cọc 50% -> Sản xuất -> Giao hàng toàn quốc & thanh toán phần còn lại.`;
}

function applyPromptTemplate(type: 'b2b_routing' | 'garment' | 'gifts' | 'cskh') {
  if (type === 'b2b_routing') {
    aiPrompt.value = getDefaultPrompt();
    showToast('Đã áp dụng mẫu: Định tuyến B2B 8 Ngành (Khuyên dùng)');
  } else if (type === 'garment') {
    aiPrompt.value = `Bạn là Trợ lý AI chuyên trách Đồng phục & Xưởng may mặc.
Nhiệm vụ: Chào đón khách hàng, lắng nghe nhu cầu may áo thun, sơ mi, áo khoác, bảo hộ.
Quy tắc:
- Xưng hô "em" và "anh/chị", tác phong chuyên nghiệp, nhanh nhẹn.
- Thu thập: loại sản phẩm, số lượng, logo, ngày cần nhận. Tuyệt đối không tự ý báo giá cụ thể.`;
    showToast('Đã áp dụng mẫu: Xưởng may & Đồng phục');
  } else if (type === 'gifts') {
    aiPrompt.value = `Bạn là Trợ lý Tư vấn Quà tặng Doanh nghiệp & Event B2B.
Nhiệm vụ: Khai thác nhu cầu làm quà tặng đối tác, khách hàng, nhân viên (bình giữ nhiệt, ly sứ, sổ tay, giftset).
Quy tắc:
- Hỏi rõ số lượng dự kiến và mức ngân sách/phần quà (ví dụ 50k, 100k, 250k...) để tư vấn set phù hợp.
- Nhắc khách gửi file logo để lên mẫu demo miễn phí.`;
    showToast('Đã áp dụng mẫu: Quà tặng doanh nghiệp');
  } else {
    aiPrompt.value = `Bạn là Trợ lý Chăm sóc Khách hàng chuyên nghiệp.
Nhiệm vụ: Tiếp nhận phản hồi, lắng nghe câu hỏi hỗ trợ đơn hàng và xoa dịu khách hàng kịp thời.
Nguyên tắc:
- Lịch sự, ân cần, luôn cảm ơn và xin lỗi chân thành nếu khách chưa hài lòng.
- Nhanh chóng xin mã đơn hàng và số điện thoại để báo quản lý xử lý ngay trong 15 phút.`;
    showToast('Đã áp dụng mẫu: CSKH & Khiếu nại');
  }
}

function appendSampleKnowledge() {
  aiKnowledgeBase.value += `\n\nBẢNG THÔNG SỐ CHỌN SIZE ÁO CHUẨN:
- Size S: 45 - 53kg, cao 1m50 - 1m60
- Size M: 54 - 62kg, cao 1m60 - 1m68
- Size L: 63 - 70kg, cao 1m68 - 1m75
- Size XL: 71 - 78kg, cao 1m75 - 1m80
- Size XXL: Trên 78kg (có hỗ trợ may 3XL, 4XL theo yêu cầu)`;
  showToast('Đã bổ sung bảng thông số size áo vào Tri thức');
}

function addQAPair() {
  qaList.value.push({ question: '', answer: '' });
}

function removeQAPair(index: number) {
  qaList.value.splice(index, 1);
}

function onGroupSelected(val: string) {
  selectedGroupValue.value = val;
}

// Compile full knowledge base with Q&A pairs for the AI model
function compileFullKnowledge(): string {
  let fullKB = aiKnowledgeBase.value.trim();
  const validQAs = qaList.value.filter(qa => qa.question.trim() && qa.answer.trim());
  
  if (validQAs.length > 0) {
    fullKB += '\n\nCÁC CÂU HỎI THƯỜNG GẶP VÀ CÂU TRẢ LỜI MẪU:\n';
    validQAs.forEach((qa, idx) => {
      fullKB += `[Q${idx + 1}]: ${qa.question.trim()}\n[A${idx + 1}]: ${qa.answer.trim()}\n\n`;
    });
  }
  return fullKB;
}

async function saveSettings() {
  saving.value = true;
  try {
    const compiledKB = compileFullKnowledge();
    const schedulePayload = JSON.stringify({
      type: aiScheduleType.value,
      customRanges: []
    });

    await api.post('/settings/ai', {
      aiEnabled: aiEnabled.value,
      aiPrompt: aiPrompt.value,
      aiKnowledgeBase: compiledKB,
      aiSchedule: schedulePayload,
      aiAlertGroupId: selectedGroupValue.value || '',
      aiAlertGroupName: groupItems.value.find(g => g.value === selectedGroupValue.value)?.name || '',
    });

    showToast('Đã lưu và cập nhật huấn luyện Trợ lý AI thành công!');
  } catch (err: any) {
    console.error('Save AI failed:', err);
    showToast(err.response?.data?.error || 'Lưu cấu hình AI thất bại', 'error');
  } finally {
    saving.value = false;
  }
}

async function saveAndTestChat() {
  await saveSettings();
  currentTab.value = 'chat';
}

function testSampleQuery(query: string) {
  chatRef.value?.triggerStreaming(query);
}

function handleUserSend(_text: string) {
  // Callback when user types in test chat
}

function handleStop() {
  // Callback on stop
}
</script>

<style scoped>
.ai-assistant-page {
  height: calc(100vh - 100px);
  min-height: 560px;
}

.chat-card-frame {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  background: rgba(var(--v-theme-surface), 0.7) !important;
}

.font-mono {
  font-family: monospace, Consolas, 'Courier New';
}
</style>
