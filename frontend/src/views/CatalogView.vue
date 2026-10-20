<template>
  <div class="catalog-view pa-4 pa-md-6">
    <!-- Header Page -->
    <div class="d-flex flex-wrap align-center justify-space-between mb-6" style="gap: 16px;">
      <div>
        <div class="d-flex align-center" style="gap: 10px;">
          <v-icon color="primary" size="28">mdi-book-open-page-variant-outline</v-icon>
          <h1 class="text-h5 font-weight-bold mb-0">Catalog - Danh mục sản phẩm Zalo</h1>
        </div>
        <p class="text-body-2 text-medium-emphasis mt-1 mb-0">
          Quản lý danh mục và sản phẩm Zalo Shop cá nhân đồng bộ trực tiếp với tài khoản Zalo.
        </p>
      </div>

      <!-- Zalo Account Selector & Action Buttons -->
      <div class="d-flex align-center flex-wrap" style="gap: 12px;">
        <v-select
          v-model="selectedAccountId"
          :items="accounts"
          item-title="displayName"
          item-value="id"
          label="Tài khoản Zalo"
          density="compact"
          variant="outlined"
          hide-details
          style="min-width: 220px;"
          prepend-inner-icon="mdi-account-circle-outline"
          @update:model-value="onAccountChanged"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template #prepend>
                <v-avatar size="24" color="primary" class="mr-2">
                  <v-img v-if="item.raw.avatarUrl" :src="item.raw.avatarUrl" />
                  <span v-else class="text-caption text-white font-weight-bold">{{ (item.raw.displayName || 'Z')[0] }}</span>
                </v-avatar>
              </template>
              <template #append>
                <v-chip
                  size="x-small"
                  :color="(item.raw.liveStatus || item.raw.status) === 'connected' ? 'success' : 'grey'"
                  variant="flat"
                  class="ml-1"
                >
                  {{ (item.raw.liveStatus || item.raw.status) === 'connected' ? 'Online' : 'Offline' }}
                </v-chip>
              </template>
            </v-list-item>
          </template>
        </v-select>

        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-folder-plus-outline"
          rounded="lg"
          :disabled="!selectedAccountId"
          @click="openCreateCatalogDialog"
        >
          Tạo danh mục
        </v-btn>
      </div>
    </div>

    <!-- Main Content Grid -->
    <v-row v-if="selectedAccountId">
      <!-- Cột bên trái: Danh sách Danh mục (Catalogs) -->
      <v-col cols="12" md="4" lg="3">
        <v-card rounded="xl" elevation="1" class="border">
          <div class="pa-4 border-b d-flex align-center justify-space-between bg-surface-variant">
            <span class="text-subtitle-2 font-weight-bold text-uppercase">Danh mục sản phẩm</span>
            <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold">
              {{ catalogs.length }}
            </v-chip>
          </div>

          <v-progress-linear v-if="loadingCatalogs" indeterminate color="primary" />

          <v-list v-if="catalogs.length > 0" density="comfortable" class="pa-2">
            <v-list-item
              v-for="cat in catalogs"
              :key="cat.catalogId || cat.id"
              :active="selectedCatalog?.catalogId === (cat.catalogId || cat.id)"
              rounded="lg"
              class="mb-1 cursor-pointer"
              @click="selectCatalog(cat)"
            >
              <template #prepend>
                <v-icon :color="selectedCatalog?.catalogId === (cat.catalogId || cat.id) ? 'primary' : undefined">
                  mdi-folder-outline
                </v-icon>
              </template>
              <v-list-item-title class="font-weight-medium">
                {{ cat.catalogName || cat.name || 'Danh mục chưa đặt tên' }}
              </v-list-item-title>
              <template #append>
                <div class="d-flex align-center" style="gap: 4px;">
                  <v-btn
                    icon="mdi-pencil-outline"
                    variant="text"
                    size="x-small"
                    title="Đổi tên danh mục"
                    @click.stop="openEditCatalogDialog(cat)"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    variant="text"
                    size="x-small"
                    color="error"
                    title="Xóa danh mục"
                    @click.stop="confirmDeleteCatalog(cat)"
                  />
                </div>
              </template>
            </v-list-item>
          </v-list>

          <div v-else-if="!loadingCatalogs" class="pa-8 text-center text-medium-emphasis">
            <v-icon size="40" color="grey-lighten-1" class="mb-2">mdi-folder-open-outline</v-icon>
            <div class="text-body-2">Chưa có danh mục nào</div>
            <v-btn size="small" variant="text" color="primary" class="mt-2" @click="openCreateCatalogDialog">
              + Tạo danh mục đầu tiên
            </v-btn>
          </div>
        </v-card>
      </v-col>

      <!-- Cột bên phải: Danh sách Sản phẩm trong Danh mục -->
      <v-col cols="12" md="8" lg="9">
        <v-card rounded="xl" elevation="1" class="border">
          <div class="pa-4 border-b d-flex flex-wrap align-center justify-space-between bg-surface-variant" style="gap: 12px;">
            <div>
              <span class="text-subtitle-1 font-weight-bold">
                {{ selectedCatalog ? (selectedCatalog.catalogName || selectedCatalog.name) : 'Chọn danh mục để xem sản phẩm' }}
              </span>
              <span v-if="selectedCatalog" class="text-caption text-medium-emphasis ml-2">
                ({{ products.length }} sản phẩm)
              </span>
            </div>

            <v-btn
              v-if="selectedCatalog"
              color="primary"
              variant="flat"
              size="small"
              prepend-icon="mdi-plus"
              rounded="lg"
              @click="openCreateProductDialog"
            >
              Thêm sản phẩm
            </v-btn>
          </div>

          <v-progress-linear v-if="loadingProducts" indeterminate color="primary" />

          <div class="pa-4">
            <!-- Empty state -->
            <div v-if="!selectedCatalog" class="pa-12 text-center text-medium-emphasis">
              <v-icon size="56" color="grey-lighten-1" class="mb-3">mdi-cursor-default-click-outline</v-icon>
              <div class="text-subtitle-1 font-weight-medium">Vui lòng chọn danh mục bên trái</div>
              <div class="text-caption">Hoặc tạo một danh mục mới để bắt đầu đăng sản phẩm.</div>
            </div>

            <div v-else-if="!loadingProducts && products.length === 0" class="pa-12 text-center text-medium-emphasis">
              <v-icon size="56" color="grey-lighten-1" class="mb-3">mdi-shopping-outline</v-icon>
              <div class="text-subtitle-1 font-weight-medium">Danh mục này chưa có sản phẩm nào</div>
              <v-btn color="primary" variant="tonal" class="mt-3" prepend-icon="mdi-plus" @click="openCreateProductDialog">
                Thêm sản phẩm đầu tiên
              </v-btn>
            </div>

            <!-- Product Grid -->
            <v-row v-else>
              <v-col
                v-for="prod in products"
                :key="prod.productId || prod.id"
                cols="12"
                sm="6"
                lg="4"
              >
                <v-card rounded="lg" elevation="2" class="product-item-card h-100 d-flex flex-column border">
                  <!-- Product Image -->
                  <div class="product-image-wrap position-relative bg-grey-lighten-4">
                    <v-img
                      v-if="getProductImage(prod)"
                      :src="getProductImage(prod)"
                      height="170"
                      cover
                    />
                    <div v-else class="d-flex align-center justify-center" style="height: 170px;">
                      <v-icon size="48" color="grey-lighten-1">mdi-image-outline</v-icon>
                    </div>
                    <div class="product-price-badge px-2.5 py-1 rounded-pill font-weight-bold text-caption">
                      {{ formatPrice(prod.price) }}
                    </div>
                  </div>

                  <!-- Product Info -->
                  <v-card-text class="pa-3 flex-grow-1 d-flex flex-column justify-space-between">
                    <div>
                      <div class="text-subtitle-2 font-weight-bold text-truncate-2 mb-1" :title="prod.productName || prod.name">
                        {{ prod.productName || prod.name }}
                      </div>
                      <div class="text-caption text-medium-emphasis text-truncate-2" style="font-size: 0.78rem;">
                        {{ prod.description || 'Chưa có mô tả' }}
                      </div>
                    </div>
                  </v-card-text>

                  <!-- Product Actions -->
                  <v-card-actions class="pa-2 px-3 border-t d-flex justify-space-between">
                    <v-btn
                      variant="text"
                      size="small"
                      color="primary"
                      prepend-icon="mdi-pencil-outline"
                      @click="openEditProductDialog(prod)"
                    >
                      Sửa
                    </v-btn>
                    <v-btn
                      variant="text"
                      size="small"
                      color="error"
                      icon="mdi-delete-outline"
                      title="Xóa sản phẩm"
                      @click="confirmDeleteProduct(prod)"
                    />
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Dialog: Tạo/Sửa Danh mục -->
    <v-dialog v-model="catalogDialog.show" max-width="440">
      <v-card rounded="xl">
        <v-card-title class="pa-4 border-b font-weight-bold">
          {{ catalogDialog.isEdit ? 'Chỉnh sửa danh mục' : 'Tạo danh mục mới' }}
        </v-card-title>
        <v-card-text class="pa-4">
          <v-text-field
            v-model="catalogDialog.name"
            label="Tên danh mục"
            placeholder="Ví dụ: Áo đồng phục, Quà tặng doanh nghiệp..."
            variant="outlined"
            density="compact"
            autofocus
            @keydown.enter="saveCatalog"
          />
        </v-card-text>
        <v-card-actions class="pa-3 px-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="text" rounded="lg" @click="catalogDialog.show = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="catalogDialog.saving"
            :disabled="!catalogDialog.name.trim()"
            @click="saveCatalog"
          >
            Lưu danh mục
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Tạo/Sửa Sản phẩm -->
    <v-dialog v-model="productDialog.show" max-width="520">
      <v-card rounded="xl">
        <v-card-title class="pa-4 border-b font-weight-bold">
          {{ productDialog.isEdit ? 'Chỉnh sửa sản phẩm' : 'Đăng sản phẩm mới vào Catalog' }}
        </v-card-title>
        <v-card-text class="pa-4 d-flex flex-column" style="gap: 16px;">
          <v-text-field
            v-model="productDialog.name"
            label="Tên sản phẩm *"
            placeholder="Ví dụ: Áo Polo đồng phục cao cấp"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model="productDialog.price"
            label="Giá bán (VND) *"
            placeholder="Ví dụ: 150000"
            type="number"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-textarea
            v-model="productDialog.description"
            label="Mô tả sản phẩm"
            placeholder="Thông số, chất liệu, xuất xứ..."
            variant="outlined"
            density="compact"
            rows="3"
            auto-grow
            hide-details
          />
        </v-card-text>
        <v-card-actions class="pa-3 px-4 border-t d-flex justify-end" style="gap: 8px;">
          <v-btn variant="text" rounded="lg" @click="productDialog.show = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :loading="productDialog.saving"
            :disabled="!productDialog.name.trim()"
            @click="saveProduct"
          >
            Lưu sản phẩm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { zaloExtendedApi } from '@/api/zalo-extended';

const accounts = ref<any[]>([]);
const selectedAccountId = ref<string>('');

const catalogs = ref<any[]>([]);
const selectedCatalog = ref<any>(null);
const products = ref<any[]>([]);

const loadingCatalogs = ref(false);
const loadingProducts = ref(false);

const snackbar = ref({ show: false, text: '', color: 'success' });

const catalogDialog = ref({
  show: false,
  isEdit: false,
  id: '',
  name: '',
  saving: false,
});

const productDialog = ref({
  show: false,
  isEdit: false,
  productId: '',
  name: '',
  price: '',
  description: '',
  saving: false,
});

onMounted(async () => {
  await fetchAccounts();
});

async function fetchAccounts() {
  try {
    const res = await api.get('/zalo-accounts');
    accounts.value = res.data || [];
    if (accounts.value.length > 0) {
      // Ưu tiên chọn account online
      const onlineAcc = accounts.value.find((a: any) => (a.liveStatus || a.status) === 'connected');
      selectedAccountId.value = onlineAcc ? onlineAcc.id : accounts.value[0].id;
      await fetchCatalogs();
    }
  } catch (err: any) {
    showToast('Lỗi khi tải danh sách tài khoản Zalo', 'error');
  }
}

async function onAccountChanged() {
  catalogs.value = [];
  selectedCatalog.value = null;
  products.value = [];
  await fetchCatalogs();
}

async function fetchCatalogs() {
  if (!selectedAccountId.value) return;
  loadingCatalogs.value = true;
  try {
    const res = await zaloExtendedApi.getCatalogs(selectedAccountId.value);
    const data = res.data?.data || res.data;
    catalogs.value = data?.items || data?.catalogs || (Array.isArray(data) ? data : []);
    if (catalogs.value.length > 0) {
      await selectCatalog(catalogs.value[0]);
    }
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Không thể lấy danh mục sản phẩm', 'error');
  } finally {
    loadingCatalogs.value = false;
  }
}

async function selectCatalog(cat: any) {
  selectedCatalog.value = cat;
  const catalogId = cat.catalogId || cat.id;
  await fetchProducts(catalogId);
}

async function fetchProducts(catalogId: string) {
  if (!selectedAccountId.value || !catalogId) return;
  loadingProducts.value = true;
  try {
    const res = await zaloExtendedApi.getProducts(selectedAccountId.value, catalogId);
    const data = res.data?.data || res.data;
    products.value = data?.items || data?.products || (Array.isArray(data) ? data : []);
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Lỗi khi tải danh sách sản phẩm', 'error');
  } finally {
    loadingProducts.value = false;
  }
}

// ── Catalog Dialog Handlers ────────────────────────────────────────────────
function openCreateCatalogDialog() {
  catalogDialog.value = { show: true, isEdit: false, id: '', name: '', saving: false };
}

function openEditCatalogDialog(cat: any) {
  catalogDialog.value = {
    show: true,
    isEdit: true,
    id: cat.catalogId || cat.id,
    name: cat.catalogName || cat.name || '',
    saving: false,
  };
}

async function saveCatalog() {
  if (!catalogDialog.value.name.trim() || !selectedAccountId.value) return;
  catalogDialog.value.saving = true;
  try {
    if (catalogDialog.value.isEdit) {
      await zaloExtendedApi.updateCatalog(selectedAccountId.value, catalogDialog.value.id, catalogDialog.value.name.trim());
      showToast('Đã cập nhật danh mục thành công!');
    } else {
      await zaloExtendedApi.createCatalog(selectedAccountId.value, catalogDialog.value.name.trim());
      showToast('Đã tạo danh mục mới thành công!');
    }
    catalogDialog.value.show = false;
    await fetchCatalogs();
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Lỗi lưu danh mục', 'error');
  } finally {
    catalogDialog.value.saving = false;
  }
}

async function confirmDeleteCatalog(cat: any) {
  if (!confirm(`Bạn có chắc muốn xóa danh mục "${cat.catalogName || cat.name}" trên Zalo?`)) return;
  try {
    await zaloExtendedApi.deleteCatalog(selectedAccountId.value, cat.catalogId || cat.id);
    showToast('Đã xóa danh mục thành công!');
    await fetchCatalogs();
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Xóa danh mục thất bại', 'error');
  }
}

// ── Product Dialog Handlers ────────────────────────────────────────────────
function openCreateProductDialog() {
  productDialog.value = {
    show: true,
    isEdit: false,
    productId: '',
    name: '',
    price: '',
    description: '',
    saving: false,
  };
}

function openEditProductDialog(prod: any) {
  productDialog.value = {
    show: true,
    isEdit: true,
    productId: prod.productId || prod.id,
    name: prod.productName || prod.name || '',
    price: String(prod.price || ''),
    description: prod.description || '',
    saving: false,
  };
}

async function saveProduct() {
  if (!selectedCatalog.value || !selectedAccountId.value) return;
  const catalogId = selectedCatalog.value.catalogId || selectedCatalog.value.id;
  productDialog.value.saving = true;
  try {
    if (productDialog.value.isEdit) {
      await zaloExtendedApi.updateProduct(selectedAccountId.value, catalogId, productDialog.value.productId, {
        productName: productDialog.value.name.trim(),
        price: productDialog.value.price || '0',
        description: productDialog.value.description,
      });
      showToast('Cập nhật sản phẩm thành công!');
    } else {
      await zaloExtendedApi.createProduct(selectedAccountId.value, catalogId, {
        productName: productDialog.value.name.trim(),
        price: productDialog.value.price || '0',
        description: productDialog.value.description,
      });
      showToast('Đã đăng sản phẩm mới lên Catalog Zalo!');
    }
    productDialog.value.show = false;
    await fetchProducts(catalogId);
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Lưu sản phẩm thất bại', 'error');
  } finally {
    productDialog.value.saving = false;
  }
}

async function confirmDeleteProduct(prod: any) {
  if (!confirm(`Bạn có chắc muốn xóa sản phẩm "${prod.productName || prod.name}" khỏi Catalog?`)) return;
  const catalogId = selectedCatalog.value.catalogId || selectedCatalog.value.id;
  try {
    await zaloExtendedApi.deleteProduct(selectedAccountId.value, catalogId, prod.productId || prod.id);
    showToast('Đã xóa sản phẩm thành công!');
    await fetchProducts(catalogId);
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Xóa sản phẩm thất bại', 'error');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getProductImage(prod: any): string | undefined {
  if (prod.photos && Array.isArray(prod.photos) && prod.photos.length > 0) {
    return prod.photos[0].url || prod.photos[0] || undefined;
  }
  return prod.photoUrl || prod.imageUrl || prod.avatar || undefined;
}

function formatPrice(val: any): string {
  if (!val) return '0 ₫';
  const num = parseInt(val, 10);
  if (isNaN(num)) return `${val} ₫`;
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
}

function showToast(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}
</script>

<style scoped>
.product-item-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.product-item-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
}
.product-price-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: #fbbf24;
  backdrop-filter: blur(4px);
}
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
