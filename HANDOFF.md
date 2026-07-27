# 🤝 AI 交接文档 — AI-admin 管理后台 v1.0

> **分支**: `ai-handoff`  
> **仓库**: `Smalluniverseheng/AI-admin`  
> **创建时间**: 2026-07-27  
> **交接人**: Kimi (Moonshot AI)  
> **状态**: 前端代码已完成，待执行 SQL + 替换 Key 后上线

---

## 📁 文件清单

| 文件 | 说明 | 大小 |
|------|------|------|
| `index.html` | 完整页面：登录页 + 仪表盘/用户/代理/订单/设置 | 11.8 KB |
| `css/admin.css` | 深色主题样式，响应式，含图表/表格/弹窗/Toast | 14.7 KB |
| `js/supabase-client.js` | Supabase 初始化（**需替换 Anon Key**） | 536 B |
| `js/admin.js` | 核心逻辑：CRUD、图表、分页、弹窗、审计日志 | 48.1 KB |
| `js/membership.js` | 【主站对接用】会员等级 + Token 配额检查 | 9.3 KB |
| `database/schema.sql` | 修正版：9张表 + 触发器 + 完整 RLS 策略 | 22.2 KB |
| `.nojekyll` | GitHub Pages 必需 | 0 B |

---

## 🚀 部署步骤（必须按顺序执行）

### 步骤 1：执行数据库 SQL
1. 登录 [Supabase 控制台](https://supabase.com/dashboard/project/mxvxlgjzeboktufumxbp)
2. 进入 **SQL Editor** → **New query**
3. 粘贴 `database/schema.sql` **全部内容**
4. 点击 **Run**
5. 执行成功后，9 张表 + 触发器 + RLS 策略全部就绪

### 步骤 2：配置 Supabase Anon Key
编辑 `js/supabase-client.js`：
```javascript
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIs...'; // ← 替换为真实 anon key
```
获取方式：Supabase 控制台 → Project Settings → API → `anon/public` key

### 步骤 3：创建管理员账号
1. Supabase 控制台 → Authentication → Users → **Invite user**
2. 输入管理员邮箱，发送邀请
3. 用户通过邮件验证后，在 Table Editor → `profiles` 表中
4. 将该用户的 `role` 字段改为 `admin`

### 步骤 4：部署到 GitHub Pages
```bash
git checkout ai-handoff
# 修改 js/supabase-client.js 中的 key
git add .
git commit -m "v1.0: ready for deploy"
git push origin ai-handoff
# 然后在 GitHub 仓库 Settings → Pages → Branch 选择 ai-handoff
git checkout main
git merge ai-handoff
git push origin main
```

---

## 🔌 主站（AI 平台）对接说明

将 `js/membership.js` 复制到主站 `AI/js/` 目录，在 `index.html` 中引入：
```html
<script src="js/membership.js?v=1.0"></script>
```

### 埋点位置

| 文件 | 位置 | 代码 |
|------|------|------|
| `js/api.js` | `chat()` 方法开头 | `const check = await QuotaCheck.beforeChat(modelId, messages); if (!check.ok) return Promise.reject(new Error(check.reason));` |
| `js/api.js` | `accountUsage()` 末尾 | `QuotaCheck.afterChat(modelId, usage);` |
| `js/supabase.js` | 登录成功处 | `Membership.clearCache();` |
| `js/pages.js` | 个人中心页 | `const q = await Membership.getQuota(cloudUser.id); // 展示剩余 Token` |

---

## ⚠️ 已知问题与注意事项

1. **Supabase Key 占位符**：`js/supabase-client.js` 中的 `YOUR_SUPABASE_ANON_KEY_HERE` 必须替换，否则无法连接数据库。
2. **Schema 字段修复**：原仓库 `schema.sql` 在 `membership_levels` INSERT 时使用了表不存在的 `storage_quota_mb` 字段，**已修正**（表定义中已加入该字段）。
3. **分润结算逻辑**：`admin.js` 的 `settleCommission` 已修复为 `balance = balance + pending_commission`（累加而非赋值）。
4. **版本号规则**：严格遵守 `x.y` 格式，禁止 `x.y.z`。修改 `index.html` 和 `js/admin.js` 的 `?v=` 参数时需同步。
5. **每日重置**：`reset_daily_quota()` 函数已创建，但需通过 Supabase Cron 或外部定时任务每天调用一次。
6. **RLS 策略**：管理员 JWT 即可操作所有数据，**无需 service_role key 暴露到前端**。

---

## 📊 功能模块状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 📊 仪表盘 | ✅ 完成 | 统计卡片 + 4 个 Chart.js 图表（用户趋势/收入趋势/等级分布/Token Top5） |
| 👥 用户管理 | ✅ 完成 | 列表/搜索/筛选/分页 + 编辑弹窗（角色/配额/余额/状态）+ 详情页 |
| 🤝 代理管理 | ✅ 完成 | 列表/搜索 + 下级查看 + 分润记录 + 结算按钮 |
| 💰 订单管理 | ✅ 完成 | 列表/筛选/分页 + 确认支付 + 退款 + 详情 |
| ⚙️ 系统设置 | ✅ 完成 | 会员等级配置 + 分润比例 + 注册奖励 + 站点名称 + 维护模式 + 邀请码管理 |
| 🔐 审计日志 | ✅ 完成 | 所有写操作自动记录到 `audit_logs` 表 |
| 🔌 主站对接 | ✅ 完成 | `membership.js` 提供 `QuotaCheck.beforeChat/afterChat` |

---

## 🔗 相关链接

- **管理后台**: https://smalluniverseheng.github.io/AI-admin/
- **主站**: https://smalluniverseheng.github.io/AI/
- **主站仓库**: https://github.com/Smalluniverseheng/AI
- **管理后台仓库**: https://github.com/Smalluniverseheng/AI-admin
- **当前分支**: `ai-handoff`

---

*交接完成。如有问题，请查看 `js/admin.js` 中的注释或联系上一任 AI。*
