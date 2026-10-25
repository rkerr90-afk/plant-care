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

/** The user's latest answer for a plant. null = nothing chosen yet. */
export type Flag = 'watered' | 'bone_dry' | 'still_moist' | null;

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

// ---------- Weather (outdoor plants) ----------

export type DayWeather = { date: string; rain_mm: number; tmax: number; tmin: number };
/** Recent and forecast days, plus the forecast low between this evening and tomorrow morning. */
export type Weather = { days: DayWeather[]; lowTonight: number | null };

export const RAIN_SKIP_MM = 5; // this much rain over 48 hours counts as a watering
export const HOT_C = 25;
export const VERY_HOT_C = 30;

type WeatherPlant = {
  setting: 'indoor' | 'outdoor';
  exposure: 'exposed' | 'sheltered' | null;
  next_due_on: string | null;
  last_watered_on: string | null;
};

/**
 * The due date after weather. Only outdoor plants change.
 * - Rain: if the pot is exposed and 5 mm or more fell in the last 48 hours (today included), nature did the
 *   watering. The check moves to two days after the last rain, unless you watered since.
 * - Heat: after two days of 25 C or more with almost no rain, the check comes a day sooner (two at 30 C).
 */
export function adjustedDue(plant: WeatherPlant, weather: Weather | null, today: string): { date: string | null; note: string | null } {
  const due = plant.next_due_on;
  if (!due || plant.setting !== 'outdoor' || !weather) return { date: due, note: null };

  const recent = weather.days.filter((d) => d.date >= addDays(today, -2) && d.date <= today);
  const rainTotal = recent.reduce((n, d) => n + d.rain_mm, 0);

  if (plant.exposure !== 'sheltered' && rainTotal >= RAIN_SKIP_MM) {
    const wet = recent.filter((d) => d.rain_mm >= 1).map((d) => d.date);
    const lastRain = wet[wet.length - 1];
    const watered = plant.last_watered_on && lastRain && plant.last_watered_on >= lastRain;
    if (lastRain && !watered) {
      const candidate = addDays(lastRain, 2);
      if (candidate > due) return { date: candidate, note: `Rain: about ${Math.round(rainTotal)} mm in the last two days` };
      return { date: due, note: null };
    }
  }

  const todayW = recent.find((d) => d.date === today);
  const yest = recent.find((d) => d.date === addDays(today, -1));
  if (todayW && yest && todayW.tmax >= HOT_C && yest.tmax >= HOT_C && rainTotal < 2) {
    const sooner = addDays(due, todayW.tmax >= VERY_HOT_C ? -2 : -1);
    const date = sooner < today ? (due < today ? due : today) : sooner;
    if (date < due) return { date, note: 'Hot, dry spell: checking sooner' };
  }
  return { date: due, note: null };
}

/** True when tonight's forecast low is too cold for an outdoor plant. */
export function frostRisk(plant: { setting: 'indoor' | 'outdoor'; exposure: 'exposed' | 'sheltered' | null }, minTempC: number, lowTonight: number | null): boolean {
  if (plant.setting !== 'outdoor' || lowTonight === null || !Number.isFinite(minTempC)) return false;
  const margin = plant.exposure === 'sheltered' ? -1 : 1;
  return lowTonight <= minTempC + margin;
}

// ---------- Away mode ----------

export type AwayPhase = 'none' | 'upcoming' | 'away' | 'returned';

/** upcoming = leaving within a week; away = between the dates; returned = the 3 days after you are back. */
export function awayPhase(from: string | null, until: string | null, today: string): AwayPhase {
  if (!from || !until) return 'none';
  if (today < from) return daysBetween(today, from) <= 7 ? 'upcoming' : 'none';
  if (today <= until) return 'away';
  return daysBetween(until, today) <= 3 ? 'returned' : 'none';
}

/** How badly a plant is hurting: days overdue as a share of its normal interval. Bigger is worse. */
export function riskScore(nextDue: string | null, intervalDays: number, today: string): number {
  if (!nextDue) return 0;
  return daysBetween(nextDue, today) / Math.max(1, intervalDays);
}

// ---------- Health check ----------

export type WateringChange = 'none' | 'water_less' | 'water_more';

/**
 * A diagnosis can say the watering itself is the problem.
 * - water_less (root rot, soggy soil): stretch the interval by a fifth and wait at least 3 days.
 * - water_more (crispy, drooping from thirst): shorten it a little and check the soil today.
 */
export function applyWateringChange(
  change: WateringChange,
  factor: number,
  nextDue: string | null,
  today: string,
): { feedback_factor: number; next_due_on: string | null } {
  if (change === 'water_less') {
    const wait = addDays(today, 3);
    return { feedback_factor: clamp(round2(factor * 1.2), FEEDBACK_MIN, FEEDBACK_MAX), next_due_on: !nextDue || nextDue < wait ? wait : nextDue };
  }
  if (change === 'water_more') {
    return { feedback_factor: clamp(round2(factor * 0.85), FEEDBACK_MIN, FEEDBACK_MAX), next_due_on: today };
  }
  return { feedback_factor: factor, next_due_on: nextDue };
}

export type CheckInOutcome = 'better' | 'same' | 'worse' | 'resolved';

/**
 * When to look again after a check-in. Follows the treatment rhythm when there is one.
 * Better: relax to a week or the repeat gap. Same: the repeat gap. Worse: sooner, within 3 days.
 */
export function nextCheckDate(outcome: CheckInOutcome, repeatEveryDays: number | null, today: string, suggestedDays?: number): string | null {
  if (outcome === 'resolved') return null;
  const repeat = repeatEveryDays && repeatEveryDays > 0 ? repeatEveryDays : null;
  let days: number;
  if (outcome === 'better') days = Math.max(repeat ?? 7, 7);
  else if (outcome === 'same') days = repeat ?? 5;
  else days = Math.min(repeat ?? 3, 3);
  if (suggestedDays && suggestedDays > 0 && outcome !== 'better') days = Math.min(days, Math.round(suggestedDays));
  return addDays(today, clamp(days, 1, 21));
}

/** Four weeks without a fix: time to suggest something firmer. */
export function caseIsLong(openedOn: string, today: string): boolean {
  return daysBetween(openedOn, today) >= 28;
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
