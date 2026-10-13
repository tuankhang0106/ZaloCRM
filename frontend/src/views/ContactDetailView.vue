<template>
  <div class="contact-detail-page">
    <!-- Loading skeleton -->
    <div v-if="loading" class="pa-4">
      <v-skeleton-loader type="article, actions" class="mb-4 rounded-lg" />
      <v-row>
        <v-col cols="12" sm="6" md="3"><v-skeleton-loader type="card" class="rounded-lg" /></v-col>
        <v-col cols="12" sm="6" md="3"><v-skeleton-loader type="card" class="rounded-lg" /></v-col>
        <v-col cols="12" sm="6" md="3"><v-skeleton-loader type="card" class="rounded-lg" /></v-col>
        <v-col cols="12" sm="6" md="3"><v-skeleton-loader type="card" class="rounded-lg" /></v-col>
      </v-row>
      <v-row class="mt-2">
        <v-col cols="12" md="8"><v-skeleton-loader type="table" class="rounded-lg" /></v-col>
        <v-col cols="12" md="4"><v-skeleton-loader type="article" class="rounded-lg" /></v-col>
      </v-row>
    </div>

    <!-- 404 / Not found state -->
    <div v-else-if="!contact" class="text-center py-16">
      <v-icon icon="mdi-account-search-outline" size="72" color="grey-lighten-1" class="mb-4" />
      <h2 class="text-h5 font-weight-bold mb-2">Không tìm thấy khách hàng</h2>
      <p class="text-body-2 text-grey mb-6">
        Khách hàng này không tồn tại, đã bị xoá hoặc bạn không có quyền truy cập.
      </p>
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-arrow-left"
        class="text-none font-weight-medium rounded-lg"
        @click="router.push('/contacts')"
      >
        Về danh sách khách hàng
      </v-btn>
    </div>

    <!-- Main Detail Content -->
    <div v-else>
      <!-- Breadcrumb navigation -->
      <nav class="d-flex align-center mb-3 text-caption text-grey">
        <router-link to="/contacts" class="text-decoration-none text-grey d-flex align-center back-link">
          <v-icon icon="mdi-chevron-left" size="18" class="mr-1" />
          <span>Danh sách khách hàng</span>
        </router-link>
        <v-icon icon="mdi-chevron-right" size="14" class="mx-2" />
        <span class="text-foreground font-weight-medium text-truncate" style="max-width: 250px;">
          {{ contact.fullName || 'Chi tiết khách hàng' }}
        </span>
      </nav>

      <!-- Hero Header Card -->
      <v-card variant="outlined" class="pa-5 mb-5 rounded-xl hero-card">
        <div class="d-flex flex-column flex-md-row justify-space-between align-start align-md-center gap-4">
          <!-- Left: Avatar & Basic Information -->
          <div class="d-flex align-center gap-4">
            <v-avatar size="64" color="primary-lighten-4" class="hero-avatar">
              <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" />
              <span v-else class="text-h5 font-weight-bold text-primary">
                {{ getInitials(contact.fullName) }}
              </span>
            </v-avatar>
            <div>
              <div class="d-flex align-center flex-wrap gap-2 mb-1">
                <h1 class="text-h5 font-weight-bold text-foreground mb-0">
                  {{ contact.fullName || 'Khách hàng chưa đặt tên' }}
                </h1>
                <!-- Customer Code Badge -->
                <v-chip
                  v-if="contact.metadata?.customerCode"
                  color="purple"
                  size="small"
                  variant="flat"
                  class="font-weight-bold"
                >
                  {{ contact.metadata.customerCode }}
                </v-chip>
                <!-- Status Chip -->
                <v-chip
                  v-if="contact.status"
                  :color="statusColor(contact.status)"
                  size="small"
                  variant="tonal"
                  class="font-weight-medium"
                >
                  {{ statusLabel(contact.status) }}
                </v-chip>
                <!-- Source Chip -->
                <v-chip
                  v-if="contact.source"
                  size="small"
                  variant="tonal"
                  color="info"
                  class="font-weight-medium"
                >
                  {{ sourceLabel(contact.source) }}
                </v-chip>
              </div>
              <p class="text-caption text-grey mb-0 d-flex align-center flex-wrap gap-3">
                <span v-if="contact.phone">
                  <v-icon icon="mdi-phone-outline" size="14" class="mr-1" />
                  {{ contact.phone }}
                </span>
                <span v-if="contact.email">
                  <v-icon icon="mdi-email-outline" size="14" class="mr-1" />
                  {{ contact.email }}
                </span>
                <span>
                  <v-icon icon="mdi-calendar-check-outline" size="14" class="mr-1" />
                  Tiếp nhận: {{ formatDate(contact.firstContactDate || contact.createdAt) }}
                </span>
              </p>
            </div>
          </div>

          <!-- Right: Action Buttons -->
          <div class="d-flex align-center flex-wrap gap-2 action-buttons-group">
            <!-- Chat via Zalo -->
            <v-btn
              color="primary"
              variant="flat"
              prepend-icon="mdi-message-text-outline"
              class="text-none font-weight-medium rounded-lg"
              @click="openChat"
            >
              Nhắn tin Zalo
            </v-btn>

            <!-- Create Order Button -->
            <v-btn
              v-if="!isAccountant"
              variant="outlined"
              prepend-icon="mdi-cart-plus"
              class="text-none font-weight-medium rounded-lg"
              @click="showCreateOrderDialog = true"
            >
              Tạo đơn
            </v-btn>

            <!-- Create Appointment Button -->
            <v-btn
              v-if="!isAccountant"
              variant="outlined"
              prepend-icon="mdi-calendar-plus"
              class="text-none font-weight-medium rounded-lg"
              @click="showCreateAppointmentDialog = true"
            >
              Đặt lịch hẹn
            </v-btn>

            <!-- Edit Contact Button -->
            <v-btn
              variant="outlined"
              icon="mdi-pencil-outline"
              class="rounded-lg"
              title="Chỉnh sửa thông tin"
              @click="showEditDialog = true"
            />

            <!-- Delete Contact Button -->
            <v-btn
              v-if="!isAccountant"
              color="error"
              variant="outlined"
              icon="mdi-delete-outline"
              class="rounded-lg"
              title="Xoá khách hàng"
              @click="showDeleteDialog = true"
            />
          </div>
        </div>
      </v-card>

      <!-- 4 Top KPI Metric Cards -->
      <v-row class="mb-5" dense>
        <!-- Total Spent -->
        <v-col cols="12" sm="6" md="3">
          <v-card variant="outlined" class="pa-4 rounded-xl stat-card">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption text-grey font-weight-medium">Tổng chi tiêu</span>
              <v-avatar color="primary-lighten-4" size="32" class="text-primary">
                <v-icon icon="mdi-cash-multiple" size="18" />
              </v-avatar>
            </div>
            <div class="text-h6 font-weight-bold text-foreground">
              {{ formatVND(totalSpent) }}
            </div>
            <div class="text-caption text-grey mt-1">
              {{ completedOrderCount }} đơn thành công
            </div>
          </v-card>
        </v-col>

        <!-- Total Orders -->
        <v-col cols="12" sm="6" md="3">
          <v-card variant="outlined" class="pa-4 rounded-xl stat-card">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption text-grey font-weight-medium">Tổng số đơn hàng</span>
              <v-avatar color="blue-lighten-4" size="32" class="text-blue">
                <v-icon icon="mdi-shopping-outline" size="18" />
              </v-avatar>
            </div>
            <div class="text-h6 font-weight-bold text-foreground">
              {{ contact.orders?.length || 0 }} đơn
            </div>
            <div class="text-caption text-grey mt-1">
              {{ pendingOrderCount }} đơn đang xử lý
            </div>
          </v-card>
        </v-col>

        <!-- Appointments -->
        <v-col cols="12" sm="6" md="3">
          <v-card variant="outlined" class="pa-4 rounded-xl stat-card">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption text-grey font-weight-medium">Lịch hẹn</span>
              <v-avatar color="amber-lighten-4" size="32" class="text-amber-darken-3">
                <v-icon icon="mdi-calendar-clock-outline" size="18" />
              </v-avatar>
            </div>
            <div class="text-h6 font-weight-bold text-foreground">
              {{ contact.appointments?.length || 0 }} cuộc hẹn
            </div>
            <div class="text-caption text-grey mt-1">
              {{ nextAppointmentText }}
            </div>
          </v-card>
        </v-col>

        <!-- Zalo Conversations -->
        <v-col cols="12" sm="6" md="3">
          <v-card variant="outlined" class="pa-4 rounded-xl stat-card">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption text-grey font-weight-medium">Hội thoại Zalo</span>
              <v-avatar color="teal-lighten-4" size="32" class="text-teal">
                <v-icon icon="mdi-chat-processing-outline" size="18" />
              </v-avatar>
            </div>
            <div class="text-h6 font-weight-bold text-foreground">
              {{ contact.conversations?.length || 0 }} luồng chat
            </div>
            <div class="text-caption text-grey mt-1">
              {{ lastChatTimeText }}
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- 2-Column Body Layout -->
      <v-row>
        <!-- Main Column: Tabs for Orders, Appointments, Conversations, Timeline -->
        <v-col cols="12" md="8">
          <v-card variant="outlined" class="rounded-xl overflow-hidden mb-5">
            <!-- Tabs Header -->
            <v-tabs
              v-model="activeTab"
              color="primary"
              align-tabs="start"
              class="border-b"
              height="48"
            >
              <v-tab value="orders" class="text-none font-weight-medium">
                <v-icon start icon="mdi-cart-outline" class="mr-1" />
                Đơn hàng ({{ contact.orders?.length || 0 }})
              </v-tab>
              <v-tab value="appointments" class="text-none font-weight-medium">
                <v-icon start icon="mdi-calendar-outline" class="mr-1" />
                Lịch hẹn ({{ contact.appointments?.length || 0 }})
              </v-tab>
              <v-tab value="conversations" class="text-none font-weight-medium">
                <v-icon start icon="mdi-chat-outline" class="mr-1" />
                Hội thoại ({{ contact.conversations?.length || 0 }})
              </v-tab>
              <v-tab value="notes" class="text-none font-weight-medium">
                <v-icon start icon="mdi-note-text-outline" class="mr-1" />
                Ghi chú & Theo dõi
              </v-tab>
            </v-tabs>

            <v-card-text class="pa-4">
              <!-- TAB 1: Orders -->
              <div v-if="activeTab === 'orders'">
                <div class="d-flex align-center justify-space-between mb-3">
                  <h3 class="text-subtitle-1 font-weight-bold mb-0">Lịch sử đơn hàng</h3>
                  <v-btn
                    v-if="!isAccountant"
                    size="small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-plus"
                    class="text-none font-weight-medium"
                    @click="showCreateOrderDialog = true"
                  >
                    Tạo đơn mới
                  </v-btn>
                </div>

                <div v-if="!contact.orders || contact.orders.length === 0" class="text-center py-10">
                  <v-icon icon="mdi-cart-off" size="48" color="grey-lighten-1" class="mb-2" />
                  <p class="text-body-2 text-grey mb-3">Chưa có đơn hàng nào cho khách hàng này</p>
                  <v-btn
                    v-if="!isAccountant"
                    size="small"
                    color="primary"
                    variant="flat"
                    class="text-none"
                    @click="showCreateOrderDialog = true"
                  >
                    Tạo đơn hàng đầu tiên
                  </v-btn>
                </div>

                <v-table v-else density="comfortable" hover class="rounded-lg border">
                  <thead>
                    <tr>
                      <th class="font-weight-bold">Mã đơn</th>
                      <th class="font-weight-bold">Ngày tạo</th>
                      <th class="font-weight-bold text-end">Tổng tiền</th>
                      <th class="font-weight-bold">Trạng thái</th>
                      <th class="font-weight-bold">Nhân viên</th>
                      <th class="font-weight-bold">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in contact.orders" :key="order.id">
                      <td>
                        <span class="font-weight-medium font-mono text-body-2 text-primary">
                          {{ order.orderCode }}
                        </span>
                      </td>
                      <td class="text-caption">{{ formatDate(order.createdAt) }}</td>
                      <td class="text-end font-weight-bold text-body-2">
                        {{ formatVND(order.totalAmount) }}
                      </td>
                      <td>
                        <v-chip size="x-small" :color="orderStatusColor(order.status)" variant="tonal" class="font-weight-medium">
                          {{ orderStatusLabel(order.status) }}
                        </v-chip>
                      </td>
                      <td class="text-body-2">{{ order.createdBy?.fullName || '—' }}</td>
                      <td class="text-caption text-grey text-truncate" style="max-width: 180px;">
                        {{ order.notes || '—' }}
                      </td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <!-- TAB 2: Appointments -->
              <div v-if="activeTab === 'appointments'">
                <div class="d-flex align-center justify-space-between mb-3">
                  <h3 class="text-subtitle-1 font-weight-bold mb-0">Danh sách lịch hẹn</h3>
                  <v-btn
                    v-if="!isAccountant"
                    size="small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-plus"
                    class="text-none font-weight-medium"
                    @click="showCreateAppointmentDialog = true"
                  >
                    Thêm lịch hẹn
                  </v-btn>
                </div>

                <div v-if="!contact.appointments || contact.appointments.length === 0" class="text-center py-10">
                  <v-icon icon="mdi-calendar-blank-outline" size="48" color="grey-lighten-1" class="mb-2" />
                  <p class="text-body-2 text-grey mb-3">Chưa có lịch hẹn nào</p>
                  <v-btn
                    v-if="!isAccountant"
                    size="small"
                    color="primary"
                    variant="flat"
                    class="text-none"
                    @click="showCreateAppointmentDialog = true"
                  >
                    Đặt lịch hẹn ngay
                  </v-btn>
                </div>

                <v-table v-else density="comfortable" hover class="rounded-lg border">
                  <thead>
                    <tr>
                      <th class="font-weight-bold">Thời gian hẹn</th>
                      <th class="font-weight-bold">Loại hẹn</th>
                      <th class="font-weight-bold">Người phụ trách</th>
                      <th class="font-weight-bold">Trạng thái</th>
                      <th class="font-weight-bold">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="app in contact.appointments" :key="app.id">
                      <td>
                        <div class="d-flex align-center">
                          <v-icon icon="mdi-clock-outline" size="14" class="mr-1 text-grey" />
                          <span class="font-weight-medium text-body-2">
                            {{ app.appointmentTime ? `${app.appointmentTime} · ` : '' }}{{ formatDate(app.appointmentDate) }}
                          </span>
                        </div>
                      </td>
                      <td>
                        <v-chip size="x-small" variant="tonal" class="font-weight-medium">
                          {{ appointmentTypeLabel(app.type) }}
                        </v-chip>
                      </td>
                      <td class="text-body-2">{{ app.assignedUser?.fullName || '—' }}</td>
                      <td>
                        <v-chip size="x-small" :color="appointmentStatusColor(app.status)" variant="tonal" class="font-weight-medium">
                          {{ appointmentStatusLabel(app.status) }}
                        </v-chip>
                      </td>
                      <td class="text-caption text-grey text-truncate" style="max-width: 200px;">
                        {{ app.notes || '—' }}
                      </td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <!-- TAB 3: Conversations -->
              <div v-if="activeTab === 'conversations'">
                <div class="d-flex align-center justify-space-between mb-3">
                  <h3 class="text-subtitle-1 font-weight-bold mb-0">Hội thoại Zalo liên kết</h3>
                  <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-message-text"
                    class="text-none font-weight-medium"
                    @click="openChat"
                  >
                    Nhắn tin trực tiếp
                  </v-btn>
                </div>

                <div v-if="!contact.conversations || contact.conversations.length === 0" class="text-center py-10">
                  <v-icon icon="mdi-message-bulleted-off" size="48" color="grey-lighten-1" class="mb-2" />
                  <p class="text-body-2 text-grey mb-3">Chưa có luồng trò chuyện nào liên kết với khách này</p>
                  <v-btn size="small" color="primary" variant="flat" class="text-none" @click="openChat">
                    Chuyển sang Chat
                  </v-btn>
                </div>

                <v-list v-else lines="two" class="pa-0">
                  <v-list-item
                    v-for="conv in contact.conversations"
                    :key="conv.id"
                    class="border rounded-lg mb-2 pa-3"
                    @click="openChatWithConv(conv.id)"
                  >
                    <template #prepend>
                      <v-avatar color="primary-lighten-4" class="text-primary mr-3">
                        <v-icon icon="mdi-chat" />
                      </v-avatar>
                    </template>
                    <v-list-item-title class="font-weight-medium text-body-1">
                      Cuộc trò chuyện {{ conv.threadType === 'group' ? 'nhóm' : 'cá nhân' }}
                      <v-badge
                        v-if="conv.unreadCount > 0"
                        :content="conv.unreadCount"
                        color="error"
                        inline
                        class="ml-2"
                      />
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-caption text-grey mt-1">
                      Tin nhắn cuối: {{ formatDate(conv.lastMessageAt) }}
                    </v-list-item-subtitle>
                    <template #append>
                      <v-btn
                        variant="tonal"
                        color="primary"
                        size="small"
                        prepend-icon="mdi-arrow-right"
                        class="text-none"
                      >
                        Mở chat
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </div>

              <!-- TAB 4: Notes & Timeline -->
              <div v-if="activeTab === 'notes'">
                <div class="mb-4">
                  <div class="d-flex align-center justify-space-between mb-2">
                    <h3 class="text-subtitle-1 font-weight-bold mb-0">Ghi chú chăm sóc</h3>
                    <v-btn
                      v-if="notesDirty"
                      size="small"
                      color="primary"
                      variant="flat"
                      :loading="savingNotes"
                      class="text-none"
                      @click="saveNotes"
                    >
                      Lưu ghi chú
                    </v-btn>
                  </div>
                  <v-textarea
                    v-model="editableNotes"
                    rows="4"
                    auto-grow
                    variant="outlined"
                    density="comfortable"
                    placeholder="Nhập ghi chú chăm sóc, yêu cầu riêng của khách hàng..."
                    class="rounded-lg"
                    :readonly="isAccountant"
                    @update:model-value="notesDirty = true"
                  />
                </div>

                <!-- Accountant transfer history if available -->
                <div v-if="contact.metadata?.history && contact.metadata.history.length > 0" class="mt-4">
                  <h4 class="text-subtitle-2 font-weight-bold mb-2">Lịch sử đối soát Kế toán</h4>
                  <v-timeline side="end" density="compact" align="start">
                    <v-timeline-item
                      v-for="(h, idx) in contact.metadata.history"
                      :key="idx"
                      dot-color="success"
                      size="x-small"
                    >
                      <div class="text-body-2 font-weight-medium">
                        Đối soát hoàn tất {{ h.customerCode ? `(${h.customerCode})` : '' }}
                      </div>
                      <div class="text-caption text-grey">
                        Chuyển bởi {{ h.transferredByName || 'Sale' }} · Hoàn tất bởi {{ h.accountantCompletedByName || 'Kế toán' }}
                      </div>
                      <div v-if="h.deliveryDate" class="text-caption text-grey">
                        Ngày giao: {{ formatDate(h.deliveryDate) }}
                      </div>
                    </v-timeline-item>
                  </v-timeline>
                </div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Right Column: Sidebar Info Cards -->
        <v-col cols="12" md="4">
          <!-- Contact Details Card -->
          <v-card variant="outlined" class="pa-4 mb-4 rounded-xl info-card">
            <h3 class="text-subtitle-1 font-weight-bold mb-3 d-flex align-center">
              <v-icon icon="mdi-card-account-phone-outline" size="20" class="mr-2 text-primary" />
              Thông tin liên hệ
            </h3>

            <!-- Phone Item -->
            <div class="d-flex align-center justify-space-between py-2 border-b">
              <div>
                <div class="text-caption text-grey">Số điện thoại</div>
                <div class="text-body-2 font-weight-medium">
                  <a v-if="contact.phone" :href="`tel:${contact.phone}`" class="text-decoration-none text-foreground">
                    {{ contact.phone }}
                  </a>
                  <span v-else class="text-grey">—</span>
                </div>
              </div>
              <div v-if="contact.phone" class="d-flex gap-1">
                <v-tooltip text="Sao chép SĐT" location="top">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" icon="mdi-content-copy" size="x-small" variant="text" @click="copyText(contact.phone)" />
                  </template>
                </v-tooltip>
                <v-tooltip text="Gọi điện" location="top">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" :href="`tel:${contact.phone}`" icon="mdi-phone" size="x-small" variant="text" color="primary" />
                  </template>
                </v-tooltip>
              </div>
            </div>

            <!-- Email Item -->
            <div class="d-flex align-center justify-space-between py-2 border-b">
              <div>
                <div class="text-caption text-grey">Email</div>
                <div class="text-body-2 font-weight-medium">
                  <a v-if="contact.email" :href="`mailto:${contact.email}`" class="text-decoration-none text-foreground">
                    {{ contact.email }}
                  </a>
                  <span v-else class="text-grey">—</span>
                </div>
              </div>
              <div v-if="contact.email" class="d-flex gap-1">
                <v-tooltip text="Sao chép Email" location="top">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" icon="mdi-content-copy" size="x-small" variant="text" @click="copyText(contact.email)" />
                  </template>
                </v-tooltip>
                <v-tooltip text="Gửi email" location="top">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" :href="`mailto:${contact.email}`" icon="mdi-email" size="x-small" variant="text" color="primary" />
                  </template>
                </v-tooltip>
              </div>
            </div>

            <!-- Zalo UID -->
            <div class="d-flex align-center justify-space-between py-2 border-b">
              <div>
                <div class="text-caption text-grey">Zalo UID</div>
                <div class="text-body-2 font-mono text-truncate" style="max-width: 190px;">
                  {{ contact.zaloUid || '—' }}
                </div>
              </div>
              <v-btn
                v-if="contact.zaloUid"
                icon="mdi-content-copy"
                size="x-small"
                variant="text"
                @click="copyText(contact.zaloUid)"
              />
            </div>

            <!-- Address (from metadata if any) -->
            <div class="py-2">
              <div class="text-caption text-grey">Địa chỉ</div>
              <div class="text-body-2 font-weight-medium">
                {{ contact.metadata?.address || 'Chưa cập nhật' }}
              </div>
            </div>
          </v-card>

          <!-- Classification & Assignment Card -->
          <v-card variant="outlined" class="pa-4 mb-4 rounded-xl info-card">
            <h3 class="text-subtitle-1 font-weight-bold mb-3 d-flex align-center">
              <v-icon icon="mdi-account-tie-outline" size="20" class="mr-2 text-primary" />
              Phân loại & Quản lý
            </h3>

            <!-- Assigned Staff (Sale) -->
            <div class="py-2 border-b">
              <div class="text-caption text-grey mb-1">Nhân viên phụ trách</div>
              <div class="d-flex align-center">
                <v-avatar size="24" color="primary" class="mr-2 text-caption font-weight-bold text-white">
                  {{ contact.assignedUser?.fullName?.charAt(0) || 'S' }}
                </v-avatar>
                <span class="text-body-2 font-weight-medium">
                  {{ contact.assignedUser?.fullName || 'Chưa phân công' }}
                </span>
              </div>
            </div>

            <!-- Source -->
            <div class="py-2 border-b">
              <div class="text-caption text-grey mb-1">Nguồn tiếp nhận</div>
              <v-chip size="small" variant="tonal" color="info" class="font-weight-medium">
                {{ sourceLabel(contact.source) }}
              </v-chip>
            </div>

            <!-- Tags -->
            <div class="py-2">
              <div class="text-caption text-grey mb-1">Thẻ phân loại (Tags)</div>
              <div v-if="contact.tags && contact.tags.length > 0" class="d-flex flex-wrap gap-1">
                <v-chip
                  v-for="tag in contact.tags"
                  :key="tag"
                  size="small"
                  variant="outlined"
                  class="font-weight-medium"
                >
                  {{ tag }}
                </v-chip>
              </div>
              <span v-else class="text-caption text-grey">Chưa gắn thẻ</span>
            </div>
          </v-card>

          <!-- Accountant Info Card (if accountant metadata exists) -->
          <v-card
            v-if="(contact.notes || '').includes('[Chuyển cho Kế toán]') || contact.metadata?.customerCode"
            variant="outlined"
            class="pa-4 rounded-xl info-card"
          >
            <h3 class="text-subtitle-1 font-weight-bold mb-3 d-flex align-center text-amber-darken-3">
              <v-icon icon="mdi-calculator" size="20" class="mr-2" />
              Theo dõi Kế toán
            </h3>

            <div class="py-2 border-b">
              <div class="text-caption text-grey mb-1">Trạng thái đối soát</div>
              <v-chip
                :color="contact.metadata?.accountantStatus === 'completed' ? 'success' : 'warning'"
                size="small"
                variant="flat"
                class="font-weight-bold"
              >
                {{ contact.metadata?.accountantStatus === 'completed' ? 'Đã đối soát' : 'Chờ đối soát' }}
              </v-chip>
            </div>

            <div v-if="contact.metadata?.deliveryDate" class="py-2 border-b">
              <div class="text-caption text-grey mb-1">Hạn giao hàng</div>
              <div class="text-body-2 font-weight-medium">
                {{ formatDate(contact.metadata.deliveryDate) }}
              </div>
            </div>

            <div v-if="contact.metadata?.transferredByName" class="py-2">
              <div class="text-caption text-grey mb-1">Người chuyển giao</div>
              <div class="text-body-2 font-weight-medium">
                {{ contact.metadata.transferredByName }}
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- Quick Create Order Dialog -->
    <v-dialog v-model="showCreateOrderDialog" max-width="500" persistent>
      <v-card class="rounded-xl pa-2">
        <v-card-title class="font-weight-bold pt-4 px-4 pb-2">
          Tạo đơn hàng mới
        </v-card-title>
        <v-card-text class="px-4 py-2">
          <v-text-field
            v-model.number="newOrderForm.totalAmount"
            label="Tổng tiền (VNĐ)"
            type="number"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            :rules="[v => !!v || 'Vui lòng nhập số tiền', v => v > 0 || 'Số tiền phải lớn hơn 0']"
          />
          <v-select
            v-model="newOrderForm.status"
            :items="ORDER_STATUS_OPTIONS"
            item-title="text"
            item-value="value"
            label="Trạng thái ban đầu"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-textarea
            v-model="newOrderForm.notes"
            label="Ghi chú đơn hàng"
            rows="3"
            variant="outlined"
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-2">
          <v-spacer />
          <v-btn variant="text" class="text-none" @click="showCreateOrderDialog = false">Huỷ</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="text-none font-weight-bold"
            :loading="creatingOrder"
            @click="submitCreateOrder"
          >
            Tạo đơn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Quick Create Appointment Dialog -->
    <v-dialog v-model="showCreateAppointmentDialog" max-width="500" persistent>
      <v-card class="rounded-xl pa-2">
        <v-card-title class="font-weight-bold pt-4 px-4 pb-2">
          Đặt lịch hẹn mới
        </v-card-title>
        <v-card-text class="px-4 py-2">
          <v-text-field
            v-model="newAppForm.appointmentDate"
            label="Ngày hẹn"
            type="date"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-text-field
            v-model="newAppForm.appointmentTime"
            label="Giờ hẹn (ví dụ: 09:30)"
            type="time"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-select
            v-model="newAppForm.type"
            :items="APPOINTMENT_TYPE_OPTIONS"
            item-title="text"
            item-value="value"
            label="Loại lịch hẹn"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-textarea
            v-model="newAppForm.notes"
            label="Nội dung / Ghi chú"
            rows="3"
            variant="outlined"
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-2">
          <v-spacer />
          <v-btn variant="text" class="text-none" @click="showCreateAppointmentDialog = false">Huỷ</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="text-none font-weight-bold"
            :loading="creatingApp"
            @click="submitCreateAppointment"
          >
            Lưu lịch hẹn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit Contact Info Dialog -->
    <ContactDetailDialog
      v-model="showEditDialog"
      :contact="contact"
      @saved="refreshContact"
      @deleted="router.push('/contacts')"
    />

    <!-- Delete Contact Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="450" persistent>
      <v-card class="rounded-xl pa-2">
        <v-card-title class="d-flex align-center text-error pt-4 px-4 pb-2">
          <v-icon icon="mdi-alert-circle-outline" class="mr-2" size="26" />
          <span class="font-weight-bold">Xác nhận xoá khách hàng</span>
        </v-card-title>
        <v-card-text class="px-4 py-2 text-body-1">
          Bạn có chắc chắn muốn xoá khách hàng <strong>{{ contact?.fullName || 'này' }}</strong> không? Thao tác này sẽ xoá toàn bộ lịch hẹn và đơn hàng của khách hàng.
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-2">
          <v-spacer />
          <v-btn variant="text" class="text-none" :disabled="deleting" @click="showDeleteDialog = false">Huỷ</v-btn>
          <v-btn
            color="error"
            variant="flat"
            class="text-none font-weight-bold"
            :loading="deleting"
            @click="executeDelete"
          >
            Xác nhận xoá
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar for notifications -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000" location="bottom right">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useContacts, SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';
import { ORDER_STATUS_OPTIONS, useOrders } from '@/composables/use-orders';
import { APPOINTMENT_TYPE_OPTIONS, APPOINTMENT_STATUS_OPTIONS, useAppointments } from '@/composables/use-appointments';
import { useAuthStore } from '@/stores/auth';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import type { Contact } from '@/composables/use-contacts';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const { fetchContact, updateContact, deleteContact, deleting } = useContacts();
const { createOrder } = useOrders();
const { createAppointment } = useAppointments();

const contact = ref<Contact | null>(null);
const loading = ref(true);
const activeTab = ref('orders');

const isAccountant = computed(() => authStore.user?.role === 'accountant');

// Dialog states
const showEditDialog = ref(false);
const showDeleteDialog = ref(false);
const showCreateOrderDialog = ref(false);
const showCreateAppointmentDialog = ref(false);
const creatingOrder = ref(false);
const creatingApp = ref(false);

// Editable notes state
const editableNotes = ref('');
const notesDirty = ref(false);
const savingNotes = ref(false);

// Forms
const newOrderForm = reactive({
  totalAmount: 0,
  status: 'new',
  notes: '',
});

const newAppForm = reactive({
  appointmentDate: new Date().toISOString().slice(0, 10),
  appointmentTime: '09:00',
  type: 'consultation',
  notes: '',
});

// Toast
const snackbar = reactive({
  show: false,
  text: '',
  color: 'success',
});

function showToast(text: string, color = 'success') {
  snackbar.text = text;
  snackbar.color = color;
  snackbar.show = true;
}

// KPI stats computations
const totalSpent = computed(() => {
  if (!contact.value?.orders) return 0;
  return contact.value.orders
    .filter((o: any) => o.status !== 'cancelled')
    .reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
});

const completedOrderCount = computed(() => {
  if (!contact.value?.orders) return 0;
  return contact.value.orders.filter((o: any) => o.status === 'completed' || o.status === 'paid').length;
});

const pendingOrderCount = computed(() => {
  if (!contact.value?.orders) return 0;
  return contact.value.orders.filter((o: any) => o.status === 'new' || o.status === 'confirmed' || o.status === 'shipped').length;
});

const nextAppointmentText = computed(() => {
  if (!contact.value?.appointments || contact.value.appointments.length === 0) return 'Chưa có lịch hẹn';
  const upcoming = contact.value.appointments.find((a: any) => a.status === 'scheduled');
  if (upcoming) {
    return `Sắp tới: ${formatDate(upcoming.appointmentDate)}`;
  }
  return 'Không có hẹn sắp tới';
});

const lastChatTimeText = computed(() => {
  if (!contact.value?.conversations || contact.value.conversations.length === 0) return 'Chưa chat';
  const latest = contact.value.conversations[0];
  if (latest?.lastMessageAt) {
    return `Gần nhất: ${formatDate(latest.lastMessageAt)}`;
  }
  return 'Đã liên kết';
});

// Helpers
function getInitials(name: string | null | undefined): string {
  if (!name) return 'KH';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('vi-VN');
}

function formatVND(val: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val || 0);
}

function sourceLabel(value: string | null | undefined) {
  if (!value) return 'Không rõ';
  return SOURCE_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function statusLabel(value: string | null | undefined) {
  if (!value) return 'Mới';
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function statusColor(status: string | null | undefined) {
  const map: Record<string, string> = {
    new: 'grey',
    contacted: 'blue',
    interested: 'orange',
    converted: 'success',
    lost: 'error',
  };
  return (status && map[status]) || 'grey';
}

function orderStatusLabel(status: string) {
  return ORDER_STATUS_OPTIONS.find(o => o.value === status)?.text ?? status;
}

function orderStatusColor(status: string) {
  return ORDER_STATUS_OPTIONS.find(o => o.value === status)?.color ?? 'grey';
}

function appointmentTypeLabel(type: string | null | undefined) {
  return APPOINTMENT_TYPE_OPTIONS.find(t => t.value === type)?.text ?? (type || 'Khác');
}

function appointmentStatusLabel(status: string) {
  return APPOINTMENT_STATUS_OPTIONS.find(s => s.value === status)?.text ?? status;
}

function appointmentStatusColor(status: string) {
  switch (status) {
    case 'scheduled': return 'blue';
    case 'completed': return 'success';
    case 'cancelled': return 'grey';
    case 'no_show': return 'error';
    default: return 'grey';
  }
}

function copyText(text: string | null | undefined) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  showToast('Đã sao chép vào bộ nhớ tạm');
}

function openChat() {
  if (contact.value?.conversations && contact.value.conversations.length > 0) {
    router.push({ path: '/chat', query: { convId: contact.value.conversations[0].id } });
  } else if (contact.value?.phone) {
    router.push({ path: '/chat', query: { search: contact.value.phone } });
  } else {
    router.push('/chat');
  }
}

function openChatWithConv(convId: string) {
  router.push({ path: '/chat', query: { convId } });
}

async function refreshContact() {
  const id = route.params.id as string;
  if (!id) return;
  const data = await fetchContact(id);
  contact.value = data;
  if (data) {
    editableNotes.value = data.notes || '';
    notesDirty.value = false;
  }
}

async function saveNotes() {
  if (!contact.value) return;
  savingNotes.value = true;
  try {
    const updated = await updateContact(contact.value.id, { notes: editableNotes.value });
    if (updated) {
      contact.value.notes = editableNotes.value;
      notesDirty.value = false;
      showToast('Đã cập nhật ghi chú thành công');
    }
  } catch (err) {
    showToast('Lỗi khi lưu ghi chú', 'error');
  } finally {
    savingNotes.value = false;
  }
}

async function submitCreateOrder() {
  if (!contact.value || !newOrderForm.totalAmount) return;
  creatingOrder.value = true;
  try {
    const created = await createOrder({
      contactId: contact.value.id,
      totalAmount: Number(newOrderForm.totalAmount),
      status: newOrderForm.status,
      notes: newOrderForm.notes || null,
    });
    if (created) {
      showCreateOrderDialog.value = false;
      newOrderForm.totalAmount = 0;
      newOrderForm.notes = '';
      showToast('Tạo đơn hàng thành công');
      await refreshContact();
    } else {
      showToast('Không thể tạo đơn hàng', 'error');
    }
  } finally {
    creatingOrder.value = false;
  }
}

async function submitCreateAppointment() {
  if (!contact.value || !newAppForm.appointmentDate) return;
  creatingApp.value = true;
  try {
    const created = await createAppointment({
      contactId: contact.value.id,
      appointmentDate: newAppForm.appointmentDate,
      appointmentTime: newAppForm.appointmentTime || undefined,
      type: newAppForm.type,
      notes: newAppForm.notes || undefined,
    });
    if (created) {
      showCreateAppointmentDialog.value = false;
      newAppForm.notes = '';
      showToast('Đặt lịch hẹn thành công');
      await refreshContact();
    } else {
      showToast('Không thể tạo lịch hẹn', 'error');
    }
  } finally {
    creatingApp.value = false;
  }
}

async function executeDelete() {
  if (!contact.value) return;
  const success = await deleteContact(contact.value.id);
  showDeleteDialog.value = false;
  if (success) {
    showToast('Đã xoá khách hàng thành công');
    router.push('/contacts');
  } else {
    showToast('Lỗi khi xoá khách hàng', 'error');
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    await refreshContact();
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.contact-detail-page {
  padding-bottom: 40px;
}

.back-link {
  transition: color 0.15s ease;
}

.back-link:hover {
  color: rgb(var(--v-theme-primary)) !important;
}

.hero-card,
.stat-card,
.info-card {
  border-color: rgba(var(--v-border-color), 0.14) !important;
  background-color: rgb(var(--v-theme-surface));
}

.hero-avatar {
  border: 2px solid rgba(var(--v-theme-primary), 0.2);
}

.stat-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.stat-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.3) !important;
}

.action-buttons-group {
  flex-shrink: 0;
}
</style>
