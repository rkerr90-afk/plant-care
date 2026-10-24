// Watering logic. Pure functions, no imports, so it can be unit-tested with plain Node.

export type CareProfile = {
  common_name: string;
  scientific_name: string;
  /** Days between waterings in active growth, for an average pot in medium light. */
  base_interval_days: number;
  /** Months (1-12) when the plant grows slowly and needs less water. */
  dormant_months: number[];
  /** How much to stretch the interval in dormant months, e.g. 1.5. */
  dormancy_multiplier: number;
  water_amount: 'soak' | 'moderate' | 'small';
  water_method: 'top' | 'bottom' | 'either';
  /** One line telling you how to water, shown on every reminder. */
  watering_instructions: string;
  /** How to check before watering, e.g. "Water when the top 3 cm of soil is dry". */
  soil_check: string;
  light_preference: string;
  toxic_to_pets: boolean;
  toxicity_note: string;
  /** Lowest temperature tolerated, °C. Used for frost alerts in phase 2. */
  min_temp_c: number;
  feeding: { months: number[]; every_weeks: number };
  care_summary: string;
};

export type PlantContext = {
  setting: 'indoor' | 'outdoor';
  light: 'bright_direct' | 'bright_indirect' | 'medium' | 'low' | null;
  near_heat: boolean;
  pot_material: 'plastic' | 'terracotta' | 'glazed' | 'other' | null;
  pot_size: 'small' | 'medium' | 'large' | null;
  feedback_factor: number;
};

export type LastWatered = 'today' | 'few_days' | 'week_plus' | 'not_sure';

const LIGHT: Record<string, number> = { bright_direct: 0.8, bright_indirect: 0.9, medium: 1, low: 1.3 };
const POT: Record<string, number> = { terracotta: 0.85, plastic: 1, glazed: 1, other: 1 };
const SIZE: Record<string, number> = { small: 0.85, medium: 1, large: 1.2 };
const HEATING_MONTHS = [10, 11, 12, 1, 2, 3, 4];

export const FEEDBACK_MIN = 0.5;
export const FEEDBACK_MAX = 2;

/** Days until the next watering, for a plant watered on the given date. */
export function wateringInterval(profile: CareProfile, plant: PlantContext, isoDate: string): number {
  const month = Number(isoDate.slice(5, 7));
  let days = profile.base_interval_days;
  days *= LIGHT[plant.light ?? 'medium'] ?? 1;
  days *= POT[plant.pot_material ?? 'plastic'] ?? 1;
  days *= SIZE[plant.pot_size ?? 'medium'] ?? 1;
  if (plant.setting === 'indoor' && plant.near_heat && HEATING_MONTHS.includes(month)) days *= 0.8;
  if (profile.dormant_months.includes(month)) days *= profile.dormancy_multiplier;
  days *= clamp(plant.feedback_factor, FEEDBACK_MIN, FEEDBACK_MAX);
  return Math.round(clamp(days, 1, 60));
}

/** First due date for a newly added plant, from when the user says they last watered it. */
export function firstDueDate(profile: CareProfile, plant: PlantContext, today: string, last: LastWatered): string {
  const interval = wateringInterval(profile, plant, today);
  switch (last) {
    case 'today':
      return addDays(today, interval);
    case 'few_days':
      return maxDate(today, addDays(today, interval - 3));
    default:
      return today; // unknown or long ago: check the soil today
  }
}

export type Feedback = 'watered' | 'still_moist' | 'bone_dry';

/**
 * Applies a button press.
 * - watered: you watered it. Next date follows the schedule.
 * - still_moist: you checked, soil is damp. Check again in 2 days; the interval was too short.
 * - bone_dry: you checked, it is very dry. It needs water now (due today) and the interval was too long.
 * Pressing the same button twice in a row does not nudge the schedule a second time, so tapping
 * around cannot drift it. Only a bone_dry or still_moist press changes the learned factor.
 */
export function applyFeedback(
  feedback: Feedback,
  profile: CareProfile,
  plant: PlantContext,
  today: string,
  opts: { repeat?: boolean } = {},
): { feedback_factor: number; next_due_on: string; watered: boolean } {
  let factor = plant.feedback_factor;
  if (!opts.repeat) {
    if (feedback === 'still_moist') factor = clamp(round2(factor * 1.1), FEEDBACK_MIN, FEEDBACK_MAX);
    if (feedback === 'bone_dry') factor = clamp(round2(factor * 0.9), FEEDBACK_MIN, FEEDBACK_MAX);
  }

  if (feedback === 'still_moist') {
    return { feedback_factor: factor, next_due_on: addDays(today, 2), watered: false };
  }
  if (feedback === 'bone_dry') {
    return { feedback_factor: factor, next_due_on: today, watered: false };
  }
  const interval = wateringInterval(profile, { ...plant, feedback_factor: factor }, today);
  return { feedback_factor: factor, next_due_on: addDays(today, interval), watered: true };
}

/** Forgets what the buttons taught the app and re-plans from the last watering. */
export function resetSchedule(
  profile: CareProfile,
  plant: PlantContext,
  lastWatered: string | null,
  today: string,
): { feedback_factor: number; next_due_on: string } {
  const from = lastWatered ?? today;
  const next = addDays(from, wateringInterval(profile, { ...plant, feedback_factor: 1 }, from));
  return { feedback_factor: 1, next_due_on: next < today ? today : next };
}

/** Today's date (YYYY-MM-DD) in a given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Current local time (HH:MM) in a given IANA time zone. */
export function timeIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const AMOUNT: Record<CareProfile['water_amount'], string> = {
  soak: 'Soak until water drains from the bottom',
  moderate: 'Water moderately',
  small: 'A small splash only',
};

/** Short "how to water" line for reminders. */
export function howToWater(profile: CareProfile): string {
  if (profile.watering_instructions) return profile.watering_instructions;
  const method = profile.water_method === 'bottom' ? ' (bottom-water)' : '';
  return `${AMOUNT[profile.water_amount]}${method}`;
}
