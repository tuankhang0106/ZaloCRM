import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const SOURCE_ROOT = 'c:/PHẦN MỀM/ZaloCRM/image/KHO PHÔI ÁO';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MEDIA_DIR = path.join(UPLOAD_DIR, 'media');

// Folder color mapping for beautiful UI
const FOLDER_CONFIGS = {
  'CẦU LÔNG': { color: '#00B074' },
  'CỔ TRÒN': { color: '#3B82F6' },
  'POLO': { color: '#8B5CF6' },
  'QUẦN': { color: '#F59E0B' },
  'SƠ MI': { color: '#EC4899' },
  'BỘ THỂ THAO': { color: '#06B6D4' },
};

async function importImages() {
  console.log('=== BẮT ĐẦU IMPORT KHO ẢNH PHÔI ÁO VÀO ZALOCRM ===');

  if (!fs.existsSync(SOURCE_ROOT)) {
    throw new Error(`Thư mục nguồn không tồn tại: ${SOURCE_ROOT}`);
  }

  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    console.log(`Đã tạo thư mục lưu trữ media: ${MEDIA_DIR}`);
  }

  // 1. Lấy Organization và User admin
  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('Chưa có Organization nào trong hệ thống!');
  }
  const user = await prisma.user.findFirst({ where: { orgId: org.id } });
  console.log(`Organization: ${org.name} (${org.id})`);
  console.log(`User phụ trách: ${user ? user.fullName : 'N/A'} (${user?.id})`);

  // 2. Quét toàn bộ thư mục và file
  const folderMap = new Map(); // folderName -> folderId
  
  // Hàm tạo hoặc lấy folder trong DB
  async function getOrCreateFolder(name, color = '#00B074') {
    if (folderMap.has(name)) return folderMap.get(name);

    let folder = await prisma.mediaFolder.findFirst({
      where: { orgId: org.id, name: name.trim() },
    });

    if (!folder) {
      folder = await prisma.mediaFolder.create({
        data: {
          orgId: org.id,
          name: name.trim(),
          color: color,
        },
      });
      console.log(`+ Đã tạo Album mới: [${folder.name}] (màu: ${folder.color})`);
    } else {
      console.log(`* Sử dụng Album đã có: [${folder.name}]`);
    }

    folderMap.set(name, folder.id);
    return folder.id;
  }

  const entries = fs.readdirSync(SOURCE_ROOT, { withFileTypes: true });

  const tasks = [];

  for (const entry of entries) {
    const fullPath = path.join(SOURCE_ROOT, entry.name);

    if (entry.isDirectory()) {
      const folderName = entry.name;
      const subFiles = fs.readdirSync(fullPath, { withFileTypes: true });

      for (const file of subFiles) {
        if (!file.isFile()) continue;
        const ext = path.extname(file.name).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

        tasks.push({
          folderName: folderName,
          filePath: path.join(fullPath, file.name),
          fileName: file.name,
          ext,
        });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

      // File ở thư mục gốc: phân loại vào album "BỘ THỂ THAO" nếu tên chứa thể thao, hoặc "KHO PHÔI ÁO"
      let targetFolder = 'BỘ THỂ THAO';
      if (!entry.name.toLowerCase().includes('thể thao')) {
        targetFolder = 'KHO PHÔI ÁO';
      }

      tasks.push({
        folderName: targetFolder,
        filePath: fullPath,
        fileName: entry.name,
        ext,
      });
    }
  }

  console.log(`\nTìm thấy tổng cộng ${tasks.length} hình ảnh cần import.`);

  // 3. Chuẩn bị các folder trước
  for (const t of tasks) {
    const color = FOLDER_CONFIGS[t.folderName]?.color || '#00B074';
    await getOrCreateFolder(t.folderName, color);
  }

  // 4. Copy file và tạo MediaItem trong DB
  let successCount = 0;
  let skippedCount = 0;

  for (const item of tasks) {
    const folderId = folderMap.get(item.folderName);
    const cleanName = path.basename(item.fileName, item.ext);

    // Kiểm tra xem ảnh này đã tồn tại trong album đó chưa
    const existing = await prisma.mediaItem.findFirst({
      where: {
        orgId: org.id,
        folderId: folderId,
        name: cleanName,
      },
    });

    if (existing) {
      console.log(`- Bỏ qua (đã tồn tại): [${item.folderName}] ${cleanName}`);
      skippedCount++;
      continue;
    }

    const fileBuffer = fs.readFileSync(item.filePath);
    const uniqueFilename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${item.ext}`;
    const destPath = path.join(MEDIA_DIR, uniqueFilename);

    fs.writeFileSync(destPath, fileBuffer);

    let mimeType = 'image/jpeg';
    if (item.ext === '.png') mimeType = 'image/png';
    else if (item.ext === '.webp') mimeType = 'image/webp';

    await prisma.mediaItem.create({
      data: {
        orgId: org.id,
        folderId: folderId,
        name: cleanName,
        filename: uniqueFilename,
        mimeType: mimeType,
        size: fileBuffer.length,
        url: `/uploads/media/${uniqueFilename}`,
        createdById: user?.id || null,
      },
    });

    console.log(`✓ Đã upload: [${item.folderName}] ${cleanName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
    successCount++;

    // Nhẹ delay 5ms để Date.now() tăng dần
    await new Promise((r) => setTimeout(r, 5));
  }

  console.log('\n========================================================');
  console.log(`HOÀN TẤT IMPORT!`);
  console.log(`- Thành công: ${successCount} ảnh`);
  console.log(`- Bỏ qua:    ${skippedCount} ảnh`);
  console.log(`- Thư mục lưu trữ: ${MEDIA_DIR}`);
  console.log('========================================================');

  // Thống kê theo từng folder
  const folders = await prisma.mediaFolder.findMany({
    where: { orgId: org.id },
    include: { _count: { select: { items: true } } },
    orderBy: { name: 'asc' },
  });

  console.log('\nThống kê kho ảnh theo thư mục:');
  for (const f of folders) {
    console.log(`• ${f.name.padEnd(20)}: ${f._count.items} ảnh (Màu: ${f.color})`);
  }
}

importImages()
  .catch((err) => {
    console.error('LỖI KHI IMPORT:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
