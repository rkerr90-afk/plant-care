'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { diagnosePlant, identifyPlant, reviewProgress, type Identification } from '@/lib/claude';
import { loadPhotoBase64, planText, plantContextText, saveHealthPhoto, type HealthCase } from '@/lib/health';
import {
  applyFeedback,
  firstDueDate,
  todayIn,
  wateringInterval,
  addDays,
  resetSchedule,
  applyWateringChange,
  nextCheckDate,
  daysBetween,
  type CheckInOutcome,
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

/** Marks the given plants (the ones due today, as the screen sees them) as watered. */
export async function waterAllDueAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    await requireUser();
    for (const id of ids) await feedbackAction(id, 'watered');
    return { ok: true, data: { count: ids.length } };
  } catch (err) {
    return fail(err);
  }
}

/** Pushes the given plants' next check to tomorrow. */
export async function snoozeAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const tomorrow = addDays(todayIn(profile.timezone), 1);
    const { data } = await db.from('plants').update({ next_due_on: tomorrow }).in('id', ids).eq('user_id', userId).select('id');
    for (const p of data ?? []) {
      await db.from('events').insert({ plant_id: p.id, user_id: userId, kind: 'note', detail: 'Snoozed until tomorrow' });
    }
    revalidatePath('/');
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

/** One-tap move between indoors and outdoors. Forgets what the buttons taught, because the conditions changed. */
export async function movePlantAction(plantId: string, input: ContextInput): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const plant = await loadPlant(plantId);
    const updated = {
      setting: input.setting,
      spot: input.spot.trim() || null,
      light: input.light,
      near_heat: input.setting === 'indoor' && input.near_heat,
      exposure: input.setting === 'outdoor' ? input.exposure ?? 'exposed' : null,
      feedback_factor: 1,
      needs_context: false,
    };
    const ctx = contextOf({ ...plant, ...updated });
    const from = plant.last_watered_on ?? today;
    let next_due_on = addDays(from, wateringInterval(plant.species.profile, ctx, from));
    if (next_due_on < today) next_due_on = today;
    const { error } = await db.from('plants').update({ ...updated, next_due_on }).eq('id', plantId);
    if (error) throw new Error(error.message);
    await db.from('events').insert({
      plant_id: plantId,
      user_id: userId,
      kind: 'note',
      detail: input.setting === 'indoor' ? 'Moved indoors' : 'Moved outside',
    });
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
    const { data: hp } = await db.from('health_updates').select('photo_path').eq('plant_id', plantId);
    const paths = [data?.photo_path, ...(hp ?? []).map((u) => u.photo_path)].filter((p): p is string => !!p);
    if (paths.length) await adminClient().storage.from(PHOTO_BUCKET).remove(paths);
    await db.from('plants').delete().eq('id', plantId).eq('user_id', userId);
    revalidatePath('/');
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

// ---------- Health check ----------

export type DiagnoseResult =
  | { kind: 'retake'; message: string }
  | { kind: 'healthy'; message: string }
  | { kind: 'case'; caseId: string };

/** Photo of a problem in, diagnosis and treatment plan out. Opens a case unless the plant looks healthy. */
export async function diagnoseAction(plantId: string, photoBase64: string, note: string): Promise<Result<DiagnoseResult>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const plant = await loadPlant(plantId);
    const { data: existing } = await db.from('health_cases').select('id').eq('plant_id', plantId).eq('status', 'open').maybeSingle();
    if (existing) throw new Error('This plant already has an open check. Log a check-in instead.');

    await chargeAiCall(userId);
    const photo = stripDataUrl(photoBase64);
    const context = await plantContextText(db, plant, profile.has_pets, today);
    const d = await diagnosePlant(photo, context, note);

    if (!d.photo_usable) {
      return { ok: true, data: { kind: 'retake', message: d.retake_hint || 'That photo is hard to judge. Try a closer, brighter shot of the affected leaves.' } };
    }
    if (d.healthy || !d.issue.trim()) {
      await db.from('events').insert({ plant_id: plantId, user_id: userId, kind: 'note', detail: 'Health check: looks healthy' });
      revalidatePath(`/plants/${plantId}`);
      return { ok: true, data: { kind: 'healthy', message: [d.signs, d.explanation].filter(Boolean).join(' ') } };
    }

    const repeat = d.repeat_every_days > 0 && d.repeat_action.trim() ? d.repeat_every_days : null;
    const { data: created, error } = await db
      .from('health_cases')
      .insert({
        user_id: userId,
        plant_id: plantId,
        issue: d.issue.trim(),
        category: d.category,
        confidence: d.confidence,
        plan: d,
        repeat_every_days: repeat,
        next_check_on: addDays(today, Math.max(2, Math.min(21, d.check_in_days || repeat || 5))),
        opened_on: today,
      })
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Could not save the check');

    const photo_path = await saveHealthPhoto(userId, plantId, photo);
    await db.from('health_updates').insert({
      case_id: created.id,
      user_id: userId,
      plant_id: plantId,
      kind: 'diagnosis',
      note: note.trim() || null,
      photo_path,
      advice: d.explanation,
      next_steps: d.do_now,
    });

    if (d.watering_change !== 'none') {
      const w = applyWateringChange(d.watering_change, Number(plant.feedback_factor), plant.next_due_on, today);
      await db.from('plants').update(w).eq('id', plantId);
    }
    await db.from('events').insert({ plant_id: plantId, user_id: userId, kind: 'note', detail: `Health: ${d.issue.trim()} found` });
    revalidatePath('/');
    revalidatePath(`/plants/${plantId}`);
    return { ok: true, data: { kind: 'case', caseId: created.id } };
  } catch (err) {
    return fail(err);
  }
}

export type CheckInResult = { advice: string; next_steps: string[]; next_check_on: string | null; escalate: boolean };

/** Better, same, worse or resolved, with an optional new photo. Same and worse get fresh advice from Claude. */
export async function checkInAction(
  caseId: string,
  outcome: CheckInOutcome,
  photoBase64: string | null,
  note: string,
): Promise<Result<CheckInResult>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    const profile = await getProfile(db, userId);
    const today = todayIn(profile.timezone);
    const { data: c } = await db.from('health_cases').select('*').eq('id', caseId).single();
    if (!c) throw new Error('Check not found');
    const hc = c as HealthCase;
    if (hc.status !== 'open') throw new Error('This check is already closed');
    const plant = await loadPlant(hc.plant_id);
    const photo = photoBase64 ? stripDataUrl(photoBase64) : null;
    const daysOpen = daysBetween(hc.opened_on, today);

    let result: CheckInResult;
    if (outcome === 'resolved') {
      result = { advice: 'Lovely. The check is closed and stays in the history.', next_steps: [], next_check_on: null, escalate: false };
    } else if (outcome === 'better') {
      const next = nextCheckDate('better', hc.repeat_every_days, today);
      const steps = hc.plan.repeat_action && hc.repeat_every_days ? [`${hc.plan.repeat_action}, every ${hc.repeat_every_days} days`] : [];
      result = {
        advice: 'Good news. Keep going with the same treatment until it is fully clear. Problems like this often look better before they are gone.',
        next_steps: steps,
        next_check_on: next,
        escalate: false,
      };
    } else {
      await chargeAiCall(userId);
      const { data: ups } = await db
        .from('health_updates')
        .select('kind, note, created_at, photo_path')
        .eq('case_id', caseId)
        .order('created_at');
      const first = (ups ?? []).find((u) => u.kind === 'diagnosis');
      const history = (ups ?? [])
        .filter((u) => u.kind !== 'diagnosis')
        .map((u) => `day ${daysBetween(hc.opened_on, u.created_at.slice(0, 10))}: ${u.kind}${u.note ? ` (${u.note})` : ''}`)
        .join('; ');
      const r = await reviewProgress({
        context: await plantContextText(db, plant, profile.has_pets, today),
        issue: hc.issue,
        plan: planText(hc),
        history,
        outcome,
        daysOpen,
        note,
        firstPhoto: await loadPhotoBase64(first?.photo_path ?? null),
        newPhoto: photo,
      });
      result = {
        advice: r.advice,
        next_steps: r.next_steps,
        next_check_on: nextCheckDate(outcome, hc.repeat_every_days, today, r.check_in_days),
        escalate: r.escalate,
      };
    }

    const photo_path = photo ? await saveHealthPhoto(userId, hc.plant_id, photo) : null;
    await db.from('health_updates').insert({
      case_id: caseId,
      user_id: userId,
      plant_id: hc.plant_id,
      kind: outcome,
      note: note.trim() || null,
      photo_path,
      advice: result.advice,
      next_steps: result.next_steps,
    });
    await db
      .from('health_cases')
      .update(
        outcome === 'resolved'
          ? { status: 'resolved', resolved_on: today, next_check_on: null }
          : { next_check_on: result.next_check_on },
      )
      .eq('id', caseId);
    if (outcome === 'resolved') {
      await db.from('events').insert({ plant_id: hc.plant_id, user_id: userId, kind: 'note', detail: `Health: ${hc.issue} resolved after ${daysOpen} days` });
    }
    revalidatePath('/');
    revalidatePath(`/plants/${hc.plant_id}`);
    return { ok: true, data: result };
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

// ---------- Away mode ----------

export async function saveAwayAction(from: string | null, until: string | null): Promise<Result<null>> {
  try {
    const userId = await requireUser();
    const db = await userClient();
    if ((from && !until) || (!from && until)) throw new Error('Pick both a leaving date and a return date');
    if (from && until && until < from) throw new Error('The return date is before the leaving date');
    const { error } = await db.from('profiles').update({ away_from: from || null, away_until: until || null }).eq('id', userId);
    if (error) throw new Error(error.message);
    revalidatePath('/');
    revalidatePath('/settings');
    return { ok: true, data: null };
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
      title: 'Grow 🍃',
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
