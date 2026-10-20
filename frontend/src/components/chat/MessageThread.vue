<template>
  <div
    class="message-thread d-flex flex-column flex-grow-1 position-relative"
    style="height: 100%;"
    @dragenter="handleContainerDragEnter"
    @dragover.prevent="handleContainerDragOver"
    @dragleave="handleContainerDragLeave"
    @drop.prevent="handleContainerDrop"
  >
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- ── Zalo Drag & Drop File/Image Overlay (Image 1) ── -->
      <div
        v-if="isDraggingFile"
        class="zalo-drag-drop-overlay d-flex flex-column"
        @dragover.prevent
        @drop.prevent
      >
        <!-- Top Zone: Gửi nhanh -->
        <div
          class="zalo-dropzone zalo-dropzone-quick d-flex flex-column align-center justify-center flex-grow-1"
          :class="{ 'dropzone-active': activeDropZone === 'quick' }"
          @dragenter.prevent="activeDropZone = 'quick'"
          @dragover.prevent="activeDropZone = 'quick'"
          @drop.prevent="onDropQuickSend"
        >
          <!-- Top badge for file preview -->
          <div v-if="draggedFileLabel" class="dragged-file-indicator mb-auto mt-4 px-3 py-1 rounded-pill d-flex align-center">
            <v-icon size="14" class="mr-1.5" color="white">mdi-file-image-outline</v-icon>
            <span class="text-caption font-weight-medium text-white">{{ draggedFileLabel }}</span>
          </div>

          <!-- Center prompt -->
          <div class="text-center my-auto pointer-events-none">
            <div class="quick-send-title text-h6 font-weight-bold mb-1">Gửi nhanh</div>
            <div class="quick-send-desc text-body-2">Thả File hoặc Ảnh vào đây để gửi nhanh</div>
          </div>
        </div>

        <!-- Bottom Zone: Xem trước khi gửi -->
        <div
          class="zalo-dropzone zalo-dropzone-preview d-flex flex-column align-center justify-center py-4"
          :class="{ 'dropzone-active': activeDropZone === 'preview' }"
          @dragenter.prevent="activeDropZone = 'preview'"
          @dragover.prevent="activeDropZone = 'preview'"
          @drop.prevent="onDropPreviewSend"
        >
          <div class="preview-send-title text-subtitle-1 font-weight-bold mb-0.5 pointer-events-none">Xem trước khi gửi</div>
          <div class="preview-send-desc text-caption pointer-events-none">Thả File hoặc Ảnh vào đây để xem lại trước khi gửi</div>
        </div>
      </div>

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

            <!-- Trạng thái khách hàng (Customer Status Dropdown Chip) -->
            <v-menu location="bottom start" offset="4">
              <template #activator="{ props: statusMenuProps }">
                <v-chip
                  v-bind="statusMenuProps"
                  size="x-small"
                  variant="outlined"
                  class="font-weight-bold cursor-pointer status-header-chip"
                  :style="{
                    color: getStatusMeta(currentCustomerStatus).color,
                    borderColor: getStatusMeta(currentCustomerStatus).color + '60',
                    backgroundColor: getStatusMeta(currentCustomerStatus).color + '18',
                    height: '24px',
                    fontSize: '0.72rem'
                  }"
                >
                  <v-icon start size="14" class="mr-1">{{ getStatusMeta(currentCustomerStatus).icon }}</v-icon>
                  {{ getStatusMeta(currentCustomerStatus).text }}
                  <v-icon end size="12" class="ml-1 opacity-70">mdi-chevron-down</v-icon>
                </v-chip>
              </template>
              <v-card rounded="xl" elevation="8" class="pa-1.5" min-width="210">
                <div class="text-caption font-weight-bold px-2 py-1 text-medium-emphasis">Trạng thái khách hàng</div>
                <v-divider class="mb-1 opacity-20" />
                <v-list density="compact" nav class="pa-0">
                  <v-list-item
                    v-for="st in CUSTOMER_STATUSES"
                    :key="st.id"
                    rounded="lg"
                    class="status-select-item mb-0.5 cursor-pointer"
                    :class="{ 'is-active-status': getStatusMeta(currentCustomerStatus).id === st.id }"
                    @click="updateCustomerStatus(st.id)"
                  >
                    <template #prepend>
                      <v-icon size="17" :color="st.color" class="mr-2">{{ st.icon }}</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2 font-weight-medium">
                      {{ st.label }}
                    </v-list-item-title>
                    <template #append v-if="getStatusMeta(currentCustomerStatus).id === st.id">
                      <v-icon size="16" color="primary">mdi-check</v-icon>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card>
            </v-menu>
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

        <!-- Quick Tag / Phân loại nhanh Button with Popup Menu (Image 3) -->
        <v-menu location="bottom end" :close-on-content-click="false" v-model="quickTagMenuOpen">
          <template #activator="{ props: tagProps }">
            <v-btn
              v-bind="tagProps"
              :icon="quickTagMenuOpen || currentContactTags.length ? 'mdi-tag-multiple' : 'mdi-tag-multiple-outline'"
              size="small"
              variant="text"
              class="mr-1"
              title="Phân loại nhanh (Chọn nhiều nhãn)"
              aria-label="Phân loại nhanh"
              :color="quickTagMenuOpen || currentContactTags.length ? 'primary' : undefined"
            />
          </template>
          <v-card min-width="260" rounded="xl" elevation="10" class="pa-2 category-popup-card">
            <div class="d-flex align-center justify-space-between px-2 py-1 mb-1">
              <span class="text-caption font-weight-bold text-uppercase text-medium-emphasis" style="letter-spacing: 0.5px;">Phân loại nhanh</span>
              <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-medium">
                {{ currentContactTags.length }} nhãn
              </v-chip>
            </div>
            <v-divider class="mb-1" />
            <v-list density="compact" nav class="pa-0">
              <v-list-item
                v-for="cat in CONVERSATION_CATEGORIES"
                :key="cat.title"
                @click="toggleContactTag(cat.title)"
                rounded="lg"
                class="category-select-item mb-1 cursor-pointer"
                :class="{ 'is-selected': currentContactTags.includes(cat.title) || (cat.title === 'KH quan trọng' && currentContactTags.includes('Khách hàng quan trọng')) }"
              >
                <template #prepend>
                  <v-icon :icon="cat.icon" :style="{ color: cat.color }" size="18" class="mr-2.5" />
                </template>
                <v-list-item-title class="text-body-2 font-weight-medium">
                  {{ cat.title }}
                </v-list-item-title>
                <template #append>
                  <v-icon
                    v-if="currentContactTags.includes(cat.title) || (cat.title === 'KH quan trọng' && currentContactTags.includes('Khách hàng quan trọng'))"
                    icon="mdi-check-circle"
                    size="19"
                    color="#2E5C43"
                  />
                  <v-icon
                    v-else
                    icon="mdi-plus-circle-outline"
                    size="19"
                    class="text-medium-emphasis opacity-40"
                  />
                </template>
              </v-list-item>
            </v-list>
          </v-card>
        </v-menu>

        <!-- Nút Ghim Lưu ý KH / Đơn hàng -->
        <v-btn
          :icon="currentPinnedNote ? 'mdi-pin' : 'mdi-pin-outline'"
          size="small"
          variant="text"
          class="mr-1"
          :title="currentPinnedNote ? 'Chỉnh sửa lưu ý đã ghim' : 'Ghim lưu ý khách hàng / đơn hàng'"
          :color="currentPinnedNote ? 'amber-darken-3' : undefined"
          @click="openNoteDialog"
        />

        <!-- Quản trị Nhóm Chat Button (Chỉ hiện khi là Group) -->
        <v-btn
          v-if="conversation.threadType === 'group'"
          :icon="showGroupDrawer ? 'mdi-account-cog' : 'mdi-account-cog-outline'"
          size="small"
          variant="text"
          class="mr-1"
          title="Quản trị nhóm Zalo"
          :color="showGroupDrawer ? 'primary' : undefined"
          @click="showGroupDrawer = !showGroupDrawer"
        />

        <!-- Gọi Điện Thoại Button (Chỉ hiện khi là chat 1-1 với khách) -->
        <v-btn
          v-if="conversation.threadType !== 'group'"
          icon="mdi-phone-outline"
          size="small"
          variant="text"
          class="mr-1"
          title="Gọi điện thoại cho khách hàng"
          color="success"
          @click="openCallDialog"
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

      <aside v-if="currentPinnedNote" class="pinned-note-strip" :class="{ 'pinned-note-vip': currentCustomerStatus === 'vip' || currentCustomerStatus === 'completed', 'pinned-note-urgent': currentCustomerStatus === 'warning', 'pinned-note-dark': noteIsDark }" aria-label="Ghi chú nội bộ đã ghim">
        <v-icon size="16" class="pin-icon" aria-hidden="true">mdi-pin-outline</v-icon>
        <div class="pinned-note-body">
          <button type="button" class="pinned-note-copy" title="Xem và chỉnh sửa ghi chú" @click="openNoteDialog">
            <span class="pinned-note-badge">Ghi chú nội bộ</span>
            <span ref="pinnedNotePreview" class="note-text-preview" :class="{ 'note-text-expanded': noteExpanded }">{{ currentPinnedNote }}</span>
          </button>
          <button v-if="noteOverflows || noteExpanded" type="button" class="note-expand-btn" :aria-expanded="noteExpanded" @click="noteExpanded = !noteExpanded">{{ noteExpanded ? 'Thu gọn' : 'Xem thêm' }}<v-icon size="12">{{ noteExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon></button>
        </div>
        <div class="pinned-note-actions">
          <v-btn icon="mdi-pencil-outline" size="x-small" variant="text" class="note-action-btn" title="Chỉnh sửa ghi chú" aria-label="Chỉnh sửa ghi chú" @click="openNoteDialog" />
          <v-btn icon="mdi-close" size="x-small" variant="text" class="note-action-btn" title="Gỡ ghi chú này" aria-label="Gỡ ghi chú này" :loading="savingNote" @click="clearPinnedNote" />
        </div>
      </aside>

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
            class="mb-2 d-flex message-row position-relative align-end"
            :class="[
              msg.senderType === 'self' ? 'justify-end' : 'justify-start',
              { 'multi-select-mode-active': isMultiSelectMode }
            ]"
            @click="isMultiSelectMode ? toggleMsgSelect(msg) : undefined"
          >
            <!-- Checkbox when in multi-select mode -->
            <div
              v-if="isMultiSelectMode"
              class="d-flex align-center mr-2 flex-shrink-0 cursor-pointer mb-2"
              style="order: 0;"
              @click.stop="toggleMsgSelect(msg)"
            >
              <v-checkbox-btn
                :model-value="selectedMsgIds.has(msg.id)"
                color="primary"
                density="compact"
              />
            </div>

            <!-- OUTSIDE ACTION BUTTONS (Image 2 & Image 3) -->
            <div
              v-if="!msg.isDeleted && !isMultiSelectMode"
              class="message-outside-actions d-flex align-center mb-1.5"
              :style="{
                order: msg.senderType === 'self' ? 1 : 2,
                marginLeft: msg.senderType === 'self' ? '0' : '8px',
                marginRight: msg.senderType === 'self' ? '8px' : '0',
              }"
            >
              <!-- 1. Trả lời (Quote ❝) -->
              <button class="msg-outside-btn" title="Trả lời tin nhắn" @click.stop="startReply(msg)">
                <v-icon size="14">mdi-format-quote-close</v-icon>
              </button>

              <!-- 2. Chuyển tiếp (Forward ➜) -->
              <button class="msg-outside-btn" title="Chuyển tiếp" @click.stop="startForward(msg)">
                <v-icon size="14">mdi-share</v-icon>
              </button>

              <!-- 3. Ba chấm ... (Menu Image 4) -->
              <v-menu
                :location="msg.senderType === 'self' ? 'top end' : 'top start'"
                :close-on-content-click="true"
                offset="6"
              >
                <template #activator="{ props: menuProps }">
                  <button class="msg-outside-btn" title="Thêm tùy chọn" v-bind="menuProps" @click.stop>
                    <v-icon size="14">mdi-dots-horizontal</v-icon>
                  </button>
                </template>

                <v-list density="compact" class="py-1 message-zalo-menu-list rounded-xl" elevation="10" min-width="190">
                  <!-- Copy tin nhắn -->
                  <v-list-item density="compact" class="zalo-menu-item" @click="copyMessageContent(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5">mdi-content-copy</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium">Copy tin nhắn</v-list-item-title>
                  </v-list-item>

                  <!-- Ghim tin nhắn -->
                  <v-list-item density="compact" class="zalo-menu-item" @click="pinMessage(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5">mdi-pin-outline</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium">Ghim tin nhắn</v-list-item-title>
                  </v-list-item>

                  <!-- Đánh dấu tin nhắn -->
                  <v-list-item density="compact" class="zalo-menu-item" @click="starMessage(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5">mdi-star-outline</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium">Đánh dấu tin nhắn</v-list-item-title>
                  </v-list-item>

                  <!-- Chọn nhiều tin nhắn -->
                  <v-list-item density="compact" class="zalo-menu-item" @click="enterMultiSelectMode(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5">mdi-format-list-checks</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium">Chọn nhiều tin nhắn</v-list-item-title>
                  </v-list-item>

                  <!-- Xem chi tiết -->
                  <v-list-item density="compact" class="zalo-menu-item" @click="showMessageDetails(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5">mdi-information-outline</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium">Xem chi tiết</v-list-item-title>
                  </v-list-item>

                  <!-- Tuỳ chọn khác (Tạo nhắc hẹn, Thu hồi) -->
                  <v-menu :location="msg.senderType === 'self' ? 'start top' : 'end top'" :close-on-content-click="true" offset="4" open-on-hover>
                    <template #activator="{ props: subMenuProps }">
                      <v-list-item density="compact" class="zalo-menu-item" v-bind="subMenuProps">
                        <template #prepend><v-icon size="17" class="mr-2.5">mdi-dots-horizontal-circle-outline</v-icon></template>
                        <v-list-item-title class="text-caption font-weight-medium">Tuỳ chọn khác</v-list-item-title>
                        <template #append><v-icon size="14">mdi-chevron-right</v-icon></template>
                      </v-list-item>
                    </template>
                    <v-list density="compact" class="py-1 message-zalo-menu-list rounded-xl" elevation="10" min-width="170">
                      <v-list-item density="compact" class="zalo-menu-item" @click="openAppointmentDialog(msg)">
                        <template #prepend><v-icon size="16" class="mr-2">mdi-calendar-clock</v-icon></template>
                        <v-list-item-title class="text-caption font-weight-medium">Tạo nhắc hẹn</v-list-item-title>
                      </v-list-item>
                      <v-list-item density="compact" class="zalo-menu-item menu-item-danger" @click="handleRecall(msg)">
                        <template #prepend><v-icon size="16" class="mr-2 action-danger-icon">mdi-backup-restore</v-icon></template>
                        <v-list-item-title class="text-caption font-weight-medium action-danger-text">Thu hồi</v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>

                  <v-divider class="my-1 opacity-20" />

                  <!-- Xóa chỉ ở phía tôi -->
                  <v-list-item density="compact" class="zalo-menu-item menu-item-danger" @click="handleDeleteOnlyMe(msg)">
                    <template #prepend><v-icon size="17" class="mr-2.5 action-danger-icon">mdi-delete-outline</v-icon></template>
                    <v-list-item-title class="text-caption font-weight-medium action-danger-text">Xóa chỉ ở phía tôi</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>

            <div class="message-wrapper position-relative" :style="{ order: msg.senderType === 'self' ? 2 : 1, maxWidth: '70%' }">
              <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 font-weight-medium text-primary">
                {{ msg.senderName || 'Unknown' }}
              </div>
              <div
                class="message-bubble position-relative"
                :class="[
                  msg.senderType === 'self' ? 'staff-bubble' : 'customer-bubble',
                  msg.contentType === 'sticker'
                    ? 'pa-0 sticker-bubble'
                    : (getContactCardInfo(msg)
                        ? 'pa-0 contact-card-bubble'
                        : (getImageUrl(msg) ? 'pa-0 image-bubble' : 'pa-3 px-4')),
                  getImageUrl(msg) && msg.senderType === 'self' ? 'image-bubble-self' : '',
                  getContactCardInfo(msg) && msg.senderType === 'self' ? 'contact-bubble-self' : ''
                ]"
                style="word-wrap: break-word;"
              >
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
                <div v-if="msg.isDeleted" class="recalled-message-box d-flex align-center font-italic text-medium-emphasis py-1" style="opacity: 0.8; gap: 6px;">
                  <v-icon size="16" class="opacity-70">mdi-delete-clock-outline</v-icon>
                  <span class="text-body-2">{{ getDeletedDisplay(msg) }}</span>
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

                <!-- Bank Card & VietQR -->
                <div v-else-if="getBankCardInfo(msg)" class="bank-card-bubble pa-3 rounded-xl border" style="max-width: 320px; background: rgba(var(--v-theme-surface), 0.95);">
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div class="d-flex align-center" style="gap: 6px;">
                      <v-avatar size="28" color="primary" variant="tonal" rounded="lg">
                        <v-icon size="16" color="primary">mdi-bank</v-icon>
                      </v-avatar>
                      <span class="text-caption font-weight-bold text-truncate" style="max-width: 170px;">
                        {{ getBankCardInfo(msg)!.bankName }}
                      </span>
                    </div>
                    <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold" style="font-size: 0.65rem;">
                      Napas247
                    </v-chip>
                  </div>

                  <div v-if="getBankCardInfo(msg)!.vietQrUrl" class="text-center my-2 cursor-pointer" @click="openImagePreviewDirect(getBankCardInfo(msg)!.vietQrUrl!)" title="Nhấn để phóng to mã VietQR">
                    <img
                      :src="getBankCardInfo(msg)!.vietQrUrl!"
                      alt="VietQR"
                      class="rounded-lg border"
                      style="max-width: 170px; height: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.06);"
                      loading="lazy"
                    />
                    <div class="text-caption mt-1" style="font-size: 0.68rem; opacity: 0.7;">
                      <v-icon size="11">mdi-magnify-plus-outline</v-icon> Bấm để phóng to QR
                    </div>
                  </div>

                  <div class="bank-details-box pa-2 rounded-lg" style="background: rgba(var(--v-theme-surface-variant), 0.35); font-size: 0.78rem;">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <span class="text-caption text-medium-emphasis">Số TK:</span>
                      <div class="d-flex align-center" style="gap: 4px;">
                        <span class="font-weight-bold text-primary" style="letter-spacing: 0.5px;">
                          {{ getBankCardInfo(msg)!.numAccBank }}
                        </span>
                        <v-btn
                          icon="mdi-content-copy"
                          size="x-small"
                          variant="text"
                          density="compact"
                          color="primary"
                          title="Sao chép số tài khoản"
                          @click.stop="copyToClipboard(getBankCardInfo(msg)!.numAccBank, 'số tài khoản')"
                        />
                      </div>
                    </div>

                    <div class="d-flex align-center justify-space-between mb-1">
                      <span class="text-caption text-medium-emphasis">Chủ TK:</span>
                      <span class="font-weight-bold text-truncate" style="max-width: 180px;">
                        {{ getBankCardInfo(msg)!.nameAccBank }}
                      </span>
                    </div>

                    <div v-if="getBankCardInfo(msg)!.amount && getBankCardInfo(msg)!.amount! > 0" class="d-flex align-center justify-space-between mb-1">
                      <span class="text-caption text-medium-emphasis">Số tiền:</span>
                      <span class="font-weight-bold text-success">
                        {{ getBankCardInfo(msg)!.amount!.toLocaleString('vi-VN') }} đ
                      </span>
                    </div>

                    <div v-if="getBankCardInfo(msg)!.note" class="d-flex align-center justify-space-between">
                      <span class="text-caption text-medium-emphasis">Nội dung:</span>
                      <span class="font-weight-medium text-truncate" style="max-width: 180px;">
                        {{ getBankCardInfo(msg)!.note }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Contact Card (Zalo Business Card matching Image 4) -->
                <div v-else-if="getContactCardInfo(msg)" class="zalo-contact-card-v4">
                  <!-- Upper body: Deep royal blue gradient with avatar and QR -->
                  <div class="zalo-card-top">
                    <!-- Left: Avatar + Name + Phone -->
                    <div class="d-flex align-center flex-grow-1 overflow-hidden" style="gap: 12px; z-index: 1;">
                      <v-avatar size="48" class="elevation-2 flex-shrink-0" style="border: 2px solid rgba(255, 255, 255, 0.85); background: #167a4c;">
                        <v-img v-if="getContactCardInfo(msg)!.avatar" :src="getContactCardInfo(msg)!.avatar" cover />
                        <span v-else class="text-subtitle-1 font-weight-bold text-white">{{ (getContactCardInfo(msg)!.name || 'U')[0] }}</span>
                      </v-avatar>
                      <div class="overflow-hidden">
                        <div class="text-subtitle-1 font-weight-bold text-white text-truncate" style="line-height: 1.25;">
                          {{ getContactCardInfo(msg)!.name }}
                        </div>
                        <div class="text-caption font-weight-medium text-truncate mt-0.5" style="color: rgba(255, 255, 255, 0.85); font-size: 0.85rem;">
                          {{ getContactCardInfo(msg)!.phone || 'Danh thiếp Zalo' }}
                        </div>
                      </div>
                    </div>

                    <!-- Right: QR Code box (clickable to zoom) -->
                    <div
                      class="zalo-card-qr-box flex-shrink-0 cursor-pointer"
                      @click.stop="openImagePreviewDirect(getContactQrFallback(getContactCardInfo(msg)!), `Mã QR Zalo - ${getContactCardInfo(msg)!.name}`)"
                      title="Nhấn để phóng to mã QR"
                      style="z-index: 1;"
                    >
                      <img
                        :src="getContactQrFallback(getContactCardInfo(msg)!)"
                        alt="QR Code"
                        class="zalo-card-qr-img"
                      />
                    </div>
                  </div>

                  <!-- Bottom footer: Dark navy bar with 2 action buttons -->
                  <div class="zalo-card-footer d-flex align-center">
                    <button
                      type="button"
                      class="zalo-card-btn"
                      @click.stop="onContactCall(getContactCardInfo(msg)!.phone)"
                      :disabled="!getContactCardInfo(msg)!.phone"
                    >
                      Gọi Điện
                    </button>
                    <div class="zalo-card-divider"></div>
                    <button
                      type="button"
                      class="zalo-card-btn"
                      @click.stop="onContactMessage(getContactCardInfo(msg)!)"
                    >
                      Nhắn Tin
                    </button>
                  </div>
                </div>

                <!-- Sticker Zalo (hiển thị y nguyên sticker từ Zalo) -->
                <div v-else-if="msg.contentType === 'sticker'" class="sticker-message-container py-1">
                  <img
                    v-if="getStickerUrl(msg)"
                    :src="getStickerUrl(msg)!"
                    alt="Sticker Zalo"
                    class="zalo-sticker-img"
                    loading="lazy"
                    @click.stop="openImagePreviewDirect(getStickerUrl(msg)!, 'Sticker Zalo')"
                    title="Nhấn để phóng to sticker"
                  />
                  <div v-else class="text-caption text-medium-emphasis d-flex align-center pa-2">
                    🏷️ Sticker
                  </div>
                </div>
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

                <!-- Link preview (Format matching Image 2) -->
                <div v-else-if="getLinkInfo(msg)" class="link-preview-v2">
                  <!-- Line 1: Clickable Full URL -->
                  <a
                    :href="getLinkInfo(msg)!.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-url-text"
                  >
                    {{ getLinkInfo(msg)!.url }}
                  </a>

                  <!-- Line 2: Bold Title -->
                  <div
                    v-if="getLinkInfo(msg)!.title && getLinkInfo(msg)!.title !== getLinkInfo(msg)!.url"
                    class="link-title-text"
                  >
                    <a
                      :href="getLinkInfo(msg)!.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-decoration-none"
                      style="color: inherit;"
                    >
                      {{ getLinkInfo(msg)!.title }}
                    </a>
                  </div>

                  <!-- Line 3: Description snippet -->
                  <div
                    v-if="getLinkInfo(msg)!.description && getLinkInfo(msg)!.description !== getLinkInfo(msg)!.title"
                    class="link-desc-text"
                  >
                    {{ getLinkInfo(msg)!.description }}
                  </div>

                  <!-- Line 4: Clickable domain -->
                  <div class="link-domain-text">
                    <a
                      :href="getLinkInfo(msg)!.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="link-domain-link"
                    >
                      {{ formatLinkDomain(getLinkInfo(msg)!) }}
                    </a>
                  </div>
                </div>
                <!-- Default text -->
                <div v-else class="message-text" v-html="renderMessageText(msg.content)"></div>
                <!-- Timestamp row underneath chat content -->
                <div class="text-caption mt-1.5 msg-time d-flex align-center justify-space-between" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem; gap: 8px;">
                  <!-- Left side: Staff badge (if self) -->
                  <div class="d-flex align-center" style="gap: 6px;">
                    <span
                      v-if="msg.senderType === 'self' && (msg.repliedBy || msg.senderName)"
                      class="px-2 py-0.5 rounded text-white text-caption font-weight-bold"
                      :style="{ backgroundColor: getStaffColor(msg.repliedBy?.fullName || msg.senderName), fontSize: '0.62rem', borderRadius: '4px !important', letterSpacing: '0.5px', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }"
                    >
                      {{ (msg.repliedBy?.fullName || (String(msg.senderName).toLowerCase() === 'adameva' ? 'Eva' : msg.senderName) || 'AI').toUpperCase() }}
                    </span>
                  </div>

                  <!-- Right side: Timestamp -->
                  <span class="msg-timestamp">{{ formatMessageTime(msg.sentAt) }}</span>
                </div>

                <!-- Corner Quick Reaction Badge (Chỉ hiển thị cho tin nhắn đối phương, phía mình không hiển thị) -->
                <v-menu
                  v-if="!msg.isDeleted && (msg.senderType !== 'self' || getMessageReaction(msg))"
                  open-on-hover
                  :open-on-click="true"
                  location="top center"
                  :close-on-content-click="true"
                  offset="6"
                  transition="scale-transition"
                >
                  <template #activator="{ props: reactionActivatorProps }">
                    <button
                      v-bind="reactionActivatorProps"
                      class="message-reaction-corner-badge"
                      :class="{
                        'has-reaction': !!getMessageReaction(msg),
                        'is-unreacted': !getMessageReaction(msg)
                      }"
                      :title="getMessageReaction(msg) ? `Cảm xúc: ${getMessageReaction(msg)} (Bấm để xóa hoặc đổi)` : 'Thả cảm xúc nhanh (Rê chuột để chọn icon)'"
                      @click.stop="onCornerBadgeClick(msg)"
                    >
                      <span v-if="getMessageReaction(msg)" class="corner-reaction-emoji">
                        {{ getMessageReaction(msg) }}
                      </span>
                      <v-icon v-else size="13" class="corner-reaction-default-icon">
                        mdi-heart-outline
                      </v-icon>
                    </button>
                  </template>

                  <div
                    class="d-flex align-center px-2 py-1 rounded-pill elevation-6 reaction-picker-bar"
                    style="gap: 6px; border: 1px solid rgba(var(--v-border-color), 0.15);"
                    @click.stop
                  >
                    <button
                      v-for="r in reactionList"
                      :key="r.name"
                      class="reaction-emoji-btn"
                      :title="r.title"
                      @click.stop="applyMsgReaction(msg, r.emoji)"
                    >
                      {{ r.emoji }}
                    </button>
                  </div>
                </v-menu>
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

      <!-- Input / Warning Banner (Bố cục chuẩn Zalo PC giống Image 1) -->
      <div v-else-if="canChat" class="chat-composer-box">
        <!-- ── Hàng 1: Toolbar công cụ giống Image 1 ── -->
        <div class="chat-toolbar d-flex align-center px-3 py-1.5" style="gap: 10px;">
          <!-- 1. Sticker / Biểu cảm -->
          <v-menu location="top start" :close-on-content-click="false">
            <template #activator="{ props: emojiMenuProps }">
              <button class="toolbar-btn" title="Biểu cảm & Nhãn dán" v-bind="emojiMenuProps">
                <v-icon size="19">mdi-emoticon-outline</v-icon>
              </button>
            </template>
            <v-card rounded="xl" elevation="6" class="pa-2 border" style="max-width: 290px;">
              <div class="text-caption font-weight-bold px-1 mb-1.5 text-medium-emphasis">Biểu cảm thường dùng</div>
              <div class="d-flex flex-wrap" style="gap: 6px;">
                <button
                  v-for="e in commonEmojis"
                  :key="e"
                  class="reaction-emoji-btn"
                  @click="insertEmoji(e)"
                >
                  {{ e }}
                </button>
              </div>
            </v-card>
          </v-menu>

          <!-- 2. Gửi hình ảnh -->
          <button
            class="toolbar-btn"
            :disabled="sending || sendingFile"
            title="Gửi hình ảnh từ Kho"
            @click="showMediaPicker = true"
          >
            <v-icon size="19">mdi-image-outline</v-icon>
          </button>

          <!-- 3. Đính kèm tệp -->
          <button
            class="toolbar-btn"
            :disabled="sending || sendingFile"
            title="Đính kèm file từ máy tính"
            @click="triggerFileInput"
          >
            <v-icon size="19">mdi-paperclip</v-icon>
          </button>
          <input type="file" ref="fileInput" class="d-none" accept="image/*, application/pdf, .doc, .docx, .xls, .xlsx, .txt, .zip, .rar" @change="handleFileChange" />

          <!-- 4. Gửi Danh thiếp -->
          <button
            class="toolbar-btn"
            :disabled="sending || sendingFile"
            title="Gửi Danh thiếp Zalo"
            @click="showContactCardModal = true"
          >
            <v-icon size="19">mdi-card-account-details-outline</v-icon>
          </button>

          <!-- 5. Chụp màn hình (Zalo Screenshot tool) -->
          <div class="d-flex align-center cursor-pointer" title="Chụp màn hình (Ctrl+V để dán)" @click="promptScreenshotTip">
            <button class="toolbar-btn">
              <v-icon size="19">mdi-crop</v-icon>
            </button>
            <v-icon size="14" style="opacity: 0.55; margin-left: -4px;">mdi-menu-down</v-icon>
          </div>

          <!-- 6. Định dạng chữ A -->
          <button class="toolbar-btn" title="Định dạng văn bản (In đậm)" @click="toggleTextFormatting">
            <v-icon size="19">mdi-format-size</v-icon>
          </button>

          <!-- 7. Tin nhắn nhanh (Icon sấm sét trong tin nhắn) -->
          <QuickRepliesMenu
            @select="onSelectQuickReply"
            @send-instant="onSendInstantQuickReply"
          />

          <!-- 8. Thẻ ngân hàng & QR -->
          <button
            class="toolbar-btn"
            :disabled="sending || sendingFile"
            title="Gửi Thẻ ngân hàng & VietQR"
            @click="showBankCardModal = true"
          >
            <v-icon size="19">mdi-credit-card-outline</v-icon>
          </button>

          <!-- 9. Nút Ba Chấm ... (Menu popup nổi bật chuẩn Image 1) -->
          <v-menu location="top start" offset="6">
            <template #activator="{ props: moreMenuProps }">
              <button class="toolbar-btn toolbar-more-active-btn" title="Thêm tùy chọn" v-bind="moreMenuProps">
                <v-icon size="18">mdi-dots-horizontal</v-icon>
              </button>
            </template>
            <v-list density="compact" class="py-1.5 zalo-popup-menu" rounded="xl" elevation="10" min-width="240">
              <!-- Tạo nhắc hẹn -->
              <v-list-item
                density="compact"
                class="zalo-popup-item cursor-pointer"
                @click="showZaloReminderModal = true"
              >
                <template #prepend>
                  <v-icon size="19" class="mr-3" color="amber-darken-2">mdi-alarm</v-icon>
                </template>
                <v-list-item-title class="text-body-2 font-weight-medium">Tạo nhắc hẹn</v-list-item-title>
              </v-list-item>

              <!-- Đánh dấu tin quan trọng -->
              <v-list-item
                density="compact"
                class="zalo-popup-item cursor-pointer"
                @click="markImportantMessage"
              >
                <template #prepend>
                  <v-icon size="19" class="mr-3" color="error">mdi-exclamation-thick</v-icon>
                </template>
                <v-list-item-title class="text-body-2 font-weight-medium">Đánh dấu tin quan trọng</v-list-item-title>
                <template #append>
                  <v-icon size="15" class="opacity-50">mdi-help-circle-outline</v-icon>
                </template>
              </v-list-item>

              <!-- Đánh dấu tin khẩn cấp -->
              <v-list-item
                density="compact"
                class="zalo-popup-item cursor-pointer"
                @click="markUrgentMessage"
              >
                <template #prepend>
                  <v-icon size="19" class="mr-3" color="deep-orange-darken-1">mdi-bell-outline</v-icon>
                </template>
                <v-list-item-title class="text-body-2 font-weight-medium">Đánh dấu tin khẩn cấp</v-list-item-title>
                <template #append>
                  <v-icon size="15" class="opacity-50">mdi-help-circle-outline</v-icon>
                </template>
              </v-list-item>

              <!-- Nếu là Group: Tạo bình chọn Poll -->
              <template v-if="conversation.threadType === 'group'">
                <v-divider class="my-1 opacity-20" />
                <v-list-item
                  density="compact"
                  class="zalo-popup-item cursor-pointer"
                  @click="showPollModal = true"
                >
                  <template #prepend>
                    <v-icon size="19" class="mr-3" color="info">mdi-poll</v-icon>
                  </template>
                  <v-list-item-title class="text-body-2 font-weight-medium">Tạo bình chọn nhóm</v-list-item-title>
                </v-list-item>
              </template>
            </v-list>
          </v-menu>
        </div>

        <!-- ── Hàng 2: Ô soạn thảo tin nhắn & Action bên phải giống Image 1 ── -->
        <div class="chat-input-row d-flex align-end px-3 pb-2 pt-1" style="gap: 8px;">
          <v-textarea
            v-model="inputText"
            :placeholder="chatRecipientName ? `Nhập tin nhắn tới ${chatRecipientName}...` : 'Nhập tin nhắn...'"
            variant="plain"
            density="compact"
            hide-details
            auto-grow
            rows="1"
            max-rows="6"
            aria-label="Soạn tin nhắn"
            class="chat-native-textarea flex-grow-1"
            @input="handleInputTyping"
            @keydown.enter.exact.prevent="handleSend"
          />

          <!-- Action bên phải ô nhập: Icon mặt cười & Like / Send -->
          <div class="d-flex align-center flex-shrink-0" style="gap: 6px; margin-bottom: 2px;">
            <v-menu location="top end" :close-on-content-click="false">
              <template #activator="{ props: subEmojiProps }">
                <button class="toolbar-btn" title="Chèn biểu cảm" v-bind="subEmojiProps">
                  <v-icon size="20">mdi-emoticon-outline</v-icon>
                </button>
              </template>
              <v-card rounded="xl" elevation="6" class="pa-2 border" style="max-width: 290px;">
                <div class="text-caption font-weight-bold px-1 mb-1.5 text-medium-emphasis">Biểu cảm</div>
                <div class="d-flex flex-wrap" style="gap: 6px;">
                  <button
                    v-for="e in commonEmojis"
                    :key="e"
                    class="reaction-emoji-btn"
                    @click="insertEmoji(e)"
                  >
                    {{ e }}
                  </button>
                </div>
              </v-card>
            </v-menu>

            <!-- Khi KHÔNG CÓ chữ: Nút Like màu vàng y hệt Image 1 -->
            <button
              v-if="!inputText.trim()"
              class="like-quick-btn"
              title="Gửi nhanh Like 👍"
              @click="handleSendLike"
            >
              👍
            </button>

            <!-- Khi CÓ chữ: Nút Gửi màu xanh -->
            <v-btn
              v-else
              icon="mdi-send"
              color="primary"
              variant="flat"
              size="small"
              density="comfortable"
              :loading="sending || sendingFile"
              title="Gửi tin nhắn (Enter)"
              @click="handleSend"
            />
          </div>
        </div>
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

    <!-- Dialog: Xem trước khi gửi (Image 1 - Bottom Drop Zone) -->
    <v-dialog v-model="previewSendDialog.show" max-width="540" persistent>
      <v-card class="rounded-xl overflow-hidden" elevation="16">
        <div class="pa-4 d-flex align-center justify-space-between border-b dialog-header-bg">
          <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="primary" size="20">mdi-eye-check-outline</v-icon>
            <span class="text-subtitle-1 font-weight-bold">Xem trước khi gửi</span>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="closePreviewSendDialog" />
        </div>

        <v-card-text class="pa-4">
          <!-- Image preview -->
          <div v-if="previewSendDialog.isImage" class="text-center mb-3">
            <img
              :src="previewSendDialog.previewUrl"
              alt="Preview"
              class="rounded-lg border"
              style="max-width: 100%; max-height: 280px; object-fit: contain; box-shadow: 0 4px 16px rgba(0,0,0,0.15);"
            />
            <div class="text-caption mt-1.5 text-medium-emphasis">
              {{ previewSendDialog.file?.name }} ({{ formatBytes(previewSendDialog.file?.size || 0) }})
            </div>
          </div>

          <!-- Non-image file preview -->
          <div v-else class="d-flex align-center pa-3 rounded-lg border mb-3" style="background: rgba(var(--v-theme-surface-variant), 0.3);">
            <v-avatar size="44" color="info" variant="tonal" rounded="lg" class="mr-3">
              <v-icon size="24" color="info">mdi-file-document-outline</v-icon>
            </v-avatar>
            <div class="flex-grow-1 text-truncate">
              <div class="text-body-2 font-weight-bold text-truncate">{{ previewSendDialog.file?.name }}</div>
              <div class="text-caption text-medium-emphasis">{{ formatBytes(previewSendDialog.file?.size || 0) }}</div>
            </div>
          </div>

          <!-- Lời nhắn kèm file / ảnh -->
          <v-textarea
            v-model="previewSendDialog.caption"
            placeholder="Thêm lời nhắn / ghi chú kèm theo (tùy chọn)..."
            rows="2"
            auto-grow
            variant="outlined"
            density="compact"
            hide-details
            rounded="lg"
            autofocus
            @keydown.enter.exact.prevent="submitPreviewSend"
          />
        </v-card-text>

        <v-card-actions class="pa-3 px-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="text" class="rounded-lg text-none px-4" @click="closePreviewSendDialog">
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="rounded-lg text-none px-6 font-weight-bold"
            prepend-icon="mdi-send"
            :loading="sendingFile"
            @click="submitPreviewSend"
          >
            Gửi ngay
          </v-btn>
        </v-card-actions>
      </v-card>
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

    <!-- Send Bank Card Modal -->
    <SendBankCardModal
      v-if="conversation"
      v-model="showBankCardModal"
      :conversation-id="conversation.id"
      @sent="onRichMessageSent"
    />

    <!-- Send Contact Card Modal -->
    <SendContactCardModal
      v-if="conversation"
      v-model="showContactCardModal"
      :conversation-id="conversation.id"
      @sent="onRichMessageSent"
    />

    <!-- Create Native Zalo Reminder Modal -->
    <CreateZaloReminderModal
      v-if="conversation"
      v-model="showZaloReminderModal"
      :conversation-id="conversation.id"
      @sent="onRichMessageSent"
    />

    <!-- Create Native Zalo Poll Modal (Giai đoạn 3) -->
    <CreatePollModal
      v-if="conversation && conversation.threadType === 'group'"
      v-model="showPollModal"
      :conversation-id="conversation.id"
      @created="onPollCreated"
    />

    <!-- Phone Call Modal (Gọi điện thoại cho khách hàng) -->
    <v-dialog v-model="showCallDialog" max-width="440">
      <v-card rounded="xl" elevation="16" class="pa-0 call-dialog-card overflow-hidden">
        <!-- Top header gradient -->
        <div class="pa-5 text-white position-relative call-dialog-header" style="background: linear-gradient(135deg, #0e5c38 0%, #15804e 55%, #1eb56c 100%);">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="d-flex align-center" style="gap: 8px;">
              <v-icon color="white" size="22">mdi-phone-in-talk</v-icon>
              <span class="text-subtitle-1 font-weight-bold">Gọi điện thoại</span>
            </div>
            <v-btn icon="mdi-close" variant="text" size="small" color="white" @click="showCallDialog = false" />
          </div>

          <div class="d-flex align-center mt-2" style="gap: 12px;">
            <v-avatar size="54" class="elevation-3 flex-shrink-0" style="border: 2px solid rgba(255, 255, 255, 0.85); background: #167a4c;">
              <v-img v-if="conversation?.contact?.avatarUrl" :src="conversation.contact.avatarUrl" cover />
              <span v-else class="text-h6 font-weight-bold text-white">{{ (conversation?.contact?.fullName || 'K')[0] }}</span>
            </v-avatar>
            <div class="overflow-hidden">
              <div class="text-subtitle-1 font-weight-bold text-truncate text-white">
                {{ conversation?.contact?.fullName || 'Khách hàng' }}
              </div>
              <div class="text-caption" style="color: rgba(255, 255, 255, 0.85);">
                {{ conversation?.zaloAccount?.displayName ? `Zalo: ${conversation.zaloAccount.displayName}` : 'Khách hàng Zalo' }}
              </div>
            </div>
          </div>
        </div>

        <v-card-text class="pa-5 d-flex flex-column" style="gap: 16px;">
          <!-- Khi ĐÃ CÓ số điện thoại -->
          <div v-if="conversation?.contact?.phone" class="d-flex flex-column align-center text-center pa-4 rounded-xl" style="background: rgba(var(--v-theme-surface-variant), 0.35); border: 1px solid rgba(var(--v-border-color), 0.12);">
            <div class="text-caption text-medium-emphasis mb-1">Số điện thoại khách hàng</div>
            <div class="text-h5 font-weight-bold tracking-wider mb-2" style="color: #15804e; letter-spacing: 1px;">
              {{ conversation.contact.phone }}
            </div>
            <div class="d-flex align-center" style="gap: 8px;">
              <v-btn
                size="small"
                variant="tonal"
                color="primary"
                rounded="pill"
                prepend-icon="mdi-content-copy"
                @click="copyToClipboard(conversation.contact.phone, 'Số điện thoại')"
              >
                Sao chép số
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                rounded="pill"
                color="medium-emphasis"
                prepend-icon="mdi-pencil-outline"
                @click="isEditingCallPhone = !isEditingCallPhone"
              >
                {{ isEditingCallPhone ? 'Đóng sửa' : 'Đổi số' }}
              </v-btn>
            </div>
          </div>

          <!-- Form chỉnh sửa/nhập số điện thoại nếu cần đổi hoặc chưa có -->
          <div v-if="!conversation?.contact?.phone || isEditingCallPhone" class="d-flex flex-column" style="gap: 10px;">
            <div class="text-caption font-weight-medium text-medium-emphasis">
              {{ conversation?.contact?.phone ? 'Nhập số điện thoại mới cho khách hàng:' : 'Khách hàng chưa có SĐT. Vui lòng nhập số để gọi:' }}
            </div>
            <v-text-field
              v-model="callPhoneInput"
              placeholder="Ví dụ: 0981155524"
              variant="outlined"
              density="compact"
              hide-details
              type="tel"
              prepend-inner-icon="mdi-phone"
              class="rounded-lg"
            />
          </div>

          <!-- Các nút hành động gọi điện -->
          <div class="d-flex flex-column" style="gap: 10px;">
            <!-- Nút gọi chính: Click to Call qua tel: -->
            <v-btn
              color="success"
              variant="flat"
              size="large"
              rounded="xl"
              prepend-icon="mdi-phone"
              class="font-weight-bold text-white elevation-2"
              style="height: 48px; background: linear-gradient(135deg, #15804e 0%, #1eb56c 100%) !important;"
              :loading="savingPhone"
              @click="(!conversation?.contact?.phone || isEditingCallPhone) ? handleSavePhoneAndCall() : handleMakePhoneCall(conversation.contact.phone)"
            >
              {{ (!conversation?.contact?.phone || isEditingCallPhone) ? 'Lưu & Gọi ngay' : 'Gọi ngay (Click-to-Call)' }}
            </v-btn>

            <!-- Nút mở chat / gọi qua Zalo -->
            <v-btn
              v-if="conversation?.contact?.phone || callPhoneInput"
              variant="outlined"
              color="primary"
              size="large"
              rounded="xl"
              prepend-icon="mdi-message-text-outline"
              class="font-weight-medium"
              style="height: 44px;"
              @click="handleOpenZaloCall(conversation?.contact?.phone || callPhoneInput)"
            >
              Mở trang liên hệ Zalo (zalo.me)
            </v-btn>
          </div>

          <!-- Ghi chú mẹo gọi điện -->
          <div class="pa-3 rounded-lg text-caption d-flex align-start" style="background: rgba(var(--v-theme-on-surface), 0.04); gap: 8px; line-height: 1.45;">
            <v-icon size="16" color="warning" class="flex-shrink-0 mt-0.5">mdi-information-outline</v-icon>
            <span class="text-medium-emphasis" style="font-size: 0.76rem;">
              Cuộc gọi Click-to-Call sẽ tự động mở ứng dụng gọi điện trên máy tính (FaceTime, Skype, Zoiper, Softphone tổng đài) hoặc chuyển tiếp cuộc gọi đến điện thoại của bạn.
            </span>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- ── Modal Cập nhật Trạng thái & Lưu ý Khách hàng / Đơn hàng ── -->
    <v-dialog v-model="showNoteDialog" max-width="500">
      <v-card rounded="xl" elevation="16" class="customer-note-dialog">
        <!-- Dialog Header -->
        <div class="pa-4 d-flex align-center justify-space-between border-b dialog-header-bg">
          <div class="d-flex align-center" style="gap: 10px;">
            <v-avatar size="38" color="amber-lighten-4">
              <v-icon color="amber-darken-3" size="22">mdi-pin</v-icon>
            </v-avatar>
            <div>
              <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2;">Lưu ý & Trạng thái khách hàng</div>
              <div class="text-caption text-medium-emphasis">Ghim lưu ý quan trọng lên đầu cuộc trò chuyện</div>
            </div>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showNoteDialog = false" />
        </div>

        <v-card-text class="pa-4">
          <!-- Khách hàng info bar -->
          <div class="d-flex align-center pa-2.5 rounded-lg mb-4" style="gap: 10px; background: rgba(var(--v-theme-surface-variant), 0.35);">
            <v-avatar size="32" color="grey-lighten-2">
              <v-img v-if="conversation?.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
              <v-icon v-else size="18">mdi-account</v-icon>
            </v-avatar>
            <div class="flex-grow-1 text-truncate">
              <div class="text-body-2 font-weight-bold text-truncate">{{ conversation?.contact?.fullName || 'Khách hàng' }}</div>
              <div class="text-caption text-medium-emphasis">{{ conversation?.contact?.phone || conversation?.zaloAccount?.displayName || 'Zalo Chat' }}</div>
            </div>
          </div>

          <!-- 1. Trạng thái làm việc với khách -->
          <div class="mb-4">
            <label class="text-caption font-weight-bold text-uppercase text-medium-emphasis mb-1.5 d-block" style="letter-spacing: 0.5px;">
              Trạng thái khách hàng
            </label>
            <div class="d-flex flex-wrap" style="gap: 6px;">
              <v-chip
                v-for="st in CUSTOMER_STATUSES"
                :key="st.value"
                size="small"
                :color="st.color"
                :variant="noteForm.status === st.value ? 'flat' : 'outlined'"
                class="font-weight-medium cursor-pointer"
                @click="noteForm.status = st.value"
              >
                <v-icon start size="14">{{ st.icon }}</v-icon>
                {{ st.text }}
              </v-chip>
            </div>
          </div>

          <!-- 2. Ô nhập Lưu ý / Yêu cầu của khách / Đơn hàng -->
          <div class="mb-3">
            <div class="d-flex align-center justify-space-between mb-1.5">
              <label class="text-caption font-weight-bold text-uppercase text-medium-emphasis" style="letter-spacing: 0.5px;">
                Dòng Lưu ý / Yêu cầu ghim ở trên
              </label>
              <span class="text-caption text-medium-emphasis">{{ noteForm.pinnedNote.length }}/200</span>
            </div>
            <v-textarea
              v-model="noteForm.pinnedNote"
              placeholder="Ví dụ: Khách muốn giao sau 17h, cần xuất hóa đơn VAT, đã cọc 500k, gọi xác nhận trước khi giao..."
              variant="outlined"
              rows="3"
              max-rows="6"
              auto-grow
              density="comfortable"
              counter="200"
              maxlength="200"
              class="rounded-lg"
              hide-details="auto"
            />
          </div>

          <!-- 3. Gợi ý mẫu lưu ý nhanh -->
          <div>
            <div class="text-caption text-medium-emphasis mb-1">Gợi ý nhanh:</div>
            <div class="d-flex flex-wrap" style="gap: 6px;">
              <v-chip
                v-for="preset in NOTE_PRESETS"
                :key="preset"
                size="x-small"
                variant="tonal"
                class="cursor-pointer"
                @click="insertNotePreset(preset)"
              >
                + {{ preset }}
              </v-chip>
            </div>
          </div>
        </v-card-text>

        <!-- Dialog Actions -->
        <v-divider />
        <v-card-actions class="pa-3 px-4 d-flex align-center justify-space-between">
          <v-btn
            v-if="currentPinnedNote"
            color="error"
            variant="text"
            size="small"
            prepend-icon="mdi-delete-outline"
            :loading="savingNote"
            @click="clearPinnedNote"
          >
            Gỡ lưu ý
          </v-btn>
          <div v-else></div>

          <div class="d-flex align-center" style="gap: 8px;">
            <v-btn variant="text" size="small" @click="showNoteDialog = false">Hủy</v-btn>
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              rounded="lg"
              prepend-icon="mdi-pin"
              class="px-4 font-weight-bold"
              :loading="savingNote"
              @click="saveCustomerNote"
            >
              Lưu & Ghim lên trên
            </v-btn>
          </div>
        </v-card-actions>
      </v-card>
    </v-dialog>

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

    <!-- Quản trị nhóm Zalo Drawer (Giai đoạn 2) -->
    <GroupManagementDrawer
      v-if="conversation && conversation.threadType === 'group'"
      v-model="showGroupDrawer"
      :conversation="conversation"
      @updated="onGroupUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted, reactive } from 'vue';
import { useTheme } from 'vuetify';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import ChatMediaPickerModal from './ChatMediaPickerModal.vue';
import QuickRepliesMenu from './QuickRepliesMenu.vue';
import ForwardMessageModal from './ForwardMessageModal.vue';
import SendBankCardModal from './SendBankCardModal.vue';
import SendContactCardModal from './SendContactCardModal.vue';
import CreateZaloReminderModal from './CreateZaloReminderModal.vue';
import GroupManagementDrawer from './GroupManagementDrawer.vue';
import CreatePollModal from './CreatePollModal.vue';
import { zaloExtendedApi } from '@/api/zalo-extended';
import { CONVERSATION_CATEGORIES } from '@/constants/conversation-categories';
import { CUSTOMER_STATUS_LIST, normalizeCustomerStatus } from '@/constants/customer-statuses';

const reactionList = [
  { name: 'like', emoji: '👍', title: 'Thích', icon: '👍' },
  { name: 'heart', emoji: '❤️', title: 'Yêu thích', icon: '❤️' },
  { name: 'haha', emoji: '😂', title: 'Haha', icon: '😂' },
  { name: 'wow', emoji: '😮', title: 'Wow', icon: '😮' },
  { name: 'sad', emoji: '😢', title: 'Buồn', icon: '😢' },
  { name: 'angry', emoji: '😡', title: 'Phẫn nộ', icon: '😡' },
];

const commonEmojis = [
  '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😊', '😍', '🥰',
  '😘', '👍', '❤️', '🔥', '🎉', '👏', '🤝', '🙏', '💯', '⭐',
  '😎', '🥳', '🤔', '😭', '😡', '🤐', '👋', '💪', '💰', '✨'
];

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

const chatRecipientName = computed(() => {
  if (!props.conversation) return 'My Documents';
  if (props.conversation.threadType === 'group') {
    return props.conversation.contact?.fullName || 'nhóm';
  }
  return props.conversation.contact?.fullName || 'khách hàng';
});

function insertEmoji(emoji: string) {
  inputText.value = (inputText.value || '') + emoji;
}

function handleSendLike() {
  emit('send', '👍', replyingTo.value?.id);
  replyingTo.value = null;
}

function markImportantMessage() {
  if (!inputText.value.startsWith('[Quan trọng] ')) {
    inputText.value = '[Quan trọng] ' + inputText.value;
  }
}

function markUrgentMessage() {
  if (!inputText.value.startsWith('[Khẩn cấp] ')) {
    inputText.value = '[Khẩn cấp] ' + inputText.value;
  }
}

function promptScreenshotTip() {
  syncSnack.value = {
    show: true,
    text: 'Mẹo: Bạn có thể nhấn phím chụp màn hình trên máy tính và nhấn Ctrl+V / Cmd+V để dán trực tiếp ảnh vào ô chat!',
    color: 'info',
  };
}

function toggleTextFormatting() {
  if (inputText.value.trim()) {
    inputText.value = `**${inputText.value}**`;
  } else {
    inputText.value = '**Nội dung in đậm**';
  }
}

const emit = defineEmits<{
  send: [content: string, quoteMessageId?: string];
  'send-file': [file: File, caption?: string];
  'recall-message': [messageId: string];
  'delete-message-for-me': [messageId: string];
  'toggle-mute': [convId: string, isMuted: boolean];
  'toggle-contact-panel': [];
  'group-updated': [];
  'contact-updated': [];
  back: [];
}>();

const quickTagMenuOpen = ref(false);

const localContactTags = ref<string[]>([]);

function syncContactTagsFromProp() {
  const raw = props.conversation?.contact?.tags;
  if (Array.isArray(raw)) {
    localContactTags.value = [...raw];
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      localContactTags.value = Array.isArray(parsed) ? parsed : (raw ? [raw] : []);
    } catch {
      localContactTags.value = raw ? [raw] : [];
    }
  } else {
    localContactTags.value = [];
  }
}

watch(
  () => [props.conversation?.id, props.conversation?.contact?.id, props.conversation?.contact?.tags],
  () => {
    syncContactTagsFromProp();
  },
  { immediate: true, deep: true }
);

const currentContactTags = computed<string[]>(() => {
  return localContactTags.value;
});

let saveTagsTimeout: any = null;
async function toggleContactTag(tagTitle: string) {
  const contact = props.conversation?.contact;
  if (!contact || !contact.id) return;

  const current = [...localContactTags.value];
  const idx = current.indexOf(tagTitle);
  if (idx !== -1) {
    current.splice(idx, 1);
  } else {
    current.push(tagTitle);
  }

  // Instant local update so selecting multiple items is smooth and immediate
  localContactTags.value = current;
  contact.tags = current;

  clearTimeout(saveTagsTimeout);
  saveTagsTimeout = setTimeout(async () => {
    try {
      await api.put(`/contacts/${contact.id}/tags`, { tags: localContactTags.value });
      emit('contact-updated');
    } catch (err) {
      console.error('Failed to update tags:', err);
    }
  }, 350);
}

const showGroupDrawer = ref(false);
const showPollModal = ref(false);

function onGroupUpdated() {
  emit('group-updated');
}

function onPollCreated() {
  syncSnack.value = { show: true, text: 'Đã tạo cuộc bình chọn Zalo thành công!', color: 'success' };
}

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
    const res = await api.post(`/conversations/${props.conversation.id}/messages/${msg.id}/undo`);
    msg.isDeleted = true;
    emit('recall-message', msg.id);
    if (res.data?.zaloSynced === false) {
      syncSnack.value = {
        show: true,
        text: 'Đã thu hồi trên CRM. Lưu ý: Zalo chính thức từ chối lệnh này (tin nhắn Danh thiếp hoặc đã hết hạn thu hồi trên Zalo).',
        color: 'warning'
      };
    } else {
      syncSnack.value = { show: true, text: 'Đã thu hồi tin nhắn cả 2 phía thành công!', color: 'success' };
    }
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

// Message Reactions state (msg.id -> emoji)
const messageReactions = ref<Record<string, string>>({});

function loadReactionsFromStorage() {
  try {
    const saved = localStorage.getItem('crm-msg-reactions');
    if (saved) {
      messageReactions.value = JSON.parse(saved);
    }
  } catch {}
}

function saveReactionsToStorage() {
  try {
    localStorage.setItem('crm-msg-reactions', JSON.stringify(messageReactions.value));
  } catch {}
}

function getMessageReaction(msg: Message): string | null {
  if (messageReactions.value[msg.id]) {
    return messageReactions.value[msg.id];
  }
  if (msg.zaloMsgId && messageReactions.value[msg.zaloMsgId]) {
    return messageReactions.value[msg.zaloMsgId];
  }
  if (msg.attachments) {
    let att = msg.attachments;
    if (typeof att === 'string') {
      try { att = JSON.parse(att); } catch {}
    }
    if (Array.isArray(att)) {
      const r = att.find((x: any) => x && (x.type === 'reaction' || x.reaction));
      if (r) return r.reaction || r.emoji || null;
    } else if (att && typeof att === 'object' && att.reaction) {
      return att.reaction;
    }
  }
  return null;
}

async function applyMsgReaction(msg: Message, reaction: string) {
  const current = getMessageReaction(msg);
  if (current === reaction) {
    // Toggle off
    delete messageReactions.value[msg.id];
    if (msg.zaloMsgId) delete messageReactions.value[msg.zaloMsgId];
    saveReactionsToStorage();
    if (props.conversation && msg.zaloMsgId) {
      zaloExtendedApi.addReaction(props.conversation.id, {
        zaloMsgId: msg.zaloMsgId,
        reaction: '',
      }).catch((err: any) => console.warn('Failed to remove reaction on Zalo:', err));
    }
    return;
  }

  // Update immediately for responsive UX
  messageReactions.value[msg.id] = reaction;
  if (msg.zaloMsgId) messageReactions.value[msg.zaloMsgId] = reaction;
  saveReactionsToStorage();

  if (props.conversation && msg.zaloMsgId) {
    try {
      await zaloExtendedApi.addReaction(props.conversation.id, {
        zaloMsgId: msg.zaloMsgId,
        reaction,
      });
      syncSnack.value = {
        show: true,
        text: `Đã thả cảm xúc ${reaction} vào tin nhắn!`,
        color: 'success',
      };
    } catch (err: any) {
      console.warn('Failed to sync reaction with Zalo:', err);
    }
  }
}

function onCornerBadgeClick(msg: Message) {
  const current = getMessageReaction(msg);
  if (current) {
    applyMsgReaction(msg, current);
  } else {
    applyMsgReaction(msg, '❤️');
  }
}

async function sendMsgReaction(msg: Message, reaction: string) {
  await applyMsgReaction(msg, reaction);
}
void sendMsgReaction;

function handleIncomingReactionEvent(e: any) {
  const data = e.detail;
  if (!data) return;
  const { messageId, zaloMsgId, reaction } = data;
  if (reaction) {
    if (messageId) messageReactions.value[messageId] = reaction;
    if (zaloMsgId) messageReactions.value[zaloMsgId] = reaction;
  } else {
    if (messageId) delete messageReactions.value[messageId];
    if (zaloMsgId) delete messageReactions.value[zaloMsgId];
  }
}

onMounted(() => {
  loadReactionsFromStorage();
  window.addEventListener('crm:message-reaction', handleIncomingReactionEvent);
});

onUnmounted(() => {
  window.removeEventListener('crm:message-reaction', handleIncomingReactionEvent);
});

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

function formatFullMessageTime(d: string) {
  try {
    return new Date(d).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return d;
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

function pinMessage(_msg: Message) {
  syncSnack.value = { show: true, text: 'Đã ghim tin nhắn này!', color: 'success' };
}

function starMessage(_msg: Message) {
  syncSnack.value = { show: true, text: 'Đã đánh dấu tin nhắn này!', color: 'success' };
}

function showMessageDetails(msg: Message) {
  const time = formatFullMessageTime(msg.sentAt);
  const sender = msg.senderType === 'self' ? 'Bạn' : (msg.senderName || 'Khách hàng');
  syncSnack.value = {
    show: true,
    text: `Người gửi: ${sender} • Lúc: ${time}${msg.zaloMsgId ? ` • Mã: ${msg.zaloMsgId}` : ''}`,
    color: 'info',
  };
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
const showBankCardModal = ref(false);
const showContactCardModal = ref(false);
const showZaloReminderModal = ref(false);

// ── Customer Status & Pinned Note (Lưu ý khách hàng / đơn hàng) ──
const CUSTOMER_STATUSES = CUSTOMER_STATUS_LIST;

const NOTE_PRESETS = [
  'Giao hàng sau 17h',
  'Yêu cầu xuất VAT',
  'Đã chuyển cọc',
  'Khách VIP ưu tiên',
  'Gọi trước khi giao',
  'Hẹn tư vấn lại',
];

const currentCustomerStatus = computed(() => {
  return props.conversation?.contact?.status || 'new';
});

const currentPinnedNote = computed(() => {
  const meta = props.conversation?.contact?.metadata as any;
  if (meta?.pinnedNote && typeof meta.pinnedNote === 'string') {
    return meta.pinnedNote;
  }
  const rawNotes = props.conversation?.contact?.notes;
  if (rawNotes && typeof rawNotes === 'string' && !rawNotes.startsWith('[') && !rawNotes.includes('[chuyển cho')) {
    return rawNotes;
  }
  return '';
});

function getStatusMeta(statusVal: string) {
  return normalizeCustomerStatus(statusVal);
}

const noteTheme = useTheme();
const noteIsDark = computed(() => noteTheme.current.value.dark);
const pinnedNotePreview = ref<HTMLElement | null>(null);
const noteExpanded = ref(false);
const noteOverflows = ref(false);
let noteResizeObserver: ResizeObserver | null = null;
function measureNoteOverflow() {
  if (noteExpanded.value) return;
  const el = pinnedNotePreview.value;
  noteOverflows.value = !!el && el.scrollHeight > el.clientHeight + 1;
}
watch(pinnedNotePreview, el => {
  noteResizeObserver?.disconnect();
  if (el) { noteResizeObserver = new ResizeObserver(measureNoteOverflow); noteResizeObserver.observe(el); }
  void nextTick(measureNoteOverflow);
});
watch(() => [props.conversation?.id, currentPinnedNote.value], () => {
  noteExpanded.value = false; noteOverflows.value = false;
  void nextTick(measureNoteOverflow);
});
watch(noteExpanded, () => { void nextTick(measureNoteOverflow); });
onUnmounted(() => noteResizeObserver?.disconnect());

const showNoteDialog = ref(false);
const savingNote = ref(false);
const noteForm = ref({
  status: 'new',
  pinnedNote: '',
});

function openNoteDialog() {
  noteForm.value.status = currentCustomerStatus.value;
  noteForm.value.pinnedNote = currentPinnedNote.value;
  showNoteDialog.value = true;
}

function insertNotePreset(preset: string) {
  if (!noteForm.value.pinnedNote) {
    noteForm.value.pinnedNote = preset;
  } else if (!noteForm.value.pinnedNote.includes(preset)) {
    noteForm.value.pinnedNote = `${noteForm.value.pinnedNote}, ${preset}`;
  }
}

async function saveCustomerNote() {
  if (!props.conversation?.id) return;
  savingNote.value = true;
  try {
    await api.patch(`/conversations/${props.conversation.id}/customer-note`, {
      status: noteForm.value.status,
      pinnedNote: noteForm.value.pinnedNote.trim(),
    });
    if (props.conversation.contact) {
      props.conversation.contact.status = noteForm.value.status;
      if (!props.conversation.contact.metadata) props.conversation.contact.metadata = {};
      (props.conversation.contact.metadata as any).pinnedNote = noteForm.value.pinnedNote.trim();
      props.conversation.contact.notes = noteForm.value.pinnedNote.trim();
    }
    showNoteDialog.value = false;
    syncSnack.value = { show: true, text: 'Đã lưu và ghim lưu ý khách hàng thành công!', color: 'success' };
  } catch (err: any) {
    console.error('Failed to save customer note:', err);
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Lưu ghi chú thất bại', color: 'error' };
  } finally {
    savingNote.value = false;
  }
}

function onContactStatusChangedEvent(e: Event) {
  const custom = e as CustomEvent;
  if (custom.detail?.conversationId === props.conversation?.id && props.conversation?.contact) {
    props.conversation.contact.status = custom.detail.status;
  }
}

onMounted(() => {
  window.addEventListener('crm:contact-status-changed', onContactStatusChangedEvent);
});

onUnmounted(() => {
  window.removeEventListener('crm:contact-status-changed', onContactStatusChangedEvent);
});

async function updateCustomerStatus(newStatus: string) {
  if (!props.conversation?.id) return;
  try {
    await api.patch(`/conversations/${props.conversation.id}/customer-note`, {
      status: newStatus,
    });
    if (props.conversation.contact) {
      props.conversation.contact.status = newStatus;
    }
    // Broadcast status change so right panel updates immediately
    window.dispatchEvent(new CustomEvent('crm:contact-status-changed', {
      detail: { conversationId: props.conversation.id, status: newStatus }
    }));
    syncSnack.value = {
      show: true,
      text: `Đã cập nhật trạng thái: "${getStatusMeta(newStatus).text}"`,
      color: 'success',
    };
  } catch (err: any) {
    console.error('Failed to update status:', err);
    syncSnack.value = { show: true, text: 'Đổi trạng thái thất bại', color: 'error' };
  }
}

async function clearPinnedNote() {
  if (!props.conversation?.id) return;
  savingNote.value = true;
  try {
    await api.patch(`/conversations/${props.conversation.id}/customer-note`, {
      pinnedNote: '',
    });
    if (props.conversation.contact) {
      if (!props.conversation.contact.metadata) props.conversation.contact.metadata = {};
      (props.conversation.contact.metadata as any).pinnedNote = '';
      props.conversation.contact.notes = '';
    }
    showNoteDialog.value = false;
    syncSnack.value = { show: true, text: 'Đã gỡ lưu ý đã ghim', color: 'success' };
  } catch (err: any) {
    console.error('Failed to clear pinned note:', err);
    syncSnack.value = { show: true, text: 'Gỡ lưu ý thất bại', color: 'error' };
  } finally {
    savingNote.value = false;
  }
}

const showCallDialog = ref(false);
const callPhoneInput = ref('');
const isEditingCallPhone = ref(false);
const savingPhone = ref(false);

function openCallDialog() {
  callPhoneInput.value = props.conversation?.contact?.phone || '';
  isEditingCallPhone.value = !props.conversation?.contact?.phone;
  showCallDialog.value = true;
}

function handleMakePhoneCall(phoneToCall?: string) {
  const phone = (phoneToCall || props.conversation?.contact?.phone || callPhoneInput.value || '').replace(/\s+/g, '');
  if (!phone) {
    syncSnack.value = { show: true, text: 'Vui lòng nhập số điện thoại để gọi', color: 'warning' };
    return;
  }
  window.open(`tel:${phone}`, '_self');
  syncSnack.value = { show: true, text: `Đang mở cuộc gọi đến ${phone}...`, color: 'success' };
  showCallDialog.value = false;
}

function handleOpenZaloCall(phoneToCall?: string) {
  const phone = (phoneToCall || props.conversation?.contact?.phone || callPhoneInput.value || '').replace(/\s+/g, '');
  if (!phone) {
    syncSnack.value = { show: true, text: 'Không có số điện thoại để mở Zalo', color: 'warning' };
    return;
  }
  window.open(`https://zalo.me/${phone}`, '_blank');
}

async function handleSavePhoneAndCall() {
  const phone = callPhoneInput.value.trim();
  if (!phone) {
    syncSnack.value = { show: true, text: 'Vui lòng nhập số điện thoại', color: 'warning' };
    return;
  }
  if (props.conversation?.contact?.id) {
    savingPhone.value = true;
    try {
      await api.put(`/contacts/${props.conversation.contact.id}`, { phone });
      if (props.conversation.contact) {
        props.conversation.contact.phone = phone;
      }
      isEditingCallPhone.value = false;
      syncSnack.value = { show: true, text: 'Đã lưu số điện thoại!', color: 'success' };
    } catch {
      // Continue even if save failed
    } finally {
      savingPhone.value = false;
    }
  }
  handleMakePhoneCall(phone);
}

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
void isOverdue;

const isUncompleted = computed(() => false);
void isUncompleted;

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
void toggleQuoteCompleted;

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

// ── Zalo Drag & Drop File/Image to Send (Image 1) ──────────────────────────
const isDraggingFile = ref(false);
const activeDropZone = ref<'quick' | 'preview' | null>(null);
const draggedFileLabel = ref<string>('');
let dragCounter = 0;

function handleContainerDragEnter(e: DragEvent) {
  if (e.dataTransfer?.types?.includes('Files')) {
    dragCounter++;
    isDraggingFile.value = true;
    if (activeDropZone.value === null) {
      activeDropZone.value = 'quick';
    }
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      draggedFileLabel.value = `${items.length} tệp đính kèm`;
    } else {
      draggedFileLabel.value = 'Thả file / ảnh tại đây';
    }
  }
}

function handleContainerDragOver(e: DragEvent) {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function handleContainerDragLeave(_e: DragEvent) {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDraggingFile.value = false;
    activeDropZone.value = null;
  }
}

function handleContainerDrop(_e: DragEvent) {
  isDraggingFile.value = false;
  dragCounter = 0;
  activeDropZone.value = null;
}

function onDropQuickSend(e: DragEvent) {
  isDraggingFile.value = false;
  dragCounter = 0;
  activeDropZone.value = null;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    emit('send-file', files[i]);
  }
}

const previewSendDialog = reactive({
  show: false,
  file: null as File | null,
  previewUrl: '',
  caption: '',
  isImage: false,
});

function onDropPreviewSend(e: DragEvent) {
  isDraggingFile.value = false;
  dragCounter = 0;
  activeDropZone.value = null;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const file = files[0];
  previewSendDialog.file = file;
  previewSendDialog.isImage = file.type.startsWith('image/');
  previewSendDialog.previewUrl = previewSendDialog.isImage ? URL.createObjectURL(file) : '';
  previewSendDialog.caption = '';
  previewSendDialog.show = true;
}

function closePreviewSendDialog() {
  if (previewSendDialog.previewUrl) {
    URL.revokeObjectURL(previewSendDialog.previewUrl);
    previewSendDialog.previewUrl = '';
  }
  previewSendDialog.file = null;
  previewSendDialog.caption = '';
  previewSendDialog.show = false;
}

async function submitPreviewSend() {
  if (!previewSendDialog.file) return;
  const file = previewSendDialog.file;
  const caption = previewSendDialog.caption.trim();
  closePreviewSendDialog();
  emit('send-file', file, caption);
}

function formatBytes(bytes: number, decimals = 1) {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
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

/** Extract sticker image URL from Zalo emoticon CDN */
function getStickerUrl(msg: Message): string | null {
  if (msg.contentType !== 'sticker') return null;

  // 1. Check attachments if available
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    const att = msg.attachments[0];
    if (att) {
      if (typeof att === 'string' && att.startsWith('http')) return att;
      if (att.url && typeof att.url === 'string') return att.url;
      if (att.stickerUrl) return att.stickerUrl;
      const attId = att.id || att.stickerId || att.eid || att.sid;
      if (attId) return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${attId}&size=200`;
    }
  }

  if (!msg.content) return null;
  const content = msg.content.trim();

  // 2. Direct HTTP URL
  if (content.startsWith('http')) return content;

  // 3. JSON format: {"id": 21456, "catId": 10302, "type": 7}
  if (content.startsWith('{')) {
    try {
      const data = JSON.parse(content);
      if (data.url && typeof data.url === 'string') return data.url;
      if (data.stickerUrl) return data.stickerUrl;
      const id = data.id || data.stickerId || data.eid || data.sid;
      if (id) {
        return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${id}&size=200`;
      }
    } catch {}
  }

  // 4. Plain numeric ID
  if (/^\d+$/.test(content)) {
    return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${content}&size=200`;
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

// ── Bank Card Info ──────────────────────────────────────────────────────────
export interface BankCardInfo {
  binBank: string;
  bankName: string;
  numAccBank: string;
  nameAccBank: string;
  amount?: number;
  note?: string;
  vietQrUrl?: string;
}

function getBankCardInfo(msg: Message): BankCardInfo | null {
  if (msg.contentType === 'bank_card' || msg.content?.includes('bank_card') || msg.content?.includes('numAccBank')) {
    try {
      if (msg.content?.startsWith('{')) {
        const p = JSON.parse(msg.content);
        if (p.type === 'bank_card' || p.binBank || p.numAccBank) {
          const bin = p.binBank || (msg.metadata as any)?.binBank || '';
          const num = p.numAccBank || (msg.metadata as any)?.numAccBank || '';
          const name = p.nameAccBank || (msg.metadata as any)?.nameAccBank || '';
          const bank = p.bankName || (msg.metadata as any)?.bankName || 'Ngân hàng';
          const amt = p.amount ?? (msg.metadata as any)?.amount ?? 0;
          const note = p.note || (msg.metadata as any)?.note || '';
          const vietQrUrl = p.vietQrUrl || (bin && num ? `https://img.vietqr.io/image/${bin}-${num}-compact2.png?amount=${amt}&addInfo=${encodeURIComponent(note)}&accountName=${encodeURIComponent(name)}` : '');
          return {
            binBank: bin,
            bankName: bank,
            numAccBank: num,
            nameAccBank: name,
            amount: amt,
            note,
            vietQrUrl,
          };
        }
      }
    } catch {}
  }
  return null;
}

function openImagePreviewDirect(url: string, caption = '') {
  previewImageUrl.value = url;
  previewImageCaption.value = caption;
}

function copyToClipboard(text: string, label = 'Số tài khoản') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    syncSnack.value = { show: true, text: `Đã sao chép ${label}!`, color: 'success' };
  }).catch(() => {
    syncSnack.value = { show: true, text: 'Không thể sao chép', color: 'error' };
  });
}

function onRichMessageSent(_msg?: any) {
  syncSnack.value = { show: true, text: 'Đã gửi thành công!', color: 'success' };
  nextTick(() => {
    scrollToBottom();
  });
}

let lastTypingTime = 0;
function handleInputTyping() {
  const now = Date.now();
  if (now - lastTypingTime > 3000 && props.conversation?.id) {
    lastTypingTime = now;
    api.post(`/conversations/${props.conversation.id}/typing`).catch(() => {});
  }
}

// ── Contact Card Info ──────────────────────────────────────────────────────
export interface ContactCardInfo {
  name: string;
  phone?: string;
  avatar?: string;
  qrCodeUrl?: string;
  userId?: string;
}

function getContactCardInfo(msg: Message): ContactCardInfo | null {
  if (
    msg.contentType === 'contact_card' ||
    msg.content?.includes('recommened.user') ||
    msg.content?.includes('qrCodeUrl') ||
    (typeof msg.content === 'string' && msg.content.includes('"phone"') && msg.content.includes('"qrCodeUrl"'))
  ) {
    try {
      if (msg.content?.startsWith('{')) {
        const p = JSON.parse(msg.content);
        let params = p.params;
        if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }

        // Also check if p.description is stringified JSON (common in Zalo contact cards)
        let descObj: any = null;
        if (typeof p.description === 'string' && p.description.trim().startsWith('{')) {
          try { descObj = JSON.parse(p.description); } catch {}
        }

        const phone = descObj?.phone || params?.phone || (typeof p.description === 'string' && !p.description.trim().startsWith('{') ? p.description : '') || '';
        const qrCodeUrl = descObj?.qrCodeUrl || params?.qrCodeUrl || p.qrCodeUrl || '';
        const avatar = descObj?.avatar || p.thumb || params?.avatar || '';
        const name = descObj?.name || p.title || params?.name || (phone ? `Liên hệ ${phone}` : 'Danh thiếp Zalo');
        const userId = descObj?.userId || params?.userId || p.userId || '';

        return {
          name,
          phone,
          avatar,
          qrCodeUrl,
          userId,
        };
      }
    } catch {}
  }
  return null;
}

function getContactQrFallback(card: ContactCardInfo): string {
  if (card.qrCodeUrl) return card.qrCodeUrl;
  const target = card.phone ? `https://zalo.me/${card.phone.replace(/\s+/g, '')}` : (card.name || 'zalo');
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(target)}`;
}

function onContactCall(phone?: string) {
  if (!phone) {
    syncSnack.value = { show: true, text: 'Không có số điện thoại để gọi', color: 'warning' };
    return;
  }
  window.open(`tel:${phone.replace(/\s+/g, '')}`, '_self');
}

function onContactMessage(card: ContactCardInfo) {
  if (card.phone) {
    window.open(`https://zalo.me/${card.phone.replace(/\s+/g, '')}`, '_blank');
  } else {
    syncSnack.value = { show: true, text: `Đã chọn liên hệ ${card.name}`, color: 'info' };
  }
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

function formatLinkDomain(info: LinkInfo): string {
  if (info.domain) {
    return info.domain.startsWith('www.') ? info.domain : `www.${info.domain}`;
  }
  try {
    const host = new URL(info.url).hostname;
    return host.startsWith('www.') ? host : `www.${host}`;
  } catch {
    return info.url;
  }
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
          let title = p.title || params?.mediaTitle || '';
          let description = p.description || params?.description || '';
          if (!title && description) {
            title = description;
            description = '';
          }
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
            description: String(description).trim(),
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

    // If bank card
    if (p.type === 'bank_card' || p.binBank) {
      return `💳 Thẻ ngân hàng ${p.bankName || ''} - ${p.numAccBank || ''}`;
    }

    // If reminder
    if (p.action === 'msginfo.actionlist' || p.actionlist !== undefined) {
      return `⏰ Nhắc hẹn: ${p.title || ''}`;
    }

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

function getDeletedDisplay(msg: Message): string {
  if (msg.senderType === 'self') {
    return 'Bạn đã thu hồi một tin nhắn';
  }
  return 'Tin nhắn đã được thu hồi';
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
  if (msg.contentType === 'reminder') return true;
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist' || p.actionlist !== undefined; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  if ((msg.metadata as any)?.title) return (msg.metadata as any).title;
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  const metaTime = (msg.metadata as any)?.startTime;
  if (metaTime && metaTime > 1e12) {
    return new Date(metaTime).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
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
  border: none !important;
  outline: none !important;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
}
.chat-image:hover { transform: scale(1.02); }

/* Bỏ viền màu xanh lá & background cho ảnh phía mình gửi */
.message-bubble.image-bubble,
.message-bubble.staff-bubble.image-bubble-self,
.v-application .message-bubble.staff-bubble.image-bubble-self,
.v-theme--emerald-care .message-bubble.staff-bubble.image-bubble-self {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}

.image-bubble-self .chat-image {
  border: none !important;
  outline: none !important;
}

.image-bubble-self .msg-time,
.contact-bubble-self .msg-time {
  padding: 3px 2px 0 2px;
}

.image-bubble-self .msg-time-self,
.contact-bubble-self .msg-time-self {
  color: rgba(var(--v-theme-on-surface), 0.72) !important;
}

.image-bubble-self .forwarded-tag,
.contact-bubble-self .forwarded-tag {
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
  padding: 0 4px 4px 0;
}

.image-bubble-self .quote-reply-box {
  background: rgba(var(--v-theme-surface), 0.9) !important;
  border: 1px solid rgba(var(--v-border-color), 0.12) !important;
  border-left: 3.5px solid #38bdf8 !important;
  margin-bottom: 6px;
}

.image-bubble-self .chat-image-caption {
  margin-top: 6px;
  padding: 8px 12px;
  background: rgba(var(--v-theme-surface), 0.95);
  color: rgb(var(--v-theme-on-surface)) !important;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-border-color), 0.12);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

/* Bỏ viền & background xanh cho danh thiếp phía mình gửi */
.message-bubble.staff-bubble.contact-bubble-self,
.v-application .message-bubble.staff-bubble.contact-bubble-self,
.v-theme--emerald-care .message-bubble.staff-bubble.contact-bubble-self {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}

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

.muted-chip {
  background: rgba(var(--v-theme-on-surface), 0.1) !important;
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15) !important;
}

/* Quoted Reply Block (Brighter and high contrast matching Image 3) */
.quote-reply-box {
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.16);
  border-left: 3.5px solid #38bdf8;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
  user-select: none;
}
.quote-reply-box:hover {
  opacity: 0.95;
  background: rgba(255, 255, 255, 0.22);
  transform: translateY(-1px);
}
.quote-reply-content {
  padding: 6px 10px;
  overflow: hidden;
  width: 100%;
}
.quote-reply-author {
  font-weight: 700;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  line-height: 1.25;
  color: #38bdf8;
}
.quote-reply-snippet {
  font-size: 0.78rem;
  line-height: 1.35;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Staff bubble quote styling */
.staff-bubble .quote-reply-box {
  background: rgba(255, 255, 255, 0.18) !important;
  border-left-color: #38bdf8 !important;
}
.staff-bubble .quote-reply-author {
  color: #7dd3fc !important;
  font-weight: 700;
}
.staff-bubble .quote-reply-snippet {
  color: #ffffff !important;
  opacity: 0.95;
}

/* Customer bubble quote styling */
.customer-bubble .quote-reply-box {
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-left-color: #38bdf8;
}
.customer-bubble .quote-reply-author {
  color: #38bdf8;
}
.customer-bubble .quote-reply-snippet {
  color: currentColor;
  opacity: 0.9;
}

/* Zalo Contact Card matching Image 4 */
.contact-card-bubble {
  max-width: 330px;
}
.contact-card-bubble .msg-time {
  padding: 2px 6px 4px 6px;
  margin-top: 2px !important;
}

.zalo-contact-card-v4 {
  width: 300px;
  max-width: 100%;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  user-select: none;
}

.zalo-card-top {
  position: relative;
  padding: 16px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
  background: linear-gradient(135deg, #0e5c38 0%, #15804e 55%, #1eb56c 100%);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
}
.zalo-card-top::before {
  content: '';
  position: absolute;
  right: -25px;
  top: -25px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0) 70%);
  pointer-events: none;
}
.zalo-card-top::after {
  content: '';
  position: absolute;
  left: 30%;
  bottom: -40px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 70%);
  pointer-events: none;
}

.zalo-card-qr-box {
  width: 70px;
  height: 70px;
  background: #ffffff;
  border-radius: 8px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s ease;
}
.zalo-card-qr-box:hover {
  transform: scale(1.05);
}
.zalo-card-qr-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  border-radius: 4px;
}

.zalo-card-footer {
  background: #0d281e;
  height: 46px;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.zalo-card-btn {
  flex: 1;
  height: 100%;
  background: transparent;
  border: none;
  color: #ffffff;
  font-size: 0.94rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  letter-spacing: 0.2px;
}
.zalo-card-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
.zalo-card-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.zalo-card-divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.15);
}

/* Link Preview matching Image 2 */
.link-preview-v2 {
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  word-break: break-word;
}
.link-preview-v2 .link-url-text {
  font-size: 0.88rem;
  line-height: 1.4;
  word-break: break-all;
  color: #60a5fa;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.link-preview-v2 .link-url-text:hover {
  color: #93c5fd;
}
.link-preview-v2 .link-title-text {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.35;
  color: #ffffff;
}
/* Khung xanh (staff-bubble): mọi text luôn màu trắng rõ nét */
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) {
  color: #ffffff !important;
}
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) .message-text {
  color: #ffffff !important;
}
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) .msg-time-self {
  color: rgba(255, 255, 255, 0.88) !important;
}
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) .forwarded-tag,
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) .forwarded-tag span,
.staff-bubble:not(.image-bubble-self):not(.contact-bubble-self) .forwarded-tag .v-icon {
  color: rgba(255, 255, 255, 0.9) !important;
}

.staff-bubble .link-preview-v2 .link-title-text {
  color: #ffffff !important;
}
.customer-bubble .link-preview-v2 .link-title-text {
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.link-preview-v2 .link-desc-text {
  font-size: 0.83rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.75);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.staff-bubble .link-preview-v2 .link-desc-text {
  color: #ffffff !important;
  opacity: 0.95 !important;
}
.customer-bubble .link-preview-v2 .link-desc-text {
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.staff-bubble .link-preview-v2 .link-domain-text,
.staff-bubble .link-preview-v2 .link-domain-text .link-domain-link {
  color: #93c5fd !important;
}
.link-preview-v2 .link-domain-text .link-domain-link {
  font-size: 0.82rem;
  color: #60a5fa;
  text-decoration: none;
  font-weight: 500;
}
.link-preview-v2 .link-domain-text .link-domain-link:hover {
  text-decoration: underline;
  color: #93c5fd;
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

/* Quick Reaction Bar */
.reaction-picker-bar {
  background: rgba(var(--v-theme-surface), 0.98) !important;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16) !important;
}

.reaction-emoji-btn {
  background: transparent;
  border: none;
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
  padding: 3px 4px;
  border-radius: 50%;
  transition: transform 0.15s ease, background 0.15s ease;
}

.reaction-emoji-btn:hover {
  transform: scale(1.3);
  background: rgba(var(--v-theme-primary), 0.12);
}

/* ── Chat Composer Layout giống Image 1 ── */
.chat-composer-box {
  border-top: 1px solid rgba(var(--v-border-color), 0.18);
  background: rgb(var(--v-theme-surface));
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.chat-toolbar {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}

.toolbar-btn {
  background: transparent;
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  padding: 5px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  min-width: 28px;
  height: 28px;
}

.toolbar-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Nút ... nổi bật ô vuông xanh đậm chuẩn Image 1 */
.toolbar-more-active-btn {
  background: rgba(24, 75, 138, 0.22) !important;
  color: #3b82f6 !important;
  border-radius: 6px !important;
  padding: 4px 6px !important;
}

.toolbar-more-active-btn:hover {
  background: rgba(24, 75, 138, 0.42) !important;
}

/* Nút Like nhanh màu vàng giống Image 1 */
.like-quick-btn {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}

.like-quick-btn:hover {
  transform: scale(1.25);
}

/* Ô nhập tin nhắn sạch sẽ, rõ ràng, KHÔNG BỊ BLUR/MỜ */
.chat-native-textarea {
  min-height: 40px;
}
.chat-native-textarea :deep(.v-field) {
  background: #f8fafc !important;
  border: 1.5px solid #cbd5e1 !important;
  border-radius: 22px !important;
  padding: 6px 16px !important;
  transition: background-color 0.2s ease, border-color 0.2s ease !important;
  box-shadow: none !important;
  align-items: stretch !important;
  --v-field-padding-top: 0px;
  --v-input-padding-top: 0px;
  --v-field-padding-bottom: 0px;
  min-height: 40px !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}
.chat-native-textarea :deep(.v-field--focused) {
  background: #ffffff !important;
  border-color: rgb(var(--v-theme-primary)) !important;
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.14) !important;
}
.chat-native-textarea :deep(.v-field__outline) {
  display: none !important;
}
.chat-native-textarea :deep(.v-field__overlay) {
  display: none !important;
}
.chat-native-textarea :deep(.v-field__field) {
  align-items: stretch !important;
  min-height: var(--v-textarea-control-height, 24px) !important;
  overflow: visible !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}
.chat-native-textarea :deep(.v-field__input) {
  padding: 0 !important;
  min-height: unset !important;
  overflow: visible !important;
  display: flex !important;
  align-items: center !important;
  /* Bỏ hoàn toàn mask gradient làm mờ chữ của Vuetify */
  -webkit-mask-image: none !important;
  mask-image: none !important;
  filter: none !important;
}
.chat-native-textarea :deep(textarea:not(.v-textarea__sizer)) {
  font-size: 0.95rem !important;
  line-height: 1.4 !important;
  padding: 0 !important;
  margin: 0 !important;
  color: #0f172a !important;
  min-height: var(--v-textarea-control-height, 24px) !important;
  max-height: none !important;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  overflow-y: auto !important;
  resize: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  filter: none !important;
  -webkit-font-smoothing: antialiased;
}
/* Keep Vuetify's hidden measuring textarea unconstrained for accurate auto-grow. */
.chat-native-textarea :deep(textarea.v-textarea__sizer) {
  height: 0 !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: hidden !important;
  line-height: 1.4 !important;
  font-size: 0.95rem !important;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.chat-native-textarea :deep(textarea::placeholder) {
  color: #334155 !important; /* Rõ nét, không bị mờ nhạt, không blur */
  opacity: 1 !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  filter: none !important;
}

/* Dark mode */
:deep(.v-theme--dark) .chat-native-textarea :deep(.v-field),
.v-theme--dark .chat-native-textarea :deep(.v-field) {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.16) !important;
}
:deep(.v-theme--dark) .chat-native-textarea :deep(.v-field--focused),
.v-theme--dark .chat-native-textarea :deep(.v-field--focused) {
  background: #1e293b !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}
:deep(.v-theme--dark) .chat-native-textarea :deep(textarea),
.v-theme--dark .chat-native-textarea :deep(textarea) {
  color: #f8fafc !important;
}
:deep(.v-theme--dark) .chat-native-textarea :deep(textarea::placeholder),
.v-theme--dark .chat-native-textarea :deep(textarea::placeholder) {
  color: #cbd5e1 !important;
  opacity: 1 !important;
}

/* Call Dialog styling */
.call-dialog-card {
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28) !important;
}
.call-dialog-header::after {
  content: '';
  position: absolute;
  right: -20px;
  bottom: -20px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0) 70%);
  pointer-events: none;
}

/* Popup menu Zalo - Tone màu sáng sủa, tinh tế */
.zalo-popup-menu {
  background: #ffffff !important;
  color: #1e293b !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04) !important;
  border-radius: 14px !important;
  padding: 6px !important;
}

.zalo-popup-item {
  color: #1e293b !important;
  border-radius: 10px !important;
  min-height: 40px !important;
  padding: 6px 12px !important;
  transition: all 0.15s ease !important;
  margin-bottom: 2px !important;
}

.zalo-popup-item:hover {
  background: #f1f5f9 !important;
  color: #0f172a !important;
}

.zalo-popup-item :deep(.v-list-item-title) {
  font-size: 0.88rem !important;
  font-weight: 500 !important;
  color: #1e293b !important;
}

/* Hỗ trợ Dark Mode nếu chuyển theme tối */
:deep(.v-theme--dark) .zalo-popup-menu,
.v-theme--dark .zalo-popup-menu {
  background: #1e2632 !important;
  color: #f8fafc !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4) !important;
}

:deep(.v-theme--dark) .zalo-popup-item,
.v-theme--dark .zalo-popup-item {
  color: #f8fafc !important;
}

:deep(.v-theme--dark) .zalo-popup-item:hover,
.v-theme--dark .zalo-popup-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}

:deep(.v-theme--dark) .zalo-popup-item :deep(.v-list-item-title),
.v-theme--dark .zalo-popup-item :deep(.v-list-item-title) {
  color: #f8fafc !important;
}

/* Quick Category Popup (Image 3) */
.category-popup-card {
  border: 1px solid rgba(var(--v-border-color), 0.16) !important;
}

.category-select-item {
  transition: all 0.15s ease;
  border-radius: 10px !important;
  margin-bottom: 2px !important;
}

.category-select-item.is-selected {
  background-color: #EBF4F0 !important;
}

.category-select-item.is-selected :deep(.v-list-item-title) {
  color: #1E3F30 !important;
  font-weight: 600 !important;
}

.category-select-item:not(.is-selected):hover {
  background-color: rgba(var(--v-theme-on-surface), 0.05) !important;
}

/* Corner Quick Reaction Badge (Image 1) */
.message-reaction-corner-badge {
  position: absolute;
  bottom: -8px;
  right: -7px;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #242D35;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  z-index: 3;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0;
  opacity: 1 !important; /* Mặc định luôn hiển thị, không cần hover */
  pointer-events: auto !important;
}

:deep(.v-theme--light) .message-reaction-corner-badge,
.v-theme--light .message-reaction-corner-badge,
.v-theme--light-apple .message-reaction-corner-badge {
  background: #FFFFFF;
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
}

.message-reaction-corner-badge:hover {
  transform: scale(1.22);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
}

.corner-reaction-emoji {
  font-size: 13px;
  line-height: 1;
  display: inline-block;
}

.corner-reaction-default-icon {
  color: #EF4444; /* Heart icon outline */
}

:deep(.v-theme--light) .corner-reaction-default-icon,
.v-theme--light .corner-reaction-default-icon,
.v-theme--light-apple .corner-reaction-default-icon {
  color: #EF4444;
}

/* Outside Action Buttons (Image 2 & Image 3) */
.message-outside-actions {
  opacity: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
  user-select: none;
  gap: 5px;
  flex-shrink: 0;
}

.message-row:hover .message-outside-actions {
  opacity: 1;
}

@media (max-width: 768px) {
  .message-outside-actions {
    opacity: 0.85;
  }
}

.msg-outside-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #242D35; /* Dark circular button like Image 2/3 */
  color: #CBD5E1;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

:deep(.v-theme--light) .msg-outside-btn,
.v-theme--light .msg-outside-btn,
.v-theme--light-apple .msg-outside-btn {
  background: #F1F5F9;
  color: #475569;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
}

.msg-outside-btn:hover {
  transform: scale(1.15);
  background: #334155;
  color: #FFFFFF;
}

:deep(.v-theme--light) .msg-outside-btn:hover,
.v-theme--light .msg-outside-btn:hover,
.v-theme--light-apple .msg-outside-btn:hover {
  background: #E2E8F0;
  color: #0F172A;
}

/* Zalo 3-Dots Menu (Image 4) */
.message-zalo-menu-list {
  background: #1E2632 !important;
  color: #F1F5F9 !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4) !important;
}

:deep(.v-theme--light) .message-zalo-menu-list,
.v-theme--light .message-zalo-menu-list,
.v-theme--light-apple .message-zalo-menu-list {
  background: #FFFFFF !important;
  color: #1E293B !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15) !important;
}

.zalo-menu-item {
  min-height: 38px !important;
  padding: 6px 14px !important;
  cursor: pointer !important;
  transition: background-color 0.15s ease;
  color: inherit !important;
}

.zalo-menu-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}

:deep(.v-theme--light) .zalo-menu-item:hover,
.v-theme--light .zalo-menu-item:hover,
.v-theme--light-apple .zalo-menu-item:hover {
  background: rgba(0, 0, 0, 0.05) !important;
}

.zalo-menu-item.menu-item-danger {
  color: #EF4444 !important;
}

.zalo-menu-item.menu-item-danger .action-danger-icon,
.zalo-menu-item.menu-item-danger .action-danger-text {
  color: #EF4444 !important;
}

.zalo-menu-item.menu-item-danger:hover {
  background: rgba(239, 68, 68, 0.12) !important;
}

/* Quiet pinned note: the content leads, controls stay secondary. */
.pinned-note-strip {
  --note-accent:#A77328; --note-ink:#3F3B32; --note-bg:#FCF8EE; --note-line:#EFE7D6;
  display:grid; grid-template-columns:18px minmax(0,1fr) auto; gap:10px;
  align-items:start; flex-shrink:0; padding:10px 12px; margin:8px 12px 0;
  background:var(--note-bg); border:1px solid var(--note-line); border-left:3px solid var(--note-accent);
  border-radius:9px; color:var(--note-ink); box-shadow:none; z-index:1;
}
.pinned-note-strip .pin-icon { color:var(--note-accent); margin-top:4px; }
.pinned-note-body { min-width:0; }
.pinned-note-copy { display:flex; align-items:baseline; gap:10px; width:100%; min-width:0; text-align:left; color:inherit; background:transparent; border:0; cursor:pointer; }
.pinned-note-badge { flex-shrink:0; color:var(--note-accent); font-size:10px; line-height:20px; font-weight:600; padding-right:10px; border-right:1px solid var(--note-line); white-space:nowrap; }
.note-text-preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; white-space:pre-wrap; min-width:0; font-size:13px; line-height:20px; font-weight:500; }
.note-text-preview.note-text-expanded { display:block; -webkit-line-clamp:unset; max-height:180px; overflow-y:auto; }
.pinned-note-actions { display:flex; gap:2px; }
.note-action-btn { width:26px !important; height:26px !important; color:var(--note-accent) !important; border-radius:6px !important; }
.note-action-btn :deep(.v-icon) { font-size:17px; }
.note-action-btn:hover { background:color-mix(in srgb,var(--note-accent) 10%,transparent) !important; }
.note-expand-btn { background:transparent; border:0; padding:0; cursor:pointer; box-shadow:none; display:inline-flex; align-items:center; gap:3px; font-size:10px; font-weight:600; color:var(--note-accent); margin-top:4px; }
.pinned-note-strip.pinned-note-vip { --note-accent:#397B67; --note-ink:#28483D; --note-bg:#F2F8F4; --note-line:#DBEADF; }
.pinned-note-strip.pinned-note-urgent { --note-accent:#BA625B; --note-ink:#653E3A; --note-bg:#FCF4F2; --note-line:#EFDEDA; }
.pinned-note-strip.pinned-note-dark { --note-accent:#D6B37B; --note-ink:#EBE5D8; --note-bg:#29291F; --note-line:#494532; }
.pinned-note-strip.pinned-note-dark.pinned-note-vip { --note-accent:#91C7AF; --note-ink:#DCEFE5; --note-bg:#1E3028; --note-line:#364D40; }
.pinned-note-strip.pinned-note-dark.pinned-note-urgent { --note-accent:#E1A29B; --note-ink:#F6DEDA; --note-bg:#352523; --note-line:#593A36; }
.pinned-note-strip button:focus-visible { outline:2px solid var(--note-accent); outline-offset:3px; }
@media(max-width:600px) {
 .pinned-note-strip { gap:7px; padding:9px 10px; margin:6px 8px 0; }
 .pinned-note-copy { flex-direction:column; gap:2px; }
 .pinned-note-badge { border-right:0; padding-right:0; font-size:9px; line-height:16px; }
 .note-text-preview { font-size:12px; line-height:19px; }
}

/* Header Status Chip */
.status-header-chip {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.status-header-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}
.status-select-item {
  transition: background 0.15s ease;
}
.status-select-item.is-active-status {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  font-weight: 700 !important;
}
.customer-note-dialog {
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.25) !important;
}

/* ── Zalo Drag & Drop Overlay (Image 1) ── */
.zalo-drag-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 1005;
  background: rgba(8, 14, 24, 0.78);
  backdrop-filter: blur(4px);
  padding: 10px;
  gap: 8px;
  pointer-events: auto;
}

.zalo-dropzone {
  position: relative;
  border-radius: 12px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.zalo-dropzone-quick {
  border: 2px dashed #0084ff;
  background: rgba(0, 132, 255, 0.08);
  color: #38bdf8;
}

.zalo-dropzone-quick.dropzone-active {
  border-color: #38bdf8;
  background: rgba(0, 132, 255, 0.2);
  box-shadow: inset 0 0 28px rgba(0, 132, 255, 0.28);
}

.zalo-dropzone-preview {
  min-height: 85px;
  border: 1.5px dashed rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
}

.zalo-dropzone-preview.dropzone-active {
  border-color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.18);
}

.dragged-file-indicator {
  background: rgba(0, 102, 255, 0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.quick-send-title {
  color: #38bdf8;
  letter-spacing: 0.3px;
}
.quick-send-desc {
  color: rgba(255, 255, 255, 0.7);
}

.preview-send-title {
  color: #ffffff;
}
.preview-send-desc {
  color: rgba(255, 255, 255, 0.65);
}

.pointer-events-none {
  pointer-events: none;
}

/* Zalo Native Sticker Display */
.sticker-bubble {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  padding: 0 !important;
}
.zalo-sticker-img {
  width: 130px;
  height: 130px;
  object-fit: contain;
  display: block;
  user-select: none;
  cursor: pointer;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.12));
  transition: transform 0.15s ease;
}
.zalo-sticker-img:hover {
  transform: scale(1.05);
}
</style>
