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

## 技术栈

- 纯前端 HTML + CSS + Vanilla JS
- Supabase Auth（与 AI 平台共用）
- Supabase Database（与 AI 平台共用表）
- GitHub Pages 部署

---

## 数据库表（与 AI 平台共用）

```sql
-- 用户表（扩展 Supabase Auth）
profiles (
  id uuid references auth.users,
  nickname text,
  avatar_url text,
  role text,           -- 'user' | 'vip' | 'agent' | 'admin'
  agent_code text,     -- 代理邀请码
  parent_agent uuid,   -- 上级代理ID
  token_quota int,     -- 每月Token配额
  token_used int,      -- 已使用
  balance decimal,     -- 余额
  created_at timestamp
)

-- 代理分润记录
agent_commissions (
  id uuid,
  agent_id uuid references profiles,
  user_id uuid references profiles,
  amount decimal,
  order_id uuid,
  status text,
  created_at timestamp
)

-- 充值/订单记录
orders (
  id uuid,
  user_id uuid,
  type text,           -- 'recharge' | 'package'
  amount decimal,
  status text,
  created_at timestamp
)

-- 系统配置
configs (
  key text primary key,
  value jsonb,
  updated_at timestamp
)
```

---

## 开发规则

1. 与 AI 平台共用 Supabase 项目，不要创建新的数据库
2. 管理员通过 `profiles.role = 'admin'` 识别
3. 版本号规则同 AI 平台：只用 x.y 格式

---

## 关联项目

- AI 平台（用户端）: https://github.com/Smalluniverseheng/aiBeta
- AI 平台（生产服）: https://github.com/Smalluniverseheng/AI
