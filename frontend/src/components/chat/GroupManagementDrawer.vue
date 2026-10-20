<template>
  <v-navigation-drawer
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    location="right"
    temporary
    width="420"
    class="group-management-drawer"
  >
    <div class="d-flex flex-column h-100">
      <!-- Drawer Header -->
      <div class="pa-4 border-b d-flex align-center justify-space-between bg-surface">
        <div class="d-flex align-center overflow-hidden" style="gap: 12px;">
          <v-avatar size="44" color="primary" variant="tonal" class="flex-shrink-0">
            <v-img v-if="groupInfo?.avt" :src="groupInfo.avt" cover />
            <v-icon v-else icon="mdi-account-group" size="24" />
          </v-avatar>
          <div class="overflow-hidden">
            <div class="d-flex align-center" style="gap: 6px;">
              <span class="text-subtitle-1 font-weight-bold text-truncate" :title="displayName">
                {{ displayName }}
              </span>
              <v-btn
                v-if="canEditInfo"
                icon="mdi-pencil-outline"
                size="x-small"
                variant="text"
                density="compact"
                title="Đổi tên nhóm"
                @click="openRenameDialog"
              />
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ groupInfo?.totalMember || 0 }} / {{ groupInfo?.maxMember || 1000 }} thành viên
            </div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </div>

      <!-- Navigation Tabs -->
      <v-tabs v-model="activeTab" density="compact" color="primary" class="border-b bg-surface">
        <v-tab value="members" class="text-none">
          <v-icon start size="16">mdi-account-multiple-outline</v-icon>
          Thành viên ({{ groupInfo?.totalMember || 0 }})
        </v-tab>
        <v-tab value="board" class="text-none">
          <v-icon start size="16">mdi-bulletin-board</v-icon>
          Bảng tin & Poll
        </v-tab>
        <v-tab value="pending" class="text-none">
          <v-icon start size="16">mdi-account-clock-outline</v-icon>
          Chờ duyệt
          <v-badge
            v-if="pendingUsers.length > 0"
            :content="pendingUsers.length"
            color="warning"
            inline
            class="ml-1"
          />
        </v-tab>
        <v-tab value="settings" class="text-none">
          <v-icon start size="16">mdi-cog-outline</v-icon>
          Cài đặt
        </v-tab>
      </v-tabs>

      <!-- Loading State -->
      <div v-if="loading" class="d-flex align-center justify-center flex-grow-1">
        <div class="text-center">
          <v-progress-circular indeterminate size="32" color="primary" />
          <div class="text-caption text-medium-emphasis mt-2">Đang tải thông tin nhóm...</div>
        </div>
      </div>

      <!-- Content Area -->
      <div v-else class="flex-grow-1 overflow-y-auto">
        <!-- ── TAB 1: MEMBERS ──────────────────────────────────────────────── -->
        <div v-if="activeTab === 'members'" class="pa-3">
          <!-- Top Action Bar -->
          <div class="d-flex align-center mb-3" style="gap: 8px;">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              rounded="lg"
              class="flex-grow-1"
              prepend-icon="mdi-account-plus"
              @click="showAddMemberModal = true"
            >
              Thêm thành viên
            </v-btn>
            <v-btn
              variant="outlined"
              size="small"
              rounded="lg"
              prepend-icon="mdi-link-variant"
              @click="showLinkDialog = true"
            >
              Link nhóm
            </v-btn>
          </div>

          <!-- Search member field -->
          <v-text-field
            v-model="memberSearchQuery"
            placeholder="Tìm theo tên thành viên..."
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-magnify"
            hide-details
            clearable
            class="mb-3"
          />

          <!-- Member List -->
          <div class="d-flex flex-column" style="gap: 6px;">
            <div
              v-for="member in filteredMembers"
              :key="member.id"
              class="member-row pa-2.5 rounded-lg border d-flex align-center justify-space-between"
            >
              <div class="d-flex align-center overflow-hidden" style="gap: 10px;">
                <v-avatar size="36" color="primary" variant="tonal" class="flex-shrink-0">
                  <v-img v-if="member.avatar" :src="member.avatar" cover />
                  <span v-else class="text-caption font-weight-bold">{{ (member.dName || member.zaloName || 'U')[0] }}</span>
                </v-avatar>
                <div class="overflow-hidden">
                  <div class="d-flex align-center" style="gap: 6px;">
                    <span class="text-body-2 font-weight-bold text-truncate" :title="member.dName || member.zaloName">
                      {{ member.dName || member.zaloName }}
                    </span>
                    <v-chip
                      v-if="member.id === myUid"
                      size="x-small"
                      color="primary"
                      variant="tonal"
                      class="px-1.5 font-weight-bold"
                      style="height: 18px; font-size: 0.62rem;"
                    >
                      Bạn
                    </v-chip>
                  </div>
                  <!-- Role badge -->
                  <div class="d-flex align-center mt-0.5" style="gap: 4px;">
                    <v-chip
                      v-if="member.id === groupInfo?.creatorId"
                      size="x-small"
                      color="warning"
                      variant="flat"
                      class="px-1.5 font-weight-bold text-white"
                      style="height: 18px; font-size: 0.62rem;"
                    >
                      <v-icon start size="10">mdi-crown</v-icon>
                      Trưởng nhóm
                    </v-chip>
                    <v-chip
                      v-else-if="groupInfo?.adminIds?.includes(member.id)"
                      size="x-small"
                      color="info"
                      variant="flat"
                      class="px-1.5 font-weight-bold text-white"
                      style="height: 18px; font-size: 0.62rem;"
                    >
                      <v-icon start size="10">mdi-shield-star</v-icon>
                      Phó nhóm
                    </v-chip>
                    <span v-else class="text-caption text-medium-emphasis" style="font-size: 0.7rem;">
                      Thành viên
                    </span>
                  </div>
                </div>
              </div>

              <!-- Member Action Menu (3 dots) -->
              <v-menu v-if="canManageMember(member)">
                <template #activator="{ props: menuProps }">
                  <v-btn
                    icon="mdi-dots-vertical"
                    size="x-small"
                    variant="text"
                    density="comfortable"
                    v-bind="menuProps"
                  />
                </template>
                <v-list density="compact" rounded="lg" elevation="3" class="pa-1">
                  <!-- Bổ nhiệm / Hủy phó nhóm -->
                  <template v-if="isOwner && member.id !== myUid">
                    <v-list-item
                      v-if="!groupInfo?.adminIds?.includes(member.id)"
                      prepend-icon="mdi-shield-plus-outline"
                      title="Bổ nhiệm làm phó nhóm"
                      @click="addDeputy(member)"
                    />
                    <v-list-item
                      v-else
                      prepend-icon="mdi-shield-remove-outline"
                      title="Hủy quyền phó nhóm"
                      @click="removeDeputy(member)"
                    />
                    <!-- Chuyển quyền trưởng nhóm -->
                    <v-list-item
                      prepend-icon="mdi-crown-outline"
                      title="Chuyển quyền trưởng nhóm"
                      @click="confirmTransferOwner(member)"
                    />
                  </template>

                  <!-- Xóa khỏi nhóm -->
                  <v-list-item
                    prepend-icon="mdi-account-remove-outline"
                    title="Mời ra khỏi nhóm"
                    class="text-error"
                    @click="confirmKickMember(member)"
                  />
                </v-list>
              </v-menu>
            </div>
          </div>
        </div>

        <!-- ── TAB 2: PENDING APPROVALS ────────────────────────────────────── -->
        <div v-else-if="activeTab === 'pending'" class="pa-3">
          <div v-if="pendingLoading" class="text-center py-6">
            <v-progress-circular indeterminate size="24" color="primary" />
            <div class="text-caption text-medium-emphasis mt-2">Đang kiểm tra danh sách chờ...</div>
          </div>

          <div v-else-if="pendingUsers.length === 0" class="text-center py-10 text-medium-emphasis">
            <v-icon icon="mdi-account-check-outline" size="40" class="mb-2" />
            <div class="text-body-2 font-weight-medium">Không có yêu cầu chờ duyệt</div>
            <div class="text-caption">Khi có thành viên mới xin vào nhóm, yêu cầu sẽ xuất hiện tại đây</div>
          </div>

          <div v-else class="d-flex flex-column" style="gap: 8px;">
            <div
              v-for="user in pendingUsers"
              :key="user.uid"
              class="pending-row pa-3 rounded-lg border d-flex align-center justify-space-between"
            >
              <div class="d-flex align-center overflow-hidden mr-2" style="gap: 10px;">
                <v-avatar size="38" color="primary" variant="tonal" class="flex-shrink-0">
                  <v-img v-if="user.avatar" :src="user.avatar" cover />
                  <span v-else class="font-weight-bold text-caption">{{ (user.dpn || 'U')[0] }}</span>
                </v-avatar>
                <div class="overflow-hidden">
                  <div class="text-body-2 font-weight-bold text-truncate">{{ user.dpn || 'Người dùng Zalo' }}</div>
                  <div class="text-caption text-medium-emphasis">Xin vào nhóm</div>
                </div>
              </div>

              <div class="d-flex align-center" style="gap: 6px;">
                <v-btn
                  size="small"
                  variant="outlined"
                  color="error"
                  density="comfortable"
                  @click="reviewPending(user.uid, false)"
                >
                  Từ chối
                </v-btn>
                <v-btn
                  size="small"
                  variant="flat"
                  color="primary"
                  density="comfortable"
                  @click="reviewPending(user.uid, true)"
                >
                  Duyệt
                </v-btn>
              </div>
            </div>
          </div>
        </div>

        <!-- ── TAB 3: GROUP SETTINGS ──────────────────────────────────────── -->
        <div v-else-if="activeTab === 'settings'" class="pa-3 d-flex flex-column" style="gap: 12px;">
          <div class="text-caption font-weight-bold text-medium-emphasis px-1">
            QUYỀN HẠN THÀNH VIÊN TRONG NHÓM
          </div>

          <v-card variant="outlined" rounded="lg" class="pa-3">
            <div class="setting-item d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-body-2 font-weight-bold">Chỉ Trưởng/Phó nhóm gửi tin nhắn</div>
                <div class="text-caption text-medium-emphasis">Chuyển nhóm sang chế độ thông báo (thành viên chỉ đọc)</div>
              </div>
              <v-switch
                v-model="groupSettings.lockSendMsg"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="saveSettings"
              />
            </div>

            <v-divider class="my-2" />

            <div class="setting-item d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-body-2 font-weight-bold">Duyệt thành viên mới</div>
                <div class="text-caption text-medium-emphasis">Yêu cầu Trưởng/Phó nhóm phê duyệt trước khi người mới vào nhóm</div>
              </div>
              <v-switch
                v-model="groupSettings.joinAppr"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="saveSettings"
              />
            </div>

            <v-divider class="my-2" />

            <div class="setting-item d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-body-2 font-weight-bold">Chặn đổi tên & ảnh nhóm</div>
                <div class="text-caption text-medium-emphasis">Chỉ cho phép Trưởng/Phó nhóm chỉnh sửa tên và avatar nhóm</div>
              </div>
              <v-switch
                v-model="groupSettings.blockName"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="saveSettings"
              />
            </div>

            <v-divider class="my-2" />

            <div class="setting-item d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-body-2 font-weight-bold">Chỉ Trưởng/Phó nhóm thêm người</div>
                <div class="text-caption text-medium-emphasis">Thành viên thông thường không được tự ý mời thêm người ngoài</div>
              </div>
              <v-switch
                v-model="groupSettings.addMemberOnly"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="saveSettings"
              />
            </div>

            <v-divider class="my-2" />

            <div class="setting-item d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-bold">Đọc lịch sử tin nhắn</div>
                <div class="text-caption text-medium-emphasis">Cho phép người mới xem các tin nhắn đã gửi trước đó</div>
              </div>
              <v-switch
                v-model="groupSettings.enableMsgHistory"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="saveSettings"
              />
            </div>
          </v-card>

          <!-- Danger Zone -->
          <div class="text-caption font-weight-bold text-error px-1 mt-4">
            VÙNG NGUY HIỂM
          </div>
          <v-card variant="outlined" rounded="lg" class="pa-3 border-error">
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-body-2 font-weight-bold text-error">Rời khỏi nhóm này</div>
                <div class="text-caption text-medium-emphasis">Tài khoản Zalo sẽ rời khỏi nhóm và không nhận tin nhắn nữa</div>
              </div>
              <v-btn
                color="error"
                variant="tonal"
                size="small"
                rounded="lg"
                prepend-icon="mdi-exit-to-app"
                @click="showLeaveDialog = true"
              >
                Rời nhóm
              </v-btn>
            </div>
          </v-card>
        </div>

        <!-- ── TAB 4: BOARD & POLLS ──────────────────────────────────── -->
        <div v-if="activeTab === 'board'" class="pa-3">
          <!-- Top Action Bar -->
          <div class="d-flex align-center mb-3" style="gap: 8px;">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              rounded="lg"
              class="text-none flex-grow-1"
              prepend-icon="mdi-poll"
              @click="showCreatePollModal = true"
            >
              Tạo bình chọn
            </v-btn>
            <v-btn
              variant="outlined"
              size="small"
              rounded="lg"
              class="text-none"
              prepend-icon="mdi-note-plus-outline"
              @click="openCreateNoteDialog"
            >
              Tạo ghi chú
            </v-btn>
            <v-btn
              icon="mdi-refresh"
              size="small"
              variant="text"
              :loading="boardLoading"
              title="Tải lại bảng tin"
              @click="fetchBoard"
            />
          </div>

          <!-- Filter chips -->
          <div class="d-flex align-center mb-3 overflow-x-auto pb-1" style="gap: 6px;">
            <v-chip
              v-for="filter in boardFilterList"
              :key="filter.value"
              :color="boardFilter === filter.value ? 'primary' : undefined"
              :variant="boardFilter === filter.value ? 'flat' : 'outlined'"
              size="x-small"
              class="font-weight-medium cursor-pointer"
              @click="boardFilter = filter.value"
            >
              {{ filter.label }}
            </v-chip>
          </div>

          <!-- Loading state -->
          <div v-if="boardLoading" class="py-6 text-center text-medium-emphasis">
            <v-progress-circular indeterminate size="24" color="primary" />
            <div class="text-caption mt-2">Đang tải bảng tin nhóm...</div>
          </div>

          <!-- Empty state -->
          <div v-else-if="filteredBoardItems.length === 0" class="py-8 text-center text-medium-emphasis">
            <v-icon icon="mdi-bulletin-board" size="48" color="grey" class="mb-2" />
            <div class="text-body-2 font-weight-medium">Chưa có bảng tin hoặc bình chọn nào</div>
            <div class="text-caption">Tạo bình chọn hoặc ghi chú đầu tiên cho nhóm</div>
          </div>

          <!-- Board Items List -->
          <div v-else class="d-flex flex-column" style="gap: 12px;">
            <div
              v-for="item in filteredBoardItems"
              :key="item.data?.id || item.data?.poll_id"
              class="board-card pa-3 rounded-lg border"
            >
              <!-- 1. POLL ITEM (boardType === 3) -->
              <template v-if="item.boardType === 3">
                <div class="d-flex align-start justify-space-between mb-2">
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-avatar size="28" color="primary" variant="tonal">
                      <v-icon size="16">mdi-poll</v-icon>
                    </v-avatar>
                    <div>
                      <div class="text-caption font-weight-bold text-primary">BÌNH CHỌN</div>
                      <div class="text-caption text-medium-emphasis" style="font-size: 0.7rem;">
                        {{ formatTime(item.data.created_time) }}
                      </div>
                    </div>
                  </div>
                  <v-chip
                    :color="item.data.closed ? 'default' : 'success'"
                    size="x-small"
                    variant="tonal"
                    class="font-weight-bold"
                  >
                    {{ item.data.closed ? 'Đã khóa' : 'Đang mở' }}
                  </v-chip>
                </div>

                <div class="text-body-2 font-weight-bold mb-2">
                  {{ item.data.question }}
                </div>

                <!-- Options list with progress bars -->
                <div class="d-flex flex-column mb-3" style="gap: 8px;">
                  <div
                    v-for="opt in item.data.options"
                    :key="opt.option_id"
                    class="poll-option-row pa-2 rounded-lg border cursor-pointer position-relative overflow-hidden"
                    :class="{ 'voted-option': opt.voted }"
                    @click="!item.data.closed ? submitVote(item.data.poll_id, opt.option_id) : undefined"
                  >
                    <!-- Background progress bar -->
                    <div
                      class="poll-progress-bg position-absolute top-0 bottom-0 left-0"
                      :style="{ width: calcPercent(opt.votes, item.data.num_vote) + '%' }"
                    />
                    <div class="position-relative d-flex align-center justify-space-between">
                      <div class="d-flex align-center" style="gap: 6px;">
                        <v-icon
                          v-if="opt.voted"
                          icon="mdi-check-circle"
                          size="16"
                          color="primary"
                        />
                        <v-icon
                          v-else
                          :icon="item.data.allow_multi_choices ? 'mdi-checkbox-blank-outline' : 'mdi-radiobox-blank'"
                          size="16"
                          color="grey"
                        />
                        <span class="text-caption font-weight-medium">{{ opt.content }}</span>
                      </div>
                      <div class="text-caption font-weight-bold text-medium-emphasis">
                        {{ opt.votes }} vote ({{ calcPercent(opt.votes, item.data.num_vote) }}%)
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Poll footer & actions -->
                <div class="d-flex align-center justify-space-between pt-2 border-t">
                  <div class="text-caption text-medium-emphasis">
                    Tổng: <strong>{{ item.data.num_vote }}</strong> lượt bình chọn
                  </div>
                  <div class="d-flex align-center" style="gap: 4px;">
                    <v-btn
                      v-if="item.data.allow_add_new_option && !item.data.closed"
                      size="x-small"
                      variant="text"
                      color="primary"
                      prepend-icon="mdi-plus"
                      @click="openAddOptionDialog(item.data)"
                    >
                      Thêm PA
                    </v-btn>
                    <v-btn
                      v-if="!item.data.closed && (isOwner || isDeputy)"
                      size="x-small"
                      variant="text"
                      color="error"
                      prepend-icon="mdi-lock"
                      @click="lockPollAction(item.data.poll_id)"
                    >
                      Khóa poll
                    </v-btn>
                  </div>
                </div>
              </template>

              <!-- 2. NOTE ITEM (boardType === 1) -->
              <template v-else-if="item.boardType === 1">
                <div class="d-flex align-start justify-space-between mb-2">
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-avatar size="28" color="warning" variant="tonal">
                      <v-icon size="16">mdi-note-text-outline</v-icon>
                    </v-avatar>
                    <div>
                      <div class="text-caption font-weight-bold text-warning">GHI CHÚ</div>
                      <div class="text-caption text-medium-emphasis" style="font-size: 0.7rem;">
                        {{ formatTime(item.data.createTime || item.data.startTime) }}
                      </div>
                    </div>
                  </div>
                  <v-chip
                    v-if="item.data.type === 1 || item.data.repeat !== undefined"
                    color="warning"
                    size="x-small"
                    variant="tonal"
                    prepend-icon="mdi-pin"
                  >
                    Đã ghim
                  </v-chip>
                </div>

                <div class="text-body-2 mb-2 font-weight-medium" style="white-space: pre-wrap;">
                  {{ item.data.params?.title || item.data.title || 'Nội dung ghi chú' }}
                </div>

                <div class="d-flex justify-end pt-2 border-t">
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="primary"
                    prepend-icon="mdi-pencil-outline"
                    @click="openEditNoteDialog(item.data)"
                  >
                    Chỉnh sửa
                  </v-btn>
                </div>
              </template>

              <!-- 3. PINNED MESSAGE (boardType === 2) -->
              <template v-else>
                <div class="d-flex align-start justify-space-between mb-2">
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-avatar size="28" color="info" variant="tonal">
                      <v-icon size="16">mdi-pin</v-icon>
                    </v-avatar>
                    <div>
                      <div class="text-caption font-weight-bold text-info">TIN NHẮN ĐƯỢC GHIM</div>
                      <div class="text-caption text-medium-emphasis" style="font-size: 0.7rem;">
                        {{ formatTime(item.data.createTime || item.data.startTime) }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="text-body-2 mb-1">
                  {{ item.data.params?.senderName ? `${item.data.params.senderName}: ` : '' }}
                  {{ item.data.params?.title || 'Tin nhắn đã ghim trên đầu nhóm' }}
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── MODAL 1: Rename Dialog ─────────────────────────────────────────── -->
    <v-dialog v-model="showRenameDialog" max-width="440">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold">
          Đổi tên nhóm chat
        </v-card-title>
        <v-card-text class="pa-4">
          <v-text-field
            v-model="newGroupName"
            label="Tên nhóm mới *"
            variant="outlined"
            density="compact"
            autofocus
            hide-details
          />
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="showRenameDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="renaming"
            :disabled="!newGroupName.trim()"
            @click="submitRename"
          >
            Lưu thay đổi
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 2: Invite Link Dialog ────────────────────────────────────── -->
    <v-dialog v-model="showLinkDialog" max-width="460">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b d-flex align-center justify-space-between">
          <span class="text-subtitle-1 font-weight-bold">Link tham gia nhóm</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showLinkDialog = false" />
        </v-card-title>
        <v-card-text class="pa-4">
          <div class="d-flex align-center justify-space-between mb-3">
            <div>
              <div class="text-body-2 font-weight-bold">Bật liên kết tham gia</div>
              <div class="text-caption text-medium-emphasis">Bất kỳ ai có liên kết này đều có thể xin vào nhóm</div>
            </div>
            <v-switch
              v-model="linkEnabled"
              color="primary"
              hide-details
              density="compact"
              @update:model-value="toggleLink"
            />
          </div>

          <div v-if="linkEnabled && linkDetail?.link" class="pa-3 rounded-lg border bg-surface-variant-opacity">
            <div class="text-caption font-weight-bold text-medium-emphasis mb-1">Đường dẫn tham gia:</div>
            <div class="d-flex align-center" style="gap: 8px;">
              <span class="text-caption font-mono text-truncate flex-grow-1 font-weight-bold text-primary">
                {{ linkDetail.link }}
              </span>
              <v-btn
                icon="mdi-content-copy"
                size="small"
                variant="text"
                color="primary"
                title="Sao chép liên kết"
                @click="copyLink(linkDetail.link)"
              />
            </div>
          </div>
          <div v-else-if="!linkEnabled" class="text-caption text-medium-emphasis mt-2">
            Liên kết tham gia nhóm hiện đang tắt. Bật công tắc phía trên để tạo link.
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 3: Add Member Modal ──────────────────────────────────────── -->
    <AddGroupMemberModal
      v-model="showAddMemberModal"
      :conversation-id="conversation.id"
      :existing-member-ids="groupInfo?.memberIds || []"
      @added="onMemberAdded"
    />

    <!-- ── MODAL 4: Confirm Action Dialog ─────────────────────────────────── -->
    <v-dialog v-model="confirmDialog.show" max-width="400">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold d-flex align-center" style="gap: 8px;">
          <v-icon :color="confirmDialog.isDanger ? 'error' : 'warning'" size="22">
            {{ confirmDialog.isDanger ? 'mdi-alert-circle' : 'mdi-help-circle' }}
          </v-icon>
          <span>{{ confirmDialog.title }}</span>
        </v-card-title>
        <v-card-text class="pa-4 text-body-2">
          {{ confirmDialog.message }}
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="confirmDialog.show = false">Hủy</v-btn>
          <v-btn
            :color="confirmDialog.isDanger ? 'error' : 'primary'"
            variant="flat"
            rounded="lg"
            :loading="confirmDialog.loading"
            @click="executeConfirmedAction"
          >
            Xác nhận
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 5: Leave Group Dialog ────────────────────────────────────── -->
    <v-dialog v-model="showLeaveDialog" max-width="400">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold text-error d-flex align-center" style="gap: 8px;">
          <v-icon color="error" size="22">mdi-exit-to-app</v-icon>
          <span>Xác nhận rời khỏi nhóm?</span>
        </v-card-title>
        <v-card-text class="pa-4 text-body-2">
          Bạn có chắc chắn muốn rời nhóm <strong>{{ displayName }}</strong>? Sau khi rời, bạn sẽ không thể nhận hay gửi tin nhắn trong nhóm này nữa.
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="showLeaveDialog = false">Hủy</v-btn>
          <v-btn
            color="error"
            variant="flat"
            rounded="lg"
            :loading="leaving"
            @click="submitLeaveGroup"
          >
            Rời nhóm ngay
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 6: Create Poll Modal ────────────────────────────────────── -->
    <CreatePollModal
      v-model="showCreatePollModal"
      :conversation-id="conversation.id"
      @created="onPollCreated"
    />

    <!-- ── MODAL 7: Create Note Dialog ───────────────────────────────────── -->
    <v-dialog v-model="showCreateNoteDialog" max-width="440">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold d-flex align-center" style="gap: 8px;">
          <v-icon color="warning" size="20">mdi-note-plus-outline</v-icon>
          <span>Tạo ghi chú nhóm Zalo</span>
        </v-card-title>
        <v-card-text class="pa-4 d-flex flex-column" style="gap: 12px;">
          <v-textarea
            v-model="noteForm.title"
            label="Nội dung ghi chú *"
            placeholder="Nhập nội quy, thông báo hoặc ghi chú quan trọng..."
            variant="outlined"
            density="compact"
            rows="3"
            auto-grow
            hide-details
          />
          <div class="d-flex align-center justify-space-between">
            <span class="text-body-2">Ghim lên đầu nhóm chat</span>
            <v-switch v-model="noteForm.pinAct" color="primary" hide-details density="compact" />
          </div>
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="showCreateNoteDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="noteSubmitting"
            :disabled="!noteForm.title.trim()"
            @click="submitCreateNote"
          >
            Lưu ghi chú
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 8: Edit Note Dialog ─────────────────────────────────────── -->
    <v-dialog v-model="showEditNoteDialog" max-width="440">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold d-flex align-center" style="gap: 8px;">
          <v-icon color="primary" size="20">mdi-pencil-outline</v-icon>
          <span>Chỉnh sửa ghi chú</span>
        </v-card-title>
        <v-card-text class="pa-4 d-flex flex-column" style="gap: 12px;">
          <v-textarea
            v-model="editNoteForm.title"
            label="Nội dung ghi chú *"
            variant="outlined"
            density="compact"
            rows="3"
            auto-grow
            hide-details
          />
          <div class="d-flex align-center justify-space-between">
            <span class="text-body-2">Ghim lên đầu nhóm chat</span>
            <v-switch v-model="editNoteForm.pinAct" color="primary" hide-details density="compact" />
          </div>
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="showEditNoteDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="noteSubmitting"
            :disabled="!editNoteForm.title.trim()"
            @click="submitEditNote"
          >
            Cập nhật
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── MODAL 9: Add Poll Option Dialog ───────────────────────────────── -->
    <v-dialog v-model="showAddOptionDialog" max-width="400">
      <v-card rounded="xl" class="pa-0">
        <v-card-title class="pa-4 border-b text-subtitle-1 font-weight-bold d-flex align-center" style="gap: 8px;">
          <v-icon color="primary" size="20">mdi-plus-circle-outline</v-icon>
          <span>Thêm phương án bình chọn</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <div class="text-caption text-medium-emphasis mb-2">
            Câu hỏi: <strong>{{ targetPollForOption?.question }}</strong>
          </div>
          <v-text-field
            v-model="newOptionContent"
            label="Nội dung phương án *"
            placeholder="Nhập phương án mới..."
            variant="outlined"
            density="compact"
            autofocus
            hide-details
          />
        </v-card-text>
        <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="outlined" rounded="lg" @click="showAddOptionDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="optionSubmitting"
            :disabled="!newOptionContent.trim()"
            @click="submitAddOption"
          >
            Thêm ngay
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">
      {{ snack.text }}
    </v-snackbar>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api';
import type { Conversation } from '@/composables/use-chat';
import AddGroupMemberModal from './AddGroupMemberModal.vue';
import CreatePollModal from './CreatePollModal.vue';

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'updated'): void;
}>();

const activeTab = ref<'members' | 'board' | 'pending' | 'settings'>('members');
const loading = ref(false);
const pendingLoading = ref(false);
const boardLoading = ref(false);
const renaming = ref(false);
const leaving = ref(false);
const noteSubmitting = ref(false);
const optionSubmitting = ref(false);

const groupInfo = ref<any>(null);
const linkDetail = ref<any>(null);
const myUid = ref('');
const memberSearchQuery = ref('');

// Board & Polls state
const boardItems = ref<any[]>([]);
const boardFilter = ref<'all' | 'poll' | 'note' | 'pinned'>('all');
const showCreatePollModal = ref(false);
const showCreateNoteDialog = ref(false);
const showEditNoteDialog = ref(false);
const noteForm = ref({ title: '', pinAct: true });
const editNoteForm = ref({ title: '', pinAct: true, topicId: '' });
const showAddOptionDialog = ref(false);
const targetPollForOption = ref<any>(null);
const newOptionContent = ref('');

const boardFilterList = [
  { label: 'Tất cả', value: 'all' as const },
  { label: 'Bình chọn', value: 'poll' as const },
  { label: 'Ghi chú', value: 'note' as const },
  { label: 'Tin ghim', value: 'pinned' as const },
];

const showRenameDialog = ref(false);
const newGroupName = ref('');
const showLinkDialog = ref(false);
const showAddMemberModal = ref(false);
const showLeaveDialog = ref(false);

const pendingUsers = ref<any[]>([]);

const snack = ref({ show: false, text: '', color: 'success' });

const groupSettings = ref({
  lockSendMsg: false,
  joinAppr: false,
  blockName: false,
  addMemberOnly: false,
  enableMsgHistory: false,
});

const confirmDialog = ref({
  show: false,
  title: '',
  message: '',
  isDanger: false,
  loading: false,
  action: () => Promise.resolve(),
});

const displayName = computed(() => {
  return groupInfo.value?.name || props.conversation.contact?.fullName || 'Nhóm chat';
});

const isOwner = computed(() => {
  return myUid.value && groupInfo.value?.creatorId === myUid.value;
});

const isDeputy = computed(() => {
  return myUid.value && groupInfo.value?.adminIds?.includes(myUid.value);
});

const canEditInfo = computed(() => {
  if (isOwner.value || isDeputy.value) return true;
  return !groupSettings.value.blockName;
});

const linkEnabled = computed({
  get: () => linkDetail.value?.enabled === 1,
  set: () => {},
});

const filteredMembers = computed(() => {
  const list = groupInfo.value?.currentMems || [];
  const q = memberSearchQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((m: any) => {
    const name = (m.dName || m.zaloName || '').toLowerCase();
    return name.includes(q);
  });
});

function canManageMember(member: any): boolean {
  if (member.id === myUid.value) return false;
  if (isOwner.value) return true;
  if (isDeputy.value) {
    // Deputy cannot manage owner or other deputies
    const targetIsAdmin = groupInfo.value?.adminIds?.includes(member.id);
    const targetIsOwner = groupInfo.value?.creatorId === member.id;
    return !targetIsAdmin && !targetIsOwner;
  }
  return false;
}

async function fetchGroupInfo() {
  loading.value = true;
  try {
    const res = await api.get(`/conversations/${props.conversation.id}/group/info`);
    groupInfo.value = res.data?.groupInfo;
    linkDetail.value = res.data?.linkDetail;
    myUid.value = res.data?.myUid || '';

    // Map settings
    const s = groupInfo.value?.setting || {};
    groupSettings.value = {
      lockSendMsg: s.lockSendMsg === 1,
      joinAppr: s.joinAppr === 1,
      blockName: s.blockName === 1,
      addMemberOnly: s.addMemberOnly === 1,
      enableMsgHistory: s.enableMsgHistory === 1,
    };
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Lỗi khi tải thông tin nhóm', color: 'error' };
  } finally {
    loading.value = false;
  }
}

async function fetchPendingMembers() {
  pendingLoading.value = true;
  try {
    const res = await api.get(`/conversations/${props.conversation.id}/group/pending-members`);
    pendingUsers.value = res.data?.users || [];
  } catch (err) {
    pendingUsers.value = [];
  } finally {
    pendingLoading.value = false;
  }
}

function openRenameDialog() {
  newGroupName.value = displayName.value;
  showRenameDialog.value = true;
}

async function submitRename() {
  if (!newGroupName.value.trim()) return;
  renaming.value = true;
  try {
    await api.post(`/conversations/${props.conversation.id}/group/name`, {
      name: newGroupName.value.trim(),
    });
    if (groupInfo.value) {
      groupInfo.value.name = newGroupName.value.trim();
    }
    showRenameDialog.value = false;
    snack.value = { show: true, text: 'Đã đổi tên nhóm thành công!', color: 'success' };
    emit('updated');
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Đổi tên nhóm thất bại', color: 'error' };
  } finally {
    renaming.value = false;
  }
}

async function toggleLink(newVal: boolean | null) {
  try {
    const enable = Boolean(newVal);
    const res = await api.post(`/conversations/${props.conversation.id}/group/link/toggle`, {
      enable,
    });
    linkDetail.value = res.data?.linkDetail;
    snack.value = { show: true, text: enable ? 'Đã bật link tham gia nhóm' : 'Đã tắt link tham gia nhóm', color: 'success' };
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Thao tác link nhóm thất bại', color: 'error' };
  }
}

function copyLink(url: string) {
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    snack.value = { show: true, text: 'Đã sao chép liên kết vào bộ nhớ tạm!', color: 'success' };
  });
}

function onMemberAdded() {
  snack.value = { show: true, text: 'Đã thêm thành viên vào nhóm thành công!', color: 'success' };
  fetchGroupInfo();
}

async function addDeputy(member: any) {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/deputy/add`, {
      memberId: member.id,
    });
    snack.value = { show: true, text: `Đã bổ nhiệm ${member.dName || member.zaloName} làm Phó nhóm`, color: 'success' };
    fetchGroupInfo();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Bổ nhiệm thất bại', color: 'error' };
  }
}

async function removeDeputy(member: any) {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/deputy/remove`, {
      memberId: member.id,
    });
    snack.value = { show: true, text: `Đã hủy quyền Phó nhóm của ${member.dName || member.zaloName}`, color: 'success' };
    fetchGroupInfo();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Hủy quyền phó nhóm thất bại', color: 'error' };
  }
}

function confirmTransferOwner(member: any) {
  confirmDialog.value = {
    show: true,
    title: 'Chuyển quyền Trưởng nhóm',
    message: `Bạn có chắc chắn muốn chuyển quyền Trưởng nhóm cho "${member.dName || member.zaloName}"? Sau khi chuyển, bạn sẽ trở thành thành viên thường.`,
    isDanger: true,
    loading: false,
    action: async () => {
      await api.post(`/conversations/${props.conversation.id}/group/owner`, {
        memberId: member.id,
      });
      snack.value = { show: true, text: 'Đã chuyển quyền Trưởng nhóm thành công', color: 'success' };
      fetchGroupInfo();
    },
  };
}

function confirmKickMember(member: any) {
  confirmDialog.value = {
    show: true,
    title: 'Mời ra khỏi nhóm',
    message: `Bạn có chắc muốn xóa "${member.dName || member.zaloName}" khỏi nhóm chat này?`,
    isDanger: true,
    loading: false,
    action: async () => {
      await api.post(`/conversations/${props.conversation.id}/group/members/remove`, {
        memberId: member.id,
      });
      snack.value = { show: true, text: 'Đã mời thành viên rời nhóm', color: 'success' };
      fetchGroupInfo();
    },
  };
}

async function executeConfirmedAction() {
  confirmDialog.value.loading = true;
  try {
    await confirmDialog.value.action();
    confirmDialog.value.show = false;
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Thao tác thất bại', color: 'error' };
  } finally {
    confirmDialog.value.loading = false;
  }
}

async function reviewPending(uid: string, isApprove: boolean) {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/pending-members/review`, {
      memberIds: [uid],
      isApprove,
    });
    snack.value = { show: true, text: isApprove ? 'Đã duyệt thành viên vào nhóm' : 'Đã từ chối yêu cầu', color: 'success' };
    fetchPendingMembers();
    if (isApprove) fetchGroupInfo();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Xử lý duyệt thất bại', color: 'error' };
  }
}

async function saveSettings() {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/settings`, {
      settings: {
        lockSendMsg: groupSettings.value.lockSendMsg,
        joinAppr: groupSettings.value.joinAppr,
        blockName: groupSettings.value.blockName,
        addMemberOnly: groupSettings.value.addMemberOnly,
        enableMsgHistory: groupSettings.value.enableMsgHistory,
      },
    });
    snack.value = { show: true, text: 'Đã lưu cài đặt nhóm!', color: 'success' };
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Lưu cài đặt thất bại', color: 'error' };
  }
}

async function submitLeaveGroup() {
  leaving.value = true;
  try {
    await api.post(`/conversations/${props.conversation.id}/group/leave`);
    showLeaveDialog.value = false;
    emit('update:modelValue', false);
    emit('updated');
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Rời nhóm thất bại', color: 'error' };
  } finally {
    leaving.value = false;
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val && props.conversation?.id) {
      fetchGroupInfo();
      fetchPendingMembers();
      fetchBoard();
    }
  }
);

watch(activeTab, (tab) => {
  if (tab === 'pending') {
    fetchPendingMembers();
  } else if (tab === 'board') {
    fetchBoard();
  }
});

// ── BOARD & POLL METHODS ──────────────────────────────────────────────────
const filteredBoardItems = computed(() => {
  if (boardFilter.value === 'all') return boardItems.value;
  if (boardFilter.value === 'poll') return boardItems.value.filter(i => i.boardType === 3);
  if (boardFilter.value === 'note') return boardItems.value.filter(i => i.boardType === 1);
  if (boardFilter.value === 'pinned') return boardItems.value.filter(i => i.boardType === 2);
  return boardItems.value;
});

async function fetchBoard() {
  boardLoading.value = true;
  try {
    const res = await api.get(`/conversations/${props.conversation.id}/group/board`, {
      params: { count: 30 },
    });
    boardItems.value = res.data?.board?.items || [];
  } catch (err: any) {
    snack.value = { show: true, text: 'Không thể tải bảng tin nhóm', color: 'error' };
  } finally {
    boardLoading.value = false;
  }
}

function onPollCreated() {
  snack.value = { show: true, text: 'Đã tạo cuộc bình chọn thành công!', color: 'success' };
  fetchBoard();
}

function openCreateNoteDialog() {
  noteForm.value = { title: '', pinAct: true };
  showCreateNoteDialog.value = true;
}

async function submitCreateNote() {
  if (!noteForm.value.title.trim()) return;
  noteSubmitting.value = true;
  try {
    await api.post(`/conversations/${props.conversation.id}/group/notes`, {
      title: noteForm.value.title.trim(),
      pinAct: noteForm.value.pinAct,
    });
    showCreateNoteDialog.value = false;
    snack.value = { show: true, text: 'Đã tạo ghi chú nhóm thành công!', color: 'success' };
    fetchBoard();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Tạo ghi chú thất bại', color: 'error' };
  } finally {
    noteSubmitting.value = false;
  }
}

function openEditNoteDialog(note: any) {
  editNoteForm.value = {
    title: note.params?.title || note.title || '',
    pinAct: note.type === 1 || note.repeat !== undefined,
    topicId: note.id,
  };
  showEditNoteDialog.value = true;
}

async function submitEditNote() {
  if (!editNoteForm.value.title.trim() || !editNoteForm.value.topicId) return;
  noteSubmitting.value = true;
  try {
    await api.put(`/conversations/${props.conversation.id}/group/notes/${editNoteForm.value.topicId}`, {
      title: editNoteForm.value.title.trim(),
      pinAct: editNoteForm.value.pinAct,
    });
    showEditNoteDialog.value = false;
    snack.value = { show: true, text: 'Đã cập nhật ghi chú thành công!', color: 'success' };
    fetchBoard();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Cập nhật ghi chú thất bại', color: 'error' };
  } finally {
    noteSubmitting.value = false;
  }
}

async function submitVote(pollId: number, optionId: number) {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/polls/${pollId}/vote`, {
      optionId,
    });
    snack.value = { show: true, text: 'Đã bình chọn thành công!', color: 'success' };
    fetchBoard();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Bình chọn thất bại', color: 'error' };
  }
}

async function lockPollAction(pollId: number) {
  try {
    await api.post(`/conversations/${props.conversation.id}/group/polls/${pollId}/lock`);
    snack.value = { show: true, text: 'Đã khóa bình chọn', color: 'success' };
    fetchBoard();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Khóa bình chọn thất bại', color: 'error' };
  }
}

function openAddOptionDialog(poll: any) {
  targetPollForOption.value = poll;
  newOptionContent.value = '';
  showAddOptionDialog.value = true;
}

async function submitAddOption() {
  if (!targetPollForOption.value || !newOptionContent.value.trim()) return;
  optionSubmitting.value = true;
  try {
    await api.post(`/conversations/${props.conversation.id}/group/polls/${targetPollForOption.value.poll_id}/options`, {
      options: [{ voted: true, content: newOptionContent.value.trim() }],
    });
    showAddOptionDialog.value = false;
    snack.value = { show: true, text: 'Đã thêm phương án mới!', color: 'success' };
    fetchBoard();
  } catch (err: any) {
    snack.value = { show: true, text: err.response?.data?.error || 'Thêm phương án thất bại', color: 'error' };
  } finally {
    optionSubmitting.value = false;
  }
}

function calcPercent(votes: number, total: number): number {
  if (!total || total === 0) return 0;
  return Math.round((votes / total) * 100);
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.group-management-drawer {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.member-row, .pending-row, .board-card {
  background: rgba(var(--v-theme-surface-variant), 0.2);
  border-color: rgba(var(--v-border-color), 0.12) !important;
}

.poll-option-row {
  background: rgba(var(--v-theme-surface), 0.7);
  transition: all 0.2s ease;
}

.poll-option-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.5) !important;
}

.poll-progress-bg {
  background: rgba(var(--v-theme-primary), 0.15);
  transition: width 0.3s ease;
}

.voted-option {
  border-color: rgb(var(--v-theme-primary)) !important;
}

.bg-surface-variant-opacity {
  background: rgba(var(--v-theme-surface-variant), 0.25);
}
</style>
