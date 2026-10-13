# HƯỚNG DẪN DỜI HỆ THỐNG VÀ KHÔI PHỤC DATA SANG VPS MỚI (Zalo CRM)

Tài liệu này hướng dẫn chi tiết từng bước để đưa toàn bộ dữ liệu (chat, danh bạ, nhân sự, tài khoản Zalo, file đính kèm, cấu hình) từ gói backup lên VPS mới.

---

## 📁 THÔNG TIN GÓI BACKUP ĐÃ TẢI VỀ MÁY LOCAL
Thư mục: `d:\Code\ZaloCRM\backups\MIGRATION_20260823121808\`

Danh sách các tệp:
1. `FULL_MIGRATION_BUNDLE_20260823121808.tar.gz` (Gói tổng hợp tất cả tệp bên dưới)
2. `zalocrm_db_20260823121808.sql.gz` (Toàn bộ 36,900+ tin nhắn, 755 khách hàng, 10 nhân sự, phân quyền, token Zalo dạng SQL nén)
3. `zalocrm_db_20260823121808.dump` (Bản dump nhị phân PostgreSQL chuyên dụng)
4. `zalocrm_file_storage_20260823121808.tar.gz` (Toàn bộ file/ảnh upload trong volume storage)
5. `zalocrm_code_and_config_20260823121808.tar.gz` (Mã nguồn full + Dockerfile + docker-compose)
6. `production.env` (File môi trường và bí mật cấu hình sản xuất)
7. `nginx_crm_adameva_vn.conf` (File cấu hình Nginx Reverse Proxy + WebSockets)

---

## 🚀 CÁC BƯỚC KHÔI PHỤC TRÊN VPS MỚI

### BƯỚC 1: Chuẩn bị trên VPS Mới (Ubuntu 22.04 / 24.04)
Đăng nhập SSH vào VPS mới và cài đặt Docker + Docker Compose + Nginx + Certbot:
```bash
apt-get update && apt-get install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
systemctl enable docker
systemctl start docker
```

---

### BƯỚC 2: Tải gói Backup lên VPS Mới
Từ máy tính của bạn (PowerShell hoặc SCP), đẩy file tổng hợp lên VPS mới:
```powershell
scp "d:\Code\ZaloCRM\backups\MIGRATION_20260823121808\FULL_MIGRATION_BUNDLE_20260823121808.tar.gz" root@<IP_VPS_MOI>:/root/
```

---

### BƯỚC 3: Giải nén mã nguồn & chuẩn bị file cấu hình trên VPS Mới
Trên VPS mới, chạy:
```bash
cd /root
mkdir -p /root/migration_tmp
tar -xzf FULL_MIGRATION_BUNDLE_20260823121808.tar.gz -C /root/migration_tmp

# Giải nén mã nguồn vào /root/ZaloCRM
tar -xzf /root/migration_tmp/zalocrm_code_and_config_*.tar.gz -C /root/

# Copy file .env vào thư mục dự án
cp /root/migration_tmp/production.env /root/ZaloCRM/.env
```

---

### BƯỚC 4: Khởi động Database & Khôi phục dữ liệu
1. Khởi động container Database trước:
```bash
cd /root/ZaloCRM
docker compose up -d db
```

2. Đợi database khởi động (~10 giây), sau đó nạp toàn bộ dữ liệu PostgreSQL vào:
```bash
# Khôi phục toàn bộ Database (36,974 tin nhắn, 755 khách hàng, nhân sự, v.v.)
gunzip -c /root/migration_tmp/zalocrm_db_*.sql.gz | docker compose exec -T db psql -U crmuser -d zalocrm
```

3. Khôi phục volume lưu trữ file / ảnh upload:
```bash
docker run --rm -v zalocrm_file_storage:/data -v /root/migration_tmp:/backup alpine tar -xzf /backup/zalocrm_file_storage_*.tar.gz -C /data
```

---

### BƯỚC 5: Build và Chạy toàn bộ hệ thống
```bash
cd /root/ZaloCRM
docker compose up -d --build
```
Kiểm tra trạng thái các container:
```bash
docker compose ps
docker compose logs -f app
```

---

### BƯỚC 6: Cấu hình Nginx Domain & SSL (HTTPS)
1. Cấu hình Nginx reverse proxy:
```bash
cp /root/migration_tmp/nginx_crm_adameva_vn.conf /etc/nginx/sites-available/crm.adameva.vn
ln -sf /etc/nginx/sites-available/crm.adameva.vn /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

2. Trỏ IP của tên miền (`crm.adameva.vn` hoặc domain mới) về IP của VPS Mới.
3. Cấp chứng chỉ SSL HTTPS miễn phí:
```bash
certbot --nginx -d crm.adameva.vn --non-interactive --agree-tos --email contact@adameva.vn
```

---

### ✅ HOÀN TẤT!
Toàn bộ hệ thống Zalo CRM của bạn sẽ hoạt động trên VPS mới với 100% dữ liệu nguyên vẹn.
