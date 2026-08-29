import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';
import { formatDateTime, notifyAdminsAsync, notifyUserAsync } from '../notifications/notifier';
import {
  LEAD_MINUTES,
  SLOT_STEP_MIN,
  atMinutes,
  dayBase,
  isExclusionViolation,
  minutesOfDay,
  minutesToLabel,
  slotFits,
} from './bookings.utils';
import type {
  CreateAppointmentInput,
  StatusUpdateInput,
  WalkInInput,
} from './bookings.schema';

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'] as const;

const APPT_INCLUDE = {
  customer: { select: { id: true, fullName: true, email: true } },
  staffProfile: { select: { id: true, user: { select: { fullName: true } } } },
  service: { select: { id: true, name: true, baseDurationMin: true } },
  review: { select: { id: true } },
} as const;
// NOTE: include returns ALL scalar columns too, so cancellation fields
// (cancelledBy/cancelReason/cancelledAt) are present at runtime even though
// they are not listed here — they're declared on the type below.

type AppointmentWithRelations = {
  id: string;
  status: string;
  source: string;
  scheduledFor: Date;
  endsAt: Date;
  priceCharged: { toNumber(): number };
  notes: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  customer: { id: string; fullName: string; email: string };
  staffProfile: { id: string; user: { fullName: string } };
  service: { id: string; name: string; baseDurationMin: number };
  review: { id: string } | null;
};

function serialize(a: AppointmentWithRelations) {
  return {
    id: a.id,
    status: a.status,
    source: a.source,
    scheduledFor: a.scheduledFor.toISOString(),
    endsAt: a.endsAt.toISOString(),
    priceCharged: a.priceCharged.toNumber(),
    notes: a.notes,
    customer: { id: a.customer.id, fullName: a.customer.fullName },
    staff: { id: a.staffProfile.id, fullName: a.staffProfile.user.fullName },
    service: { id: a.service.id, name: a.service.name, durationMin: a.service.baseDurationMin },
    hasReview: a.review !== null,
    ...(a.cancelledAt
      ? {
          cancelledBy: a.cancelledBy,
          cancelReason: a.cancelReason,
          cancelledAt: a.cancelledAt.toISOString(),
        }
      : {}),
  };
}

const CANCEL_FIELDS_SELECT = {
  cancelledBy: true,
  cancelReason: true,
  cancelledAt: true,
} as const;

async function getSettings() {
  const s = await prisma.salonSetting.findUnique({ where: { id: 1 } });
  return {
    cancellationWindowHrs: s?.cancellationWindowHrs ?? 2,
    loyaltyPointsPerVisit: s?.loyaltyPointsPerVisit ?? 10,
    slotBufferMinutes: s?.slotBufferMinutes ?? 15,
  };
}

/** Staff profiles that are active, bookable, offer the service and have a shift that weekday. */
async function eligibleStaff(serviceId: string, staffId?: string, weekday?: number) {
  return prisma.staffProfile.findMany({
    where: {
      isActive: true,
      isBookable: true,
      ...(staffId ? { id: staffId } : {}),
      services: { some: { serviceId } },
      ...(weekday !== undefined ? { workingHours: { some: { weekday } } } : {}),
    },
    select: {
      id: true,
      user: { select: { fullName: true } },
      workingHours: {
        ...(weekday !== undefined ? { where: { weekday } } : {}),
        select: { weekday: true, startMinute: true, endMinute: true },
      },
    },
  });
}

async function busyFor(staffId: string, dayStart: Date, dayEnd: Date) {
  const [appointments, timeOff] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        staffProfileId: staffId,
        status: { in: [...ACTIVE_STATUSES] },
        scheduledFor: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: { id: true, scheduledFor: true, endsAt: true },
    }),
    prisma.timeOff.findMany({
      where: { staffProfileId: staffId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  return { appointments, timeOff };
}

/**
 * Is [start, end] bookable for this stylist right now?
 * Optionally ignores one appointment (reschedule).
 */
async function slotAvailable(
  staffId: string,
  start: Date,
  end: Date,
  bufferMin: number,
  ignoreAppointmentId?: string,
): Promise<boolean> {
  const shift = await prisma.workingHours.findFirst({
    where: { staffProfileId: staffId, weekday: start.getDay() },
    select: { startMinute: true, endMinute: true },
  });

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { appointments, timeOff } = await busyFor(staffId, dayStart, dayEnd);

  return slotFits(start, end, {
    shift,
    appointments: appointments
      .filter((a: (typeof appointments)[number]) => a.id !== ignoreAppointmentId)
      .map((a: (typeof appointments)[number]) => ({ start: a.scheduledFor, end: a.endsAt })),
    timeOff: timeOff.map((t: (typeof timeOff)[number]) => ({
      start: t.startsAt,
      end: t.endsAt,
    })),
    bufferMin,
  });
}

function validateFutureOrThrow(start: Date, allowImmediate = false): void {
  if (Number.isNaN(start.getTime())) throw ApiError.badRequest('Invalid date/time');
  const earliest = allowImmediate
    ? dayBase(new Date().toISOString().slice(0, 10)).getTime()
    : Date.now() + LEAD_MINUTES * 60_000;
  if (start.getTime() < earliest) {
    throw ApiError.badRequest(
      allowImmediate
        ? 'Walk-in time must be today or in the future'
        : `Bookings need at least ${LEAD_MINUTES} minutes notice`,
    );
  }
}

// ────────────────────── Availability (public) ──────────────────────

export async function getAvailability(serviceId: string, dateStr: string, staffId?: string) {
  const svc = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { baseDurationMin: true, isActive: true },
  });
  if (!svc || !svc.isActive) throw ApiError.notFound('Service not found');

  const weekday = dayBase(dateStr).getDay();
  const settings = await getSettings();
  const durationMs = svc.baseDurationMin * 60_000;

  const staff = await eligibleStaff(serviceId, staffId, weekday);

  const dayStart = dayBase(dateStr);
  const dayEnd = atMinutes(dateStr, 1440);
  const earliest = Date.now() + LEAD_MINUTES * 60_000;

  const perStaff: Array<{ staffId: string; fullName: string; slots: string[] }> = [];
  const merged = new Set<string>();

  for (const st of staff) {
    const shift = st.workingHours[0];
    if (!shift) continue;

    const { appointments, timeOff } = await busyFor(st.id, dayStart, dayEnd);
    const slots: string[] = [];

    for (
      let m = shift.startMinute;
      m + svc.baseDurationMin <= shift.endMinute;
      m += SLOT_STEP_MIN
    ) {
      const s = atMinutes(dateStr, m);
      const e = new Date(s.getTime() + durationMs);
      if (s.getTime() < earliest) continue;
      if (
        !slotFits(s, e, {
          shift,
          appointments: appointments.map((a: (typeof appointments)[number]) => ({
            start: a.scheduledFor,
            end: a.endsAt,
          })),
          timeOff: timeOff.map((t: (typeof timeOff)[number]) => ({
            start: t.startsAt,
            end: t.endsAt,
          })),
          bufferMin: settings.slotBufferMinutes,
        })
      )
        continue;
      const label = minutesToLabel(m);
      slots.push(label);
      merged.add(label);
    }

    if (slots.length > 0 || staffId) {
      perStaff.push({ staffId: st.id, fullName: st.user.fullName, slots });
    }
  }

  return {
    date: dateStr,
    serviceId,
    durationMin: svc.baseDurationMin,
    bufferMin: settings.slotBufferMinutes,
    staffCount: staff.length,
    slots: [...merged].sort(),
    perStaff,
  };
}

// ────────────────────── Customer booking ───────────────────────

export async function createAppointment(customerId: string, input: CreateAppointmentInput) {
  const svc = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { basePrice: true, baseDurationMin: true, isActive: true },
  });
  if (!svc || !svc.isActive) throw ApiError.notFound('Service not found');

  const start = new Date(input.scheduledFor);
  const end = new Date(start.getTime() + svc.baseDurationMin * 60_000);
  validateFutureOrThrow(start);

  const settings = await getSettings();
  const candidates = await eligibleStaff(input.serviceId, input.staffId);

  let chosenId: string | null = null;
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await slotAvailable(c.id, start, end, settings.slotBufferMinutes)) {
      chosenId = c.id;
      break;
    }
  }

  if (!chosenId) {
    throw ApiError.conflict(
      input.staffId
        ? 'That stylist is not available at the selected time'
        : 'No stylist is available at that time',
    );
  }

  const link = await prisma.staffService.findUnique({
    where: { staffProfileId_serviceId: { staffProfileId: chosenId, serviceId: input.serviceId } },
    select: { customPrice: true },
  });

  try {
    const created = await prisma.appointment.create({
      data: {
        customerId,
        staffProfileId: chosenId,
        serviceId: input.serviceId,
        scheduledFor: start,
        endsAt: end,
        status: 'CONFIRMED', // instant confirmation — no approval loop for MVP
        source: 'APP',
        priceCharged: link?.customPrice ?? svc.basePrice,
        notes: input.notes,
      },
      include: APPT_INCLUDE,
    });

    notifyUserAsync(customerId, {
      title: 'Appointment booked ✨',
      body: `${created.service.name} with ${created.staffProfile.user.fullName} · ${formatDateTime(created.scheduledFor)}`,
      data: { appointmentId: created.id, type: 'booking_created' },
    });
    notifyUserAsync(created.staffProfileId, {
      title: 'New appointment',
      body: `${created.customer.fullName} booked ${created.service.name} · ${formatDateTime(created.scheduledFor)}`,
      data: { appointmentId: created.id, type: 'booking_created' },
    });
    notifyAdminsAsync({
      title: 'New appointment',
      body: `${created.customer.fullName} booked ${created.service.name} · ${formatDateTime(created.scheduledFor)}`,
      data: { appointmentId: created.id, type: 'booking_created' },
    });

    return serialize(created as AppointmentWithRelations);
  } catch (err) {
    // Race safety net: two customers hitting "book" simultaneously.
    if (isExclusionViolation(err)) {
      throw ApiError.conflict('That time was just taken — please pick another slot');
    }
    throw err;
  }
}

export async function listAppointments(user: NonNullable<AuthenticatedUser>, filters: { status?: string; date?: string }) {
  const scope =
    user.role === 'CUSTOMER'
      ? { customerId: user.id }
      : user.role === 'STAFF'
        ? { staffProfileId: user.id }
        : {}; // ADMIN sees everything

  const appts = await prisma.appointment.findMany({
    where: {
      ...scope,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.date
        ? {
            scheduledFor: {
              gte: dayBase(filters.date),
              lt: atMinutes(filters.date, 1440),
            },
          }
        : {}),
    },
    orderBy: { scheduledFor: 'asc' },
    include: APPT_INCLUDE,
  });
  return appts.map((a: (typeof appts)[number]) => serialize(a as AppointmentWithRelations));
}

export async function getAppointmentDetail(user: NonNullable<AuthenticatedUser>, id: string) {
  const apt = await prisma.appointment.findUnique({ where: { id }, include: APPT_INCLUDE });
  if (!apt) throw ApiError.notFound('Appointment not found');

  const allowed =
    user.role === 'ADMIN' ||
    apt.customerId === user.id ||
    (user.role === 'STAFF' && apt.staffProfileId === user.id);
  if (!allowed) throw ApiError.forbidden('You cannot view this appointment');

  return serialize(apt as AppointmentWithRelations);
}

// ────────────────────── Cancel & reschedule ─────────────────────

export async function cancelAppointment(
  user: NonNullable<AuthenticatedUser>,
  id: string,
  reason?: string,
) {
  const apt = await prisma.appointment.findUnique({ where: { id } });
  if (!apt) throw ApiError.notFound('Appointment not found');
  if (apt.status !== 'PENDING' && apt.status !== 'CONFIRMED') {
    throw ApiError.conflict(`Cannot cancel an appointment that is already ${apt.status}`);
  }

  const isOwner = apt.customerId === user.id;
  const isAssignedStaff = user.role === 'STAFF' && apt.staffProfileId === user.id;
  const isAdmin = user.role === 'ADMIN';
  if (!isOwner && !isAssignedStaff && !isAdmin) {
    throw ApiError.forbidden('You cannot cancel this appointment');
  }

  // Customers must respect the free-cancellation window; staff/admin always can.
  if (isOwner && !isAdmin && !isAssignedStaff) {
    const { cancellationWindowHrs } = await getSettings();
    const deadline =
      apt.scheduledFor.getTime() - cancellationWindowHrs * 3_600_000;
    if (Date.now() > deadline) {
      throw ApiError.conflict(
        `Free cancellation ended ${cancellationWindowHrs}h before the appointment — please call the salon`,
      );
    }
  }

  const cancelledBy = user.role === 'CUSTOMER' ? 'CUSTOMER' : user.role;

  const updated = await prisma.appointment
    .update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledBy,
        cancelReason: reason ?? null,
        cancelledAt: new Date(),
      },
      include: APPT_INCLUDE,
    })
    .then((a) => serialize(a as AppointmentWithRelations));

  // Tell the party that didn't perform the cancellation.
  if (cancelledBy === 'CUSTOMER') {
    notifyUserAsync(apt.staffProfileId, {
      title: 'Booking cancelled',
      body: `${apt.customerId === user.id ? 'A customer' : 'Customer'} cancelled ${formatDateTime(apt.scheduledFor)} — slot is free again`,
      data: { appointmentId: apt.id, type: 'booking_cancelled' },
    });
  } else {
    notifyUserAsync(apt.customerId, {
      title: 'Appointment cancelled',
      body: `Your booking on ${formatDateTime(apt.scheduledFor)} was cancelled by the salon${reason ? ` — ${reason}` : ''}`,
      data: { appointmentId: apt.id, type: 'booking_cancelled' },
    });
  }

  return updated;
}

export async function rescheduleAppointment(
  userId: string,
  id: string,
  newScheduledFor: string,
) {
  const apt = await prisma.appointment.findUnique({ where: { id } });
  if (!apt) throw ApiError.notFound('Appointment not found');
  if (apt.customerId !== userId) throw ApiError.forbidden('You can only reschedule your own bookings');
  if (apt.status !== 'PENDING' && apt.status !== 'CONFIRMED') {
    throw ApiError.conflict(`Cannot reschedule an appointment that is ${apt.status}`);
  }

  const { cancellationWindowHrs, slotBufferMinutes } = await getSettings();
  const deadline = apt.scheduledFor.getTime() - cancellationWindowHrs * 3_600_000;
  if (Date.now() > deadline) {
    throw ApiError.conflict(
      `Free rescheduling ended ${cancellationWindowHrs}h before the appointment`,
    );
  }

  const start = new Date(newScheduledFor);
  validateFutureOrThrow(start);

  const svc = await prisma.service.findUnique({
    where: { id: apt.serviceId },
    select: { baseDurationMin: true },
  });
  if (!svc) throw ApiError.notFound('Service no longer exists');
  const end = new Date(start.getTime() + svc.baseDurationMin * 60_000);

  const free = await slotAvailable(apt.staffProfileId, start, end, slotBufferMinutes, apt.id);
  if (!free) throw ApiError.conflict('The stylist is not available at that new time');

  try {
    const updated = await prisma.appointment.update({
      where: { id: apt.id },
      data: { scheduledFor: start, endsAt: end },
      include: APPT_INCLUDE,
    });

    notifyUserAsync(apt.staffProfileId, {
      title: 'Appointment rescheduled',
      body: `Moved to ${formatDateTime(start)}`,
      data: { appointmentId: apt.id, type: 'booking_rescheduled' },
    });

    return serialize(updated as AppointmentWithRelations);
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw ApiError.conflict('That time was just taken — please pick another slot');
    }
    throw err;
  }
}

// ────────────────────── Staff tools ─────────────────────────────

export async function addWalkIn(actor: NonNullable<AuthenticatedUser>, input: WalkInInput) {
  // Resolve or create the customer
  let customerId = input.customerId ?? null;
  if (!customerId) {
    const guest = await prisma.user.create({
      data: {
        fullName: input.customerName!,
        phone: input.phone,
        email: `walkin.${crypto.randomUUID()}@guest.local`,
        role: 'CUSTOMER',
      },
      select: { id: true },
    });
    customerId = guest.id;
  }

  const svc = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { basePrice: true, baseDurationMin: true, isActive: true },
  });
  if (!svc || !svc.isActive) throw ApiError.notFound('Service not found');

  const staffId = actor.role === 'ADMIN' ? input.staffId : (input.staffId ?? actor.id);
  if (!staffId) throw ApiError.badRequest('staffId is required for admin walk-ins');

  const profile = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    select: { isActive: true },
  });
  if (!profile || !profile.isActive) throw ApiError.notFound('Stylist not found');

  const start = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
  // Walk-ins skip the lead-time rule but still respect working hours & collisions.
  validateFutureOrThrow(start, true);
  const end = new Date(start.getTime() + svc.baseDurationMin * 60_000);

  const settings = await getSettings();
  const free = await slotAvailable(staffId, start, end, settings.slotBufferMinutes);
  if (!free) throw ApiError.conflict('The stylist is booked during that time');

  const link = await prisma.staffService.findUnique({
    where: { staffProfileId_serviceId: { staffProfileId: staffId, serviceId: input.serviceId } },
    select: { customPrice: true },
  });

  try {
    const created = await prisma.appointment.create({
      data: {
        customerId,
        staffProfileId: staffId,
        serviceId: input.serviceId,
        scheduledFor: start,
        endsAt: end,
        status: 'CONFIRMED',
        source: 'WALK_IN',
        priceCharged: link?.customPrice ?? svc.basePrice,
        notes: input.notes,
      },
      include: APPT_INCLUDE,
    });

    notifyUserAsync(customerId, {
      title: 'Welcome in! 💅',
      body: `${created.service.name} with ${created.staffProfile.user.fullName} — see you shortly`,
      data: { appointmentId: created.id, type: 'walk_in' },
    });

    return serialize(created as AppointmentWithRelations);
  } catch (err) {
    if (isExclusionViolation(err)) throw ApiError.conflict('Slot just taken');
    throw err;
  }
}

export async function updateStatus(
  actor: NonNullable<AuthenticatedUser>,
  id: string,
  input: StatusUpdateInput,
) {
  const TRANSITIONS: Record<string, string[]> = {
    PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
    CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  };

  const apt = await prisma.appointment.findUnique({ where: { id } });
  if (!apt) throw ApiError.notFound('Appointment not found');
  if (actor.role === 'STAFF' && apt.staffProfileId !== actor.id) {
    throw ApiError.forbidden('You can only update appointments assigned to you');
  }
  if (!TRANSITIONS[apt.status]?.includes(input.status)) {
    throw ApiError.conflict(`Illegal transition: ${apt.status} → ${input.status}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomic gate: only one caller gets to flip the status (row lock).
    const gate = await tx.appointment.updateMany({
      where: { id, status: apt.status },
      data: {
        status: input.status,
        ...(input.status === 'CANCELLED'
          ? {
              cancelledBy: actor.role,
              cancelReason: input.reason ?? null,
              cancelledAt: new Date(),
            }
          : {}),
      },
    });
    if (gate.count === 0) {
      throw ApiError.conflict('Status was just changed by someone else');
    }

    // Completing a visit earns loyalty points — awarded exactly once.
    if (input.status === 'COMPLETED') {
      const alreadyAwarded = await tx.loyaltyTransaction.findFirst({
        where: { appointmentId: id, type: 'EARNED' },
        select: { id: true },
      });
      if (!alreadyAwarded) {
        const pointsPerVisit = (await tx.salonSetting.findUnique({ where: { id: 1 } }))
          ?.loyaltyPointsPerVisit ?? 10;
        await tx.loyaltyTransaction.create({
          data: {
            customerId: apt.customerId,
            appointmentId: id,
            points: pointsPerVisit,
            type: 'EARNED',
            description: 'Visit completed',
          },
        });
      }
    }

    return tx.appointment.findUnique({ where: { id }, include: APPT_INCLUDE });
  });

  const done = serialize(result as AppointmentWithRelations);

  if (input.status === 'COMPLETED') {
    notifyUserAsync(apt.customerId, {
      title: 'Visit completed 💖',
      body: 'Thanks for coming! Loyalty points have been added to your account.',
      data: { appointmentId: apt.id, type: 'visit_completed' },
    });
  } else if (input.status === 'CANCELLED') {
    notifyUserAsync(apt.customerId, {
      title: 'Appointment cancelled',
      body: `Your booking on ${formatDateTime(apt.scheduledFor)} was cancelled by the salon${input.reason ? ` — ${input.reason}` : ''}`,
      data: { appointmentId: apt.id, type: 'booking_cancelled' },
    });
  }

  return done;
}

export async function getSchedule(
  actor: NonNullable<AuthenticatedUser>,
  dateStr: string,
  staffIdParam?: string,
) {
  let targetId: string;
  if (actor.role === 'STAFF') {
    targetId = actor.id;
  } else if (staffIdParam) {
    targetId = staffIdParam;
  } else {
    throw ApiError.badRequest('staffId is required when viewing schedule as admin');
  }

  const profile = await prisma.staffProfile.findUnique({
    where: { id: targetId },
    select: { isActive: true, user: { select: { fullName: true } } },
  });
  if (!profile || !profile.isActive) throw ApiError.notFound('Stylist not found');

  const appts = await prisma.appointment.findMany({
    where: {
      staffProfileId: targetId,
      scheduledFor: { gte: dayBase(dateStr), lt: atMinutes(dateStr, 1440) },
      status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
    },
    orderBy: { scheduledFor: 'asc' },
    include: APPT_INCLUDE,
  });

  const items = appts.map((a: (typeof appts)[number]) =>
    serialize(a as AppointmentWithRelations));
  return {
    date: dateStr,
    staff: { id: targetId, fullName: profile.user.fullName },
    summary: {
      total: items.length,
      walkIns: items.filter((i) => i.source === 'WALK_IN').length,
    },
    items,
  };
}
