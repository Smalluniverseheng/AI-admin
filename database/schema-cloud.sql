

-- ============================================================
-- 追加：云端代理模式表结构
-- 执行方式：在已有 schema 基础上追加执行
-- ============================================================

-- 1. 加密 API Key 表（已存在则添加 worker_encrypted 列）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'encrypted_api_keys' AND column_name = 'worker_encrypted'
    ) THEN
        ALTER TABLE encrypted_api_keys ADD COLUMN worker_encrypted text;
    END IF;
END
$$;

-- 2. 云端对话表
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT DEFAULT '新对话',
    model_leader TEXT DEFAULT 'kimi',
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- conversations RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own conversations" ON conversations;
CREATE POLICY "Users own conversations"
    ON conversations FOR ALL USING (auth.uid() = user_id);

-- 3. 云端消息表
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    tokens_used INTEGER DEFAULT 0,
    latency_ms INTEGER,
    is_error BOOLEAN DEFAULT false,
    attachments JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- messages RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own messages" ON messages;
CREATE POLICY "Users own messages"
    ON messages FOR ALL USING (
        EXISTS (SELECT 1 FROM conversations WHERE id = messages.conversation_id AND user_id = auth.uid())
    );

-- 4. 触发器：更新对话的 updated_at
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations SET updated_at = NOW() WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_messages_update_conv ON messages;
CREATE TRIGGER trg_messages_update_conv
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- 5. 用户设置表（云端代理模式开关等）
CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    theme TEXT DEFAULT 'dark',
    language TEXT DEFAULT 'zh-CN',
    cloud_mode_enabled BOOLEAN DEFAULT false,
    tts_engine TEXT DEFAULT 'default',
    tts_voice TEXT,
    tts_speed NUMERIC DEFAULT 1.0,
    stt_engine TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own settings" ON user_settings;
CREATE POLICY "Users own settings"
    ON user_settings FOR ALL USING (auth.uid() = user_id);

-- 6. 触发器：更新 user_settings 的 updated_at
DROP TRIGGER IF EXISTS update_user_settings_timestamp ON user_settings;
CREATE TRIGGER update_user_settings_timestamp
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. 云端备份表
CREATE TABLE IF NOT EXISTS cloud_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB NOT NULL,
    size_bytes INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_user ON cloud_backups(user_id, created_at DESC);

ALTER TABLE cloud_backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own backups" ON cloud_backups;
CREATE POLICY "Users own backups"
    ON cloud_backups FOR ALL USING (auth.uid() = user_id);

-- 8. 插入默认配置（如果还没有）
INSERT INTO configs (key, value, description) VALUES
    ('cloud_proxy_enabled', '{"enabled": true, "min_role": "advanced"}', '云端代理模式开关'),
    ('worker_url', '{"url": "https://ai-gateway.your-subdomain.workers.dev"}', 'Worker 网关地址')
ON CONFLICT (key) DO NOTHING;

-- 完成
SELECT '云端代理模式表结构追加完成！' AS status;


-- ============================================================
-- CARD KEYS · 卡密系统（云端精简版）
-- ============================================================

CREATE TABLE IF NOT EXISTS card_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key_code text UNIQUE NOT NULL,
  plan_type text NOT NULL,
  duration_days int NOT NULL,
  is_used boolean DEFAULT false,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  note text
);

CREATE TABLE IF NOT EXISTS user_bonus_storage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  size_bytes bigint NOT NULL,
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  is_active boolean DEFAULT true,
  source text DEFAULT 'lottery',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lottery_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  prize_type text NOT NULL,
  prize_detail jsonb,
  prize_tier int,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_devices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text,
  device_type text,
  last_active timestamptz,
  is_trusted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_keys_used ON card_keys(is_used);
CREATE INDEX IF NOT EXISTS idx_bonus_storage_user ON user_bonus_storage(user_id);
