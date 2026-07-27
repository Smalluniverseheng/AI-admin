/* ============================================================
   MEMBERSHIP · 会员等级与配额管理
   与 AI 平台主站对接，提供会员判断、配额检查、功能权限
   使用方式：在 api.js 的 chat() 方法开头调用 QuotaCheck.beforeChat()
   在 api.js 的 accountUsage() 中调用 QuotaCheck.afterChat()
   ============================================================ */

const Membership = (() => {
  const LEVEL_CACHE_KEY = 'ai_membership_cache';
  const QUOTA_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  /* ---------- 本地缓存 ---------- */
  function getCache() {
    try {
      const raw = localStorage.getItem(LEVEL_CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (Date.now() - c.ts > QUOTA_CACHE_TTL) return null;
      return c.data;
    } catch (e) { return null; }
  }

  function setCache(data) {
    try {
      localStorage.setItem(LEVEL_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
  }

  /* ---------- 获取当前云端用户的等级信息 ---------- */
  async function fetchLevel(userId) {
    if (!userId || typeof SB === 'undefined' || !SB.ready()) return null;
    const cached = getCache();
    if (cached) return cached;

    try {
      // 并行查询 profiles + membership_levels
      const [profileRes, levelRes] = await Promise.all([
        SB._client.from('profiles').select('*').eq('id', userId).single(),
        SB._client.from('membership_levels').select('*').eq('level_key', 'user').single() // 先查默认
      ]);

      if (profileRes.error || !profileRes.data) return null;
      const profile = profileRes.data;

      // 查询对应等级的配置
      const { data: levelConfig } = await SB._client
        .from('membership_levels')
        .select('*')
        .eq('level_key', profile.role || 'user')
        .single();

      const result = {
        userId: profile.id,
        role: profile.role || 'user',
        roleName: levelConfig?.name || '普通',
        tokenQuota: profile.token_quota || levelConfig?.token_quota || 200000,
        dailyQuota: levelConfig?.daily_quota || 10000,
        storageQuotaMb: profile.storage_quota_mb || levelConfig?.storage_quota_mb || 0,
        tokenUsed: profile.token_used || 0,
        tokenUsedTotal: profile.token_used_total || 0,
        dailyUsed: profile.daily_used || 0,
        balance: profile.balance || 0,
        features: levelConfig?.features || {},
        isAgent: profile.is_agent || false,
        isAdmin: profile.role === 'admin',
        status: profile.status || 'active'
      };
      setCache(result);
      return result;
    } catch (e) {
      console.error('[Membership] fetchLevel error:', e);
      return null;
    }
  }

  /* ---------- 获取等级信息（优先缓存） ---------- */
  async function getLevel(userId) {
    const cached = getCache();
    if (cached && cached.userId === userId) return cached;
    return await fetchLevel(userId);
  }

  /* ---------- 获取配额信息 ---------- */
  async function getQuota(userId) {
    const level = await getLevel(userId);
    if (!level) return null;
    return {
      monthlyTotal: level.tokenQuota,
      monthlyUsed: level.tokenUsed,
      monthlyRemaining: level.tokenQuota >= 0 ? Math.max(0, level.tokenQuota - level.tokenUsed) : -1,
      dailyTotal: level.dailyQuota,
      dailyUsed: level.dailyUsed,
      dailyRemaining: level.dailyQuota >= 0 ? Math.max(0, level.dailyQuota - level.dailyUsed) : -1,
      storageTotal: level.storageQuotaMb,
      balance: level.balance
    };
  }

  /* ---------- 检查配额是否充足 ---------- */
  async function checkQuota(userId, neededTokens) {
    const level = await getLevel(userId);
    if (!level) return { ok: true, reason: '未登录/离线模式，跳过配额检查' };

    // 管理员无限制
    if (level.isAdmin) return { ok: true, remaining: -1, reason: '管理员无限制' };

    // 账号状态检查
    if (level.status === 'banned') return { ok: false, remaining: 0, reason: '账号已被封禁' };
    if (level.status === 'suspended') return { ok: false, remaining: 0, reason: '账号已被暂停' };

    const needed = neededTokens || 0;

    // 检查每日配额
    if (level.dailyQuota >= 0 && level.dailyUsed + needed > level.dailyQuota) {
      const remaining = Math.max(0, level.dailyQuota - level.dailyUsed);
      return { ok: false, remaining, reason: `今日配额不足，剩余 ${remaining.toLocaleString()} tokens` };
    }

    // 检查每月配额
    if (level.tokenQuota >= 0 && level.tokenUsed + needed > level.tokenQuota) {
      const remaining = Math.max(0, level.tokenQuota - level.tokenUsed);
      return { ok: false, remaining, reason: `本月配额不足，剩余 ${remaining.toLocaleString()} tokens` };
    }

    const remaining = level.tokenQuota >= 0 ? level.tokenQuota - level.tokenUsed : -1;
    return { ok: true, remaining, reason: '配额充足' };
  }

  /* ---------- 检查功能权限 ---------- */
  async function canUseFeature(userId, feature) {
    const level = await getLevel(userId);
    if (!level) return true; // 离线模式默认允许
    if (level.isAdmin) return true;
    if (level.status !== 'active') return false;
    const feats = level.features || {};
    if (feats.all === true) return true;
    return feats[feature] === true || feats[feature] === 'optional';
  }

  /* ---------- 清除缓存（角色变更后调用） ---------- */
  function clearCache() {
    localStorage.removeItem(LEVEL_CACHE_KEY);
  }

  /* ---------- 获取角色显示名称 ---------- */
  function roleName(role) {
    const map = { guest: '游客', user: '普通', advanced: '进阶', vip: 'VIP', agent: '代理', admin: '管理员' };
    return map[role] || role;
  }

  return { getLevel, getQuota, checkQuota, canUseFeature, clearCache, roleName };
})();

/* ============================================================
   QUOTA_CHECK · 对话前配额检查 & 对话后用量上报
   ============================================================ */
const QuotaCheck = (() => {
  /* ---------- 发送前检查 ---------- */
  async function beforeChat(modelId, messages) {
    // 估算所需 token
    let estimated = 0;
    if (messages) {
      messages.forEach(m => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        estimated += TokenStats.estimate(text);
      });
    }
    // 预留输出空间（保守估计 2K）
    estimated += 2000;

    const cloudUser = (typeof Store !== 'undefined' && Store.state.cloudUser) || null;
    if (!cloudUser) return { ok: true }; // 本地/游客模式不检查

    const result = await Membership.checkQuota(cloudUser.id, estimated);
    if (!result.ok) {
      // 显示配额不足提示
      if (typeof Toast !== 'undefined') {
        Toast.error('配额不足：' + result.reason);
      }
      return { ok: false, reason: result.reason };
    }
    return { ok: true, estimated };
  }

  /* ---------- 发送后记录用量 ---------- */
  async function afterChat(modelId, usage) {
    if (!usage || !usage.total) return;

    const cloudUser = (typeof Store !== 'undefined' && Store.state.cloudUser) || null;
    if (!cloudUser) return; // 本地模式不上报

    // 1. 本地记账（已有 TokenStats.record）
    TokenStats.record(modelId, usage);

    // 2. 上报到云端 token_usage 表
    try {
      if (typeof SB !== 'undefined' && SB.ready()) {
        const today = new Date().toISOString().split('T')[0];
        // 先尝试更新今天的记录
        const { data: existing } = await SB._client
          .from('token_usage')
          .select('id, input_tokens, output_tokens, total_tokens')
          .eq('user_id', cloudUser.id)
          .eq('date', today)
          .single();

        if (existing) {
          await SB._client.from('token_usage').update({
            input_tokens: existing.input_tokens + (usage.prompt || 0),
            output_tokens: existing.output_tokens + (usage.completion || 0),
            total_tokens: existing.total_tokens + usage.total,
            by_model: { [modelId]: (existing.by_model?.[modelId] || 0) + usage.total }
          }).eq('id', existing.id);
        } else {
          await SB._client.from('token_usage').insert({
            user_id: cloudUser.id,
            date: today,
            input_tokens: usage.prompt || 0,
            output_tokens: usage.completion || 0,
            total_tokens: usage.total,
            by_model: { [modelId]: usage.total }
          });
        }

        // 3. 刷新本地缓存
        Membership.clearCache();
      }
    } catch (e) {
      console.error('[QuotaCheck] afterChat error:', e);
      // 上报失败不影响本地使用
    }
  }

  /* ---------- 获取剩余配额（用于 UI 展示） ---------- */
  async function getRemaining() {
    const cloudUser = (typeof Store !== 'undefined' && Store.state.cloudUser) || null;
    if (!cloudUser) {
      // 本地模式：基于本地 tokenStats 估算
      const g = TokenStats.grand();
      return { mode: 'local', monthlyUsed: g.total, dailyUsed: g.total };
    }
    const quota = await Membership.getQuota(cloudUser.id);
    return { mode: 'cloud', ...quota };
  }

  return { beforeChat, afterChat, getRemaining };
})();
