import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Supabase client acting as the signed-in user (respects row level security). */
export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there, middleware refreshes them.
        }
      },
    },
  });
}

/** Service-role client for server-only work (photos, cron, shared species cache). Bypasses RLS. */
export function adminClient(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user's id, or null. */
export async function currentUserId(): Promise<string | null> {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const PHOTO_BUCKET = 'plant-photos';
