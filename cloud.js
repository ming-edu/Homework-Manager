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
        detectSessionInUrl: true
      }
    });
  }

  function requireClient() {
    if (!client) throw new Error('Supabase 尚未配置或官方库加载失败');
    return client;
  }

  function normalizeError(error, fallback = '云端操作失败') {
    if (!error) return new Error(fallback);
    const messageMap = {
      CLASS_NOT_FOUND: '班级号不存在',
      AUTH_REQUIRED: '请先登录',
      STUDENT_GROUP_CLASS_MISMATCH: '小组不属于当前班级',
      STUDENT_TASK_CLASS_MISMATCH: '学生不属于当前班级',
      TAG_TASK_CLASS_MISMATCH: '评价标签不属于当前班级'
    };
    const rawMessage = error.message || fallback;
    if (/Invalid login credentials/i.test(rawMessage)) return new Error('邮箱或密码不正确');
    if (/Email not confirmed/i.test(rawMessage)) return new Error('邮箱尚未验证，请先打开验证邮件');
    if (/User already registered/i.test(rawMessage)) return new Error('该邮箱已经注册，请直接登录');
    if (/Password should be at least/i.test(rawMessage)) return new Error('密码至少需要 6 位');
    if (/rate limit/i.test(rawMessage)) return new Error('操作过于频繁，请稍后再试');
    return new Error(messageMap[rawMessage] || rawMessage);
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
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await supabase
        .from('classes')
        .insert({
          name,
          teacher_name: teacherName,
          subject
        })
        .select('id,owner_id,name,teacher_name,subject,class_code,created_at,updated_at')
        .single();
      if (!result.error) break;
      const isClassCodeCollision =
        result.error.code === '23505' &&
        `${result.error.message} ${result.error.details || ''}`.includes('class_code');
      if (!isClassCodeCollision) break;
    }
    const { data, error } = result;
    if (error) throw normalizeError(error, '创建班级失败');
    return data;
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
