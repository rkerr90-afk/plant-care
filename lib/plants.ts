import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { careProfileFor } from './claude';
import { adminClient } from './supabase';
import { todayIn, type CareProfile, type Flag, type PlantContext } from './care';

export type Profile = {
  id: string;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  digest_time: string;
  digest_every_days: number;
  timezone: string;
  has_pets: boolean;
  last_digest_on: string | null;
  ai_calls_on: string | null;
  ai_calls_today: number;
};

export type Plant = {
  id: string;
  user_id: string;
  nickname: string;
  species_key: string;
  setting: 'indoor' | 'outdoor';
  spot: string | null;
  light: PlantContext['light'];
  near_heat: boolean;
  exposure: 'exposed' | 'sheltered' | null;
  pot_material: PlantContext['pot_material'];
  has_drainage: boolean | null;
  pot_size: PlantContext['pot_size'];
  needs_context: boolean;
  photo_path: string | null;
  feedback_factor: number;
  last_watered_on: string | null;
  next_due_on: string | null;
  status: 'active' | 'archived';
  created_at: string;
};

export type PlantWithSpecies = Plant & {
  species: { common_name: string; scientific_name: string; profile: CareProfile };
};

export const PLANT_SELECT = '*, species:species_profiles(common_name, scientific_name, profile)';

/** Latest answer per plant (watered, still moist or bone dry). A reset clears it. */
export async function latestFlags(db: SupabaseClient, plantIds: string[]): Promise<Record<string, Flag>> {
  if (plantIds.length === 0) return {};
  const { data } = await db
    .from('events')
    .select('plant_id, kind')
    .in('plant_id', plantIds)
    .in('kind', ['watered', 'still_moist', 'bone_dry', 'note'])
    .order('created_at', { ascending: false })
    .limit(1000);
  const out: Record<string, Flag> = {};
  for (const e of data ?? []) {
    if (e.plant_id in out) continue;
    out[e.plant_id] = e.kind === 'watered' || e.kind === 'bone_dry' || e.kind === 'still_moist' ? e.kind : null;
  }
  return out;
}

export function contextOf(p: Plant): PlantContext {
  return {
    setting: p.setting,
    light: p.light,
    near_heat: p.near_heat,
    pot_material: p.pot_material,
    pot_size: p.pot_size,
    feedback_factor: Number(p.feedback_factor),
  };
}

export async function getProfile(db: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await db.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) throw new Error('Profile not found');
  return data as Profile;
}

export function speciesKey(scientificName: string): string {
  return scientificName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Returns the cached care profile for a species, creating it with Claude on first use. */
export async function ensureSpecies(scientificName: string, commonName: string): Promise<string> {
  const db = adminClient();
  const key = speciesKey(scientificName);
  const { data: existing } = await db.from('species_profiles').select('key').eq('key', key).maybeSingle();
  if (existing) return key;
  const profile = await careProfileFor(scientificName.trim(), commonName.trim());
  const { error } = await db.from('species_profiles').upsert({
    key,
    scientific_name: scientificName.trim(),
    common_name: commonName.trim() || profile.common_name,
    profile,
  });
  if (error) throw new Error(`Could not save care profile: ${error.message}`);
  return key;
}

/** Counts one Claude photo call against the user's daily cap; throws when the cap is reached. */
export async function chargeAiCall(userId: string): Promise<void> {
  const db = adminClient();
  const profile = await getProfile(db, userId);
  const today = todayIn(profile.timezone);
  const used = profile.ai_calls_on === today ? profile.ai_calls_today : 0;
  const cap = Number(process.env.DAILY_AI_CAP || 20);
  if (used >= cap) throw new Error(`Daily limit of ${cap} photo checks reached. Try again tomorrow.`);
  await db.from('profiles').update({ ai_calls_on: today, ai_calls_today: used + 1 }).eq('id', userId);
}
