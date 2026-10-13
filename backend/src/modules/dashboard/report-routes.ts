/**
 * report-routes.ts — Detailed reports for messages, contacts, appointments, and Excel export.
 * All routes require JWT auth, scoped to user's orgId.
 * Sheet builders are in excel-sheet-builders.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  buildMessagesSheet,
  buildContactsSheet,
  buildAppointmentsSheet,
} from './excel-sheet-builders.js';

type QueryParams = Record<string, string>;

function defaultDateRange() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return { from, to };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/reports/kpi?from=&to= — aggregate staff response times, message count, and conversions
  app.get('/api/v1/reports/kpi', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      // 1. Fetch all users in organization
      const users = await prisma.user.findMany({
        where: { orgId },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
        },
        orderBy: { fullName: 'asc' },
      });

      // 2. Query sent messages count and average response time per user using LATERAL JOIN
      const msgStats = await prisma.$queryRaw<
        Array<{ userId: string; totalSent: bigint; avgResponseTime: number | null }>
      >`
        WITH replies AS (
          SELECT
            m.replied_by_user_id AS user_id,
            EXTRACT(EPOCH FROM (m.sent_at - prev.sent_at)) AS response_time
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          -- Get the immediate previous message in the same thread
          LEFT JOIN LATERAL (
            SELECT sent_at, sender_type
            FROM messages p
            WHERE p.conversation_id = m.conversation_id
              AND p.sent_at < m.sent_at
            ORDER BY p.sent_at DESC
            LIMIT 1
          ) prev ON true
          WHERE c.org_id = ${orgId}
            AND m.sender_type = 'self'
            AND m.replied_by_user_id IS NOT NULL
            AND prev.sender_type = 'contact'
            AND m.sent_at >= ${from}::date
            AND m.sent_at < (${to}::date + interval '1 day')
        )
        SELECT
          user_id AS "userId",
          COUNT(*) AS "totalSent",
          AVG(response_time)::float AS "avgResponseTime"
        FROM replies
        GROUP BY user_id
      `;

      // 3. Query contacts count by status per assigned user
      const contactStats = await prisma.$queryRaw<
        Array<{ userId: string; status: string; count: bigint }>
      >`
        SELECT
          assigned_user_id AS "userId",
          status,
          COUNT(*) AS count
        FROM contacts
        WHERE org_id = ${orgId}
          AND assigned_user_id IS NOT NULL
        GROUP BY assigned_user_id, status
      `;

      // 4. Query total orders count and total revenue generated per user
      const orderStats = await prisma.$queryRaw<
        Array<{ userId: string; totalOrders: bigint; totalRevenue: number | null }>
      >`
        SELECT
          created_by_user_id AS "userId",
          COUNT(*) AS "totalOrders",
          SUM(total_amount)::float AS "totalRevenue"
        FROM orders
        WHERE org_id = ${orgId}
          AND created_at >= ${from}::date
          AND created_at < (${to}::date + interval '1 day')
        GROUP BY created_by_user_id
      `;

      // 5. Map queries into structured KPI dashboard objects
      const msgStatsMap = new Map(msgStats.map(s => [s.userId, s]));
      
      const contactStatsMap = new Map<string, Record<string, number>>();
      for (const row of contactStats) {
        if (!contactStatsMap.has(row.userId)) {
          contactStatsMap.set(row.userId, {});
        }
        contactStatsMap.get(row.userId)![row.status || 'new'] = Number(row.count);
      }

      const orderStatsMap = new Map(orderStats.map(s => [s.userId, s]));

      const kpiData = users.map((u) => {
        const msg = msgStatsMap.get(u.id);
        const contacts = contactStatsMap.get(u.id) || {};
        const orders = orderStatsMap.get(u.id);

        const totalContacts = Object.values(contacts).reduce((a, b) => a + b, 0);
        const convertedContacts = contacts['converted'] || 0;
        const conversionRate = totalContacts > 0 ? (convertedContacts / totalContacts) * 100 : 0;

        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          messagesSent: msg ? Number(msg.totalSent) : 0,
          avgResponseTime: msg ? msg.avgResponseTime : null, // seconds
          totalContacts,
          convertedContacts,
          conversionRate: Number(conversionRate.toFixed(1)),
          totalOrders: orders ? Number(orders.totalOrders) : 0,
          totalRevenue: orders ? Number(orders.totalRevenue || 0) : 0,
          statusDistribution: contacts,
        };
      });

      return { from, to, data: kpiData };
    } catch (err) {
      logger.error('[reports] KPI error:', err);
      return reply.status(500).send({ error: 'Failed to fetch KPI report' });
    }
  });

  // GET /api/v1/reports/messages?from=&to=
  app.get('/api/v1/reports/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const rows = await prisma.$queryRaw<
        Array<{ date: Date; sent: bigint; received: bigint; total: bigint }>
      >`
        SELECT
          DATE(m.sent_at) AS date,
          COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
          COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received,
          COUNT(*) AS total
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.org_id = ${orgId}
          AND m.sent_at >= ${from}::date
          AND m.sent_at < (${to}::date + interval '1 day')
        GROUP BY DATE(m.sent_at)
        ORDER BY date DESC
      `;

      const data = rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        sent: Number(r.sent),
        received: Number(r.received),
        total: Number(r.total),
      }));

      return { from, to, data };
    } catch (err) {
      logger.error('[reports] Messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch message report' });
    }
  });

  // GET /api/v1/reports/contacts?from=&to= — contacts by status distribution
  app.get('/api/v1/reports/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const [newPerDay, statusDist] = await Promise.all([
        prisma.$queryRaw<Array<{ date: Date; zaloName: string; count: bigint }>>`
          SELECT 
            DATE(c.created_at) AS date,
            za.display_name AS "zaloName",
            COUNT(DISTINCT c.id) AS count
          FROM contacts c
          JOIN conversations conv ON conv.contact_id = c.id
          JOIN zalo_accounts za ON za.id = conv.zalo_account_id
          WHERE c.org_id = ${orgId}
            AND c.zalo_uid IS NOT NULL
            AND conv."threadType" = 'user'
            AND c.created_at >= ${from}::date
            AND c.created_at < (${to}::date + interval '1 day')
          GROUP BY DATE(c.created_at), za.display_name
          ORDER BY date DESC, za.display_name ASC
        `,
        prisma.contact.groupBy({
          by: ['status'],
          where: { orgId, status: { not: null } },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        newPerDay: newPerDay.map((r) => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          zaloName: r.zaloName,
          count: Number(r.count),
        })),
        byStatus: statusDist.map((s) => ({
          status: s.status,
          count: s._count,
        })),
      };
    } catch (err) {
      logger.error('[reports] Contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact report' });
    }
  });

  // GET /api/v1/reports/appointments?from=&to=
  app.get('/api/v1/reports/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const dateFilter = { gte: new Date(from), lte: new Date(to) };
      const [byStatus, byType] = await Promise.all([
        prisma.appointment.groupBy({
          by: ['status'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
        prisma.appointment.groupBy({
          by: ['type'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
        byType: byType.map((t) => ({ type: t.type, count: t._count })),
      };
    } catch (err) {
      logger.error('[reports] Appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment report' });
    }
  });

  // GET /api/v1/reports/export?type=messages&from=&to=
  app.get('/api/v1/reports/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const type = query.type || 'messages';
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const workbook = new ExcelJS.Workbook();

      if (type === 'messages') {
        await buildMessagesSheet(workbook, orgId, from, to);
      } else if (type === 'contacts') {
        await buildContactsSheet(workbook, orgId, from, to);
      } else if (type === 'appointments') {
        await buildAppointmentsSheet(workbook, orgId, from, to);
      } else {
        return reply.status(400).send({ error: 'Invalid export type. Use: messages, contacts, appointments' });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename=${type}-report.xlsx`);
      return reply.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err) {
      logger.error('[reports] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}
