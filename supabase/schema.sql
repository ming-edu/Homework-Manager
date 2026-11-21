-- 作业清 Supabase 初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。
-- 该脚本会创建表、索引、触发器、审计日志与 RLS 策略。

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. 基础表
-- ---------------------------------------------------------------------------

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  teacher_name text not null default '',
  subject text not null default '',
  class_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint classes_class_code_format check (class_code ~ '^[0-9]{8}$')
);

create unique index if not exists classes_class_code_unique_idx
  on public.classes(class_code);

-- 在创建班级时生成一个数据库范围内唯一的 8 位数字班级码。
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

create table if not exists public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'collaborator')),
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create table if not exists public.student_groups (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default 'blue',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_groups_class_name_unique_idx
  on public.student_groups(class_id, name);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_number integer not null check (student_number > 0),
  name text not null check (char_length(name) between 1 and 80),
  group_id uuid references public.student_groups(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists students_class_number_unique_idx
  on public.students(class_id, student_number);

create index if not exists students_class_id_idx
  on public.students(class_id);

create index if not exists students_group_id_idx
  on public.students(group_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  task_type text not null default '日常作业',
  task_date date not null default current_date,
  due_label text not null default '',
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_class_date_idx
  on public.tasks(class_id, task_date desc);

create table if not exists public.evaluation_tags (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  kind text not null check (kind in ('positive', 'negative')),
  label text not null check (char_length(label) between 1 and 30),
  score integer not null check (score between -20 and 20),
  color text not null default 'blue',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evaluation_tags_class_idx
  on public.evaluation_tags(class_id, kind);

create table if not exists public.task_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'missing' check (status in ('passed', 'review', 'missing', 'excused')),
  tag_ids uuid[] not null default '{}',
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

create index if not exists task_records_task_id_idx
  on public.task_records(task_id);

create index if not exists task_records_student_id_idx
  on public.task_records(student_id);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  class_id uuid not null references public.classes(id) on delete cascade,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid references auth.users(id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_class_created_idx
  on public.audit_logs(class_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. 行级安全辅助函数
-- ---------------------------------------------------------------------------

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

create or replace function public.can_edit_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        t.created_by = auth.uid()
        or exists (
          select 1
          from public.classes c
          where c.id = t.class_id
            and c.owner_id = auth.uid()
        )
      )
  );
$$;

-- 班级创建后自动写入 owner 成员关系。
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

-- 新班级自动获得一组可直接使用的评价标签，仍可由班级 owner 修改。
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

-- 防止把学生分配到其他班级的小组。
create or replace function public.validate_student_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.group_id is not null and not exists (
    select 1
    from public.student_groups g
    where g.id = new.group_id
      and g.class_id = new.class_id
  ) then
    raise exception 'STUDENT_GROUP_CLASS_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_student_group_scope_trigger on public.students;
create trigger validate_student_group_scope_trigger
before insert or update on public.students
for each row execute function public.validate_student_group_scope();

-- 防止作业记录关联其他班级的学生或标签。
create or replace function public.validate_task_record_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_class_id uuid;
begin
  select class_id into task_class_id
  from public.tasks
  where id = new.task_id;

  if task_class_id is null then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.students
    where id = new.student_id and class_id = task_class_id
  ) then
    raise exception 'STUDENT_TASK_CLASS_MISMATCH';
  end if;

  if exists (
    select 1
    from unnest(new.tag_ids) as tag_values(tag_id)
    where not exists (
      select 1 from public.evaluation_tags
      where id = tag_values.tag_id and class_id = task_class_id
    )
  ) then
    raise exception 'TAG_TASK_CLASS_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_record_scope_trigger on public.task_records;
create trigger validate_task_record_scope_trigger
before insert or update on public.task_records
for each row execute function public.validate_task_record_scope();

-- 所有 UPDATE 自动记录操作人和时间，客户端不能伪造 updated_by。
create or replace function public.set_updated_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- INSERT 时同样由数据库写入当前操作人，客户端不能伪造来源账号。
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

drop trigger if exists set_student_groups_insert_operators on public.student_groups;
create trigger set_student_groups_insert_operators
before insert on public.student_groups
for each row execute function public.set_insert_operators();

drop trigger if exists set_students_insert_operators on public.students;
create trigger set_students_insert_operators
before insert on public.students
for each row execute function public.set_insert_operators();

drop trigger if exists set_tasks_insert_operators on public.tasks;
create trigger set_tasks_insert_operators
before insert on public.tasks
for each row execute function public.set_insert_operators();

drop trigger if exists set_evaluation_tags_insert_operators on public.evaluation_tags;
create trigger set_evaluation_tags_insert_operators
before insert on public.evaluation_tags
for each row execute function public.set_insert_operators();

drop trigger if exists set_task_records_insert_operators on public.task_records;
create trigger set_task_records_insert_operators
before insert on public.task_records
for each row execute function public.set_insert_operators();

drop trigger if exists set_classes_updated_metadata on public.classes;
create trigger set_classes_updated_metadata
before update on public.classes
for each row execute function public.set_updated_metadata();

drop trigger if exists set_student_groups_updated_metadata on public.student_groups;
create trigger set_student_groups_updated_metadata
before update on public.student_groups
for each row execute function public.set_updated_metadata();

drop trigger if exists set_students_updated_metadata on public.students;
create trigger set_students_updated_metadata
before update on public.students
for each row execute function public.set_updated_metadata();

drop trigger if exists set_tasks_updated_metadata on public.tasks;
create trigger set_tasks_updated_metadata
before update on public.tasks
for each row execute function public.set_updated_metadata();

drop trigger if exists set_evaluation_tags_updated_metadata on public.evaluation_tags;
create trigger set_evaluation_tags_updated_metadata
before update on public.evaluation_tags
for each row execute function public.set_updated_metadata();

drop trigger if exists set_task_records_updated_metadata on public.task_records;
create trigger set_task_records_updated_metadata
before update on public.task_records
for each row execute function public.set_updated_metadata();

-- 审计记录由数据库触发器写入，客户端只能读取，不能伪造。
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_new jsonb;
  row_old jsonb;
  target_class_id uuid;
  target_row_id text;
begin
  row_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;

  target_class_id := coalesce(
    (row_new ->> 'class_id')::uuid,
    (row_old ->> 'class_id')::uuid
  );

  if tg_table_name = 'classes' then
    target_class_id := coalesce((row_new ->> 'id')::uuid, (row_old ->> 'id')::uuid);
  elsif tg_table_name = 'task_records' then
    select class_id into target_class_id
    from public.tasks
    where id = coalesce((row_new ->> 'task_id')::uuid, (row_old ->> 'task_id')::uuid);
  end if;

  target_row_id := coalesce(
    row_new ->> 'id',
    row_old ->> 'id',
    row_new ->> 'user_id',
    row_old ->> 'user_id',
    'unknown'
  );

  if target_class_id is not null then
    insert into public.audit_logs (
      class_id, table_name, row_id, action, actor_id, old_data, new_data
    ) values (
      target_class_id,
      tg_table_name,
      target_row_id,
      tg_op,
      auth.uid(),
      row_old,
      row_new
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_class_members on public.class_members;
create trigger audit_class_members
after insert or update or delete on public.class_members
for each row execute function public.write_audit_log();

drop trigger if exists audit_classes on public.classes;
create trigger audit_classes
after insert or update on public.classes
for each row execute function public.write_audit_log();

drop trigger if exists audit_student_groups on public.student_groups;
create trigger audit_student_groups
after insert or update or delete on public.student_groups
for each row execute function public.write_audit_log();

drop trigger if exists audit_students on public.students;
create trigger audit_students
after insert or update or delete on public.students
for each row execute function public.write_audit_log();

drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks
after insert or update or delete on public.tasks
for each row execute function public.write_audit_log();

drop trigger if exists audit_evaluation_tags on public.evaluation_tags;
create trigger audit_evaluation_tags
after insert or update or delete on public.evaluation_tags
for each row execute function public.write_audit_log();

drop trigger if exists audit_task_records on public.task_records;
create trigger audit_task_records
after insert or update or delete on public.task_records
for each row execute function public.write_audit_log();

-- 通过班级码加入班级。成员关系只能通过此 RPC 或数据库触发器创建。
create or replace function public.join_class_by_code(p_class_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_class_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into target_class_id
  from public.classes
  where class_code = trim(p_class_code);

  if target_class_id is null then
    raise exception 'CLASS_NOT_FOUND';
  end if;

  insert into public.class_members (class_id, user_id, role, added_by)
  values (target_class_id, auth.uid(), 'collaborator', auth.uid())
  on conflict (class_id, user_id) do nothing;

  return target_class_id;
end;
$$;

-- 在一个安全定义函数中完成班级创建，避免 INSERT 后 RLS 读取时序导致客户端误判失败。
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

-- ---------------------------------------------------------------------------
-- 3. 开启 RLS、收紧权限并创建策略
-- ---------------------------------------------------------------------------

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.student_groups enable row level security;
alter table public.students enable row level security;
alter table public.tasks enable row level security;
alter table public.evaluation_tags enable row level security;
alter table public.task_records enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.classes from anon, authenticated;
revoke all on table public.class_members from anon, authenticated;
revoke all on table public.student_groups from anon, authenticated;
revoke all on table public.students from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.evaluation_tags from anon, authenticated;
revoke all on table public.task_records from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant select, insert, update, delete on table public.classes to authenticated;
grant select, delete on table public.class_members to authenticated;
grant select, insert, update, delete on table public.student_groups to authenticated;
grant select, insert, update, delete on table public.students to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.evaluation_tags to authenticated;
grant select, insert, update, delete on table public.task_records to authenticated;
grant select on table public.audit_logs to authenticated;

-- classes
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

drop policy if exists classes_delete_owner on public.classes;
create policy classes_delete_owner
on public.classes for delete
to authenticated
using (owner_id = auth.uid());

-- class_members
drop policy if exists class_members_select_member on public.class_members;
create policy class_members_select_member
on public.class_members for select
to authenticated
using (public.is_class_member(class_id));

drop policy if exists class_members_delete_self_or_owner on public.class_members;
create policy class_members_delete_self_or_owner
on public.class_members for delete
to authenticated
using (
  role = 'collaborator'
  and (user_id = auth.uid() or public.is_class_owner(class_id))
);

-- student_groups：只有班级创建者可以修改名单结构。
drop policy if exists student_groups_select_member on public.student_groups;
create policy student_groups_select_member
on public.student_groups for select
to authenticated
using (public.is_class_member(class_id));

drop policy if exists student_groups_insert_owner on public.student_groups;
create policy student_groups_insert_owner
on public.student_groups for insert
to authenticated
with check (public.is_class_owner(class_id) and created_by = auth.uid());

drop policy if exists student_groups_update_owner on public.student_groups;
create policy student_groups_update_owner
on public.student_groups for update
to authenticated
using (public.is_class_owner(class_id))
with check (public.is_class_owner(class_id));

drop policy if exists student_groups_delete_owner on public.student_groups;
create policy student_groups_delete_owner
on public.student_groups for delete
to authenticated
using (public.is_class_owner(class_id));

-- students：协作者可查看，名单只能由班级创建者维护。
drop policy if exists students_select_member on public.students;
create policy students_select_member
on public.students for select
to authenticated
using (public.is_class_member(class_id));

drop policy if exists students_insert_owner on public.students;
create policy students_insert_owner
on public.students for insert
to authenticated
with check (public.is_class_owner(class_id) and created_by = auth.uid());

drop policy if exists students_update_owner on public.students;
create policy students_update_owner
on public.students for update
to authenticated
using (public.is_class_owner(class_id))
with check (public.is_class_owner(class_id));

drop policy if exists students_delete_owner on public.students;
create policy students_delete_owner
on public.students for delete
to authenticated
using (public.is_class_owner(class_id));

-- tasks：所有成员可查看；创建者可编辑自己的作业，班级 owner 可管理全部作业。
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
on public.tasks for select
to authenticated
using (public.is_class_member(class_id));

drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
on public.tasks for insert
to authenticated
with check (
  public.is_class_member(class_id)
  and created_by = auth.uid()
);

drop policy if exists tasks_update_creator_or_owner on public.tasks;
create policy tasks_update_creator_or_owner
on public.tasks for update
to authenticated
using (
  created_by = auth.uid()
  or public.is_class_owner(class_id)
)
with check (
  public.is_class_member(class_id)
  and (created_by = auth.uid() or public.is_class_owner(class_id))
);

drop policy if exists tasks_delete_creator_or_owner on public.tasks;
create policy tasks_delete_creator_or_owner
on public.tasks for delete
to authenticated
using (
  created_by = auth.uid()
  or public.is_class_owner(class_id)
);

-- evaluation_tags：成员可查看，协作者只能维护自己创建的标签。
drop policy if exists evaluation_tags_select_member on public.evaluation_tags;
create policy evaluation_tags_select_member
on public.evaluation_tags for select
to authenticated
using (public.is_class_member(class_id));

drop policy if exists evaluation_tags_insert_member on public.evaluation_tags;
create policy evaluation_tags_insert_member
on public.evaluation_tags for insert
to authenticated
with check (
  public.is_class_member(class_id)
  and created_by = auth.uid()
);

drop policy if exists evaluation_tags_update_creator_or_owner on public.evaluation_tags;
create policy evaluation_tags_update_creator_or_owner
on public.evaluation_tags for update
to authenticated
using (
  created_by = auth.uid()
  or public.is_class_owner(class_id)
)
with check (
  public.is_class_member(class_id)
  and (created_by = auth.uid() or public.is_class_owner(class_id))
);

drop policy if exists evaluation_tags_delete_creator_or_owner on public.evaluation_tags;
create policy evaluation_tags_delete_creator_or_owner
on public.evaluation_tags for delete
to authenticated
using (
  created_by = auth.uid()
  or public.is_class_owner(class_id)
);

-- task_records：可以修改的作业，其状态记录才允许修改。
drop policy if exists task_records_select_member on public.task_records;
create policy task_records_select_member
on public.task_records for select
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_class_member(t.class_id)
  )
);

drop policy if exists task_records_insert_task_editor on public.task_records;
create policy task_records_insert_task_editor
on public.task_records for insert
to authenticated
with check (
  public.can_edit_task(task_id)
  and created_by = auth.uid()
);

drop policy if exists task_records_update_task_editor on public.task_records;
create policy task_records_update_task_editor
on public.task_records for update
to authenticated
using (public.can_edit_task(task_id))
with check (public.can_edit_task(task_id));

drop policy if exists task_records_delete_task_editor on public.task_records;
create policy task_records_delete_task_editor
on public.task_records for delete
to authenticated
using (public.can_edit_task(task_id));

-- audit_logs：同班成员只能查看，不能写入或删除。
drop policy if exists audit_logs_select_member on public.audit_logs;
create policy audit_logs_select_member
on public.audit_logs for select
to authenticated
using (public.is_class_member(class_id));

-- ---------------------------------------------------------------------------
-- 4. 函数权限
-- ---------------------------------------------------------------------------

revoke all on function public.generate_class_code() from public, anon;
revoke all on function public.join_class_by_code(text) from public, anon;
revoke all on function public.create_class_with_owner(text, text, text) from public, anon;
revoke all on function public.is_class_member(uuid) from public, anon;
revoke all on function public.is_class_owner(uuid) from public, anon;
revoke all on function public.can_edit_task(uuid) from public, anon;
revoke all on function public.handle_new_class() from public, anon, authenticated;
revoke all on function public.seed_default_evaluation_tags() from public, anon, authenticated;
revoke all on function public.validate_student_group_scope() from public, anon, authenticated;
revoke all on function public.validate_task_record_scope() from public, anon, authenticated;
revoke all on function public.set_updated_metadata() from public, anon, authenticated;
revoke all on function public.set_insert_operators() from public, anon, authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;

grant execute on function public.generate_class_code() to authenticated;
grant execute on function public.join_class_by_code(text) to authenticated;
grant execute on function public.create_class_with_owner(text, text, text) to authenticated;
grant execute on function public.is_class_member(uuid) to authenticated;
grant execute on function public.is_class_owner(uuid) to authenticated;
grant execute on function public.can_edit_task(uuid) to authenticated;

-- 实时同步：协作者看到的数据变更后会自动刷新。
do $$
begin
  alter publication supabase_realtime add table public.students;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.student_groups;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.evaluation_tags;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.task_records;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;

-- 完成后建议在 Supabase 的 Table Editor 中确认：
-- 1. 八个 public 表均显示 RLS enabled。
-- 2. classes.class_code 有唯一索引。
-- 3. tasks 与 task_records 包含 created_by、updated_by。
-- 4. audit_logs 可由同班成员读取，但不能直接写入。
