import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

// Helper to normalize IP addresses (strip ::ffff: prefix)
export function normalizeIp(ip: string): string {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip.trim();
}

// Helper to get today's local date normalized to 00:00:00 UTC in Vietnam timezone (UTC+7)
export function getVnLocalDate(dateInput: Date | string = new Date()): Date {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  // Vietnam is UTC+7
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const dateStr = vnTime.toISOString().split('T')[0]; // YYYY-MM-DD
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// Helper to verify if an IP matches the organization's office IP configuration
export async function verifyIp(orgId: string, ip: string): Promise<{ isAllowed: boolean; officeIpList: string[] }> {
  const normIp = normalizeIp(ip);
  if (!normIp) return { isAllowed: true, officeIpList: [] }; // If client IP is missing, treat as allowed (or default)

  const setting = await prisma.appSetting.findUnique({
    where: {
      orgId_settingKey: {
        orgId,
        settingKey: 'office_ip',
      },
    },
  });

  if (!setting || !setting.valuePlain?.trim()) {
    return { isAllowed: true, officeIpList: [] }; // No IP restrictions configured
  }

  const officeIps = setting.valuePlain
    .split(',')
    .map((x) => normalizeIp(x.trim()))
    .filter((x) => x.length > 0);

  if (officeIps.length === 0) {
    return { isAllowed: true, officeIpList: [] };
  }

  const isAllowed = officeIps.includes(normIp);
  return { isAllowed, officeIpList: officeIps };
}

// Helper to get raw check-in/out work hour limits from organization settings
export async function getOfficeWorkHours(orgId: string): Promise<{ checkInLimit: number; checkOutLimit: number }> {
  const settings = await prisma.appSetting.findMany({
    where: {
      orgId,
      settingKey: {
        in: ['attendance_check_in_time', 'attendance_check_out_time'],
      },
    },
  });

  const checkInSetting = settings.find(s => s.settingKey === 'attendance_check_in_time');
  const checkOutSetting = settings.find(s => s.settingKey === 'attendance_check_out_time');

  // Parse "HH:MM" format
  let checkInLimit = 8 * 60 + 5; // Default 08:05
  let checkOutLimit = 17 * 60 + 30; // Default 17:30

  if (checkInSetting?.valuePlain?.trim()) {
    const parts = checkInSetting.valuePlain.trim().split(':');
    if (parts.length === 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) {
        checkInLimit = h * 60 + m;
      }
    }
  }

  if (checkOutSetting?.valuePlain?.trim()) {
    const parts = checkOutSetting.valuePlain.trim().split(':');
    if (parts.length === 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) {
        checkOutLimit = h * 60 + m;
      }
    }
  }

  return { checkInLimit, checkOutLimit };
}

export class AttendanceService {
  /**
   * Automatic Check-in
   * Triggered when the user first accesses the app in the morning.
   */
  static async autoCheckIn(userId: string, orgId: string, ip: string) {
    const today = getVnLocalDate();
    const now = new Date();

    // Check if already checked in today
    const existing = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Determine status (on_time before limit, late after)
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const hour = vnTime.getUTCHours();
    const minute = vnTime.getUTCMinutes();
    const checkInTimeInMinutes = hour * 60 + minute;
    const { checkInLimit } = await getOfficeWorkHours(orgId);

    const baseStatus = checkInTimeInMinutes > checkInLimit ? 'late' : 'on_time';
    
    // Check IP
    const { isAllowed, officeIpList } = await verifyIp(orgId, ip);
    if (officeIpList.length > 0 && !isAllowed) {
      throw new Error(`IP của bạn (${normalizeIp(ip)}) không hợp lệ. Vui lòng kết nối WiFi văn phòng để chấm công.`);
    }
    const checkInStatus = baseStatus;

    const record = await prisma.attendance.create({
      data: {
        orgId,
        userId,
        date: today,
        checkInAt: now,
        checkInIp: normalizeIp(ip),
        checkInStatus,
      },
    });

    logger.info(`[attendance] User ${userId} auto checked-in at ${now.toISOString()} from IP ${ip} (Status: ${checkInStatus})`);
    return record;
  }

  /**
   * Manual Check-out
   */
  static async manualCheckOut(userId: string, orgId: string, ip: string) {
    const today = getVnLocalDate();
    const now = new Date();

    const existing = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (!existing) {
      throw new Error('Bạn cần phải check-in trước khi check-out.');
    }

    if (existing.checkOutAt) {
      return existing; // Already checked out
    }

    // Determine status (early before limit, on_time after)
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const hour = vnTime.getUTCHours();
    const minute = vnTime.getUTCMinutes();
    const checkOutTimeInMinutes = hour * 60 + minute;
    const { checkOutLimit } = await getOfficeWorkHours(orgId);

    const baseStatus = checkOutTimeInMinutes < checkOutLimit ? 'early' : 'on_time';

    // Check IP
    const { isAllowed, officeIpList } = await verifyIp(orgId, ip);
    if (officeIpList.length > 0 && !isAllowed) {
      throw new Error(`IP của bạn (${normalizeIp(ip)}) không hợp lệ. Vui lòng kết nối WiFi văn phòng để check-out.`);
    }
    const checkOutStatus = baseStatus;

    const record = await prisma.attendance.update({
      where: {
        id: existing.id,
      },
      data: {
        checkOutAt: now,
        checkOutIp: normalizeIp(ip),
        checkOutStatus,
      },
    });

    logger.info(`[attendance] User ${userId} checked-out at ${now.toISOString()} from IP ${ip} (Status: ${checkOutStatus})`);
    return record;
  }

  /**
   * Get attendance status of the user today
   */
  static async getAttendanceStatus(userId: string) {
    const today = getVnLocalDate();
    return prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });
  }

  /**
   * Get user's attendance history log
   */
  static async getUserHistory(userId: string, orgId: string, fromDateStr: string, toDateStr: string) {
    const from = new Date(`${fromDateStr}T00:00:00.000Z`);
    const to = new Date(`${toDateStr}T23:59:59.999Z`);

    return prisma.attendance.findMany({
      where: {
        orgId,
        userId,
        date: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  /**
   * Admin: List all attendance logs for a selected date
   */
  static async adminListAttendance(orgId: string, dateStr: string) {
    const targetDate = getVnLocalDate(new Date(dateStr));

    // Get all users in the organization
    const users = await prisma.user.findMany({
      where: {
        orgId,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    // Get attendance records for this date
    const records = await prisma.attendance.findMany({
      where: {
        orgId,
        date: targetDate,
      },
    });

    // Fetch the configured office IP setting to display inside the UI check
    const officeIpSetting = await prisma.appSetting.findUnique({
      where: {
        orgId_settingKey: {
          orgId,
          settingKey: 'office_ip',
        },
      },
    });
    const officeIps = officeIpSetting?.valuePlain
      ? officeIpSetting.valuePlain.split(',').map((x) => x.trim())
      : [];

    // Map users to attendance records
    return users.map((u) => {
      const rec = records.find((r: any) => r.userId === u.id);
      return {
        userId: u.id,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        record: rec || null,
        officeIps,
      };
    });
  }

  /**
   * Admin: Manually adjust/insert an employee's attendance record
   */
  static async adminAdjustAttendance(
    adminUserId: string,
    orgId: string,
    employeeId: string,
    dateStr: string,
    checkInTimeStr: string | null, // ISO string or null
    checkOutTimeStr: string | null, // ISO string or null
    reason: string
  ) {
    const targetDate = getVnLocalDate(new Date(dateStr));
    const now = new Date();

    const checkInAt = checkInTimeStr ? new Date(checkInTimeStr) : null;
    const checkOutAt = checkOutTimeStr ? new Date(checkOutTimeStr) : null;

    // Check if record exists
    const existing = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId: employeeId,
          date: targetDate,
        },
      },
    });

    // Get employee name for logs
    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: { fullName: true, email: true },
    });

    if (!employee) {
      throw new Error('Không tìm thấy nhân viên.');
    }

    let record;
    if (existing) {
      record = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkInAt,
          checkOutAt,
          isAdjusted: true,
          adjustedByUserId: adminUserId,
          adjustedAt: now,
          adjustmentReason: reason,
          // Recalculate status as adjusted or let them be customizable
          checkInStatus: checkInAt ? (existing.checkInStatus || 'on_time') : null,
          checkOutStatus: checkOutAt ? (existing.checkOutStatus || 'on_time') : null,
        },
      });
    } else {
      record = await prisma.attendance.create({
        data: {
          orgId,
          userId: employeeId,
          date: targetDate,
          checkInAt,
          checkOutAt,
          isAdjusted: true,
          adjustedByUserId: adminUserId,
          adjustedAt: now,
          adjustmentReason: reason,
          checkInStatus: checkInAt ? 'on_time' : null,
          checkOutStatus: checkOutAt ? 'on_time' : null,
        },
      });
    }

    // Write audit trail log to ActivityLog
    await prisma.activityLog.create({
      data: {
        orgId,
        userId: adminUserId,
        action: 'attendance_adjusted',
        entityType: 'attendance',
        entityId: record.id,
        details: {
          employeeId,
          employeeName: employee.fullName,
          employeeEmail: employee.email,
          date: dateStr,
          oldCheckInAt: existing?.checkInAt || null,
          oldCheckOutAt: existing?.checkOutAt || null,
          newCheckInAt: checkInAt,
          newCheckOutAt: checkOutAt,
          reason,
        },
      },
    });

    logger.info(`[attendance] Admin ${adminUserId} adjusted attendance for employee ${employeeId} on date ${dateStr}. Reason: ${reason}`);
    return record;
  }

  /**
   * Admin: Get all attendance adjustment logs (retrieved from ActivityLog)
   */
  static async getAdjustmentLogs(orgId: string) {
    return prisma.activityLog.findMany({
      where: {
        orgId,
        action: 'attendance_adjusted',
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Admin: Get attendance logs for all employees within a date range
   */
  static async adminRangeAttendance(orgId: string, fromDateStr: string, toDateStr: string) {
    const from = new Date(`${fromDateStr}T00:00:00.000Z`);
    const to = new Date(`${toDateStr}T23:59:59.999Z`);

    // Get all users in the organization
    const users = await prisma.user.findMany({
      where: {
        orgId,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    // Get all attendance records in the date range
    const records = await prisma.attendance.findMany({
      where: {
        orgId,
        date: {
          gte: from,
          lte: to,
        },
      },
      orderBy: [
        { date: 'asc' },
      ],
    });

    // Generate date sequence in UTC
    const start = new Date(fromDateStr);
    const end = new Date(toDateStr);
    const dates: string[] = [];
    const current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    const result: any[] = [];
    for (const u of users) {
      for (const dStr of dates) {
        // Find record for this user and this date
        const rec = records.find(
          (r: any) =>
            r.userId === u.id &&
            r.date.toISOString().split('T')[0] === dStr
        );

        result.push({
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          date: dStr,
          checkInAt: rec?.checkInAt || null,
          checkInIp: rec?.checkInIp || null,
          checkInStatus: rec?.checkInStatus || null,
          checkOutAt: rec?.checkOutAt || null,
          checkOutIp: rec?.checkOutIp || null,
          checkOutStatus: rec?.checkOutStatus || null,
          isAdjusted: rec?.isAdjusted || false,
          adjustmentReason: rec?.adjustmentReason || null,
        });
      }
    }

    return result;
  }

  /**
   * Submit an attendance request
   */
  static async createAttendanceRequest(
    userId: string,
    orgId: string,
    type: string,
    dateStr: string,
    timeStr: string | null,
    reason: string
  ) {
    const targetDate = getVnLocalDate(new Date(dateStr));
    
    // Check if there is already a pending request of the same type for this date
    const existing = await prisma.attendanceRequest.findFirst({
      where: {
        userId,
        orgId,
        date: targetDate,
        type,
        status: 'pending',
      },
    });

    if (existing) {
      throw new Error('Bạn đã có một yêu cầu phê duyệt đang chờ duyệt cho ngày này rồi.');
    }

    return prisma.attendanceRequest.create({
      data: {
        orgId,
        userId,
        type,
        date: targetDate,
        time: timeStr ? timeStr.trim() : null,
        reason: reason.trim(),
        status: 'pending',
      },
    });
  }

  /**
   * Get employee's own requests
   */
  static async getEmployeeRequests(userId: string, orgId: string) {
    return prisma.attendanceRequest.findMany({
      where: {
        userId,
        orgId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get all organization requests for Admin review
   */
  static async getAdminRequests(orgId: string) {
    return prisma.attendanceRequest.findMany({
      where: {
        orgId,
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Admin: Approve or Reject request
   */
  static async processAttendanceRequest(
    adminUserId: string,
    orgId: string,
    requestId: string,
    action: 'approve' | 'reject'
  ) {
    const req = await prisma.attendanceRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });

    if (!req || req.orgId !== orgId) {
      throw new Error('Không tìm thấy yêu cầu phê duyệt.');
    }

    if (req.status !== 'pending') {
      throw new Error('Yêu cầu này đã được xử lý rồi.');
    }

    const now = new Date();
    const status = action === 'approve' ? 'approved' : 'rejected';

    const result = await prisma.$transaction(async (tx) => {
      // Update request status
      const updatedReq = await tx.attendanceRequest.update({
        where: { id: requestId },
        data: {
          status,
          approvedByUserId: adminUserId,
        },
      });

      // If approved, update or insert attendance record
      if (action === 'approve') {
        const dateStr = req.date.toISOString().split('T')[0]; // YYYY-MM-DD
        const targetDate = req.date;

        // Parse time if type is check-in/out
        let checkInAt: Date | undefined = undefined;
        let checkOutAt: Date | undefined = undefined;

        if (req.type === 'missing_check_in' && req.time) {
          checkInAt = new Date(`${dateStr}T${req.time}:00`);
        } else if (req.type === 'missing_check_out' && req.time) {
          checkOutAt = new Date(`${dateStr}T${req.time}:00`);
        }

        const existingAttendance = await tx.attendance.findUnique({
          where: {
            userId_date: {
              userId: req.userId,
              date: targetDate,
            },
          },
        });

        let attendanceRecord;
        const adjustmentReason = `Duyệt đơn: ${req.reason}`;

        if (existingAttendance) {
          const updateData: any = {
            isAdjusted: true,
            adjustedByUserId: adminUserId,
            adjustedAt: now,
            adjustmentReason,
          };
          if (checkInAt) {
            updateData.checkInAt = checkInAt;
            updateData.checkInStatus = 'on_time';
          }
          if (checkOutAt) {
            updateData.checkOutAt = checkOutAt;
            updateData.checkOutStatus = 'on_time';
          }
          if (req.type === 'leave_request') {
            updateData.adjustmentReason = `Nghỉ phép: ${req.reason}`;
          }

          attendanceRecord = await tx.attendance.update({
            where: { id: existingAttendance.id },
            data: updateData,
          });
        } else {
          const createData: any = {
            orgId,
            userId: req.userId,
            date: targetDate,
            isAdjusted: true,
            adjustedByUserId: adminUserId,
            adjustedAt: now,
            adjustmentReason,
            checkInStatus: null,
            checkOutStatus: null,
          };
          if (checkInAt) {
            createData.checkInAt = checkInAt;
            createData.checkInStatus = 'on_time';
          }
          if (checkOutAt) {
            createData.checkOutAt = checkOutAt;
            createData.checkOutStatus = 'on_time';
          }
          if (req.type === 'leave_request') {
            createData.adjustmentReason = `Nghỉ phép: ${req.reason}`;
          }

          attendanceRecord = await tx.attendance.create({
            data: createData,
          });
        }

        // Add Activity Log for audit trail
        await tx.activityLog.create({
          data: {
            orgId,
            userId: adminUserId,
            action: 'attendance_adjusted',
            entityType: 'attendance',
            entityId: attendanceRecord.id,
            details: {
              employeeId: req.userId,
              employeeName: req.user.fullName,
              employeeEmail: req.user.email,
              date: dateStr,
              oldCheckInAt: existingAttendance?.checkInAt || null,
              oldCheckOutAt: existingAttendance?.checkOutAt || null,
              newCheckInAt: checkInAt || existingAttendance?.checkInAt || null,
              newCheckOutAt: checkOutAt || existingAttendance?.checkOutAt || null,
              reason: `Phê duyệt đơn (${req.type}) - Lý do: ${req.reason}`,
            },
          },
        });
      }

      return updatedReq;
    });

    return result;
  }
}
