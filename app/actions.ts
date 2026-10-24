'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { identifyPlant, type Identification } from '@/lib/claude';
import {
  applyFeedback,
  firstDueDate,
  todayIn,
  wateringInterval,
  addDays,
  resetSchedule,
  type Feedback,
  type LastWatered,
  type PlantContext,
} from '@/lib/care';
import {
  chargeAiCall,
  contextOf,
  ensureSpecies,
  getProfile,
  PLANT_SELECT,
  type PlantWithSpecies,
} from '@/lib/plants';
import { adminClient, currentUserId, PHOTO_BUCKET, userClient } from '@/lib/supabase';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireUser(): Promise<string> {
  const id = await currentUserId();
  if (!id) redirect('/login');
  return id;
}

function fail(err: unknown): { ok: false; error: string } {
  console.error(err);
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

function stripDataUrl(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '');
}

// ---------- Identification ----------

export async function identifyAction(photoBase64: string): Promise<Result<Identification>> {
  try {
    const userId = await requireUser();
    await chargeAiCall(userId);
    const data = await identifyPlant(stripDataUrl(photoBase64));
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

// ---------- Adding a plant ----------

export type NewPlantInput = {
  photoBase64: string | null;
  scientific_name: string;
  common_name: string;
  nickname: string;
  quick: boolean;
  setting: 'indoor' | 'outdoor';
  spot: string;
  light: PlantContext['light'];
  near_heat: boolean;
  exposure: 'exposed' | 'sheltered' | null;
  pot_material: PlantContext['pot_material'];
  has_drainage: boolean | null;
  pot_size: PlantContext['pot_size'];
  last_watered: LastWatered;
};

export async function addPlantAction(input: NewPlantInput): Promise<Result<{ id: string }>> {
  try {
    const userId = await requireUser();
    if (!input.scientific_name.trim()) throw new Error('Pick or type a species first');
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);

    const key = await ensureSpecies(input.scientific_name, input.common_name);
    const { data: species } = await db.from('species_profiles').select('profile').eq('key', key).single();
    if (!species) throw new Error('Care profile missing');

    const ctx: PlantContext = {
      setting: input.setting,
      light: input.light,
      near_heat: input.setting === 'indoor' && input.near_heat,
      pot_material: input.pot_material,
      pot_size: input.pot_size,
      feedback_factor: 1,
    };
    const next = firstDueDate(species.profile, ctx, today, input.last_watered);

    const { data: plant, error } = await db
      .from('plants')
      .insert({
        user_id: userId,
        nickname: input.nickname.trim() || input.common_name,
        species_key: key,
        setting: input.setting,
        spot: input.spot.trim() || null,
        light: input.light,
        near_heat: ctx.near_heat,
        exposure: input.setting === 'outdoor' ? input.exposure : null,
        pot_material: input.pot_material,
        has_drainage: input.has_drainage,
        pot_size: input.pot_size,
        needs_context: input.quick,
        last_watered_on: input.last_watered === 'today' ? today : null,
        next_due_on: next,
      })
      .select('id')
      .single();
    if (error || !plant) throw new Error(error?.message ?? 'Could not save plant');

    if (input.photoBase64) {
      const path = `${userId}/${plant.id}.jpg`;
      const bytes = Buffer.from(stripDataUrl(input.photoBase64), 'base64');
      const up = await adminClient().storage.from(PHOTO_BUCKET).upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (!up.error) await db.from('plants').update({ photo_path: path }).eq('id', plant.id);
    }

    await db.from('events').insert({ plant_id: plant.id, user_id: userId, kind: 'added' });
    revalidatePath('/');
    return { ok: true, data: { id: plant.id } };
  } catch (err) {
    return fail(err);
  }
}

// ---------- Watering feedback ----------

async function loadPlant(plantId: string): Promise<PlantWithSpecies> {
  const db = await userClient();
  const { data, error } = await db.from('plants').select(PLANT_SELECT).eq('id', plantId).single();
  if (error || !data) throw new Error('Plant not found');
  return data as PlantWithSpecies;
}

export async function feedbackAction(plantId: string, feedback: Feedback): Promise<Result<{ next_due_on: string }>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const plant = await loadPlant(plantId);
    // Same button twice in a row should not nudge the schedule a second time.
    let repeat = false;
    if (feedback !== 'watered') {
      const { data: last } = await db
        .from('events')
        .select('kind')
        .eq('plant_id', plantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      repeat = last?.kind === feedback;
    }
    const r = applyFeedback(feedback, plant.species.profile, contextOf(plant), today, { repeat });

    await db
      .from('plants')
      .update({
        feedback_factor: r.feedback_factor,
        next_due_on: r.next_due_on,
        ...(r.watered ? { last_watered_on: today } : {}),
      })
      .eq('id', plantId);
    await db.from('events').insert({ plant_id: plantId, user_id: userId, kind: feedback });
    revalidatePath('/');
    revalidatePath(`/plants/${plantId}`);
    return { ok: true, data: { next_due_on: r.next_due_on } };
  } catch (err) {
    return fail(err);
  }
}

/** Marks every plant due today or earlier as watered. */
export async function waterAllDueAction(): Promise<Result<{ count: number }>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const { data } = await db
      .from('plants')
      .select('id')
      .eq('status', 'active')
      .lte('next_due_on', today);
    for (const p of data ?? []) await feedbackAction(p.id, 'watered');
    return { ok: true, data: { count: data?.length ?? 0 } };
  } catch (err) {
    return fail(err);
  }
}

// ---------- Editing a plant ----------

export type ContextInput = {
  nickname: string;
  setting: 'indoor' | 'outdoor';
  spot: string;
  light: PlantContext['light'];
  near_heat: boolean;
  exposure: 'exposed' | 'sheltered' | null;
  pot_material: PlantContext['pot_material'];
  has_drainage: boolean | null;
  pot_size: PlantContext['pot_size'];
};

export async function updateContextAction(plantId: string, input: ContextInput): Promise<Result<null>> {
  try {
    await requireUser();
    const db = await userClient();
    const plant = await loadPlant(plantId);
    const updated = {
      nickname: input.nickname.trim() || plant.nickname,
      setting: input.setting,
      spot: input.spot.trim() || null,
      light: input.light,
      near_heat: input.setting === 'indoor' && input.near_heat,
      exposure: input.setting === 'outdoor' ? input.exposure : null,
      pot_material: input.pot_material,
      has_drainage: input.has_drainage,
      pot_size: input.pot_size,
      needs_context: false,
    };
    // Re-plan the next watering from the last one, with the new context.
    let next_due_on = plant.next_due_on;
    if (plant.last_watered_on) {
      const ctx = contextOf({ ...plant, ...updated });
      next_due_on = addDays(plant.last_watered_on, wateringInterval(plant.species.profile, ctx, plant.last_watered_on));
    }
    const { error } = await db.from('plants').update({ ...updated, next_due_on }).eq('id', plantId);
    if (error) throw new Error(error.message);
    revalidatePath('/');
    revalidatePath(`/plants/${plantId}`);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

/** Clears what the buttons taught the app and re-plans from the last watering. */
export async function resetScheduleAction(plantId: string): Promise<Result<{ next_due_on: string }>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const plant = await loadPlant(plantId);
    const r = resetSchedule(plant.species.profile, contextOf(plant), plant.last_watered_on, today);
    const { error } = await db.from('plants').update(r).eq('id', plantId);
    if (error) throw new Error(error.message);
    await db.from('events').insert({ plant_id: plantId, user_id: userId, kind: 'note', detail: 'Schedule reset' });
    revalidatePath('/');
    revalidatePath(`/plants/${plantId}`);
    return { ok: true, data: { next_due_on: r.next_due_on } };
  } catch (err) {
    return fail(err);
  }
}

/** Fixes a wrong ID: new species, new care profile, history kept. */
export async function changeSpeciesAction(
  plantId: string,
  scientificName: string,
  commonName: string,
): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    if (!scientificName.trim()) throw new Error('Type the species name');
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const before = await loadPlant(plantId);
    const key = await ensureSpecies(scientificName, commonName || scientificName);
    const { data: species } = await db.from('species_profiles').select('profile').eq('key', key).single();
    if (!species) throw new Error('Care profile missing');

    const from = before.last_watered_on ?? today;
    const ctx = { ...contextOf(before), feedback_factor: 1 }; // old feedback was for the wrong species
    let next = addDays(from, wateringInterval(species.profile, ctx, from));
    if (next < today) next = today;

    await db.from('plants').update({ species_key: key, feedback_factor: 1, next_due_on: next }).eq('id', plantId);
    await db.from('events').insert({
      plant_id: plantId,
      user_id: userId,
      kind: 'species_changed',
      detail: `${before.species.common_name} → ${commonName || scientificName}`,
    });
    revalidatePath('/');
    revalidatePath(`/plants/${plantId}`);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePlantAction(plantId: string): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const { data } = await db.from('plants').select('photo_path').eq('id', plantId).single();
    if (data?.photo_path) await adminClient().storage.from(PHOTO_BUCKET).remove([data.photo_path]);
    await db.from('plants').delete().eq('id', plantId).eq('user_id', userId);
    revalidatePath('/');
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

// ---------- Settings ----------

export type SettingsInput = { postcode: string; digest_time: string; digest_every_days: number; has_pets: boolean };

export async function saveSettingsAction(input: SettingsInput): Promise<Result<{ postcode: string }>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    let postcode: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;

    const typed = input.postcode.trim();
    if (typed) {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(typed)}`);
      if (!res.ok) throw new Error('That postcode was not recognised');
      const json = (await res.json()) as { result: { postcode: string; latitude: number; longitude: number } };
      postcode = json.result.postcode;
      latitude = json.result.latitude;
      longitude = json.result.longitude;
    }
    if (!/^\d{2}:\d{2}$/.test(input.digest_time)) throw new Error('Pick a digest time');
    const every = Math.round(Number(input.digest_every_days));
    if (!(every >= 1 && every <= 14)) throw new Error('Pick how often you want reminders');

    const { error } = await db
      .from('profiles')
      .update({ postcode, latitude, longitude, digest_time: input.digest_time, digest_every_days: every, has_pets: input.has_pets })
      .eq('id', userId);
    if (error) throw new Error(error.message);
    revalidatePath('/');
    revalidatePath('/settings');
    return { ok: true, data: { postcode: postcode ?? '' } };
  } catch (err) {
    return fail(err);
  }
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscriptionAction(sub: PushSubscriptionInput): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    const { error } = await adminClient()
      .from('push_subscriptions')
      .upsert(
        { user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        { onConflict: 'endpoint' },
      );
    if (error) throw new Error(error.message);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

export async function sendTestPushAction(): Promise<Result<{ sent: number }>> {
  try {
    const userId = await requireUser();
    const { sendToUser } = await import('@/lib/push');
    const sent = await sendToUser(userId, {
      title: 'Plant Care',
      body: 'Notifications are working. Your digest will arrive at your chosen time.',
      url: '/',
      tag: 'test',
    });
    if (sent === 0) throw new Error('No device is set up for notifications yet');
    return { ok: true, data: { sent } };
  } catch (err) {
    return fail(err);
  }
}

export async function signOutAction(): Promise<void> {
  const db = await userClient();
  await db.auth.signOut();
  redirect('/login');
}

export async function deleteAccountAction(): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    const admin = adminClient();
    const { data: files } = await admin.storage.from(PHOTO_BUCKET).list(userId, { limit: 1000 });
    if (files?.length) await admin.storage.from(PHOTO_BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
    const { error } = await admin.auth.admin.deleteUser(userId); // cascades to all tables
    if (error) throw new Error(error.message);
    const db = await userClient();
    await db.auth.signOut();
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
