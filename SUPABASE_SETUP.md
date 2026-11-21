# 作业清 Supabase 配置指南

## 1. 项目信息

当前前端已经写入：

```text
Project URL: https://miphboyfpnhneljwbvfx.supabase.co
Key type: sb_publishable_...
```

Publishable key 可以出现在浏览器前端，但仍然不要把 `service_role` key 放进项目。

配置文件位于 `supabase-config.js`。

## 2. 执行数据库 SQL

1. 登录 Supabase Dashboard。
2. 打开项目 `miphboyfpnhneljwbvfx`。
3. 打开左侧 **SQL Editor**。
4. 新建查询。
5. 复制 [supabase/schema.sql](./supabase/schema.sql) 的完整内容。
6. 点击 **Run**。

SQL 会创建：

- `classes`：班级
- `class_members`：班级创建者和协作者
- `students`：学生名单
- `student_groups`：小组
- `tasks`：作业
- `task_records`：学生作业状态
- `evaluation_tags`：评价标签
- `audit_logs`：修改审计日志

执行完成后可在 **Table Editor** 检查：

- 所有表都存在。
- 所有表都显示 RLS enabled。
- `classes.class_code` 有唯一约束。
- `tasks`、`task_records`、`students` 等表包含 `created_by` 和 `updated_by`。

如果 SQL Editor 报告已有对象，请先确认这是一个尚未部署正式数据的项目。该脚本使用 `if not exists` 和 `drop policy if exists`，可重复执行大部分步骤。

如果登录正常但创建班级失败，请先执行 [supabase/check-install.sql](./supabase/check-install.sql) 检查表、RLS 和触发器是否齐全，然后重新执行完整的 `schema.sql`。

## 3. 开启邮箱登录

进入 **Authentication → Providers → Email**：

- 确认 Email 登录已启用。
- 开发测试阶段可以关闭 Confirm email，注册后直接登录。
- 正式使用时建议开启邮箱验证。

如果开启邮箱验证，请在 **Authentication → URL Configuration** 中填写：

- Site URL：网页正式发布的 HTTPS 地址。
- Redirect URLs：至少加入同一个 HTTPS 地址。

## 4. 发布网页

Supabase 登录和云端同步需要通过 HTTPS 网站访问。建议部署整个 `作业清` 文件夹到：

- Netlify
- Vercel
- GitHub Pages
- Cloudflare Pages

部署时必须包含：

```text
index.html
styles.css
app.js
cloud.js
supabase-config.js
manifest.webmanifest
sw.js
assets/
```

## 5. 首次使用

1. 打开网页，选择“创建账号”。
2. 使用邮箱和密码注册并登录。
3. 在“评价设置”中创建班级。
4. 数据库自动生成唯一 8 位班级号。
5. 批量导入学生。
6. 创建作业并登记状态。

## 6. 同班教师协作

协作者使用自己的账号注册登录，然后：

1. 点击顶部班级名称。
2. 选择“输入班级码加入”。
3. 输入班级创建者提供的 8 位班级号。

加入后可以查看同一批学生与全部作业，但权限限制如下：

- 协作者可以创建和管理自己布置的作业。
- 协作者不能修改或删除其他教师布置的作业。
- 协作者不能修改其他教师作业下的学生状态。
- 学生名单、小组和班级设置只有班级创建者可以修改。
- 数据库会记录 `created_by`、`updated_by` 与审计日志操作人 ID。

## 7. 验证权限

建议使用两个不同邮箱账号测试：

1. 账号 A 创建班级、学生和作业。
2. 账号 B 使用班级号加入。
3. 用账号 B 尝试点击账号 A 作业中的学生状态。
4. 页面应显示只读；即使绕过前端直接请求 Supabase，数据库 RLS 也会拒绝修改。
5. 用账号 B 创建自己的作业，应可以正常登记状态。
6. 用账号 C 不加入班级直接查询数据，应无法看到 A、B 的班级记录。

## 8. 常见问题

### 页面一直显示“Supabase 官方库加载失败”

说明 CDN 无法访问。请：

- 确认浏览器网络正常。
- 通过 HTTPS 网站打开，而不是只发送 `index.html`。
- 刷新页面。

### 注册成功但不能登录

如果开启了 Confirm email，需要先点击邮箱中的验证链接。测试阶段也可以在 Supabase 中暂时关闭 Confirm email。

### 加入班级提示班级号不存在

联系班级创建者复制最新 8 位班级号；`0`、`O`、`I` 等字母不属于班级号，班级号只包含数字。

### 登录成功但无法创建班级

最常见原因是 `classes`、`class_members` 表或对应 RLS/触发器没有完整执行。请：

1. 在 SQL Editor 重新执行最新版 `supabase/schema.sql`。
2. 执行 `supabase/check-install.sql`，确认 8 张表、策略、触发器及 `create_class_with_owner` 函数存在。
3. 等待约 10 秒，刷新网页并重新登录。
4. 在“评价设置 → 检查云端数据库”中确认每张表都显示“可访问”。

最新版客户端会优先调用数据库中的 `create_class_with_owner`，让班级写入、成员关系和默认标签处理都在同一个数据库事务中完成。

如果表检查正常仍然不能创建班级，请单独执行
[supabase/fix-class-creation.sql](./supabase/fix-class-creation.sql)。

### 协作者看到按钮但修改失败

说明前端已拦截或数据库 RLS 拒绝了操作。以数据库拒绝结果为准，这是预期的权限保护。
