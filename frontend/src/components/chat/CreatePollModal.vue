<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="500"
    persistent
  >
    <v-card rounded="xl" class="pa-0 create-poll-modal">
      <!-- Modal Header -->
      <v-card-title class="pa-4 border-b d-flex align-center justify-space-between">
        <div class="d-flex align-center" style="gap: 10px;">
          <v-avatar size="32" color="primary" variant="tonal">
            <v-icon color="primary" size="20">mdi-poll</v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-1 font-weight-bold">Tạo cuộc bình chọn</div>
            <div class="text-caption text-medium-emphasis">Khảo sát ý kiến thành viên trong nhóm Zalo</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="close" />
      </v-card-title>

      <!-- Modal Body -->
      <v-card-text class="pa-4 d-flex flex-column" style="gap: 16px; max-height: 70vh; overflow-y: auto;">
        <!-- Question -->
        <div>
          <label class="text-caption font-weight-bold mb-1 d-block">
            Câu hỏi bình chọn <span class="text-error">*</span>
          </label>
          <v-text-field
            v-model="question"
            placeholder="Ví dụ: Lịch họp tuần này lúc mấy giờ?"
            variant="outlined"
            density="compact"
            hide-details="auto"
            :error-messages="questionError"
          />
        </div>

        <!-- Options list -->
        <div>
          <label class="text-caption font-weight-bold mb-1 d-block">
            Các phương án lựa chọn <span class="text-error">*</span>
          </label>
          <div class="d-flex flex-column" style="gap: 8px;">
            <div
              v-for="(_, idx) in options"
              :key="idx"
              class="d-flex align-center"
              style="gap: 8px;"
            >
              <div
                class="option-index-badge d-flex align-center justify-center text-caption font-weight-bold rounded-lg flex-shrink-0"
                style="width: 28px; height: 36px; background: rgba(var(--v-theme-surface-variant), 0.4);"
              >
                {{ String.fromCharCode(65 + idx) }}
              </div>
              <v-text-field
                v-model="options[idx]"
                :placeholder="`Phương án ${idx + 1}`"
                variant="outlined"
                density="compact"
                hide-details
                class="flex-grow-1"
                @keydown.enter.prevent="addOptionAfter(idx)"
              />
              <v-btn
                icon="mdi-trash-can-outline"
                size="small"
                variant="text"
                color="error"
                :disabled="options.length <= 2"
                title="Xóa phương án này"
                @click="removeOption(idx)"
              />
            </div>
          </div>

          <v-btn
            variant="outlined"
            size="small"
            rounded="lg"
            class="mt-2 text-none border-dashed"
            prepend-icon="mdi-plus"
            block
            @click="addOption"
          >
            Thêm phương án
          </v-btn>
          <div v-if="optionsError" class="text-caption text-error mt-1">
            {{ optionsError }}
          </div>
        </div>

        <v-divider />

        <!-- Advanced settings -->
        <div>
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">TÙY CHỌN NÂNG CAO</div>
          <div class="d-flex flex-column" style="gap: 10px;">
            <!-- Allow Multiple Choices -->
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-medium">Chọn nhiều phương án</div>
                <div class="text-caption text-medium-emphasis">Thành viên có thể tick nhiều đáp án cùng lúc</div>
              </div>
              <v-switch
                v-model="allowMultiChoices"
                color="primary"
                hide-details
                density="compact"
              />
            </div>

            <!-- Allow Add New Option -->
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-medium">Cho phép thêm phương án</div>
                <div class="text-caption text-medium-emphasis">Thành viên khác có thể bổ sung phương án mới</div>
              </div>
              <v-switch
                v-model="allowAddNewOption"
                color="primary"
                hide-details
                density="compact"
              />
            </div>

            <!-- Hide Vote Preview -->
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-medium">Giấu kết quả khi chưa vote</div>
                <div class="text-caption text-medium-emphasis">Chỉ thấy tỷ lệ bình chọn sau khi đã bỏ phiếu</div>
              </div>
              <v-switch
                v-model="hideVotePreview"
                color="primary"
                hide-details
                density="compact"
              />
            </div>

            <!-- Anonymous -->
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-medium">Bình chọn ẩn danh</div>
                <div class="text-caption text-medium-emphasis">Không công khai danh tính người bình chọn</div>
              </div>
              <v-switch
                v-model="isAnonymous"
                color="primary"
                hide-details
                density="compact"
              />
            </div>

            <!-- Expired Time Toggle -->
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-medium">Thời hạn bình chọn</div>
                <div class="text-caption text-medium-emphasis">Tự động khóa bình chọn sau thời gian này</div>
              </div>
              <v-switch
                v-model="hasExpiration"
                color="primary"
                hide-details
                density="compact"
              />
            </div>

            <!-- Date/Time input if expiration is enabled -->
            <div v-if="hasExpiration" class="pa-3 rounded-lg border bg-surface-variant-opacity mt-1">
              <label class="text-caption font-weight-bold mb-1 d-block">Khóa bình chọn vào lúc:</label>
              <div class="d-flex" style="gap: 8px;">
                <v-text-field
                  v-model="expireDate"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="flex: 3;"
                />
                <v-text-field
                  v-model="expireTime"
                  type="time"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="flex: 2;"
                />
              </div>
            </div>
          </div>
        </div>
      </v-card-text>

      <!-- Modal Actions -->
      <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
        <v-btn variant="outlined" rounded="lg" @click="close">Hủy</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          rounded="lg"
          prepend-icon="mdi-send"
          :loading="submitting"
          @click="submitPoll"
        >
          Tạo bình chọn
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'created', poll: any): void;
}>();

const question = ref('');
const options = ref<string[]>(['', '']);
const allowMultiChoices = ref(false);
const allowAddNewOption = ref(true);
const hideVotePreview = ref(false);
const isAnonymous = ref(false);
const hasExpiration = ref(false);
const expireDate = ref('');
const expireTime = ref('18:00');

const submitting = ref(false);
const questionError = ref('');
const optionsError = ref('');

// Reset form when dialog opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    question.value = '';
    options.value = ['', ''];
    allowMultiChoices.value = false;
    allowAddNewOption.value = true;
    hideVotePreview.value = false;
    isAnonymous.value = false;
    hasExpiration.value = false;
    questionError.value = '';
    optionsError.value = '';

    // Default expiration to tomorrow 18:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expireDate.value = tomorrow.toISOString().split('T')[0];
    expireTime.value = '18:00';
  }
});

function addOption() {
  options.value.push('');
}

function addOptionAfter(index: number) {
  options.value.splice(index + 1, 0, '');
}

function removeOption(index: number) {
  if (options.value.length > 2) {
    options.value.splice(index, 1);
  }
}

function close() {
  emit('update:modelValue', false);
}

async function submitPoll() {
  questionError.value = '';
  optionsError.value = '';

  if (!question.value.trim()) {
    questionError.value = 'Vui lòng nhập câu hỏi bình chọn';
    return;
  }

  const validOptions = options.value.map(o => o.trim()).filter(Boolean);
  if (validOptions.length < 2) {
    optionsError.value = 'Vui lòng nhập ít nhất 2 phương án bình chọn';
    return;
  }

  let expiredTime = 0;
  if (hasExpiration.value && expireDate.value) {
    const timeStr = expireTime.value || '00:00';
    const dateObj = new Date(`${expireDate.value}T${timeStr}`);
    if (!isNaN(dateObj.getTime()) && dateObj.getTime() > Date.now()) {
      expiredTime = dateObj.getTime();
    }
  }

  submitting.value = true;
  try {
    const res = await api.post(`/conversations/${props.conversationId}/group/polls`, {
      question: question.value.trim(),
      options: validOptions,
      expiredTime,
      allowMultiChoices: allowMultiChoices.value,
      allowAddNewOption: allowAddNewOption.value,
      hideVotePreview: hideVotePreview.value,
      isAnonymous: isAnonymous.value,
    });

    emit('created', res.data?.poll);
    close();
  } catch (err: any) {
    optionsError.value = err.response?.data?.error || 'Tạo bình chọn thất bại';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.create-poll-modal {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.border-dashed {
  border-style: dashed !important;
}
.bg-surface-variant-opacity {
  background: rgba(var(--v-theme-surface-variant), 0.3);
}
</style>
