import { prisma } from '../../config/prisma';
import { dayBase } from '../bookings/bookings.utils';

const DEFAULT_DAYS = 30;

function resolveRange(from?: string, to?: string) {
  const endBase = to ? dayBase(to) : (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const start = from
    ? dayBase(from)
    : new Date(endBase.getTime() - (DEFAULT_DAYS - 1) * 86_400_000);
  const end = new Date(endBase.getTime() + 86_400_000); // exclusive upper bound
  return { start, end };
}

const money = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;

type CompletedRow = { staffId: string; completed: number; revenue: number; minutes: number };
type CancelledRow = { staffId: string; cancelled: number };
type StaffUtilizationItem = {
  staffId: string;
  fullName: string;
  isActive: boolean;
  completedBookings: number;
  cancelledBookings: number;
  revenue: number;
  estimatedCommission: number;
  utilizationPct: number | null;
};

// ────────────────────────── Overview ─────────────────────────

export async function getOverview(from?: string, to?: string) {
  const { start, end } = resolveRange(from, to);
  const range = { scheduledFor: { gte: start, lt: end } };

  const [revenueAgg, byStatus, newCustomers] = await Promise.all([
    prisma.appointment.aggregate({
      where: { ...range, status: 'COMPLETED' },
      _sum: { priceCharged: true },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ['status'],
      where: range,
      _count: { _all: true },
    }),
    prisma.user.count({
      where: { role: 'CUSTOMER', createdAt: { gte: start, lt: end } },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    byStatus.map((s: (typeof byStatus)[number]) => [s.status as string, s._count._all]),
  );
  const totalBookings = byStatus.reduce(
    (acc: number, s: (typeof byStatus)[number]) => acc + s._count._all,
    0,
  );
  const completedBookings = revenueAgg._count._all;
  const revenue = money(revenueAgg._sum.priceCharged);

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    revenue,
    completedBookings,
    totalBookings,
    bookingsByStatus: statusCounts,
    newCustomers,
    averageTicket: completedBookings > 0 ? Number((revenue / completedBookings).toFixed(2)) : 0,
  };
}

// ─────────────────────── Revenue series ──────────────────────

export async function getRevenueSeries(
  groupBy: 'day' | 'month',
  from?: string,
  to?: string,
) {
  const { start, end } = resolveRange(from, to);

  // Bucketing by calendar period is a job for the database.
  const rows = await prisma.$queryRaw<{ period: Date; bookings: number; revenue: number }[]>`
    SELECT date_trunc(${groupBy}, scheduled_for) AS period,
           COUNT(*)::int AS bookings,
           COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN price_charged ELSE 0 END), 0)::float8 AS revenue
    FROM appointments
    WHERE scheduled_for >= ${start} AND scheduled_for < ${end}
    GROUP BY 1
    ORDER BY 1`;

  const series = rows.map((r: (typeof rows)[number]) => ({
    period: r.period.toISOString(),
    bookings: Number(r.bookings),
    revenue: Number(r.revenue),
  }));

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    groupBy,
    totalRevenue: series.reduce(
      (acc: number, s: (typeof series)[number]) => acc + s.revenue,
      0,
    ),
    totalBookings: series.reduce(
      (acc: number, s: (typeof series)[number]) => acc + s.bookings,
      0,
    ),
    series,
  };
}

// ──────────────────────── Top services ───────────────────────

export async function getTopServices(limit: number, from?: string, to?: string) {
  const { start, end } = resolveRange(from, to);

  const grouped = await prisma.appointment.groupBy({
    by: ['serviceId'],
    where: { status: 'COMPLETED', scheduledFor: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { priceCharged: true },
    orderBy: { _count: { serviceId: 'desc' } },
    take: limit,
  });

  const serviceIds = grouped.map((g: (typeof grouped)[number]) => g.serviceId);
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  const byId = new Map(services.map((s: (typeof services)[number]) => [s.id, s]));

  const items = grouped
    .map((g: (typeof grouped)[number]) => ({
      serviceId: g.serviceId,
      name: byId.get(g.serviceId)?.name ?? 'Unknown',
      category: byId.get(g.serviceId)?.category.name ?? 'Unknown',
      bookings: g._count._all,
      revenue: money(g._sum.priceCharged),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { items };
}

// ───────────────────── Staff performance ─────────────────────

interface RawStaffRow {
  staffId: string;
  completed: number;
  cancelled: number;
  revenue: number;
  minutes: number;
}

export async function getStaffPerformance(from?: string, to?: string) {
  const { start, end } = resolveRange(from, to);

  const [completedRows, cancelledRows, profiles] = await Promise.all([
    prisma.$queryRaw<CompletedRow[]>`
      SELECT staff_profile_id AS "staffId",
             COUNT(*)::int AS completed,
             COALESCE(SUM(price_charged), 0)::float8 AS revenue,
             COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - scheduled_for)) / 60), 0)::float8 AS minutes
      FROM appointments
      WHERE status = 'COMPLETED'
        AND scheduled_for >= ${start} AND scheduled_for < ${end}
      GROUP BY 1`,
    prisma.$queryRaw<CancelledRow[]>`
      SELECT staff_profile_id AS "staffId",
             COUNT(*)::int AS cancelled
      FROM appointments
      WHERE status = 'CANCELLED'
        AND scheduled_for >= ${start} AND scheduled_for < ${end}
      GROUP BY 1`,
    prisma.staffProfile.findMany({
      select: {
        id: true,
        commissionRate: true,
        isActive: true,
        user: { select: { fullName: true } },
        workingHours: { select: { startMinute: true, endMinute: true } },
      },
    }),
  ]);

  const completedByStaff = new Map(completedRows.map((r: CompletedRow) => [r.staffId, r]));
  const cancelledByStaff = new Map(cancelledRows.map((r: CancelledRow) => [r.staffId, r.cancelled]));

  const daysInRange = Math.max((end.getTime() - start.getTime()) / 86_400_000, 0.001);

  const staffWithWork = new Set([...completedByStaff.keys(), ...cancelledByStaff.keys()]);
  const relevantProfiles = profiles.filter(
    (p: (typeof profiles)[number]) => p.isActive || staffWithWork.has(p.id),
  );

  const items = relevantProfiles
    .map((p: (typeof profiles)[number]): StaffUtilizationItem => {
      const done = completedByStaff.get(p.id);
      const weeklyMinutes = p.workingHours.reduce(
        (acc: number, h: { startMinute: number; endMinute: number }) =>
          acc + (h.endMinute - h.startMinute),
        0,
      );
      const potentialMinutes = weeklyMinutes * (daysInRange / 7);
      const workedMinutes = done?.minutes ?? 0;

      return {
        staffId: p.id,
        fullName: p.user.fullName,
        isActive: p.isActive,
        completedBookings: done?.completed ?? 0,
        cancelledBookings: cancelledByStaff.get(p.id) ?? 0,
        revenue: done?.revenue ?? 0,
        estimatedCommission:
          Number((((done?.revenue ?? 0) * Number(p.commissionRate)) / 100).toFixed(2)),
        utilizationPct:
          potentialMinutes > 0
            ? Math.min(100, Math.round((workedMinutes / potentialMinutes) * 100))
            : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return { range: { from: start.toISOString(), to: end.toISOString() }, items };
}
