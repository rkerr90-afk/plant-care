import { daysBetween } from './care';

export function dueLabel(nextDue: string | null, today: string): { text: string; overdue: boolean; due: boolean } {
  if (!nextDue) return { text: 'Not scheduled', overdue: false, due: false };
  const d = daysBetween(today, nextDue);
  if (d < 0) return { text: d === -1 ? 'Overdue by a day' : `Overdue by ${-d} days`, overdue: true, due: true };
  if (d === 0) return { text: 'Check today', overdue: false, due: true };
  if (d === 1) return { text: 'Tomorrow', overdue: false, due: false };
  if (d < 7) return { text: `In ${d} days`, overdue: false, due: false };
  return { text: `${shortDate(nextDue)}`, overdue: false, due: false };
}

export function shortDate(iso: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`;
}

/** Ensures a line ends with a full stop, without doubling it. */
export function sentence(s: string): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export const LIGHT_LABEL: Record<string, string> = {
  bright_direct: 'Bright, direct sun',
  bright_indirect: 'Bright, indirect',
  medium: 'Medium',
  low: 'Low light',
};

export const EVENT_LABEL: Record<string, string> = {
  added: 'Added',
  watered: 'Watered',
  still_moist: 'Still moist, checked again in 2 days',
  bone_dry: 'Watered (was bone dry)',
  species_changed: 'Species changed',
  note: 'Note',
};
