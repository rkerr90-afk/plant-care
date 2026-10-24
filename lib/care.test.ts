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
