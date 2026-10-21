-- This RPC creates/returns the public profile for the currently authenticated
-- Supabase user. It intentionally does not install an auth.users trigger.
-- Remove the earlier proposed trigger if that draft was already applied.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();

create or replace function public.ensure_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user_id uuid := auth.uid();
  auth_email text;
  auth_metadata jsonb;
  profile_name text;
  profile_initials text;
  profile_row public.users%rowtype;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to create a user profile.';
  end if;

  select auth_user.email, coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
    into auth_email, auth_metadata
  from auth.users as auth_user
  where auth_user.id = current_auth_user_id;

  if not found then
    raise exception 'The authenticated account was not found.';
  end if;

  profile_name := coalesce(
    nullif(trim(auth_metadata ->> 'full_name'), ''),
    nullif(trim(auth_metadata ->> 'name'), ''),
    nullif(split_part(coalesce(auth_email, ''), '@', 1), ''),
    'New user'
  );
  profile_initials := upper(
    left(split_part(profile_name, ' ', 1), 1) ||
    case
      when position(' ' in profile_name) > 0 then left(split_part(profile_name, ' ', 2), 1)
      else ''
    end
  );
  if profile_initials = '' then profile_initials := 'U'; end if;

  insert into public.users (auth_user_id, name, email, initials)
  values (current_auth_user_id, profile_name, auth_email, profile_initials)
  on conflict (auth_user_id) do update
    set name = excluded.name,
        email = excluded.email,
        initials = excluded.initials
  returning * into profile_row;

  return jsonb_build_object(
    'id', profile_row.id,
    'name', profile_row.name,
    'email', profile_row.email,
    'initials', profile_row.initials
  );
end;
$$;

revoke all on function public.ensure_user_profile() from public, anon;
grant execute on function public.ensure_user_profile() to authenticated;
