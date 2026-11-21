-- 作业清：检查 Supabase 是否已完整安装
-- 在 SQL Editor 中执行本文件，只在结果区查看，不会修改数据。

-- 1. 应返回 8 张表，且 rowsecurity 全部为 true。
select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'classes',
    'class_members',
    'students',
    'student_groups',
    'tasks',
    'evaluation_tags',
    'task_records',
    'audit_logs'
  )
order by tablename;

-- 2. 应返回对应的 RLS 策略。
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. 应能看到班级创建、默认标签、updated_by 和审计触发器。
select
  event_object_table,
  trigger_name,
  event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 4. 应看到关键函数。
select
  routine_name,
  routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'generate_class_code',
    'join_class_by_code',
    'create_class_with_owner',
    'is_class_member',
    'is_class_owner',
    'can_edit_task',
    'handle_new_class',
    'seed_default_evaluation_tags',
    'set_insert_operators',
    'set_updated_metadata',
    'write_audit_log'
  )
order by routine_name;

-- 5. 班级号唯一索引应存在。
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'classes';
