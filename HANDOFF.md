# 🤝 AI 交接文档 — AI-admin 管理后台 v1.1（含云端代理模式）

> **分支**: `ai-handoff`  
> **仓库**: `Smalluniverseheng/AI-admin`  
> **创建时间**: 2026-07-27  
> **交接人**: Kimi (Moonshot AI)  
> **状态**: 前端 + Worker + 数据库 Schema 全部完成，待执行 SQL + 部署 Worker

---

## 📁 文件清单

### 管理后台
| 文件 | 说明 | 大小 |
|------|------|------|
| `index.html` | 完整页面：登录页 + 仪表盘/用户/代理/订单/设置 | 11.8 KB |
| `css/admin.css` | 深色主题样式，响应式 | 14.7 KB |
| `js/supabase-client.js` | Supabase 初始化（**已配置真实 Key**） | 536 B |
| `js/admin.js` | 核心逻辑：CRUD、图表、分页、弹窗、审计日志 | 48.1 KB |
| `js/membership.js` | 主站对接：会员等级 + Token 配额检查 | 9.3 KB |
| `js/cloud-agent.js` | **新增**：前端云端代理模式对接 | 8.1 KB |
| `database/schema.sql` | 修正版：9张表 + 触发器 + RLS | 22.2 KB |
| `database/schema-cloud.sql` | **新增**：云端代理模式追加表 | 4.5 KB |
| `HANDOFF.md` | 本交接文档 | - |

### Worker 网关
| 文件 | 说明 |
|------|------|
| `worker/index.ts` | **Worker 主代码**：23 家厂商路由 + 流式 SSE + 持久化 + 用量统计 | 34.4 KB |
| `worker/wrangler.toml` | Worker 配置 | 1.2 KB |
| `worker/package.json` | 依赖 | 0.3 KB |
| `worker/tsconfig.json` | TypeScript 配置 | 0.3 KB |
| `worker/deploy.sh` | 一键部署脚本 | 1.5 KB |
| `worker/README.md` | Worker 文档 | 0.8 KB |

---

## 🏗️ 架构说明

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   游客/普通用户  │     │   进阶/VIP/代理  │     │    管理员       │
│   API Key 在本地 │     │   API Key 上传云端│     │   管理后台      │
│   浏览器直连厂商 │     │   Worker 代发    │     │   仪表盘/CRUD   │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                         │
         │ 本地模式                │ 云端代理模式
         │                         │
    ┌────▼────┐              ┌──────▼──────┐
    │ 23家厂商 │              │ Cloudflare  │
    │ 直连    │              │ Worker      │
    └─────────┘              │ 代发 + 持久化│
                             └──────┬──────┘
                                    │
                             ┌──────▼──────┐
                             │  Supabase   │
                             │ 对话/消息/用量│
                             │ 用户/等级/订单│
                             └─────────────┘
```

---

## 🚀 部署步骤（必须按顺序）

### 步骤 1：执行数据库 SQL（管理后台表）
1. 登录 [Supabase 控制台](https://supabase.com/dashboard/project/mxvvxlgjzeboktufumxbp)
2. SQL Editor → New query → 粘贴 `database/schema.sql` **全部内容** → Run
3. 再新建一个 query → 粘贴 `database/schema-cloud.sql` **全部内容** → Run

### 步骤 2：创建管理员账号
1. Authentication → Users → Invite user（你的邮箱）
2. 验证后，Table Editor → `profiles` → 把该用户的 `role` 改为 `admin`

### 步骤 3：部署 Cloudflare Worker
```bash
# 1. 克隆仓库
git clone https://github.com/Smalluniverseheng/AI-admin.git
cd AI-admin/worker

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare
npx wrangler login

# 4. 创建 KV 命名空间
npx wrangler kv:namespace create "AI_GATEWAY_KV"
# 把返回的 id 填到 wrangler.toml 中

# 5. 设置 Secrets
npx wrangler secret put WORKER_SECRET        # 任意强密码
npx wrangler secret put SUPABASE_SERVICE_KEY # Supabase service_role key
npx wrangler secret put OPENAI_KEY           # 按需设置厂商 Key
npx wrangler secret put DEEPSEEK_KEY
npx wrangler secret put KIMI_KEY
# ... 其他厂商

# 6. 部署
npx wrangler deploy
```

### 步骤 4：配置前端 Worker 地址
编辑 `js/cloud-agent.js` 第 4 行：
```javascript
const WORKER_URL = 'https://ai-gateway.your-subdomain.workers.dev';
```

### 步骤 5：推送部署
```bash
git checkout ai-handoff
git add .
git commit -m "v1.1: cloud proxy mode complete"
git push origin ai-handoff
# 合并到 main
git checkout main
git merge ai-handoff
git push origin main
```

---

## 🔌 主站（AI 平台）对接

### 1. 引入 cloud-agent.js
在 `index.html` 中：
```html
<script src="js/cloud-agent.js?v=1.1"></script>
```

### 2. 在 api.js 的 chat() 中判断模式
```javascript
// 开头添加
if (CloudAgent.isActive()) {
  return CloudAgent.chatViaCloud(modelId, messages, {
    temperature, maxTokens, stream: true,
    conversationId: currentConversationId
  });
}
// 原有本地逻辑不变...
```

### 3. 在设置页添加"一键上传 Key"按钮
```javascript
// 上传 Key 到云端
await CloudAgent.uploadKeyToCloud('openai', apiKey);
```

### 4. 添加模式切换按钮
```javascript
// 切换本地/云端代理
CloudAgent.toggleMode();
```

---

## ⚠️ 已知问题

1. **Worker URL 占位符**：`js/cloud-agent.js` 中的 `WORKER_URL` 需要替换为真实 Worker 地址
2. **Supabase Service Key**：Worker 需要 `service_role` key（不是 anon key），在 Supabase Project Settings → API 中获取
3. **厂商 Key**：Worker 中的厂商 Key 是兜底用的，用户上传自己的 Key 后会优先使用用户的
4. **版本号规则**：严格遵守 `x.y` 格式，禁止 `x.y.z`

---

## 📊 功能状态

| 模块 | 状态 |
|------|------|
| 📊 仪表盘 | ✅ |
| 👥 用户管理 | ✅ |
| 🤝 代理管理 | ✅ |
| 💰 订单管理 | ✅ |
| ⚙️ 系统设置 | ✅ |
| 🔐 审计日志 | ✅ |
| ☁️ 云端代理模式 | ✅ |
| 🔌 主站会员对接 | ✅ |

---

*交接完成。Worker 部署后替换 URL 即可上线。*

---

## 2026-07-29 更新 · v5.7 会员体系对接

### 新增功能
- **卡密管理页面** (`index.html` + `js/admin.js` + `css/admin.css`)
  - 随机生成 50 位卡密
  - 支持批量导出 CSV/TXT
  - 卡密列表筛选与搜索
  - 使用状态统计

- **数据库表扩展** (`database/schema.sql` + `database/schema-cloud.sql`)
  - `card_keys` — 卡密主表
  - `card_key_logs` — 使用记录
  - `user_bonus_storage` — 抽奖临时存储
  - `lottery_records` — 抽奖记录
  - `user_invites` — 邀请记录
  - `user_devices` — 设备管理
  - `family_groups` / `family_members` — 家庭共享

### 与主站对接
- 主站 (`aiBeta`) 已更新 v5.7 会员体系
- 用户在前端输入卡密 → 调用 Worker API → 验证并激活
- 管理员在后台生成卡密 → 分发用户 → 用户自助激活

