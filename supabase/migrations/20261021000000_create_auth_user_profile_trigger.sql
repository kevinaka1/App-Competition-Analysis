-- Use auth.users.id as public.users.id for real accounts. The earlier
-- auth_user_id column is migrated into the primary key and then removed.
-- Fixture users keep their existing generated UUIDs.

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_deleted on auth.users;
drop function if exists public.handle_auth_user_created();
drop function if exists public.handle_auth_user_deleted();
drop function if exists public.create_profile_for_auth_user(uuid);
drop function if exists public.ensure_user_profile();

-- Temporarily remove the FK so idea ownership can be moved before profile IDs.
alter table public.ideas drop constraint if exists ideas_user_id_fkey;

do $$
declare
  has_auth_user_id boolean;
  has_id_conflict boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'auth_user_id'
  ) into has_auth_user_id;

  if has_auth_user_id then
    execute $query$
      select exists (
        select 1
        from public.users as linked_user
        join public.users as occupying_user
          on occupying_user.id = linked_user.auth_user_id
         and occupying_user.id <> linked_user.id
        where linked_user.auth_user_id is not null
      )
    $query$ into has_id_conflict;

    if has_id_conflict then
      raise exception 'Cannot align public.users.id with auth.users.id: a target UUID is already used by another public.users row.';
    end if;

    execute $query$
      update public.ideas as idea
      set user_id = profile.auth_user_id
      from public.users as profile
      where idea.user_id = profile.id
        and profile.auth_user_id is not null
    $query$;

    execute 'update public.users set id = auth_user_id where auth_user_id is not null';
  end if;
end;
$$;

-- ideas.user_id now matches the profile IDs; restore referential integrity.
alter table public.ideas
  add constraint ideas_user_id_fkey
  foreign key (user_id) references public.users (id) on delete cascade;

alter table public.users drop constraint if exists users_auth_user_id_fkey;
alter table public.users drop constraint if exists users_auth_user_id_key;
alter table public.users drop column if exists auth_user_id;

-- mock_id is only for fixture rows; real authenticated profiles leave it null.
alter table public.users alter column mock_id drop not null;

create or replace function public.create_profile_for_auth_user(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_email text;
  auth_metadata jsonb;
  profile_name text;
  profile_initials text;
  profile_row public.users%rowtype;
begin
  select auth_user.email, coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
    into auth_email, auth_metadata
  from auth.users as auth_user
  where auth_user.id = p_auth_user_id;

  if not found then
    raise exception 'The auth account was not found.';
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

  insert into public.users (id, name, email, initials)
  values (p_auth_user_id, profile_name, auth_email, profile_initials)
  on conflict (id) do update
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

-- This helper accepts an Auth ID, so it remains private to the trigger and
-- the security-definer RPC rather than being callable by browser clients.
revoke all on function public.create_profile_for_auth_user(uuid) from public, anon, authenticated;

create or replace function public.ensure_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user_id uuid := auth.uid();
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to create a user profile.';
  end if;

  return public.create_profile_for_auth_user(current_auth_user_id);
end;
$$;

revoke all on function public.ensure_user_profile() from public, anon;
grant execute on function public.ensure_user_profile() to authenticated;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_profile_for_auth_user(new.id);
  return new;
end;
$$;

revoke all on function public.handle_auth_user_created() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_created();

-- Mirror the former ON DELETE CASCADE relationship now that fixture users
-- cannot have a foreign key to auth.users.
create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.users where id = old.id;
  return old;
end;
$$;

revoke all on function public.handle_auth_user_deleted() from public, anon, authenticated;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- Backfill Auth users created before the trigger. The upsert is safe to rerun.
do $$
declare
  auth_user_id uuid;
begin
  for auth_user_id in select id from auth.users loop
    perform public.create_profile_for_auth_user(auth_user_id);
  end loop;
end;
$$;
