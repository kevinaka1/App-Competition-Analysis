import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type UserProfile = { id: string; name: string; email: string | null; initials: string };

export async function getAuthenticatedProfile() {
  const authClient = await createSupabaseServerClient();
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return null;

  const { data, error: profileError } = await authClient.rpc('ensure_user_profile');
  if (profileError) throw profileError;
  if (typeof data !== 'object' || data === null ||
      typeof data.id !== 'string' || typeof data.name !== 'string' ||
      typeof data.initials !== 'string' ||
      (data.email !== null && typeof data.email !== 'string')) {
    throw new Error('The ensure_user_profile database function returned an invalid profile.');
  }

  return { authUser: user, profile: data as UserProfile };
}
