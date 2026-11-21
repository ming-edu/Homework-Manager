'use strict';

const APP_VERSION = 3;
const ACTIVE_CLASS_KEY = 'zuoyeqing-active-class-v1';
const UI_PREFERENCES_KEY = 'zuoyeqing-ui-preferences-v1';

const STATUS = {
  passed: { label: '已过关', short: '过关', color: '#2f7e9d', bg: '#e6f5f8' },
  review: { label: '待订正', short: '订正', color: '#7964a5', bg: '#f2eff9' },
  missing: { label: '未提交', short: '未交', color: '#bd5d77', bg: '#faecf0' },
  excused: { label: '已请假', short: '请假', color: '#727c91', bg: '#f1f3f7' }
};

const TAG_COLORS = {
  green: { ink: '#2f7e9d', bg: '#e6f5f8' },
  blue: { ink: '#4e70b4', bg: '#eaf0fa' },
  amber: { ink: '#7863a7', bg: '#f1edf8' },
  coral: { ink: '#b85f7a', bg: '#faedf1' },
  violet: { ink: '#7765b0', bg: '#f1eef9' },
  gray: { ink: '#727c91', bg: '#f1f3f7' }
};

const AVATAR_PALETTE = [
  ['#3f719a', '#e8f2f8'],
  ['#7863a7', '#f1edf8'],
  ['#4e70b4', '#eaf0fa'],
  ['#ad5c76', '#faedf1'],
  ['#7765b0', '#f1eef9'],
  ['#66738d', '#f1f3f7']
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const GROUP_COLORS = ['green', 'blue', 'amber', 'coral', 'violet', 'gray'];

const PAGE_META = {
  dashboard: ['作业管理', '今日总览', '把今天的作业进度，放进一张清晰的图里。'],
  register: ['快速登记', '作业登记', '点一下学生卡片，状态、标签与备注一处完成。'],
  feedback: ['家校沟通', '班级反馈', '根据登记结果自动整理，复制后即可发到班级群。'],
  analytics: ['学情洞察', '学生画像', '用过关热力图找出波动，用个人档案看清趋势。'],
  settings: ['工作台设置', '评价设置', '班级、学生名单和评价标签都可以按自己的习惯调整。']
};

function isoDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseStudentEntry(entry) {
  let text = String(entry || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;

  const beforePatterns = [
    /^(?:学号\s*[:：]?\s*)?(\d{1,4})\s*(?:[-–—_:：、./|]\s*|\s+)(.+)$/,
    /^(?:学号\s*[:：]?\s*)?(\d{1,4})([\u3400-\u9fffA-Za-z].*)$/
  ];
  for (const pattern of beforePatterns) {
    const match = text.match(pattern);
    if (match) {
      text = match[2].trim();
      return /^\d+$/.test(text) ? null : { name: text, number: Number(match[1]) || null };
    }
  }

  const afterPatterns = [
    /^(.+?)\s*[（(]\s*(?:学号\s*[:：]?\s*)?(\d{1,4})\s*[）)]$/,
    /^(.+?)\s*学号\s*[:：]?\s*(\d{1,4})$/,
    /^(.+?)\s*(?:[-–—_:：、./|]\s*|\s+)(?:学号\s*[:：]?\s*)?(\d{1,4})$/,
    /^(.+?)(\d{1,4})$/
  ];
  for (const pattern of afterPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      return name && !/^\d+$/.test(name) ? { name, number: Number(match[2]) || null } : null;
    }
  }

  return /^\d+$/.test(text) ? null : { name: text, number: null };
}

function parseStudentEntries(raw) {
  const entries = [];
  String(raw || '').split(/\r?\n/).forEach((line) => {
    const pieces = line.split(/[,，;；、]+/).map((piece) => piece.trim()).filter(Boolean);
    for (let index = 0; index < pieces.length; index += 1) {
      const current = pieces[index];
      const next = pieces[index + 1];
      const currentIsNumber = /^(?:学号\s*[:：]?\s*)?\d{1,4}$/.test(current);
      const nextIsNumber = next ? /^(?:学号\s*[:：]?\s*)?\d{1,4}$/.test(next) : false;
      if (next && currentIsNumber !== nextIsNumber) {
        entries.push(`${current} ${next}`);
        index += 1;
      } else {
        entries.push(current);
      }
    }
  });
  return entries.map(parseStudentEntry).filter(Boolean);
}

function nextAvailableStudentNumber(usedNumbers) {
  let number = 1;
  while (usedNumbers.has(number)) number += 1;
  return number;
}

function makeEmptyState() {
  return {
    version: APP_VERSION,
    classInfo: {
      name: '',
      teacher: '',
      subject: '',
      code: ''
    },
    students: [],
    tasks: [],
    groups: [],
    tags: {
      positive: [
        { id: 'p1', label: '优秀', score: 3, color: 'coral' },
        { id: 'p2', label: '格式规范', score: 1, color: 'blue' },
        { id: 'p3', label: '字迹工整', score: 2, color: 'green' },
        { id: 'p4', label: '思路清晰', score: 2, color: 'violet' }
      ],
      negative: [
        { id: 'n1', label: '字迹潦草', score: -2, color: 'coral' },
        { id: 'n2', label: '审题不清', score: -1, color: 'amber' },
        { id: 'n3', label: '漏题', score: -1, color: 'coral' },
        { id: 'n4', label: '订正不完整', score: -1, color: 'gray' }
      ]
    },
    records: {},
    createdAt: new Date().toISOString()
  };
}

const cloud = window.HomeworkCloud || null;
let currentSession = null;
let currentUser = null;
let cloudClasses = [];
let activeClassId = null;
let currentMembershipRole = 'owner';
let cloudBootstrapping = false;
let realtimeRefreshTimer = null;

let state = makeEmptyState();

function readUiPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || '{}');
    return {
      view: PAGE_META[parsed.view] ? parsed.view : 'dashboard',
      selectedTaskByClass: parsed.selectedTaskByClass && typeof parsed.selectedTaskByClass === 'object'
        ? parsed.selectedTaskByClass
        : {},
      scrollByView: parsed.scrollByView && typeof parsed.scrollByView === 'object'
        ? parsed.scrollByView
        : {}
    };
  } catch {
    return { view: 'dashboard', selectedTaskByClass: {}, scrollByView: {} };
  }
}

function writeUiPreferences(preferences) {
  try {
    localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('页面偏好保存失败', error);
  }
}

const storedUiPreferences = readUiPreferences();
const initialView = PAGE_META[location.hash.slice(1)]
  ? location.hash.slice(1)
  : storedUiPreferences.view;

const ui = {
  view: initialView,
  authMode: 'login',
  selectedTaskId: state.tasks[0]?.id || '',
  query: '',
  statusFilter: 'all',
  groupFilter: 'all',
  hideNames: false,
  studentSelection: new Set(),
  feedbackOptions: {
    showNames: true,
    showReview: true,
    showTags: true
  },
  confirmCallback: null
};

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

function persist() {
  try {
    if (activeClassId) localStorage.setItem(ACTIVE_CLASS_KEY, activeClassId);
    else localStorage.removeItem(ACTIVE_CLASS_KEY);
    const preferences = readUiPreferences();
    preferences.view = ui.view;
    if (activeClassId && ui.selectedTaskId) {
      preferences.selectedTaskByClass[activeClassId] = ui.selectedTaskId;
    }
    writeUiPreferences(preferences);
  } catch (error) {
    console.warn('本地偏好保存失败', error);
  }
}

function setAuthMode(enabled) {
  document.body.classList.toggle('auth-mode', enabled);
  if (enabled) {
    closeModal();
    modalRoot.innerHTML = '';
  }
}

function renderLoadingScreen(message = '正在连接班级云端…') {
  setAuthMode(true);
  app.innerHTML = `
    <section class="auth-screen auth-loading">
      <div class="auth-loading-card">
        <span class="auth-logo">清</span>
        <span class="auth-spinner" aria-hidden="true"></span>
        <h1>${escapeHtml(message)}</h1>
        <p>正在验证登录状态并读取有权限的班级数据。</p>
      </div>
    </section>`;
}

function renderCloudConfigScreen(errorMessage = '') {
  setAuthMode(true);
  const config = cloud?.getConfig?.() || {};
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-visual">
        <div class="auth-brand"><span class="auth-logo">清</span><strong>作业清</strong></div>
        <div>
          <span class="auth-kicker">SUPABASE CLOUD</span>
          <h1>连接你的<br><em>云端班级。</em></h1>
          <p>完成 Supabase 项目配置后，所有教师都会通过自己的邮箱账号访问受权限保护的数据。</p>
        </div>
        <div class="auth-feature-list">
          <span>${icon('users')} 多教师协作</span>
          <span>${icon('save')} 跨设备同步</span>
          <span>${icon('sliders')} 数据库级权限</span>
        </div>
      </div>
      <div class="auth-panel-wrap">
        <form id="cloud-config-form" class="auth-panel">
          <span class="auth-mobile-logo">清</span>
          <span class="auth-kicker">初次配置</span>
          <h2>连接 Supabase</h2>
          <p>填写 Project URL 和 publishable key。不要填写 service_role key。</p>
          <label class="auth-field"><span>Project URL</span><input name="projectUrl" type="url" placeholder="https://xxxx.supabase.co" value="${escapeHtml(config.url || '')}" required></label>
          <label class="auth-field"><span>Publishable key</span><input name="publishableKey" type="text" autocomplete="off" placeholder="sb_publishable_..." value="${escapeHtml(config.publishableKey || '')}" required></label>
          <button class="primary-button auth-submit" type="submit">保存并连接 ${icon('arrow-right')}</button>
          ${errorMessage ? `<div class="auth-message is-error">${escapeHtml(errorMessage)}</div>` : ''}
          <p class="auth-footnote">${cloud?.hasClient?.() ? '' : 'Supabase 官方库尚未加载。请确认网络正常，并通过 HTTPS 网站打开。'}</p>
        </form>
      </div>
    </section>`;
}

function renderAuthScreen(mode = ui.authMode, message = '', messageType = '') {
  ui.authMode = mode;
  setAuthMode(true);
  const isRegister = mode === 'register';
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-visual">
        <div class="auth-brand"><span class="auth-logo">清</span><strong>作业清</strong></div>
        <div>
          <span class="auth-kicker">STUDENT HOMEWORK CLOUD</span>
          <h1>让每一次作业记录<br><em>清楚、有序、可协作。</em></h1>
          <p>每位教师使用自己的账号登录。你创建的班级与作业受数据库行级权限保护，协作者只能看到你授权的班级。</p>
        </div>
        <div class="auth-feature-list">
          <span>${icon('users')} 同班教师协作</span>
          <span>${icon('save')} 云端自动保存</span>
          <span>${icon('eye-off')} 数据彼此隔离</span>
        </div>
        <div class="auth-visual-note">
          <span>${icon('sparkles')}</span>
          <p>一个账号可以创建自己的班级，也可以输入班级码加入其他教师的班级。</p>
        </div>
      </div>
      <div class="auth-panel-wrap">
        <form id="auth-form" class="auth-panel" data-mode="${mode}">
          <span class="auth-mobile-logo">清</span>
          <span class="auth-kicker">${isRegister ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</span>
          <h2>${isRegister ? '创建教师账号' : '登录作业清'}</h2>
          <p>${isRegister ? '使用邮箱和密码注册，注册后即可创建或加入班级。' : '使用你的邮箱和密码继续管理班级。'}</p>
          <label class="auth-field"><span>邮箱</span><input name="email" type="email" autocomplete="email" placeholder="teacher@example.com" required></label>
          <label class="auth-field"><span>密码</span><input name="password" type="password" minlength="6" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="至少 6 位" required></label>
          ${isRegister ? '<label class="auth-field"><span>确认密码</span><input name="passwordConfirm" type="password" minlength="6" autocomplete="new-password" placeholder="再次输入密码" required></label>' : ''}
          <button class="primary-button auth-submit" type="submit">${isRegister ? '注册账号' : '登录'} ${icon('arrow-right')}</button>
          ${message ? `<div class="auth-message ${messageType === 'error' ? 'is-error' : ''}">${escapeHtml(message)}</div>` : ''}
          <div class="auth-switch">
            <span>${isRegister ? '已经有账号？' : '还没有账号？'}</span>
            <button type="button" data-action="auth-switch" data-mode="${isRegister ? 'login' : 'register'}">${isRegister ? '直接登录' : '创建账号'}</button>
          </div>
          <p class="auth-footnote">登录即表示你使用自己的独立教师账号访问云端数据。</p>
        </form>
      </div>
    </section>`;
}

function mapCloudWorkspace(payload) {
  const classInfo = payload.classInfo;
  const role = payload.membership?.role
    || (classInfo.owner_id === currentUser?.id ? 'owner' : 'collaborator');
  currentMembershipRole = role;
  const groups = payload.groups.map((group) => ({
    id: group.id,
    name: group.name,
    color: group.color,
    createdBy: group.created_by,
    updatedBy: group.updated_by
  }));
  const students = payload.students.map((student) => ({
    id: student.id,
    number: student.student_number,
    name: student.name,
    groupId: student.group_id || '',
    createdBy: student.created_by,
    updatedBy: student.updated_by
  }));
  const tasks = payload.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    type: task.task_type,
    date: task.task_date,
    due: task.due_label || '',
    note: task.note || '',
    createdBy: task.created_by,
    updatedBy: task.updated_by,
    createdAt: task.created_at
  }));
  const records = {};
  payload.records.forEach((record) => {
    if (!records[record.task_id]) records[record.task_id] = {};
    records[record.task_id][record.student_id] = {
      id: record.id,
      status: record.status,
      tags: record.tag_ids || [],
      note: record.note || '',
      createdBy: record.created_by,
      updatedBy: record.updated_by,
      updatedAt: record.updated_at
    };
  });
  return {
    version: APP_VERSION,
    classInfo: {
      id: classInfo.id,
      ownerId: classInfo.owner_id,
      name: classInfo.name,
      teacher: classInfo.teacher_name,
      subject: classInfo.subject,
      code: classInfo.class_code,
      role,
      updatedAt: classInfo.updated_at
    },
    students,
    tasks,
    groups,
    tags: {
      positive: payload.tags
        .filter((tag) => tag.kind === 'positive')
        .map((tag) => ({ id: tag.id, label: tag.label, score: tag.score, color: tag.color, createdBy: tag.created_by })),
      negative: payload.tags
        .filter((tag) => tag.kind === 'negative')
        .map((tag) => ({ id: tag.id, label: tag.label, score: tag.score, color: tag.color, createdBy: tag.created_by }))
    },
    records,
    createdAt: classInfo.created_at
  };
}

function canManageClass() {
  return Boolean(
    state.classInfo.id &&
    state.classInfo.ownerId &&
    currentUser?.id === state.classInfo.ownerId
  );
}

function canEditTask(task) {
  if (!task) return false;
  return currentMembershipRole === 'owner' || task.createdBy === currentUser?.id;
}

async function openCloudClass(classId) {
  if (!cloud?.hasClient() || !classId) return;
  const previousClassId = activeClassId;
  activeClassId = classId;
  try {
    const payload = await cloud.loadWorkspace(classId);
    state = mapCloudWorkspace(payload);
    const preferences = readUiPreferences();
    const previousTaskId = preferences.selectedTaskByClass[classId];
    ui.selectedTaskId = state.tasks.some((task) => task.id === previousTaskId)
      ? previousTaskId
      : state.tasks[0]?.id || '';
    ui.statusFilter = 'all';
    ui.query = '';
    ui.groupFilter = 'all';
    ui.studentSelection.clear();
    persist();
    setAuthMode(false);
    render();
    const savedScroll = Number(preferences.scrollByView[ui.view] || 0);
    if (savedScroll > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'auto' }));
    }
    cloud.unsubscribeWorkspace();
    cloud.subscribeWorkspace(classId, scheduleCloudRefresh);
  } catch (error) {
    activeClassId = previousClassId;
    throw error;
  }
}

function scheduleCloudRefresh() {
  window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(() => refreshCloudWorkspace(true), 450);
}

async function refreshCloudWorkspace(silent = false) {
  if (!cloud?.hasClient() || !activeClassId) return;
  try {
    const payload = await cloud.loadWorkspace(activeClassId);
    const selectedTaskId = ui.selectedTaskId;
    state = mapCloudWorkspace(payload);
    ui.selectedTaskId = state.tasks.some((task) => task.id === selectedTaskId)
      ? selectedTaskId
      : state.tasks[0]?.id || '';
    render();
  } catch (error) {
    if (!silent) showToast(error.message || '刷新云端数据失败', 'alert');
  }
}

async function enterCloudApp(session) {
  if (!session?.user || cloudBootstrapping) return;
  if (currentUser?.id === session.user.id && activeClassId) {
    currentSession = session;
    return;
  }
  cloudBootstrapping = true;
  currentSession = session;
  currentUser = session.user;
  renderLoadingScreen();
  try {
    cloudClasses = await cloud.loadClasses();
    if (!cloudClasses.length) {
      activeClassId = null;
      currentMembershipRole = 'owner';
      state = makeEmptyState();
      persist();
      setAuthMode(false);
      render();
      return;
    }
    const savedClassId = localStorage.getItem(ACTIVE_CLASS_KEY);
    const preferred = cloudClasses.find((item) => item.id === savedClassId) || cloudClasses[0];
    await openCloudClass(preferred.id);
  } catch (error) {
    console.error(error);
    currentSession = null;
    currentUser = null;
    renderAuthScreen(ui.authMode, error.message || '读取账号数据失败，请重新登录', 'error');
  } finally {
    cloudBootstrapping = false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function getTask(taskId = ui.selectedTaskId) {
  return state.tasks.find((task) => task.id === taskId) || state.tasks[0] || null;
}

function getStudent(studentId) {
  return state.students.find((student) => student.id === studentId) || null;
}

function allTags() {
  return [...state.tags.positive, ...state.tags.negative];
}

function getTag(tagId) {
  return allTags().find((tag) => tag.id === tagId) || null;
}

function getGroup(groupId) {
  return state.groups.find((group) => group.id === groupId) || null;
}

function groupTagStyle(group) {
  const color = TAG_COLORS[group?.color] || TAG_COLORS.gray;
  return `--tag-color:${color.ink};--tag-bg:${color.bg}`;
}

function studentMatchesGroup(student) {
  if (ui.groupFilter === 'all') return true;
  if (ui.groupFilter === 'ungrouped') return !student.groupId;
  return student.groupId === ui.groupFilter;
}

function studentMatchesFilters(task, student) {
  const record = getRecord(task.id, student.id);
  const statusMatch = ui.statusFilter === 'all' || record.status === ui.statusFilter;
  const queryMatch = !ui.query || student.name.includes(ui.query) || String(student.number).includes(ui.query);
  return statusMatch && queryMatch && studentMatchesGroup(student);
}

function classDisplayName() {
  return state.classInfo.name || '尚未设置班级';
}

function teacherDisplayName() {
  return state.classInfo.teacher || '教师';
}

function getRecord(taskId, studentId) {
  if (!state.records[taskId]) state.records[taskId] = {};
  if (!state.records[taskId][studentId]) {
    state.records[taskId][studentId] = {
      status: 'missing',
      tags: [],
      note: ''
    };
  }
  const record = state.records[taskId][studentId];
  if (!Array.isArray(record.tags)) record.tags = [];
  if (!STATUS[record.status]) record.status = 'missing';
  record.note = String(record.note || '');
  return record;
}

function countsForTask(taskId) {
  const counts = { passed: 0, review: 0, missing: 0, excused: 0 };
  state.students.forEach((student) => {
    counts[getRecord(taskId, student.id).status] += 1;
  });
  return counts;
}

function setClassLabels() {
  document.querySelectorAll('.class-switcher > span:nth-child(2)').forEach((element) => {
    element.textContent = classDisplayName();
  });
  const profileSmall = document.querySelector('.profile-button small');
  if (profileSmall) profileSmall.textContent = classDisplayName();
  const profileStrong = document.querySelector('.profile-button strong');
  if (profileStrong) profileStrong.textContent = teacherDisplayName();
  const avatar = document.querySelector('.profile-button .avatar');
  if (avatar) avatar.textContent = teacherDisplayName().slice(0, 1);
}

function setPageMeta() {
  const meta = PAGE_META[ui.view] || PAGE_META.dashboard;
  document.getElementById('page-eyebrow').textContent = meta[0];
  document.getElementById('page-title').textContent = meta[1];
  document.getElementById('page-subtitle').textContent = meta[2];
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === ui.view);
  });
}

function navigate(view) {
  if (!PAGE_META[view]) return;
  const viewChanged = ui.view !== view;
  ui.view = view;
  if (viewChanged) {
    ui.query = '';
    ui.statusFilter = 'all';
    ui.groupFilter = 'all';
  }
  history.replaceState(null, '', `#${view}`);
  persist();
  render();
  app.focus({ preventScroll: true });
  if (viewChanged) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  setClassLabels();
  setPageMeta();
  const renderers = {
    dashboard: renderDashboard,
    register: renderRegister,
    feedback: renderFeedback,
    analytics: renderAnalytics,
    settings: renderSettings
  };
  app.innerHTML = renderers[ui.view]();
}

function parseDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isToday(value) {
  return value === isoDaysAgo(0);
}

function formatTaskDate(value) {
  const date = parseDate(value);
  if (isToday(value)) return `今天 · ${WEEKDAYS[date.getDay()]}`;
  if (value === isoDaysAgo(1)) return `昨天 · ${WEEKDAYS[date.getDay()]}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
}

function formatShortDate(value) {
  const date = parseDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFullDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

function avatarStyle(studentId) {
  const index = Math.max(0, state.students.findIndex((student) => student.id === studentId));
  const pair = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
  return `--avatar-ink:${pair[0]};--avatar-bg:${pair[1]}`;
}

function tagStyle(tag) {
  const color = TAG_COLORS[tag.color] || TAG_COLORS.green;
  return `--tag-color:${color.ink};--tag-bg:${color.bg}`;
}

function renderSetupDashboard() {
  const hasClass = Boolean(state.classInfo.id);
  const hasStudents = state.students.length > 0;
  const completed = [hasClass, hasStudents, false].filter(Boolean).length;
  return `
    <div class="view dashboard-view">
      <section class="setup-hero">
        <div>
          <span class="setup-kicker">${icon('sparkles')} 从空白开始，按你的班级来设置</span>
          <h2>把作业管理，整理成<br><em>清楚又好用的工作台。</em></h2>
          <p>先设置班级信息，再批量导入学生名单。完成之后，每次作业都可以直接登记、生成反馈并查看学情。</p>
          <div class="hero-actions">
            <button class="primary-button coral" type="button" data-view="settings">${icon('sliders')}${hasClass ? '设置班级' : '创建班级'}</button>
            <button class="secondary-button" type="button" data-action="${hasClass ? 'manage-students' : 'open-join-class'}">${icon('users')}${hasClass ? '导入学生名单' : '输入班级码加入'}</button>
          </div>
        </div>
        <div class="setup-progress-card">
          <span>初始化进度</span>
          <strong>${completed}<small>/ 2</small></strong>
          <div class="setup-progress-track"><i style="width:${completed * 50}%"></i></div>
          <p>设置完成后即可创建第一项作业。</p>
        </div>
      </section>

      <section class="setup-steps">
        <article class="card setup-step ${hasClass ? 'is-complete' : ''}">
          <span class="setup-step-number">01</span>
          <span class="setup-step-icon">${icon('sliders')}</span>
          <h3>创建或加入班级</h3>
          <p>创建自己的班级，或输入同班教师的 8 位班级码加入。</p>
          <button type="button" class="text-link" data-view="settings">${hasClass ? '查看班级设置' : '开始设置'} ${icon('arrow-right')}</button>
        </article>
        <article class="card setup-step ${hasStudents ? 'is-complete' : ''}">
          <span class="setup-step-number">02</span>
          <span class="setup-step-icon">${icon('users')}</span>
          <h3>导入学生名单</h3>
          <p>支持批量粘贴姓名，也可以创建小组并批量分配。</p>
          <button type="button" class="text-link" data-action="${hasClass ? 'manage-students' : 'open-join-class'}">${hasStudents ? `${canManageClass() ? '管理' : '查看'} ${state.students.length} 名学生` : hasClass ? '导入名单' : '加入已有班级'} ${icon('arrow-right')}</button>
        </article>
        <article class="card setup-step">
          <span class="setup-step-number">03</span>
          <span class="setup-step-icon">${icon('book')}</span>
          <h3>创建第一项作业</h3>
          <p>新建作业后即可逐人登记过关、订正和提交状态。</p>
          <button type="button" class="text-link" data-action="new-task">${icon('plus')}登记作业</button>
        </article>
      </section>
    </div>`;
}

function renderDashboard() {
  const task = getTask();
  if (!task) return renderSetupDashboard();

  const counts = countsForTask(task.id);
  const taskEditable = canEditTask(task);
  const total = Math.max(1, state.students.length);
  const progress = Math.round((counts.passed / total) * 100);
  const submitted = counts.passed + counts.review;
  const tagCount = state.students.reduce((sum, student) => {
    return sum + getRecord(task.id, student.id).tags.length;
  }, 0);
  const attention = state.students
    .map((student) => ({ student, record: getRecord(task.id, student.id) }))
    .filter(({ record }) => record.status === 'review' || record.status === 'missing')
    .slice(0, 4);

  const taskRows = state.tasks.slice(0, 5).map((item) => {
    const itemCounts = countsForTask(item.id);
    const rate = Math.round((itemCounts.passed / total) * 100);
    const date = parseDate(item.date);
    return `
      <div class="compact-task-row" data-action="go-task" data-task-id="${escapeHtml(item.id)}" role="button" tabindex="0">
        <div class="task-date-block"><strong>${date.getDate()}</strong><small>${date.getMonth() + 1}月</small></div>
        <div class="compact-task-name">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.type)} · ${itemCounts.passed} 人已过关</small>
        </div>
        <div class="mini-progress" aria-label="过关率 ${rate}%"><span style="width:${rate}%"></span></div>
        <div class="complete-rate">${rate}<small>%</small></div>
      </div>`;
  }).join('');

  const attentionHtml = attention.length ? attention.map(({ student, record }) => `
    <div class="focus-item" data-action="${taskEditable ? 'evaluate' : 'student-profile'}" data-student-id="${escapeHtml(student.id)}" role="button" tabindex="0">
      <span class="student-mini-avatar" style="${avatarStyle(student.id)}">${escapeHtml(student.name.slice(0, 1))}</span>
      <span><strong>${escapeHtml(student.name)}</strong><small>${record.status === 'missing' ? '本次作业尚未提交' : '已提交，仍有内容需要订正'}</small></span>
      <span class="focus-reason">${STATUS[record.status].short}</span>
    </div>`).join('') : `
    <div class="empty-inline">${icon('trophy')}<br>本次作业暂无待关注学生</div>`;

  return `
    <div class="view dashboard-view">
      <section class="hero">
        <div class="hero-copy">
          <div class="hero-kicker">${icon('sparkles')} ${formatFullDate()} · ${escapeHtml(state.classInfo.subject || '作业记录')}</div>
          <h2>记录每一次过关，<br><em>看见每一点进步。</em></h2>
          <p>“${escapeHtml(task.title)}”已登记 ${submitted} 份。班级反馈与学情统计会随登记结果同步更新。</p>
          <div class="hero-actions">
            <button class="primary-button" type="button" data-action="go-register">继续登记 ${icon('arrow-right')}</button>
            <button class="secondary-button" type="button" data-action="view-feedback">查看班级反馈</button>
          </div>
        </div>
        <div class="hero-progress">
          <div class="progress-ring" style="--progress:${progress}">
            <div class="progress-value"><strong>${progress}%</strong><small>本次过关率</small></div>
          </div>
          <div class="hero-breakdown">
            <div class="hero-breakdown-row"><i style="--dot:#71e2b2"></i><span>已过关</span><strong>${counts.passed}</strong></div>
            <div class="hero-breakdown-row"><i style="--dot:#f5c977"></i><span>待订正</span><strong>${counts.review}</strong></div>
            <div class="hero-breakdown-row"><i style="--dot:#f08b86"></i><span>未提交</span><strong>${counts.missing}</strong></div>
          </div>
        </div>
      </section>

      <section class="stat-grid" aria-label="今日关键数据">
        ${statCard('users', '班级人数', state.students.length, `本次共 ${state.students.length} 人`, '#5883c7', '#eaf1fb')}
        ${statCard('check-square', '已过关', counts.passed, `较上次进度 ${progress >= 70 ? '稳步提升' : '仍可推进'}`, '#2f7e9d', '#e6f5f8')}
        ${statCard('clock', '待订正', counts.review, counts.review ? '需要逐项跟进' : '当前没有待订正', '#7964a5', '#f2eff9')}
        ${statCard('message', '评价标签', tagCount, `本项作业已使用 ${tagCount} 次`, '#7765b0', '#f1eef9')}
      </section>

      <section class="dashboard-grid">
        <article class="card task-overview-card">
          <div class="section-heading">
            <div><h2>最近作业</h2><p>每一条进度都来自学生卡片中的实时状态。</p></div>
            <button type="button" class="text-link" data-view="register">全部作业 ${icon('arrow-right')}</button>
          </div>
          <div class="task-list-compact">${taskRows}</div>
        </article>
        <article class="card focus-card">
          <div class="section-heading">
            <div><h2>今日需关注</h2><p>优先处理未提交和待订正。</p></div>
            <span class="focus-reason">${counts.review + counts.missing} 人</span>
          </div>
          <div class="focus-list">${attentionHtml}</div>
        </article>
      </section>
    </div>`;
}

function statCard(iconName, label, value, detail, color, bg) {
  return `
    <article class="stat-card" style="--accent:${color};--accent-soft:${bg}">
      <div class="stat-top"><span class="stat-icon">${icon(iconName)}</span><span>${escapeHtml(label)}</span></div>
      <strong>${value}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>`;
}

function renderEmptyState(title, description, action, label) {
  return `
    <section class="card task-overview-card" style="text-align:center;padding:70px 20px">
      <span class="stat-icon" style="margin:0 auto;width:50px;height:50px;color:var(--forest);background:var(--mint)">${icon('book')}</span>
      <h2 style="margin-top:16px">${escapeHtml(title)}</h2>
      <p style="margin:8px 0 20px;color:var(--ink-faint);font-size:11px">${escapeHtml(description)}</p>
      <button class="primary-button" type="button" data-action="${escapeHtml(action)}">${icon('plus')}${escapeHtml(label)}</button>
    </section>`;
}

function renderRegister() {
  const task = getTask();
  const taskPanel = `
    <aside class="card task-panel">
      <div class="task-panel-heading">
        <strong>作业列表</strong>
        <button type="button" class="round-add" data-action="new-task" aria-label="新登记作业">${icon('plus')}</button>
      </div>
      <div class="task-list">
        ${state.tasks.length ? state.tasks.map((item) => {
          const counts = countsForTask(item.id);
          const editable = canEditTask(item);
          return `
            <div class="task-item ${item.id === ui.selectedTaskId ? 'is-active' : ''}" data-action="go-task" data-task-id="${escapeHtml(item.id)}" role="button" tabindex="0">
              <div class="task-item-date"><i></i>${formatTaskDate(item.date)}</div>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${counts.passed}/${state.students.length} 已过关${!editable ? ' · 只读' : ''}</small>
              ${editable ? `<div class="task-item-actions">
                <button class="task-mini-action" type="button" data-action="edit-task" data-task-id="${escapeHtml(item.id)}" aria-label="编辑作业">${icon('edit')}</button>
                <button class="task-mini-action" type="button" data-action="delete-task" data-task-id="${escapeHtml(item.id)}" aria-label="删除作业">${icon('trash')}</button>
              </div>` : ''}
            </div>`;
        }).join('') : '<div class="empty-inline">暂无作业，点击右上角添加</div>'}
      </div>
    </aside>`;

  if (!task) {
    return `<div class="view register-layout">${taskPanel}${renderEmptyState('还没有作业', '登记第一项作业后，学生状态卡片会出现在这里。', 'new-task', '登记作业')}</div>`;
  }

  const counts = countsForTask(task.id);
  const filtered = state.students.filter((student) => studentMatchesFilters(task, student));

  return `
    <div class="view register-layout">
      ${taskPanel}
      <section class="card register-workspace">
        <div class="workspace-title-row">
          <div>
            <div class="hero-kicker" style="color:var(--coral);margin-bottom:2px">${escapeHtml(task.type)}</div>
            <h2>${escapeHtml(task.title)}</h2>
            <div class="workspace-meta">
              <span>${icon('calendar')}${formatTaskDate(task.date)}</span>
              <span>${icon('clock')}${escapeHtml(task.due || '未设置截止时间')}</span>
              <span>${icon('users')}${state.students.length} 名学生</span>
            </div>
          </div>
          <button class="primary-button" type="button" data-action="new-task">${icon('plus')}登记另一项</button>
        </div>

        <div class="status-summary">
          <button type="button" class="summary-button ${ui.statusFilter === 'passed' ? 'is-active' : ''}" data-action="filter-status" data-status="passed" style="--summary-bg:#e6f5f8;--summary-color:#2f7e9d">
            <span>已过关</span><strong>${counts.passed}</strong><small>点击只看这些学生</small>
          </button>
          <button type="button" class="summary-button ${ui.statusFilter === 'review' ? 'is-active' : ''}" data-action="filter-status" data-status="review" style="--summary-bg:#f2eff9;--summary-color:#7964a5">
            <span>待订正</span><strong>${counts.review}</strong><small>需要再次提交</small>
          </button>
          <button type="button" class="summary-button ${ui.statusFilter === 'missing' ? 'is-active' : ''}" data-action="filter-status" data-status="missing" style="--summary-bg:#faecf0;--summary-color:#bd5d77">
            <span>未提交</span><strong>${counts.missing}</strong><small>及时提醒补交</small>
          </button>
          <button type="button" class="summary-button ${ui.statusFilter === 'excused' ? 'is-active' : ''}" data-action="filter-status" data-status="excused" style="--summary-bg:#f1f3f7;--summary-color:#727c91">
            <span>已请假</span><strong>${counts.excused}</strong><small>不参与本次统计</small>
          </button>
        </div>

        <div class="roster-toolbar">
          <div class="roster-heading"><strong>学生名单</strong><span id="roster-visible-count">${filtered.length} / ${state.students.length} 人</span></div>
          <div class="toolbar-actions">
            <label class="search-field">
              ${icon('search')}
              <input id="roster-search" type="search" placeholder="搜索姓名或学号" value="${escapeHtml(ui.query)}" autocomplete="off">
            </label>
            <label class="group-filter-wrap" title="按小组筛选">
              ${icon('users')}
              <select id="group-filter" aria-label="按小组筛选">
                <option value="all" ${ui.groupFilter === 'all' ? 'selected' : ''}>全部小组</option>
                ${state.groups.map((group) => `<option value="${escapeHtml(group.id)}" ${ui.groupFilter === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
                <option value="ungrouped" ${ui.groupFilter === 'ungrouped' ? 'selected' : ''}>未分组</option>
              </select>
            </label>
            <button type="button" class="small-action ${ui.hideNames ? 'is-active' : ''}" data-action="toggle-names">
              ${icon('eye-off')}<span>${ui.hideNames ? '显示姓名' : '隐藏姓名'}</span>
            </button>
            <button type="button" class="small-action ${ui.statusFilter !== 'all' ? 'is-active' : ''}" data-action="clear-filter">
              ${icon('filter')}<span>${ui.statusFilter === 'all' ? '全部状态' : '清除筛选'}</span>
            </button>
          </div>
        </div>

        <div class="roster-grid" id="roster-grid">
          ${state.students.length ? state.students.map((student) => renderStudentTile(task, student)).join('') : `
            <div class="roster-empty-state">
              ${icon('users')}
              <strong>还没有学生</strong>
              <p>批量粘贴学生姓名，创建后即可开始登记。</p>
              <button type="button" class="primary-button" data-action="manage-students">${icon('plus')}导入学生名单</button>
            </div>`}
        </div>

        <div class="legend-row">
          <div class="legend">
            <span><i style="--legend:#2f7e9d"></i>已过关</span>
            <span><i style="--legend:#7964a5"></i>待订正</span>
            <span><i style="--legend:#bd5d77"></i>未提交</span>
            <span><i style="--legend:#8b9c98"></i>已请假</span>
          </div>
          <span class="save-hint">${icon('save')}点击学生后保存，自动同步全部统计</span>
        </div>
      </section>
    </div>`;
}

function renderStudentTile(task, student) {
  const record = getRecord(task.id, student.id);
  const matches = studentMatchesFilters(task, student);
  const tags = record.tags.map(getTag).filter(Boolean);
  const taskEditable = canEditTask(task);
  return `
    <button type="button" class="student-tile status-${record.status} ${ui.hideNames ? 'hide-name' : ''}" data-action="${taskEditable ? 'evaluate' : 'student-profile'}" data-student-id="${escapeHtml(student.id)}" data-name="${escapeHtml(student.name)}" data-number="${student.number}" data-status="${record.status}" data-group="${escapeHtml(student.groupId || '')}" ${matches ? '' : 'hidden'}>
      <span class="student-number">${String(student.number).padStart(2, '0')}</span>
      ${tags.length ? `<span class="tile-tags"><span class="tile-tag-count"><span>${tags.length}</span></span></span>` : ''}
      <span class="student-name">${escapeHtml(student.name)}</span>
      <span class="student-status-text"><i></i>${STATUS[record.status].short}</span>
    </button>`;
}

function buildFeedbackText(task, options = ui.feedbackOptions) {
  const counts = countsForTask(task.id);
  const total = state.students.length;
  const passed = state.students.filter((student) => getRecord(task.id, student.id).status === 'passed');
  const review = state.students.filter((student) => getRecord(task.id, student.id).status === 'review');
  const missing = state.students.filter((student) => getRecord(task.id, student.id).status === 'missing');
  const excused = state.students.filter((student) => getRecord(task.id, student.id).status === 'excused');
  const submitted = counts.passed + counts.review;
  const percent = Math.round((counts.passed / Math.max(1, total)) * 100);
  const nameList = (students) => {
    if (!students.length) return '无';
    if (!options.showNames) return `共 ${students.length} 人`;
    return students.map((student) => student.name).join('、');
  };

  const positiveLines = state.tags.positive.map((tag) => {
    const names = state.students.filter((student) => getRecord(task.id, student.id).tags.includes(tag.id));
    return names.length ? `${tag.label}：${nameList(names)}` : '';
  }).filter(Boolean);
  const attentionLines = state.tags.negative.map((tag) => {
    const names = state.students.filter((student) => getRecord(task.id, student.id).tags.includes(tag.id));
    return names.length ? `${tag.label}：${nameList(names)}` : '';
  }).filter(Boolean);

  const lines = [
    `【${state.classInfo.subject}作业反馈】${formatTaskDate(task.date)}`,
    `作业内容：${task.title}`,
    '',
    `已提交 ${submitted}/${total} 人，已过关 ${counts.passed} 人（${percent}%）。`,
    options.showReview ? `待订正：${nameList(review)}` : `待订正：共 ${review.length} 人`,
    `未提交：${nameList(missing)}`
  ];
  if (excused.length) lines.push(`已请假：${nameList(excused)}`);
  if (options.showTags && positiveLines.length) {
    lines.push('', '【值得表扬】', ...positiveLines);
  }
  if (options.showTags && attentionLines.length) {
    lines.push('', '【温馨提示】', ...attentionLines);
  }
  lines.push(
    '',
    review.length || missing.length
      ? '请相关同学在明天到校后完成补交或订正，感谢家长配合。'
      : '本次作业整体完成情况良好，感谢大家配合。',
    `—— ${state.classInfo.teacher}`
  );
  return lines.join('\n');
}

function renderFeedback() {
  const task = getTask();
  if (!task) return renderEmptyState('还没有可反馈的作业', '先登记一项作业，系统会自动生成班级反馈。', 'new-task', '登记作业');
  const text = buildFeedbackText(task);
  const counts = countsForTask(task.id);
  const formatted = escapeHtml(text).replace(/【(.+?)】/g, '<b>【$1】</b>').replaceAll('\n', '<br>');
  return `
    <div class="view feedback-view">
      <div class="feedback-layout">
        <section class="card feedback-card">
          <span class="feedback-badge">${icon('sparkles')} 当前作业：${escapeHtml(task.title)}</span>
          <h2>把作业情况整理成<br>清楚、温和的反馈。</h2>
          <p>系统按“已过关、待订正、未提交、请假”自动归类，并把本次评价标签一起汇总。文案生成后可立即复制到班级群。</p>
          <div class="feedback-options">
            ${feedbackOption('showNames', '展示学生姓名', '关闭后会以人数代替具体名单', ui.feedbackOptions.showNames)}
            ${feedbackOption('showReview', '列出待订正学生', '便于家长直接找到需要跟进的孩子', ui.feedbackOptions.showReview)}
            ${feedbackOption('showTags', '附带个性化标签', '汇总表扬项和提示项，让反馈更有依据', ui.feedbackOptions.showTags)}
          </div>
          <div class="feedback-note">
            <div><strong>本次数据已就绪</strong><small>${counts.passed} 人过关 · ${counts.review} 人待订正 · ${counts.missing} 人未交</small></div>
            <button type="button" class="text-link" data-view="register">修改登记 ${icon('arrow-right')}</button>
          </div>
        </section>

        <section class="card preview-card">
          <div class="preview-top">
            <h2>反馈文案预览</h2>
            <span class="live-badge"><i></i>实时更新</span>
          </div>
          <div class="chat-preview">
            <div class="chat-sender">
              <span class="avatar">${escapeHtml(state.classInfo.teacher.slice(0, 1))}</span>
              <span><strong>${escapeHtml(state.classInfo.teacher)}</strong><small>${escapeHtml(state.classInfo.name)} · 刚刚</small></span>
            </div>
            <p class="feedback-text">${formatted}</p>
          </div>
          <div class="preview-actions">
            <button type="button" class="secondary-button" data-action="download-feedback">${icon('download')}保存为文本</button>
            <button type="button" class="primary-button copy-button" data-action="copy-feedback">${icon('copy')}复制反馈到剪贴板</button>
          </div>
        </section>
      </div>

      <div class="insight-strip">
        ${insightCard('trophy', '值得表扬', `${state.students.filter((student) => getRecord(task.id, student.id).tags.some((id) => getTag(id)?.score > 0)).length} 人获得加分标签`, '#2f7e9d', '#e6f5f8')}
        ${insightCard('alert', '需要跟进', `${counts.review + counts.missing} 人需要补交或订正`, '#bd5d77', '#faecf0')}
        ${insightCard('message', '沟通已就绪', '关闭姓名展示即可生成隐私友好版本', '#7765b0', '#f1eef9')}
      </div>
    </div>`;
}

function feedbackOption(key, title, detail, active) {
  return `
    <div class="feedback-option">
      ${icon(key === 'showNames' ? 'users' : key === 'showReview' ? 'clock' : 'sparkles')}
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
      <button type="button" class="toggle ${active ? 'is-on' : ''}" data-action="toggle-feedback-option" data-option="${key}" aria-label="切换${escapeHtml(title)}" aria-pressed="${active}"></button>
    </div>`;
}

function insightCard(iconName, title, detail, color, bg) {
  return `
    <article class="card insight-card">
      <span class="insight-icon" style="--accent:${color};--accent-soft:${bg}">${icon(iconName)}</span>
      <span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></span>
    </article>`;
}

function studentMetrics(studentId) {
  const records = state.tasks.map((task) => ({ task, record: getRecord(task.id, studentId) }));
  const passed = records.filter((item) => item.record.status === 'passed').length;
  const review = records.filter((item) => item.record.status === 'review').length;
  const missing = records.filter((item) => item.record.status === 'missing').length;
  const excused = records.filter((item) => item.record.status === 'excused').length;
  const xp = records.reduce((sum, item) => {
    return sum + item.record.tags.reduce((tagSum, tagId) => tagSum + (getTag(tagId)?.score || 0), 0);
  }, 0);
  return { records, passed, review, missing, excused, overdue: review + missing, xp };
}

function heatColors(overdue) {
  if (overdue <= 0) {
    return {
      color: '#43d8d1',
      ink: '#0c4c50',
      bg: 'linear-gradient(145deg, #d0fffd 0%, #8cf4ef 60%, #43d8d1 100%)',
      shadow: '#20aaa8',
      glow: 'rgba(67, 216, 209, 0.3)'
    };
  }
  if (overdue === 1) {
    return {
      color: '#64adf5',
      ink: '#173f68',
      bg: 'linear-gradient(145deg, #dcefff 0%, #9bcfff 60%, #64adf5 100%)',
      shadow: '#3c85cc',
      glow: 'rgba(100, 173, 245, 0.3)'
    };
  }
  if (overdue === 2) {
    return {
      color: '#a98cf1',
      ink: '#3f2f70',
      bg: 'linear-gradient(145deg, #ece3ff 0%, #cbb5ff 58%, #a98cf1 100%)',
      shadow: '#8065c8',
      glow: 'rgba(169, 140, 241, 0.31)'
    };
  }
  return {
    color: '#ef7fa6',
    ink: '#661c38',
    bg: 'linear-gradient(145deg, #ffd7e5 0%, #ffa3c0 58%, #ef7fa6 100%)',
    shadow: '#c84e78',
    glow: 'rgba(239, 127, 166, 0.3)'
  };
}

function renderAnalytics() {
  if (!state.students.length) {
    return renderEmptyState('还没有学生数据', '先批量导入学生名单，热力图与个人画像会自动生成。', 'manage-students', '导入学生名单');
  }
  if (!state.tasks.length) {
    return renderEmptyState('还没有作业数据', '登记第一项作业后，这里会按学生汇总过关情况。', 'new-task', '登记第一项作业');
  }
  const summaries = state.students.map((student) => ({ student, metrics: studentMetrics(student.id) }));
  const totalOverdue = summaries.reduce((sum, item) => sum + item.metrics.overdue, 0);
  const perfectCount = summaries.filter((item) => item.metrics.overdue === 0).length;
  const ranked = [...summaries].sort((a, b) => b.metrics.overdue - a.metrics.overdue || b.metrics.xp - a.metrics.xp).slice(0, 7);
  const xpRanked = [...summaries].sort((a, b) => b.metrics.xp - a.metrics.xp).slice(0, 7);
  const trendTasks = [...state.tasks].reverse().slice(-6);
  const maxTrend = Math.max(1, state.students.length);

  const heatCells = summaries.map(({ student, metrics }) => {
    const colors = heatColors(metrics.overdue);
    return `
      <button type="button" class="heat-cell ${ui.hideNames ? 'hide-name' : ''}" data-action="student-profile" data-student-id="${escapeHtml(student.id)}" style="--heat-color:${colors.color};--heat-ink:${colors.ink};--heat-bg:${colors.bg};--heat-shadow:${colors.shadow};--heat-glow:${colors.glow}">
        <span class="heat-cell-top"><strong>${String(student.number).padStart(2, '0')}</strong><span>XP ${metrics.xp}</span></span>
        <span class="student-name">${escapeHtml(student.name)}</span>
        <small>${metrics.overdue ? `${metrics.overdue} 次未过关` : '全部已过关'}</small>
      </button>`;
  }).join('');

  const trendHtml = trendTasks.map((task) => {
    const counts = countsForTask(task.id);
    const date = parseDate(task.date);
    return `
      <div class="trend-column" title="${escapeHtml(task.title)}：${counts.passed} 过关 / ${counts.review} 待订正 / ${counts.missing} 未交">
        <div class="trend-bars">
          <span class="trend-bar" style="height:${Math.max(3, counts.passed / maxTrend * 155)}px;--bar:#67b8d2"></span>
          <span class="trend-bar" style="height:${Math.max(3, counts.review / maxTrend * 155)}px;--bar:#9982cc"></span>
          <span class="trend-bar" style="height:${Math.max(3, counts.missing / maxTrend * 155)}px;--bar:#d87891"></span>
        </div>
        <span class="trend-label">${date.getMonth() + 1}/${date.getDate()}</span>
      </div>`;
  }).join('');

  const rankRows = ranked.map((item, index) => `
    <div class="rank-row" data-action="student-profile" data-student-id="${escapeHtml(item.student.id)}" role="button" tabindex="0">
      <span class="rank-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="rank-name">${escapeHtml(item.student.name)}<small>${item.metrics.review} 次待订正 · ${item.metrics.missing} 次未交</small></span>
      <span class="xp-pill">${item.metrics.overdue} 次跟进</span>
    </div>`).join('') || '<div class="empty-inline">当前没有需要跟进的学生</div>';

  const xpRows = xpRanked.map((item, index) => `
    <div class="rank-row" data-action="student-profile" data-student-id="${escapeHtml(item.student.id)}" role="button" tabindex="0">
      <span class="rank-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="rank-name">${escapeHtml(item.student.name)}<small>${item.metrics.passed} 次已过关</small></span>
      <span class="xp-pill">${item.metrics.xp >= 0 ? '+' : ''}${item.metrics.xp} XP</span>
    </div>`).join('') || '<div class="empty-inline">完成评价后会生成积分排行</div>';

  return `
    <div class="view analytics-view">
      <div class="analytics-head">
        <div><h2>全班作业热力图</h2><p>颜色越深代表未过关次数越多。点击任意学生查看完整档案。</p></div>
        <button type="button" class="secondary-button" data-action="toggle-names">${icon('eye-off')}${ui.hideNames ? '显示姓名' : '隐藏姓名'}</button>
      </div>

      <section class="card heatmap-card">
        <div class="section-heading">
          <div><h2>${state.tasks.length} 次作业 · ${state.students.length} 名学生</h2><p>${perfectCount} 人保持全部过关，累计 ${totalOverdue} 次待跟进记录。</p></div>
          <div class="heatmap-legend">
            <span><i style="--legend:#43d8d1"></i>全部过关</span>
            <span><i style="--legend:#64adf5"></i>1 次</span>
            <span><i style="--legend:#a98cf1"></i>2 次</span>
            <span><i style="--legend:#ef7fa6"></i>3 次及以上</span>
          </div>
        </div>
        <div class="heatmap-grid">${heatCells}</div>
      </section>

      <div class="analytics-lower">
        <section class="card trend-card">
          <div class="section-heading">
            <div><h2>近六次作业趋势</h2><p>青色为已过关，蓝紫色为待订正，玫红色为未提交。</p></div>
          </div>
          <div class="trend-chart">${trendHtml}</div>
        </section>
        <section class="card trend-card">
          <div class="section-heading">
            <div><h2>需要优先跟进</h2><p>按未过关次数从高到低排序。</p></div>
          </div>
          <div class="rank-list">${rankRows}</div>
        </section>
      </div>

      <section class="card trend-card" style="margin-top:18px">
        <div class="section-heading">
          <div><h2>评价积分榜</h2><p>基于自定义加分与扣分标签自动计算。</p></div>
          <button class="text-link" type="button" data-view="settings">管理标签 ${icon('arrow-right')}</button>
        </div>
        <div class="rank-list" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px">${xpRows}</div>
      </section>
    </div>`;
}

function renderSettings() {
  const canManage = canManageClass();
  const hasClass = Boolean(state.classInfo.id);
  const roleLabel = currentMembershipRole === 'owner' ? '班级创建者' : '协作者';
  const canEditSettings = canManage || !hasClass;
  return `
    <div class="view settings-view">
      <div class="settings-grid">
        <section class="card settings-card">
          <div class="class-settings-head">
            <span class="class-emblem">${escapeHtml(state.classInfo.name ? state.classInfo.name.slice(0, 2) : '班级')}</span>
            <div><h2>${escapeHtml(classDisplayName())}</h2><p>任课教师：${escapeHtml(teacherDisplayName())} · 科目：${escapeHtml(state.classInfo.subject || '未设置')} · ${roleLabel}</p></div>
          </div>
          <form id="class-settings-form">
            <div class="form-grid">
              <div class="field"><label for="class-name">班级名称</label><input id="class-name" name="className" value="${escapeHtml(state.classInfo.name)}" maxlength="24" required ${canEditSettings ? '' : 'disabled'}></div>
              <div class="field">
                <label>班级号</label>
                <div class="class-code-box ${state.classInfo.code ? '' : 'is-empty'}">
                  <strong>${escapeHtml(state.classInfo.code || '创建班级后自动生成')}</strong>
                  ${state.classInfo.code ? `<button type="button" data-action="copy-class-code" aria-label="复制班级号">${icon('copy')}</button>` : ''}
                </div>
                <small class="field-help">由数据库生成唯一 8 位数字，创建后不可手动修改</small>
              </div>
              <div class="field"><label for="teacher-name">教师姓名</label><input id="teacher-name" name="teacherName" value="${escapeHtml(state.classInfo.teacher)}" maxlength="20" required ${canEditSettings ? '' : 'disabled'}></div>
              <div class="field"><label for="subject-name">任教学科</label><input id="subject-name" name="subjectName" value="${escapeHtml(state.classInfo.subject)}" maxlength="20" ${canEditSettings ? '' : 'disabled'}></div>
            </div>
            <div class="form-actions">
              ${!hasClass ? `<button class="secondary-button" type="button" data-action="open-join-class">${icon('users')}输入班级码加入</button>` : ''}
              ${canEditSettings
                ? `<button class="primary-button" type="submit">${icon('save')}${hasClass ? '保存班级信息' : '创建班级'}</button>`
                : '<span class="save-hint">协作者可查看班级与学生；班级设置由创建者维护</span>'}
            </div>
          </form>
          <div class="student-roster-settings">
            <div class="student-roster-settings-head">
              <strong>学生名单</strong>
              <span>${state.students.length} 人</span>
            </div>
            <div class="student-list">
              ${state.students.length ? state.students.slice(0, 10).map((student) => `<span class="student-chip"><b>${student.number}</b>${escapeHtml(student.name)}</span>`).join('') : '<span class="empty-inline" style="padding:14px 18px">还没有学生，点击下方按钮批量导入</span>'}
              ${state.students.length > 10 ? `<span class="student-chip"><b>…</b>另外 ${state.students.length - 10} 人</span>` : ''}
            </div>
            <div class="class-group-summary">
              <span>${icon('users')}${state.groups.length ? `${state.groups.length} 个小组：${state.groups.map((group) => escapeHtml(group.name)).join('、')}` : '还没有创建小组'}</span>
            </div>
            <div class="form-actions" style="justify-content:flex-start"><button class="secondary-button" type="button" data-action="manage-students">${icon('users')}${canManage ? '管理学生名单' : '查看学生名单'}</button></div>
          </div>
        </section>

        <section class="card settings-card">
          <div class="section-heading">
            <div><h2>个性化评价标签</h2><p>标签会出现在评价弹窗、班级反馈与积分榜中。</p></div>
            <span class="xp-pill">${hasClass ? `${allTags().length} 个标签` : '等待创建班级'}</span>
          </div>
          ${hasClass ? renderTagSection('positive', '奖励标签', '用于发现亮点，计正分', state.tags.positive) : ''}
          ${hasClass ? renderTagSection('negative', '扣分标签', '用于记录需要改进的地方，计负分', state.tags.negative) : ''}
          ${hasClass ? `<form id="add-tag-form" class="add-tag-form">
            <strong>新增加分或提示标签</strong>
            <div class="tag-form-row">
              <input name="tagLabel" type="text" maxlength="12" placeholder="例如：步骤完整" required>
              <input name="tagScore" type="number" min="-20" max="20" value="1" required aria-label="标签分值">
              <select name="tagKind" aria-label="标签类型"><option value="positive">奖励标签</option><option value="negative">扣分标签</option></select>
              <button class="primary-button" type="submit">${icon('plus')}添加标签</button>
            </div>
          </form>` : '<div class="empty-inline" style="margin-top:15px">创建或加入班级后即可管理评价标签</div>'}
        </section>

        <section class="card settings-card">
          <div class="section-heading">
            <div><h2>账号与云端</h2><p>${escapeHtml(currentUser?.email || '')} · ${roleLabel}</p></div>
            <span class="stat-icon">${icon('users')}</span>
          </div>
          <div class="data-actions">
            ${hasClass ? `<button class="secondary-button" type="button" data-action="export-data">${icon('download')}导出当前班级</button>` : ''}
            ${hasClass ? `<button class="secondary-button" type="button" data-action="refresh-cloud">${icon('refresh')}刷新云端数据</button>` : ''}
            <button class="secondary-button" type="button" data-action="check-cloud-setup">${icon('check-square')}检查云端数据库</button>
            <button class="secondary-button" type="button" data-action="open-class-picker">${icon('grid')}切换或加入班级</button>
            <button class="danger-button" type="button" data-action="sign-out">退出登录</button>
          </div>
        </section>

        <section class="card settings-card">
          <div class="section-heading">
            <div><h2>快捷使用建议</h2><p>让登记速度更贴近真实课堂。</p></div>
          </div>
          <div class="tip-list" style="margin-top:17px">
            ${tipRow('users', '组长先收，教师后核', '学生卡片可投到讲台大屏，组长口头汇报后由教师快速点选。')}
            ${tipRow('sparkles', '标签不和分数绑死', '标签分值可以随时修改，已保存的历史评价不会丢失。')}
            ${tipRow('eye-off', '公开展示先隐藏姓名', '投屏或截图时开启“隐藏姓名”，学号仍然保留。')}
          </div>
        </section>
      </div>
    </div>`;
}

function renderTagSection(kind, title, detail, tags) {
  const isPositive = kind === 'positive';
  return `
    <div class="tag-section">
      <div class="tag-section-head" style="--section-color:${isPositive ? '#7c86d2' : '#bd5d77'}">
        <i></i><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small>
      </div>
      <div class="tag-list">
        ${tags.length ? tags.map((tag) => `
          <div class="tag-item">
            <i class="tag-color-dot" style="--tag-color:${(TAG_COLORS[tag.color] || TAG_COLORS.green).ink}"></i>
            <strong>${escapeHtml(tag.label)}</strong>
            <span class="score-badge" style="--score-ink:${tag.score >= 0 ? '#5279b8' : '#bd5d77'};--score-bg:${tag.score >= 0 ? '#e9eef8' : '#faecf0'}">${tag.score >= 0 ? '+' : ''}${tag.score} XP</span>
            ${currentMembershipRole === 'owner' || tag.createdBy === currentUser?.id
              ? `<button type="button" class="tag-remove" data-action="remove-tag" data-tag-id="${escapeHtml(tag.id)}" aria-label="删除${escapeHtml(tag.label)}">${icon('x')}</button>`
              : ''}
          </div>`).join('') : '<div class="empty-inline" style="padding:18px">还没有标签</div>'}
      </div>
    </div>`;
}

function tipRow(iconName, title, detail) {
  return `<div class="tip-row">${icon(iconName)}<span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></span></div>`;
}

function modalTemplate(title, subtitle, body, footer, wide = false) {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="modal-header">
          <div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
          <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x')}</button>
        </header>
        ${body}
        ${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}
      </section>
    </div>`;
}

function openModal(html) {
  modalRoot.innerHTML = html;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    const focusTarget = modalRoot.querySelector('input:not([type="hidden"]), textarea, select, .modal-close');
    focusTarget?.focus({ preventScroll: true });
  });
}

function closeModal() {
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  ui.confirmCallback = null;
}

function openEvaluate(studentId) {
  const student = getStudent(studentId);
  const task = getTask();
  if (!student || !task) return;
  if (!canEditTask(task)) {
    showToast('这是其他教师布置的作业，你只能查看，不能修改状态', 'eye-off');
    return;
  }
  const record = getRecord(task.id, student.id);
  const tagButtons = (tags) => tags.map((tag) => `
    <button type="button" class="tag-option ${record.tags.includes(tag.id) ? 'is-active' : ''}" data-action="modal-tag" data-tag-id="${escapeHtml(tag.id)}" style="${tagStyle(tag)}">
      ${escapeHtml(tag.label)} <b>${tag.score >= 0 ? '+' : ''}${tag.score} XP</b>
    </button>`).join('');
  const body = `
    <form id="evaluate-form" data-student-id="${escapeHtml(student.id)}" data-task-id="${escapeHtml(task.id)}">
      <div class="modal-body">
        <div class="modal-student">
          <span class="student-mini-avatar" style="${avatarStyle(student.id)}">${escapeHtml(student.name.slice(0, 1))}</span>
          <span><strong>${escapeHtml(student.name)}</strong><small>学号 ${String(student.number).padStart(2, '0')} · ${escapeHtml(task.title)}</small></span>
        </div>
        <div class="form-group">
          <span class="form-group-title">${icon('check-square')}作业状态</span>
          <div class="status-options">
            ${Object.entries(STATUS).map(([key, item]) => `
              <button type="button" class="status-option ${record.status === key ? 'is-active' : ''}" data-action="modal-status" data-status="${key}" style="--status-color:${item.color};--status-bg:${item.bg}">${item.label}</button>`).join('')}
          </div>
          <input type="hidden" name="status" value="${record.status}">
        </div>
        <div class="form-group">
          <span class="form-group-title" style="color:#5279b8">${icon('sparkles')}奖励标签</span>
          <div class="tag-options">${tagButtons(state.tags.positive)}</div>
        </div>
        <div class="form-group">
          <span class="form-group-title" style="color:#7964a5">${icon('alert')}提示标签</span>
          <div class="tag-options">${tagButtons(state.tags.negative)}</div>
        </div>
        <div class="form-group">
          <label for="teacher-note">教师备注</label>
          <textarea id="teacher-note" class="note-input" name="note" maxlength="300" placeholder="可记录需要家长了解的具体表现，仅在个人档案中展示。">${escapeHtml(record.note)}</textarea>
        </div>
      </div>
    </form>`;
  const footer = `
    <button TYPE="button" class="ghost-button left" data-action="student-profile-from-modal" data-student-id="${escapeHtml(student.id)}">查看完整档案</button>
    <button type="button" class="secondary-button" data-action="close-modal">取消</button>
    <button type="submit" form="evaluate-form" class="primary-button">${icon('save')}保存本次评价</button>`;
  openModal(modalTemplate('登记个人作业', '状态、标签与备注会一起保存。', body, footer));
}

function openTaskModal(taskId = '') {
  if (!state.classInfo.id) {
    showToast('请先创建班级或加入已有班级', 'users');
    navigate('settings');
    return;
  }
  const task = taskId ? getTask(taskId) : null;
  if (task && !canEditTask(task)) {
    showToast('这是其他教师布置的作业，你只能查看', 'eye-off');
    return;
  }
  const body = `
    <form id="task-form" data-task-id="${task ? escapeHtml(task.id) : ''}">
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full"><label for="task-title">作业内容</label><input id="task-title" name="title" maxlength="50" required value="${task ? escapeHtml(task.title) : ''}" placeholder="例如：练习册 P42 · 分数乘除"></div>
          <div class="field"><label for="task-type">作业类型</label><select id="task-type" name="type">
            ${['日常作业', '订正任务', '专项练习', '周测任务', '拓展阅读'].map((type) => `<option ${task?.type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select></div>
          <div class="field"><label for="task-date">作业日期</label><input id="task-date" name="date" type="date" value="${task ? escapeHtml(task.date) : isoDaysAgo(0)}" required></div>
          <div class="field full"><label for="task-due">截止时间</label><input id="task-due" name="due" maxlength="40" value="${task ? escapeHtml(task.due) : '今天 18:00'}" placeholder="例如：今天 18:00"></div>
          <div class="field full"><label for="task-note">作业说明</label><textarea id="task-note" name="note" maxlength="200" placeholder="可填写题号范围、提交要求等">${task ? escapeHtml(task.note) : ''}</textarea></div>
        </div>
      </div>
    </form>`;
  const footer = `
    <button type="button" class="secondary-button" data-action="close-modal">取消</button>
    <button type="submit" form="task-form" class="primary-button">${icon(task ? 'save' : 'plus')}${task ? '保存修改' : '创建作业'}</button>`;
  openModal(modalTemplate(task ? '编辑作业' : '登记新作业', '作业创建后会立即出现在登记列表中。', body, footer));
}

function openStudentDetail(studentId) {
  const student = getStudent(studentId);
  if (!student) return;
  const metrics = studentMetrics(student.id);
  const history = metrics.records.slice(0, 7).map(({ task, record }) => {
    const tags = record.tags.map(getTag).filter(Boolean);
    const editable = canEditTask(task);
    return `
      <button type="button" class="history-row" ${editable ? `data-action="cycle-student-task" data-student-id="${escapeHtml(student.id)}" data-task-id="${escapeHtml(task.id)}" title="点击切换作业状态"` : 'disabled title="这是其他教师布置的作业，只能查看"'} >
        <time>${formatShortDate(task.date)}</time>
        <strong>${escapeHtml(task.title)}</strong>
        ${tags.slice(0, 1).map((tag) => `<span class="detail-tag" style="${tagStyle(tag)}">${escapeHtml(tag.label)}</span>`).join('')}
        <span class="detail-tag" style="--tag-color:${STATUS[record.status].color};--tag-bg:${STATUS[record.status].bg}">${STATUS[record.status].label}</span>
        ${editable ? icon('refresh', 'history-cycle-icon') : icon('eye-off', 'history-cycle-icon')}
      </button>`;
  }).join('');
  const positiveCounts = state.tags.positive.map((tag) => ({
    tag,
    count: metrics.records.filter(({ record }) => record.tags.includes(tag.id)).length
  })).filter((item) => item.count > 0);
  const body = `
    <div class="modal-body">
      <div class="modal-student" style="margin-bottom:20px">
        <span class="student-mini-avatar" style="${avatarStyle(student.id)}">${escapeHtml(student.name.slice(0, 1))}</span>
        <span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.groupId ? getGroup(student.groupId)?.name || '未分组' : '未分组')} · 学号 ${String(student.number).padStart(2, '0')}</small></span>
      </div>
      <div class="student-detail-stats">
        <div class="detail-stat" style="--stat-bg:#f1eef9;--stat-color:#7765b0"><strong>${state.tasks.length}</strong><small>作业总数</small></div>
        <div class="detail-stat" style="--stat-bg:#e6f5f8;--stat-color:#2f7e9d"><strong>${metrics.passed}</strong><small>已过关</small></div>
        <div class="detail-stat" style="--stat-bg:#f2eff9;--stat-color:#7964a5"><strong>${metrics.review}</strong><small>待订正</small></div>
        <div class="detail-stat" style="--stat-bg:#faecf0;--stat-color:#bd5d77"><strong>${metrics.missing}</strong><small>未提交</small></div>
      </div>
      <div class="detail-section">
        <h3>作业轨迹 <span class="detail-hint">可编辑的作业可点击切换状态</span></h3>
        <div class="detail-history">${history || '<div class="empty-inline">暂无作业记录</div>'}</div>
      </div>
      <div class="detail-section">
        <h3>评价标签汇总</h3>
        <div class="tag-options">
          ${positiveCounts.length ? positiveCounts.map(({ tag, count }) => `<span class="tag-option is-active" style="${tagStyle(tag)}">${escapeHtml(tag.label)} <b>× ${count}</b></span>`).join('') : '<span style="color:var(--ink-faint);font-size:9px">暂时没有评价标签</span>'}
        </div>
      </div>
      <div class="detail-section">
        <h3>当前作业备注</h3>
        <div class="note-input" style="min-height:auto;display:flex;align-items:center">${escapeHtml((getTask() ? getRecord(getTask().id, student.id).note : '') || '暂无备注')}</div>
      </div>
    </div>`;
  const footer = `
    <span class="left save-hint">${icon('trophy')}累计评价积分 ${metrics.xp >= 0 ? '+' : ''}${metrics.xp} XP</span>
    <button class="secondary-button" type="button" data-action="close-modal">关闭</button>
    ${getTask() && canEditTask(getTask())
      ? `<button class="primary-button" type="button" data-action="evaluate" data-student-id="${escapeHtml(student.id)}">${icon('edit')}修改本次登记</button>`
      : '<span class="save-hint">当前作业为只读</span>'}`;
  openModal(modalTemplate('个人作业档案', '从单次登记沉淀出连续的学习轨迹。', body, footer, true));
}

function openStudentManager() {
  if (!canManageClass()) {
    const body = `
      <div class="modal-body">
        <div class="batch-selection-bar">
          <div><strong>${state.students.length}</strong><span> 名学生 · 只读</span></div>
          <span class="save-hint">${icon('eye-off')}名单由班级创建者维护</span>
        </div>
        <div class="student-list" style="margin-top:18px">
          ${state.students.length
            ? state.students.map((student) => {
              const group = getGroup(student.groupId);
              return `<span class="student-chip"><b>${student.number}</b>${escapeHtml(student.name)}${group ? `<em>${escapeHtml(group.name)}</em>` : ''}</span>`;
            }).join('')
            : '<span class="empty-inline">班级暂时没有学生</span>'}
        </div>
      </div>`;
    openModal(modalTemplate('班级学生名单', '协作者可以查看同一批学生，但不能修改名单。', body, '<button class="secondary-button" type="button" data-action="close-modal">关闭</button>', true));
    return;
  }
  const studentIds = new Set(state.students.map((student) => student.id));
  [...ui.studentSelection].forEach((studentId) => {
    if (!studentIds.has(studentId)) ui.studentSelection.delete(studentId);
  });
  const groupOptions = state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
  const body = `
    <div class="modal-body">
      <div class="batch-selection-bar">
        <div><strong id="student-selected-count">${ui.studentSelection.size}</strong><span> 名学生已选择</span></div>
        <div>
          <button type="button" class="text-link" data-action="select-all-students">全选</button>
          <button type="button" class="text-link" data-action="clear-student-selection">取消选择</button>
        </div>
      </div>

      <section class="batch-panel">
        <div class="batch-panel-heading"><strong>批量添加学生</strong><span>学号可写在姓名前或后；未填写时从 1 开始自动编号</span></div>
        <form id="batch-add-students-form" class="batch-form">
          <textarea name="studentNames" rows="5" placeholder="01 张小明&#10;李小红 02&#10;王小刚&#10;学号05 陈小雨" required></textarea>
          <div class="batch-form-actions">
            <select name="groupId" aria-label="添加到小组">
              <option value="">暂不分组</option>
              ${groupOptions}
            </select>
            <button class="primary-button" type="submit">${icon('plus')}批量添加</button>
          </div>
        </form>
      </section>

      <section class="batch-panel">
        <div class="batch-panel-heading"><strong>小组管理</strong><span>创建小组后，可以批量或单独调整学生分组</span></div>
        <form id="add-group-form" class="inline-add group-add-form">
          <input name="groupName" maxlength="20" placeholder="输入小组名称，例如：第 1 组" required>
          <button class="secondary-button" type="submit">${icon('plus')}创建小组</button>
        </form>
        <div class="group-chip-list">
          ${state.groups.length ? state.groups.map((group) => `
            <span class="group-chip" style="${groupTagStyle(group)}">
              ${escapeHtml(group.name)}
              <button type="button" data-action="delete-group" data-group-id="${escapeHtml(group.id)}" aria-label="删除${escapeHtml(group.name)}">${icon('x')}</button>
            </span>`).join('') : '<span class="batch-empty-text">还没有小组，创建后即可批量分配。</span>'}
        </div>
      </section>

      <section class="batch-panel student-list-panel">
        <div class="batch-panel-heading"><strong>学生名单</strong><span>${state.students.length} 人</span></div>
        <div class="student-manage-list">
          ${state.students.length ? state.students.map((student) => {
            const group = getGroup(student.groupId);
            return `
              <div class="student-manage-row ${ui.studentSelection.has(student.id) ? 'is-selected' : ''}">
                <input type="checkbox" data-student-select data-student-id="${escapeHtml(student.id)}" ${ui.studentSelection.has(student.id) ? 'checked' : ''} aria-label="选择${escapeHtml(student.name)}">
                <span class="student-mini-avatar" style="${avatarStyle(student.id)}">${escapeHtml(student.name.slice(0, 1))}</span>
                <span class="student-manage-name"><strong>${escapeHtml(student.name)}</strong><small>学号 ${String(student.number).padStart(2, '0')}</small></span>
                <select data-action="set-student-group" data-student-id="${escapeHtml(student.id)}" aria-label="设置${escapeHtml(student.name)}的小组">
                  <option value="" ${group ? '' : 'selected'}>未分组</option>
                  ${state.groups.map((item) => `<option value="${escapeHtml(item.id)}" ${group?.id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
                </select>
                <button type="button" class="student-remove-button" data-action="remove-student" data-student-id="${escapeHtml(student.id)}" aria-label="移除${escapeHtml(student.name)}">${icon('trash')}</button>
              </div>`;
          }).join('') : '<div class="empty-inline">还没有学生，使用上方表单批量添加。</div>'}
        </div>
      </section>

      <div class="batch-action-bar">
        <label>
          <span>批量分组</span>
          <select id="batch-group-select">
            <option value="">设为未分组</option>
            ${groupOptions}
          </select>
        </label>
        <button type="button" class="secondary-button" data-action="assign-selected-group">${icon('users')}应用分组</button>
        <button type="button" class="danger-button" data-action="batch-delete-students">${icon('trash')}删除所选</button>
      </div>
    </div>`;
  openModal(modalTemplate('批量管理学生', '批量添加、删除和分组；单个学生的分组也可以随时调整。', body, '<button class="secondary-button" type="button" data-action="close-modal">完成</button>', true));
}

function openClassPicker() {
  const classCards = cloudClasses.length
    ? cloudClasses.map((item) => `
      <button type="button" class="class-picker-item ${item.id === activeClassId ? 'is-active' : ''}" data-action="switch-class" data-class-id="${escapeHtml(item.id)}">
        <span class="class-picker-icon">${escapeHtml(item.name.slice(0, 2))}</span>
        <span class="class-picker-copy">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.teacher_name || '未填写教师')} · 班级号 ${escapeHtml(item.class_code)}</small>
        </span>
        <span class="role-pill role-${item.role}">${item.role === 'owner' ? '创建者' : '协作者'}</span>
      </button>`).join('')
    : '<div class="empty-inline">当前账号还没有班级</div>';
  const body = `
    <div class="modal-body">
      <div class="class-picker-list">${classCards}</div>
      <div class="class-picker-actions">
        <button type="button" class="secondary-button" data-action="open-join-class">${icon('users')}输入班级码加入</button>
        <button type="button" class="primary-button" data-action="create-new-class">${icon('plus')}创建新班级</button>
      </div>
    </div>`;
  openModal(modalTemplate('我的班级', '你只能看到自己创建或已加入的班级。', body, '<button class="secondary-button" type="button" data-action="close-modal">关闭</button>', true));
}

async function openCloudDiagnostics() {
  openModal(modalTemplate(
    '云端数据库检查',
    '检查登录状态、数据表和 RLS 是否可访问。',
    `<div class="modal-body"><div class="empty-inline">${icon('refresh')}<br>正在检查 Supabase…</div></div>`,
    '<button class="secondary-button" type="button" data-action="close-modal">关闭</button>',
    true
  ));
  try {
    const result = await cloud.inspectSetup();
    const allOk = result.authenticated && result.checks.every((item) => item.ok);
    const rows = result.checks.map((item) => `
      <div class="cloud-check-row ${item.ok ? 'is-ok' : 'is-error'}">
        <span>${item.ok ? icon('check-square') : icon('alert')}</span>
        <strong>${escapeHtml(item.table)}</strong>
        <small>${item.ok ? '可访问' : escapeHtml(`${item.code || ''} ${item.message || '访问失败'}`.trim())}</small>
      </div>`).join('');
    const body = `
      <div class="modal-body">
        <div class="cloud-check-summary ${allOk ? 'is-ok' : 'is-error'}">
          <strong>${allOk ? '云端配置正常' : '云端配置需要处理'}</strong>
          <p>${result.authenticated ? `已登录：${escapeHtml(result.email)}` : '认证状态无效，请重新登录'}</p>
        </div>
        <div class="cloud-check-list">${rows}</div>
        ${allOk ? '' : `<div class="cloud-check-guide">
          <strong>常见修复方法</strong>
          <p>如果表不存在，请在 Supabase SQL Editor 完整执行 <code>supabase/schema.sql</code>。如果表存在但提示 RLS/GRANT，请重新执行同一脚本中的权限部分。</p>
        </div>`}
      </div>`;
    openModal(modalTemplate('云端数据库检查', '检查结果只显示当前账号可访问的资源。', body, '<button class="secondary-button" type="button" data-action="close-modal">关闭</button>', true));
  } catch (error) {
    showToast(error.message || '云端检查失败', 'alert');
    closeModal();
  }
}

function showCloudActionError(error, title = '云端操作失败') {
  const message = error?.message || '未知错误';
  const setupRelated = /Supabase|RLS|数据库|表|触发器|权限|schema/i.test(message);
  const body = `
    <div class="modal-body">
      <div class="cloud-check-summary is-error">
        <strong>${escapeHtml(message)}</strong>
        <p>请根据下方检查项确认 Supabase 项目是否完整初始化。</p>
      </div>
      ${setupRelated ? `<div class="cloud-check-guide" style="margin-top:14px">
        <strong>建议按顺序检查</strong>
        <p>1. 在 Supabase SQL Editor 重新执行最新的 <code>supabase/schema.sql</code>。<br>
        2. 等待约 10 秒，在 Database → API 中刷新 schema cache。<br>
        3. 确认登录邮箱已经完成验证。<br>
        4. 点击“检查云端数据库”查看具体哪张表不可访问。</p>
      </div>` : ''}
      ${error?.rawMessage ? `<details class="cloud-error-detail">
        <summary>查看数据库原始错误</summary>
        <pre>code: ${escapeHtml(error.rawCode || 'unknown')}
message: ${escapeHtml(error.rawMessage || '')}
details: ${escapeHtml(error.rawDetails || '')}
hint: ${escapeHtml(error.rawHint || '')}</pre>
      </details>` : ''}
    </div>`;
  openModal(modalTemplate(
    title,
    '数据库会再次验证当前账号权限。',
    body,
    `<button class="secondary-button" type="button" data-action="check-cloud-setup">${icon('check-square')}检查云端数据库</button><button class="primary-button" type="button" data-action="close-modal">知道了</button>`
  ));
}

function openJoinClassModal() {
  const body = `
    <form id="join-class-form">
      <div class="modal-body">
        <div class="field"><label for="join-class-code">8 位班级号</label><input id="join-class-code" name="classCode" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" placeholder="例如：58392017" required></div>
        <p class="confirm-message" style="margin-top:12px">加入后可以查看同班学生和作业。你只能修改自己创建的作业及对应状态。</p>
      </div>
    </form>`;
  openModal(modalTemplate('加入同班教师班级', '联系班级创建者获取 8 位班级号。', body, `<button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit" form="join-class-form">${icon('users')}加入班级</button>`));
}

function openCreateClassModal() {
  const body = `
    <form id="create-class-form">
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full"><label for="new-class-name">班级名称</label><input id="new-class-name" name="className" maxlength="60" placeholder="例如：六年级 4 班" required></div>
          <div class="field"><label for="new-class-teacher">教师姓名</label><input id="new-class-teacher" name="teacherName" maxlength="40" placeholder="你的姓名" required></div>
          <div class="field"><label for="new-class-subject">任教学科</label><input id="new-class-subject" name="subjectName" maxlength="40" placeholder="例如：数学"></div>
        </div>
        <p class="confirm-message" style="margin-top:14px">创建后数据库会自动生成唯一 8 位班级号，你可以把它发给同班教师。</p>
      </div>
    </form>`;
  openModal(modalTemplate('创建新班级', '每个账号可以创建多个班级。', body, `<button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit" form="create-class-form">${icon('plus')}创建班级</button>`));
}

function openClassInfo() {
  const counts = getTask() ? countsForTask(getTask().id) : { passed: 0, review: 0, missing: 0 };
  const body = `
    <div class="modal-body">
      <div class="class-profile">
        <div class="profile-fact"><small>班级</small><strong>${escapeHtml(classDisplayName())}</strong></div>
        <div class="profile-fact"><small>班级号</small><strong>${escapeHtml(state.classInfo.code || '未设置')}</strong></div>
        <div class="profile-fact"><small>学生人数</small><strong>${state.students.length} 人</strong></div>
        <div class="profile-fact"><small>本次已过关</small><strong>${counts.passed} 人</strong></div>
        <div class="profile-fact"><small>待跟进</small><strong>${counts.review + counts.missing} 人</strong></div>
        <div class="profile-fact"><small>作业总数</small><strong>${state.tasks.length} 项</strong></div>
      </div>
    </div>`;
  openModal(modalTemplate('班级信息', '本机工作台当前使用的班级。', body, '<button class="secondary-button" type="button" data-view="settings">前往设置</button><button class="primary-button" type="button" data-action="close-modal">知道了</button>'));
}

function openTips() {
  const counts = getTask() ? countsForTask(getTask().id) : { passed: 0, review: 0, missing: 0 };
  const body = `
    <div class="modal-body">
      <div class="tip-list">
        ${tipRow('clock', '今天还有待办', `${counts.review} 人待订正，${counts.missing} 人未提交。点击学生卡片即可更新。`)}
        ${tipRow('eye-off', '投屏更安心', '在作业登记或学生画像页点击“隐藏姓名”，保留学号并模糊姓名。')}
        ${tipRow('save', '所有修改已自动保存', '数据保存在当前浏览器中，建议定期在“评价设置”里导出备份。')}
      </div>
    </div>`;
  openModal(modalTemplate('今日提醒', `更新于 ${formatFullDate()}`, body, '<button class="primary-button" type="button" data-action="close-modal">开始处理</button>'));
}

function openMobileNav() {
  const navItems = [
    ['dashboard', 'home', '今日总览', '查看当天进度和需要关注的学生'],
    ['register', 'check-square', '作业登记', '快速录入过关、订正和提交状态'],
    ['feedback', 'message', '班级反馈', '生成可直接复制到班级群的文案'],
    ['analytics', 'chart', '学生画像', '查看热力图、趋势和个人作业档案'],
    ['settings', 'sliders', '评价设置', '管理班级、名单、标签与数据备份']
  ];
  const body = `<div class="modal-body"><div class="tip-list">${navItems.map(([view, iconName, title, detail]) => `
    <button type="button" class="tip-row" data-view="${view}" style="width:100%;border:0;text-align:left;cursor:pointer;color:inherit">
      ${icon(iconName)}<span><strong>${title}</strong><p>${detail}</p></span>
    </button>`).join('')}</div></div>`;
  openModal(modalTemplate('快速前往', '选择要使用的功能。', body, '<button class="secondary-button" type="button" data-action="close-modal">关闭</button>'));
}

function openConfirm(title, message, confirmLabel, callback) {
  ui.confirmCallback = callback;
  const body = `<div class="modal-body"><p class="confirm-message">${escapeHtml(message)}</p></div>`;
  openModal(modalTemplate(title, '此操作会立即生效。', body, `<button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="danger-button" type="button" data-action="confirm-action">${escapeHtml(confirmLabel)}</button>`));
}

function showToast(message, iconName = 'check-square') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
  toastRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    window.setTimeout(() => toast.remove(), 180);
  }, 2800);
}

function filterRosterTiles() {
  const tiles = [...document.querySelectorAll('#roster-grid .student-tile')];
  let visible = 0;
  tiles.forEach((tile) => {
    const queryMatch = !ui.query || tile.dataset.name.includes(ui.query) || tile.dataset.number.includes(ui.query);
    const statusMatch = ui.statusFilter === 'all' || tile.dataset.status === ui.statusFilter;
    const groupMatch = ui.groupFilter === 'all'
      || (ui.groupFilter === 'ungrouped' && !tile.dataset.group)
      || tile.dataset.group === ui.groupFilter;
    const matches = queryMatch && statusMatch && groupMatch;
    tile.hidden = !matches;
    if (matches) visible += 1;
  });
  const count = document.getElementById('roster-visible-count');
  if (count) count.textContent = `${visible} / ${state.students.length} 人`;
}

async function copyFeedback() {
  const task = getTask();
  if (!task) return;
  const text = buildFeedbackText(task);
  try {
    await navigator.clipboard.writeText(text);
    showToast('反馈文案已复制，可直接粘贴到班级群');
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    showToast(success ? '反馈文案已复制' : '复制失败，请手动选择文本', success ? 'check-square' : 'alert');
  }
}

async function copyClassCode() {
  const code = state.classInfo.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast(`班级号 ${code} 已复制`);
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    showToast(copied ? `班级号 ${code} 已复制` : `班级号：${code}`, copied ? 'copy' : 'users');
  }
}

function downloadTextFile(content, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportData() {
  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile(JSON.stringify(state, null, 2), `${state.classInfo.name}-作业数据-${date}.json`, 'application/json;charset=utf-8');
  showToast('数据备份已导出', 'download');
}

function removeTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  openConfirm('删除这项作业？', `“${task.title}”的学生状态与评价记录会一并删除，且无法在工作台内撤销。`, '确认删除', async () => {
    try {
      await cloud.deleteTask(taskId);
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      delete state.records[taskId];
      if (ui.selectedTaskId === taskId) ui.selectedTaskId = state.tasks[0]?.id || '';
      closeModal();
      render();
      showToast('作业已删除', 'trash');
    } catch (error) {
      showToast(error.message || '删除作业失败', 'alert');
    }
  });
}

function removeTag(tagId) {
  const tag = getTag(tagId);
  if (!tag) return;
  openConfirm('删除评价标签？', `“${tag.label}”会从标签库中移除，已经保存的历史评价仍会保留文字记录。`, '删除标签', async () => {
    try {
      await cloud.deleteTag(tagId);
      state.tags.positive = state.tags.positive.filter((item) => item.id !== tagId);
      state.tags.negative = state.tags.negative.filter((item) => item.id !== tagId);
      closeModal();
      render();
      showToast('标签已删除');
    } catch (error) {
      showToast(error.message || '删除标签失败', 'alert');
    }
  });
}

function removeStudent(studentId) {
  const student = getStudent(studentId);
  if (!student) return;
  openConfirm('从班级移除学生？', `${student.name} 的历史作业与评价记录将不再展示。建议先导出数据备份。`, '确认移除', async () => {
    try {
      await cloud.deleteStudents([studentId]);
      state.students = state.students.filter((item) => item.id !== studentId);
      ui.studentSelection.delete(studentId);
      Object.keys(state.records).forEach((taskId) => {
        delete state.records[taskId]?.[studentId];
      });
      closeModal();
      openStudentManager();
      render();
      showToast(`${student.name} 已从名单移除`);
    } catch (error) {
      showToast(error.message || '删除学生失败', 'alert');
    }
  });
}

function removeGroup(groupId) {
  const group = getGroup(groupId);
  if (!group) return;
  openConfirm('删除这个小组？', `“${group.name}”中的学生会保留在班级名单中，并自动变为未分组。`, '删除小组', async () => {
    try {
      await cloud.deleteGroup(groupId);
      state.groups = state.groups.filter((item) => item.id !== groupId);
      state.students.forEach((student) => {
        if (student.groupId === groupId) student.groupId = '';
      });
      if (ui.groupFilter === groupId) ui.groupFilter = 'all';
      closeModal();
      openStudentManager();
      render();
      showToast('小组已删除，学生已设为未分组');
    } catch (error) {
      showToast(error.message || '删除小组失败', 'alert');
    }
  });
}

function refreshStudentSelectionUI() {
  const count = document.getElementById('student-selected-count');
  if (count) count.textContent = ui.studentSelection.size;
}

async function assignSelectedStudentsToGroup(groupId) {
  if (!ui.studentSelection.size) {
    showToast('请先选择学生', 'users');
    return;
  }
  if (groupId && !getGroup(groupId)) return;
  const selectedStudents = state.students.filter((student) => ui.studentSelection.has(student.id));
  try {
    await Promise.all(selectedStudents.map((student) => cloud.updateStudent(student.id, {
      group_id: groupId || null
    })));
    selectedStudents.forEach((student) => {
      student.groupId = groupId;
    });
    openStudentManager();
    render();
    showToast(`已将 ${selectedStudents.length} 名学生设为${groupId ? getGroup(groupId).name : '未分组'}`);
  } catch (error) {
    showToast(error.message || '批量分组失败', 'alert');
    await refreshCloudWorkspace(true);
  }
}

function batchDeleteSelectedStudents() {
  if (!ui.studentSelection.size) {
    showToast('请先选择学生', 'users');
    return;
  }
  const count = ui.studentSelection.size;
  openConfirm('批量移除学生？', `将移除已选择的 ${count} 名学生及其历史记录。建议先在设置中导出数据备份。`, `移除 ${count} 名学生`, async () => {
    try {
      await cloud.deleteStudents([...ui.studentSelection]);
      state.students = state.students.filter((student) => !ui.studentSelection.has(student.id));
      Object.keys(state.records).forEach((taskId) => {
        Object.keys(state.records[taskId] || {}).forEach((studentId) => {
          if (ui.studentSelection.has(studentId)) delete state.records[taskId][studentId];
        });
      });
      ui.studentSelection.clear();
      closeModal();
      openStudentManager();
      render();
      showToast(`${count} 名学生已移除`, 'trash');
    } catch (error) {
      showToast(error.message || '批量删除学生失败', 'alert');
    }
  });
}

async function cycleStudentTaskStatus(studentId, taskId) {
  const statusOrder = Object.keys(STATUS);
  const task = state.tasks.find((item) => item.id === taskId);
  if (!canEditTask(task)) {
    showToast('这是其他教师布置的作业，你只能查看', 'eye-off');
    return;
  }
  const record = getRecord(taskId, studentId);
  const nextIndex = (statusOrder.indexOf(record.status) + 1) % statusOrder.length;
  const nextStatus = statusOrder[nextIndex];
  try {
    const saved = await cloud.saveRecord({
      task_id: taskId,
      student_id: studentId,
      status: nextStatus,
      tag_ids: record.tags,
      note: record.note
    });
    record.id = saved.id;
    record.status = saved.status;
    record.tags = saved.tag_ids || [];
    record.updatedBy = saved.updated_by;
    render();
    openStudentDetail(studentId);
    showToast(`状态已切换为“${STATUS[nextStatus].label}”`);
  } catch (error) {
    showToast(error.message || '切换作业状态失败', 'alert');
  }
}

function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  const viewElement = event.target.closest('[data-view]');

  if (viewElement) {
    event.preventDefault();
    closeModal();
    navigate(viewElement.dataset.view);
    return;
  }

  if (!actionElement) return;
  const action = actionElement.dataset.action;

  if (action === 'close-modal') {
    if (actionElement.classList.contains('modal-backdrop') && event.target !== actionElement) return;
    closeModal();
    return;
  }

  const actions = {
    'auth-switch': () => renderAuthScreen(actionElement.dataset.mode || 'login'),
    'open-class-picker': openClassPicker,
    'open-join-class': openJoinClassModal,
    'create-new-class': openCreateClassModal,
    'switch-class': async () => {
      const classId = actionElement.dataset.classId;
      if (!classId || classId === activeClassId) {
        closeModal();
        return;
      }
      try {
        closeModal();
        renderLoadingScreen('正在切换班级…');
        await openCloudClass(classId);
      } catch (error) {
        setAuthMode(false);
        render();
        showToast(error.message || '切换班级失败', 'alert');
      }
    },
    'refresh-cloud': () => refreshCloudWorkspace(false),
    'check-cloud-setup': openCloudDiagnostics,
    'sign-out': async () => {
      try {
        cloud?.unsubscribeWorkspace();
        await cloud.signOut();
      } catch (error) {
        showToast(error.message || '退出登录失败', 'alert');
      } finally {
        currentSession = null;
        currentUser = null;
        activeClassId = null;
        cloudClasses = [];
        state = makeEmptyState();
        renderAuthScreen('login');
      }
    },
    'go-home': () => navigate('dashboard'),
    'go-register': () => navigate('register'),
    'view-feedback': () => navigate('feedback'),
    'new-task': () => openTaskModal(),
    'edit-task': () => openTaskModal(actionElement.dataset.taskId),
    'delete-task': () => removeTask(actionElement.dataset.taskId),
    'go-task': () => {
      ui.selectedTaskId = actionElement.dataset.taskId;
      ui.query = '';
      ui.statusFilter = 'all';
      navigate('register');
    },
    'evaluate': () => {
      if (getTask()) openEvaluate(actionElement.dataset.studentId);
    },
    'filter-status': () => {
      ui.statusFilter = actionElement.dataset.status;
      render();
    },
    'clear-filter': () => {
      ui.statusFilter = 'all';
      ui.query = '';
      ui.groupFilter = 'all';
      render();
    },
    'toggle-names': () => {
      ui.hideNames = !ui.hideNames;
      render();
      showToast(ui.hideNames ? '姓名已隐藏，学号仍然保留' : '姓名已恢复显示', 'eye-off');
    },
    'toggle-feedback-option': () => {
      const option = actionElement.dataset.option;
      ui.feedbackOptions[option] = !ui.feedbackOptions[option];
      render();
    },
    'copy-feedback': copyFeedback,
    'download-feedback': () => {
      const task = getTask();
      if (!task) return;
      downloadTextFile(buildFeedbackText(task), `${formatShortDate(task.date)}-${task.title}-班级反馈.txt`);
      showToast('反馈文本已保存', 'download');
    },
    'student-profile': () => openStudentDetail(actionElement.dataset.studentId),
    'student-profile-from-modal': () => openStudentDetail(actionElement.dataset.studentId),
    'cycle-student-task': () => cycleStudentTaskStatus(actionElement.dataset.studentId, actionElement.dataset.taskId),
    'modal-status': () => {
      modalRoot.querySelectorAll('[data-action="modal-status"]').forEach((button) => button.classList.remove('is-active'));
      actionElement.classList.add('is-active');
      const hidden = modalRoot.querySelector('input[name="status"]');
      if (hidden) hidden.value = actionElement.dataset.status;
    },
    'modal-tag': () => actionElement.classList.toggle('is-active'),
    'class-info': openClassInfo,
    'show-tips': openTips,
    'manage-students': openStudentManager,
    'remove-student': () => removeStudent(actionElement.dataset.studentId),
    'delete-group': () => removeGroup(actionElement.dataset.groupId),
    'select-all-students': () => {
      ui.studentSelection = new Set(state.students.map((student) => student.id));
      openStudentManager();
    },
    'clear-student-selection': () => {
      ui.studentSelection.clear();
      openStudentManager();
    },
    'assign-selected-group': () => {
      const select = document.getElementById('batch-group-select');
      assignSelectedStudentsToGroup(select?.value || '');
    },
    'batch-delete-students': batchDeleteSelectedStudents,
    'remove-tag': () => removeTag(actionElement.dataset.tagId),
    'copy-class-code': copyClassCode,
    'export-data': exportData,
    'confirm-action': () => {
      const callback = ui.confirmCallback;
      if (typeof callback === 'function') callback();
    },
    'toggle-menu': openMobileNav
  };

  if (actions[action]) {
    event.preventDefault();
    actions[action]();
  }
}

async function handleSubmit(event) {
  const form = event.target;

  if (form.id === 'cloud-config-form') {
    event.preventDefault();
    const data = new FormData(form);
    const url = String(data.get('projectUrl') || '').trim().replace(/\/+$/, '');
    const publishableKey = String(data.get('publishableKey') || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
      showToast('Project URL 格式不正确', 'alert');
      return;
    }
    localStorage.setItem('zuoyeqing-supabase-config-v1', JSON.stringify({ url, publishableKey }));
    window.location.reload();
    return;
  }

  if (form.id === 'auth-form') {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const mode = form.dataset.mode;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = mode === 'register' ? '正在注册…' : '正在登录…';
    try {
      if (mode === 'register') {
        if (password !== String(data.get('passwordConfirm') || '')) {
          throw new Error('两次输入的密码不一致');
        }
        const result = await cloud.signUp(email, password);
        if (result.session) {
          await enterCloudApp(result.session);
        } else {
          renderAuthScreen('login', '注册成功，请前往邮箱完成验证后再登录。', 'success');
        }
      } else {
        const result = await cloud.signIn(email, password);
        await enterCloudApp(result.session);
      }
    } catch (error) {
      renderAuthScreen(mode, error.message || (mode === 'register' ? '注册失败' : '登录失败'), 'error');
    }
    return;
  }

  if (form.id === 'create-class-form') {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('className') || '').trim();
    const teacherName = String(data.get('teacherName') || '').trim();
    const subject = String(data.get('subjectName') || '').trim();
    const submitButton = form.closest('.modal')?.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const created = await cloud.createClass({ name, teacherName, subject });
      cloudClasses = await cloud.loadClasses();
      closeModal();
      await openCloudClass(created.id);
      showToast(`班级已创建，班级号：${created.class_code}`);
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showCloudActionError(error, '创建班级失败');
    }
    return;
  }

  if (form.id === 'join-class-form') {
    event.preventDefault();
    const data = new FormData(form);
    const classCode = String(data.get('classCode') || '').trim();
    if (!/^\d{8}$/.test(classCode)) {
      showToast('请输入 8 位数字班级号', 'alert');
      return;
    }
    const submitButton = form.closest('.modal')?.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const classId = await cloud.joinClassByCode(classCode);
      cloudClasses = await cloud.loadClasses();
      closeModal();
      await openCloudClass(classId);
      showToast('已加入班级，可以查看同班学生和作业');
    } catch (error) {
      showToast(error.message || '加入班级失败', 'alert');
      if (submitButton) submitButton.disabled = false;
    }
    return;
  }

  if (form.id === 'evaluate-form') {
    event.preventDefault();
    const data = new FormData(form);
    const taskId = form.dataset.taskId;
    const studentId = form.dataset.studentId;
    const task = state.tasks.find((item) => item.id === taskId);
    if (!canEditTask(task)) {
      showToast('这是其他教师布置的作业，你只能查看', 'eye-off');
      return;
    }
    const record = getRecord(taskId, studentId);
    const status = STATUS[data.get('status')] ? data.get('status') : 'missing';
    const tagIds = [...form.querySelectorAll('.tag-option.is-active')].map((button) => button.dataset.tagId);
    const note = String(data.get('note') || '').trim();
    const submitButton = modalRoot.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const saved = await cloud.saveRecord({
        task_id: taskId,
        student_id: studentId,
        status,
        tag_ids: tagIds,
        note
      });
      record.id = saved.id;
      record.status = saved.status;
      record.tags = saved.tag_ids || [];
      record.note = saved.note || '';
      record.updatedBy = saved.updated_by;
      closeModal();
      render();
      showToast(`${getStudent(studentId)?.name || '学生'} 的作业状态已保存`);
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showToast(error.message || '保存作业状态失败', 'alert');
    }
    return;
  }

  if (form.id === 'task-form') {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    const type = String(data.get('type') || '日常作业');
    const date = String(data.get('date') || isoDaysAgo(0));
    const due = String(data.get('due') || '').trim();
    const note = String(data.get('note') || '').trim();
    const taskId = form.dataset.taskId;
    const submitButton = modalRoot.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      if (taskId) {
        const saved = await cloud.updateTask(taskId, {
          title,
          task_type: type,
          task_date: date,
          due_label: due,
          note
        });
        const task = getTask(taskId);
        if (task) {
          Object.assign(task, {
            title: saved.title,
            type: saved.task_type,
            date: saved.task_date,
            due: saved.due_label,
            note: saved.note,
            updatedBy: saved.updated_by
          });
        }
        showToast('作业信息已更新');
      } else {
        const saved = await cloud.createTask({
          class_id: activeClassId,
          title,
          task_type: type,
          task_date: date,
          due_label: due,
          note
        });
        const newTask = {
          id: saved.id,
          title: saved.title,
          type: saved.task_type,
          date: saved.task_date,
          due: saved.due_label,
          note: saved.note,
          createdBy: saved.created_by,
          updatedBy: saved.updated_by,
          createdAt: saved.created_at
        };
        state.tasks.unshift(newTask);
        state.records[newTask.id] = {};
        ui.selectedTaskId = newTask.id;
        showToast('新作业已创建，可以开始登记');
      }
      closeModal();
      navigate('register');
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showToast(error.message || '保存作业失败', 'alert');
    }
    return;
  }

  if (form.id === 'class-settings-form') {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('className') || '').trim();
    const teacherName = String(data.get('teacherName') || '').trim();
    const subject = String(data.get('subjectName') || '').trim();
    if (!name || !teacherName) {
      showToast('请填写班级名称和教师姓名', 'alert');
      return;
    }
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      if (!activeClassId) {
        const created = await cloud.createClass({ name, teacherName, subject });
        cloudClasses = await cloud.loadClasses();
        await openCloudClass(created.id);
        showToast(`班级已创建，班级号：${created.class_code}`);
      } else {
        if (!canManageClass()) throw new Error('协作者不能修改班级设置');
        const updated = await cloud.updateClass(activeClassId, { name, teacherName, subject });
        state.classInfo.name = updated.name;
        state.classInfo.teacher = updated.teacher_name;
        state.classInfo.subject = updated.subject;
        const cloudClass = cloudClasses.find((item) => item.id === activeClassId);
        if (cloudClass) Object.assign(cloudClass, updated);
        render();
        showToast('班级信息已保存');
      }
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showCloudActionError(error, activeClassId ? '保存班级失败' : '创建班级失败');
    }
    return;
  }

  if (form.id === 'add-tag-form') {
    event.preventDefault();
    const data = new FormData(form);
    const kind = data.get('tagKind') === 'negative' ? 'negative' : 'positive';
    const label = String(data.get('tagLabel') || '').trim();
    let score = Number(data.get('tagScore'));
    if (!label) return;
    score = Math.max(-20, Math.min(20, Number.isFinite(score) ? score : 1));
    if (kind === 'positive' && score <= 0) score = Math.abs(score) || 1;
    if (kind === 'negative' && score >= 0) score = -Math.abs(score) || -1;
    const colors = kind === 'positive' ? ['green', 'blue', 'coral', 'violet'] : ['amber', 'coral', 'gray'];
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const saved = await cloud.createTag({
        class_id: activeClassId,
        kind,
        label,
        score,
        color: colors[allTags().length % colors.length]
      });
      state.tags[kind].push({
        id: saved.id,
        label: saved.label,
        score: saved.score,
        color: saved.color,
        createdBy: saved.created_by
      });
      render();
      showToast('评价标签已添加');
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showToast(error.message || '添加标签失败', 'alert');
    }
    return;
  }

  if (form.id === 'batch-add-students-form') {
    event.preventDefault();
    const data = new FormData(form);
    const groupId = getGroup(data.get('groupId')) ? String(data.get('groupId')) : '';
    const parsedEntries = parseStudentEntries(data.get('studentNames'));
    const usedNumbers = new Set(state.students.map((student) => Number(student.number)).filter(Number.isFinite));
    const additions = [];
    let adjustedNumbers = 0;

    parsedEntries.forEach((entry) => {
      const name = entry.name.trim().slice(0, 20);
      if (!name) return;
      let number = entry.number;
      if (!number || usedNumbers.has(number)) {
        if (entry.number) adjustedNumbers += 1;
        number = nextAvailableStudentNumber(usedNumbers);
      }
      usedNumbers.add(number);
      additions.push({ name, number });
    });

    if (!additions.length) {
      showToast('没有可添加的学生，请检查输入格式', 'alert');
      return;
    }
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    let savedStudents;
    try {
      savedStudents = await cloud.createStudents(additions.map(({ name, number }) => ({
        class_id: activeClassId,
        student_number: number,
        name,
        group_id: groupId || null
      })));
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showToast(error.message || '批量添加学生失败', 'alert');
      return;
    }
    savedStudents.forEach((student) => {
      state.students.push({
        id: student.id,
        number: student.student_number,
        name: student.name,
        groupId: student.group_id || '',
        createdBy: student.created_by,
        updatedBy: student.updated_by
      });
    });
    state.students.sort((a, b) => a.number - b.number);
    openStudentManager();
    render();
    const notes = [];
    if (adjustedNumbers) notes.push(`${adjustedNumbers} 个重复学号已自动顺延`);
    showToast(`已添加 ${additions.length} 名学生${groupId ? `到${getGroup(groupId).name}` : ''}${notes.length ? `；${notes.join('，')}` : ''}`);
    return;
  }

  if (form.id === 'add-group-form') {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('groupName') || '').trim();
    if (!name) return;
    if (state.groups.some((group) => group.name === name)) {
      showToast('已经有同名小组', 'alert');
      return;
    }
    try {
      const saved = await cloud.createGroup({
        class_id: activeClassId,
        name: name.slice(0, 20),
        color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length]
      });
      state.groups.push({
        id: saved.id,
        name: saved.name,
        color: saved.color,
        createdBy: saved.created_by,
        updatedBy: saved.updated_by
      });
      openStudentManager();
      render();
      showToast(`小组“${name}”已创建`);
    } catch (error) {
      showToast(error.message || '创建小组失败', 'alert');
    }
  }
}

document.addEventListener('click', handleClick);
document.addEventListener('submit', handleSubmit);

document.addEventListener('input', (event) => {
  if (event.target.id === 'roster-search') {
    ui.query = event.target.value.trim();
    filterRosterTiles();
  }
});

let scrollPersistTimer = null;
window.addEventListener('scroll', () => {
  window.clearTimeout(scrollPersistTimer);
  scrollPersistTimer = window.setTimeout(() => {
    if (!currentUser || document.body.classList.contains('auth-mode')) return;
    const preferences = readUiPreferences();
    preferences.scrollByView[ui.view] = Math.round(window.scrollY || 0);
    writeUiPreferences(preferences);
  }, 180);
}, { passive: true });

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-student-select]')) {
    const studentId = event.target.dataset.studentId;
    if (event.target.checked) ui.studentSelection.add(studentId);
    else ui.studentSelection.delete(studentId);
    event.target.closest('.student-manage-row')?.classList.toggle('is-selected', event.target.checked);
    refreshStudentSelectionUI();
    return;
  }

  if (event.target.id === 'group-filter') {
    ui.groupFilter = event.target.value;
    render();
    return;
  }

  if (event.target.matches('[data-action="set-student-group"]')) {
    const student = getStudent(event.target.dataset.studentId);
    if (!student) return;
    const previousGroupId = student.groupId;
    const nextGroupId = getGroup(event.target.value) ? event.target.value : '';
    try {
      await cloud.updateStudent(student.id, { group_id: nextGroupId || null });
      student.groupId = nextGroupId;
      render();
      showToast(`已调整${student.name}的小组`);
    } catch (error) {
      event.target.value = previousGroupId;
      showToast(error.message || '调整小组失败', 'alert');
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.innerHTML) closeModal();
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action][role="button"]')) {
    event.preventDefault();
    event.target.click();
  }
});

async function bootstrapCloudApp() {
  if (!cloud) {
    renderCloudConfigScreen('页面未能加载云端模块，请通过 HTTPS 网站重新打开。');
    return;
  }
  if (!cloud.isConfigured()) {
    renderCloudConfigScreen();
    return;
  }
  if (!cloud.hasClient()) {
    renderCloudConfigScreen('Supabase 官方库加载失败，请检查网络后刷新页面。');
    return;
  }

  try {
    currentSession = await cloud.getSession();
    cloud.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentSession = null;
        currentUser = null;
        activeClassId = null;
        cloudClasses = [];
        state = makeEmptyState();
        renderAuthScreen('login');
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session) currentSession = session;
        if (session?.user) currentUser = session.user;
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        if (currentUser?.id === session.user.id) {
          currentSession = session;
          return;
        }
        if (!cloudBootstrapping) enterCloudApp(session);
      }
    });
    if (currentSession) await enterCloudApp(currentSession);
    else renderAuthScreen('login');
  } catch (error) {
    console.error(error);
    renderAuthScreen('login', error.message || '初始化云端失败，请刷新重试', 'error');
  }
}

bootstrapCloudApp();

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('离线功能注册失败，不影响云端使用。', error);
    });
  });
}
