import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  applyFeedback,
  firstDueDate,
  resetSchedule,
  todayIn,
  timeIn,
  wateringInterval,
  type CareProfile,
  type PlantContext,
} from './care.ts';

const pothos: CareProfile = {
  common_name: 'Golden pothos',
  scientific_name: 'Epipremnum aureum',
  base_interval_days: 7,
  dormant_months: [11, 12, 1, 2],
  dormancy_multiplier: 1.5,
  water_amount: 'soak',
  water_method: 'top',
  watering_instructions: '',
  soil_check: 'Water when the top 3 cm is dry',
  light_preference: 'Bright indirect',
  toxic_to_pets: true,
  toxicity_note: 'Toxic to dogs and cats if chewed',
  min_temp_c: 10,
  feeding: { months: [4, 5, 6, 7, 8, 9], every_weeks: 4 },
  care_summary: '',
};

const base: PlantContext = {
  setting: 'indoor',
  light: 'medium',
  near_heat: false,
  pot_material: 'plastic',
  pot_size: 'medium',
  feedback_factor: 1,
};

test('base case in growing season equals species interval', () => {
  assert.equal(wateringInterval(pothos, base, '2026-06-15'), 7);
});

test('dormant months stretch the interval', () => {
  assert.equal(wateringInterval(pothos, base, '2026-12-15'), 11); // 7 * 1.5 = 10.5 -> 11
});

test('bright light, terracotta and radiator shorten it in winter', () => {
  const p = { ...base, light: 'bright_direct' as const, pot_material: 'terracotta' as const, near_heat: true };
  // 7 * 0.8 * 0.85 * 0.8 (heat) * 1.5 (dormant) = 5.71 -> 6
  assert.equal(wateringInterval(pothos, p, '2026-12-01'), 6);
});

test('radiator has no effect outdoors or in summer', () => {
  assert.equal(wateringInterval(pothos, { ...base, near_heat: true }, '2026-07-01'), 7);
  assert.equal(wateringInterval(pothos, { ...base, near_heat: true, setting: 'outdoor' }, '2026-03-01'), 7);
});

test('interval is clamped to 1..60 days', () => {
  const cactus = { ...pothos, base_interval_days: 50, dormancy_multiplier: 3 };
  assert.equal(wateringInterval(cactus, base, '2026-12-01'), 60);
  const fern = { ...pothos, base_interval_days: 1 };
  assert.equal(wateringInterval(fern, { ...base, light: 'bright_direct', pot_size: 'small' }, '2026-06-01'), 1);
});

test('first due date from last-watered answer', () => {
  assert.equal(firstDueDate(pothos, base, '2026-06-10', 'today'), '2026-06-17');
  assert.equal(firstDueDate(pothos, base, '2026-06-10', 'few_days'), '2026-06-14');
  assert.equal(firstDueDate(pothos, base, '2026-06-10', 'week_plus'), '2026-06-10');
  assert.equal(firstDueDate(pothos, base, '2026-06-10', 'not_sure'), '2026-06-10');
});

test('still moist snoozes 2 days and lengthens future intervals', () => {
  const r = applyFeedback('still_moist', pothos, base, '2026-06-10');
  assert.deepEqual(r, { feedback_factor: 1.1, next_due_on: '2026-06-12', watered: false });
});

test('bone dry marks it due today, is not a watering, and shortens future intervals', () => {
  const r = applyFeedback('bone_dry', pothos, base, '2026-06-10');
  assert.deepEqual(r, { feedback_factor: 0.9, next_due_on: '2026-06-10', watered: false });
});

test('repeating the same button does not nudge the schedule again', () => {
  const dry = applyFeedback('bone_dry', pothos, { ...base, feedback_factor: 0.9 }, '2026-06-10', { repeat: true });
  assert.equal(dry.feedback_factor, 0.9);
  const moist = applyFeedback('still_moist', pothos, { ...base, feedback_factor: 1.1 }, '2026-06-10', { repeat: true });
  assert.equal(moist.feedback_factor, 1.1);
  assert.equal(moist.next_due_on, '2026-06-12');
});

test('watering after a bone dry flag re-plans from today', () => {
  const r = applyFeedback('watered', pothos, { ...base, feedback_factor: 0.9 }, '2026-06-10');
  assert.equal(r.watered, true);
  assert.equal(r.next_due_on, '2026-06-16'); // 7 * 0.9 = 6.3 -> 6
});

test('reset clears learning and re-plans from the last watering', () => {
  const r = resetSchedule(pothos, { ...base, feedback_factor: 0.53 }, '2026-06-10', '2026-06-12');
  assert.deepEqual(r, { feedback_factor: 1, next_due_on: '2026-06-17' });
  const overdue = resetSchedule(pothos, base, '2026-05-01', '2026-06-12');
  assert.equal(overdue.next_due_on, '2026-06-12');
});

test('feedback factor is bounded', () => {
  const r = applyFeedback('still_moist', pothos, { ...base, feedback_factor: 1.95 }, '2026-06-10');
  assert.equal(r.feedback_factor, 2);
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  const noonUtcSummer = new Date('2026-07-01T11:00:00Z');
  assert.equal(todayIn('Europe/London', noonUtcSummer), '2026-07-01');
  assert.equal(timeIn('Europe/London', noonUtcSummer), '12:00');
  assert.equal(timeIn('Europe/London', new Date('2026-12-01T12:00:00Z')), '12:00');
});

// ---------- Phase 2 ----------
import { adjustedDue, awayPhase, frostRisk, riskScore, type Weather } from './care.ts';
import { parseWeather } from './weather.ts';

const day = (date: string, rain_mm: number, tmax = 15, tmin = 8) => ({ date, rain_mm, tmax, tmin });
const outdoor = { setting: 'outdoor' as const, exposure: 'exposed' as const, next_due_on: '2026-10-24', last_watered_on: '2026-10-17' };

test('rain on an exposed pot pushes the check back', () => {
  const w: Weather = { days: [day('2026-10-22', 0), day('2026-10-23', 8), day('2026-10-24', 2)], lowTonight: 6 };
  const r = adjustedDue(outdoor, w, '2026-10-24');
  assert.equal(r.date, '2026-10-26');
  assert.match(r.note ?? '', /Rain/);
});

test('rain does not move a sheltered or indoor plant', () => {
  const w: Weather = { days: [day('2026-10-23', 12), day('2026-10-24', 3)], lowTonight: 6 };
  assert.equal(adjustedDue({ ...outdoor, exposure: 'sheltered' }, w, '2026-10-24').date, '2026-10-24');
  assert.equal(adjustedDue({ ...outdoor, setting: 'indoor' }, w, '2026-10-24').date, '2026-10-24');
});

test('watering after the rain beats the rain', () => {
  const w: Weather = { days: [day('2026-10-23', 10), day('2026-10-24', 0)], lowTonight: 6 };
  assert.equal(adjustedDue({ ...outdoor, last_watered_on: '2026-10-24' }, w, '2026-10-24').date, '2026-10-24');
});

test('light rain is ignored', () => {
  const w: Weather = { days: [day('2026-10-23', 1.5), day('2026-10-24', 1)], lowTonight: 6 };
  assert.equal(adjustedDue(outdoor, w, '2026-10-24').date, '2026-10-24');
});

test('a hot dry spell brings the check forward', () => {
  const hot: Weather = { days: [day('2026-07-09', 0, 27), day('2026-07-10', 0, 27)], lowTonight: 14 };
  const p = { ...outdoor, next_due_on: '2026-07-12', last_watered_on: '2026-07-06' };
  assert.equal(adjustedDue(p, hot, '2026-07-10').date, '2026-07-11');
  const veryHot: Weather = { days: [day('2026-07-09', 0, 31), day('2026-07-10', 0, 32)], lowTonight: 14 };
  assert.equal(adjustedDue(p, veryHot, '2026-07-10').date, '2026-07-10');
});

test('no weather means no change', () => {
  assert.equal(adjustedDue(outdoor, null, '2026-10-24').date, '2026-10-24');
});

test('frost risk uses the plant minimum and shelter', () => {
  const exposed = { setting: 'outdoor' as const, exposure: 'exposed' as const };
  assert.equal(frostRisk(exposed, 5, 2), true);
  assert.equal(frostRisk(exposed, -10, 0), false);
  assert.equal(frostRisk({ ...exposed, exposure: 'sheltered' }, 5, 5), false);
  assert.equal(frostRisk({ ...exposed, setting: 'indoor' }, 5, -3), false);
  assert.equal(frostRisk(exposed, 5, null), false);
});

test('away phases', () => {
  assert.equal(awayPhase(null, null, '2026-08-01'), 'none');
  assert.equal(awayPhase('2026-08-10', '2026-08-20', '2026-08-05'), 'upcoming');
  assert.equal(awayPhase('2026-08-10', '2026-08-20', '2026-07-01'), 'none');
  assert.equal(awayPhase('2026-08-10', '2026-08-20', '2026-08-15'), 'away');
  assert.equal(awayPhase('2026-08-10', '2026-08-20', '2026-08-21'), 'returned');
  assert.equal(awayPhase('2026-08-10', '2026-08-20', '2026-08-30'), 'none');
});

test('risk grows with days overdue relative to interval', () => {
  assert.ok(riskScore('2026-08-01', 3, '2026-08-04') > riskScore('2026-08-01', 14, '2026-08-04'));
  assert.equal(riskScore(null, 7, '2026-08-04'), 0);
});

test('parses an Open-Meteo response and finds tonight\'s low', () => {
  const hours: string[] = [];
  const temps: number[] = [];
  for (const d of ['2026-10-24', '2026-10-25']) for (let h = 0; h < 24; h++) { hours.push(`${d}T${String(h).padStart(2, '0')}:00`); temps.push(h === 3 && d === '2026-10-25' ? -1 : 9); }
  const w = parseWeather(
    { daily: { time: ['2026-10-24', '2026-10-25'], precipitation_sum: [0.2, null], temperature_2m_max: [14, 12], temperature_2m_min: [6, -1] }, hourly: { time: hours, temperature_2m: temps } },
    '2026-10-24',
  );
  assert.equal(w?.lowTonight, -1);
  assert.equal(w?.days[1].rain_mm, 0);
  assert.equal(parseWeather({}, '2026-10-24'), null);
});

// ---------- Health check ----------
import { applyWateringChange, caseIsLong, nextCheckDate } from './care.ts';

test('a watering diagnosis adjusts the schedule', () => {
  const less = applyWateringChange('water_less', 1, '2026-10-26', '2026-10-25');
  assert.equal(less.feedback_factor, 1.2);
  assert.equal(less.next_due_on, '2026-10-28');
  assert.equal(applyWateringChange('water_less', 1, '2026-11-05', '2026-10-25').next_due_on, '2026-11-05');
  const more = applyWateringChange('water_more', 1, '2026-11-05', '2026-10-25');
  assert.equal(more.feedback_factor, 0.85);
  assert.equal(more.next_due_on, '2026-10-25');
  assert.deepEqual(applyWateringChange('none', 1.1, '2026-11-05', '2026-10-25'), { feedback_factor: 1.1, next_due_on: '2026-11-05' });
  assert.equal(applyWateringChange('water_less', 1.9, null, '2026-10-25').feedback_factor, 2);
});

test('check-ins follow the treatment rhythm', () => {
  const t = '2026-10-25';
  assert.equal(nextCheckDate('resolved', 6, t), null);
  assert.equal(nextCheckDate('better', 6, t), '2026-11-01');
  assert.equal(nextCheckDate('better', 10, t), '2026-11-04');
  assert.equal(nextCheckDate('same', 6, t), '2026-10-31');
  assert.equal(nextCheckDate('same', null, t), '2026-10-30');
  assert.equal(nextCheckDate('worse', 6, t), '2026-10-28');
  assert.equal(nextCheckDate('worse', 2, t), '2026-10-27');
  assert.equal(nextCheckDate('same', 6, t, 2), '2026-10-27');
});

test('a case is long after four weeks', () => {
  assert.equal(caseIsLong('2026-10-01', '2026-10-28'), false);
  assert.equal(caseIsLong('2026-10-01', '2026-10-29'), true);
});
