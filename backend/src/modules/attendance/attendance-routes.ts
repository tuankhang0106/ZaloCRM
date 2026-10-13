import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { AttendanceService } from './attendance-service.js';

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  // Apply authentication middleware to all attendance routes
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/attendance/status — Retrieve today's check-in/out status
  app.get('/api/v1/attendance/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const status = await AttendanceService.getAttendanceStatus(user.id);
      return status || { checkedIn: false };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to fetch attendance status' });
    }
  });

  // POST /api/v1/attendance/check-in — Check-in
  app.post('/api/v1/attendance/check-in', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const record = await AttendanceService.autoCheckIn(user.id, user.orgId, request.ip);
      return record;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to check in' });
    }
  });

  // POST /api/v1/attendance/check-out — Check-out
  app.post('/api/v1/attendance/check-out', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const record = await AttendanceService.manualCheckOut(user.id, user.orgId, request.ip);
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to check out' });
    }
  });

  // GET /api/v1/attendance/my-history — Get current user's history
  app.get(
    '/api/v1/attendance/my-history',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { from, to } = request.query as any;

      if (!from || !to) {
        return reply.status(400).send({ error: 'Tham số "from" và "to" là bắt buộc.' });
      }

      try {
        const history = await AttendanceService.getUserHistory(user.id, user.orgId, from, to);
        return history;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch personal attendance history' });
      }
    }
  );

  // ── Administrative Endpoints ──────────────────────────────────────────────

  // GET /api/v1/attendance/admin/list — List all employee attendance for date (Admin/Owner)
  app.get(
    '/api/v1/attendance/admin/list',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { date } = request.query as any;

      if (!date) {
        return reply.status(400).send({ error: 'Tham số "date" là bắt buộc.' });
      }

      try {
        const list = await AttendanceService.adminListAttendance(user.orgId, date);
        return list;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch employee attendance list' });
      }
    }
  );

  // GET /api/v1/attendance/admin/range-list — List employee attendance within date range (Admin/Owner)
  app.get(
    '/api/v1/attendance/admin/range-list',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { from, to } = request.query as any;

      if (!from || !to) {
        return reply.status(400).send({ error: 'Tham số "from" và "to" là bắt buộc.' });
      }

      try {
        const list = await AttendanceService.adminRangeAttendance(user.orgId, from, to);
        return list;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch range attendance list' });
      }
    }
  );

  // GET /api/v1/attendance/admin/employee-history — Get any employee's history (Admin/Owner)
  app.get(
    '/api/v1/attendance/admin/employee-history',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { employeeId, from, to } = request.query as any;

      if (!employeeId || !from || !to) {
        return reply.status(400).send({ error: 'Tham số "employeeId", "from" và "to" là bắt buộc.' });
      }

      try {
        const history = await AttendanceService.getUserHistory(employeeId, user.orgId, from, to);
        return history;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch employee attendance history' });
      }
    }
  );

  // POST /api/v1/attendance/admin/adjust — Manually adjust employee attendance (Admin/Owner)
  app.post(
    '/api/v1/attendance/admin/adjust',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { employeeId, date, checkInAt, checkOutAt, reason } = request.body as any;

      if (!employeeId || !date || !reason?.trim()) {
        return reply.status(400).send({ error: 'Nhân viên, ngày và lý do điều chỉnh là bắt buộc.' });
      }

      try {
        const record = await AttendanceService.adminAdjustAttendance(
          user.id,
          user.orgId,
          employeeId,
          date,
          checkInAt,
          checkOutAt,
          reason
        );
        return record;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to adjust attendance' });
      }
    }
  );

  // GET /api/v1/attendance/admin/adjust-logs — Get adjustment history logs (Admin/Owner)
  app.get(
    '/api/v1/attendance/admin/adjust-logs',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const logs = await AttendanceService.getAdjustmentLogs(user.orgId);
        return logs;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch adjustment logs' });
      }
    }
  );

  // POST /api/v1/attendance/request — Submit a request (Employee)
  app.post('/api/v1/attendance/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { type, date, time, reason } = request.body as any;

    if (!type || !date || !reason?.trim()) {
      return reply.status(400).send({ error: 'Loại yêu cầu, ngày và lý do là bắt buộc.' });
    }

    try {
      const record = await AttendanceService.createAttendanceRequest(
        user.id,
        user.orgId,
        type,
        date,
        time,
        reason
      );
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to submit request' });
    }
  });

  // GET /api/v1/attendance/request/my-list — View employee's own requests
  app.get('/api/v1/attendance/request/my-list', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const list = await AttendanceService.getEmployeeRequests(user.id, user.orgId);
      return list;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to fetch personal requests' });
    }
  });

  // GET /api/v1/attendance/admin/requests — Get requests for Admin review (Admin/Owner)
  app.get(
    '/api/v1/attendance/admin/requests',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const list = await AttendanceService.getAdminRequests(user.orgId);
        return list;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to fetch pending requests' });
      }
    }
  );

  // POST /api/v1/attendance/admin/request/action — Approve/reject request (Admin/Owner)
  app.post(
    '/api/v1/attendance/admin/request/action',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { requestId, action } = request.body as any;

      if (!requestId || !action || !['approve', 'reject'].includes(action)) {
        return reply.status(400).send({ error: 'Yêu cầu và hành động (approve/reject) là bắt buộc.' });
      }

      try {
        const record = await AttendanceService.processAttendanceRequest(
          user.id,
          user.orgId,
          requestId,
          action
        );
        return record;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Failed to process request' });
      }
    }
  );
}
