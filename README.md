# AI 管理后台

> 第三方科技 · AI 智能聚合平台 — 管理后台
> 与 AI 平台共用 Supabase 数据库，数据天然互通

---

## 访问地址

```
https://smalluniverseheng.github.io/AI-admin/
```

---

## 功能模块

| 模块 | 功能 |
|------|------|
| 📊 仪表盘 | 总用户数、代理数、今日订单、今日收入 |
| 👥 用户管理 | 查看用户列表、调整角色、修改 Token 配额 |
| 🤝 代理管理 | 审核代理、查看下级、分润统计 |
| 💰 订单管理 | 充值记录、套餐购买、订单状态 |
| ⚙️ 系统设置 | 会员配额、代理分润比例 |

---

## 账号等级体系

| 等级 | 标识 | 月 Token | 日 Token | 云存储 | 月费 | 功能 |
|------|------|----------|----------|--------|------|------|
| **游客** | `guest` | 5万 | 2千 | ❌ 不上云 | 免费 | 纯本地，10条历史，API 自备 |
| **普通** | `user` | 20万 | 1万 | ❌ 仅设置同步 | 免费 | 对话历史本地存，设置上云 |
| **进阶** | `advanced` | 100万 | 5万 | ✅ 1GB | ¥29 | 完整云同步，优先响应 |
| **VIP** | `vip` | 500万 | 20万 | ✅ 5GB | ¥99 | 完整云同步，专属客服 |
| **代理** | `agent` | 100万 | 5万 | ✅ 1GB | 免费 | 代理面板，享受分润 |
| **管理员** | `admin` | 无限 | 无限 | ✅ 无限 | 免费 | 全部权限 |

### 数据存储规则

| 等级 | 云端同步内容 | 本地存储内容 |
|------|-------------|-------------|
| 游客 | ❌ 不上云（纯本地） | 设置、对话历史、Token 用量、API Key |
| 普通 | ✅ 仅设置数据（主题、偏好、模型选择）<br>API Key **可选**上传 | 对话历史、消息记录、附件 |
| 进阶+ | ✅ 全部数据（设置 + 对话历史 + 消息 + 附件 + API Key） | 缓存数据 |

### API Key 政策

**所有等级都需要自备 API Key。** 平台不提供 API 代付服务。

| 等级 | API Key 存储方式 | 说明 |
|------|-----------------|------|
| 游客 | 仅本地存储 | 不上传云端，换设备需重新填写 |
| 普通 | **可选上传** | 默认不上传，用户可在「我的 → API 设置」中勾选"上传至云端" |
| 进阶+ | 强制云端 | 自动同步到云端，换设备自动恢复 |

支持的厂商：OpenAI、Anthropic、Google、阿里云、腾讯云、硅基流动等。

**安全说明**：上传的 API Key 在数据库中加密存储，管理后台不可查看明文。

---

## 技术栈

- 纯前端 HTML + CSS + Vanilla JS
- Supabase Auth（与 AI 平台共用）
- Supabase Database（与 AI 平台共用表）
- GitHub Pages 部署

---

## 数据库表（与 AI 平台共用）

```sql
-- 1. membership_levels — 会员等级配置
--    level_key: guest | user | advanced | vip | agent | admin

-- 2. profiles — 用户资料（扩展 auth.users）
--    role, token_quota, token_used, balance, agent_code, parent_agent_id

-- 3. token_usage — Token 用量记录（按天统计）

-- 4. orders — 订单（充值/升级/套餐）
--    支付后自动触发：增加余额/升级等级/计算分润

-- 5. agent_commissions — 代理分润记录
--    支持三级分润（level1/level2/level3）

-- 6. agent_relations — 代理关系树

-- 7. invite_codes — 邀请码表

-- 8. configs — 系统配置

-- 9. audit_logs — 操作日志（审计）
```

**完整 SQL**: 见 `database/schema.sql`

---

## 自动触发器

| 触发器 | 说明 |
|--------|------|
| `trg_token_usage` | 插入用量后自动更新 profiles 累计用量 |
| `trg_process_order` | 订单支付后自动：增加余额 + 升级等级 + 计算分润 |
| `reset_daily_quota()` | 每日重置每日用量（需定时调用） |
| `check_user_quota()` | 检查用户是否有足够配额 |

---

## 代理分润规则

```
用户充值/购买 → 订单状态变为 paid
    ↓
查找用户的 parent_agent_id（上级代理）
    ↓
一级代理分润：订单金额 × commission_rate.level1%（默认 20%）
    ↓
查找代理的 parent_agent_id（上上级）
    ↓
二级代理分润：订单金额 × commission_rate.level2%（默认 5%）
    ↓
三级代理分润：订单金额 × commission_rate.level3%（默认 2%）
```

---

## 关联项目

- AI 平台（用户端）: https://github.com/Smalluniverseheng/aiBeta
- AI 平台（生产服）: https://github.com/Smalluniverseheng/AI
