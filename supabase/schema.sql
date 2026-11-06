-- ふたりの日: Supabase の SQL Editor に貼り付けて、1度だけ実行する。

create schema if not exists private;

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  end_date date,
  title text not null default '',
  source text not null default 'manual' check (source in ('manual', 'calendar')),
  mood jsonb,
  cover_photo_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  full_path text not null,
  thumb_path text not null,
  category text not null default 'other',
  score real not null default 0,
  taken_at timestamptz,
  dominant text,
  width int,
  height int,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index photos_entry_idx on public.photos (entry_id);

alter table public.entries
  add constraint entries_cover_fk foreign key (cover_photo_id)
  references public.photos (id) on delete set null;

create table public.places (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  name text not null,
  kind text,
  lat double precision,
  lng double precision,
  arrived_at timestamptz,
  created_at timestamptz not null default now()
);
create index places_entry_idx on public.places (entry_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, author_id)
);

create table private.sync_secret (
  id boolean primary key default true check (id),
  hash text not null
);

-- ログイン中の人が、ふたりのどちらかかを確かめる。
create function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

-- 自分がこの日のコメントを書いたか。相手のコメントを読めるようにする条件。
create function public.has_commented(p_entry uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comments
    where entry_id = p_entry and author_id = auth.uid()
  );
$$;

-- 本文は渡さず、誰が書いたかだけを返す。「相手は書いた」の表示に使う。
create function public.comment_flags()
returns table (entry_id uuid, author_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.entry_id, c.author_id from public.comments c where public.is_member();
$$;

create function public.touch_comment()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger comments_touch before update on public.comments
  for each row execute function public.touch_comment();

-- Apps Script からだけ呼ぶ入口。合言葉を確かめ、「会う」の日付を反映する。
-- 予定が消えた日は、写真やコメントがまだ何もないカレンダー由来の記録だけを取り除く。
create function public.sync_calendar(
  p_secret text,
  p_events jsonb,
  p_from date,
  p_to date
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  affected integer;
begin
  if p_secret is null or not exists (
    select 1 from private.sync_secret
    where hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  ) then
    raise exception 'invalid secret' using errcode = '28000';
  end if;

  insert into public.entries (date, end_date, source)
  select (event ->> 'date')::date, nullif(event ->> 'end_date', '')::date, 'calendar'
  from jsonb_array_elements(p_events) as event
  on conflict (date) do update set end_date = excluded.end_date;
  get diagnostics affected = row_count;

  delete from public.entries e
  where e.source = 'calendar'
    and e.date between p_from and p_to
    and e.date not in (
      select (event ->> 'date')::date from jsonb_array_elements(p_events) as event
    )
    and not exists (select 1 from public.photos p where p.entry_id = e.id)
    and not exists (select 1 from public.places p where p.entry_id = e.id)
    and not exists (select 1 from public.comments c where c.entry_id = e.id);

  return affected;
end;
$$;

-- 新しい合言葉を発行する。平文はこの戻り値にしか現れない。
create function private.rotate_sync_secret()
returns text
language plpgsql set search_path = ''
as $$
declare
  secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into private.sync_secret (hash)
  values (encode(sha256(convert_to(secret, 'UTF8')), 'hex'))
  on conflict (id) do update set hash = excluded.hash;
  return secret;
end;
$$;

alter table public.members enable row level security;
alter table public.entries enable row level security;
alter table public.photos enable row level security;
alter table public.places enable row level security;
alter table public.comments enable row level security;
alter table private.sync_secret enable row level security;

create policy members_read on public.members for select to authenticated
  using (public.is_member());
create policy members_rename on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy entries_all on public.entries for all to authenticated
  using (public.is_member()) with check (public.is_member());
create policy photos_all on public.photos for all to authenticated
  using (public.is_member()) with check (public.is_member());
create policy places_all on public.places for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- 自分のコメントはいつでも読める。相手のコメントは自分が書いた後にだけ読める。
create policy comments_read on public.comments for select to authenticated
  using (
    public.is_member()
    and (author_id = auth.uid() or public.has_commented(entry_id))
  );
create policy comments_insert on public.comments for insert to authenticated
  with check (public.is_member() and author_id = auth.uid());
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

revoke all on all tables in schema public from anon;
revoke all on schema private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.has_commented(uuid) from public, anon;
revoke execute on function public.comment_flags() from public, anon;
revoke execute on function public.sync_calendar(text, jsonb, date, date) from public, authenticated;
revoke execute on function private.rotate_sync_secret() from public, anon, authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.has_commented(uuid) to authenticated;
grant execute on function public.comment_flags() to authenticated;
grant execute on function public.sync_calendar(text, jsonb, date, date) to anon;

-- 写真置き場。URL を知っていても読めない非公開バケットにする。
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member());
create policy photos_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member());
create policy photos_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member());
