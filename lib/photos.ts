import 'server-only';
import { adminClient, PHOTO_BUCKET } from './supabase';

/** Signed URLs (valid 1 hour) for the given storage paths, keyed by path. */
export async function signedPhotoUrls(paths: (string | null)[]): Promise<Record<string, string>> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return {};
  const { data } = await adminClient().storage.from(PHOTO_BUCKET).createSignedUrls(list, 3600);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
