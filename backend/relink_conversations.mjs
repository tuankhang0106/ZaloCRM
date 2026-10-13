import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('=== TIẾN HÀNH KHÔI PHỤC VÀ TỰ ĐỘNG NỐI LẠI (AUTO RE-LINK) ===\n');

  // 1. Tìm tất cả các conversation đang bị mồ côi (contactId === null)
  const unlinkedConvs = await prisma.conversation.findMany({
    where: { contactId: null },
    include: {
      _count: { select: { messages: true } },
      messages: {
        take: 1,
        orderBy: { sentAt: 'desc' },
        select: { senderName: true, senderUid: true, content: true, sentAt: true }
      }
    }
  });

  console.log(`Tìm thấy ${unlinkedConvs.length} cuộc hội thoại chưa gắn contactId.`);

  let reconnected = 0;

  for (const conv of unlinkedConvs) {
    if (!conv.externalThreadId) continue;

    let matchedContact = await prisma.contact.findFirst({
      where: {
        orgId: conv.orgId,
        zaloUid: conv.externalThreadId,
      }
    });

    if (!matchedContact) {
      // Nếu chưa có Contact nào có zaloUid này, tạo lại Contact từ thông tin tin nhắn
      const lastMsg = conv.messages[0];
      const name = lastMsg?.senderName || 'Khách hàng Zalo';
      matchedContact = await prisma.contact.create({
        data: {
          orgId: conv.orgId,
          zaloUid: conv.externalThreadId,
          fullName: name,
        }
      });
      console.log(`[TẠO MỚI CONTACT] Đã tạo contact "${matchedContact.fullName}" (id: ${matchedContact.id}) cho thread ${conv.externalThreadId}`);
    }

    // Nối lại conversation với contact
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { contactId: matchedContact.id }
    });

    console.log(`[ĐÃ NỐI LẠI THÀNH CÔNG] Hội thoại ${conv.id} (${conv._count.messages} tin nhắn) -> Khách hàng: "${matchedContact.fullName}" (${matchedContact.id})`);
    reconnected++;
  }

  // 2. Kiểm tra nếu có Contact nào có zaloUid nhưng các hội thoại của UID đó vẫn chưa gắn contactId
  const allContacts = await prisma.contact.findMany({
    where: { zaloUid: { not: null } },
    select: { id: true, orgId: true, zaloUid: true, fullName: true }
  });

  let additionalReconnected = 0;
  for (const contact of allContacts) {
    if (!contact.zaloUid) continue;
    const res = await prisma.conversation.updateMany({
      where: {
        orgId: contact.orgId,
        externalThreadId: contact.zaloUid,
        contactId: null,
      },
      data: { contactId: contact.id }
    });
    if (res.count > 0) {
      console.log(`[NỐI BỔ SUNG] Đã nối ${res.count} hội thoại với Contact "${contact.fullName}" (${contact.id})`);
      additionalReconnected += res.count;
    }
  }

  console.log(`\n=== HOÀN TẤT: Đã khôi phục và nối lại tổng cộng ${reconnected + additionalReconnected} cuộc hội thoại! ===`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
