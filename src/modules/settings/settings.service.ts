import { prisma } from '../../config/prisma';
import type { UpdateSalonSettingsInput } from './settings.schema';

const SETTINGS_SELECT = {
  salonName: true,
  cancellationWindowHrs: true,
  loyaltyPointsPerVisit: true,
  slotBufferMinutes: true,
  openingHours: true,
  updatedAt: true,
} as const;

/** The settings table has one persistent singleton row. */
export async function getSalonSettings() {
  return prisma.salonSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
    select: SETTINGS_SELECT,
  });
}

export async function updateSalonSettings(input: UpdateSalonSettingsInput) {
  return prisma.salonSetting.upsert({
    where: { id: 1 },
    update: input,
    create: { id: 1, ...input },
    select: SETTINGS_SELECT,
  });
}
