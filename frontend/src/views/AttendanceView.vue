<template>
  <div>
    <h1 class="text-h4 mb-4">
      <v-icon class="mr-2" color="primary">mdi-clock-check-outline</v-icon>
      Chấm công
    </h1>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="my-attendance">Lịch sử của tôi</v-tab>
      <v-tab value="my-requests">Đơn từ của tôi</v-tab>
      <v-tab value="admin-panel" v-if="authStore.isAdmin">Quản lý chấm công</v-tab>
      <v-tab value="admin-summary" v-if="authStore.isAdmin">Tổng hợp công tháng</v-tab>
      <v-tab value="admin-requests" v-if="authStore.isAdmin">Duyệt đơn từ</v-tab>
      <v-tab value="admin-logs" v-if="authStore.isAdmin">Nhật ký điều chỉnh</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- TAB 1: USER PERSONAL HISTORY -->
      <v-window-item value="my-attendance">
        <v-row>
          <!-- Today's Status Card -->
          <v-col cols="12" md="4">
            <v-card class="pa-5 mb-4 rounded-xl elevation-2" style="background: rgba(var(--v-theme-surface), 0.7) !important; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;">
              <h3 class="text-h6 mb-3">Hôm nay: {{ formatLocalDate(new Date()) }}</h3>
              
              <div v-if="todayRecord" class="d-flex flex-column gap-3">
                <div class="d-flex align-center justify-between">
                  <span class="text-grey text-body-2">Giờ Check-in:</span>
                  <span class="font-weight-bold text-success text-body-1">
                    {{ formatTime(todayRecord.checkInAt) }}
                  </span>
                </div>
                <div class="d-flex align-center justify-between">
                  <span class="text-grey text-body-2">Địa điểm Check-in:</span>
                  <v-chip :color="isOutside(todayRecord.checkInStatus) ? 'orange' : 'success'" size="small" variant="flat">
                    {{ isOutside(todayRecord.checkInStatus) ? 'Từ xa (IP ngoài)' : 'Văn phòng' }}
                  </v-chip>
                </div>
                <div class="d-flex align-center justify-between">
                  <span class="text-grey text-body-2">Trạng thái Check-in:</span>
                  <v-chip :color="getCheckInColor(todayRecord.checkInStatus)" size="small" variant="flat">
                    {{ getCheckInStatusLabel(todayRecord.checkInStatus) }}
                  </v-chip>
                </div>

                <v-divider class="my-3" />

                <div v-if="todayRecord.checkOutAt" class="d-flex flex-column gap-3">
                  <div class="d-flex align-center justify-between">
                    <span class="text-grey text-body-2">Giờ Check-out:</span>
                    <span class="font-weight-bold text-primary text-body-1">
                      {{ formatTime(todayRecord.checkOutAt) }}
                    </span>
                  </div>
                  <div class="d-flex align-center justify-between">
                    <span class="text-grey text-body-2">Trạng thái Check-out:</span>
                    <v-chip :color="getCheckOutColor(todayRecord.checkOutStatus)" size="small" variant="flat">
                      {{ getCheckOutStatusLabel(todayRecord.checkOutStatus) }}
                    </v-chip>
                  </div>
                </div>

                <div v-else class="mt-2">
                  <v-btn
                    color="error"
                    block
                    size="large"
                    prepend-icon="mdi-fingerprint"
                    class="pulse-checkout-btn"
                    :loading="saving"
                    @click="handleCheckOut"
                  >
                    CHECK-OUT (Ra về)
                  </v-btn>
                </div>
              </div>

              <div v-else class="d-flex flex-column align-center py-4">
                <v-icon size="48" color="grey">mdi-clock-alert-outline</v-icon>
                <div class="text-body-1 text-grey mt-2">Chưa Check-in hôm nay</div>
                <v-btn color="primary" class="mt-4" prepend-icon="mdi-fingerprint" :loading="saving" @click="handleCheckIn">
                  Check-in ngay
                </v-btn>
              </div>
            </v-card>
          </v-col>

          <!-- History Logs List -->
          <v-col cols="12" md="8">
            <v-card class="pa-4">
              <div class="d-flex flex-column flex-sm-row align-sm-center justify-between gap-4 mb-4">
                <h3 class="text-h6">Lịch sử chấm công tháng này</h3>
                <div class="d-flex align-center gap-2">
                  <v-text-field
                    v-model="dateRange.from"
                    label="Từ ngày"
                    type="date"
                    density="compact"
                    hide-details
                    variant="outlined"
                    style="max-width: 160px;"
                    @change="fetchMyHistory"
                  />
                  <v-text-field
                    v-model="dateRange.to"
                    label="Đến ngày"
                    type="date"
                    density="compact"
                    hide-details
                    variant="outlined"
                    style="max-width: 160px;"
                    @change="fetchMyHistory"
                  />
                </div>
              </div>

              <v-data-table
                :headers="historyHeaders"
                :items="historyRecords"
                :loading="loadingHistory"
                no-data-text="Không có dữ liệu chấm công trong khoảng thời gian này"
              >
                <template #item.date="{ item }">
                  {{ formatDate(item.date) }}
                </template>
                <template #item.checkInAt="{ item }">
                  <div class="d-flex flex-column">
                    <span class="font-weight-bold text-success">{{ formatTime(item.checkInAt) }}</span>
                    <span class="text-caption text-grey">{{ item.checkInIp || '-' }}</span>
                  </div>
                </template>
                <template #item.checkInStatus="{ item }">
                  <v-chip :color="getCheckInColor(item.checkInStatus)" size="x-small" variant="flat">
                    {{ getCheckInStatusLabel(item.checkInStatus) }}
                  </v-chip>
                </template>
                <template #item.checkOutAt="{ item }">
                  <div class="d-flex flex-column" v-if="item.checkOutAt">
                    <span class="font-weight-bold text-primary">{{ formatTime(item.checkOutAt) }}</span>
                    <span class="text-caption text-grey">{{ item.checkOutIp || '-' }}</span>
                  </div>
                  <span v-else class="text-caption text-grey">Chưa check-out</span>
                </template>
                <template #item.checkOutStatus="{ item }">
                  <v-chip v-if="item.checkOutAt" :color="getCheckOutColor(item.checkOutStatus)" size="x-small" variant="flat">
                    {{ getCheckOutStatusLabel(item.checkOutStatus) }}
                  </v-chip>
                  <span v-else>-</span>
                </template>
                <template #item.isAdjusted="{ item }">
                  <v-chip v-if="item.isAdjusted" color="orange" size="x-small" variant="outlined" :title="item.adjustmentReason">
                    Điều chỉnh
                  </v-chip>
                  <span v-else>-</span>
                </template>
              </v-data-table>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>

      <!-- TAB: EMPLOYEE REQUESTS -->
      <v-window-item value="my-requests">
        <v-card class="pa-4">
          <div class="d-flex justify-space-between align-center mb-4">
            <h3 class="text-h6">Đơn giải trình / xin nghỉ phép</h3>
            <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateRequestDialog">
              Tạo đơn mới
            </v-btn>
          </div>

          <v-data-table
            :headers="requestHeaders"
            :items="myRequests"
            :loading="loadingRequests"
            no-data-text="Bạn chưa gửi yêu cầu nào"
          >
            <template #item.date="{ item }">
              {{ formatDate(item.date) }}
            </template>
            <template #item.type="{ item }">
              <v-chip size="small" :color="getRequestTypeColor(item.type)" variant="flat">
                {{ getRequestTypeLabel(item.type) }}
              </v-chip>
            </template>
            <template #item.time="{ item }">
              {{ item.time || '-' }}
            </template>
            <template #item.status="{ item }">
              <v-chip size="small" :color="getRequestStatusColor(item.status)" variant="flat">
                {{ getRequestStatusLabel(item.status) }}
              </v-chip>
            </template>
            <template #item.createdAt="{ item }">
              {{ formatDateTime(item.createdAt) }}
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 2: ADMIN MANAGEMENT -->
      <v-window-item value="admin-panel" v-if="authStore.isAdmin">
        <v-card class="pa-4">
          <div class="d-flex flex-column flex-sm-row align-sm-center justify-between gap-4 mb-4">
            <h3 class="text-h6">Bảng chấm công nhân viên</h3>
            <div class="d-flex align-center gap-2 flex-wrap">
              <v-text-field
                v-model="adminSelectedDate"
                label="Chọn ngày xem"
                type="date"
                density="compact"
                hide-details
                variant="outlined"
                style="max-width: 180px;"
                @change="fetchAdminList"
              />
              <v-btn
                color="success"
                prepend-icon="mdi-microsoft-excel"
                @click="openExportDialog"
                class="rounded-lg font-weight-bold"
              >
                Xuất Excel
              </v-btn>
            </div>
          </div>

          <v-data-table
            :headers="adminHeaders"
            :items="adminList"
            :loading="loadingAdmin"
            no-data-text="Không có nhân viên nào"
          >
            <template #item.fullName="{ item }">
              <div 
                class="d-flex flex-column" 
                style="cursor: pointer;" 
                @click="openEmployeeHistory(item)"
                title="Xem chi tiết bảng công nhân viên"
              >
                <span class="font-weight-bold text-primary text-decoration-underline">{{ item.fullName }}</span>
                <span class="text-caption text-grey">{{ item.email }}</span>
              </div>
            </template>
            <template #item.role="{ item }">
              <v-chip size="x-small" variant="tonal" :color="item.role === 'owner' ? 'primary' : 'info'">
                {{ item.role === 'owner' ? 'Chủ sở hữu' : item.role === 'admin' ? 'Quản trị' : 'Nhân viên' }}
              </v-chip>
            </template>
            <template #item.checkIn="{ item }">
              <div v-if="item.record && item.record.checkInAt" class="d-flex flex-column">
                <span class="font-weight-bold text-success">{{ formatTime(item.record.checkInAt) }}</span>
                <span class="text-caption text-grey d-flex align-center">
                  {{ item.record.checkInIp || '-' }}
                  <v-icon v-if="item.record.checkInIp && item.officeIps.includes(item.record.checkInIp)" color="success" size="14" class="ml-1" title="IP văn phòng">mdi-check-decagram</v-icon>
                  <v-icon v-else-if="item.record.checkInIp" color="orange" size="14" class="ml-1" title="IP ngoài">mdi-alert-circle-outline</v-icon>
                </span>
              </div>
              <span v-else class="text-caption text-grey">Chưa check-in</span>
            </template>
            <template #item.checkInStatus="{ item }">
              <v-chip v-if="item.record && item.record.checkInAt" :color="getCheckInColor(item.record.checkInStatus)" size="x-small" variant="flat">
                {{ getCheckInStatusLabel(item.record.checkInStatus) }}
              </v-chip>
              <span v-else>-</span>
            </template>
            <template #item.checkOut="{ item }">
              <div v-if="item.record && item.record.checkOutAt" class="d-flex flex-column">
                <span class="font-weight-bold text-primary">{{ formatTime(item.record.checkOutAt) }}</span>
                <span class="text-caption text-grey d-flex align-center">
                  {{ item.record.checkOutIp || '-' }}
                  <v-icon v-if="item.record.checkOutIp && item.officeIps.includes(item.record.checkOutIp)" color="success" size="14" class="ml-1" title="IP văn phòng">mdi-check-decagram</v-icon>
                  <v-icon v-else-if="item.record.checkOutIp" color="orange" size="14" class="ml-1" title="IP ngoài">mdi-alert-circle-outline</v-icon>
                </span>
              </div>
              <span v-else class="text-caption text-grey">Chưa check-out</span>
            </template>
            <template #item.checkOutStatus="{ item }">
              <v-chip v-if="item.record && item.record.checkOutAt" :color="getCheckOutColor(item.record.checkOutStatus)" size="x-small" variant="flat">
                {{ getCheckOutStatusLabel(item.record.checkOutStatus) }}
              </v-chip>
              <span v-else>-</span>
            </template>
            <template #item.actions="{ item }">
              <v-btn icon size="small" variant="text" color="info" title="Xem lịch sử chấm công" @click="openEmployeeHistory(item)" class="mr-1">
                <v-icon>mdi-calendar-clock-outline</v-icon>
              </v-btn>
              <v-btn icon size="small" variant="text" title="Sửa giờ công" @click="openAdjustDialog(item)">
                <v-icon>mdi-pencil-outline</v-icon>
              </v-btn>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 2.5: ADMIN SUMMARY (Tổng hợp công tháng) -->
      <v-window-item value="admin-summary" v-if="authStore.isAdmin">
        <v-card class="pa-4">
          <div class="d-flex flex-column flex-sm-row align-sm-center justify-between gap-4 mb-4">
            <h3 class="text-h6">Tổng hợp công nhân viên</h3>
            <div class="d-flex align-center gap-2 flex-wrap">
              <v-text-field
                v-model="summaryRange.from"
                label="Từ ngày"
                type="date"
                density="compact"
                hide-details
                variant="outlined"
                style="max-width: 160px;"
                @change="fetchSummaryList"
              />
              <v-text-field
                v-model="summaryRange.to"
                label="Đến ngày"
                type="date"
                density="compact"
                hide-details
                variant="outlined"
                style="max-width: 160px;"
                @change="fetchSummaryList"
              />
              <v-btn
                color="success"
                prepend-icon="mdi-microsoft-excel"
                @click="exportSummaryExcel"
                class="rounded-lg font-weight-bold"
                :loading="loadingSummary"
              >
                Xuất File Tổng Hợp
              </v-btn>
            </div>
          </div>

          <v-data-table
            :headers="summaryHeaders"
            :items="summaryList"
            :loading="loadingSummary"
            no-data-text="Không có dữ liệu trong khoảng thời gian này"
          >
            <template #item.fullName="{ item }">
              <div 
                class="d-flex flex-column" 
                style="cursor: pointer;"
                @click="openEmployeeHistoryFromSummary(item)"
                title="Xem chi tiết bảng công nhân viên"
              >
                <span class="font-weight-bold text-primary text-decoration-underline">{{ item.fullName }}</span>
                <span class="text-caption text-grey">{{ item.email }}</span>
              </div>
            </template>
            <template #item.role="{ item }">
              <v-chip size="x-small" variant="tonal" :color="item.role === 'owner' ? 'primary' : 'info'">
                {{ item.role === 'owner' ? 'Chủ sở hữu' : item.role === 'admin' ? 'Quản trị' : 'Nhân viên' }}
              </v-chip>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB: ADMIN REQUESTS APPROVAL -->
      <v-window-item value="admin-requests" v-if="authStore.isAdmin">
        <v-card class="pa-4">
          <div class="d-flex justify-space-between align-center mb-4">
            <h3 class="text-h6">Danh sách đơn cần phê duyệt</h3>
            <v-btn icon variant="text" @click="fetchAdminRequests" title="Tải lại">
              <v-icon>mdi-refresh</v-icon>
            </v-btn>
          </div>

          <v-data-table
            :headers="adminRequestHeaders"
            :items="adminRequests"
            :loading="loadingAdminRequests"
            no-data-text="Không có yêu cầu nào cần duyệt"
          >
            <template #item.createdAt="{ item }">
              {{ formatDateTime(item.createdAt) }}
            </template>
            <template #item.employeeName="{ item }">
              <div class="d-flex flex-column">
                <span class="font-weight-bold">{{ item.user?.fullName }}</span>
                <span class="text-caption text-grey">{{ item.user?.email }}</span>
              </div>
            </template>
            <template #item.date="{ item }">
              {{ formatDate(item.date) }}
            </template>
            <template #item.type="{ item }">
              <v-chip size="small" :color="getRequestTypeColor(item.type)" variant="flat">
                {{ getRequestTypeLabel(item.type) }}
              </v-chip>
            </template>
            <template #item.time="{ item }">
              {{ item.time || '-' }}
            </template>
            <template #item.status="{ item }">
              <v-chip size="small" :color="getRequestStatusColor(item.status)" variant="flat">
                {{ getRequestStatusLabel(item.status) }}
              </v-chip>
            </template>
            <template #item.actions="{ item }">
              <div v-if="item.status === 'pending'" class="d-flex gap-2">
                <v-btn size="small" color="success" class="font-weight-bold" @click="handleProcessRequest(item.id, 'approve')" :loading="processingRequest === item.id">
                  Duyệt
                </v-btn>
                <v-btn size="small" color="error" class="font-weight-bold" @click="handleProcessRequest(item.id, 'reject')" :loading="processingRequest === item.id">
                  Từ chối
                </v-btn>
              </div>
              <span v-else>-</span>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 3: ADMIN ADJUSTMENT LOGS -->
      <v-window-item value="admin-logs" v-if="authStore.isAdmin">
        <v-card class="pa-4">
          <div class="d-flex justify-between align-center mb-4">
            <h3 class="text-h6">Lịch sử thay đổi công của Admin</h3>
            <v-btn icon variant="text" @click="fetchAdjustLogs" title="Tải lại">
              <v-icon>mdi-refresh</v-icon>
            </v-btn>
          </div>

          <v-data-table
            :headers="logHeaders"
            :items="adjustLogs"
            :loading="loadingLogs"
            no-data-text="Chưa có điều chỉnh nào được thực hiện"
          >
            <template #item.createdAt="{ item }">
              {{ formatDateTime(item.createdAt) }}
            </template>
            <template #item.adminName="{ item }">
              <div class="d-flex flex-column">
                <span class="font-weight-bold">{{ item.user?.fullName }}</span>
                <span class="text-caption text-grey">{{ item.user?.email }}</span>
              </div>
            </template>
            <template #item.employeeName="{ item }">
              <div class="d-flex flex-column">
                <span class="font-weight-bold">{{ item.details?.employeeName }}</span>
                <span class="text-caption text-grey">{{ item.details?.employeeEmail }}</span>
              </div>
            </template>
            <template #item.date="{ item }">
              {{ formatDate(item.details?.date) }}
            </template>
            <template #item.changes="{ item }">
              <div class="text-caption d-flex flex-column">
                <div>
                  Check-in: 
                  <span class="text-grey strike-through" v-if="item.details?.oldCheckInAt">
                    {{ formatDateTimeShort(item.details?.oldCheckInAt) }}
                  </span>
                  <span class="text-grey" v-else>Trống</span>
                  <v-icon size="12" class="mx-1">mdi-arrow-right</v-icon>
                  <span class="text-success font-weight-bold" v-if="item.details?.newCheckInAt">
                    {{ formatDateTimeShort(item.details?.newCheckInAt) }}
                  </span>
                  <span class="text-error font-weight-bold" v-else>Đã xóa</span>
                </div>
                <div>
                  Check-out: 
                  <span class="text-grey strike-through" v-if="item.details?.oldCheckOutAt">
                    {{ formatDateTimeShort(item.details?.oldCheckOutAt) }}
                  </span>
                  <span class="text-grey" v-else>Trống</span>
                  <v-icon size="12" class="mx-1">mdi-arrow-right</v-icon>
                  <span class="text-primary font-weight-bold" v-if="item.details?.newCheckOutAt">
                    {{ formatDateTimeShort(item.details?.newCheckOutAt) }}
                  </span>
                  <span class="text-error font-weight-bold" v-else>Đã xóa</span>
                </div>
              </div>
            </template>
            <template #item.reason="{ item }">
              <span class="italic-text text-grey-darken-1" :title="item.details?.reason">
                {{ item.details?.reason }}
              </span>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- MANUAL ADJUST DIALOG FOR ADMIN -->
    <v-dialog v-model="showAdjust" max-width="500">
      <v-card class="pa-4 rounded-xl">
        <v-card-title>
          Điều chỉnh giờ công
        </v-card-title>
        <v-card-text>
          <div class="text-subtitle-2 mb-4">
            Nhân viên: <span class="font-weight-bold">{{ selectedEmployee?.fullName }}</span><br />
            Ngày: <span class="font-weight-bold">{{ formatDate(adminSelectedDate) }}</span>
          </div>

          <v-checkbox
            v-model="enableCheckIn"
            label="Thiết lập giờ Check-in"
            hide-details
            class="mb-2"
          />
          <v-text-field
            v-if="enableCheckIn"
            v-model="adjustForm.checkInTime"
            label="Giờ Check-in"
            type="time"
            variant="outlined"
            class="mb-4"
          />

          <v-checkbox
            v-model="enableCheckOut"
            label="Thiết lập giờ Check-out"
            hide-details
            class="mb-2"
          />
          <v-text-field
            v-if="enableCheckOut"
            v-model="adjustForm.checkOutTime"
            label="Giờ Check-out"
            type="time"
            variant="outlined"
            class="mb-4"
          />

          <v-textarea
            v-model="adjustForm.reason"
            label="Lý do điều chỉnh *"
            rows="3"
            variant="outlined"
            placeholder="Nhập lý do điều chỉnh giờ công của nhân viên..."
            class="mb-2"
          />

          <v-alert v-if="adjustError" type="error" density="compact" class="mt-2">
            {{ adjustError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showAdjust = false" variant="text">Hủy</v-btn>
          <v-btn color="primary" @click="handleSaveAdjust" :loading="savingAdjust">Lưu thay đổi</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- EXPORT RANGE DIALOG FOR ADMIN -->
    <v-dialog v-model="showExport" max-width="500">
      <v-card class="pa-4 rounded-xl">
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="success">mdi-microsoft-excel</v-icon>
          Xuất file chấm công (Excel/CSV)
        </v-card-title>
        <v-card-text>
          <div class="text-body-2 text-grey mb-4">
            Chọn khoảng thời gian để xuất toàn bộ lịch sử chấm công của nhân viên trong tổ chức.
          </div>
          
          <v-row>
            <v-col cols="6">
              <v-text-field
                v-model="exportRange.from"
                label="Từ ngày"
                type="date"
                variant="outlined"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="exportRange.to"
                label="Đến ngày"
                type="date"
                variant="outlined"
              />
            </v-col>
          </v-row>

          <v-alert v-if="exportError" type="error" density="compact" class="mt-2">
            {{ exportError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showExport = false" variant="text">Hủy</v-btn>
          <v-btn color="success" @click="handleExportExcel" :loading="exporting">Tải Excel (.csv)</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- CREATE REQUEST DIALOG FOR EMPLOYEE -->
    <v-dialog v-model="showRequestDialog" max-width="500">
      <v-card class="pa-4 rounded-xl">
        <v-card-title>
          Tạo yêu cầu mới
        </v-card-title>
        <v-card-text>
          <v-select
            v-model="requestForm.type"
            label="Loại đơn *"
            :items="[
              { title: 'Quên Check-in', value: 'missing_check_in' },
              { title: 'Quên Check-out', value: 'missing_check_out' },
              { title: 'Xin nghỉ phép', value: 'leave_request' }
            ]"
            variant="outlined"
            class="mb-4"
          />

          <v-text-field
            v-model="requestForm.date"
            label="Ngày áp dụng *"
            type="date"
            variant="outlined"
            class="mb-4"
          />

          <v-text-field
            v-if="requestForm.type !== 'leave_request'"
            v-model="requestForm.time"
            label="Giờ bổ sung (HH:MM) *"
            type="time"
            variant="outlined"
            class="mb-4"
          />

          <v-textarea
            v-model="requestForm.reason"
            label="Lý do *"
            rows="3"
            variant="outlined"
            placeholder="Nhập lý do chi tiết..."
            class="mb-2"
          />

          <v-alert v-if="requestFormError" type="error" density="compact" class="mt-2">
            {{ requestFormError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showRequestDialog = false" variant="text">Hủy</v-btn>
          <v-btn color="primary" @click="handleCreateRequest" :loading="savingRequest">Gửi yêu cầu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- EMPLOYEE HISTORY DIALOG FOR ADMIN -->
    <v-dialog v-model="showEmpHistory" max-width="900">
      <v-card class="pa-4 rounded-xl">
        <v-card-title class="d-flex align-center justify-between flex-wrap gap-2">
          <span class="d-flex align-center gap-2">
            <v-icon color="info">mdi-calendar-clock-outline</v-icon>
            Lịch sử chấm công: <strong class="text-info">{{ selectedEmpForHistory?.fullName }}</strong>
          </span>
          <v-btn
            color="success"
            prepend-icon="mdi-microsoft-excel"
            size="small"
            @click="exportSingleEmployeeExcel"
            :loading="exportingSingle"
            class="rounded-lg font-weight-bold"
          >
            Xuất Excel nhân viên này
          </v-btn>
        </v-card-title>
        
        <v-card-text>
          <!-- Range selectors -->
          <div class="d-flex align-center gap-2 mb-4 justify-end">
            <v-text-field
              v-model="empHistoryRange.from"
              label="Từ ngày"
              type="date"
              density="compact"
              hide-details
              variant="outlined"
              style="max-width: 160px;"
              @change="fetchEmployeeHistory"
            />
            <v-text-field
              v-model="empHistoryRange.to"
              label="Đến ngày"
              type="date"
              density="compact"
              hide-details
              variant="outlined"
              style="max-width: 160px;"
              @change="fetchEmployeeHistory"
            />
          </div>

          <v-data-table
            :headers="historyHeaders"
            :items="empHistoryRecords"
            :loading="loadingEmpHistory"
            no-data-text="Không có dữ liệu chấm công của nhân viên này trong khoảng thời gian được chọn"
          >
            <template #item.date="{ item }">
              {{ formatDate(item.date) }}
            </template>
            <template #item.checkInAt="{ item }">
              <div class="d-flex flex-column" v-if="item.checkInAt">
                <span class="font-weight-bold text-success">{{ formatTime(item.checkInAt) }}</span>
                <span class="text-caption text-grey">{{ item.checkInIp || '-' }}</span>
              </div>
              <span v-else class="text-caption text-grey">-</span>
            </template>
            <template #item.checkInStatus="{ item }">
              <v-chip v-if="item.checkInAt" :color="getCheckInColor(item.checkInStatus)" size="x-small" variant="flat">
                {{ getCheckInStatusLabel(item.checkInStatus) }}
              </v-chip>
              <span v-else>-</span>
            </template>
            <template #item.checkOutAt="{ item }">
              <div class="d-flex flex-column" v-if="item.checkOutAt">
                <span class="font-weight-bold text-primary">{{ formatTime(item.checkOutAt) }}</span>
                <span class="text-caption text-grey">{{ item.checkOutIp || '-' }}</span>
              </div>
              <span v-else class="text-caption text-grey">Chưa check-out</span>
            </template>
            <template #item.checkOutStatus="{ item }">
              <v-chip v-if="item.checkOutAt" :color="getCheckOutColor(item.checkOutStatus)" size="x-small" variant="flat">
                {{ getCheckOutStatusLabel(item.checkOutStatus) }}
              </v-chip>
              <span v-else>-</span>
            </template>
            <template #item.isAdjusted="{ item }">
              <v-chip v-if="item.isAdjusted" color="orange" size="x-small" variant="outlined" :title="item.adjustmentReason">
                Điều chỉnh
              </v-chip>
              <span v-else>-</span>
            </template>
          </v-data-table>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showEmpHistory = false" variant="tonal">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const tab = ref('my-attendance');
const saving = ref(false);

// Today's Status State
const todayRecord = ref<any>(null);

// History State
const loadingHistory = ref(false);
const historyRecords = ref<any[]>([]);
const dateRange = ref({
  from: '',
  to: '',
});

// Admin Panel State
const loadingAdmin = ref(false);
const adminSelectedDate = ref(new Date().toISOString().split('T')[0]);
const adminList = ref<any[]>([]);

// Admin Summary State
const loadingSummary = ref(false);
const summaryRange = ref({
  from: '',
  to: '',
});
const summaryList = ref<any[]>([]);
const summaryHeaders = [
  { title: 'Nhân viên', key: 'fullName', sortable: true },
  { title: 'Vai trò', key: 'role', sortable: true },
  { title: 'Tổng ngày công', key: 'totalWorkdays', sortable: true, align: 'center' as const },
  { title: 'Đi muộn', key: 'totalLate', sortable: true, align: 'center' as const },
  { title: 'Về sớm', key: 'totalEarly', sortable: true, align: 'center' as const },
  { title: 'Quên Checkout', key: 'totalMissedCheckOut', sortable: true, align: 'center' as const },
];

// Employee Request Dialog & List State
const showRequestDialog = ref(false);
const savingRequest = ref(false);
const requestFormError = ref('');
const requestForm = ref({
  type: 'missing_check_in',
  date: '',
  time: '',
  reason: '',
});
const loadingRequests = ref(false);
const myRequests = ref<any[]>([]);

// Admin Request Approval State
const loadingAdminRequests = ref(false);
const adminRequests = ref<any[]>([]);
const processingRequest = ref<string | null>(null);

const requestHeaders = [
  { title: 'Ngày tạo', key: 'createdAt', sortable: true },
  { title: 'Ngày áp dụng', key: 'date', sortable: true },
  { title: 'Loại yêu cầu', key: 'type', sortable: false },
  { title: 'Giờ bổ sung', key: 'time', sortable: false },
  { title: 'Lý do', key: 'reason', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: true },
];

const adminRequestHeaders = [
  { title: 'Ngày tạo', key: 'createdAt', sortable: true },
  { title: 'Nhân viên', key: 'employeeName', sortable: false },
  { title: 'Ngày áp dụng', key: 'date', sortable: true },
  { title: 'Loại yêu cầu', key: 'type', sortable: false },
  { title: 'Giờ bổ sung', key: 'time', sortable: false },
  { title: 'Lý do', key: 'reason', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

// Admin Export State
const showExport = ref(false);
const exporting = ref(false);
const exportError = ref('');
const exportRange = ref({
  from: '',
  to: '',
});

// Admin View Single Employee History State
const showEmpHistory = ref(false);
const loadingEmpHistory = ref(false);
const exportingSingle = ref(false);
const selectedEmpForHistory = ref<any>(null);
const empHistoryRecords = ref<any[]>([]);
const empHistoryRange = ref({
  from: '',
  to: '',
});

// Admin Adjust Dialog State
const showAdjust = ref(false);
const savingAdjust = ref(false);
const adjustError = ref('');
const selectedEmployee = ref<any>(null);
const enableCheckIn = ref(false);
const enableCheckOut = ref(false);
const adjustForm = ref({
  checkInTime: '',
  checkOutTime: '',
  reason: '',
});

// Admin Logs State
const loadingLogs = ref(false);
const adjustLogs = ref<any[]>([]);

// Headers configurations
const historyHeaders = [
  { title: 'Ngày', key: 'date', sortable: true },
  { title: 'Giờ Check-in', key: 'checkInAt', sortable: false },
  { title: 'Trạng thái In', key: 'checkInStatus', sortable: false },
  { title: 'Giờ Check-out', key: 'checkOutAt', sortable: false },
  { title: 'Trạng thái Out', key: 'checkOutStatus', sortable: false },
  { title: 'Ghi chú', key: 'isAdjusted', sortable: false },
];

const adminHeaders = [
  { title: 'Nhân viên', key: 'fullName', sortable: true },
  { title: 'Vai trò', key: 'role', sortable: true },
  { title: 'Giờ Check-in', key: 'checkIn', sortable: false },
  { title: 'Trạng thái In', key: 'checkInStatus', sortable: false },
  { title: 'Giờ Check-out', key: 'checkOut', sortable: false },
  { title: 'Trạng thái Out', key: 'checkOutStatus', sortable: false },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

const logHeaders = [
  { title: 'Thời gian', key: 'createdAt', sortable: true },
  { title: 'Người điều chỉnh', key: 'adminName', sortable: false },
  { title: 'Nhân viên', key: 'employeeName', sortable: false },
  { title: 'Ngày công', key: 'date', sortable: false },
  { title: 'Thay đổi', key: 'changes', sortable: false },
  { title: 'Lý do', key: 'reason', sortable: false },
];

// Load date ranges default (first day of month to today)
function initDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  dateRange.value = {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${day}`,
  };

  summaryRange.value = {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${day}`,
  };
}

async function fetchTodayStatus() {
  try {
    const res = await api.get('/attendance/status');
    if (res.data && res.data.id) {
      todayRecord.value = res.data;
    } else {
      todayRecord.value = null;
    }
  } catch (err) {
    console.error('Failed to fetch today status:', err);
  }
}

async function handleCheckIn() {
  saving.value = true;
  try {
    const res = await api.post('/attendance/check-in');
    todayRecord.value = res.data;
    fetchMyHistory();
    alert('Check-in thành công!');
  } catch (err: any) {
    alert(err.response?.data?.error || 'Check-in thất bại!');
  } finally {
    saving.value = false;
  }
}

async function handleCheckOut() {
  saving.value = true;
  try {
    const res = await api.post('/attendance/check-out');
    todayRecord.value = res.data;
    fetchMyHistory();
    alert('Check-out thành công!');
  } catch (err: any) {
    alert(err.response?.data?.error || 'Check-out thất bại!');
  } finally {
    saving.value = false;
  }
}

async function fetchMyHistory() {
  loadingHistory.value = true;
  try {
    const res = await api.get('/attendance/my-history', {
      params: {
        from: dateRange.value.from,
        to: dateRange.value.to,
      },
    });
    historyRecords.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch personal history:', err);
  } finally {
    loadingHistory.value = false;
  }
}

// ── ADMIN FUNCTIONS ─────────────────────────────────────────────────────────

async function fetchAdminList() {
  if (!authStore.isAdmin) return;
  loadingAdmin.value = true;
  try {
    const res = await api.get('/attendance/admin/list', {
      params: {
        date: adminSelectedDate.value,
      },
    });
    adminList.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch admin employee list:', err);
  } finally {
    loadingAdmin.value = false;
  }
}

async function fetchAdjustLogs() {
  if (!authStore.isAdmin) return;
  loadingLogs.value = true;
  try {
    const res = await api.get('/attendance/admin/adjust-logs');
    adjustLogs.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch adjustment logs:', err);
  } finally {
    loadingLogs.value = false;
  }
}

function openExportDialog() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  // Set from the 1st of current month to today
  const dayStr = String(now.getDate()).padStart(2, '0');
  
  exportRange.value = {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${dayStr}`,
  };
  exportError.value = '';
  showExport.value = true;
}

async function handleExportExcel() {
  if (!exportRange.value.from || !exportRange.value.to) {
    exportError.value = 'Vui lòng chọn khoảng thời gian.';
    return;
  }

  exporting.value = true;
  exportError.value = '';

  try {
    const res = await api.get('/attendance/admin/range-list', {
      params: {
        from: exportRange.value.from,
        to: exportRange.value.to,
      },
    });

    const data = res.data || [];
    if (data.length === 0) {
      exportError.value = 'Không có dữ liệu chấm công trong khoảng thời gian này.';
      exporting.value = false;
      return;
    }

    // Prepare CSV data
    const headers = [
      'Ngày',
      'Họ và tên',
      'Email',
      'Vai trò',
      'Giờ Check-in',
      'IP Check-in',
      'Trạng thái Check-in',
      'Giờ Check-out',
      'IP Check-out',
      'Trạng thái Check-out',
      'Đã điều chỉnh',
      'Lý do điều chỉnh'
    ];

    const roleMap: Record<string, string> = {
      owner: 'Chủ sở hữu',
      admin: 'Quản trị viên',
      employee: 'Nhân viên',
    };

    const rows = data.map((item: any) => {
      const checkInTime = item.checkInAt ? new Date(item.checkInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const checkOutTime = item.checkOutAt ? new Date(item.checkOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      
      const checkInStatusText = getCheckInStatusLabel(item.checkInStatus);
      const checkOutStatusText = item.checkOutAt ? getCheckOutStatusLabel(item.checkOutStatus) : '';
      const roleText = roleMap[item.role] || item.role || 'Nhân viên';
      
      return [
        formatDate(item.date),
        item.fullName || '',
        item.email || '',
        roleText,
        checkInTime,
        item.checkInIp || '',
        item.checkInAt ? checkInStatusText : 'Chưa check-in',
        checkOutTime,
        item.checkOutIp || '',
        checkOutStatusText,
        item.isAdjusted ? 'Có' : 'Không',
        item.adjustmentReason || ''
      ];
    });

    const csvContent = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row: any[]) => 
        row.map(val => {
          if (val === null || val === undefined) return '""';
          const str = String(val);
          return `"${str.replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    // Excel needs UTF-8 BOM to display Vietnamese characters correctly
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const filename = `bang_cham_cong_${exportRange.value.from}_to_${exportRange.value.to}.csv`;
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    showExport.value = false;
  } catch (err: any) {
    exportError.value = err.response?.data?.error || 'Có lỗi xảy ra khi tải dữ liệu.';
  } finally {
    exporting.value = false;
  }
}

async function fetchSummaryList() {
  if (!authStore.isAdmin) return;
  loadingSummary.value = true;
  try {
    const res = await api.get('/attendance/admin/range-list', {
      params: {
        from: summaryRange.value.from,
        to: summaryRange.value.to,
      },
    });

    const data = res.data || [];
    const todayStr = new Date().toISOString().split('T')[0];

    // Group by userId
    const usersMap = new Map<string, any>();

    for (const record of data) {
      const uId = record.userId;
      if (!usersMap.has(uId)) {
        usersMap.set(uId, {
          userId: uId,
          fullName: record.fullName,
          email: record.email,
          role: record.role,
          totalWorkdays: 0,
          totalLate: 0,
          totalEarly: 0,
          totalMissedCheckOut: 0,
        });
      }

      const userStats = usersMap.get(uId);

      if (record.checkInAt) {
        userStats.totalWorkdays++;
        
        const inStatus = record.checkInStatus || '';
        if (inStatus.startsWith('late')) {
          userStats.totalLate++;
        }

        if (!record.checkOutAt) {
          // Exclude today
          const logDateStr = new Date(record.date).toISOString().split('T')[0];
          if (logDateStr !== todayStr) {
            userStats.totalMissedCheckOut++;
          }
        } else {
          const outStatus = record.checkOutStatus || '';
          if (outStatus.startsWith('early')) {
            userStats.totalEarly++;
          }
        }
      }
    }

    summaryList.value = Array.from(usersMap.values());
  } catch (err) {
    console.error('Failed to fetch attendance summary:', err);
  } finally {
    loadingSummary.value = false;
  }
}

function exportSummaryExcel() {
  const data = summaryList.value || [];
  if (data.length === 0) {
    alert('Không có dữ liệu để xuất.');
    return;
  }

  // Prepare CSV data
  const headers = [
    'Họ và tên',
    'Email',
    'Vai trò',
    'Tổng ngày công',
    'Số lần đi muộn',
    'Số lần về sớm',
    'Số lần quên Checkout'
  ];

  const roleMap: Record<string, string> = {
    owner: 'Chủ sở hữu',
    admin: 'Quản trị viên',
    employee: 'Nhân viên',
  };

  const rows = data.map((item: any) => {
    const roleText = roleMap[item.role] || item.role || 'Nhân viên';
    return [
      item.fullName || '',
      item.email || '',
      roleText,
      item.totalWorkdays,
      item.totalLate,
      item.totalEarly,
      item.totalMissedCheckOut
    ];
  });

  const csvContent = [
    headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map((row: any[]) => 
      row.map(val => {
        if (val === null || val === undefined) return '0';
        const str = String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',')
    )
  ].join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const filename = `tong_hop_cong_${summaryRange.value.from}_to_${summaryRange.value.to}.csv`;
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function openEmployeeHistoryFromSummary(item: any) {
  openEmployeeHistory({
    userId: item.userId,
    fullName: item.fullName,
    email: item.email,
  });
}

function openEmployeeHistory(item: any) {
  selectedEmpForHistory.value = item;
  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dayStr = String(now.getDate()).padStart(2, '0');
  
  empHistoryRange.value = {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${dayStr}`,
  };
  
  empHistoryRecords.value = [];
  fetchEmployeeHistory();
  showEmpHistory.value = true;
}

async function fetchEmployeeHistory() {
  if (!selectedEmpForHistory.value) return;
  loadingEmpHistory.value = true;
  try {
    const res = await api.get('/attendance/admin/employee-history', {
      params: {
        employeeId: selectedEmpForHistory.value.userId,
        from: empHistoryRange.value.from,
        to: empHistoryRange.value.to,
      },
    });
    empHistoryRecords.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch employee history:', err);
  } finally {
    loadingEmpHistory.value = false;
  }
}

async function exportSingleEmployeeExcel() {
  if (!selectedEmpForHistory.value) return;
  exportingSingle.value = true;
  try {
    const data = empHistoryRecords.value || [];
    if (data.length === 0) {
      alert('Không có dữ liệu chấm công để xuất.');
      exportingSingle.value = false;
      return;
    }

    // Prepare CSV data
    const headers = [
      'Ngày',
      'Họ và tên',
      'Email',
      'Giờ Check-in',
      'IP Check-in',
      'Trạng thái Check-in',
      'Giờ Check-out',
      'IP Check-out',
      'Trạng thái Check-out',
      'Đã điều chỉnh',
      'Lý do điều chỉnh'
    ];

    const rows = data.map((item: any) => {
      const checkInTime = item.checkInAt ? new Date(item.checkInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const checkOutTime = item.checkOutAt ? new Date(item.checkOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      
      const checkInStatusText = getCheckInStatusLabel(item.checkInStatus);
      const checkOutStatusText = item.checkOutAt ? getCheckOutStatusLabel(item.checkOutStatus) : '';
      
      return [
        formatDate(item.date),
        selectedEmpForHistory.value.fullName || '',
        selectedEmpForHistory.value.email || '',
        checkInTime,
        item.checkInIp || '',
        item.checkInAt ? checkInStatusText : 'Chưa check-in',
        checkOutTime,
        item.checkOutIp || '',
        checkOutStatusText,
        item.isAdjusted ? 'Có' : 'Không',
        item.adjustmentReason || ''
      ];
    });

    const csvContent = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row: any[]) => 
        row.map(val => {
          if (val === null || val === undefined) return '""';
          const str = String(val);
          return `"${str.replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const filename = `cham_cong_${selectedEmpForHistory.value.fullName.replace(/\s+/g, '_')}_${empHistoryRange.value.from}_to_${empHistoryRange.value.to}.csv`;
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('Export single employee failed:', err);
  } finally {
    exportingSingle.value = false;
  }
}

function openAdjustDialog(item: any) {
  selectedEmployee.value = item;
  adjustError.value = '';
  adjustForm.value = {
    checkInTime: '',
    checkOutTime: '',
    reason: '',
  };

  // Pre-fill existing records times if available
  if (item.record) {
    if (item.record.checkInAt) {
      enableCheckIn.value = true;
      const d = new Date(item.record.checkInAt);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      adjustForm.value.checkInTime = `${h}:${m}`;
    } else {
      enableCheckIn.value = false;
    }

    if (item.record.checkOutAt) {
      enableCheckOut.value = true;
      const d = new Date(item.record.checkOutAt);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      adjustForm.value.checkOutTime = `${h}:${m}`;
    } else {
      enableCheckOut.value = false;
    }
  } else {
    enableCheckIn.value = false;
    enableCheckOut.value = false;
  }

  showAdjust.value = true;
}

async function handleSaveAdjust() {
  if (!selectedEmployee.value) return;
  if (!adjustForm.value.reason.trim()) {
    adjustError.value = 'Vui lòng nhập lý do điều chỉnh.';
    return;
  }

  savingAdjust.value = true;
  adjustError.value = '';

  try {
    // Construct ISO DateTime strings using selected date and times
    let checkInAtISO: string | null = null;
    let checkOutAtISO: string | null = null;

    const baseDateStr = adminSelectedDate.value; // YYYY-MM-DD

    if (enableCheckIn.value && adjustForm.value.checkInTime) {
      checkInAtISO = new Date(`${baseDateStr}T${adjustForm.value.checkInTime}:00`).toISOString();
    }
    if (enableCheckOut.value && adjustForm.value.checkOutTime) {
      checkOutAtISO = new Date(`${baseDateStr}T${adjustForm.value.checkOutTime}:00`).toISOString();
    }

    await api.post('/attendance/admin/adjust', {
      employeeId: selectedEmployee.value.userId,
      date: baseDateStr,
      checkInAt: checkInAtISO,
      checkOutAt: checkOutAtISO,
      reason: adjustForm.value.reason.trim(),
    });

    showAdjust.value = false;
    fetchAdminList();
    fetchTodayStatus();
  } catch (err: any) {
    adjustError.value = err.response?.data?.error || 'Lỗi khi lưu điều chỉnh giờ công';
  } finally {
    savingAdjust.value = false;
  }
}

// ── REQUESTS FUNCTIONS ──────────────────────────────────────────────────────

function getRequestTypeColor(type: string) {
  if (type === 'leave_request') return 'info';
  return 'warning';
}

function getRequestTypeLabel(type: string) {
  if (type === 'missing_check_in') return 'Quên Check-in';
  if (type === 'missing_check_out') return 'Quên Check-out';
  if (type === 'leave_request') return 'Xin nghỉ phép';
  return type;
}

function getRequestStatusColor(status: string) {
  if (status === 'pending') return 'warning';
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'error';
  return 'default';
}

function getRequestStatusLabel(status: string) {
  if (status === 'pending') return 'Chờ duyệt';
  if (status === 'approved') return 'Đã duyệt';
  if (status === 'rejected') return 'Từ chối';
  return status;
}

async function fetchMyRequests() {
  loadingRequests.value = true;
  try {
    const res = await api.get('/attendance/request/my-list');
    myRequests.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch personal requests:', err);
  } finally {
    loadingRequests.value = false;
  }
}

async function fetchAdminRequests() {
  if (!authStore.isAdmin) return;
  loadingAdminRequests.value = true;
  try {
    const res = await api.get('/attendance/admin/requests');
    adminRequests.value = res.data || [];
  } catch (err) {
    console.error('Failed to fetch pending requests:', err);
  } finally {
    loadingAdminRequests.value = false;
  }
}

function openCreateRequestDialog() {
  requestFormError.value = '';
  requestForm.value = {
    type: 'missing_check_in',
    date: new Date().toISOString().split('T')[0],
    time: '',
    reason: '',
  };
  showRequestDialog.value = true;
}

async function handleCreateRequest() {
  if (!requestForm.value.type || !requestForm.value.date || !requestForm.value.reason.trim()) {
    requestFormError.value = 'Vui lòng điền đầy đủ các thông tin bắt buộc.';
    return;
  }

  if (requestForm.value.type !== 'leave_request' && !requestForm.value.time) {
    requestFormError.value = 'Giờ bổ sung là bắt buộc đối với đơn giải trình quên chấm công.';
    return;
  }

  savingRequest.value = true;
  requestFormError.value = '';
  try {
    await api.post('/attendance/request', {
      type: requestForm.value.type,
      date: requestForm.value.date,
      time: requestForm.value.type === 'leave_request' ? null : requestForm.value.time,
      reason: requestForm.value.reason.trim(),
    });
    showRequestDialog.value = false;
    fetchMyRequests();
    alert('Gửi yêu cầu thành công!');
  } catch (err: any) {
    requestFormError.value = err.response?.data?.error || 'Gửi yêu cầu thất bại!';
  } finally {
    savingRequest.value = false;
  }
}

async function handleProcessRequest(requestId: string, action: 'approve' | 'reject') {
  processingRequest.value = requestId;
  try {
    await api.post('/attendance/admin/request/action', {
      requestId,
      action,
    });
    alert(action === 'approve' ? 'Đã duyệt yêu cầu thành công!' : 'Đã từ chối yêu cầu!');
    fetchAdminRequests();
    fetchAdminList();
  } catch (err: any) {
    alert(err.response?.data?.error || 'Không thể xử lý yêu cầu!');
  } finally {
    processingRequest.value = null;
  }
}

// ── UI LABEL HELPERS ────────────────────────────────────────────────────────

function formatLocalDate(date: Date) {
  return date.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('vi-VN');
}

function formatDateTimeShort(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return time;
}

function formatTime(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function isOutside(status: string) {
  return status && status.includes('outside');
}

function getCheckInColor(status: string) {
  if (!status) return 'default';
  if (status.startsWith('on_time')) return 'success';
  if (status.startsWith('late')) return 'warning';
  return 'default';
}

function getCheckInStatusLabel(status: string) {
  if (!status) return 'Hợp lệ';
  let label = 'Đúng giờ';
  if (status.startsWith('late')) label = 'Đi muộn';
  
  if (status.includes('outside')) {
    label += ' (Ngoài VP)';
  }
  return label;
}

function getCheckOutColor(status: string) {
  if (!status) return 'default';
  if (status.startsWith('on_time')) return 'success';
  if (status.startsWith('early')) return 'warning';
  return 'default';
}

function getCheckOutStatusLabel(status: string) {
  if (!status) return 'Hợp lệ';
  let label = 'Đúng giờ';
  if (status.startsWith('early')) label = 'Về sớm';

  if (status.includes('outside')) {
    label += ' (Ngoài VP)';
  }
  return label;
}

// Watch tab to fetch logs when open
watch(tab, (newTab) => {
  if (newTab === 'admin-panel') {
    fetchAdminList();
  } else if (newTab === 'admin-summary') {
    fetchSummaryList();
  } else if (newTab === 'admin-logs') {
    fetchAdjustLogs();
  } else if (newTab === 'my-requests') {
    fetchMyRequests();
  } else if (newTab === 'admin-requests') {
    fetchAdminRequests();
  }
});

onMounted(() => {
  initDateRange();
  fetchTodayStatus();
  fetchMyHistory();
  fetchMyRequests();
});
</script>

<style scoped>
.pulse-checkout-btn {
  background: linear-gradient(135deg, #d32f2f, #ff5722) !important;
  color: white !important;
  box-shadow: 0 0 10px rgba(211, 47, 47, 0.4);
  animation: pulse-checkout 2s infinite;
}

@keyframes pulse-checkout {
  0% { transform: scale(1); box-shadow: 0 0 10px rgba(211, 47, 47, 0.4); }
  50% { transform: scale(1.02); box-shadow: 0 0 20px rgba(211, 47, 47, 0.6); }
  100% { transform: scale(1); box-shadow: 0 0 10px rgba(211, 47, 47, 0.4); }
}

.strike-through {
  text-decoration: line-through;
}

.italic-text {
  font-style: italic;
}
</style>
