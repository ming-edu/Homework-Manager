'use strict';

(() => {
  const CONFIG_STORAGE_KEY = 'zuoyeqing-supabase-config-v1';

  function readStoredConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getConfig() {
    const fromFile = window.SUPABASE_CONFIG || {};
    const fromStorage = readStoredConfig() || {};
    const url = String(fromStorage.url || fromFile.url || '').trim();
    const publishableKey = String(
      fromStorage.publishableKey || fromFile.publishableKey || ''
    ).trim();
    return {
      url,
      publishableKey,
      configured:
        /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) &&
        publishableKey.length > 20 &&
        !publishableKey.includes('YOUR_')
    };
  }

  const config = getConfig();
  let client = null;
  let authSubscription = null;
  let workspaceChannel = null;

  if (config.configured && window.supabase?.createClient) {
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
  }

  function requireClient() {
    if (!client) throw new Error('Supabase 尚未配置或官方库加载失败');
    return client;
  }

  function normalizeError(error, fallback = '云端操作失败') {
    if (!error) return new Error(fallback);
    console.error('[Supabase]', error);
    const messageMap = {
      CLASS_NOT_FOUND: '班级号不存在',
      AUTH_REQUIRED: '请先登录',
      STUDENT_GROUP_CLASS_MISMATCH: '小组不属于当前班级',
      STUDENT_TASK_CLASS_MISMATCH: '学生不属于当前班级',
      TAG_TASK_CLASS_MISMATCH: '评价标签不属于当前班级'
    };
    const rawMessage = error.message || fallback;
    const rawCode = String(error.code || '');
    const rawDetail = `${rawMessage} ${error.details || ''} ${error.hint || ''}`;
    const withRaw = (message) => {
      const wrapped = new Error(message);
      wrapped.rawCode = rawCode;
      wrapped.rawMessage = rawMessage;
      wrapped.rawDetails = error.details || '';
      wrapped.rawHint = error.hint || '';
      return wrapped;
    };
    if (
      rawCode === '42P01' ||
      rawCode === 'PGRST205' ||
      /Could not find the table|relation .* does not exist|schema cache/i.test(rawDetail)
    ) {
      return withRaw('Supabase 业务表尚未创建或未被 Data API 识别。请到 SQL Editor 完整执行 supabase/schema.sql，然后刷新 API schema cache。');
    }
    if (
      rawCode === '42501' ||
      /row-level security|permission denied for table|violates row-level security/i.test(rawDetail)
    ) {
      return withRaw('数据库权限或 RLS 策略不完整。请确认 schema.sql 中的 GRANT、ENABLE ROW LEVEL SECURITY 和全部策略已成功执行。');
    }
    if (rawCode === 'PGRST116') {
      return withRaw('班级写入后无法被当前账号读取。通常是 class_members 自动创建触发器缺失，请重新执行最新版 supabase/schema.sql。');
    }
    if (rawCode === '401' || /JWT|session.*expired|Not authenticated/i.test(rawMessage)) {
      return new Error('登录状态无效或已过期，请退出后重新登录。');
    }
    if (/Invalid login credentials/i.test(rawMessage)) return new Error('邮箱或密码不正确');
    if (/Email not confirmed/i.test(rawMessage)) return new Error('邮箱尚未验证，请先打开验证邮件');
    if (/User already registered/i.test(rawMessage)) return new Error('该邮箱已经注册，请直接登录');
    if (/Password should be at least/i.test(rawMessage)) return new Error('密码至少需要 6 位');
    if (/rate limit/i.test(rawMessage)) return new Error('操作过于频繁，请稍后再试');
    const mappedMessage = messageMap[rawMessage] || rawMessage;
    return withRaw(rawCode ? `${mappedMessage}（错误码 ${rawCode}）` : mappedMessage);
  }

  async function signUp(email, password) {
    const supabase = requireClient();
    const emailRedirectTo = /^https?:$/.test(location.protocol)
      ? `${location.origin}${location.pathname}`
      : undefined;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: emailRedirectTo ? { emailRedirectTo } : undefined
    });
    if (error) throw normalizeError(error, '注册失败');
    return data;
  }

  async function signIn(email, password) {
    const supabase = requireClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw normalizeError(error, '登录失败');
    return data;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw normalizeError(error, '退出登录失败');
  }

  async function getSession() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw normalizeError(error, '读取登录状态失败');
    return data.session;
  }

  function onAuthStateChange(callback) {
    if (!client) return;
    authSubscription?.unsubscribe();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
    authSubscription = data.subscription;
  }

  async function loadClasses() {
    const supabase = requireClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw normalizeError(userError, '读取账号信息失败');
    const { data, error } = await supabase
      .from('class_members')
      .select(`
        role,
        joined_at,
        classes!inner (
          id,
          owner_id,
          name,
          teacher_name,
          subject,
          class_code,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', userData.user?.id || '')
      .order('joined_at', { ascending: true });
    if (error) throw normalizeError(error, '读取班级失败');
    return (data || []).map((membership) => ({
      ...membership.classes,
      role: membership.role,
      joinedAt: membership.joined_at
    }));
  }

  async function inspectSetup() {
    const supabase = requireClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const tables = ['classes', 'class_members', 'students', 'student_groups', 'tasks', 'evaluation_tags', 'task_records', 'audit_logs'];
    const checks = [];
    for (const table of tables) {
      const { error, status } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .limit(1);
      checks.push({
        table,
        ok: !error,
        status,
        code: error?.code || '',
        message: error?.message || ''
      });
    }
    const rpcProbe = await supabase.rpc('create_class_with_owner', {
      p_name: '',
      p_teacher_name: '',
      p_subject: ''
    });
    const rpcAvailable = !rpcProbe.error
      || !['PGRST202', '42883', '42501'].includes(rpcProbe.error.code);
    checks.push({
      table: 'create_class_with_owner',
      ok: rpcAvailable,
      status: rpcProbe.status || 0,
      code: rpcProbe.error?.code || '',
      message: rpcProbe.error?.message || '函数可执行（空参数已由数据库约束拦截）'
    });
    return {
      authenticated: Boolean(userData.user) && !userError,
      email: userData.user?.email || '',
      userId: userData.user?.id || '',
      checks
    };
  }

  async function loadWorkspace(classId) {
    const supabase = requireClient();
    const classResult = await supabase
      .from('classes')
      .select('id,owner_id,name,teacher_name,subject,class_code,created_at,updated_at')
      .eq('id', classId)
      .single();
    if (classResult.error) throw normalizeError(classResult.error, '读取班级信息失败');

    const [membershipResult, groupsResult, studentsResult, tasksResult, tagsResult] = await Promise.all([
      supabase
        .from('class_members')
        .select('role,user_id,joined_at')
        .eq('class_id', classId)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id || ''),
      supabase
        .from('student_groups')
        .select('id,class_id,name,color,created_by,updated_by')
        .eq('class_id', classId)
        .order('created_at', { ascending: true }),
      supabase
        .from('students')
        .select('id,class_id,student_number,name,group_id,created_by,updated_by')
        .eq('class_id', classId)
        .order('student_number', { ascending: true }),
      supabase
        .from('tasks')
        .select('id,class_id,title,task_type,task_date,due_label,note,created_by,updated_by,created_at')
        .eq('class_id', classId)
        .order('task_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('evaluation_tags')
        .select('id,class_id,kind,label,score,color,created_by,updated_by')
        .eq('class_id', classId)
        .order('created_at', { ascending: true })
    ]);

    for (const result of [membershipResult, groupsResult, studentsResult, tasksResult, tagsResult]) {
      if (result.error) throw normalizeError(result.error, '读取班级数据失败');
    }

    const taskIds = (tasksResult.data || []).map((task) => task.id);
    let records = [];
    if (taskIds.length) {
      const recordResult = await supabase
        .from('task_records')
        .select('id,task_id,student_id,status,tag_ids,note,created_by,updated_by,updated_at')
        .in('task_id', taskIds);
      if (recordResult.error) throw normalizeError(recordResult.error, '读取作业状态失败');
      records = recordResult.data || [];
    }

    return {
      classInfo: classResult.data,
      membership: membershipResult.data?.[0] || null,
      groups: groupsResult.data || [],
      students: studentsResult.data || [],
      tasks: tasksResult.data || [],
      tags: tagsResult.data || [],
      records
    };
  }

  async function createClass({ name, teacherName, subject }) {
    const supabase = requireClient();
    let rpcResult = await supabase
      .rpc('create_class_with_owner', {
        p_name: name,
        p_teacher_name: teacherName,
        p_subject: subject || ''
      })
      .single();

    if (!rpcResult.error) return rpcResult.data;
    if (['PGRST202', '42883'].includes(rpcResult.error.code)) {
      throw new Error('数据库函数 create_class_with_owner 尚未生效。请执行最新版 fix-class-creation.sql，并刷新 Data API schema cache。');
    }
    throw normalizeError(rpcResult.error, '创建班级失败');
  }

  async function updateClass(classId, { name, teacherName, subject }) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('classes')
      .update({ name, teacher_name: teacherName, subject })
      .eq('id', classId)
      .select('id,owner_id,name,teacher_name,subject,class_code,created_at,updated_at')
      .single();
    if (error) throw normalizeError(error, '保存班级信息失败');
    return data;
  }

  async function joinClassByCode(classCode) {
    const supabase = requireClient();
    const { data, error } = await supabase.rpc('join_class_by_code', {
      p_class_code: classCode
    });
    if (error) throw normalizeError(error, '加入班级失败');
    return data;
  }

  async function createGroup(row) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('student_groups')
      .insert(row)
      .select('id,class_id,name,color,created_by,updated_by')
      .single();
    if (error) throw normalizeError(error, '创建小组失败');
    return data;
  }

  async function deleteGroup(groupId) {
    const supabase = requireClient();
    const { data, error } = await supabase.from('student_groups').delete().eq('id', groupId).select('id');
    if (error) throw normalizeError(error, '删除小组失败');
    if (!data?.length) throw new Error('没有权限删除该小组');
  }

  async function createStudents(rows) {
    if (!rows.length) return [];
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('students')
      .insert(rows)
      .select('id,class_id,student_number,name,group_id,created_by,updated_by');
    if (error) throw normalizeError(error, '添加学生失败，请检查学号是否重复');
    return data || [];
  }

  async function updateStudent(studentId, patch) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('students')
      .update(patch)
      .eq('id', studentId)
      .select('id,class_id,student_number,name,group_id,created_by,updated_by')
      .single();
    if (error) throw normalizeError(error, '更新学生失败');
    return data;
  }

  async function deleteStudents(studentIds) {
    if (!studentIds.length) return;
    const supabase = requireClient();
    const { data, error } = await supabase.from('students').delete().in('id', studentIds).select('id');
    if (error) throw normalizeError(error, '删除学生失败');
    if (!data?.length) throw new Error('没有权限删除所选学生');
  }

  async function createTask(row) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('tasks')
      .insert(row)
      .select('id,class_id,title,task_type,task_date,due_label,note,created_by,updated_by,created_at')
      .single();
    if (error) throw normalizeError(error, '创建作业失败');
    return data;
  }

  async function updateTask(taskId, patch) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskId)
      .select('id,class_id,title,task_type,task_date,due_label,note,created_by,updated_by,created_at')
      .single();
    if (error) throw normalizeError(error, '更新作业失败，可能没有该作业的编辑权限');
    return data;
  }

  async function deleteTask(taskId) {
    const supabase = requireClient();
    const { data, error } = await supabase.from('tasks').delete().eq('id', taskId).select('id');
    if (error) throw normalizeError(error, '删除作业失败，可能没有该作业的删除权限');
    if (!data?.length) throw new Error('没有权限删除该作业');
  }

  async function saveRecord(row) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('task_records')
      .upsert(row, { onConflict: 'task_id,student_id' })
      .select('id,task_id,student_id,status,tag_ids,note,created_by,updated_by,updated_at')
      .single();
    if (error) throw normalizeError(error, '保存作业状态失败，可能没有该作业的编辑权限');
    return data;
  }

  async function createTag(row) {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('evaluation_tags')
      .insert(row)
      .select('id,class_id,kind,label,score,color,created_by,updated_by')
      .single();
    if (error) throw normalizeError(error, '添加评价标签失败');
    return data;
  }

  async function deleteTag(tagId) {
    const supabase = requireClient();
    const { data, error } = await supabase.from('evaluation_tags').delete().eq('id', tagId).select('id');
    if (error) throw normalizeError(error, '删除评价标签失败');
    if (!data?.length) throw new Error('没有权限删除该评价标签');
  }

  function subscribeWorkspace(classId, onChange) {
    if (!client) return;
    workspaceChannel?.unsubscribe();
    workspaceChannel = client
      .channel(`class-workspace-${classId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'students', filter: `class_id=eq.${classId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_groups', filter: `class_id=eq.${classId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `class_id=eq.${classId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluation_tags', filter: `class_id=eq.${classId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_records' },
        onChange
      )
      .subscribe();
  }

  function unsubscribeWorkspace() {
    workspaceChannel?.unsubscribe();
    workspaceChannel = null;
  }

  window.HomeworkCloud = {
    getConfig,
    isConfigured: () => config.configured,
    hasClient: () => Boolean(client),
    signUp,
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    loadClasses,
    inspectSetup,
    loadWorkspace,
    createClass,
    updateClass,
    joinClassByCode,
    createGroup,
    deleteGroup,
    createStudents,
    updateStudent,
    deleteStudents,
    createTask,
    updateTask,
    deleteTask,
    saveRecord,
    createTag,
    deleteTag,
    subscribeWorkspace,
    unsubscribeWorkspace
  };
})();
