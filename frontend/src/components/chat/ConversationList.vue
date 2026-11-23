<template>
  <div class="conversation-list d-flex flex-column" style="width: 100%; border-right: 1px solid var(--border-glow, rgba(0,242,255,0.1)); height: 100%;">
    <div class="conversation-account-toolbar">
      <v-menu location="bottom start">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text" class="conversation-account-name" aria-label="Chọn tài khoản hội thoại" :title="currentAccountName">
            <span class="text-truncate">{{ currentAccountName }}</span><v-icon size="16" class="ml-1">mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" width="250">
          <v-list-item title="Tất cả Zalo" :active="!accountId" @click="$emit('filter-account', null)" />
          <v-list-item v-for="account in accountOptions" :key="account.value" :title="account.text" :active="accountId === account.value" @click="$emit('filter-account', account.value)" />
        </v-list>
      </v-menu>
      <div class="conversation-account-actions">
        <v-btn icon="mdi-account-plus-outline" variant="text" size="small" color="primary" title="Thêm bạn" aria-label="Thêm bạn" @click="openSearchDialogDirect" />
        <v-btn icon="mdi-account-multiple-plus-outline" variant="text" size="small" color="primary" title="Tạo nhóm" aria-label="Tạo nhóm" @click="openCreateGroupDialog" />
        <v-btn icon="mdi-sync" variant="text" size="small" color="primary" title="Đồng bộ" aria-label="Đồng bộ" :loading="syncingMessages" @click="syncRecentMessages" />
      </div>
    </div>
    <div class="conversation-search-header">
      <v-text-field :model-value="search" @update:model-value="$emit('update:search', $event)" placeholder="Tìm kiếm hội thoại..." aria-label="Tìm kiếm hội thoại" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable />
      <v-tabs :model-value="activeTab" @update:model-value="$emit('change-tab', String($event))" class="conversation-filter-tabs" density="compact" grow color="primary" aria-label="Lọc hội thoại">
        <v-tab value="all">Tất cả</v-tab>
        <v-tab value="zalo">
          <v-icon size="16" class="mr-1" color="#0068FF">mdi-chat</v-icon>
          Zalo
        </v-tab>
        <v-tab value="whatsapp">
          <v-icon size="16" class="mr-1" color="#25D366">mdi-whatsapp</v-icon>
          WhatsApp
        </v-tab>
      </v-tabs>
      <!-- Sub-filter row: Left: Pure text dropdown "Bộ lọc" (NO ICON, NO ▾) | Right: [ Chưa đọc ] [ Nhóm ] -->
      <div class="conv-filter-bar d-flex align-center justify-space-between px-3 py-1" style="min-height: 32px; background: rgba(var(--v-theme-surface), 0.95); border-top: 1px solid rgba(var(--v-border-color), 0.08); border-bottom: 1px solid rgba(var(--v-border-color), 0.12);">
        <div class="d-flex align-center">
          <v-menu location="bottom start" :close-on-content-click="true">
            <template #activator="{ props: menuProps }">
              <button
                v-bind="menuProps"
                type="button"
                class="conv-filter-dropdown-btn"
                :style="{
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 0',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: roleFilter === 'all' ? '500' : '700',
                  color: roleFilterColor
                }"
              >
                {{ roleFilterLabel }}
              </button>
            </template>
            <v-list density="compact" rounded="lg" class="elevation-8 pa-1" min-width="210" max-height="400" style="overflow-y: auto;">
              <v-list-item @click="roleFilter = 'all'" :active="roleFilter === 'all'" class="rounded">
                <v-list-item-title class="text-body-2">Tất cả</v-list-item-title>
              </v-list-item>

              <!-- Nhóm: Đối tượng -->
              <div class="px-3 pt-2 pb-1 text-caption font-weight-bold" style="color: rgba(var(--v-theme-on-surface), 0.5); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px;">
                Đối tượng
              </div>
              <v-list-item @click="roleFilter = 'customer'" :active="roleFilter === 'customer'" class="rounded">
                <v-list-item-title class="text-body-2 font-weight-medium" style="color: #007A3D;">Khách hàng</v-list-item-title>
              </v-list-item>
              <v-list-item @click="roleFilter = 'supplier'" :active="roleFilter === 'supplier'" class="rounded">
                <v-list-item-title class="text-body-2 font-weight-medium" style="color: #EA580C;">Nhà cung cấp</v-list-item-title>
              </v-list-item>
              <v-list-item @click="roleFilter = 'internal'" :active="roleFilter === 'internal'" class="rounded">
                <v-list-item-title class="text-body-2 font-weight-medium" style="color: #475569;">Nội bộ</v-list-item-title>
              </v-list-item>
              <v-list-item v-for="tag in customTags" :key="tag" @click="roleFilter = tag" :active="roleFilter === tag" class="rounded">
                <v-list-item-title class="text-body-2 font-weight-medium" style="color: #2563EB;">{{ tag }}</v-list-item-title>
              </v-list-item>
              <v-list-item @click="handleCreateTag" class="rounded">
                <v-list-item-title class="text-body-2 text-primary font-weight-medium">+ Tạo nhãn mới</v-list-item-title>
              </v-list-item>

              <v-divider class="my-1 opacity-20" />

              <!-- Nhóm: Trạng thái khách hàng -->
              <div class="px-3 pt-2 pb-1 text-caption font-weight-bold" style="color: rgba(var(--v-theme-on-surface), 0.5); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px;">
                Trạng thái khách
              </div>
              <v-list-item
                v-for="st in CRM_STATUSES"
                :key="st.id"
                @click="roleFilter = st.id"
                :active="roleFilter === st.id"
                class="rounded"
              >
                <v-list-item-title class="text-body-2 font-weight-medium" :style="{ color: st.color }">
                  {{ st.label }}
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>

        <!-- Right side: Independent Toggles for [ Chưa đọc ] and [ Nhóm ] -->
        <div class="d-flex align-center">
          <button
            type="button"
            class="filter-toggle-btn"
            :style="unreadOnly ? {
              background: '#FEF3C7',
              border: '1px solid #F59E0B',
              color: '#B45309',
              fontWeight: '700',
              padding: '2px 8px',
              fontSize: '11.5px',
              borderRadius: '4px',
              cursor: 'pointer',
              lineHeight: '1.2'
            } : {
              background: 'transparent',
              border: '1px solid rgba(var(--v-border-color), 0.25)',
              color: 'rgba(var(--v-theme-on-surface), 0.75)',
              fontWeight: '500',
              padding: '2px 8px',
              fontSize: '11.5px',
              borderRadius: '4px',
              cursor: 'pointer',
              lineHeight: '1.2'
            }"
            @click="unreadOnly = !unreadOnly"
          >
            Chưa đọc
          </button>
          <button
            type="button"
            class="filter-toggle-btn ml-1"
            :style="groupOnly ? {
              background: '#EFF6FF',
              border: '1px solid #3B82F6',
              color: '#1D4ED8',
              fontWeight: '700',
              padding: '2px 8px',
              fontSize: '11.5px',
              borderRadius: '4px',
              cursor: 'pointer',
              lineHeight: '1.2'
            } : {
              background: 'transparent',
              border: '1px solid rgba(var(--v-border-color), 0.25)',
              color: 'rgba(var(--v-theme-on-surface), 0.75)',
              fontWeight: '500',
              padding: '2px 8px',
              fontSize: '11.5px',
              borderRadius: '4px',
              cursor: 'pointer',
              lineHeight: '1.2'
            }"
            @click="groupOnly = !groupOnly"
          >
            Nhóm
          </button>
        </div>
      </div>
    </div>

    <!-- List -->
    <v-list class="flex-grow-1 overflow-y-auto pa-0" density="compact" @scroll="onConvListScroll">
      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <!-- Search Zalo by Phone Option -->
      <v-list-item
        v-if="isPhoneNumber"
        prepend-icon="mdi-account-search"
        class="bg-surface-variant text-primary font-weight-bold py-3 border-bottom animate-fade-in"
        style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); cursor: pointer;"
        @click="searchZalo"
      >
        <v-list-item-title>Tìm số điện thoại trên Zalo</v-list-item-title>
        <v-list-item-subtitle class="text-medium-emphasis font-weight-medium">Số điện thoại: {{ search }}</v-list-item-subtitle>
        <template #append>
          <v-icon color="primary" size="20">mdi-chevron-right</v-icon>
        </template>
      </v-list-item>

      <v-list-item
        v-for="conv in displayConversations"
        :key="conv.id"
        :active="conv.id === selectedId"
        @click="$emit('select', conv.id)"
        class="py-2 animate-fade-in conversation-list-item"
        :class="{
          'conversation-active': conv.id === selectedId,
          'unread-conv-bg': conv.unreadCount > 0 && conv.id !== selectedId,
        }"
      >
        <template #prepend>
          <v-avatar size="40" color="grey-lighten-2">
            <v-icon v-if="conv.threadType === 'group'" icon="mdi-account-group" />
            <v-img v-else-if="conv.contact?.avatarUrl" :src="conv.contact.avatarUrl" />
            <v-icon v-else icon="mdi-account" />
          </v-avatar>
        </template>

        <v-list-item-title class="d-flex align-center">
          <span class="text-truncate" :class="{ 'font-weight-bold': conv.unreadCount > 0, 'text-medium-emphasis': conv.isMuted }">
            {{ conv.threadType === 'group' ? (conv.contact?.fullName || 'Nhóm') : (conv.contact?.fullName || 'Unknown') }}
          </span>
          <!-- Customer / Supplier tags (Text only, no icon, colored badges) -->
          <span
            v-if="conv.contact?.tags?.includes('Khách hàng')"
            class="ml-1 conv-tag-kh"
            style="background: #E8F8EE; color: #007A3D; border: 1px solid rgba(0,122,61,0.25); font-size: 10.5px; font-weight: 600; border-radius: 4px; padding: 1px 6px; line-height: 16px; white-space: nowrap; flex-shrink: 0; display: inline-block;"
          >
            Khách hàng
          </span>
          <span
            v-else-if="conv.contact?.tags?.includes('Nhà cung cấp')"
            class="ml-1 conv-tag-ncc"
            style="background: #FFF4ED; color: #EA580C; border: 1px solid rgba(234,88,12,0.25); font-size: 10.5px; font-weight: 600; border-radius: 4px; padding: 1px 6px; line-height: 16px; white-space: nowrap; flex-shrink: 0; display: inline-block;"
          >
            Nhà cung cấp
          </span>
          <span
            v-else-if="conv.contact?.tags?.includes('Nội bộ') || conv.contact?.tags?.includes('Nội bộ công ty')"
            class="ml-1 conv-tag-nb"
            style="background: #F1F5F9; color: #475569; border: 1px solid rgba(71,85,105,0.25); font-size: 10.5px; font-weight: 600; border-radius: 4px; padding: 1px 6px; line-height: 16px; white-space: nowrap; flex-shrink: 0; display: inline-block;"
          >
            Nội bộ
          </span>
          <v-chip v-if="conv.threadType === 'group'" size="x-small" color="info" variant="tonal" class="ml-1">Nhóm</v-chip>
          <v-icon v-if="conv.isCustomer" color="error" size="14" class="ml-1" title="Đang theo dõi nhóm">mdi-bell-ring</v-icon>

          <!-- Pinned conversation icon -->
          <v-icon
            v-if="isPinned(conv.id)"
            size="14"
            color="primary"
            class="ml-1"
            title="Đã ghim hội thoại"
          >
            mdi-pin
          </v-icon>

          <!-- Muted notification icon -->
          <v-icon
            v-if="conv.isMuted"
            size="14"
            class="ml-1 muted-bell-icon"
            title="Đã tắt thông báo"
          >
            mdi-bell-off-outline
          </v-icon>
        </v-list-item-title>

        <v-list-item-subtitle class="d-flex align-center">
          <span class="text-truncate" style="max-width: 180px;" :class="{ 'font-weight-medium': conv.unreadCount > 0 }">
            {{ lastMessagePreview(conv) }}
          </span>
          <v-spacer />
          <!-- Theme-adaptive unread badge (muted tone when notification is off) -->
          <span
            v-if="conv.unreadCount > 0"
            class="unread-badge-pill"
            :class="conv.isMuted ? 'unread-badge-muted' : 'unread-badge-active'"
          >
            {{ conv.unreadCount }}
          </span>
        </v-list-item-subtitle>

        <!-- Delivery Countdown, Time & Options Menu -->
        <template #append>
          <div class="conv-append-container d-flex flex-column align-end justify-space-between ml-1">
            <!-- Time: Luôn ở phía trên, không bao giờ đè lên 3 chấm (Image 2) -->
            <span class="text-caption text-grey-darken-1 conv-time-label">
              {{ formatTime(conv.lastMessageAt) }}
            </span>

            <div class="d-flex align-center conv-action-wrapper">
              <!-- Action menu: Context options matching Zalo (Image 1) -->
              <v-menu location="bottom end" :close-on-content-click="false">
                <template #activator="{ props: menuProps }">
                  <v-btn
                    v-bind="menuProps"
                    icon="mdi-dots-vertical"
                    size="x-small"
                    variant="text"
                    density="compact"
                    class="conv-action-menu-btn"
                    title="Tùy chọn hội thoại"
                    @click.stop
                  />
                </template>
                <v-list density="compact" rounded="lg" class="elevation-8 conv-context-menu pa-1" min-width="200">
                  <!-- Nhóm 1: Ghim & Đọc -->
                  <v-list-item @click.stop="togglePin(conv.id)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-medium-emphasis">{{ isPinned(conv.id) ? 'mdi-pin-off-outline' : 'mdi-pin-outline' }}</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">
                      {{ isPinned(conv.id) ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại' }}
                    </v-list-item-title>
                  </v-list-item>

                  <v-list-item @click.stop="toggleMarkUnread(conv)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-medium-emphasis">{{ conv.unreadCount > 0 ? 'mdi-email-open-outline' : 'mdi-email-mark-as-unread' }}</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">
                      {{ conv.unreadCount > 0 ? 'Đánh dấu đã đọc' : 'Đánh dấu chưa đọc' }}
                    </v-list-item-title>
                  </v-list-item>

                  <v-divider class="my-1 opacity-20" />

                  <!-- Nhóm 2: Phân loại nhãn & Nhóm -->
                  <v-menu location="end" open-on-hover :close-on-content-click="false">
                    <template #activator="{ props: catMenuProps }">
                      <v-list-item v-bind="catMenuProps" class="conv-menu-item rounded d-flex align-center justify-space-between" @click.stop>
                        <template #prepend>
                          <v-icon size="17" class="mr-2 text-primary">mdi-tag-outline</v-icon>
                        </template>
                        <v-list-item-title class="text-body-2">Phân loại</v-list-item-title>
                        <template #append>
                          <v-icon size="16" class="text-medium-emphasis">mdi-chevron-right</v-icon>
                        </template>
                      </v-list-item>
                    </template>
                    <v-list density="compact" rounded="lg" class="elevation-8 conv-context-menu pa-1" min-width="210">
                      <v-list-item
                        v-for="cat in allCategories"
                        :key="cat.title"
                        @click.stop="toggleCategory(conv, cat.title)"
                        class="conv-menu-item rounded"
                      >
                        <template #prepend>
                          <v-icon :icon="cat.icon" :style="{ color: cat.color }" size="16" class="mr-2" />
                        </template>
                        <v-list-item-title class="text-body-2" style="font-size: 0.85rem;">{{ cat.title }}</v-list-item-title>
                        <template #append>
                          <v-icon
                            v-if="conv.contact?.tags?.includes(cat.title)"
                            icon="mdi-check"
                            size="16"
                            color="success"
                          />
                        </template>
                      </v-list-item>
                      <v-divider class="my-1 opacity-20" />
                      <v-list-item @click.stop="handleCreateTag" class="conv-menu-item rounded">
                        <template #prepend>
                          <v-icon size="16" class="mr-2 text-primary">mdi-plus</v-icon>
                        </template>
                        <v-list-item-title class="text-body-2 text-primary font-weight-medium">Tạo nhãn mới</v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>

                  <v-list-item @click.stop="handleAddToGroup(conv)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-medium-emphasis">mdi-account-multiple-plus-outline</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">Thêm vào nhóm</v-list-item-title>
                  </v-list-item>

                  <v-divider class="my-1 opacity-20" />

                  <!-- Nhóm 3: Thông báo & Quyền riêng tư -->
                  <v-menu v-if="!conv.isMuted" location="end" open-on-hover :close-on-content-click="true">
                    <template #activator="{ props: muteMenuProps }">
                      <v-list-item v-bind="muteMenuProps" class="conv-menu-item rounded d-flex align-center justify-space-between" @click.stop>
                        <template #prepend>
                          <v-icon size="17" class="mr-2 text-medium-emphasis">mdi-bell-off-outline</v-icon>
                        </template>
                        <v-list-item-title class="text-body-2">Tắt thông báo</v-list-item-title>
                        <template #append>
                          <v-icon size="16" class="text-medium-emphasis">mdi-chevron-right</v-icon>
                        </template>
                      </v-list-item>
                    </template>
                    <v-list density="compact" rounded="lg" class="elevation-8 conv-context-menu pa-1" min-width="190">
                      <v-list-item @click.stop="muteConversation(conv, 60)" class="conv-menu-item rounded">
                        <v-list-item-title class="text-body-2">Trong 1 giờ</v-list-item-title>
                      </v-list-item>
                      <v-list-item @click.stop="muteConversation(conv, 240)" class="conv-menu-item rounded">
                        <v-list-item-title class="text-body-2">Trong 4 giờ</v-list-item-title>
                      </v-list-item>
                      <v-list-item @click.stop="muteConversation(conv, 480)" class="conv-menu-item rounded">
                        <v-list-item-title class="text-body-2">Trong 8 giờ</v-list-item-title>
                      </v-list-item>
                      <v-list-item @click.stop="muteConversation(conv, 0)" class="conv-menu-item rounded">
                        <v-list-item-title class="text-body-2">Cho đến khi được bật lại</v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>
                  <v-list-item v-else @click.stop="unmuteConversation(conv)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-warning">mdi-bell-outline</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">Bật thông báo</v-list-item-title>
                  </v-list-item>

                  <v-list-item @click.stop="confirmHideConversation(conv)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-medium-emphasis">mdi-eye-off-outline</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">Ẩn trò chuyện</v-list-item-title>
                  </v-list-item>

                  <v-divider class="my-1 opacity-20" />

                  <!-- Nhóm 4: Báo xấu & Xóa -->
                  <v-list-item @click.stop="openReportDialog(conv)" class="conv-menu-item rounded">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-medium-emphasis">mdi-alert-octagon-outline</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">Báo xấu</v-list-item-title>
                  </v-list-item>

                  <v-list-item @click.stop="confirmDeleteConversation(conv)" class="conv-menu-item rounded text-error">
                    <template #prepend>
                      <v-icon size="17" class="mr-2 text-error">mdi-delete-outline</v-icon>
                    </template>
                    <v-list-item-title class="text-body-2 text-error font-weight-medium">Xóa hội thoại</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>

            <v-chip
              v-if="(authStore.user?.role === 'accountant' ? (conv.contact?.notes || '').includes('[Chuyển cho Kế toán]') : ((conv.contact?.notes || '').includes('[Chuyển cho Kế toán]') || conv.contact?.metadata?.customerCode)) && conv.contact?.metadata?.deliveryDate && conv.contact?.metadata?.accountantStatus !== 'completed'"
              :color="getDeliveryDaysRemaining(conv.contact.metadata.deliveryDate).color"
              size="x-small"
              variant="flat"
              class="font-weight-bold px-1"
              style="height: 18px; font-size: 0.65rem; color: white !important;"
            >
              <v-icon start :icon="getDeliveryDaysRemaining(conv.contact.metadata.deliveryDate).icon" size="10" class="mr-0" color="white" />
              {{ getDeliveryDaysRemaining(conv.contact.metadata.deliveryDate).text }}
            </v-chip>
          </div>
        </template>
      </v-list-item>

      <div v-if="loadingMore" class="d-flex justify-center py-3">
        <v-progress-circular indeterminate size="22" width="2" color="primary" />
      </div>

      <div v-if="!loading && displayConversations.length === 0" class="text-center pa-8 text-grey">
        Chưa có cuộc trò chuyện nào
      </div>
    </v-list>

    <!-- Search and Add Friend Dialog -->
    <v-dialog v-model="showDialog" max-width="500">
      <v-card class="rounded-xl border elevation-8" style="background: rgb(var(--v-theme-surface)) !important;">
        <v-card-title class="d-flex align-center justify-space-between pa-4" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="primary">mdi-account-plus</v-icon>
            <span class="text-h6 font-weight-bold text-high-emphasis">Tìm & Nhắn Zalo SĐT mới</span>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showDialog = false" />
        </v-card-title>

        <v-card-text class="pa-4">
          <!-- Search input section (Always visible) -->
          <div class="mb-4">
            <!-- Select account to search from -->
            <v-select
              v-model="targetAccountId"
              :items="accountOptions"
              item-title="text"
              item-value="value"
              label="Tìm từ tài khoản Zalo"
              density="compact"
              variant="outlined"
              class="mb-3"
              hide-details
            />

            <!-- Phone number to search -->
            <v-text-field
              v-model="dialogPhone"
              label="Số điện thoại"
              placeholder="Nhập số điện thoại cần tìm..."
              prepend-inner-icon="mdi-phone"
              variant="outlined"
              density="compact"
              class="mb-3"
              hide-details
              clearable
              @keyup.enter="searchZalo"
            />

            <v-btn
              color="primary"
              variant="flat"
              class="font-weight-bold w-100"
              size="default"
              rounded="lg"
              :loading="searchingZalo"
              @click="searchZalo"
            >
              Tìm kiếm SĐT
            </v-btn>
          </div>

          <v-divider class="mb-4" style="border-color: rgba(var(--v-border-color), var(--v-border-opacity));" />

          <!-- Loading state -->
          <div v-if="searchingZalo" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" size="36" class="mb-2" />
            <p class="text-caption text-medium-emphasis">Đang tìm kiếm trên máy chủ Zalo...</p>
          </div>

          <!-- Error state -->
          <div v-else-if="searchError" class="text-center py-4 text-error bg-error-darken-4 rounded pa-3 mb-2" style="background-color: rgba(244, 67, 54, 0.1) !important;">
            <v-icon icon="mdi-alert-circle-outline" size="28" class="mb-1" />
            <p class="text-body-2 font-weight-bold">{{ searchError }}</p>
          </div>

          <!-- Success profile found -->
          <div v-else-if="foundUser" class="d-flex flex-column align-center text-center animate-fade-in">
            <v-avatar size="72" color="grey-lighten-2" class="mb-2 border-glow" style="border: 2px solid rgb(var(--v-theme-primary)); width: 72px; height: 72px;">
              <v-img v-if="foundUser.avatar" :src="foundUser.avatar" />
              <v-icon v-else icon="mdi-account" size="36" />
            </v-avatar>

            <span class="text-subtitle-1 font-weight-bold text-high-emphasis mb-1">{{ foundUser.display_name || foundUser.zalo_name || 'Khách hàng Zalo' }}</span>
            <span class="text-caption text-medium-emphasis mb-3">Zalo UID: {{ foundUser.uid }}</span>

            <!-- Action selection row -->
            <div class="d-flex w-100 justify-center mb-3" style="gap: 12px;">
              <v-btn
                :variant="sendFriendReq ? 'outlined' : 'flat'"
                :color="sendFriendReq ? 'grey-lighten-1' : 'primary'"
                class="flex-grow-1 text-none font-weight-bold"
                size="small"
                @click="sendFriendReq = false"
              >
                <v-icon start size="16">mdi-message-text</v-icon>
                Chỉ nhắn tin
              </v-btn>
              
              <v-btn
                :variant="sendFriendReq ? 'flat' : 'outlined'"
                :color="sendFriendReq ? 'success' : 'grey-lighten-1'"
                class="flex-grow-1 text-none font-weight-bold"
                size="small"
                @click="sendFriendReq = true"
              >
                <v-icon start size="16">mdi-account-plus</v-icon>
                Kết bạn Zalo
              </v-btn>
            </div>

            <!-- Custom message to send -->
            <v-textarea
              v-model="addFriendMessage"
              :label="sendFriendReq ? 'Lời nhắn kết bạn' : 'Tin nhắn mở đầu'"
              placeholder="Nhập nội dung tin nhắn..."
              variant="outlined"
              rows="3"
              class="w-100"
              hide-details
            />
          </div>
        </v-card-text>

        <v-card-actions v-if="!searchingZalo && foundUser" class="pa-4 pt-0 justify-end" style="gap: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
          <v-btn variant="text" class="text-none font-weight-bold" @click="showDialog = false">Hủy</v-btn>
          <v-btn
            :color="sendFriendReq ? 'success' : 'primary'"
            class="text-none font-weight-bold px-4"
            :loading="addingFriend"
            @click="addFriendAndOpenChat"
          >
            <v-icon start size="18">{{ sendFriendReq ? 'mdi-account-plus' : 'mdi-send' }}</v-icon>
            {{ sendFriendReq ? 'Kết bạn Zalo' : 'Mở chat & Gửi tin nhắn' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Global Snackbar for notifications -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="4000" location="top">
      {{ snackbar.text }}
    </v-snackbar>

    <!-- Create Zalo Group Dialog -->
    <v-dialog v-model="createGroupDialog.show" max-width="500" persistent>
      <v-card class="rounded-xl border pa-4">
        <v-card-title class="d-flex align-center justify-space-between border-bottom pb-3 px-0">
          <span class="font-weight-bold text-subtitle-1 text-high-emphasis d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-account-multiple-plus</v-icon>
            Tạo nhóm Zalo mới
          </span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="closeCreateGroupDialog" />
        </v-card-title>
        <v-card-text class="pt-4 px-0">
          <v-form v-model="createGroupDialog.valid" @submit.prevent="submitCreateGroup">
            <!-- Chọn tài khoản Zalo gửi -->
            <v-select
              v-model="createGroupDialog.accountId"
              :items="zaloAccountsList"
              item-title="displayName"
              item-value="id"
              label="Tạo từ tài khoản Zalo"
              placeholder="Chọn tài khoản Zalo"
              variant="outlined"
              density="comfortable"
              :rules="[v => !!v || 'Tài khoản Zalo là bắt buộc']"
              class="mb-3"
              @update:model-value="fetchContactsForGroup"
            />
            <!-- Nhập tên nhóm -->
            <v-text-field
              v-model="createGroupDialog.name"
              label="Tên nhóm"
              placeholder="Nhập tên nhóm chat Zalo..."
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-account-group-outline"
              clearable
              :rules="[v => !!v || 'Tên nhóm là bắt buộc']"
              class="mb-3"
            />
            <div class="text-caption font-weight-bold text-medium-emphasis mb-1">Chọn thành viên:</div>
            <!-- Tìm kiếm thành viên -->
            <v-text-field
              v-model="createGroupDialog.memberSearch"
              placeholder="Tìm tên thành viên..."
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              class="mb-2"
              hide-details
              clearable
            />
            <!-- Loading -->
            <div v-if="createGroupDialog.loadingMembers" class="d-flex flex-column align-center justify-center py-4">
              <v-progress-circular indeterminate color="primary" size="24" class="mb-1" />
              <span class="text-caption text-medium-emphasis">Đang tải danh bạ...</span>
            </div>
            <!-- Danh sách checkbox thành viên -->
            <div v-else class="contacts-checklist-container mb-3 border rounded pa-2" style="max-height: 200px; overflow-y: auto; background: rgba(var(--v-theme-on-surface), 0.02);">
              <v-list v-if="filteredContacts.length > 0" class="pa-0">
                <v-list-item
                  v-for="contact in filteredContacts"
                  :key="contact.zaloUid"
                  class="rounded-lg mb-1 pa-0 px-2"
                >
                  <template #prepend>
                    <v-checkbox
                      v-model="createGroupDialog.selectedMembers"
                      :value="contact.zaloUid"
                      color="primary"
                      density="compact"
                      hide-details
                      class="mr-2"
                    />
                    <v-avatar size="32" color="grey-lighten-2" class="mr-2">
                      <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" />
                      <v-icon v-else icon="mdi-account" />
                    </v-avatar>
                  </template>
                  <v-list-item-title class="text-body-2 font-weight-medium text-high-emphasis">
                    {{ contact.fullName }}
                  </v-list-item-title>
                </v-list-item>
              </v-list>
              <div v-else class="text-center py-6 text-medium-emphasis text-caption">
                Không tìm thấy danh bạ nào có Zalo ID.
              </div>
            </div>
            <v-alert
              v-if="createGroupDialog.errorMessage"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-3"
              closable
              @click:close="createGroupDialog.errorMessage = ''"
            >
              {{ createGroupDialog.errorMessage }}
            </v-alert>
            <v-card-actions class="px-0 pt-2 border-top">
              <v-spacer />
              <v-btn variant="text" class="rounded-xl font-weight-bold px-4 text-none" @click="closeCreateGroupDialog">
                Hủy
              </v-btn>
              <v-btn
                type="submit"
                color="primary"
                variant="flat"
                class="rounded-xl font-weight-bold px-6 text-none"
                :loading="createGroupDialog.submitting"
                :disabled="!createGroupDialog.valid || createGroupDialog.selectedMembers.length === 0"
              >
                Tạo nhóm
              </v-btn>
            </v-card-actions>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Hide Conversation Dialog -->
    <v-dialog v-model="hideDialog.show" max-width="400">
      <v-card class="rounded-xl border elevation-8" style="background: rgb(var(--v-theme-surface)) !important;">
        <v-card-title class="d-flex align-center justify-space-between pa-4" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <span class="text-subtitle-1 font-weight-bold">Ẩn trò chuyện</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="hideDialog.show = false" />
        </v-card-title>
        <v-card-text class="pa-4 text-body-2">
          Bạn có chắc chắn muốn ẩn cuộc trò chuyện với <strong>{{ hideDialog.targetConv ? getConvName(hideDialog.targetConv) : '' }}</strong>? Bạn có thể mở lại bất cứ lúc nào bằng cách tìm kiếm tên hoặc SĐT.
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" class="rounded-lg text-none" @click="hideDialog.show = false">Hủy</v-btn>
          <v-btn color="primary" variant="flat" class="rounded-lg text-none font-weight-bold px-4" @click="executeHideConversation">
            Ẩn trò chuyện
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Conversation Dialog -->
    <v-dialog v-model="deleteDialog.show" max-width="400">
      <v-card class="rounded-xl border elevation-8" style="background: rgb(var(--v-theme-surface)) !important;">
        <v-card-title class="d-flex align-center justify-space-between pa-4" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <span class="text-subtitle-1 font-weight-bold text-error">Xóa hội thoại</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="deleteDialog.show = false" />
        </v-card-title>
        <v-card-text class="pa-4 text-body-2">
          Bạn có chắc muốn xóa cuộc trò chuyện với <strong>{{ deleteDialog.targetConv ? getConvName(deleteDialog.targetConv) : '' }}</strong>? Toàn bộ lịch sử tin nhắn sẽ bị xóa vĩnh viễn và không thể khôi phục.
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" class="rounded-lg text-none" @click="deleteDialog.show = false">Hủy</v-btn>
          <v-btn color="error" variant="flat" class="rounded-lg text-none font-weight-bold px-4" :loading="deleteDialog.loading" @click="executeDeleteConversation">
            Xóa hội thoại
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Report Conversation Dialog -->
    <v-dialog v-model="reportDialog.show" max-width="420">
      <v-card class="rounded-xl border elevation-8" style="background: rgb(var(--v-theme-surface)) !important;">
        <v-card-title class="d-flex align-center justify-space-between pa-4" style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <span class="text-subtitle-1 font-weight-bold">Báo xấu cuộc trò chuyện</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="reportDialog.show = false" />
        </v-card-title>
        <v-card-text class="pa-4">
          <p class="text-body-2 mb-3 text-medium-emphasis">Vui lòng chọn lý do báo cáo vi phạm:</p>
          <v-radio-group v-model="reportDialog.reason" density="compact" hide-details>
            <v-radio label="Tin nhắn rác, quảng cáo làm phiền" value="spam" />
            <v-radio label="Lừa đảo hoặc giả mạo" value="fraud" />
            <v-radio label="Nội dung khiếm nhã, quấy rối" value="harassment" />
            <v-radio label="Lý do khác" value="other" />
          </v-radio-group>
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" class="rounded-lg text-none" @click="reportDialog.show = false">Hủy</v-btn>
          <v-btn color="primary" variant="flat" class="rounded-lg text-none font-weight-bold px-4" @click="executeReportConversation">
            Gửi báo cáo
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>


<script setup lang="ts">
import { ref, onMounted, computed, reactive, watch } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { CONVERSATION_CATEGORIES } from '@/constants/conversation-categories';

const authStore = useAuthStore();

const props = defineProps<{
  accountId?: string | null;
  action?: string;
  activeTab?: string;
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  search: string;
  mode?: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  'filter-account': [accountId: string | null];
  'change-tab': [tab: string];
  'action-handled': [action: string];
  'update:search': [value: string];
  'refresh-conversations': [];
  'toggle-mute': [convId: string, isMuted: boolean];
  'load-more': [];
}>();

const accountOptions = ref<{ text: string; value: string }[]>([]);
const roleFilter = ref<string>('all');
const unreadOnly = ref(false);
const groupOnly = ref(false);

const CRM_STATUSES = [
  { id: 'status:new', label: 'Mới tiếp cận', color: '#0284c7' },
  { id: 'status:contacted', label: 'Đang tư vấn', color: '#d97706' },
  { id: 'status:processing', label: 'Đang xử lý / Đơn', color: '#0d9488' },
  { id: 'status:quoted', label: 'Chờ báo giá / Cọc', color: '#9333ea' },
  { id: 'status:converted', label: 'Đã chốt đơn', color: '#16a34a' },
  { id: 'status:completed', label: 'Khách VIP / Hoàn thành', color: '#059669' },
  { id: 'status:warning', label: 'Cần lưu ý', color: '#dc2626' },
  { id: 'status:lost', label: 'Tạm ngưng', color: '#4b5563' }
];

const roleFilterLabel = computed(() => {
  if (roleFilter.value === 'all') return 'Bộ lọc';
  if (roleFilter.value === 'customer') return 'Khách hàng';
  if (roleFilter.value === 'supplier') return 'Nhà cung cấp';
  if (roleFilter.value === 'internal') return 'Nội bộ';
  const foundStatus = CRM_STATUSES.find(s => s.id === roleFilter.value);
  if (foundStatus) return foundStatus.label;
  return roleFilter.value;
});

const roleFilterColor = computed(() => {
  if (roleFilter.value === 'all') return 'rgba(var(--v-theme-on-surface), 0.7)';
  if (roleFilter.value === 'customer') return '#007A3D';
  if (roleFilter.value === 'supplier') return '#EA580C';
  if (roleFilter.value === 'internal') return '#475569';
  const foundStatus = CRM_STATUSES.find(s => s.id === roleFilter.value);
  if (foundStatus) return foundStatus.color;
  return '#2563EB';
});

const customTags = ref<string[]>((() => {
  try {
    return JSON.parse(localStorage.getItem('crm:custom-tags') || '[]');
  } catch {
    return [];
  }
})());

function addCustomTag(tagName: string) {
  const t = tagName.trim();
  if (!t || t === 'Khách hàng' || t === 'Nhà cung cấp' || t === 'Nội bộ' || t === 'Nội bộ công ty') return;
  if (!customTags.value.includes(t)) {
    customTags.value.push(t);
    try {
      localStorage.setItem('crm:custom-tags', JSON.stringify(customTags.value));
    } catch {}
  }
}

const allCategories = computed(() => [
  ...CONVERSATION_CATEGORIES,
  ...customTags.value.map(t => ({ title: t, icon: 'mdi-tag-outline', color: '#475569' }))
]);

function handleCreateTag() {
  const name = prompt('Nhập tên nhãn mới:');
  if (name && name.trim()) {
    addCustomTag(name.trim());
    roleFilter.value = name.trim();
    snackbar.value = { show: true, text: `Đã tạo nhãn: ${name.trim()}`, color: 'success' };
  }
}
const currentAccountName = computed(() => accountOptions.value.find(account => account.value === props.accountId)?.text || 'Tất cả Zalo');
const selectedAccountId = ref<string | null>(props.accountId || null);
watch(() => props.accountId, value => { selectedAccountId.value = value || null; });
const zaloAccountsList = ref<any[]>([]);
const syncingMessages = ref(false);
const accountActionsReady = ref(false);
async function runAccountAction(action?: string) {
  if (!accountActionsReady.value || !action) return;
  if (action === 'add-friend') openSearchDialogDirect();
  else if (action === 'create-group') await openCreateGroupDialog();
  else if (action === 'sync') await syncRecentMessages();
  emit('action-handled', action);
}
watch(() => props.action, action => { void runAccountAction(action); });

function onConvListScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= 150 && props.hasMore && !props.loadingMore) {
    emit('load-more');
  }
}

async function syncRecentMessages() {
  syncingMessages.value = true;
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
    const connected = accounts.filter((a: any) => a.liveStatus === 'connected' || a.status === 'connected');

    const targetAccounts = selectedAccountId.value
      ? connected.filter((a: any) => a.id === selectedAccountId.value)
      : connected;

    for (const acc of targetAccounts) {
      if (acc.channel === 'whatsapp') {
        await api.post(`/whatsapp-accounts/${acc.id}/sync`).catch(() => {});
      } else {
        await api.post(`/zalo-accounts/${acc.id}/sync-messages`).catch(() => {});
      }
    }

    emit('refresh-conversations');
  } catch (err) {
    console.error('Failed to sync messages:', err);
  } finally {
    setTimeout(() => {
      syncingMessages.value = false;
      emit('refresh-conversations');
    }, 1500);
  }
}

onMounted(async () => {
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
    zaloAccountsList.value = accounts.filter((a: any) => a.liveStatus === 'connected' || a.status === 'connected');
    accountOptions.value = accounts.map((a: any) => ({
      text: a.displayName || a.zaloUid || a.id,
      value: a.id,
    }));
  } catch {
    // Existing dialogs remain available even if the account list fails to load.
  }
  accountActionsReady.value = true;
  void runAccountAction(props.action);
});

function lastMessagePreview(conv: Conversation): string {
  const msg = conv.messages?.[0];
  if (!msg) return '';
  if (msg.isDeleted) return '(đã thu hồi)';
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';

  switch (msg.contentType) {
    case 'image': {
      if (msg.content?.startsWith('{')) {
        try {
          const p = JSON.parse(msg.content);
          const caption = p.title || p.caption || p.description;
          if (caption && typeof caption === 'string' && caption.trim()) {
            const trimmed = caption.trim();
            return prefix + '📷 ' + (trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed);
          }
        } catch {}
      }
      return prefix + '📷 Hình ảnh';
    }
    case 'sticker': return prefix + '🏷️ Sticker';
    case 'video': return prefix + '🎥 Video';
    case 'voice': {
      if (msg.content?.startsWith('{')) {
        try {
          const p = JSON.parse(msg.content);
          let params = p.params;
          if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
          const durMs = Number(params?.duration || 0);
          if (durMs > 0) {
            return prefix + `🎤 Tin nhắn thoại (${Math.round(durMs / 1000)}s)`;
          }
        } catch {}
      }
      return prefix + '🎤 Tin nhắn thoại';
    }
    case 'gif': return prefix + 'GIF';
    case 'call': {
      if (msg.content?.startsWith('{')) {
        try {
          const p = JSON.parse(msg.content);
          let params = p.params;
          if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
          const duration = Number(params?.duration || 0);
          const isCaller = Number(params?.isCaller || 0);
          const isMissed = duration === 0 || p.action?.includes('misscall') || p.action?.includes('miss');
          if (isMissed) {
            return isCaller === 1 ? prefix + '📞 Cuộc gọi nhỡ đi' : '📞 Cuộc gọi đến nhỡ';
          }
          const durText = duration > 60 ? `${Math.floor(duration / 60)}p${duration % 60}s` : `${duration}s`;
          return prefix + `📞 Cuộc gọi (${durText})`;
        } catch {}
      }
      return prefix + '📞 Cuộc gọi';
    }
    case 'contact_card': return prefix + '👤 Danh thiếp liên hệ';
    case 'bank_card': return prefix + '💳 Thẻ ngân hàng & VietQR';
    case 'reminder': return prefix + '⏰ Nhắc hẹn Zalo';
    case 'file': {
      if (msg.content?.startsWith('{')) {
        try {
          const p = JSON.parse(msg.content);
          if (p.title) return prefix + '📎 ' + (p.title.length > 40 ? p.title.slice(0, 40) + '...' : p.title);
        } catch {}
      }
      return prefix + '📎 Tệp đính kèm';
    }
    case 'link': {
      if (msg.content?.startsWith('{')) {
        try {
          const p = JSON.parse(msg.content);
          let params = p.params;
          if (typeof params === 'string') { try { params = JSON.parse(params); } catch {} }
          const title = p.title || params?.mediaTitle || p.description;
          if (title && typeof title === 'string' && title.trim()) {
            const t = title.trim();
            return prefix + '🔗 ' + (t.length > 40 ? t.slice(0, 40) + '...' : t);
          }
        } catch {}
      }
      return prefix + '🔗 Liên kết';
    }
  }

  // Reminder/calendar or JSON system messages
  if (msg.content) {
    if (msg.content.includes('clientDelMsgId') || msg.content.includes('globalDelMsgId') || msg.content.includes('deleteMsg')) {
      return '(đã thu hồi)';
    }
    if (msg.content.startsWith('{')) {
      try {
        const p = JSON.parse(msg.content);
        if (p.action === 'msginfo.actionlist' && p.title) {
          return prefix + '📅 ' + p.title.slice(0, 50);
        }
        if (p.title === 'sendBubbleMessage' || p.action?.includes('call')) {
          return prefix + '📞 Cuộc gọi';
        }
        if (p.title && p.title.includes('đã ghim')) {
          return prefix + '📌 ' + p.title.slice(0, 50);
        }
        if (p.title) return prefix + p.title.slice(0, 50);
        if (p.description) return prefix + p.description.slice(0, 50);
      } catch { /* not JSON */ }
    }
  }

  const text = msg.content || '';
  return prefix + (text.length > 50 ? text.slice(0, 50) + '...' : text);
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays} ngày`;

  return date.toLocaleDateString('vi-VN');
}

function isOverdue(conv: Conversation): boolean {
  const shouldTrack = conv.threadType === 'user' || conv.isCustomer;
  if (!shouldTrack || conv.quoteCompleted) return false;
  if (!conv.lastMessageAt) return false;
  const lastTime = new Date(conv.lastMessageAt).getTime();
  const diffMs = Date.now() - lastTime;
  return diffMs > 24 * 60 * 60 * 1000;
}

function isUncompletedTask(_conv: Conversation): boolean {
  return false; // Tạm tắt tính năng cảnh báo tồn đọng
}
void isOverdue;
void isUncompletedTask;

// Pinned conversations state
const PINNED_STORAGE_KEY = 'crm:pinned-conversations';
const pinnedConversationIds = ref<string[]>([]);
try {
  pinnedConversationIds.value = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) || '[]');
} catch {
  pinnedConversationIds.value = [];
}

function isPinned(convId: string): boolean {
  return pinnedConversationIds.value.includes(convId);
}

function togglePin(convId: string) {
  const idx = pinnedConversationIds.value.indexOf(convId);
  if (idx !== -1) {
    pinnedConversationIds.value.splice(idx, 1);
    snackbar.value = { show: true, text: 'Đã bỏ ghim hội thoại', color: 'info' };
  } else {
    pinnedConversationIds.value.unshift(convId);
    snackbar.value = { show: true, text: 'Đã ghim hội thoại lên đầu', color: 'success' };
  }
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedConversationIds.value));
  } catch {}
}

// Category tag assignment
async function toggleCategory(conv: Conversation, catTitle: string) {
  const contact = conv.contact;
  if (!contact || !contact.id) {
    snackbar.value = { show: true, text: 'Không tìm thấy thông tin liên hệ', color: 'warning' };
    return;
  }

  const current = Array.isArray(contact.tags) ? [...contact.tags] : [];
  const idx = current.indexOf(catTitle);
  if (idx !== -1) {
    current.splice(idx, 1);
  } else {
    // Mutual exclusivity between Khách hàng, Nhà cung cấp, Nội bộ
    if (catTitle === 'Khách hàng') {
      const suppIdx = current.indexOf('Nhà cung cấp');
      if (suppIdx !== -1) current.splice(suppIdx, 1);
      const intIdx = current.indexOf('Nội bộ công ty');
      if (intIdx !== -1) current.splice(intIdx, 1);
    } else if (catTitle === 'Nhà cung cấp') {
      const custIdx = current.indexOf('Khách hàng');
      if (custIdx !== -1) current.splice(custIdx, 1);
      const intIdx = current.indexOf('Nội bộ công ty');
      if (intIdx !== -1) current.splice(intIdx, 1);
    } else if (catTitle === 'Nội bộ công ty' || catTitle === 'Nội bộ') {
      const custIdx = current.indexOf('Khách hàng');
      if (custIdx !== -1) current.splice(custIdx, 1);
      const suppIdx = current.indexOf('Nhà cung cấp');
      if (suppIdx !== -1) current.splice(suppIdx, 1);
    }
    current.push(catTitle);
    addCustomTag(catTitle);
  }
  contact.tags = current;

  try {
    await api.put(`/contacts/${contact.id}/tags`, { tags: current });
    snackbar.value = { show: true, text: `Đã cập nhật phân loại: ${catTitle}`, color: 'success' };
    emit('refresh-conversations');
  } catch (err) {
    console.error('Failed to update category:', err);
    snackbar.value = { show: true, text: 'Không thể cập nhật phân loại', color: 'error' };
  }
}

// Mark unread / read toggle
async function toggleMarkUnread(conv: Conversation) {
  if (conv.unreadCount > 0) {
    conv.unreadCount = 0;
    try {
      await api.post(`/conversations/${conv.id}/mark-read`);
      snackbar.value = { show: true, text: 'Đã đánh dấu đã đọc', color: 'success' };
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  } else {
    conv.unreadCount = 1;
    try {
      await api.post(`/conversations/${conv.id}/mark-unread`);
      snackbar.value = { show: true, text: 'Đã đánh dấu chưa đọc', color: 'info' };
    } catch (err) {
      console.error('Failed to mark unread:', err);
    }
  }
}

// Add to group helper
function handleAddToGroup(conv: Conversation) {
  if (conv.contact?.zaloUid) {
    createGroupDialog.selectedMembers = [conv.contact.zaloUid];
  } else {
    createGroupDialog.selectedMembers = [];
  }
  if (conv.zaloAccount?.id) {
    createGroupDialog.accountId = conv.zaloAccount.id;
  }
  void openCreateGroupDialog();
}

// Mute notification helpers
function muteConversation(conv: Conversation, minutes: number) {
  emit('toggle-mute', conv.id, true);
  conv.isMuted = true;
  const label = minutes === 60 ? '1 giờ' : minutes === 240 ? '4 giờ' : minutes === 480 ? '8 giờ' : 'cho đến khi được bật lại';
  snackbar.value = { show: true, text: `Đã tắt thông báo (${label})`, color: 'info' };
}

function unmuteConversation(conv: Conversation) {
  emit('toggle-mute', conv.id, false);
  conv.isMuted = false;
  snackbar.value = { show: true, text: 'Đã bật thông báo', color: 'success' };
}

// Hidden conversations state
const HIDDEN_STORAGE_KEY = 'crm:hidden-conversations';
const hiddenConversationIds = ref<string[]>([]);
try {
  hiddenConversationIds.value = JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || '[]');
} catch {
  hiddenConversationIds.value = [];
}

const hideDialog = reactive({
  show: false,
  targetConv: null as Conversation | null,
});

function confirmHideConversation(conv: Conversation) {
  hideDialog.targetConv = conv;
  hideDialog.show = true;
}

function executeHideConversation() {
  if (!hideDialog.targetConv) return;
  const convId = hideDialog.targetConv.id;
  if (!hiddenConversationIds.value.includes(convId)) {
    hiddenConversationIds.value.push(convId);
    try {
      localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hiddenConversationIds.value));
    } catch {}
  }
  hideDialog.show = false;
  snackbar.value = { show: true, text: 'Đã ẩn trò chuyện', color: 'info' };
  if (props.selectedId === convId) {
    emit('select', '');
  }
}

// Delete conversation
const deleteDialog = reactive({
  show: false,
  loading: false,
  targetConv: null as Conversation | null,
});

function confirmDeleteConversation(conv: Conversation) {
  deleteDialog.targetConv = conv;
  deleteDialog.show = true;
}

async function executeDeleteConversation() {
  if (!deleteDialog.targetConv) return;
  const convId = deleteDialog.targetConv.id;
  deleteDialog.loading = true;
  try {
    await api.delete(`/conversations/${convId}`);
    deleteDialog.show = false;
    snackbar.value = { show: true, text: 'Đã xóa hội thoại thành công', color: 'success' };
    emit('refresh-conversations');
    if (props.selectedId === convId) {
      emit('select', '');
    }
  } catch (err) {
    console.error('Failed to delete conversation:', err);
    snackbar.value = { show: true, text: 'Không thể xóa hội thoại', color: 'error' };
  } finally {
    deleteDialog.loading = false;
  }
}

// Report conversation
const reportDialog = reactive({
  show: false,
  reason: 'spam',
  targetConv: null as Conversation | null,
});

function openReportDialog(conv: Conversation) {
  reportDialog.targetConv = conv;
  reportDialog.reason = 'spam';
  reportDialog.show = true;
}

function executeReportConversation() {
  reportDialog.show = false;
  snackbar.value = { show: true, text: 'Đã gửi báo cáo vi phạm thành công', color: 'success' };
}

function getConvName(conv: Conversation): string {
  return conv.threadType === 'group'
    ? (conv.contact?.fullName || conv.groupName || 'Nhóm')
    : (conv.contact?.fullName || 'Khách hàng');
}

// Display conversations sorting (Pinned first, then tracked mode or lastMessageAt)
const displayConversations = computed(() => {
  // Filter out hidden conversations unless searching
  let filtered = props.conversations.filter(c => {
    if (props.search?.trim()) return true;
    return !hiddenConversationIds.value.includes(c.id);
  });

  // Channel filter (zalo / whatsapp)
  if (props.activeTab === 'zalo') {
    filtered = filtered.filter(c => {
      const ch = c.channel || (c.zaloAccount as any)?.channel || 'zalo';
      return ch !== 'whatsapp';
    });
  } else if (props.activeTab === 'whatsapp') {
    filtered = filtered.filter(c => {
      const ch = c.channel || (c.zaloAccount as any)?.channel;
      return ch === 'whatsapp';
    });
  }

  // Unread toggle filter (strictly unread conversations only)
  if (unreadOnly.value) {
    filtered = filtered.filter(c => Number(c.unreadCount || 0) > 0);
  }

  // Group toggle filter
  if (groupOnly.value) {
    filtered = filtered.filter(c => c.threadType === 'group' || (c as any).isGroup === true);
  }

  // Helper role tags
  const hasTag = (c: Conversation, tag: string) => {
    const t = c.contact?.tags as any;
    return Array.isArray(t) ? t.includes(tag) : (typeof t === 'string' ? t.includes(tag) : false);
  };
  const isSupplier = (c: Conversation) => hasTag(c, 'Nhà cung cấp');
  const isInternal = (c: Conversation) => hasTag(c, 'Nội bộ') || hasTag(c, 'Nội bộ công ty');
  const isCustomer = (c: Conversation) => hasTag(c, 'Khách hàng') || (!isSupplier(c) && !isInternal(c));

  // Filter by role: Khách hàng vs Nhà cung cấp vs Nội bộ vs CRM status vs Nhãn tự tạo
  if (roleFilter.value === 'customer') {
    filtered = filtered.filter(isCustomer);
  } else if (roleFilter.value === 'supplier') {
    filtered = filtered.filter(isSupplier);
  } else if (roleFilter.value === 'internal') {
    filtered = filtered.filter(isInternal);
  } else if (roleFilter.value.startsWith('status:')) {
    const targetStatus = roleFilter.value.replace('status:', '');
    filtered = filtered.filter(c => {
      const curStatus = c.contact?.status || 'new';
      return targetStatus === 'completed'
        ? (curStatus === 'completed' || curStatus === 'vip')
        : curStatus === targetStatus;
    });
  } else if (roleFilter.value !== 'all') {
    filtered = filtered.filter(c => hasTag(c, roleFilter.value));
  }

  const getDeliveryDays = (conv: Conversation): number => {
    const dateStr = conv.contact?.metadata?.deliveryDate;
    if (!dateStr) return 999999;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const delivery = new Date(dateStr + 'T00:00:00');
    const diffTime = delivery.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return [...filtered].sort((a, b) => {
    // Priority 1: Pinned conversations
    const aPinned = isPinned(a.id);
    const bPinned = isPinned(b.id);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    if (props.mode === 'tracked') {
      // Tier 1: Needs reply (not replied yet)
      const aNeedsReply = !a.isReplied;
      const bNeedsReply = !b.isReplied;

      if (aNeedsReply !== bNeedsReply) {
        return aNeedsReply ? -1 : 1;
      }

      // Sort by delivery days (ascending, fewer days left/overdue first)
      const aDays = getDeliveryDays(a);
      const bDays = getDeliveryDays(b);
      if (aDays !== bDays) {
        return aDays - bDays;
      }
    }

    // Fallback: sort by lastMessageAt descending
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
});

function getDeliveryDaysRemaining(deliveryDateStr: string | null | undefined): { days: number; text: string; color: string; icon: string } {
  if (!deliveryDateStr) return { days: 0, text: '—', color: 'grey', icon: '' };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const delivery = new Date(deliveryDateStr + 'T00:00:00');
  
  const diffTime = delivery.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return {
      days: diffDays,
      text: 'Trễ',
      color: 'error',
      icon: 'mdi-alert-circle'
    };
  } else if (diffDays === 0 || diffDays === 1) {
    return {
      days: diffDays,
      text: 'Giao Hàng',
      color: 'error',
      icon: 'mdi-clock-alert'
    };
  } else if (diffDays === 2 || diffDays === 3) {
    return {
      days: diffDays,
      text: `${diffDays} ngày`,
      color: 'warning',
      icon: 'mdi-clock-outline'
    };
  } else {
    return {
      days: diffDays,
      text: `${diffDays} ngày`,
      color: 'success',
      icon: 'mdi-clock-outline'
    };
  }
}

// Search and Add Friend logic
const showDialog = ref(false);
const searchingZalo = ref(false);
const addingFriend = ref(false);
const searchError = ref(null as string | null);
const foundUser = ref(null as any);
const targetAccountId = ref(null as string | null);
const addFriendMessage = ref('Chào bạn, kết bạn với mình nhé.');
const snackbar = ref({
  show: false,
  text: '',
  color: 'success'
});
const sendFriendReq = ref(true);
const dialogPhone = ref('');

const isPhoneNumber = computed(() => {
  const clean = props.search?.trim().replace(/\s+/g, '');
  return /^(0|84)\d{8,10}$/.test(clean);
});

function openSearchDialogDirect() {
  dialogPhone.value = props.search?.trim() || '';
  showDialog.value = true;
  searchError.value = null;
  foundUser.value = null;
  targetAccountId.value = selectedAccountId.value || accountOptions.value[0]?.value || null;
}

async function searchZalo() {
  if (!dialogPhone.value || !dialogPhone.value.trim()) {
    searchError.value = 'Vui lòng nhập số điện thoại cần tìm.';
    return;
  }

  searchingZalo.value = true;
  searchError.value = null;
  foundUser.value = null;

  // Use whatever account the user has selected in the dialog, do NOT override it
  if (!targetAccountId.value) {
    searchingZalo.value = false;
    searchError.value = 'Vui lòng chọn tài khoản Zalo để tìm kiếm.';
    return;
  }

  try {
    const res = await api.post('/zalo/search-phone', {
      phone: dialogPhone.value.trim().replace(/\s+/g, ''),
      accountId: targetAccountId.value
    });
    foundUser.value = res.data;
  } catch (err: any) {
    searchError.value = err.response?.data?.error || 'Không tìm thấy số điện thoại này trên Zalo hoặc tài khoản Zalo của bạn đang bị ngắt kết nối.';
  } finally {
    searchingZalo.value = false;
  }
}

async function addFriendAndOpenChat() {
  if (!foundUser.value || !targetAccountId.value) return;

  addingFriend.value = true;
  try {
    const res = await api.post('/zalo/add-friend', {
      uid: foundUser.value.uid,
      phone: dialogPhone.value.trim().replace(/\s+/g, ''),
      name: foundUser.value.display_name || foundUser.value.zalo_name || 'Khách hàng',
      avatar: foundUser.value.avatar || undefined,
      message: addFriendMessage.value,
      accountId: targetAccountId.value,
      skipAddFriend: !sendFriendReq.value
    });

    showDialog.value = false;
    emit('update:search', ''); // Clear search input
    emit('refresh-conversations'); // Refresh conversation list
    emit('select', res.data.conversationId); // Select the new chat
  } catch (err: any) {
    snackbar.value = {
      show: true,
      text: err.response?.data?.error || 'Lỗi khi xử lý yêu cầu',
      color: 'error'
    };
  } finally {
    addingFriend.value = false;
  }
}

// ── Create Zalo Group ────────────────────────────────────────────────────────
const createGroupDialog = reactive({
  show: false,
  valid: false,
  accountId: '',
  name: '',
  memberSearch: '',
  contacts: [] as Array<{ id: string; fullName: string; zaloUid: string; avatarUrl?: string }>,
  selectedMembers: [] as string[],
  loadingMembers: false,
  submitting: false,
  errorMessage: '',
});

const filteredContacts = computed(() => {
  const query = createGroupDialog.memberSearch.toLowerCase().trim();
  if (!query) return createGroupDialog.contacts;
  return createGroupDialog.contacts.filter(c =>
    c.fullName.toLowerCase().includes(query)
  );
});

async function openCreateGroupDialog() {
  if (selectedAccountId.value) {
    createGroupDialog.accountId = selectedAccountId.value;
  } else if (zaloAccountsList.value.length > 0) {
    createGroupDialog.accountId = zaloAccountsList.value[0].id;
  }
  createGroupDialog.name = '';
  createGroupDialog.memberSearch = '';
  createGroupDialog.selectedMembers = [];
  createGroupDialog.errorMessage = '';
  createGroupDialog.show = true;
  if (createGroupDialog.accountId) {
    await fetchContactsForGroup();
  }
}

function closeCreateGroupDialog() {
  createGroupDialog.show = false;
}

async function fetchContactsForGroup() {
  if (!createGroupDialog.accountId) return;
  createGroupDialog.loadingMembers = true;
  createGroupDialog.errorMessage = '';
  try {
    const res = await api.get('/contacts', {
      params: {
        zaloAccountId: createGroupDialog.accountId,
        limit: 150
      }
    });
    const rawContacts = res.data.contacts || [];
    createGroupDialog.contacts = rawContacts.filter((c: any) => c.zaloUid);
  } catch (err: any) {
    console.error('Failed to fetch Zalo contacts:', err);
    createGroupDialog.errorMessage = 'Không thể tải danh sách danh bạ.';
  } finally {
    createGroupDialog.loadingMembers = false;
  }
}

async function submitCreateGroup() {
  if (!createGroupDialog.accountId || !createGroupDialog.name.trim() || createGroupDialog.selectedMembers.length === 0) return;
  createGroupDialog.submitting = true;
  createGroupDialog.errorMessage = '';
  try {
    const res = await api.post(`/zalo-accounts/${createGroupDialog.accountId}/create-group`, {
      name: createGroupDialog.name.trim(),
      members: createGroupDialog.selectedMembers
    });
    createGroupDialog.show = false;
    
    emit('select', res.data.conversation.id);
    emit('refresh-conversations');
  } catch (err: any) {
    console.error('Create group failed:', err);
    createGroupDialog.errorMessage = err.response?.data?.error || 'Không thể tạo nhóm Zalo mới.';
  } finally {
    createGroupDialog.submitting = false;
  }
}
</script>

<style scoped>
@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-pulse {
  animation: pulse 1.5s infinite;
  display: inline-block;
}
.bg-red-lighten-5 {
  background-color: rgba(244, 67, 54, 0.08) !important;
  transition: background-color 0.2s;
}
.bg-red-lighten-5:hover {
  background-color: rgba(244, 67, 54, 0.12) !important;
}
.unread-conv-bg {
  background-color: rgba(var(--v-theme-primary), 0.06) !important;
  transition: background-color 0.2s;
}
.unread-conv-bg:hover {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
}
.border-left-red {
  border-left: 4px solid #f44336 !important;
}
.border-left-red-active {
  border-left: 4px solid #ff1744 !important;
}

/* Theme-adaptive Unread Badge & Mute Styles */
.unread-badge-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.2px;
  transition: all 0.2s ease;
}
.unread-badge-active {
  background-color: #ff5252;
  color: #ffffff;
  box-shadow: 0 0 6px rgba(255, 82, 82, 0.4);
}
.unread-badge-muted {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.65);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
}
.muted-bell-icon {
  opacity: 0.6;
  color: rgb(var(--v-theme-on-surface));
}
:deep(.v-list-item__append) {
  align-self: stretch !important;
  display: flex !important;
  align-items: stretch !important;
}
.conv-append-container {
  min-height: 44px;
  padding: 1px 0 2px 0;
}
.conv-time-label {
  font-size: 0.68rem !important;
  line-height: 1.2 !important;
  color: rgba(var(--v-theme-on-surface), 0.58) !important;
  white-space: nowrap;
}
.conv-action-wrapper {
  margin-top: auto;
  height: 22px;
  display: flex;
  align-items: center;
}
.conv-action-menu-btn {
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  min-height: 22px !important;
  opacity: 0.35;
  transition: opacity 0.15s ease, background 0.15s ease;
  border-radius: 50% !important;
}
.conversation-list-item:hover .conv-action-menu-btn,
.conv-action-menu-btn:hover,
.conv-action-menu-btn[aria-expanded="true"] {
  opacity: 1 !important;
  background: rgba(var(--v-theme-on-surface), 0.08) !important;
}

/* Zalo-native Context Menu */
.conv-context-menu {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25) !important;
}
.conv-menu-item {
  min-height: 38px !important;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.conv-menu-item:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08) !important;
}
</style>
