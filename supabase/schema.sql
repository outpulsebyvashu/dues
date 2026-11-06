-- Dues online accounts: run this once in your Supabase project (SQL Editor → New query → paste → Run).
-- One row per account holds that account's Dues data. Row-level security means a signed-in person can only
-- read and write their own row; people who are not signed in (the public anon key) can reach nothing.

create table if not exists public.dues_data (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  version    integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint dues_data_size check (octet_length(data::text) < 5000000)
);

alter table public.dues_data enable row level security;
alter table public.dues_data force row level security;

revoke all on public.dues_data from anon;
revoke all on public.dues_data from authenticated;
grant select, insert, update, delete on public.dues_data to authenticated;

drop policy if exists "own row: read"   on public.dues_data;
drop policy if exists "own row: add"    on public.dues_data;
drop policy if exists "own row: change" on public.dues_data;
drop policy if exists "own row: remove" on public.dues_data;
create policy "own row: read"   on public.dues_data for select to authenticated using (user_id = auth.uid());
create policy "own row: add"    on public.dues_data for insert to authenticated with check (user_id = auth.uid());
create policy "own row: change" on public.dues_data for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own row: remove" on public.dues_data for delete to authenticated using (user_id = auth.uid());

-- Every save moves the version up by exactly one, so two phones can never overwrite each other unnoticed.
create or replace function public.dues_data_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    if new.user_id <> old.user_id then raise exception 'user_id cannot change'; end if;
    if new.version <> old.version + 1 then raise exception 'version must go up by one' using errcode = '40001'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dues_data_guard on public.dues_data;
create trigger dues_data_guard before insert or update on public.dues_data for each row execute function public.dues_data_guard();

-- "Delete my account" in the app: removes the account and (through the cascade) its data.
create or replace function public.delete_my_account() returns void language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
