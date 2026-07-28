-- ============================================================
-- AI 聚合平台 — 数据库表结构（修正版）
-- 与 AI 平台 (aiBeta) 和 管理后台 (AI-admin) 共用
-- 账号等级: 游客(guest) → 普通(user) → 进阶(advanced) → VIP(vip) → 代理(agent) → 管理员(admin)
-- 执行方式：登录 Supabase 控制台 → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================

-- 启用 RLS（行级安全）
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 1. 会员等级配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_levels (
    id SERIAL PRIMARY KEY,
    level_key TEXT NOT NULL UNIQUE,           -- 'guest' | 'user' | 'advanced' | 'vip' | 'agent' | 'admin'
    name TEXT NOT NULL,                        -- 显示名称
    name_en TEXT,                              -- 英文名称
    description TEXT,                          -- 等级描述
    token_quota INTEGER DEFAULT 0,             -- 每月 Token 配额 (-1=无限)
    daily_quota INTEGER DEFAULT 0,             -- 每日 Token 配额 (-1=无限)
    storage_quota_mb INTEGER DEFAULT 0,        -- 云端存储配额 MB (-1=无限)
    price_month DECIMAL(10,2) DEFAULT 0,       -- 月费（元）
    price_year DECIMAL(10,2) DEFAULT 0,        -- 年费（元）
    features JSONB DEFAULT '{}',             -- 功能权限
    sort_order INTEGER DEFAULT 0,              -- 排序
    is_visible BOOLEAN DEFAULT true,           -- 是否在前端展示
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认等级配置（ON CONFLICT 防止重复执行时报错）
INSERT INTO membership_levels (level_key, name, name_en, description, token_quota, daily_quota, storage_quota_mb, price_month, price_year, features, sort_order)
VALUES
    ('guest', '游客', 'Guest', '无需注册，纯本地使用，数据不上云，API 需自备', 50000, 2000, 0, 0, 0, '{"chat": true, "voice": false, "file": false, "internet": false, "paint": false, "history_limit": 10, "cloud_sync": false, "api_upload": false}', 0),
    ('user', '普通', 'User', '注册会员，仅同步设置数据，API 可选上传', 200000, 10000, 0, 0, 0, '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 50, "cloud_sync": false, "api_upload": "optional"}', 1),
    ('advanced', '进阶', 'Advanced', '进阶会员，云端存储 1GB+，完整云同步', 1000000, 50000, 1024, 29, 299, '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 200, "cloud_sync": true, "api_upload": true, "priority": true}', 2),
    ('vip', 'VIP', 'VIP', 'VIP 会员，云端存储 5GB+，专属客服', 5000000, 200000, 5120, 99, 999, '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": -1, "cloud_sync": true, "api_upload": true, "priority": true, "support": true}', 3),
    ('agent', '代理', 'Agent', '推广代理，云端存储 1GB，享受分润', 1000000, 50000, 1024, 0, 0, '{"chat": true, "voice": true, "file": true, "internet": true, "paint": true, "history_limit": 200, "cloud_sync": true, "api_upload": true, "agent_panel": true}', 4),
    ('admin', '管理员', 'Admin', '系统管理员，拥有全部权限', -1, -1, -1, 0, 0, '{"all": true, "cloud_sync": true, "api_upload": true}', 99)
ON CONFLICT (level_key) DO NOTHING;

-- ============================================================
-- 2. 用户资料表（扩展 Supabase Auth）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email TEXT,
    nickname TEXT DEFAULT '用户',
    avatar_url TEXT,

    -- 会员等级
    role TEXT DEFAULT 'guest',
    role_updated_at TIMESTAMPTZ,

    -- Token 配额
    token_quota INTEGER DEFAULT 50000,
    token_used INTEGER DEFAULT 0,
    token_used_total BIGINT DEFAULT 0,
    daily_used INTEGER DEFAULT 0,
    daily_reset_at TIMESTAMPTZ,

    -- 存储配额（MB）
    storage_quota_mb INTEGER DEFAULT 0,
    storage_used_mb INTEGER DEFAULT 0,

    -- API Key（用户自备，加密存储）
    api_key TEXT,
    api_key_provider TEXT,
    api_key_uploaded BOOLEAN DEFAULT false,

    -- 余额（元）
    balance DECIMAL(10,2) DEFAULT 0,

    -- 代理系统
    is_agent BOOLEAN DEFAULT false,
    agent_code TEXT UNIQUE,
    parent_agent_id UUID REFERENCES profiles(id),
    agent_level INTEGER DEFAULT 1,
    total_commission DECIMAL(10,2) DEFAULT 0,
    pending_commission DECIMAL(10,2) DEFAULT 0,

    -- 注册来源
    invite_code TEXT,
    registered_by UUID REFERENCES profiles(id),

    -- 状态
    status TEXT DEFAULT 'active',
    status_reason TEXT,

    -- 元数据
    last_login_at TIMESTAMPTZ,
    last_login_ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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

-- 管理员可以修改所有用户
CREATE POLICY "Admins can update all profiles" ON profiles
    FOR UPDATE USING (
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
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    by_model JSONB DEFAULT '{}',
    cost DECIMAL(10,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE INDEX idx_token_usage_user_date ON token_usage(user_id, date DESC);

-- Token 用量表 RLS
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own token_usage" ON token_usage
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins view all token_usage" ON token_usage
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins insert token_usage" ON token_usage
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 4. 订单表（充值 + 套餐购买）
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    order_no TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) DEFAULT 0,
    actual_pay DECIMAL(10,2) NOT NULL,
    product_id TEXT,
    product_name TEXT,
    pay_method TEXT,
    pay_time TIMESTAMPTZ,
    pay_trade_no TEXT,
    status TEXT DEFAULT 'pending',
    agent_id UUID REFERENCES profiles(id),
    commission DECIMAL(10,2) DEFAULT 0,
    client_ip TEXT,
    user_agent TEXT,
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_agent ON orders(agent_id);

-- 订单表 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own orders" ON orders
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins view all orders" ON orders
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins update orders" ON orders
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins insert orders" ON orders
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 5. 代理分润记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES profiles(id),
    order_id UUID REFERENCES orders(id),
    order_amount DECIMAL(10,2) NOT NULL,
    rate DECIMAL(5,2) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending',
    settled_at TIMESTAMPTZ,
    level INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commissions_agent ON agent_commissions(agent_id, status);
CREATE INDEX idx_commissions_order ON agent_commissions(order_id);

-- 分润表 RLS
ALTER TABLE agent_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents view own commissions" ON agent_commissions
    FOR SELECT USING (auth.uid() = agent_id);

CREATE POLICY "Admins view all commissions" ON agent_commissions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins update commissions" ON agent_commissions
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 6. 代理关系树
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_relations (
    id BIGSERIAL PRIMARY KEY,
    ancestor_id UUID NOT NULL REFERENCES profiles(id),
    descendant_id UUID NOT NULL REFERENCES profiles(id),
    depth INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ancestor_id, descendant_id)
);

CREATE INDEX idx_agent_rel_ancestor ON agent_relations(ancestor_id);
CREATE INDEX idx_agent_rel_descendant ON agent_relations(descendant_id);

-- 代理关系表 RLS
ALTER TABLE agent_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage agent_relations" ON agent_relations
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 7. 邀请码表
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    created_by UUID REFERENCES profiles(id),
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    reward_type TEXT DEFAULT 'balance',
    reward_value DECIMAL(10,2) DEFAULT 0,
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 邀请码表 RLS
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invite_codes" ON invite_codes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 8. 系统配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES profiles(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认配置
INSERT INTO configs (key, value, description) VALUES
    ('free_quota', '{"monthly": 50000, "daily": 2000, "storage_mb": 0}', '游客配额'),
    ('user_quota', '{"monthly": 200000, "daily": 10000, "storage_mb": 0}', '普通会员配额'),
    ('advanced_quota', '{"monthly": 1000000, "daily": 50000, "storage_mb": 1024}', '进阶会员配额'),
    ('vip_quota', '{"monthly": 5000000, "daily": 200000, "storage_mb": 5120}', 'VIP 会员配额'),
    ('agent_quota', '{"monthly": 1000000, "daily": 50000, "storage_mb": 1024}', '代理配额'),
    ('commission_rate', '{"level1": 20, "level2": 5, "level3": 2}', '代理分润比例（%）'),
    ('agent_min_withdraw', '{"amount": 100}', '代理最低提现金额（元）'),
    ('register_reward', '{"balance": 5, "quota": 10000}', '注册奖励'),
    ('invite_reward', '{"balance": 10, "quota": 20000}', '邀请奖励'),
    ('site_name', '{"zh": "第三方科技", "en": "ThirdTech"}', '站点名称'),
    ('maintenance_mode', '{"enabled": false, "message": "系统维护中"}', '维护模式'),
    ('api_policy', '{"user_provides": true, "supported_providers": ["openai","anthropic","google","ali","tencent","siliconflow"]}', 'API 政策')
ON CONFLICT (key) DO NOTHING;

-- 配置表 RLS
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view configs" ON configs
    FOR SELECT USING (true);

CREATE POLICY "Admins update configs" ON configs
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins insert configs" ON configs
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================
-- 9. 操作日志表（审计）
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    old_value JSONB,
    new_value JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- 审计日志表 RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit_logs" ON audit_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins insert audit_logs" ON audit_logs
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

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
    v_agent_id UUID;
    v_parent_agent_id UUID;
    v_rate DECIMAL(5,2);
    v_commission DECIMAL(10,2);
BEGIN
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        v_product_id := NEW.product_id;

        -- 1. 充值：增加余额
        IF NEW.type = 'recharge' THEN
            UPDATE profiles
            SET balance = balance + NEW.actual_pay
            WHERE id = NEW.user_id;
        END IF;

        -- 2. 升级：修改用户等级
        IF NEW.type = 'upgrade' AND v_product_id IS NOT NULL THEN
            UPDATE profiles
            SET role = v_product_id,
                role_updated_at = NOW()
            WHERE id = NEW.user_id;
        END IF;

        -- 3. 处理代理分润
        SELECT parent_agent_id INTO v_agent_id
        FROM profiles WHERE id = NEW.user_id;

        IF v_agent_id IS NOT NULL THEN
            -- 一级分润
            SELECT (value->>'level1')::DECIMAL INTO v_rate
            FROM configs WHERE key = 'commission_rate';

            v_commission := NEW.actual_pay * v_rate / 100;

            INSERT INTO agent_commissions (agent_id, from_user_id, order_id, order_amount, rate, amount, level)
            VALUES (v_agent_id, NEW.user_id, NEW.id, NEW.actual_pay, v_rate, v_commission, 1);

            UPDATE profiles
            SET pending_commission = pending_commission + v_commission,
                total_commission = total_commission + v_commission
            WHERE id = v_agent_id;

            -- 二级分润
            SELECT parent_agent_id INTO v_parent_agent_id
            FROM profiles WHERE id = v_agent_id;

            IF v_parent_agent_id IS NOT NULL THEN
                SELECT (value->>'level2')::DECIMAL INTO v_rate
                FROM configs WHERE key = 'commission_rate';

                v_commission := NEW.actual_pay * v_rate / 100;

                INSERT INTO agent_commissions (agent_id, from_user_id, order_id, order_amount, rate, amount, level)
                VALUES (v_parent_agent_id, NEW.user_id, NEW.id, NEW.actual_pay, v_rate, v_commission, 2);

                UPDATE profiles
                SET pending_commission = pending_commission + v_commission,
                    total_commission = total_commission + v_commission
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
    IF v_level.daily_quota >= 0 AND v_profile.daily_used + p_needed_tokens > v_level.daily_quota THEN
        RETURN QUERY SELECT false, v_level.daily_quota - v_profile.daily_used,
            '今日配额已用完，剩余 ' || (v_level.daily_quota - v_profile.daily_used) || ' tokens'::TEXT;
        RETURN;
    END IF;

    -- 检查每月配额
    IF v_level.token_quota >= 0 AND v_profile.token_used + p_needed_tokens > v_level.token_quota THEN
        RETURN QUERY SELECT false, v_level.token_quota - v_profile.token_used,
            '本月配额已用完，剩余 ' || (v_level.token_quota - v_profile.token_used) || ' tokens'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT true,
        CASE WHEN v_level.token_quota >= 0 THEN v_level.token_quota - v_profile.token_used ELSE -1 END,
        '配额充足'::TEXT;
END;
$$ language 'plpgsql';

-- ============================================================
-- 15. 函数：创建代理关系（注册时调用）
-- ============================================================
CREATE OR REPLACE FUNCTION create_agent_relation(p_user_id UUID, p_parent_agent_id UUID)
RETURNS void AS $$
BEGIN
    IF p_parent_agent_id IS NULL THEN
        RETURN;
    END IF;

    -- 插入直接关系
    INSERT INTO agent_relations (ancestor_id, descendant_id, depth)
    VALUES (p_parent_agent_id, p_user_id, 1)
    ON CONFLICT DO NOTHING;

    -- 继承上级关系
    INSERT INTO agent_relations (ancestor_id, descendant_id, depth)
    SELECT ancestor_id, p_user_id, depth + 1
    FROM agent_relations
    WHERE descendant_id = p_parent_agent_id
    ON CONFLICT DO NOTHING;
END;
$$ language 'plpgsql';

-- ============================================================
-- 完成
-- ============================================================
SELECT '数据库表结构创建完成！共 9 张表 + 触发器 + RLS 策略' AS status;


-- ============================================================
-- CARD KEYS · 卡密系统
-- ============================================================

CREATE TABLE IF NOT EXISTS card_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key_code text UNIQUE NOT NULL,
  plan_type text NOT NULL CHECK (plan_type IN ('planet', 'star', 'galaxy', 'universe')),
  duration_days int NOT NULL CHECK (duration_days IN (30, 365)),
  is_used boolean DEFAULT false,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  note text
);

-- 卡密使用记录
CREATE TABLE IF NOT EXISTS card_key_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  card_key_id uuid REFERENCES card_keys(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('redeem', 'revoke', 'delete')),
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- 用户临时存储额度（抽奖获得）
CREATE TABLE IF NOT EXISTS user_bonus_storage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  size_bytes bigint NOT NULL,
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  is_active boolean DEFAULT true,
  source text DEFAULT 'lottery' CHECK (source IN ('lottery', 'event', 'admin')),
  created_at timestamptz DEFAULT now()
);

-- 邀请记录
CREATE TABLE IF NOT EXISTS user_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inviter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text,
  invitee_paid boolean DEFAULT false,
  lottery_earned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(inviter_id, invitee_id)
);

-- 抽奖记录
CREATE TABLE IF NOT EXISTS lottery_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  prize_type text NOT NULL CHECK (prize_type IN ('none', 'membership', 'storage')),
  prize_detail jsonb,
  prize_tier int,
  is_claimed boolean DEFAULT true,
  claimed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- 设备表
CREATE TABLE IF NOT EXISTS user_devices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text,
  device_type text CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'unknown')),
  device_model text,
  os text,
  browser text,
  ip_address text,
  location text,
  last_active timestamptz,
  is_trusted boolean DEFAULT false,
  is_current boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 家庭组
CREATE TABLE IF NOT EXISTS family_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type text NOT NULL,
  total_storage bigint,
  created_at timestamptz DEFAULT now(),
  dissolved_at timestamptz,
  is_active boolean DEFAULT true
);

-- 家庭成员
CREATE TABLE IF NOT EXISTS family_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id uuid REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  allocated_storage bigint DEFAULT 0,
  is_owner boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  UNIQUE(family_id, user_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_card_keys_plan ON card_keys(plan_type);
CREATE INDEX IF NOT EXISTS idx_card_keys_used ON card_keys(is_used);
CREATE INDEX IF NOT EXISTS idx_card_keys_code ON card_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_bonus_storage_user ON user_bonus_storage(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_storage_expires ON user_bonus_storage(expires_at);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON user_invites(inviter_id);
CREATE INDEX IF NOT EXISTS idx_lottery_user ON lottery_records(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_family_owner ON family_groups(owner_id);

-- RLS 策略（卡密表只有管理员可操作）
ALTER TABLE card_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_key_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bonus_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的数据
CREATE POLICY "用户查看自己的卡密日志" ON card_key_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "用户查看自己的临时存储" ON user_bonus_storage FOR ALL USING (user_id = auth.uid());
CREATE POLICY "用户查看自己的邀请" ON user_invites FOR SELECT USING (inviter_id = auth.uid() OR invitee_id = auth.uid());
CREATE POLICY "用户查看自己的抽奖记录" ON lottery_records FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "用户管理自己的设备" ON user_devices FOR ALL USING (user_id = auth.uid());
CREATE POLICY "用户查看自己的家庭组" ON family_groups FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "用户查看自己的家庭成员" ON family_members FOR ALL USING (user_id = auth.uid());
