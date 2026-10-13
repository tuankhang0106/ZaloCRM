<template>
  <div class="ai-chat-container d-flex flex-column h-100 w-100">
    <!-- Messages Scroll Area -->
    <div
      ref="scrollAreaRef"
      class="ai-chat-messages-scroll flex-grow-1 px-4 py-6"
      @scroll="handleScroll"
    >
      <div class="ai-chat-column mx-auto d-flex flex-column" style="max-width: 768px; gap: 28px;">
        
        <!-- Render Messages -->
        <template v-for="(item, idx) in messages" :key="item.id || idx">
          
          <!-- 1. USER MESSAGE: Right aligned bubble, no avatar, rounded-3xl, whitespace-pre-wrap -->
          <div
            v-if="item.role === 'user'"
            class="user-msg-bubble ml-auto"
          >
            {{ item.content }}
          </div>

          <!-- 2. ASSISTANT MESSAGE: Left aligned, NO bubble, NO avatar, max-w-[55ch] -->
          <div
            v-else-if="item.role === 'assistant'"
            class="assistant-msg-block d-flex flex-column"
            style="max-width: 55ch; gap: 12px;"
          >
            <!-- 2a. Collapsible Tool Call Steps (if any) -->
            <div v-if="item.toolCalls && item.toolCalls.length > 0" class="tool-steps-container">
              <!-- Header trigger button: flush with left margin, text-sm text-muted -->
              <button
                type="button"
                class="tool-header-btn d-flex align-center gap-2"
                :aria-expanded="item.isToolsExpanded ? 'true' : 'false'"
                @click="toggleTools(item)"
              >
                <!-- Initial icon: spinner if running without steps, or chevron -->
                <v-icon
                  v-if="item.isStreaming && (!item.toolCalls || item.toolCalls.length === 0)"
                  icon="mdi-loading"
                  size="16"
                  class="animate-spin text-muted"
                />
                <v-icon
                  v-else
                  :icon="item.isToolsExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                  size="16"
                  class="tool-chevron text-muted"
                />

                <span class="text-sm text-muted font-weight-medium">
                  {{ getToolHeaderTitle(item) }}
                </span>
              </button>

              <!-- Collapsible Tool Steps List with vertical stem aligned to chevron -->
              <v-expand-transition>
                <div v-show="item.isToolsExpanded" class="tool-list-stem ml-2 pl-4 mt-2 d-flex flex-column" style="gap: 10px;">
                  <div
                    v-for="(tool, tIdx) in item.toolCalls"
                    :key="tIdx"
                    class="d-flex align-start gap-2"
                  >
                    <!-- Tool Status Icon: Grey check for done, spinner for running, red alert for error -->
                    <div class="tool-status-icon-wrapper pt-0.5">
                      <v-icon
                        v-if="tool.status === 'done'"
                        icon="mdi-check"
                        size="15"
                        class="text-muted"
                      />
                      <v-progress-circular
                        v-else-if="tool.status === 'running'"
                        indeterminate
                        size="14"
                        width="2"
                        color="grey"
                      />
                      <v-icon
                        v-else-if="tool.status === 'error'"
                        icon="mdi-alert-circle-outline"
                        size="15"
                        color="error"
                      />
                    </div>

                    <!-- Tool Text: Title text-foreground, Description text-xs text-muted -->
                    <div class="min-width-0 flex-grow-1">
                      <p class="text-sm text-foreground font-weight-medium mb-0" style="line-height: 1.35;">
                        {{ tool.name }}
                      </p>
                      <p v-if="tool.description" class="text-xs text-muted mb-0 mt-0.5" style="line-height: 1.35;">
                        {{ tool.description }}
                      </p>
                    </div>
                  </div>
                </div>
              </v-expand-transition>
            </div>

            <!-- 2b. Assistant Text Content (with inline cursor when streaming) -->
            <div class="assistant-text text-base text-foreground text-pretty">
              <span>{{ item.content }}</span>
              <!-- Streaming cursor block: subtle, inline, non-blinking -->
              <span
                v-if="item.isStreaming"
                class="streaming-cursor"
                aria-hidden="true"
              />
            </div>

            <!-- 2c. Error Fallback State: "Trợ lý chưa trả lời được" + Retry -->
            <div v-if="item.isError" class="assistant-error-box mt-1 d-flex flex-column align-start gap-1">
              <span class="text-sm font-weight-medium text-error d-flex align-center gap-1">
                <v-icon icon="mdi-alert-circle-outline" size="16" color="error" />
                Trợ lý chưa trả lời được
              </span>
              <span class="text-xs text-muted mb-2">
                {{ item.errorMessage || 'Đã xảy ra sự cố kết nối hoặc vượt quá giới hạn truy vấn.' }}
              </span>
              <button
                type="button"
                class="retry-btn d-flex align-center gap-1.5 px-2.5 py-1 rounded-lg text-sm text-foreground"
                @click="onRetry(item, idx)"
              >
                <v-icon icon="mdi-refresh" size="14" />
                Thử lại
              </button>
            </div>

            <!-- 2d. Bottom Action Row (Copy, Regenerate, "Đã dừng giữa chừng") -->
            <div
              v-if="!item.isStreaming && !item.isError && item.content"
              class="assistant-action-row d-flex align-center -ml-2"
              style="gap: 2px;"
            >
              <!-- Copy button -->
              <v-tooltip text="Sao chép câu trả lời" location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-content-copy"
                    variant="text"
                    size="x-small"
                    class="action-ghost-btn text-muted"
                    @click="copyContent(item.content)"
                  />
                </template>
              </v-tooltip>

              <!-- Regenerate button -->
              <v-tooltip text="Tạo lại câu trả lời" location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-refresh"
                    variant="text"
                    size="x-small"
                    class="action-ghost-btn text-muted"
                    @click="onRegenerate(idx)"
                  />
                </template>
              </v-tooltip>

              <!-- Stopped in progress label -->
              <span v-if="item.wasStopped" class="text-xs text-muted ml-2">
                Đã dừng giữa chừng
              </span>
            </div>

            <!-- 2e. Follow-up Suggestions (Only under final completed response) -->
            <div
              v-if="idx === messages.length - 1 && !item.isStreaming && item.suggestions && item.suggestions.length > 0"
              class="followup-suggestions-block mt-2 d-flex flex-column"
              style="gap: 8px;"
            >
              <p class="text-sm text-muted font-weight-medium mb-0">Hỏi tiếp</p>
              <button
                v-for="(sug, sIdx) in item.suggestions"
                :key="sIdx"
                type="button"
                class="suggestion-btn text-left text-sm text-foreground rounded-xl px-3 py-2"
                @click="selectSuggestion(sug)"
              >
                {{ sug }}
              </button>
            </div>

          </div>
        </template>

      </div>
    </div>

    <!-- Scroll-to-bottom Floating Button (if user scrolled up during stream) -->
    <v-fade-transition>
      <div v-if="showScrollBottomBtn" class="scroll-bottom-wrapper text-center mb-1">
        <v-btn
          icon="mdi-arrow-down"
          size="small"
          variant="elevated"
          color="surface"
          class="scroll-bottom-btn elevation-2"
          @click="scrollToBottomSmooth"
        />
      </div>
    </v-fade-transition>

    <!-- Bottom Input Area: Sticky at bottom, contains Initial Prompts (if empty) + Pill Form -->
    <div class="ai-chat-bottom-area px-4 pb-4 pt-1">
      <div class="ai-chat-column mx-auto" style="max-width: 768px;">
        
        <!-- 3. EMPTY STATE: "Thử hỏi" Starter Suggestions above input -->
        <div
          v-if="messages.length === 0"
          class="empty-starters-block mb-3 d-flex flex-column"
          style="gap: 8px;"
        >
          <p class="text-sm text-muted font-weight-medium mb-0">Thử hỏi</p>
          <div class="d-flex flex-column" style="gap: 6px;">
            <button
              v-for="(starter, idx) in starterQuestions"
              :key="idx"
              type="button"
              class="suggestion-btn text-left text-sm text-foreground rounded-xl px-3 py-2"
              @click="selectSuggestion(starter)"
            >
              {{ starter }}
            </button>
          </div>
        </div>

        <!-- 4. INPUT PILL: Nested borders, auto-growing textarea, submit / stop button -->
        <form
          class="ai-input-pill d-flex align-end gap-2"
          @submit.prevent="handleSubmit"
        >
          <textarea
            ref="textareaRef"
            v-model="inputPrompt"
            rows="1"
            class="ai-input-textarea flex-grow-1"
            placeholder="Hỏi về đơn hàng, doanh thu..."
            :aria-label="'Soạn tin nhắn cho trợ lý AI'"
            @keydown="handleKeydown"
            @input="autoResizeTextarea"
          />

          <!-- Action Button: Send ArrowUp when idle; Stop Square when streaming -->
          <button
            type="submit"
            class="ai-send-btn d-grid"
            :class="{ 'ai-send-btn-disabled': !canSend && !isStreamingActive }"
            :disabled="!canSend && !isStreamingActive"
            :aria-label="isStreamingActive ? 'Dừng trả lời' : 'Gửi tin nhắn'"
            @click.prevent="isStreamingActive ? handleStopStreaming() : handleSubmit()"
          >
            <!-- Square stop icon when streaming -->
            <v-icon
              v-if="isStreamingActive"
              icon="mdi-stop"
              size="18"
              class="text-on-primary"
            />
            <!-- Arrow Up when idle -->
            <v-icon
              v-else
              icon="mdi-arrow-up"
              size="18"
              class="text-on-primary"
            />
          </button>
        </form>

        <div class="text-center mt-1">
          <span class="text-muted" style="font-size: 0.7rem;">
            Nhấn Enter để gửi &bull; Shift + Enter để xuống dòng
          </span>
        </div>

      </div>
    </div>

    <!-- Notification Toast -->
    <v-snackbar
      v-model="toast.show"
      :color="toast.color"
      timeout="2500"
      location="top center"
      density="compact"
    >
      {{ toast.message }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';

export interface ToolStep {
  name: string;
  description?: string;
  status: 'running' | 'done' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  wasStopped?: boolean;
  isError?: boolean;
  errorMessage?: string;
  toolCalls?: ToolStep[];
  isToolsExpanded?: boolean;
  suggestions?: string[];
}

const props = withDefaults(
  defineProps<{
    initialMessages?: ChatMessage[];
    starterPrompts?: string[];
  }>(),
  {
    initialMessages: () => [],
    starterPrompts: () => [
      'Bên em có nhận may 50 áo polo thêu logo không?',
      'Lớp em cần đặt 42 áo lớp oversize có thiết kế riêng',
      'Công ty chị cần may 120 sơ mi nam nữ công sở'
    ],
  }
);

const emit = defineEmits<{
  (e: 'send', content: string): void;
  (e: 'stop'): void;
  (e: 'regenerate', index: number): void;
  (e: 'retry', message: ChatMessage): void;
}>();

// Messages reactive state
const messages = ref<ChatMessage[]>([]);
const inputPrompt = ref('');
const isStreamingActive = ref(false);
const showScrollBottomBtn = ref(false);
const scrollAreaRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// Toast feedback
const toast = ref({
  show: false,
  message: '',
  color: 'success',
});

// Starter suggestions
const starterQuestions = computed(() => props.starterPrompts);

// Can send condition
const canSend = computed(() => inputPrompt.value.trim().length > 0);

// Initialize with props or sample state
onMounted(() => {
  if (props.initialMessages && props.initialMessages.length > 0) {
    messages.value = JSON.parse(JSON.stringify(props.initialMessages));
  } else {
    // Provide a default polished interactive conversation demonstrating all required states
    loadDefaultDemoMessages();
  }
  nextTick(() => {
    scrollToBottom();
  });
});

function loadDefaultDemoMessages() {
  messages.value = [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Bên em có nhận may 50 áo polo đồng phục công ty thêu logo không?',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'Dạ bên em nhận may từ 10 áo thun polo đồng phục ạ! Với số lượng 50 áo, bên em hỗ trợ lên market thiết kế 3D miễn phí và thêu vi tính logo sắc nét. Mình dự kiến may phối màu theo nhận diện công ty và cần nhận hàng vào ngày nào ạ?',
      isStreaming: false,
      isToolsExpanded: false,
      toolCalls: [
        {
          name: 'Định tuyến ngành hàng B2B',
          description: 'Nhận diện: DH_AO_THUN, số lượng: 50 áo, kỹ thuật: thêu vi tính logo',
          status: 'done',
        },
        {
          name: 'Đối soát cơ sở tri thức & Quy chuẩn',
          description: 'Kiểm tra vải cá sấu mè / poly Thái / cotton, hỗ trợ market 3D miễn phí',
          status: 'done',
        },
        {
          name: 'Kiểm tra Slot khai thác tiếp theo',
          description: 'Hỏi màu sắc nhận diện & ngày cần nhận hàng theo thứ tự chuẩn',
          status: 'done',
        },
      ],
      suggestions: [
        'Bên mình cần chất liệu vải cá sấu mè hay cotton 100%?',
        'Bên em có gửi mẫu vải tận nơi để chọn màu không?',
        'Thời gian may bao lâu thì hoàn thành và giao hàng?'
      ],
    },
  ];
}

// Tool call header summary text
function getToolHeaderTitle(item: ChatMessage): string {
  const tools = item.toolCalls || [];
  const errorCount = tools.filter(t => t.status === 'error').length;
  const runningCount = tools.filter(t => t.status === 'running').length;

  if (item.isStreaming && runningCount > 0) {
    return `Đang dùng ${tools.length} công cụ`;
  }
  if (errorCount > 0) {
    return `Đã dùng ${tools.length} công cụ, ${errorCount} lỗi`;
  }
  return `Đã dùng ${tools.length} công cụ`;
}

// Toggle tool calls list
function toggleTools(item: ChatMessage) {
  item.isToolsExpanded = !item.isToolsExpanded;
}

// Handle Auto-Resize of Textarea
function autoResizeTextarea() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// Handle Keydown: Enter = submit, Shift+Enter = newline
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (canSend.value && !isStreamingActive.value) {
      handleSubmit();
    }
  }
}

// Scroll handling
function handleScroll() {
  const el = scrollAreaRef.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  showScrollBottomBtn.value = distanceFromBottom > 150;
}

function scrollToBottom() {
  const el = scrollAreaRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function scrollToBottomSmooth() {
  const el = scrollAreaRef.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

// Submission logic
function handleSubmit() {
  const text = inputPrompt.value.trim();
  if (!text || isStreamingActive.value) return;

  // Add user message
  messages.value.push({
    id: 'user-' + Date.now(),
    role: 'user',
    content: text,
  });

  inputPrompt.value = '';
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
  }

  nextTick(() => {
    scrollToBottomSmooth();
  });

  emit('send', text);

  // Trigger simulated streaming response with tool steps
  simulateAssistantResponse(text);
}

// Suggestion click
function selectSuggestion(suggestion: string) {
  inputPrompt.value = suggestion;
  autoResizeTextarea();
  if (textareaRef.value) {
    textareaRef.value.focus();
  }
  handleSubmit();
}

// Simulated streaming runner
let streamInterval: any = null;

async function simulateAssistantResponse(query: string) {
  isStreamingActive.value = true;

  // Prepare assistant message
  const assistantMsg: ChatMessage = {
    id: 'asst-' + Date.now(),
    role: 'assistant',
    content: '',
    isStreaming: true,
    isToolsExpanded: false,
    toolCalls: [
      {
        name: 'Định tuyến ngành hàng B2B',
        description: `Bóc tách từ khoá và nhận diện danh mục cho "${query.slice(0, 32)}..."`,
        status: 'running',
      },
      {
        name: 'Đối soát cơ sở tri thức & Quy tắc',
        description: 'Kiểm tra năng lực xưởng, chất liệu, tiến độ và slot cần hỏi tiếp',
        status: 'running',
      },
    ],
    suggestions: [],
  };

  messages.value.push(assistantMsg);
  nextTick(() => scrollToBottomSmooth());

  try {
    const res = await api.post('/settings/ai/test', { message: query });
    const replyText = res.data?.replyText || 'Dạ em đã ghi nhận thông tin của mình ạ.';
    const suggestions = res.data?.suggestions || [];
    const toolCalls = res.data?.toolCalls || [
      { name: 'Định tuyến ngành hàng B2B', description: 'Đã hoàn tất phân loại', status: 'done' },
      { name: 'Cơ sở tri thức & Quy chuẩn', description: 'Đã hoàn tất kiểm tra quy tắc', status: 'done' }
    ];

    if (!isStreamingActive.value) return;

    // Finish tool calls
    assistantMsg.toolCalls = toolCalls.map((t: any) => ({ ...t, status: 'done' }));

    // Stream answer tokens smoothly
    const words = replyText.split(' ');
    let currentWordIdx = 0;

    streamInterval = setInterval(() => {
      if (!isStreamingActive.value) {
        clearInterval(streamInterval);
        return;
      }

      if (currentWordIdx < words.length) {
        assistantMsg.content += (currentWordIdx > 0 ? ' ' : '') + words[currentWordIdx];
        currentWordIdx++;
        scrollToBottom();
      } else {
        clearInterval(streamInterval);
        assistantMsg.isStreaming = false;
        assistantMsg.suggestions = suggestions;
        isStreamingActive.value = false;
        nextTick(() => scrollToBottomSmooth());
      }
    }, 35);
  } catch (err: any) {
    if (!isStreamingActive.value) return;
    if (assistantMsg.toolCalls) {
      assistantMsg.toolCalls[0].status = 'done';
      assistantMsg.toolCalls[1].status = 'done';
    }
    const fallbackAnswer = 'Dạ em ghi nhận yêu cầu của mình. Anh/chị cho em xin số lượng dự kiến và ngày cần nhận để xưởng tư vấn chi tiết ạ!';
    const words = fallbackAnswer.split(' ');
    let currentWordIdx = 0;
    streamInterval = setInterval(() => {
      if (!isStreamingActive.value) {
        clearInterval(streamInterval);
        return;
      }
      if (currentWordIdx < words.length) {
        assistantMsg.content += (currentWordIdx > 0 ? ' ' : '') + words[currentWordIdx];
        currentWordIdx++;
        scrollToBottom();
      } else {
        clearInterval(streamInterval);
        assistantMsg.isStreaming = false;
        assistantMsg.suggestions = [
          'Báo giá 100 áo thun polo đồng phục',
          'Thời gian may bao lâu thì hoàn thành?',
          'Có hỗ trợ lên mẫu thiết kế 3D không?'
        ];
        isStreamingActive.value = false;
        nextTick(() => scrollToBottomSmooth());
      }
    }, 35);
  }
}

// Handle User Stopping Streaming
function handleStopStreaming() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
  isStreamingActive.value = false;

  const lastMsg = messages.value[messages.value.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.isStreaming = false;
    lastMsg.wasStopped = true;
    if (lastMsg.toolCalls) {
      lastMsg.toolCalls.forEach(t => {
        if (t.status === 'running') t.status = 'done';
      });
    }
    lastMsg.suggestions = [
      'Tiếp tục trả lời nội dung vừa dừng',
      'Chuyển sang câu hỏi khác'
    ];
  }

  emit('stop');
  showToast('Đã dừng tạo câu trả lời', 'info');
}

// Copy content
function copyContent(text: string) {
  if (navigator?.clipboard) {
    navigator.clipboard.writeText(text);
  }
  showToast('Đã sao chép vào bộ nhớ tạm', 'success');
}

// Regenerate answer
function onRegenerate(index: number) {
  const prevUserMsg = messages.value[index - 1];
  const query = prevUserMsg?.role === 'user' ? prevUserMsg.content : 'Tạo lại câu trả lời';
  
  // Remove current assistant message and re-run
  messages.value.splice(index, 1);
  emit('regenerate', index);
  simulateAssistantResponse(query);
}

// Retry failed answer
function onRetry(msg: ChatMessage, _index?: number) {
  msg.isError = false;
  msg.content = '';
  emit('retry', msg);
  simulateAssistantResponse('Thử lại truy vấn');
}

function showToast(msg: string, color = 'success') {
  toast.value = {
    show: true,
    message: msg,
    color,
  };
}

// Export methods for external testing / state setting
defineExpose({
  setMessages: (newMsgs: ChatMessage[]) => {
    messages.value = JSON.parse(JSON.stringify(newMsgs));
  },
  triggerStreaming: (query: string) => {
    inputPrompt.value = query;
    handleSubmit();
  },
  resetToEmpty: () => {
    messages.value = [];
  },
});

onUnmounted(() => {
  if (streamInterval) clearInterval(streamInterval);
});
</script>

<style scoped>
/* 1. Main Container & Scroller */
.ai-chat-container {
  position: relative;
  background: transparent;
  min-height: 480px;
}

.ai-chat-messages-scroll {
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* 2. User Message Bubble (Right aligned, rounded-3xl, bg-surface or background-contrasted) */
.user-msg-bubble {
  max-width: 80%;
  border-radius: 24px;
  background-color: rgba(var(--v-theme-surface), 0.95);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: rgb(var(--v-theme-on-surface));
  padding: 10px 18px;
  font-size: 1rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

@media (max-width: 600px) {
  .user-msg-bubble {
    max-width: 85%;
    font-size: 0.94rem;
  }
}

/* 3. Assistant Message Block (Flush Left, NO bubble, NO avatar) */
.assistant-msg-block {
  align-self: flex-start;
  width: 100%;
}

.assistant-text {
  font-size: 1rem;
  line-height: 1.6;
  letter-spacing: 0.01em;
  word-break: break-word;
}

/* 4. Streaming Cursor: inline block, non-blinking, subtle */
.streaming-cursor {
  display: inline-block;
  width: 7px;
  height: 1.15em;
  border-radius: 2px;
  background-color: rgba(var(--v-theme-on-surface), 0.35);
  vertical-align: text-bottom;
  margin-left: 4px;
}

/* 5. Tool Calls Collapsible Section */
.tool-header-btn {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  height: 30px;
  border-radius: 6px;
  outline: none;
  transition: color 0.15s ease;
}

.tool-header-btn:hover span {
  color: rgb(var(--v-theme-on-surface)) !important;
}

.tool-chevron {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.tool-list-stem {
  border-left: 1.5px solid rgba(var(--v-border-color), 0.3);
}

.tool-status-icon-wrapper {
  width: 18px;
  display: flex;
  justify-content: center;
}

/* 6. Action Row (-ml-2 compensation for button padding) */
.action-ghost-btn {
  opacity: 0.7;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.action-ghost-btn:hover {
  opacity: 1;
  background-color: rgba(var(--v-theme-on-surface), 0.06) !important;
}

/* 7. Suggestions (Outline buttons, single line, max ~45 chars) */
.suggestion-btn {
  display: block;
  width: fit-content;
  max-width: 100%;
  background: rgba(var(--v-theme-surface), 0.7);
  border: 1px solid rgba(var(--v-border-color), 0.25);
  cursor: pointer;
  outline: none;
  line-height: 1.4;
  transition: all 0.18s ease;
}

.suggestion-btn:hover {
  background: rgba(var(--v-theme-surface-variant), 0.8);
  border-color: rgba(var(--v-theme-primary), 0.4);
  transform: translateX(2px);
}

/* 8. Input Pill & Form (Nested rounding: 24px outer = 16px inner + 8px pad) */
.ai-input-pill {
  border-radius: 24px;
  border: 1.5px solid rgba(var(--v-border-color), 0.25);
  background: rgba(var(--v-theme-surface), 0.95);
  padding: 8px;
  backdrop-filter: blur(12px);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.ai-input-pill:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.12);
}

.ai-input-textarea {
  min-height: 40px;
  max-height: 160px;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  padding: 8px 12px;
  font-size: 1rem;
  line-height: 1.45;
  color: rgb(var(--v-theme-on-surface));
  font-family: inherit;
}

.ai-input-textarea::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.ai-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 16px;
  background-color: rgb(var(--v-theme-primary));
  border: none;
  cursor: pointer;
  place-items: center;
  flex-shrink: 0;
  transition: opacity 0.2s ease, transform 0.15s ease, background-color 0.2s ease;
}

.ai-send-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: scale(1.03);
}

.ai-send-btn-disabled {
  opacity: 0.3 !important;
  cursor: not-allowed !important;
}

/* 9. Floating scroll-bottom button */
.scroll-bottom-wrapper {
  position: absolute;
  bottom: 84px;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 5;
}

.scroll-bottom-btn {
  pointer-events: auto;
  border: 1px solid rgba(var(--v-border-color), 0.2) !important;
}

/* 10. Retry button for error state */
.retry-btn {
  border: 1px solid rgba(var(--v-border-color), 0.25);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
}

.retry-btn:hover {
  background: rgba(var(--v-theme-surface-variant), 0.5);
}
</style>
