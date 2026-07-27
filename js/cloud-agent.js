/* ============================================================
   CLOUD-AGENT · 云端代理模式前端对接
   功能：
     1. 一键上传 API Key 到云端（双加密：用户密码派生 + Worker Secret）
     2. 本地模式 ↔ 云端代理模式 切换
     3. 云端代理模式下：问题发到 Worker，Worker 代发厂商
     4. 云端历史同步：关闭浏览器后回来继续看对话
   ============================================================ */

const CloudAgent = (() => {
  const WORKER_URL = 'https://ai-gateway.your-subdomain.workers.dev'; // ← 部署后替换
  const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  let isCloudMode = false;
  let syncTimer = null;

  /* ---------- 初始化 ---------- */
  function init() {
    // 从 Store 读取模式状态
    const s = Store.state;
    isCloudMode = s.cloudMode === true;
    if (isCloudMode && !Store.state.cloudUser) {
      // 如果云端模式但已登出，自动切回本地
      isCloudMode = false;
      s.cloudMode = false;
      Store.save();
    }
  }

  /* ---------- 模式切换 ---------- */
  function toggleMode() {
    const s = Store.state;
    if (!s.cloudUser) {
      Toast.warning('请先登录云端账号');
      return;
    }

    // 检查用户等级
    const level = s.cloudUser?.role || 'user';
    if (!canUseCloudProxy(level)) {
      Toast.warning('云端代理模式需要进阶会员及以上');
      return;
    }

    isCloudMode = !isCloudMode;
    s.cloudMode = isCloudMode;
    Store.save();

    // 更新 UI
    updateModeUI();

    if (isCloudMode) {
      Toast.success('已切换到云端代理模式');
      // 同步本地历史到云端
      syncHistoryToCloud();
    } else {
      Toast.info('已切换到本地模式');
    }
  }

  function canUseCloudProxy(role) {
    return ['advanced', 'vip', 'agent', 'admin'].includes(role);
  }

  function updateModeUI() {
    const btn = document.getElementById('cloudModeToggle');
    if (btn) {
      btn.textContent = isCloudMode ? '☁️ 云端代理中' : '📱 本地模式';
      btn.classList.toggle('active', isCloudMode);
    }
  }

  /* ---------- 一键上传 API Key 到云端 ---------- */
  async function uploadKeyToCloud(provider, apiKey) {
    const s = Store.state;
    if (!s.cloudUser) {
      Toast.warning('请先登录');
      return { ok: false };
    }

    // 检查等级
    if (!canUseCloudProxy(s.cloudUser.role)) {
      Toast.warning('需要进阶会员才能上传 Key 到云端');
      return { ok: false };
    }

    // 1. 用登录密码派生密钥加密（用户自己下载时能解密）
    const password = prompt('请输入登录密码以加密 API Key：');
    if (!password) return { ok: false };

    try {
      const userEnc = await encryptWithPassword(apiKey, password);

      // 2. 上传到 Worker（Worker 会再用 WORKER_SECRET 加密一份）
      const resp = await fetch(`${WORKER_URL}/api/upload-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: s.cloudUser.id,
          provider,
          encrypted_key: userEnc.encrypted,
          iv: userEnc.iv,
          salt: userEnc.salt,
        }),
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      // 3. 本地标记已上传
      if (!s.cloudApiKeys) s.cloudApiKeys = {};
      s.cloudApiKeys[provider] = true;
      Store.save();

      Toast.success(`${provider} API Key 已安全上传到云端`);
      return { ok: true };
    } catch (e) {
      Toast.error('上传失败: ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  /* ---------- 云端代理对话 ---------- */
  async function chatViaCloud(model, messages, options = {}) {
    const s = Store.state;
    if (!isCloudMode || !s.cloudUser) {
      throw new Error('未开启云端代理模式');
    }

    // 获取或创建云端对话
    let convId = options.conversationId;
    if (!convId) {
      convId = await createCloudConversation('新对话');
    }

    const body = {
      model,
      messages: messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: options.stream !== false,
      user_id: s.cloudUser.id,
      conversation_id: convId,
    };

    const resp = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || '云端请求失败');
    }

    return {
      body: resp.body,
      conversationId: convId,
    };
  }

  /* ---------- 创建云端对话 ---------- */
  async function createCloudConversation(title) {
    const s = Store.state;
    const resp = await fetch(`${WORKER_URL}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: s.cloudUser.id,
        title: title || '新对话',
      }),
    });
    const result = await resp.json();
    return result.conversation_id;
  }

  /* ---------- 获取云端历史 ---------- */
  async function fetchCloudHistory() {
    const s = Store.state;
    if (!s.cloudUser) return [];

    const resp = await fetch(`${WORKER_URL}/api/history?user_id=${s.cloudUser.id}`);
    const result = await resp.json();
    return result.conversations || [];
  }

  async function fetchCloudMessages(conversationId) {
    const s = Store.state;
    if (!s.cloudUser) return [];

    const resp = await fetch(`${WORKER_URL}/api/history?user_id=${s.cloudUser.id}&conversation_id=${conversationId}`);
    const result = await resp.json();
    return result.messages || [];
  }

  /* ---------- 同步本地历史到云端 ---------- */
  async function syncHistoryToCloud() {
    const s = Store.state;
    if (!isCloudMode || !s.cloudUser) return;

    const localConvs = s.conversations || [];
    for (const conv of localConvs) {
      if (conv.syncedToCloud) continue;

      const messages = (conv.messages || []).map(m => ({
        role: m.role,
        content: m.content,
        model: m.model,
        created_at: new Date(m.timestamp).toISOString(),
      }));

      await fetch(`${WORKER_URL}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: s.cloudUser.id,
          title: conv.title,
          messages,
        }),
      });

      conv.syncedToCloud = true;
    }
    Store.save();
    Toast.success('本地历史已同步到云端');
  }

  /* ---------- 加密工具（前端版，PBKDF2 + AES-GCM） ---------- */
  async function encryptWithPassword(plain, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );

    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
    return {
      encrypted: btoa(String.fromCharCode(...new Uint8Array(ct))),
      iv: btoa(String.fromCharCode(...iv)),
      salt: btoa(String.fromCharCode(...salt)),
    };
  }

  async function decryptWithPassword(encrypted, iv, salt, password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );

    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0)) },
      key,
      Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
    );
    return new TextDecoder().decode(pt);
  }

  /* ---------- 判断当前是否云端模式 ---------- */
  function isActive() {
    return isCloudMode;
  }

  return {
    init,
    toggleMode,
    uploadKeyToCloud,
    chatViaCloud,
    fetchCloudHistory,
    fetchCloudMessages,
    syncHistoryToCloud,
    isActive,
    canUseCloudProxy,
  };
})();

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => CloudAgent.init());
