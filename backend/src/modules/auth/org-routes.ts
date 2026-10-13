/**
 * Organization settings routes — get and update current org info.
 * GET is accessible to all authenticated users; PUT requires owner role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireRole } from './role-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import fs from 'node:fs';
import path from 'node:path';

const BACKUPS_DIR = process.env.NODE_ENV === 'production'
  ? '/var/lib/zalo-crm/backups'
  : path.resolve(process.cwd(), '../backups');

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // Public brand endpoint (no auth needed)
  app.get('/api/v1/public/brand', async () => {
    try {
      const org = await prisma.organization.findFirst({
        select: { id: true, name: true },
      });
      if (!org) {
        return { name: 'ZaloCRM', logo: null };
      }
      const logoSetting = await prisma.appSetting.findUnique({
        where: {
          orgId_settingKey: {
            orgId: org.id,
            settingKey: 'org_logo',
          },
        },
      });
      return {
        name: org.name || 'ZaloCRM',
        logo: logoSetting ? logoSetting.valuePlain : null,
      };
    } catch (err) {
      return { name: 'ZaloCRM', logo: null };
    }
  });

  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/organization — get current org info and logo
  app.get('/api/v1/organization', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      });
      if (!org) return reply.status(404).send({ error: 'Organization not found' });

      // Fetch custom logo from AppSetting
      const logoSetting = await prisma.appSetting.findUnique({
        where: {
          orgId_settingKey: {
            orgId: user.orgId,
            settingKey: 'org_logo',
          },
        },
      });

      return {
        ...org,
        logo: logoSetting ? logoSetting.valuePlain : null,
      };
    } catch (err) {
      logger.error('Failed to fetch organization details:', err);
      return reply.status(500).send({ error: 'Failed to fetch organization' });
    }
  });

  // PUT /api/v1/organization — update org name and logo (owner only)
  app.put(
    '/api/v1/organization',
    { preHandler: requireRole('owner') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { name, logo } = request.body as { name: string; logo?: string | null };
      if (!name?.trim()) return reply.status(400).send({ error: 'Tên tổ chức là bắt buộc' });

      try {
        const org = await prisma.organization.update({
          where: { id: user.orgId },
          data: { name: name.trim() },
          select: { id: true, name: true, createdAt: true, updatedAt: true },
        });

        // Update or delete custom logo in settings
        if (logo === null || logo === '') {
          await prisma.appSetting.deleteMany({
            where: {
              orgId: user.orgId,
              settingKey: 'org_logo',
            },
          });
        } else if (logo) {
          await prisma.appSetting.upsert({
            where: {
              orgId_settingKey: {
                orgId: user.orgId,
                settingKey: 'org_logo',
              },
            },
            create: {
              orgId: user.orgId,
              settingKey: 'org_logo',
              valuePlain: logo,
            },
            update: {
              valuePlain: logo,
            },
          });
        }

        logger.info(`Organization updated: ${org.name} by ${user.email}`);

        // Fetch updated logo state
        const logoSetting = await prisma.appSetting.findUnique({
          where: {
            orgId_settingKey: {
              orgId: user.orgId,
              settingKey: 'org_logo',
            },
          },
        });

        return {
          ...org,
          logo: logoSetting ? logoSetting.valuePlain : null,
        };
      } catch (err) {
        logger.error('Failed to update organization details:', err);
        return reply.status(500).send({ error: 'Failed to update organization' });
      }
    },
  );

  // GET /api/v1/organization/backups — list available backups (owner only)
  app.get(
    '/api/v1/organization/backups',
    { preHandler: requireRole('owner') },
    async (request, reply) => {
      try {
        if (!fs.existsSync(BACKUPS_DIR)) {
          return { backups: [] };
        }

        const backups: any[] = [];

        // Recursively scan BACKUPS_DIR to support flat or subdirectory structures (e.g. daily, weekly, monthly, last)
        const scanDir = (dirPath: string, subDirPrefix: string = '') => {
          if (!fs.existsSync(dirPath)) return;
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stats = fs.statSync(fullPath);
            if (stats.isFile() && (item.endsWith('.sql.gz') || item.endsWith('.sql') || item.endsWith('.txt'))) {
              backups.push({
                filename: subDirPrefix ? `${subDirPrefix}/${item}` : item,
                size: stats.size, // in bytes
                createdAt: stats.birthtime || stats.mtime,
              });
            } else if (stats.isDirectory() && ['daily', 'last', 'weekly', 'monthly'].includes(item)) {
              scanDir(fullPath, item);
            }
          }
        };

        scanDir(BACKUPS_DIR);
        backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first

        return { backups };
      } catch (err) {
        logger.error('[backups] Failed to list backups:', err);
        return reply.status(500).send({ error: 'Failed to list backups' });
      }
    }
  );

  // GET /api/v1/organization/backups/* — download a backup file (owner only)
  app.get(
    '/api/v1/organization/backups/*',
    { preHandler: requireRole('owner') },
    async (request, reply) => {
      const wildcard = (request.params as any)['*'];
      if (!wildcard) {
        return reply.status(400).send({ error: 'Missing filename' });
      }

      // Prevent directory traversal attacks
      const safePath = path.normalize(wildcard).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(BACKUPS_DIR, safePath);

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'Backup file not found' });
      }

      try {
        const fileStream = fs.createReadStream(filePath);
        const safeFilename = path.basename(filePath);
        reply.header('Content-Type', 'application/gzip');
        reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
        return reply.send(fileStream);
      } catch (err) {
        logger.error(`[backups] Failed to download backup ${wildcard}:`, err);
        return reply.status(500).send({ error: 'Failed to download backup' });
      }
    }
  );

  // GET /api/v1/organization/office-ip — get company IP settings
  app.get(
    '/api/v1/organization/office-ip',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const setting = await prisma.appSetting.findUnique({
          where: {
            orgId_settingKey: {
              orgId: user.orgId,
              settingKey: 'office_ip',
            },
          },
        });
        return { officeIp: setting ? setting.valuePlain : null };
      } catch (err) {
        logger.error('Failed to fetch office IP:', err);
        return reply.status(500).send({ error: 'Failed to fetch office IP' });
      }
    }
  );

  // PUT /api/v1/organization/office-ip — update company IP settings (owner and admin)
  app.put(
    '/api/v1/organization/office-ip',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { officeIp } = request.body as { officeIp: string | null };
      
      try {
        if (officeIp === null || officeIp === '') {
          await prisma.appSetting.deleteMany({
            where: {
              orgId: user.orgId,
              settingKey: 'office_ip',
            },
          });
        } else {
          await prisma.appSetting.upsert({
            where: {
              orgId_settingKey: {
                orgId: user.orgId,
                settingKey: 'office_ip',
              },
            },
            create: {
              orgId: user.orgId,
              settingKey: 'office_ip',
              valuePlain: officeIp.trim(),
            },
            update: {
              valuePlain: officeIp.trim(),
            },
          });
        }

        // Log setting update in activity log
        await prisma.activityLog.create({
          data: {
            orgId: user.orgId,
            userId: user.id,
            action: 'update_office_ip',
            entityType: 'setting',
            details: { officeIp: officeIp?.trim() || null }
          }
        });

        logger.info(`Office IP updated to [${officeIp}] by ${user.email}`);
        return { success: true, officeIp: officeIp?.trim() || null };
      } catch (err) {
        logger.error('Failed to update office IP:', err);
        return reply.status(500).send({ error: 'Failed to update office IP' });
      }
    }
  );

  // GET /api/v1/organization/work-hours — get company work-hours settings
  app.get(
    '/api/v1/organization/work-hours',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const settings = await prisma.appSetting.findMany({
          where: {
            orgId: user.orgId,
            settingKey: {
              in: ['attendance_check_in_time', 'attendance_check_out_time'],
            },
          },
        });
        const checkIn = settings.find(s => s.settingKey === 'attendance_check_in_time')?.valuePlain || '08:05';
        const checkOut = settings.find(s => s.settingKey === 'attendance_check_out_time')?.valuePlain || '17:30';
        return { checkInTime: checkIn, checkOutTime: checkOut };
      } catch (err) {
        logger.error('Failed to fetch office work hours:', err);
        return reply.status(500).send({ error: 'Failed to fetch work hours' });
      }
    }
  );

  // PUT /api/v1/organization/work-hours — update company work-hours settings (owner and admin)
  app.put(
    '/api/v1/organization/work-hours',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { checkInTime, checkOutTime } = request.body as { checkInTime: string; checkOutTime: string };

      if (!checkInTime || !checkOutTime) {
        return reply.status(400).send({ error: 'Giờ check-in và check-out là bắt buộc.' });
      }

      try {
        await prisma.$transaction([
          prisma.appSetting.upsert({
            where: {
              orgId_settingKey: {
                orgId: user.orgId,
                settingKey: 'attendance_check_in_time',
              },
            },
            create: {
              orgId: user.orgId,
              settingKey: 'attendance_check_in_time',
              valuePlain: checkInTime.trim(),
            },
            update: {
              valuePlain: checkInTime.trim(),
            },
          }),
          prisma.appSetting.upsert({
            where: {
              orgId_settingKey: {
                orgId: user.orgId,
                settingKey: 'attendance_check_out_time',
              },
            },
            create: {
              orgId: user.orgId,
              settingKey: 'attendance_check_out_time',
              valuePlain: checkOutTime.trim(),
            },
            update: {
              valuePlain: checkOutTime.trim(),
            },
          }),
        ]);

        await prisma.activityLog.create({
          data: {
            orgId: user.orgId,
            userId: user.id,
            action: 'update_work_hours',
            entityType: 'setting',
            details: { checkInTime, checkOutTime }
          }
        });

        logger.info(`Office work hours updated to Check-in: [${checkInTime}], Check-out: [${checkOutTime}] by ${user.email}`);
        return { success: true, checkInTime: checkInTime.trim(), checkOutTime: checkOutTime.trim() };
      } catch (err) {
        logger.error('Failed to update work hours:', err);
        return reply.status(500).send({ error: 'Failed to update work hours' });
      }
    }
  );
}

