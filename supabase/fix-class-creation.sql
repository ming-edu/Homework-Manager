-- 作业清：只修复“创建班级”链路
-- 在 Supabase Dashboard → SQL Editor 中整段执行。
-- 本脚本不删除任何班级、学生或作业数据。

begin;

do $$
begin
  if to_regclass('public.classes') is null
     or to_regclass('public.class_members') is null
     or to_regclass('public.evaluation_tags') is null then
    raise exception '基础表缺失，请先完整执行 supabase/schema.sql';
  end if;
end $$;

create or replace function public.generate_class_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate := (10000000 + floor(random() * 90000000)::bigint)::text;
    exit when not exists (
      select 1 from public.classes where class_code = candidate
    );
  end loop;
  return candidate;
end;
$$;

alter table public.classes
  alter column class_code set default public.generate_class_code();

create unique index if not exists classes_class_code_unique_idx
  on public.classes(class_code);

create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_members
    where class_id = p_class_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_class_owner(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.classes
    where id = p_class_id
      and owner_id = auth.uid()
  );
$$;

create or replace function public.set_insert_operators()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'classes' then
    new.owner_id := auth.uid();
  else
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_classes_insert_operators on public.classes;
create trigger set_classes_insert_operators
before insert on public.classes
for each row execute function public.set_insert_operators();

create or replace function public.handle_new_class()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.class_members (class_id, user_id, role, added_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict (class_id, user_id)
  do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists on_class_created on public.classes;
create trigger on_class_created
after insert on public.classes
for each row execute function public.handle_new_class();

create or replace function public.seed_default_evaluation_tags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.evaluation_tags
    (class_id, kind, label, score, color, created_by, updated_by)
  values
    (new.id, 'positive', '优秀', 3, 'coral', new.owner_id, new.owner_id),
    (new.id, 'positive', '格式规范', 1, 'blue', new.owner_id, new.owner_id),
    (new.id, 'positive', '字迹工整', 2, 'green', new.owner_id, new.owner_id),
    (new.id, 'positive', '思路清晰', 2, 'violet', new.owner_id, new.owner_id),
    (new.id, 'negative', '字迹潦草', -2, 'coral', new.owner_id, new.owner_id),
    (new.id, 'negative', '审题不清', -1, 'amber', new.owner_id, new.owner_id),
    (new.id, 'negative', '漏题', -1, 'coral', new.owner_id, new.owner_id),
    (new.id, 'negative', '订正不完整', -1, 'gray', new.owner_id, new.owner_id);
  return new;
end;
$$;

drop trigger if exists seed_default_tags_on_class_created on public.classes;
create trigger seed_default_tags_on_class_created
after insert on public.classes
for each row execute function public.seed_default_evaluation_tags();

create or replace function public.create_class_with_owner(
  p_name text,
  p_teacher_name text,
  p_subject text
)
returns table (
  id uuid,
  owner_id uuid,
  name text,
  teacher_name text,
  subject text,
  class_code text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_class public.classes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.classes (name, teacher_name, subject)
  values (trim(p_name), trim(p_teacher_name), trim(coalesce(p_subject, '')))
  returning * into created_class;

  return query
  select
    c.id,
    c.owner_id,
    c.name,
    c.teacher_name,
    c.subject,
    c.class_code,
    c.created_at,
    c.updated_at
  from public.classes c
  where c.id = created_class.id;
end;
$$;

alter table public.classes enable row level security;
alter table public.class_members enable row level security;

grant select, insert, update, delete on table public.classes to authenticated;
grant select, delete on table public.class_members to authenticated;
grant select on table public.evaluation_tags to authenticated;

drop policy if exists classes_select_member on public.classes;
create policy classes_select_member
on public.classes for select
to authenticated
using (public.is_class_member(id));

drop policy if exists classes_insert_owner on public.classes;
create policy classes_insert_owner
on public.classes for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists classes_update_owner on public.classes;
create policy classes_update_owner
on public.classes for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists class_members_select_member on public.class_members;
create policy class_members_select_member
on public.class_members for select
to authenticated
using (public.is_class_member(class_id));

revoke all on function public.is_class_member(uuid) from public, anon;
revoke all on function public.is_class_owner(uuid) from public, anon;
revoke all on function public.generate_class_code() from public, anon;
revoke all on function public.create_class_with_owner(text, text, text) from public, anon;

grant execute on function public.is_class_member(uuid) to authenticated;
grant execute on function public.is_class_owner(uuid) to authenticated;
grant execute on function public.generate_class_code() to authenticated;
grant execute on function public.create_class_with_owner(text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- 执行完成后应显示 Success. No rows returned。
