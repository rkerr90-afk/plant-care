import type { Flag } from '@/lib/care';

/** The plant's current status: what you last found, or when it is next due. */
export function StatusChip({ flag, label }: { flag: Flag; label: { text: string; due: boolean } }) {
  if (flag === 'bone_dry') return <span className="chip due">Bone dry: water now</span>;
  if (flag === 'still_moist' && !label.due) return <span className="chip">Still moist · {label.text.toLowerCase()}</span>;
  return <span className={`chip ${label.due ? 'due' : ''}`}>{label.text}</span>;
}
