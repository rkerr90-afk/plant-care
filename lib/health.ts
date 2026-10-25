import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, PHOTO_BUCKET } from './supabase';
import { LIGHT_LABEL } from './format';
import { wateringInterval } from './care';
import { contextOf, type PlantWithSpecies } from './plants';
import type { Diagnosis } from './claude';

export type HealthCase = {
  id: string;
  user_id: string;
  plant_id: string;
  status: 'open' | 'resolved';
  issue: string;
  category: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  plan: Partial<Diagnosis>;
  repeat_every_days: number | null;
  next_check_on: string | null;
  opened_on: string;
  resolved_on: string | null;
  created_at: string;
};

export type HealthUpdate = {
  id: string;
  case_id: string;
  kind: 'diagnosis' | 'better' | 'same' | 'worse' | 'resolved';
  note: string | null;
  photo_path: string | null;
  advice: string | null;
  next_steps: string[] | null;
  created_at: string;
};

/** Open cases keyed by plant id. Returns {} if the health tables are not there yet. */
export async function openCases(db: SupabaseClient): Promise<Record<string, HealthCase>> {
  const { data, error } = await db.from('health_cases').select('*').eq('status', 'open');
  if (error) return {};
  const out: Record<string, HealthCase> = {};
  for (const c of (data ?? []) as HealthCase[]) out[c.plant_id] = c;
  return out;
}

/** What Claude needs to know about the plant to judge a photo. */
export async function plantContextText(db: SupabaseClient, plant: PlantWithSpecies, hasPets: boolean, today: string): Promise<string> {
  const { data: events } = await db
    .from('events')
    .select('kind, detail, created_at')
    .eq('plant_id', plant.id)
    .order('created_at', { ascending: false })
    .limit(8);
  const sp = plant.species.profile;
  const where =
    plant.setting === 'outdoor'
      ? `outdoors${plant.exposure === 'sheltered' ? ', sheltered from rain' : ', exposed to rain'}`
      : `indoors${plant.near_heat ? ', next to a radiator' : ''}`;
  const lines = [
    `Plant: ${plant.species.common_name} (${plant.species.scientific_name}), called "${plant.nickname}".`,
    `Where: ${where}${plant.spot ? `, ${plant.spot}` : ''}. Light: ${plant.light ? LIGHT_LABEL[plant.light] : 'unknown'}.`,
    `Pot: ${plant.pot_size ?? 'medium'} ${plant.pot_material ?? ''}${plant.has_drainage === false ? ', NO drainage hole' : ''}.`,
    `Watering: roughly every ${wateringInterval(sp, contextOf(plant), today)} days at this time of year; last watered ${plant.last_watered_on ?? 'unknown'}.`,
    `Species prefers: ${sp.light_preference}. Minimum temperature ${sp.min_temp_c}°C.`,
    `Today is ${today} (UK). Pets in the home: ${hasPets ? 'yes' : 'no'}.`,
  ];
  if (events?.length) {
    lines.push('Recent log: ' + events.map((e) => `${e.created_at.slice(0, 10)} ${e.kind}${e.detail ? ` (${e.detail})` : ''}`).join('; ') + '.');
  }
  return lines.join('\n');
}

/** Saves a health photo next to the plant's main photo, so deleting the account removes it too. */
export async function saveHealthPhoto(userId: string, plantId: string, base64: string): Promise<string | null> {
  const path = `${userId}/${plantId}-health-${Date.now()}.jpg`;
  const { error } = await adminClient()
    .storage.from(PHOTO_BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: 'image/jpeg', upsert: true });
  return error ? null : path;
}

export async function loadPhotoBase64(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await adminClient().storage.from(PHOTO_BUCKET).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer()).toString('base64');
}

/** One line of the treatment plan, for Claude's follow-up. */
export function planText(c: HealthCase): string {
  const p = c.plan;
  const parts = [...(p.do_now ?? [])];
  if (c.repeat_every_days && p.repeat_action) parts.push(`${p.repeat_action} every ${c.repeat_every_days} days`);
  return parts.join('; ') || 'none recorded';
}
