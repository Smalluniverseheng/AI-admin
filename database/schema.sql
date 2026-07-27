-- ============================================================
-- AI 聚合平台 — 数据库表结构
-- 与 AI 平台 (aiBeta) 和 管理后台 (AI-admin) 共用
-- 账号等级: 游客(guest) → 普通(user) → 进阶(advanced) → VIP(vip) → 代理(agent) → 管理员(admin)
-- ============================================================

-- 启用 RLS（行级安全）
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 1. 会员等级配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_levels (
    id          SERIAL PRIMARY KEY,
    level_key   TEXT NOT NULL UNIQUE,     -- 'guest' | 'user' | 'advanced' | 'vip' | 'agent' | 'admin'
    name        TEXT NOT NULL,              -- 显示名称: 游客/普通/进阶/VIP/代理/管理员
    name_en     TEXT,                      -- 英文名称
    description TEXT,                      -- 等级描述
    token_quota INTEGER DEFAULT 0,          -- 每月 Token 配额
    daily_quota INTEGER DEFAULT 0,        -- 每日 Token 配额
    price_month DECIMAL(10,2) DEFAULT 0,  -- 月费（元）
    price_year  DECIMAL(10,2) DEFAULT 0,   -- 年费（元）
    features    JSONB DEFAULT '{}',       -- 功能权限: {"voice": true, "file": false, ...}
    sort_order  INTEGER DEFAULT 0,        -- 排序
    is_visible  BOOLEAN DEFAULT true,      -- 是否在前端展示
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认等级配置
INSERT INTO membership_levels (level_key, name, name_en, description, token_quota, daily_quota, storage_quota_mb, price_month, price_year, features, sort_order)
VALUES
    ('guest',    '游客',    'Guest',     '无需注册，纯本地使用，数据不上云，API 需自备',     50000,   2000,  0,     0,    0,    '{"chat": true, "voice": false, "file": false, "internet": false, "paint": false, "history_limit": 10,  "cloud_sync": false, "api_upload": false}',  0),
    ('user',     '普通',    'User',      '注册会员，仅同步设置数据，API 可选上传',           200000,  10000, 0,     0,    0,    '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 50,   "cloud_sync": false, "api_upload": "optional"}',  1),
    ('advanced', '进阶',    'Advanced',  '进阶会员，云端存储 1GB+，完整云同步',              1000000, 50000, 1024,  29,   299,  '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 200,  "cloud_sync": true,  "api_upload": true, "priority": true}', 2),
    ('vip',      'VIP',     'VIP',       'VIP 会员，云端存储 5GB+，专属客服',               5000000, 200000, 5120, 99,   999,  '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": -1,   "cloud_sync": true,  "api_upload": true, "priority": true, "support": true}', 3),
    ('agent',    '代理',    'Agent',     '推广代理，云端存储 1GB，享受分润',               1000000, 50000, 1024,  0,    0,    '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 200,  "cloud_sync": true,  "api_upload": true, "agent_panel": true}', 4),
    ('admin',    '管理员',  'Admin',     '系统管理员，拥有全部权限',                        -1,      -1,   -1,    0,    0,    '{"all": true, "cloud_sync": true, "api_upload": true}', 99)
ON CONFLICT (level_key) DO NOTHING;

-- ============================================================
-- 2. 用户资料表（扩展 Supabase Auth）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email           TEXT,
    nickname        TEXT DEFAULT '用户' || substr(id::text, 1, 6),
    avatar_url      TEXT,

    -- 会员等级
    role            TEXT DEFAULT 'guest',           -- guest | user | advanced | vip | agent | admin
    role_updated_at TIMESTAMPTZ,

    -- Token 配额
    token_quota     INTEGER DEFAULT 50000,           -- 当前等级对应的月配额
    token_used      INTEGER DEFAULT 0,             -- 本月已使用
    token_used_total BIGINT DEFAULT 0,              -- 累计使用
    daily_used      INTEGER DEFAULT 0,             -- 今日已使用
    daily_reset_at  TIMESTAMPTZ,                   -- 每日重置时间

    -- 存储配额（MB）
    storage_quota_mb INTEGER DEFAULT 0,            -- 云端存储配额（0=不上云）
    storage_used_mb  INTEGER DEFAULT 0,              -- 已使用存储（MB）

    -- API Key（用户自备）
    api_key         TEXT,                            -- 用户自购的 API Key（加密存储）
    api_key_provider TEXT,                           -- 厂商标识（openai/anthropic/ali 等）
    api_key_uploaded BOOLEAN DEFAULT false,          -- 是否上传到云端（普通用户可选）

    -- 余额（充值余额，可用于购买套餐或按量付费）
    balance         DECIMAL(10,2) DEFAULT 0,       -- 余额（元）

    -- 代理系统
    is_agent        BOOLEAN DEFAULT false,           -- 是否为代理
    agent_code      TEXT UNIQUE,                   -- 代理邀请码（如 AGENT-XXXX）
    parent_agent_id UUID REFERENCES profiles(id),   -- 上级代理ID
    agent_level     INTEGER DEFAULT 1,             -- 代理层级（1级/2级/3级）
    total_commission DECIMAL(10,2) DEFAULT 0,     -- 累计分润
    pending_commission DECIMAL(10,2) DEFAULT 0,     -- 待结算分润

    -- 注册来源
    invite_code     TEXT,                          -- 注册时使用的邀请码
    registered_by   UUID REFERENCES profiles(id),  -- 邀请人ID

    -- 状态
    status          TEXT DEFAULT 'active',         -- active | suspended | banned
    status_reason   TEXT,                          -- 状态变更原因

    -- 元数据
    last_login_at   TIMESTAMPTZ,
    last_login_ip   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 为用户资料表启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 用户只能查看和修改自己的资料
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- 管理员可以查看所有用户
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- 代理可以查看自己的下级
CREATE POLICY "Agents can view subordinates" ON profiles
    FOR SELECT USING (
        parent_agent_id = auth.uid() OR id = auth.uid()
    );

-- ============================================================
-- 3. Token 用量记录表（按天统计）
-- ============================================================
CREATE TABLE IF NOT EXISTS token_usage (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date        DATE NOT NULL DEFAULT CURRENT_DATE,

    -- 用量统计
    input_tokens  INTEGER DEFAULT 0,              -- 输入 Token 数
    output_tokens INTEGER DEFAULT 0,              -- 输出 Token 数
    total_tokens  INTEGER DEFAULT 0,              -- 总计

    -- 按模型统计（JSONB）
    by_model    JSONB DEFAULT '{}',               -- {"gpt-4": 5000, "claude-3": 3000}

    -- 费用（按量计费时）
    cost        DECIMAL(10,4) DEFAULT 0,          -- 本次费用（元）

    created_at  TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, date)
);

CREATE INDEX idx_token_usage_user_date ON token_usage(user_id, date DESC);

-- ============================================================
-- 4. 订单表（充值 + 套餐购买）
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- 订单信息
    order_no    TEXT UNIQUE NOT NULL,             -- 订单号（如 ORD-20260727-XXXX）
    type        TEXT NOT NULL,                    -- recharge(充值) | upgrade(升级) | package(套餐)

    -- 金额
    amount      DECIMAL(10,2) NOT NULL,           -- 订单金额（元）
    discount    DECIMAL(10,2) DEFAULT 0,          -- 优惠金额
    actual_pay  DECIMAL(10,2) NOT NULL,          -- 实付金额

    -- 商品信息
    product_id  TEXT,                             -- 商品ID（如 level_advanced, package_100w）
    product_name TEXT,                            -- 商品名称

    -- 支付信息
    pay_method  TEXT,                             -- wechat | alipay | balance
    pay_time    TIMESTAMPTZ,                      -- 支付时间
    pay_trade_no TEXT,                            -- 第三方支付流水号

    -- 状态
    status      TEXT DEFAULT 'pending',           -- pending(待支付) | paid(已支付) | cancelled(已取消) | refunded(已退款)

    -- 代理分润关联
    agent_id    UUID REFERENCES profiles(id),     -- 关联代理ID
    commission  DECIMAL(10,2) DEFAULT 0,          -- 该订单产生的分润

    -- 元数据
    client_ip   TEXT,
    user_agent  TEXT,
    remark      TEXT,                             -- 备注

    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_agent ON orders(agent_id);

-- ============================================================
-- 5. 代理分润记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_commissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- 来源
    from_user_id UUID REFERENCES profiles(id),    -- 产生消费的用户
    order_id    UUID REFERENCES orders(id),      -- 关联订单

    -- 分润金额
    order_amount DECIMAL(10,2) NOT NULL,         -- 订单金额
    rate        DECIMAL(5,2) NOT NULL,            -- 分润比例（如 20.00 表示 20%）
    amount      DECIMAL(10,2) NOT NULL,           -- 分润金额

    -- 状态
    status      TEXT DEFAULT 'pending',           -- pending(待结算) | settled(已结算) | cancelled(已取消)
    settled_at  TIMESTAMPTZ,                      -- 结算时间

    -- 层级
    level       INTEGER DEFAULT 1,                -- 分润层级（1级直接分润，2级间接分润）

    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commissions_agent ON agent_commissions(agent_id, status);
CREATE INDEX idx_commissions_order ON agent_commissions(order_id);

-- ============================================================
-- 6. 代理关系树（方便查询多级代理）
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_relations (
    id          BIGSERIAL PRIMARY KEY,
    ancestor_id UUID NOT NULL REFERENCES profiles(id),   -- 上级代理
    descendant_id UUID NOT NULL REFERENCES profiles(id),   -- 下级（可以是用户或代理）
    depth       INTEGER NOT NULL DEFAULT 1,              -- 层级深度（1=直接，2=间接）

    UNIQUE(ancestor_id, descendant_id)
);

CREATE INDEX idx_agent_rel_ancestor ON agent_relations(ancestor_id);
CREATE INDEX idx_agent_rel_descendant ON agent_relations(descendant_id);

-- ============================================================
-- 7. 邀请码表
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT UNIQUE NOT NULL,             -- 邀请码（如 X7K9P2）

    -- 创建者
    created_by  UUID REFERENCES profiles(id),     -- 谁创建的（null=系统发放）

    -- 使用限制
    max_uses    INTEGER DEFAULT 1,                -- 最大使用次数
    used_count  INTEGER DEFAULT 0,                -- 已使用次数

    -- 奖励
    reward_type TEXT DEFAULT 'balance',           -- balance(余额) | quota(配额) | level(等级)
    reward_value DECIMAL(10,2) DEFAULT 0,         -- 奖励值

    -- 有效期
    valid_from  TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,                      -- null=永久有效

    -- 状态
    status      TEXT DEFAULT 'active',            -- active | expired | disabled

    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. 系统配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS configs (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,                   -- 配置值（JSON格式，灵活存储）
    description TEXT,
    updated_by  UUID REFERENCES profiles(id),     -- 最后修改人
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认配置
INSERT INTO configs (key, value, description) VALUES
    ('free_quota',         '{"monthly": 50000,  "daily": 2000,  "storage_mb": 0}',    '游客配额'),
    ('user_quota',         '{"monthly": 200000, "daily": 10000, "storage_mb": 0}',    '普通会员配额（仅设置同步）'),
    ('advanced_quota',     '{"monthly": 1000000,"daily": 50000,  "storage_mb": 1024}', '进阶会员配额（1GB 云存储）'),
    ('vip_quota',          '{"monthly": 5000000,"daily": 200000, "storage_mb": 5120}', 'VIP 会员配额（5GB 云存储）'),
    ('agent_quota',        '{"monthly": 1000000,"daily": 50000,  "storage_mb": 1024}', '代理配额（1GB 云存储）'),
    ('commission_rate',    '{"level1": 20, "level2": 5, "level3": 2}', '代理分润比例（%）'),
    ('agent_min_withdraw', '{"amount": 100}',                      '代理最低提现金额（元）'),
    ('register_reward',    '{"balance": 5, "quota": 10000}',       '注册奖励'),
    ('invite_reward',      '{"balance": 10, "quota": 20000}',      '邀请奖励'),
    ('site_name',          '{"zh": "第三方科技", "en": "ThirdTech"}', '站点名称'),
    ('maintenance_mode',   '{"enabled": false, "message": "系统维护中"}', '维护模式'),
    ('api_policy',         '{"user_provides": true, "supported_providers": ["openai","anthropic","google","ali","tencent","siliconflow"]}', 'API 政策：用户自备 Key')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 9. 操作日志表（审计）
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES profiles(id),
    action      TEXT NOT NULL,                    -- login | logout | recharge | upgrade | agent_apply | ...
    target_type TEXT,                             -- user | order | config | ...
    target_id   TEXT,                             -- 目标对象ID
    old_value   JSONB,                            -- 修改前
    new_value   JSONB,                            -- 修改后
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- ============================================================
-- 10. 触发器：自动更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要自动更新的表添加触发器
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 11. 触发器：Token 用量自动统计
-- ============================================================
CREATE OR REPLACE FUNCTION update_token_usage()
RETURNS TRIGGER AS $$
BEGIN
    -- 更新 profiles 中的累计用量
    UPDATE profiles 
    SET token_used = token_used + NEW.total_tokens,
        token_used_total = token_used_total + NEW.total_tokens,
        daily_used = daily_used + NEW.total_tokens
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_token_usage ON token_usage;
CREATE TRIGGER trg_token_usage
    AFTER INSERT ON token_usage
    FOR EACH ROW EXECUTE FUNCTION update_token_usage();

-- ============================================================
-- 12. 触发器：订单支付后自动处理
-- ============================================================
CREATE OR REPLACE FUNCTION process_paid_order()
RETURNS TRIGGER AS $$
DECLARE
    v_product_id TEXT;
    v_user_role TEXT;
    v_commission_rate DECIMAL(5,2);
    v_agent_id UUID;
    v_parent_agent_id UUID;
BEGIN
    -- 只处理状态变为 paid 的订单
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        v_product_id := NEW.product_id;

        -- 1. 如果是充值，增加余额
        IF NEW.type = 'recharge' THEN
            UPDATE profiles 
            SET balance = balance + NEW.actual_pay
            WHERE id = NEW.user_id;
        END IF;

        -- 2. 如果是升级，修改用户等级
        IF NEW.type = 'upgrade' THEN
            UPDATE profiles 
            SET role = v_product_id,
                role_updated_at = NOW()
            WHERE id = NEW.user_id;
        END IF;

        -- 3. 处理代理分润
        SELECT parent_agent_id INTO v_agent_id 
        FROM profiles WHERE id = NEW.user_id;

        IF v_agent_id IS NOT NULL THEN
            -- 获取分润比例
            SELECT (value->>'level1')::DECIMAL INTO v_commission_rate
            FROM configs WHERE key = 'commission_rate';

            -- 创建分润记录
            INSERT INTO agent_commissions (agent_id, from_user_id, order_id, order_amount, rate, amount, level)
            VALUES (v_agent_id, NEW.user_id, NEW.id, NEW.actual_pay, v_commission_rate, 
                    NEW.actual_pay * v_commission_rate / 100, 1);

            -- 更新代理待结算金额
            UPDATE profiles 
            SET pending_commission = pending_commission + (NEW.actual_pay * v_commission_rate / 100)
            WHERE id = v_agent_id;

            -- 二级分润
            SELECT parent_agent_id INTO v_parent_agent_id 
            FROM profiles WHERE id = v_agent_id;

            IF v_parent_agent_id IS NOT NULL THEN
                SELECT (value->>'level2')::DECIMAL INTO v_commission_rate
                FROM configs WHERE key = 'commission_rate';

                INSERT INTO agent_commissions (agent_id, from_user_id, order_id, order_amount, rate, amount, level)
                VALUES (v_parent_agent_id, NEW.user_id, NEW.id, NEW.actual_pay, v_commission_rate,
                        NEW.actual_pay * v_commission_rate / 100, 2);

                UPDATE profiles 
                SET pending_commission = pending_commission + (NEW.actual_pay * v_commission_rate / 100)
                WHERE id = v_parent_agent_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_process_order ON orders;
CREATE TRIGGER trg_process_order
    AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION process_paid_order();

-- ============================================================
-- 13. 函数：每日重置每日用量
-- ============================================================
CREATE OR REPLACE FUNCTION reset_daily_quota()
RETURNS void AS $$
BEGIN
    UPDATE profiles 
    SET daily_used = 0,
        daily_reset_at = NOW()
    WHERE daily_reset_at < CURRENT_DATE OR daily_reset_at IS NULL;
END;
$$ language 'plpgsql';

-- 创建每日重置任务（需要 pg_cron 扩展，或在应用层定时调用）
-- SELECT cron.schedule('reset-daily-quota', '0 0 * * *', 'SELECT reset_daily_quota()');

-- ============================================================
-- 14. 函数：检查用户是否有足够配额
-- ============================================================
CREATE OR REPLACE FUNCTION check_user_quota(p_user_id UUID, p_needed_tokens INTEGER)
RETURNS TABLE (has_quota BOOLEAN, remaining INTEGER, reason TEXT) AS $$
DECLARE
    v_profile profiles%ROWTYPE;
    v_level membership_levels%ROWTYPE;
BEGIN
    SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
    SELECT * INTO v_level FROM membership_levels WHERE level_key = v_profile.role;

    -- 管理员无限制
    IF v_profile.role = 'admin' THEN
        RETURN QUERY SELECT true, -1, '管理员无限制'::TEXT;
        RETURN;
    END IF;

    -- 检查每日配额
    IF v_level.daily_quota > 0 AND v_profile.daily_used + p_needed_tokens > v_level.daily_quota THEN
        RETURN QUERY SELECT false, v_level.daily_quota - v_profile.daily_used, 
            '今日配额已用完，剩余 ' || (v_level.daily_quota - v_profile.daily_used) || ' tokens'::TEXT;
        RETURN;
    END IF;

    -- 检查每月配额
    IF v_level.token_quota > 0 AND v_profile.token_used + p_needed_tokens > v_level.token_quota THEN
        RETURN QUERY SELECT false, v_level.token_quota - v_profile.token_used,
            '本月配额已用完，剩余 ' || (v_level.token_quota - v_profile.token_used) || ' tokens'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, 
        CASE WHEN v_level.token_quota > 0 THEN v_level.token_quota - v_profile.token_used ELSE -1 END,
        '配额充足'::TEXT;
END;
$$ language 'plpgsql';

-- ============================================================
-- 完成
-- ============================================================
SELECT '数据库表结构创建完成！' AS status;
