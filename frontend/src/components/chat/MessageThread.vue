<template>
  <div
    class="message-thread d-flex flex-column flex-grow-1"
    :class="{ 'task-thread-red': isUncompleted }"
    style="height: 100%;"
  >
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="pa-3 d-flex align-center chat-header" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); background: rgb(var(--v-theme-surface));">
        <v-btn
          v-if="isMobile"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          class="mr-2"
          @click="$emit('back')"
        />
        <v-avatar size="36" color="grey-lighten-2" class="mr-3">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" />
        </v-avatar>
        <div class="flex-grow-1">
          <div class="d-flex align-center flex-wrap" style="gap: 8px;">
            <span class="font-weight-medium text-body-1">{{ conversation.contact?.fullName || 'Unknown' }}</span>
                  <!-- Cần theo dõi Toggle Button (cho nhóm chat) -->
            <v-btn
              v-if="conversation.threadType === 'group'"
              :color="conversation.isCustomer ? 'error' : 'warning'"
              :variant="conversation.isCustomer ? 'flat' : 'outlined'"
              size="x-small"
              rounded="xl"
              class="text-none px-2 font-weight-bold"
              style="height: 22px; font-size: 0.7rem;"
              :prepend-icon="conversation.isCustomer ? 'mdi-bell-ring' : 'mdi-bell-outline'"
              :loading="updatingQuote"
              @click="toggleGroupTracking"
            >
              {{ conversation.isCustomer ? 'Đang theo dõi' : 'Cần theo dõi?' }}
            </v-btn>

            <!-- Đã báo giá / Đã hoàn thành button inside Header next to name -->
            <template v-if="shouldTrack">
              <!-- Overdue warning badge -->
              <v-chip
                v-if="isOverdue"
                color="error"
                size="x-small"
                class="px-2 animate-pulse font-weight-bold"
              >
                <v-icon start size="10">mdi-alert-circle</v-icon>
                QUÁ HẠN
              </v-chip>

              <!-- Complete/Incomplete Toggle Button -->
              <v-btn
                :color="conversation.quoteCompleted ? 'success' : 'warning'"
                :variant="conversation.quoteCompleted ? 'outlined' : 'flat'"
                size="x-small"
                rounded="xl"
                class="text-none px-2 font-weight-bold"
                style="height: 22px; font-size: 0.7rem;"
                :prepend-icon="conversation.quoteCompleted ? 'mdi-check-circle' : 'mdi-clock-outline'"
                :loading="updatingQuote"
                @click="toggleQuoteCompleted"
              >
                {{ conversation.quoteCompleted ? 'Đã hoàn thành' : 'Đã báo giá xong?' }}
              </v-btn>
              <v-chip
                v-if="conversation.quoteCompleted && conversation.quoteCompletedByName"
                size="x-small"
                class="px-2 font-weight-bold text-white ml-1 border-0"
                style="height: 22px; font-size: 0.65rem; border-radius: 12px !important; letter-spacing: 0.3px;"
                :style="{ backgroundColor: getStaffColor(conversation.quoteCompletedByName) }"
              >
                bởi {{ conversation.quoteCompletedByName }}
              </v-chip>
            </template>
          </div>
          <div class="d-flex align-center mt-1">
            <span class="text-caption text-grey">{{ conversation.zaloAccount?.displayName || 'Zalo' }}</span>
            <v-chip
              v-if="conversation.isMuted"
              size="x-small"
              class="ml-2 font-weight-medium muted-chip"
              style="height: 18px; font-size: 0.65rem;"
            >
              <v-icon start size="10" class="mr-1">mdi-bell-off-outline</v-icon>
              Tắt thông báo
            </v-chip>
            <v-chip
              v-if="conversation.zaloAccount?.status === 'disconnected'"
              size="x-small"
              color="grey-darken-2"
              variant="flat"
              class="ml-2 font-weight-bold text-white"
              style="height: 18px; font-size: 0.65rem;"
            >
              Đã ngắt kết nối
            </v-chip>
          </div>
        </div>

        <!-- Mute / Unmute Notification Button -->
        <v-btn
          :icon="conversation.isMuted ? 'mdi-bell-off-outline' : 'mdi-bell-outline'"
          size="small"
          variant="text"
          class="mr-1"
          :class="conversation.isMuted ? 'text-medium-emphasis' : 'text-primary'"
          :title="conversation.isMuted ? 'Đang tắt thông báo (Bấm để bật lại)' : 'Tắt thông báo đoạn chat này'"
          @click="$emit('toggle-mute', conversation.id, !conversation.isMuted)"
        />

        <!-- Thông tin KH Button -->
        <v-btn
          :icon="showContactPanel ? 'mdi-account-details' : 'mdi-account-details-outline'"
          size="small" variant="text"
          title="Thông tin khách hàng"
          :color="showContactPanel ? 'primary' : undefined"
          @click="$emit('toggle-contact-panel')"
        />
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-3 chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <template v-for="(msg, index) in messages" :key="msg.id">
          <!-- Date divider header -->
          <div v-if="shouldShowDateDivider(index)" class="d-flex align-center justify-center my-4" style="width: 100%;">
            <div class="flex-grow-1 date-divider-line"></div>
            <div class="mx-3 text-caption px-3 py-1 rounded-pill date-divider-chip">
              {{ formatDateDivider(msg.sentAt) }}
            </div>
            <div class="flex-grow-1 date-divider-line"></div>
          </div>

          <div
            v-if="!isEmptyMediaJson(msg)"
            :id="`msg-${msg.id}`"
            class="mb-2 d-flex message-row position-relative align-center"
            :class="[
              msg.senderType === 'self' ? 'justify-end' : 'justify-start',
              { 'multi-select-mode-active': isMultiSelectMode }
            ]"
            @click="isMultiSelectMode ? toggleMsgSelect(msg) : undefined"
          >
            <!-- Checkbox when in multi-select mode -->
            <div
              v-if="isMultiSelectMode"
              class="d-flex align-center mr-2 flex-shrink-0 cursor-pointer"
              @click.stop="toggleMsgSelect(msg)"
            >
              <v-checkbox-btn
                :model-value="selectedMsgIds.has(msg.id)"
                color="primary"
                density="compact"
              />
            </div>

            <div class="message-wrapper position-relative" style="max-width: 70%;">
              <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 font-weight-medium text-primary">
                {{ msg.senderName || 'Unknown' }}
              </div>
              <div class="message-bubble pa-3 px-4 position-relative" :class="msg.senderType === 'self' ? 'staff-bubble' : 'customer-bubble'" style="word-wrap: break-word;">
                <!-- Forwarded Header Tag -->
                <div v-if="getForwardInfo(msg)" class="forwarded-tag mb-1.5 d-flex align-center">
                  <v-icon size="12" class="mr-1" style="opacity: 0.75;">mdi-share-outline</v-icon>
                  <span class="text-caption font-italic" style="font-size: 0.72rem; opacity: 0.85;">
                    Đã chuyển tiếp{{ getForwardInfo(msg)?.originalSender ? ` từ ${getForwardInfo(msg)?.originalSender}` : '' }}
                  </span>
                </div>

                <!-- Quoted Reply Box (Hiển thị nội dung mà user phản hồi lại) -->
                <div
                  v-if="getQuoteInfo(msg)"
                  class="quote-reply-box mb-2 cursor-pointer"
                  @click="scrollToQuotedMessage(getQuoteInfo(msg))"
                  title="Nhấn để xem tin nhắn gốc"
                >
                  <div class="quote-reply-content">
                    <div class="quote-reply-author">
                      <v-icon size="11" class="mr-1">mdi-reply</v-icon>
                      <span>{{ getQuoteInfo(msg)?.fromD || 'Tin nhắn trả lời' }}</span>
                    </div>
                    <div class="quote-reply-snippet">
                      {{ getQuoteSnippet(getQuoteInfo(msg)) }}
                    </div>
                  </div>
                </div>

                <!-- Deleted -->
                <div v-if="msg.isDeleted" class="text-decoration-line-through font-italic message-text" style="opacity: 0.6;">
                  {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
                </div>

                <!-- Call notification card -->
                <div v-else-if="getCallInfo(msg)" class="call-card pa-2.5 rounded-lg border d-flex align-center" :class="getCallInfo(msg)!.isMissed ? 'call-missed' : 'call-answered'" :style="{ borderLeftColor: getCallInfo(msg)!.color, borderLeftWidth: '4px' }">
                  <v-avatar size="38" :color="getCallInfo(msg)!.color" class="mr-3 flex-shrink-0" style="color: white !important;">
                    <v-icon size="20" color="white">{{ getCallInfo(msg)!.icon }}</v-icon>
                  </v-avatar>
                  <div class="flex-grow-1">
                    <div class="d-flex align-center justify-space-between">
                      <span class="text-body-2 font-weight-bold" :style="{ color: getCallInfo(msg)!.isMissed ? '#EF4444' : 'inherit' }">
                        {{ getCallInfo(msg)!.title }}
                      </span>
                      <v-chip
                        v-if="getCallInfo(msg)!.isMissed"
                        size="x-small"
                        color="error"
                        variant="flat"
                        class="font-weight-bold px-1.5 ml-2"
                        style="height: 18px; font-size: 0.62rem;"
                      >
                        NHỠ
                      </v-chip>
                    </div>
                    <div class="text-caption mt-0.5" style="opacity: 0.8; font-size: 0.75rem;">
                      {{ getCallInfo(msg)!.subtitle }}
                    </div>
                  </div>
                </div>

                <!-- Voice message player (Tin nhắn thoại - ưu tiên trước Image) -->
                <div v-else-if="getVoiceInfo(msg)" class="voice-card pa-2.5 rounded-lg border d-flex align-center" :class="msg.senderType === 'self' ? 'voice-card-self' : 'voice-card-contact'">
                  <v-btn
                    :icon="isCurrentVoicePlaying(msg) ? 'mdi-pause' : 'mdi-play'"
                    size="small"
                    :color="msg.senderType === 'self' ? 'white' : 'primary'"
                    :variant="msg.senderType === 'self' ? 'tonal' : 'flat'"
                    class="mr-2.5 flex-shrink-0"
                    elevation="1"
                    :loading="isVoiceLoading(msg)"
                    @click.stop="togglePlayVoice(msg)"
                  />
                  <div class="flex-grow-1 mr-2" style="min-width: 140px;">
                    <!-- Waveform / Progress bar -->
                    <div
                      class="voice-progress-bar rounded-pill cursor-pointer"
                      title="Nhấn để tua âm thanh"
                      @click.stop="seekVoice($event, msg)"
                    >
                      <div
                        class="voice-progress-fill rounded-pill"
                        :style="{ width: `${getVoiceProgressPercent(msg)}%` }"
                      ></div>
                    </div>
                    <div class="d-flex align-center justify-space-between mt-1" style="font-size: 0.68rem; opacity: 0.85;">
                      <span class="font-weight-medium">
                        {{ isCurrentVoicePlaying(msg) || (activeVoiceMsgId === msg.id && voiceCurrentTime > 0) ? formatVoiceTime(voiceCurrentTime) : (getVoiceInfo(msg)!.durationText || '0:00') }}
                      </span>
                      <span class="d-flex align-center" style="gap: 2px;">
                        <v-icon size="11">mdi-microphone</v-icon>
                        <span>Thoại</span>
                      </span>
                    </div>
                  </div>
                  <!-- Download voice button -->
                  <v-btn
                    v-if="getVoiceInfo(msg)!.url"
                    icon="mdi-download"
                    size="x-small"
                    variant="text"
                    title="Tải tệp ghi âm"
                    @click.stop="downloadVoice(msg)"
                  />
                </div>

                <!-- File/PDF -->
                <div v-else-if="getFileInfo(msg)" class="file-card">
                  <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
                  <div class="flex-grow-1">
                    <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                    <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                  </div>
                  <v-btn v-if="getFileInfo(msg)!.href" icon size="x-small" variant="text" @click="openFile(getFileInfo(msg)!.href)">
                    <v-icon size="16">mdi-download</v-icon>
                  </v-btn>
                </div>

                <!-- Image -->
                <div v-else-if="getImageUrl(msg)">
                  <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="openImagePreview(msg)" />
                  <!-- Lời nhắn kèm ảnh -->
                  <div
                    v-if="getImageCaption(msg)"
                    class="chat-image-caption mt-2"
                  >
                    {{ getImageCaption(msg) }}
                  </div>
                </div>

                <!-- Contact Card -->
                <div v-else-if="getContactCardInfo(msg)" class="contact-card pa-2.5 rounded-lg border d-flex align-center" style="max-width: 300px; background: rgba(var(--v-theme-surface), 0.8);">
                  <v-avatar size="36" color="primary" class="mr-2.5">
                    <v-img v-if="getContactCardInfo(msg)!.avatar" :src="getContactCardInfo(msg)!.avatar" cover />
                    <span v-else class="text-caption font-weight-bold text-white">{{ (getContactCardInfo(msg)!.name || 'U')[0] }}</span>
                  </v-avatar>
                  <div class="flex-grow-1 overflow-hidden">
                    <div class="text-caption font-weight-bold text-truncate">{{ getContactCardInfo(msg)!.name }}</div>
                    <div class="text-caption text-medium-emphasis text-truncate" style="font-size: 0.7rem;">{{ getContactCardInfo(msg)!.phone || 'Danh thiếp Zalo' }}</div>
                  </div>
                  <v-icon size="18" color="primary">mdi-card-account-phone-outline</v-icon>
                </div>

                <!-- Sticker/Video/GIF -->
                <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
                <div v-else-if="msg.contentType === 'video'">🎥 Video</div>
                <div v-else-if="msg.contentType === 'gif'">GIF</div>

                <!-- Reminder/Calendar -->
                <div v-else-if="isReminderMessage(msg)" class="reminder-card">
                  <div class="d-flex align-center mb-1">
                    <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
                    <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
                  </div>
                  <div class="text-body-2">{{ getReminderTitle(msg) }}</div>
                  <div v-if="getReminderTime(msg)" class="text-caption mt-1" style="opacity: 0.7;">
                    <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(msg) }}
                  </div>
                  <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="syncAppointment(msg)">
                    Đồng bộ lịch
                  </v-btn>
                </div>

                <!-- Rich Link card -->
                <div v-else-if="getLinkInfo(msg)" class="link-card-rich rounded-lg border overflow-hidden" style="max-width: 320px; background: rgba(var(--v-theme-surface), 0.9);">
                  <a :href="getLinkInfo(msg)!.url" target="_blank" rel="noopener noreferrer" class="text-decoration-none text-foreground d-block">
                    <!-- Thumbnail if available -->
                    <div v-if="getLinkInfo(msg)!.thumb" class="position-relative overflow-hidden" style="max-height: 160px; background: #000;">
                      <img :src="getLinkInfo(msg)!.thumb!" alt="Preview" class="w-100 d-block" style="object-fit: cover; max-height: 160px;" />
                      <div v-if="getLinkInfo(msg)!.badge" class="position-absolute px-1.5 py-0.5 rounded text-white font-weight-bold" style="bottom: 6px; left: 6px; background: rgba(0,0,0,0.7); font-size: 0.62rem; backdrop-filter: blur(4px);">
                        {{ getLinkInfo(msg)!.badge }}
                      </div>
                    </div>
                    <div class="pa-2.5">
                      <div class="d-flex align-center mb-1 text-caption text-primary font-weight-bold" style="font-size: 0.68rem; gap: 4px;">
                        <v-icon size="13" color="primary">mdi-link-variant</v-icon>
                        <span class="text-truncate">{{ getLinkInfo(msg)!.domain || 'Liên kết' }}</span>
                        <v-icon size="11" class="ml-auto" color="medium-emphasis">mdi-open-in-new</v-icon>
                      </div>
                      <div class="text-body-2 font-weight-bold text-truncate-2" style="font-size: 0.82rem; line-height: 1.35; color: inherit;">
                        {{ getLinkInfo(msg)!.title }}
                      </div>
                      <div v-if="getLinkInfo(msg)!.description" class="text-caption text-medium-emphasis text-truncate mt-1" style="font-size: 0.72rem;">
                        {{ getLinkInfo(msg)!.description }}
                      </div>
                    </div>
                  </a>
                </div>
                <!-- Default text -->
                <div v-else class="message-text" v-html="renderMessageText(msg.content)"></div>
                 <!-- Timestamp & Actions row underneath chat content -->
                <div class="text-caption mt-1.5 msg-time d-flex align-center justify-space-between" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem; gap: 8px;">
                  <!-- Left side: Staff badge (if self) & Action icons -->
                  <div class="d-flex align-center" style="gap: 6px;">
                    <span
                      v-if="msg.senderType === 'self' && (msg.repliedBy || msg.senderName)"
                      class="px-2 py-0.5 rounded text-white text-caption font-weight-bold"
                      :style="{ backgroundColor: getStaffColor(msg.repliedBy?.fullName || msg.senderName), fontSize: '0.62rem', borderRadius: '4px !important', letterSpacing: '0.5px', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }"
                    >
                      {{ (msg.repliedBy?.fullName || (String(msg.senderName).toLowerCase() === 'adameva' ? 'Eva' : msg.senderName) || 'AI').toUpperCase() }}
                    </span>

                    <!-- Action Icons: Trả lời, Chuyển tiếp, 3 chấm ngoài cùng -->
                    <div v-if="!msg.isDeleted && !isMultiSelectMode" class="message-action-icons d-flex align-center" style="gap: 3px;">
                      <!-- 1. Trả lời -->
                      <button class="msg-action-btn" title="Trả lời tin nhắn" @click.stop="startReply(msg)">
                        <v-icon size="13">mdi-reply</v-icon>
                      </button>
                      <!-- 2. Chuyển tiếp -->
                      <button class="msg-action-btn" title="Chuyển tiếp" @click.stop="startForward(msg)">
                        <v-icon size="13">mdi-share-outline</v-icon>
                      </button>
                      <!-- 3. Icon 3 chấm ở ngoài cùng: hover hiển thị menu -->
                      <v-menu
                        open-on-hover
                        :open-on-click="true"
                        location="bottom end"
                        :close-on-content-click="true"
                        offset="4"
                      >
                        <template #activator="{ props: menuProps }">
                          <button class="msg-action-btn" title="Thêm tùy chọn" v-bind="menuProps" @click.stop>
                            <v-icon size="13">mdi-dots-horizontal</v-icon>
                          </button>
                        </template>

                        <v-list density="compact" class="py-1 message-more-menu-list" rounded="lg" elevation="8">
                          <!-- Sao chép -->
                          <v-list-item
                            density="compact"
                            class="menu-item-action cursor-pointer"
                            @click="copyMessageContent(msg)"
                          >
                            <template #prepend>
                              <v-icon size="16" class="mr-2">mdi-content-copy</v-icon>
                            </template>
                            <v-list-item-title class="text-caption font-weight-medium">Sao chép</v-list-item-title>
                          </v-list-item>

                          <!-- Chọn nhiều tin nhắn -->
                          <v-list-item
                            density="compact"
                            class="menu-item-action cursor-pointer"
                            @click="enterMultiSelectMode(msg)"
                          >
                            <template #prepend>
                              <v-icon size="16" class="mr-2">mdi-checkbox-multiple-marked-outline</v-icon>
                            </template>
                            <v-list-item-title class="text-caption font-weight-medium">Chọn nhiều tin nhắn</v-list-item-title>
                          </v-list-item>

                          <!-- Tạo nhắc hẹn -->
                          <v-list-item
                            density="compact"
                            class="menu-item-action cursor-pointer"
                            @click="openAppointmentDialog(msg)"
                          >
                            <template #prepend>
                              <v-icon size="16" class="mr-2">mdi-calendar-clock</v-icon>
                            </template>
                            <v-list-item-title class="text-caption font-weight-medium">Tạo nhắc hẹn</v-list-item-title>
                          </v-list-item>

                          <v-divider class="my-1" />

                          <!-- Thu hồi (Đỏ mặc định trên tất cả phối màu) -->
                          <v-list-item
                            density="compact"
                            class="menu-item-action menu-item-danger cursor-pointer"
                            @click="handleRecall(msg)"
                          >
                            <template #prepend>
                              <v-icon size="16" class="mr-2 action-danger-icon">mdi-backup-restore</v-icon>
                            </template>
                            <v-list-item-title class="text-caption font-weight-medium action-danger-text">Thu hồi</v-list-item-title>
                          </v-list-item>

                          <!-- Xóa chỉ ở phía tôi (Đỏ mặc định trên tất cả phối màu) -->
                          <v-list-item
                            density="compact"
                            class="menu-item-action menu-item-danger cursor-pointer"
                            @click="handleDeleteOnlyMe(msg)"
                          >
                            <template #prepend>
                              <v-icon size="16" class="mr-2 action-danger-icon">mdi-delete-outline</v-icon>
                            </template>
                            <v-list-item-title class="text-caption font-weight-medium action-danger-text">Xóa chỉ ở phía tôi</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>
                    </div>
                  </div>

                  <!-- Right side: Timestamp -->
                  <span class="msg-timestamp">{{ formatMessageTime(msg.sentAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Disconnected Zalo account notice banner -->
      <div
        v-if="conversation.zaloAccount?.status === 'disconnected'"
        class="px-3 py-2 text-center bg-surface-variant text-caption text-medium-emphasis d-flex align-center justify-center"
        style="border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); gap: 6px;"
      >
        <v-icon size="16" color="warning">mdi-alert-circle-outline</v-icon>
        <span>Tài khoản Zalo này hiện đang ngắt kết nối. Bạn đang xem lại toàn bộ lịch sử tin nhắn.</span>
      </div>

      <!-- Reply Preview Banner (above input) -->
      <div
        v-if="replyingTo && canChat"
        class="reply-preview-banner px-4 py-2 d-flex align-center justify-space-between"
      >
        <div class="d-flex align-center text-truncate" style="gap: 10px; flex: 1;">
          <div class="reply-indicator-bar"></div>
          <v-icon size="18" color="primary">mdi-reply</v-icon>
          <div class="text-truncate" style="flex: 1;">
            <div class="text-caption font-weight-bold text-primary d-flex align-center" style="gap: 4px;">
              <span>Đang trả lời {{ replyingTo.senderType === 'self' ? 'chính bạn' : (replyingTo.senderName || 'khách hàng') }}</span>
            </div>
            <div class="text-caption text-truncate text-medium-emphasis">
              {{ getMessageSnippet(replyingTo) }}
            </div>
          </div>
        </div>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          title="Hủy trả lời"
          @click="cancelReply"
        />
      </div>

      <!-- Multi-select Bottom Action Bar -->
      <div
        v-if="isMultiSelectMode"
        class="multi-select-bar px-4 py-2.5 d-flex align-center justify-space-between"
      >
        <div class="d-flex align-center" style="gap: 10px;">
          <v-btn icon="mdi-close" variant="text" size="small" @click="exitMultiSelect" title="Hủy chọn" />
          <span class="text-body-2 font-weight-medium">
            Đã chọn <strong class="text-primary">{{ selectedMsgIds.size }}</strong> tin nhắn
          </span>
        </div>
        <div class="d-flex align-center" style="gap: 8px;">
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            rounded="lg"
            prepend-icon="mdi-share"
            :disabled="selectedMsgIds.size === 0"
            @click="openForwardSelectedModal"
          >
            Chuyển tiếp ({{ selectedMsgIds.size }})
          </v-btn>
          <v-btn
            class="delete-for-me-btn"
            variant="outlined"
            size="small"
            rounded="lg"
            prepend-icon="mdi-delete-outline"
            :disabled="selectedMsgIds.size === 0"
            @click="deleteSelectedMessagesForMe"
          >
            Xóa ở phía tôi
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            rounded="lg"
            @click="exitMultiSelect"
          >
            Hủy
          </v-btn>
        </div>
      </div>

      <!-- Input / Warning Banner (chỉ hiển thị khi không ở chế độ chọn nhiều) -->
      <div v-else-if="canChat" class="pa-2 px-3 d-flex align-center chat-input-area" style="gap: 6px;">
        <!-- 1. Icon Đính kèm -->
        <v-btn
          icon="mdi-paperclip"
          variant="text"
          color="primary"
          density="comfortable"
          :disabled="sending || sendingFile"
          title="Đính kèm file từ máy tính"
          @click="triggerFileInput"
        />
        <input type="file" ref="fileInput" class="d-none" accept="image/*, application/pdf, .doc, .docx, .xls, .xlsx, .txt, .zip, .rar" @change="handleFileChange" />
        
        <!-- 2. Icon Hình ảnh -->
        <v-btn
          icon="mdi-image-multiple-outline"
          variant="text"
          color="primary"
          density="comfortable"
          :disabled="sending || sendingFile"
          title="Chọn ảnh từ Kho hình ảnh"
          @click="showMediaPicker = true"
        />

        <!-- 3. Icon Chat nhanh -->
        <QuickRepliesMenu
          @select="onSelectQuickReply"
          @send-instant="onSendInstantQuickReply"
        />
        
        <v-textarea
          v-model="inputText"
          placeholder="Nhập tin nhắn..."
          variant="outlined"
          density="compact"
          hide-details
          auto-grow
          rows="1"
          max-rows="4"
          rounded="xl"
          class="flex-grow-1 chat-input-textarea"
          @keydown.enter.exact.prevent="handleSend"
        />
        <v-btn
          icon="mdi-send"
          color="primary"
          :variant="inputText.trim() ? 'flat' : 'tonal'"
          :style="!inputText.trim() ? 'opacity: 0.45;' : ''"
          density="comfortable"
          :loading="sending || sendingFile"
          :disabled="!inputText.trim()"
          title="Gửi tin nhắn (Enter)"
          @click="handleSend"
        />
      </div>
      <div v-else class="pa-4 text-center d-flex align-center justify-center flex-column" style="gap: 8px; background: rgba(255, 183, 77, 0.05); border-top: 1px solid rgba(255, 183, 77, 0.15);">
        <v-icon icon="mdi-eye-outline" size="28" color="warning" />
        <div class="text-caption font-weight-bold text-warning" style="line-height: 1.4; max-width: 500px;">
          Bạn đang ở chế độ Chỉ đọc đối soát. Vui lòng liên hệ Admin/Sale để cấp quyền chat trực tiếp với khách hàng này.
        </div>
      </div>
    </template>

    <!-- Image preview dialog -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 80vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />
        <div v-if="previewImageCaption" class="mt-3 px-4 py-2 mx-auto text-body-1 font-weight-medium rounded-lg text-white" style="background: rgba(0,0,0,0.7); max-width: 700px; backdrop-filter: blur(8px); white-space: pre-wrap; word-break: break-word;">
          {{ previewImageCaption }}
        </div>
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>

    <!-- Media Picker Modal -->
    <ChatMediaPickerModal
      v-if="conversation"
      v-model="showMediaPicker"
      :conversation-id="conversation.id"
      @sent="onMediaSent"
    />

    <!-- Forward Message Modal -->
    <ForwardMessageModal
      v-model="showForwardModal"
      :message="forwardModalMessage"
      :messages="forwardModalMessages"
      @forward-success="onForwardSuccess"
    />

    <!-- Appointment Creation Modal (Tạo nhắc hẹn) -->
    <v-dialog v-model="showAppointmentDialog" max-width="480">
      <v-card rounded="xl" class="pa-0 appointment-dialog-card">
        <v-card-title class="pa-4 border-b d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="primary" size="22">mdi-calendar-clock</v-icon>
            <span class="text-subtitle-1 font-weight-bold">Tạo nhắc hẹn</span>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showAppointmentDialog = false" />
        </v-card-title>

        <v-card-text class="pa-4 d-flex flex-column" style="gap: 16px;">
          <!-- Customer Info -->
          <div v-if="conversation?.contact" class="d-flex align-center pa-2.5 rounded-lg" style="background: rgba(var(--v-theme-surface-variant), 0.35); gap: 10px;">
            <v-avatar size="32" color="primary">
              <span class="text-caption font-weight-bold text-white">{{ (conversation.contact.fullName || 'K')[0] }}</span>
            </v-avatar>
            <div class="text-truncate">
              <div class="text-body-2 font-weight-bold">{{ conversation.contact.fullName || 'Khách hàng' }}</div>
              <div class="text-caption text-medium-emphasis">{{ conversation.contact.phone || 'Chưa có SĐT' }}</div>
            </div>
          </div>

          <!-- Notes / Content -->
          <v-textarea
            v-model="appointmentForm.notes"
            label="Nội dung nhắc hẹn"
            variant="outlined"
            density="compact"
            rows="2"
            max-rows="4"
            auto-grow
            hide-details
          />

          <div class="d-flex" style="gap: 12px;">
            <!-- Date -->
            <v-text-field
              v-model="appointmentForm.date"
              label="Ngày hẹn"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
              style="flex: 1;"
            />

            <!-- Time -->
            <v-text-field
              v-model="appointmentForm.time"
              label="Giờ hẹn"
              type="time"
              variant="outlined"
              density="compact"
              hide-details
              style="flex: 1;"
            />
          </div>

          <!-- Type -->
          <v-select
            v-model="appointmentForm.type"
            label="Phân loại hẹn"
            :items="[
              { title: 'Tư vấn', value: 'tu_van' },
              { title: 'Khám mới', value: 'kham_moi' },
              { title: 'Tái khám', value: 'tai_kham' },
              { title: 'Nhắc hẹn khác', value: 'khac' }
            ]"
            item-title="title"
            item-value="value"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-card-text>

        <v-card-actions class="pa-3 px-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="text" rounded="lg" @click="showAppointmentDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            prepend-icon="mdi-check"
            :loading="savingAppointment"
            @click="saveAppointment"
          >
            Lưu nhắc hẹn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onUnmounted } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import ChatMediaPickerModal from './ChatMediaPickerModal.vue';
import QuickRepliesMenu from './QuickRepliesMenu.vue';
import ForwardMessageModal from './ForwardMessageModal.vue';

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  isMobile?: boolean;
}>();

const authStore = useAuthStore();

const canChat = computed(() => {
  if (authStore.user?.role !== 'accountant') return true;
  return (props.conversation?.contact?.notes || '').includes('[Kế toán được chat]');
});

const emit = defineEmits<{
  send: [content: string, quoteMessageId?: string];
  'send-file': [file: File];
  'recall-message': [messageId: string];
  'delete-message-for-me': [messageId: string];
  'toggle-mute': [convId: string, isMuted: boolean];
  'toggle-contact-panel': [];
  back: [];
}>();

const replyingTo = ref<Message | null>(null);
const showForwardModal = ref(false);
const forwardModalMessage = ref<Message | null>(null);
const forwardModalMessages = ref<Message[]>([]);

// Multi-select state
const isMultiSelectMode = ref(false);
const selectedMsgIds = ref<Set<string>>(new Set());

function enterMultiSelectMode(msg?: Message) {
  isMultiSelectMode.value = true;
  selectedMsgIds.value = new Set(msg ? [msg.id] : []);
}

function exitMultiSelect() {
  isMultiSelectMode.value = false;
  selectedMsgIds.value = new Set();
  forwardModalMessages.value = [];
}

function toggleMsgSelect(msg: Message) {
  if (!isMultiSelectMode.value) return;
  const next = new Set(selectedMsgIds.value);
  if (next.has(msg.id)) {
    next.delete(msg.id);
  } else {
    next.add(msg.id);
  }
  selectedMsgIds.value = next;
}

function openForwardSelectedModal() {
  forwardModalMessage.value = null;
  forwardModalMessages.value = props.messages.filter(m => selectedMsgIds.value.has(m.id));
  showForwardModal.value = true;
}

async function deleteSelectedMessagesForMe() {
  if (!props.conversation?.id || selectedMsgIds.value.size === 0) return;
  const count = selectedMsgIds.value.size;
  const idsToDelete = Array.from(selectedMsgIds.value);
  exitMultiSelect();
  try {
    for (const id of idsToDelete) {
      await api.post(`/conversations/${props.conversation.id}/messages/${id}/delete-for-me`);
      const idx = props.messages.findIndex(m => m.id === id);
      if (idx !== -1) {
        props.messages.splice(idx, 1);
      }
      emit('delete-message-for-me', id);
    }
    syncSnack.value = { show: true, text: `Đã xóa ${count} tin nhắn chỉ ở phía bạn!`, color: 'success' };
  } catch (err: any) {
    console.error('Failed to delete selected messages for me:', err);
    syncSnack.value = { show: true, text: 'Xóa tin nhắn thất bại', color: 'error' };
  }
}

// Recall (Thu hồi) & Delete for me only (Xóa chỉ ở phía tôi)
async function handleRecall(msg: Message) {
  if (!props.conversation?.id) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/messages/${msg.id}/undo`);
    msg.isDeleted = true;
    emit('recall-message', msg.id);
    syncSnack.value = { show: true, text: 'Đã thu hồi tin nhắn cả 2 phía thành công!', color: 'success' };
  } catch (err: any) {
    console.error('Failed to recall message:', err);
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Thu hồi tin nhắn thất bại', color: 'error' };
  }
}

async function handleDeleteOnlyMe(msg: Message) {
  if (!props.conversation?.id) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/messages/${msg.id}/delete-for-me`);
    const idx = props.messages.findIndex(m => m.id === msg.id);
    if (idx !== -1) {
      props.messages.splice(idx, 1);
    }
    emit('delete-message-for-me', msg.id);
    syncSnack.value = { show: true, text: 'Đã xóa tin nhắn chỉ ở phía tôi!', color: 'success' };
  } catch (err: any) {
    console.error('Failed to delete message for me:', err);
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Xóa tin nhắn thất bại', color: 'error' };
  }
}

// Appointment / Reminder modal state & handlers
const showAppointmentDialog = ref(false);
const savingAppointment = ref(false);
const appointmentForm = ref({
  notes: '',
  date: '',
  time: '09:00',
  type: 'tu_van',
});

function openAppointmentDialog(msg: Message) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');

  const snippet = msg.content ? parseDisplayContent(msg.content) : '';
  appointmentForm.value = {
    notes: snippet.length > 200 ? snippet.slice(0, 200) + '...' : snippet,
    date: `${yyyy}-${mm}-${dd}`,
    time: '09:00',
    type: 'tu_van',
  };
  showAppointmentDialog.value = true;
}

async function saveAppointment() {
  if (!props.conversation?.contact?.id) {
    syncSnack.value = { show: true, text: 'Hội thoại này chưa liên kết hồ sơ khách hàng', color: 'warning' };
    showAppointmentDialog.value = false;
    return;
  }
  if (!appointmentForm.value.date) {
    syncSnack.value = { show: true, text: 'Vui lòng chọn ngày hẹn', color: 'warning' };
    return;
  }
  savingAppointment.value = true;
  try {
    const dt = new Date(`${appointmentForm.value.date}T${appointmentForm.value.time || '09:00'}:00`);
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate: dt.toISOString(),
      appointmentTime: appointmentForm.value.time || '09:00',
      type: appointmentForm.value.type,
      notes: appointmentForm.value.notes?.trim() || undefined,
    });
    syncSnack.value = { show: true, text: 'Đã tạo nhắc hẹn thành công!', color: 'success' };
    showAppointmentDialog.value = false;
  } catch (err: any) {
    console.error('Failed to save appointment:', err);
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Tạo nhắc hẹn thất bại', color: 'error' };
  } finally {
    savingAppointment.value = false;
  }
}

function startReply(msg: Message) {
  replyingTo.value = msg;
}

function cancelReply() {
  replyingTo.value = null;
}

function startForward(msg: Message) {
  forwardModalMessage.value = msg;
  forwardModalMessages.value = [];
  showForwardModal.value = true;
}

function onForwardSuccess(count: number) {
  syncSnack.value = {
    show: true,
    text: `Đã chuyển tiếp tin nhắn tới ${count} cuộc trò chuyện thành công!`,
    color: 'success',
  };
  if (isMultiSelectMode.value) {
    exitMultiSelect();
  }
}

function copyMessageContent(msg: Message) {
  if (!msg.content) return;
  const text = parseDisplayContent(msg.content);
  navigator.clipboard.writeText(text).then(() => {
    syncSnack.value = { show: true, text: 'Đã sao chép nội dung tin nhắn!', color: 'success' };
  }).catch(() => {
    syncSnack.value = { show: true, text: 'Không thể sao chép', color: 'error' };
  });
}

function getQuoteInfo(msg: Message): { ownerId?: string; fromD?: string; msg?: string; attach?: any; globalMsgId?: string; quoteMessageId?: string } | null {
  if (!msg.attachments) return null;
  let attList = msg.attachments;
  if (typeof attList === 'string') {
    try { attList = JSON.parse(attList); } catch { return null; }
  }
  if (!Array.isArray(attList)) return null;
  const quote = attList.find((a: any) => a.type === 'quote');
  return quote || null;
}

function getForwardInfo(msg: Message): { originalSender?: string; sourceConversationId?: string } | null {
  if (!msg.attachments) return null;
  let attList = msg.attachments;
  if (typeof attList === 'string') {
    try { attList = JSON.parse(attList); } catch { return null; }
  }
  if (!Array.isArray(attList)) return null;
  const fwd = attList.find((a: any) => a.type === 'forwarded');
  return fwd || null;
}

function getQuoteSnippet(quote: any): string {
  if (!quote) return '';
  if (quote.msg && quote.msg.trim()) {
    return quote.msg;
  }
  if (quote.cliMsgType === 32 || quote.attach) {
    return '[Hình ảnh]';
  }
  return '[Tin nhắn]';
}

function getMessageSnippet(msg: Message): string {
  if (getImageUrl(msg)) {
    const caption = getImageCaption(msg);
    return caption ? `[Hình ảnh]: ${caption}` : '[Hình ảnh]';
  }
  const file = getFileInfo(msg);
  if (file) {
    return `[Tệp]: ${file.name}`;
  }
  return msg.content || '';
}

function scrollToQuotedMessage(quote: any) {
  if (!quote) return;
  const quoteTarget = props.messages.find(m => 
    (quote.quoteMessageId && m.id === quote.quoteMessageId) ||
    (quote.globalMsgId && (m.zaloMsgId === quote.globalMsgId || m.id === quote.globalMsgId))
  );
  if (quoteTarget) {
    const el = document.getElementById(`msg-${quoteTarget.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight-pulse');
      setTimeout(() => {
        el.classList.remove('message-highlight-pulse');
      }, 2000);
    }
  }
}

watch(() => props.conversation?.id, () => {
  replyingTo.value = null;
  exitMultiSelect();
});

const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const previewImageCaption = ref('');
const showImagePreview = computed({
  get: () => !!previewImageUrl.value,
  set: (v) => {
    if (!v) {
      previewImageUrl.value = '';
      previewImageCaption.value = '';
    }
  }
});
const syncSnack = ref({ show: false, text: '', color: 'success' });
const showMediaPicker = ref(false);

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function onMediaSent() {
  syncSnack.value = { show: true, text: 'Đã gửi ảnh từ Kho thành công!', color: 'success' };
  nextTick(() => {
    scrollToBottom();
  });
}

const fileInput = ref<HTMLInputElement | null>(null);
const sendingFile = ref(false);
const updatingQuote = ref(false);

const shouldTrack = computed(() => {
  if (!props.conversation) return false;
  return props.conversation.threadType === 'user' || props.conversation.isCustomer;
});

const isOverdue = computed(() => {
  if (!props.conversation || !shouldTrack.value || props.conversation.quoteCompleted) return false;
  if (!props.conversation.lastMessageAt) return false;
  const lastTime = new Date(props.conversation.lastMessageAt).getTime();
  const diffHours = (Date.now() - lastTime) / (1000 * 60 * 60);
  return diffHours > 24;
});

const isUncompleted = computed(() => {
  if (!props.conversation || !shouldTrack.value || props.conversation.quoteCompleted) return false;
  if (!props.conversation.lastMessageAt) return false;
  const lastTime = new Date(props.conversation.lastMessageAt).getTime();
  const diffTime = Date.now() - lastTime;
  if (!props.conversation.isReplied) {
    // Staff hasn't replied yet: 5 minutes threshold
    return diffTime >= 5 * 60 * 1000;
  } else {
    // Staff has replied, but customer has not responded: 24 hours threshold
    return diffTime >= 24 * 60 * 60 * 1000;
  }
});

async function toggleQuoteCompleted() {
  if (!props.conversation) return;
  updatingQuote.value = true;
  try {
    const nextState = !props.conversation.quoteCompleted;
    const res = await api.patch(`/conversations/${props.conversation.id}/quote-settings`, {
      quoteCompleted: nextState
    });
    props.conversation.quoteCompleted = res.data.quoteCompleted;
    props.conversation.quoteCompletedByName = res.data.quoteCompletedByName;
  } catch (err) {
    console.error('Failed to toggle quote status:', err);
  } finally {
    updatingQuote.value = false;
  }
}

function triggerFileInput() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  sendingFile.value = true;
  try {
    emit('send-file', file);
  } catch (err) {
    syncSnack.value = { show: true, text: 'Gửi file thất bại', color: 'error' };
  } finally {
    sendingFile.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

function handleSend() {
  if (!inputText.value.trim()) return;
  const cleanText = inputText.value.replace(/^[\r\n]+/, '').trimEnd();
  emit('send', cleanText, replyingTo.value?.id);
  inputText.value = '';
  replyingTo.value = null;
}

function onSelectQuickReply(content: string) {
  if (inputText.value.trim()) {
    inputText.value = inputText.value + '\n' + content;
  } else {
    inputText.value = content;
  }
}

function onSendInstantQuickReply(content: string) {
  emit('send', content, replyingTo.value?.id);
  replyingTo.value = null;
}
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

function shouldShowDateDivider(index: number): boolean {
  if (index === 0) return true;
  const currentMsg = props.messages[index];
  const prevMsg = props.messages[index - 1];
  if (!currentMsg || !prevMsg) return false;
  
  const currentDate = new Date(currentMsg.sentAt).toDateString();
  const prevDate = new Date(prevMsg.sentAt).toDateString();
  
  return currentDate !== prevDate;
}

function formatDateDivider(sentAt: string): string {
  const date = new Date(sentAt);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Hôm nay';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Hôm qua';
  }
  
  const weekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const weekday = weekdays[date.getDay()];
  
  return `${weekday}, ${day}/${month}/${year}`;
}

function openFile(url: string) {
  if (props.conversation?.zaloAccount?.id && (url.includes('dlfl.vn') || url.includes('zalo') || url.includes('zdn.vn') || url.includes('asyncfile'))) {
    const token = localStorage.getItem('token') || '';
    const proxyUrl = `/api/v1/files/download?url=${encodeURIComponent(url)}&accountId=${props.conversation.zaloAccount.id}&token=${token}`;
    window.open(proxyUrl, '_blank');
  } else {
    window.open(url, '_blank');
  }
}

/** Extract image URL from JSON content */
function getImageUrl(msg: Message): string | null {
  // Voice, call, and file must NEVER be treated as images!
  if (msg.contentType === 'voice' || msg.contentType === 'call' || msg.contentType === 'file') {
    return null;
  }
  if (getVoiceInfo(msg) !== null) {
    return null;
  }
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http') || msg.content.startsWith('data:') || msg.content.startsWith('blob:')) return msg.content;
    try {
      const p = JSON.parse(msg.content);
      const url = p.href || p.thumb || p.hdUrl || null;
      if (url && (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:'))) return url;
    } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || p.hdUrl || '';
      // Audio or voice files must NEVER be considered an image
      if (href.includes('voice') || href.includes('.aac') || href.includes('.mp3') || href.includes('.m4a') || href.includes('.wav') || href.includes('.ogg')) {
        return null;
      }
      if (p.action?.includes('voice') || p.params?.includes?.('waveformSamples')) {
        return null;
      }
      if (href && (href.startsWith('data:') || href.startsWith('blob:') || /\.(jpg|jpeg|png|webp|gif)/i.test(href) || (href.includes('zdn.vn') && !p.params?.includes('fileExt')))) {
        return href;
      }
    } catch {}
  }
  return null;
}

/** Check if message is just an empty placeholder JSON without media content */
function isEmptyMediaJson(msg: Message): boolean {
  if (!msg.content) return false;
  if (!msg.content.startsWith('{')) return false;
  try {
    const p = JSON.parse(msg.content);
    // An empty image template {"href":"","thumb":"","hdUrl":""}
    if ('href' in p && 'thumb' in p && 'hdUrl' in p) {
      if (!p.href && !p.thumb && !p.hdUrl && !p.title && !p.caption) {
        return true;
      }
    }
    // An empty file template with no href and no name
    if ('params' in p && !p.href && !p.title) {
      return true;
    }
  } catch {}
  return false;
}

/** Extract image caption / text from JSON content */
function getImageCaption(msg: Message): string | null {
  if (!msg.content) return null;
  if (!msg.content.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const caption = p.title || p.caption || p.description || p.msg || '';
    if (typeof caption === 'string' && caption.trim()) {
      return caption.trim();
    }
  } catch {}
  return null;
}

function openImagePreview(msg: Message) {
  previewImageUrl.value = getImageUrl(msg) || '';
  previewImageCaption.value = getImageCaption(msg) || '';
}

/** Extract file info from JSON content (PDF, docs, etc.) */
function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (msg.contentType === 'voice' || msg.contentType === 'call' || getVoiceInfo(msg) !== null) {
    return null;
  }
  if (msg.contentType === 'file' || msg.content?.startsWith('{')) {
    try {
      const p = typeof msg.content === 'string' && msg.content.startsWith('{') ? JSON.parse(msg.content) : null;
      if (p) {
        let params = p.params;
        if (typeof params === 'string') {
          try { params = JSON.parse(params); } catch {}
        }
        // Exclude voice
        if (params?.waveformSamples || p.action?.includes('voice') || (p.href && p.href.includes('voice')) || (p.href && (p.href.endsWith('.aac') || p.href.endsWith('.m4a')))) {
          return null;
        }
        const hasFileExt = params?.fileExt || /\.(pdf|xlsx?|docx?|pptx?|zip|rar|tar|gz|7z|txt|csv)$/i.test(p.title || p.href || '');
        if (msg.contentType === 'file' || params?.fType === 1 || hasFileExt) {
          const bytes = parseInt(params?.fileSize || '0');
          const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : (bytes > 0 ? `${Math.round(bytes / 1024)} KB` : '');
          return {
            name: p.title || `Tài liệu.${params?.fileExt || 'file'}`,
            size,
            href: p.href || '',
          };
        }
      }
    } catch {}
  }
  return null;
}

// ── Voice Audio Player State & Methods ─────────────────────────────────────
export interface VoiceInfo {
  url: string;
  duration: number; // in seconds
  durationText: string;
  fileSize?: string;
}

const activeVoiceMsgId = ref<string | null>(null);
const isVoicePlaying = ref(false);
const isVoiceLoadingState = ref(false);
const voiceCurrentTime = ref(0);
const voiceDuration = ref(0);
let currentAudio: HTMLAudioElement | null = null;

function isCurrentVoicePlaying(msg: Message): boolean {
  return activeVoiceMsgId.value === msg.id && isVoicePlaying.value;
}

function isVoiceLoading(msg: Message): boolean {
  return activeVoiceMsgId.value === msg.id && isVoiceLoadingState.value;
}

function getVoiceProgressPercent(msg: Message): number {
  if (activeVoiceMsgId.value !== msg.id) return 0;
  if (!voiceDuration.value || isNaN(voiceDuration.value)) return 0;
  return Math.min(100, (voiceCurrentTime.value / voiceDuration.value) * 100);
}

function formatVoiceTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getVoiceInfo(msg: Message): VoiceInfo | null {
  if (
    msg.contentType === 'voice' ||
    msg.content?.includes('voice') ||
    msg.content?.includes('.aac') ||
    msg.content?.includes('.mp3') ||
    msg.content?.includes('.m4a') ||
    msg.content?.includes('waveformSamples')
  ) {
    try {
      if (msg.content?.startsWith('{')) {
        const p = JSON.parse(msg.content);
        let params = p.params;
        if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
        const url = p.href || params?.m4a || params?.href || params?.url || p.url || '';
        const durMs = Number(params?.duration || 0);
        const duration = durMs > 0 ? Math.round(durMs / 1000) : 0;
        const m = Math.floor(duration / 60);
        const s = duration % 60;
        const durationText = `${m}:${s < 10 ? '0' : ''}${s}`;
        const bytes = Number(params?.fileSize || 0);
        const fileSize = bytes > 0 ? (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`) : undefined;
        if (url) {
          return { url, duration, durationText, fileSize };
        }
      } else if (msg.content && /^https?:\/\/\S+/i.test(msg.content.trim())) {
        const isAudioUrl = /\.(aac|m4a|mp3|wav|ogg)/i.test(msg.content) || msg.content.includes('voice');
        if (isAudioUrl || msg.contentType === 'voice') {
          return { url: msg.content.trim(), duration: 0, durationText: '0:00' };
        }
      }
    } catch {}
  }
  return null;
}

function togglePlayVoice(msg: Message) {
  const info = getVoiceInfo(msg);
  if (!info || !info.url) return;

  if (activeVoiceMsgId.value === msg.id) {
    if (isVoicePlaying.value) {
      currentAudio?.pause();
      isVoicePlaying.value = false;
    } else {
      currentAudio?.play().catch(e => console.error('Audio play error:', e));
      isVoicePlaying.value = true;
    }
    return;
  }

  // Stop previous audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }

  activeVoiceMsgId.value = msg.id;
  isVoicePlaying.value = false;
  isVoiceLoadingState.value = true;
  voiceCurrentTime.value = 0;
  voiceDuration.value = info.duration || 0;

  const audio = new Audio(info.url);
  currentAudio = audio;

  audio.addEventListener('loadedmetadata', () => {
    isVoiceLoadingState.value = false;
    if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      voiceDuration.value = audio.duration;
    }
  });

  audio.addEventListener('canplay', () => {
    isVoiceLoadingState.value = false;
  });

  audio.addEventListener('timeupdate', () => {
    voiceCurrentTime.value = audio.currentTime;
    if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      voiceDuration.value = audio.duration;
    }
  });

  audio.addEventListener('ended', () => {
    isVoicePlaying.value = false;
    voiceCurrentTime.value = 0;
  });

  audio.addEventListener('error', (err) => {
    console.error('Audio playback error:', err);
    isVoiceLoadingState.value = false;
    isVoicePlaying.value = false;
    syncSnack.value = { show: true, text: 'Không thể phát âm thanh', color: 'error' };
  });

  audio.play()
    .then(() => {
      isVoicePlaying.value = true;
      isVoiceLoadingState.value = false;
    })
    .catch((err) => {
      console.error('Playback start error:', err);
      isVoiceLoadingState.value = false;
      isVoicePlaying.value = false;
    });
}

function seekVoice(event: MouseEvent, msg: Message) {
  if (activeVoiceMsgId.value !== msg.id || !currentAudio || !voiceDuration.value) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percent = Math.max(0, Math.min(1, clickX / rect.width));
  const newTime = percent * voiceDuration.value;
  currentAudio.currentTime = newTime;
  voiceCurrentTime.value = newTime;
}

function downloadVoice(msg: Message) {
  const info = getVoiceInfo(msg);
  if (!info?.url) return;
  window.open(info.url, '_blank');
}

onUnmounted(() => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
});

// ── Call Message Info ──────────────────────────────────────────────────────
export interface CallInfo {
  isMissed: boolean;
  isIncoming: boolean;
  duration: number;
  durationText: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
}

function isCallMessage(msg: Message): boolean {
  if (msg.contentType === 'call') return true;
  if (!msg.content || !msg.content.startsWith('{')) return false;
  try {
    const p = JSON.parse(msg.content);
    return Boolean(p.action?.includes('call') || p.title === 'sendBubbleMessage' || p.description === 'Cuộc gọi');
  } catch { return false; }
}

function getCallInfo(msg: Message): CallInfo | null {
  if (msg.contentType === 'call' || isCallMessage(msg)) {
    try {
      const p = typeof msg.content === 'string' && msg.content.startsWith('{') ? JSON.parse(msg.content) : null;
      let params = p?.params;
      if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
      const duration = Number(params?.duration || 0);
      const isCaller = Number(params?.isCaller ?? (msg.senderType === 'self' ? 1 : 0));
      const isIncoming = isCaller === 0;
      const isMissed = duration === 0 || p?.action?.includes('misscall') || p?.action?.includes('miss');

      const m = Math.floor(duration / 60);
      const s = duration % 60;
      let durationText = '';
      if (duration > 0) {
        durationText = m > 0 ? `${m} phút ${s > 0 ? s + ' giây' : ''}` : `${s} giây`;
      }

      if (isMissed) {
        if (isIncoming) {
          return {
            isMissed: true,
            isIncoming: true,
            duration: 0,
            durationText: 'Cuộc gọi nhỡ',
            title: 'Cuộc gọi đến nhỡ',
            subtitle: 'Khách hàng đã gọi nhưng bạn chưa bắt máy',
            icon: 'mdi-phone-missed',
            color: '#EF4444',
          };
        } else {
          return {
            isMissed: true,
            isIncoming: false,
            duration: 0,
            durationText: 'Không bắt máy',
            title: 'Cuộc gọi đi không thành công',
            subtitle: 'Khách hàng không nhấc máy',
            icon: 'mdi-phone-cancel',
            color: '#F59E0B',
          };
        }
      } else {
        if (isIncoming) {
          return {
            isMissed: false,
            isIncoming: true,
            duration,
            durationText,
            title: 'Cuộc gọi thoại đến',
            subtitle: `Thời lượng cuộc gọi: ${durationText}`,
            icon: 'mdi-phone-incoming',
            color: '#10B981',
          };
        } else {
          return {
            isMissed: false,
            isIncoming: false,
            duration,
            durationText,
            title: 'Cuộc gọi thoại đi',
            subtitle: `Thời lượng cuộc gọi: ${durationText}`,
            icon: 'mdi-phone-outgoing',
            color: '#3B82F6',
          };
        }
      }
    } catch {}
  }
  return null;
}

// ── Contact Card Info ──────────────────────────────────────────────────────
export interface ContactCardInfo {
  name: string;
  phone?: string;
  avatar?: string;
}

function getContactCardInfo(msg: Message): ContactCardInfo | null {
  if (msg.contentType === 'contact_card' || msg.content?.includes('recommened.user')) {
    try {
      if (msg.content?.startsWith('{')) {
        const p = JSON.parse(msg.content);
        let params = p.params;
        if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
        return {
          name: p.title || params?.name || params?.phone || 'Liên hệ',
          phone: params?.phone || p.description || '',
          avatar: p.thumb || params?.avatar || '',
        };
      }
    } catch {}
  }
  return null;
}

// ── Link Card Info ─────────────────────────────────────────────────────────
export interface LinkInfo {
  url: string;
  title: string;
  description?: string;
  thumb?: string;
  domain?: string;
  badge?: string;
}

function getLinkInfo(msg: Message): LinkInfo | null {
  if (msg.contentType === 'link' || msg.content?.startsWith('{')) {
    try {
      const p = typeof msg.content === 'string' && msg.content.startsWith('{') ? JSON.parse(msg.content) : null;
      if (p && p.href && (p.href.startsWith('http://') || p.href.startsWith('https://'))) {
        // Exclude image or raw media CDN files
        if (!p.href.includes('/gr/jpg/') && !p.href.includes('/no/jpg/') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(p.href)) {
          let params = p.params;
          if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
          let title = p.title || params?.mediaTitle || p.description || p.href;
          if (!title || !String(title).trim()) title = p.href;

          let domain = '';
          try { domain = new URL(p.href).hostname.replace(/^www\./, ''); } catch {}

          const thumb = p.thumb || params?.icon || '';

          let badge = '';
          if (domain.includes('facebook.com')) badge = 'Facebook Video';
          else if (domain.includes('shopee.vn')) badge = 'Shopee';
          else if (domain.includes('youtube.com') || domain.includes('youtu.be')) badge = 'YouTube';
          else if (domain.includes('tiktok.com')) badge = 'TikTok';

          return {
            url: p.href,
            title: String(title).trim(),
            description: p.description || '',
            thumb,
            domain,
            badge,
          };
        }
      }
    } catch {}
  }
  if (msg.contentType === 'link' && msg.content && /^https?:\/\/\S+$/i.test(msg.content.trim())) {
    const url = msg.content.trim();
    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    return {
      url,
      title: url,
      domain,
    };
  }
  return null;
}

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (content.includes('clientDelMsgId') || content.includes('globalDelMsgId') || content.includes('deleteMsg')) {
    return '🗑️ Tin nhắn đã thu hồi';
  }
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    let params = p.params;
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }

    // If call
    if (p.action?.includes('call') || p.title === 'sendBubbleMessage' || p.description === 'Cuộc gọi' || params?.callId !== undefined) {
      const dur = Number(params?.duration || 0);
      const isCaller = Number(params?.isCaller || 0);
      if (dur === 0 || p.action?.includes('miss')) {
        return isCaller === 1 ? '📞 Cuộc gọi nhỡ đi' : '📞 Cuộc gọi đến nhỡ';
      }
      return `📞 Cuộc gọi thoại (${dur > 60 ? Math.floor(dur / 60) + 'p' + (dur % 60) + 's' : dur + 's'})`;
    }

    // If voice
    if (p.action?.includes('voice') || (p.href && p.href.includes('voice-aac-dl'))) {
      const durMs = Number(params?.duration || 0);
      return durMs > 0 ? `🎤 Tin nhắn thoại (${Math.round(durMs / 1000)}s)` : '🎤 Tin nhắn thoại';
    }

    // If pinned message
    if (p.title && p.title.includes('đã ghim')) {
      return `📌 ${p.title}`;
    }

    // If it's an empty media object, never render {"href":"","thumb":"","hdUrl":""}
    if ('href' in p && 'thumb' in p && 'hdUrl' in p && !p.href && !p.thumb && !p.hdUrl) {
      return p.title || p.caption || '';
    }

    const title = (p.title && p.title !== 'sendBubbleMessage' ? p.title : null) || params?.mediaTitle;
    if (title && p.href) return `🔗 ${title}`;
    if (title) return title;
    if (p.href) return `🔗 ${p.description || p.href}`;
    if (p.description) return p.description;
    if (p.msg) return p.msg;
    return '';
  } catch { return content; }
}

/** Render message text with auto-clickable hyperlinks */
function renderMessageText(content: string | null): string {
  const display = parseDisplayContent(content);
  if (!display) return '';
  // Escape HTML entities to prevent XSS
  const escaped = display
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  // Replace URLs with clickable anchors
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return escaped.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; word-break: break-all;">${url}</a>`;
  });
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
  return null;
}

/** Sync Zalo reminder to CRM appointments via API */
async function syncAppointment(msg: Message) {
  if (!props.conversation?.contact?.id) { syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' }; return; }
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; }
    }
    if (!appointmentDate) { syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' }; return; }
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate,
      appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      type: 'tai_kham',
      notes: `[Zalo] ${p.title || ''}`,
    });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
  } catch (err: any) {
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
  }
}

watch(() => props.messages.length, async () => { await nextTick(); if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; });

function getStaffColor(name: string | null | undefined): string {
  if (!name) return '#007AFF';
  if (['adameva', 'eva'].includes(name.toLowerCase())) {
    return '#E11D48'; // Rich rose-red for Eva AI
  }
  if (name.toLowerCase() === 'adam eva') {
    return '#059669'; // Rich emerald green for Adam Eva human replies
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#0284C7', // Sky blue
    '#2563EB', // Royal blue
    '#D97706', // Rich amber
    '#7C3AED', // Deep purple
    '#059669', // Emerald
    '#E11D48', // Rose red
    '#EA580C', // Deep orange
    '#0D9488', // Deep teal
    '#9333EA', // Violet
    '#4F46E5', // Indigo
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

async function toggleGroupTracking() {
  if (!props.conversation) return;
  updatingQuote.value = true;
  try {
    const nextState = !props.conversation.isCustomer;
    const res = await api.patch(`/conversations/${props.conversation.id}/quote-settings`, {
      isCustomer: nextState
    });
    props.conversation.isCustomer = res.data.isCustomer;
    props.conversation.quoteCompleted = res.data.quoteCompleted;
    props.conversation.quoteCompletedByName = res.data.quoteCompletedByName;
  } catch (err) {
    console.error('Failed to toggle group tracking:', err);
  } finally {
    updatingQuote.value = false;
  }
}
</script>

<style scoped>
.message-bubble { 
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); 
  font-size: 0.94rem;
  line-height: 1.5;
  letter-spacing: 0.1px;
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  tab-size: 4;
}

/* Staff bubble - Default */
.staff-bubble {
  border-radius: 16px 16px 4px 16px !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Customer bubble */
.customer-bubble {
  background: rgb(var(--v-theme-surface)) !important;
  color: rgb(var(--v-theme-on-surface)) !important;
  border-radius: 16px 16px 16px 4px !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
}

/* Voice Card */
.voice-card {
  min-width: 220px;
  max-width: 300px;
  background: rgba(var(--v-theme-surface), 0.85);
  backdrop-filter: blur(8px);
}
.voice-card-self {
  background: rgba(255, 255, 255, 0.18) !important;
  color: inherit;
}
.voice-card-contact {
  background: rgba(var(--v-theme-surface), 0.9) !important;
}
.voice-progress-bar {
  height: 6px;
  background: rgba(125, 125, 125, 0.3);
  position: relative;
  overflow: hidden;
  transition: height 0.15s;
}
.voice-progress-bar:hover {
  height: 8px;
}
.voice-progress-fill {
  height: 100%;
  background: rgb(var(--v-theme-primary));
  transition: width 0.1s linear;
}
.staff-bubble .voice-progress-fill {
  background: #ffffff;
}

/* Call Card */
.call-card {
  min-width: 240px;
  max-width: 320px;
  background: rgba(var(--v-theme-surface), 0.95);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.call-missed {
  background: rgba(239, 68, 68, 0.08) !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
}
.call-answered {
  background: rgba(16, 185, 129, 0.06) !important;
  border-color: rgba(16, 185, 129, 0.25) !important;
}

/* Link Card Rich */
.link-card-rich {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: transform 0.2s, box-shadow 0.2s;
}
.link-card-rich:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
}
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.reminder-card { padding: 8px 12px; border-left: 3px solid #FFB74D; border-radius: 8px; background: rgba(255, 183, 77, 0.08); }
.file-card {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
}
.chat-image {
  display: block;
  max-width: 100%;
  max-height: 320px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.2s;
}
.chat-image:hover { transform: scale(1.02); }

.chat-image-caption {
  font-size: 0.94rem;
  font-weight: 500;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.1px;
  color: inherit;
}
.staff-bubble .chat-image-caption {
  color: inherit;
  font-weight: 500;
}
.customer-bubble .chat-image-caption {
  color: inherit;
  font-weight: 500;
}

/* Timestamp styles */
.msg-time-self {
  opacity: 0.85;
}
.msg-time-contact {
  opacity: 0.75;
}

/* Date divider styling */
.date-divider-line {
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.date-divider-chip {
  background: rgba(var(--v-theme-surface), 0.95);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-weight: 600;
  font-size: 0.72rem !important;
  letter-spacing: 0.3px;
}

/* Theme adaptive chat input textarea */
.chat-input-textarea :deep(.v-field) {
  background-color: rgba(var(--v-theme-on-surface), 0.05) !important;
  border-radius: 24px !important;
  transition: all 0.2s ease;
}
.chat-input-textarea :deep(.v-field:hover) {
  background-color: rgba(var(--v-theme-on-surface), 0.08) !important;
}
.chat-input-textarea :deep(.v-field--focused) {
  background-color: rgba(var(--v-theme-surface), 0.95) !important;
  box-shadow: 0 0 10px rgba(var(--v-theme-primary), 0.25) !important;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.03); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-pulse {
  animation: pulse 1.5s infinite;
}
.task-thread-red {
  position: relative;
}
.task-thread-red::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #ff1744, #ff5252);
  z-index: 10;
  box-shadow: 0 0 12px rgba(255, 23, 68, 0.6);
}
.task-thread-red :deep(.chat-input-area) {
  border-top: 1px solid rgba(255, 23, 68, 0.15) !important;
  background: rgba(255, 23, 68, 0.02) !important;
}
.task-thread-red :deep(.pa-3.d-flex.align-center) {
  background: rgba(255, 23, 68, 0.04) !important;
  border-bottom: 1px solid rgba(255, 23, 68, 0.18) !important;
  transition: background-color 0.3s, border-color 0.3s;
}
.muted-chip {
  background: rgba(var(--v-theme-on-surface), 0.1) !important;
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15) !important;
}

/* Quoted Reply Block */
.quote-reply-box {
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.78rem;
  background: rgba(0, 0, 0, 0.08);
  border-left: 3px solid currentColor;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
  user-select: none;
}
.quote-reply-box:hover {
  opacity: 0.88;
  transform: translateY(-1px);
}
.quote-reply-content {
  padding: 5px 10px;
  overflow: hidden;
  width: 100%;
}
.quote-reply-author {
  font-weight: 700;
  font-size: 0.72rem;
  display: flex;
  align-items: center;
  line-height: 1.2;
  opacity: 0.95;
}
.quote-reply-snippet {
  font-size: 0.74rem;
  line-height: 1.3;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Staff bubble quote styling */
.staff-bubble .quote-reply-box {
  background: rgba(0, 0, 0, 0.2);
  border-left-color: rgba(255, 255, 255, 0.85);
  color: inherit;
}
.v-theme--light .staff-bubble .quote-reply-box,
.v-theme--light-apple .staff-bubble .quote-reply-box {
  background: rgba(0, 0, 0, 0.06);
  border-left-color: #007aff;
  color: #09090b;
}

/* Customer bubble quote styling */
.customer-bubble .quote-reply-box {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-left-color: rgb(var(--v-theme-primary));
}
.customer-bubble .quote-reply-author {
  color: rgb(var(--v-theme-primary));
}

/* Message bubble minimum width to ensure clean layout for short messages */
.message-bubble {
  min-width: 125px;
}

/* Action Icons inside message bubble footer */
.message-action-icons {
  opacity: 0;
  transition: opacity 0.2s ease;
  user-select: none;
}

.message-row:hover .message-action-icons {
  opacity: 1;
}

@media (max-width: 768px) {
  .message-action-icons {
    opacity: 0.75;
  }
}

.msg-action-btn {
  width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: inherit;
  opacity: 0.75;
  transition: all 0.15s ease;
  line-height: 1;
}

.msg-action-btn:hover {
  opacity: 1;
  transform: scale(1.15);
}

/* Theme-specific styles for action buttons */
.staff-bubble .msg-action-btn {
  color: #ffffff;
}
.staff-bubble .msg-action-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.v-theme--light .staff-bubble .msg-action-btn,
.v-theme--light-apple .staff-bubble .msg-action-btn {
  color: #52525B !important;
}
.v-theme--light .staff-bubble .msg-action-btn:hover,
.v-theme--light-apple .staff-bubble .msg-action-btn:hover {
  background: rgba(0, 0, 0, 0.08) !important;
  color: #09090B !important;
}

.customer-bubble .msg-action-btn {
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.customer-bubble .msg-action-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgb(var(--v-theme-primary));
}

/* Reply Preview Banner */
.reply-preview-banner {
  background: rgba(var(--v-theme-surface-variant), 0.45);
  backdrop-filter: blur(8px);
  border-top: 1px solid rgba(var(--v-border-color), 0.15);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.1);
  animation: slideDown 0.2s ease-out;
}
.reply-indicator-bar {
  width: 3px;
  height: 28px;
  background: rgb(var(--v-theme-primary));
  border-radius: 3px;
}

/* Highlight pulse when scrolling to message */
@keyframes highlightPulse {
  0% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.02); filter: brightness(1.2); }
  100% { transform: scale(1); filter: brightness(1); }
}
.message-highlight-pulse .message-bubble {
  animation: highlightPulse 0.8s ease-in-out;
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary)) !important;
}

.forwarded-tag {
  color: inherit;
}

/* 3-Dots Dropdown Menu Styling */
.message-more-menu-list {
  min-width: 195px !important;
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), 0.16) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28) !important;
}

.menu-item-action {
  min-height: 38px !important;
  padding: 6px 14px !important;
  cursor: pointer !important;
  transition: background-color 0.15s ease;
}

.menu-item-action:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

/* Mặc định màu đỏ cho Thu hồi & Xóa chỉ ở phía tôi trên TẤT CẢ phối màu giao diện */
.menu-item-danger,
.menu-item-danger :deep(.v-list-item-title),
.menu-item-danger :deep(.v-icon),
.action-danger-text,
.action-danger-icon,
.delete-for-me-btn,
.delete-for-me-btn :deep(.v-icon) {
  color: #ef4444 !important;
}

.menu-item-danger:hover {
  background-color: rgba(239, 68, 68, 0.12) !important;
}

.delete-for-me-btn {
  border-color: rgba(239, 68, 68, 0.5) !important;
}

.delete-for-me-btn:hover {
  background-color: rgba(239, 68, 68, 0.1) !important;
}

/* Multi-select bar & Row active */
.multi-select-bar {
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgba(var(--v-border-color), 0.18);
}

.multi-select-mode-active {
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}

.multi-select-mode-active:hover {
  background-color: rgba(var(--v-theme-primary), 0.04);
}

/* Appointment Dialog */
.appointment-dialog-card {
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.25) !important;
}
</style>
