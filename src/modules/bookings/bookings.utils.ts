// Slot engine primitives — all times are SALON-LOCAL.
// Convention: clients send "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm" naive strings;
// the server interprets them in its own timezone (single-salon MVP: server
// runs in the salon's timezone).

export const SLOT_STEP_MIN = 15; // grid granularity for offered slots
export const LEAD_MINUTES = 60; // minimum notice before a booking can start

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** Midnight (00:00) of the given date, in server-local time. */
export function dayBase(dateStr: string): Date {
  if (!isDateString(dateStr)) throw new Error(`Bad date string: ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Date at N minutes past midnight of dateStr. */
export function atMinutes(dateStr: string, minutes: number): Date {
  const d = dayBase(dateStr);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

/** Minutes-since-midnight of a Date, in server-local time. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** "09:30" label from minutes-since-midnight. */
export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface BusyRange {
  start: Date;
  end: Date;
}

/**
 * True when candidate slot [slotStart, slotEnd] may be booked:
 * - inside the stylist's shift
 * - not overlapping time off
 * - not overlapping an active appointment, honoring the cleanup buffer AFTER
 *   every existing appointment (back-to-back before one is fine)
 */
export function slotFits(
  slotStart: Date,
  slotEnd: Date,
  opts: {
    shift?: { startMinute: number; endMinute: number } | null;
    appointments: BusyRange[];
    timeOff: BusyRange[];
    bufferMin: number;
  },
): boolean {
  const { shift, appointments, timeOff, bufferMin } = opts;

  if (!shift) return false;
  const startM = minutesOfDay(slotStart);
  const endM = minutesOfDay(slotEnd);
  if (startM < shift.startMinute || endM > shift.endMinute) return false;

  const msBuffer = bufferMin * 60_000;
  for (const a of appointments) {
    // overlap with the appointment itself
    if (slotStart < a.end && a.start < slotEnd) return false;
    // or inside the cleanup gap right after it
    if (slotStart < new Date(a.end.getTime() + msBuffer) && a.start < slotEnd) return false;
  }

  for (const o of timeOff) {
    if (slotStart < o.end && o.start < slotEnd) return false;
  }

  return true;
}

/**
 * Detects PostgreSQL exclusion-constraint violations (error SQLSTATE 23P01,
 * constraint `appointments_staff_no_overlap`) across driver error shapes.
 */
export function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  return (
    e?.code === '23P01' ||
    e?.cause?.code === '23P01' ||
    String(e?.message ?? '').includes('appointments_staff_no_overlap')
  );
}
