/* ============================================================
   AI 管理后台 · 完整版
   功能：仪表盘 / 用户管理 / 代理管理 / 订单管理 / 系统设置
   技术：纯前端 Vanilla JS + Supabase JS SDK v2 + Chart.js
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const Admin = {
  currentUser: null,
  currentPage: 'dashboard',
  supabase: null,
  charts: {},
  cache: {},
  pageSize: 20,

  init() {
    this.supabase = window.supabaseClient;
    this.bindEvents();
    this.checkSession();
  },

  /* ---------- 事件绑定 ---------- */
  bindEvents() {
    // 移动端菜单
    $('#menuBtn')?.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
    $('#sidebarOverlay')?.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
    });
    document.querySelectorAll('.sidebar nav a').forEach(a => {
      a.addEventListener('click', () => {
        document.body.classList.remove('sidebar-open');
      });
    });

    // 登录
    $('#loginBtn').addEventListener('click', () => this.login());
    $('#loginPassword').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 密码可见性切换（眼睛图标）
    const pwdInput = $('#loginPassword');
    $('#pwdToggle').addEventListener('click', () => {
      const show = pwdInput.type === 'password';
      pwdInput.type = show ? 'text' : 'password';
      $('#pwdEyeOpen').style.display = show ? 'none' : '';
      $('#pwdEyeClosed').style.display = show ? '' : 'none';
    });

    // 账号/密码禁止空格与不可见字符（零宽空格、BOM 等）
    const stripInvisible = (v) => v.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
    ['#loginEmail', '#loginPassword'].forEach((sel) => {
      const el = $(sel);
      el.addEventListener('input', () => {
        const cleaned = stripInvisible(el.value);
        if (el.value !== cleaned) el.value = cleaned;
      });
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text');
        const cleaned = stripInvisible(t);
        document.execCommand('insertText', false, cleaned);
      });
    });

    // 登出
    $('#logoutBtn').addEventListener('click', () => this.logout());

    // 侧边栏导航
    $$('.sidebar nav a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(link.dataset.page);
      });
    });

    // 仪表盘总用户数卡片：点击进入用户管理
    $('#statUsersCard')?.addEventListener('click', () => this.navigate('users'));

    // 用户管理搜索
    $('#userSearch').addEventListener('input', this.debounce(() => this.loadUsers(1), 300));
    $('#userFilter').addEventListener('change', () => this.loadUsers(1));

    // 订单筛选
    $('#orderFilter').addEventListener('change', () => this.loadOrders(1));
    $('#orderSearch').addEventListener('input', this.debounce(() => this.loadOrders(1), 300));

    // 代理搜索
    $('#agentSearch').addEventListener('input', this.debounce(() => this.loadAgents(1), 300));

    // 设置保存
    $('#saveSettings').addEventListener('click', () => this.saveSettings());

    // 弹窗关闭
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('#modalOverlay')) this.closeModal();
    });
    $('#modalClose').addEventListener('click', () => this.closeModal());

    // 邀请码
    $('#createInviteBtn').addEventListener('click', () => this.createInviteCode());
  },

  /* ---------- 会话管理 ---------- */
  async checkSession() {
    if (!this.supabase) {
      this.showLogin();
      $('#loginError').textContent = window.supabaseInitError || '登录组件加载失败，请刷新页面重试';
      return;
    }
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await this.supabase
          .from('profiles')
          .select('role, nickname, email')
          .eq('id', session.user.id)
          .single();
        if (profile?.role === 'admin') {
          this.currentUser = { ...session.user, ...profile };
          this.showAdmin();
          return;
        }
        await this.supabase.auth.signOut();
      }
    } catch (e) { console.error('checkSession', e); }
    this.showLogin();
  },

  async login() {
    let email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    // 支持纯账号（不带 @）：自动补平台默认域名
    if (email && !email.includes('@')) email = email + '@omnihub.app';
    const errorEl = $('#loginError');
    const btn = $('#loginBtn');

    if (!this.supabase) {
      errorEl.textContent = window.supabaseInitError || '登录组件加载失败，请刷新页面重试';
      return;
    }

    if (!email || !password) {
      errorEl.textContent = '请输入邮箱和密码';
      return;
    }

    btn.textContent = '登录中...';
    btn.disabled = true;
    errorEl.textContent = '';

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile } = await this.supabase
        .from('profiles')
        .select('role, nickname, email')
        .eq('id', data.user.id)
        .single();

      if (profile?.role !== 'admin') {
        errorEl.textContent = '权限不足：该账号不是管理员';
        await this.supabase.auth.signOut();
        btn.textContent = '登录';
        btn.disabled = false;
        return;
      }

      this.currentUser = { ...data.user, ...profile };
      this.showAdmin();
    } catch (err) {
      errorEl.textContent = this.translateError(err);
    } finally {
      btn.textContent = '登录';
      btn.disabled = false;
    }
  },

  async logout() {
    if (this.supabase) await this.supabase.auth.signOut();
    this.currentUser = null;
    this.showLogin();
  },

  showLogin() {
    $('#loginPage').classList.add('active');
    $('#adminPage').classList.remove('active');
    $('#loginEmail').value = '';
    $('#loginPassword').value = '';
    $('#loginError').textContent = '';
  },

  showAdmin() {
    $('#loginPage').classList.remove('active');
    $('#adminPage').classList.add('active');
    $('#adminEmail').textContent = this.currentUser?.email || 'Admin';
    this.navigate('dashboard');
  },

  /* ---------- 页面导航 ---------- */
  navigate(page) {
    this.currentPage = page;
    $$('.sidebar nav a').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });
    $$('.content').forEach(section => {
      section.classList.toggle('active', section.id === page);
    });

    if (page === 'dashboard') this.loadDashboard();
    if (page === 'users') this.loadUsers(1);
    if (page === 'agents') this.loadAgents(1);
    if (page === 'orders') this.loadOrders(1);
    if (page === 'settings') this.loadSettings();
  },

  /* ============================================================
     仪表盘
     ============================================================ */
  async loadDashboard() {
    this.setLoading('dashboard', true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

      // 并行查询
      const [
        { count: totalUsers },
        { count: todayUsers },
        { count: totalAgents },
        { count: todayOrders },
        { data: todayRevenue },
        { data: weekRevenue },
        { data: monthRevenue },
        { data: weekUsers },
        { data: roleDist }
      ] = await Promise.all([
        this.supabase.from('profiles').select('*', { count: 'exact', head: true }),
        this.supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', today),
        this.supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'agent'),
        this.supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', today),
        this.supabase.from('orders').select('actual_pay').eq('status', 'paid').gte('created_at', today),
        this.supabase.from('orders').select('actual_pay').eq('status', 'paid').gte('created_at', weekAgo),
        this.supabase.from('orders').select('actual_pay').eq('status', 'paid').gte('created_at', monthAgo),
        this.supabase.from('profiles').select('created_at').gte('created_at', weekAgo).order('created_at', { ascending: true }),
        this.supabase.from('profiles').select('role')
      ]);

      // 统计卡片
      $('#statUsers').textContent = totalUsers || 0;
      $('#statTodayUsers').textContent = (todayUsers || 0) + ' 今日新增';
      $('#statAgents').textContent = totalAgents || 0;
      $('#statOrders').textContent = todayOrders || 0;
      $('#statRevenue').textContent = '¥' + (todayRevenue?.reduce((s, o) => s + (o.actual_pay || 0), 0) || 0).toFixed(2);
      $('#statWeekRevenue').textContent = '本周 ¥' + (weekRevenue?.reduce((s, o) => s + (o.actual_pay || 0), 0) || 0).toFixed(2);
      $('#statMonthRevenue').textContent = '本月 ¥' + (monthRevenue?.reduce((s, o) => s + (o.actual_pay || 0), 0) || 0).toFixed(2);

      // 近7天用户注册趋势
      const userTrend = this.aggregateByDate(weekUsers || [], 'created_at', 'count');
      this.renderLineChart('userTrendChart', '近7天新增用户', userTrend.labels, userTrend.data, '#6366f1');

      // 近7天收入趋势
      const { data: weekOrderData } = await this.supabase
        .from('orders')
        .select('created_at, actual_pay')
        .eq('status', 'paid')
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: true });
      const revenueTrend = this.aggregateByDate(weekOrderData || [], 'created_at', 'sum', 'actual_pay');
      this.renderLineChart('revenueTrendChart', '近7天收入 (¥)', revenueTrend.labels, revenueTrend.data, '#22c55e');

      // 会员等级分布
      const roleCounts = {};
      (roleDist || []).forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });
      this.renderPieChart('roleDistChart', '会员等级分布',
        Object.keys(roleCounts),
        Object.values(roleCounts),
        ['#94a3b8', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e']
      );

      // Token 用量 Top 5
      const { data: topTokenUsers } = await this.supabase
        .from('profiles')
        .select('nickname, email, token_used_total')
        .order('token_used_total', { ascending: false })
        .limit(5);
      this.renderBarChart('tokenTopChart', 'Token 用量 Top 5',
        (topTokenUsers || []).map(u => u.nickname || u.email?.split('@')[0] || '未知'),
        (topTokenUsers || []).map(u => u.token_used_total || 0),
        '#f59e0b'
      );

    } catch (err) {
      console.error('loadDashboard', err);
      this.toast('加载仪表盘失败: ' + err.message, 'error');
    }
    this.setLoading('dashboard', false);
  },

  /* ============================================================
     用户管理
     ============================================================ */
  async loadUsers(page = 1) {
    this.setLoading('users', true);
    try {
      const search = $('#userSearch').value.trim();
      const filter = $('#userFilter').value;
      const from = (page - 1) * this.pageSize;
      const to = from + this.pageSize - 1;

      let query = this.supabase.from('profiles').select('*', { count: 'exact' });

      if (search) {
        query = query.or(`email.ilike.%${search}%,nickname.ilike.%${search}%`);
      }
      if (filter) {
        query = query.eq('role', filter);
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const tbody = $('#usersTable');
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无数据</td></tr>';
        this.renderPagination('usersPagination', page, 0);
        return;
      }

      tbody.innerHTML = data.map(u => {
        const tokenPercent = u.token_quota > 0 ? Math.min(100, Math.round((u.token_used || 0) / u.token_quota * 100)) : 0;
        const statusClass = u.status === 'active' ? 'status-active' : (u.status === 'suspended' ? 'status-suspended' : 'status-banned');
        return `
          <tr>
            <td>
              <div class="user-cell">
                <div class="avatar">${(u.nickname || u.email || 'U').charAt(0).toUpperCase()}</div>
                <div>
                  <div class="user-name">${u.nickname || '未命名'}</div>
                  <div class="user-email">${u.email || ''}</div>
                </div>
              </div>
            </td>
            <td>
              <select class="role-select" onchange="Admin.quickSetRole('${u.id}', this.value)">
                ${this.roleOptions(u.role)}
              </select>
            </td>
            <td><span class="storage-quota">${this.storageQuotaText(u.role)}</span></td>
            <td>
              <div class="token-bar">
                <div class="token-bar-inner" style="width:${tokenPercent}%"></div>
                <span>${this.fmtNum(u.token_used || 0)} / ${u.token_quota > 0 ? this.fmtNum(u.token_quota) : '∞'}</span>
              </div>
            </td>
            <td>¥${(u.balance || 0).toFixed(2)}</td>
            <td><span class="status-dot ${statusClass}">${this.statusName(u.status)}</span></td>
            <td>${this.fmtDate(u.created_at)}</td>
            <td>
              <button class="btn-sm btn-primary" onclick="Admin.editUser('${u.id}')">编辑</button>
              <button class="btn-sm" onclick="Admin.viewUserDetail('${u.id}')">详情</button>
            </td>
          </tr>
        `;
      }).join('');

      this.renderPagination('usersPagination', page, count || 0);
    } catch (err) {
      console.error('loadUsers', err);
      this.toast('加载用户失败: ' + err.message, 'error');
    }
    this.setLoading('users', false);
  },

  async quickSetRole(userId, role) {
    try {
      if (userId === this.currentUser?.id && role !== 'admin') {
        this.toast('不能移除当前登录账号的管理员权限', 'warning');
        this.loadUsers(1);
        return;
      }
      const { error } = await this.supabase
        .from('profiles')
        .update({
          role,
          storage_quota: this.roleQuotaMb(role) * 1024 * 1024,
          storage_quota_mb: this.roleQuotaMb(role),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) throw error;
      await this.logAudit('update_user_role', 'user', userId, null, { role });
      this.toast(`等级已调整为：${this.roleName(role)}`, 'success');
      this.loadUsers(1);
    } catch (err) {
      this.toast('调整等级失败: ' + err.message, 'error');
      this.loadUsers(1);
    }
  },

  async editUser(userId) {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw error;

      const roles = [
        { key: 'guest', name: '游客' },
        { key: 'user', name: '普通' },
        { key: 'advanced', name: '进阶' },
        { key: 'vip', name: 'VIP' },
        { key: 'agent', name: '代理' },
        { key: 'admin', name: '管理员' }
      ];

      const roleOptions = roles.map(r =>
        `<option value="${r.key}" ${data.role === r.key ? 'selected' : ''}>${r.name}</option>`
      ).join('');

      const statuses = [
        { key: 'active', name: '正常' },
        { key: 'suspended', name: '暂停' },
        { key: 'banned', name: '封禁' }
      ];
      const statusOptions = statuses.map(s =>
        `<option value="${s.key}" ${data.status === s.key ? 'selected' : ''}>${s.name}</option>`
      ).join('');

      this.showModal(`
        <h3>编辑用户</h3>
        <div class="form-group">
          <label>邮箱</label>
          <input type="text" value="${data.email || ''}" disabled />
        </div>
        <div class="form-group">
          <label>昵称</label>
          <input type="text" id="editNickname" value="${data.nickname || ''}" />
        </div>
        <div class="form-group">
          <label>角色</label>
          <select id="editRole">${roleOptions}</select>
        </div>
        <div class="form-group">
          <label>月 Token 配额</label>
          <input type="number" id="editTokenQuota" value="${data.token_quota || 0}" />
        </div>
        <div class="form-group">
          <label>日 Token 配额</label>
          <input type="number" id="editDailyQuota" value="${data.daily_quota || 0}" />
        </div>
        <div class="form-group">
          <label>存储配额 (MB)</label>
          <input type="number" id="editStorageQuota" value="${data.storage_quota_mb || 0}" />
        </div>
        <div class="form-group">
          <label>余额 (¥)</label>
          <input type="number" id="editBalance" value="${data.balance || 0}" step="0.01" />
        </div>
        <div class="form-group">
          <label>状态</label>
          <select id="editStatus">${statusOptions}</select>
        </div>
        <div class="form-group">
          <label>状态原因</label>
          <input type="text" id="editStatusReason" value="${data.status_reason || ''}" placeholder="封禁/暂停原因" />
        </div>
        <div class="modal-actions">
          <button class="btn-primary" onclick="Admin.saveUser('${userId}')">保存</button>
          <button onclick="Admin.closeModal()">取消</button>
        </div>
      `);
    } catch (err) {
      this.toast('加载用户信息失败: ' + err.message, 'error');
    }
  },

  async saveUser(userId) {
    try {
      const updates = {
        nickname: $('#editNickname').value.trim(),
        role: $('#editRole').value,
        token_quota: parseInt($('#editTokenQuota').value) || 0,
        daily_quota: parseInt($('#editDailyQuota').value) || 0,
        storage_quota_mb: parseInt($('#editStorageQuota').value) || 0,
        balance: parseFloat($('#editBalance').value) || 0,
        status: $('#editStatus').value,
        status_reason: $('#editStatusReason').value.trim()
      };

      const { error } = await this.supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;

      // 写审计日志
      await this.logAudit('update_user', 'user', userId, null, updates);

      this.closeModal();
      this.toast('用户更新成功', 'success');
      this.loadUsers(1);
    } catch (err) {
      this.toast('保存失败: ' + err.message, 'error');
    }
  },

  async viewUserDetail(userId) {
    try {
      const [{ data: user }, { data: tokenUsage }, { data: orders }] = await Promise.all([
        this.supabase.from('profiles').select('*').eq('id', userId).single(),
        this.supabase.from('token_usage').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(30),
        this.supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10)
      ]);

      const tokenTotal = tokenUsage?.reduce((s, t) => s + (t.total_tokens || 0), 0) || 0;
      const orderTotal = orders?.reduce((s, o) => s + (o.actual_pay || 0), 0) || 0;

      this.showModal(`
        <h3>用户详情</h3>
        <div class="detail-grid">
          <div class="detail-item"><label>ID</label><span>${user.id}</span></div>
          <div class="detail-item"><label>邮箱</label><span>${user.email || '-'}</span></div>
          <div class="detail-item"><label>昵称</label><span>${user.nickname || '-'}</span></div>
          <div class="detail-item"><label>角色</label><span class="badge badge-${user.role}">${this.roleName(user.role)}</span></div>
          <div class="detail-item"><label>状态</label><span>${this.statusName(user.status)}</span></div>
          <div class="detail-item"><label>注册时间</label><span>${this.fmtDate(user.created_at)}</span></div>
          <div class="detail-item"><label>月 Token 已用/配额</label><span>${this.fmtNum(user.token_used || 0)} / ${user.token_quota > 0 ? this.fmtNum(user.token_quota) : '∞'}</span></div>
          <div class="detail-item"><label>日 Token 已用</label><span>${this.fmtNum(user.daily_used || 0)}</span></div>
          <div class="detail-item"><label>累计 Token</label><span>${this.fmtNum(user.token_used_total || 0)}</span></div>
          <div class="detail-item"><label>余额</label><span>¥${(user.balance || 0).toFixed(2)}</span></div>
          <div class="detail-item"><label>存储已用/配额</label><span>${user.storage_used_mb || 0} / ${user.storage_quota_mb > 0 ? user.storage_quota_mb : '∞'} MB</span></div>
          <div class="detail-item"><label>代理邀请码</label><span>${user.agent_code || '-'}</span></div>
          <div class="detail-item"><label>上级代理</label><span>${user.parent_agent_id || '-'}</span></div>
          <div class="detail-item"><label>累计分润</label><span>¥${(user.total_commission || 0).toFixed(2)}</span></div>
          <div class="detail-item"><label>待结算分润</label><span>¥${(user.pending_commission || 0).toFixed(2)}</span></div>
        </div>
        <h4 style="margin-top:20px">近30天 Token 用量</h4>
        <table class="data-table" style="margin-top:10px">
          <thead><tr><th>日期</th><th>输入</th><th>输出</th><th>总计</th><th>费用</th></tr></thead>
          <tbody>
            ${(tokenUsage || []).length === 0 ? '<tr><td colspan="5" class="empty">暂无数据</td></tr>' :
              tokenUsage.map(t => `<tr>
                <td>${t.date}</td>
                <td>${this.fmtNum(t.input_tokens || 0)}</td>
                <td>${this.fmtNum(t.output_tokens || 0)}</td>
                <td>${this.fmtNum(t.total_tokens || 0)}</td>
                <td>¥${(t.cost || 0).toFixed(4)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <h4 style="margin-top:20px">最近订单</h4>
        <table class="data-table" style="margin-top:10px">
          <thead><tr><th>订单号</th><th>类型</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>
            ${(orders || []).length === 0 ? '<tr><td colspan="5" class="empty">暂无数据</td></tr>' :
              orders.map(o => `<tr>
                <td>${o.order_no || o.id?.slice(0, 8)}</td>
                <td>${this.orderTypeName(o.type)}</td>
                <td>¥${(o.actual_pay || 0).toFixed(2)}</td>
                <td><span class="badge badge-${o.status === 'paid' ? 'success' : (o.status === 'pending' ? 'warning' : 'danger')}">${this.orderStatusName(o.status)}</span></td>
                <td>${this.fmtDate(o.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="modal-actions">
          <button onclick="Admin.closeModal()">关闭</button>
        </div>
      `);
    } catch (err) {
      this.toast('加载详情失败: ' + err.message, 'error');
    }
  },

  /* ============================================================
     代理管理
     ============================================================ */
  async loadAgents(page = 1) {
    this.setLoading('agents', true);
    try {
      const search = $('#agentSearch').value.trim();
      const from = (page - 1) * this.pageSize;
      const to = from + this.pageSize - 1;

      let query = this.supabase.from('profiles').select('*', { count: 'exact' })
        .eq('is_agent', true)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(`email.ilike.%${search}%,nickname.ilike.%${search}%,agent_code.ilike.%${search}%`);
      }

      const { data, count, error } = await query.range(from, to);
      if (error) throw error;

      // 获取下级数量
      const agentIds = (data || []).map(a => a.id);
      let subordinateCounts = {};
      if (agentIds.length > 0) {
        const { data: rels } = await this.supabase
          .from('agent_relations')
          .select('ancestor_id')
          .in('ancestor_id', agentIds)
          .eq('depth', 1);
        (rels || []).forEach(r => {
          subordinateCounts[r.ancestor_id] = (subordinateCounts[r.ancestor_id] || 0) + 1;
        });
      }

      const tbody = $('#agentsTable');
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无代理</td></tr>';
        this.renderPagination('agentsPagination', page, 0);
        return;
      }

      tbody.innerHTML = data.map(a => {
        const subCount = subordinateCounts[a.id] || 0;
        return `
          <tr>
            <td>
              <div class="user-cell">
                <div class="avatar">${(a.nickname || a.email || 'A').charAt(0).toUpperCase()}</div>
                <div>
                  <div class="user-name">${a.nickname || '未命名'}</div>
                  <div class="user-email">${a.email || ''}</div>
                </div>
              </div>
            </td>
            <td><code>${a.agent_code || '-'}</code></td>
            <td>${subCount}</td>
            <td>¥${(a.total_commission || 0).toFixed(2)}</td>
            <td>¥${(a.pending_commission || 0).toFixed(2)}</td>
            <td><span class="status-dot ${a.status === 'active' ? 'status-active' : 'status-suspended'}">${this.statusName(a.status)}</span></td>
            <td>
              <button class="btn-sm btn-primary" onclick="Admin.viewAgentSubordinates('${a.id}')">下级</button>
              <button class="btn-sm" onclick="Admin.viewAgentCommissions('${a.id}')">分润</button>
              ${a.pending_commission > 0 ? `<button class="btn-sm btn-success" onclick="Admin.settleCommission('${a.id}')">结算</button>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      this.renderPagination('agentsPagination', page, count || 0);
    } catch (err) {
      console.error('loadAgents', err);
      this.toast('加载代理失败: ' + err.message, 'error');
    }
    this.setLoading('agents', false);
  },

  async viewAgentSubordinates(agentId) {
    try {
      const { data: subs } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('parent_agent_id', agentId)
        .order('created_at', { ascending: false });

      this.showModal(`
        <h3>下级用户</h3>
        <table class="data-table" style="margin-top:10px">
          <thead>
            <tr><th>用户</th><th>角色</th><th>注册时间</th><th>累计消费</th></tr>
          </thead>
          <tbody>
            ${(subs || []).length === 0 ? '<tr><td colspan="4" class="empty">暂无下级</td></tr>' :
              subs.map(u => `<tr>
                <td>
                  <div class="user-cell">
                    <div class="avatar" style="width:28px;height:28px;font-size:12px">${(u.nickname || u.email || 'U').charAt(0).toUpperCase()}</div>
                    <div>
                      <div class="user-name" style="font-size:13px">${u.nickname || '未命名'}</div>
                      <div class="user-email" style="font-size:11px">${u.email || ''}</div>
                    </div>
                  </div>
                </td>
                <td><span class="badge badge-${u.role || 'user'}">${this.roleName(u.role)}</span></td>
                <td>${this.fmtDate(u.created_at)}</td>
                <td>-</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="modal-actions"><button onclick="Admin.closeModal()">关闭</button></div>
      `);
    } catch (err) {
      this.toast('加载失败: ' + err.message, 'error');
    }
  },

  async viewAgentCommissions(agentId) {
    try {
      const { data: commissions } = await this.supabase
        .from('agent_commissions')
        .select('*, from_user:from_user_id(nickname, email), order:order_id(order_no, actual_pay)')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(50);

      this.showModal(`
        <h3>分润记录</h3>
        <table class="data-table" style="margin-top:10px">
          <thead>
            <tr><th>来源用户</th><th>订单</th><th>金额</th><th>比例</th><th>分润</th><th>层级</th><th>状态</th><th>时间</th></tr>
          </thead>
          <tbody>
            ${(commissions || []).length === 0 ? '<tr><td colspan="8" class="empty">暂无分润记录</td></tr>' :
              commissions.map(c => `<tr>
                <td>${c.from_user?.nickname || c.from_user?.email || '-'}</td>
                <td>${c.order?.order_no?.slice(0, 12) || '-'}</td>
                <td>¥${(c.order_amount || 0).toFixed(2)}</td>
                <td>${c.rate}%</td>
                <td>¥${(c.amount || 0).toFixed(2)}</td>
                <td>${c.level}级</td>
                <td><span class="badge badge-${c.status === 'settled' ? 'success' : 'warning'}">${c.status === 'settled' ? '已结算' : '待结算'}</span></td>
                <td>${this.fmtDate(c.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="modal-actions"><button onclick="Admin.closeModal()">关闭</button></div>
      `);
    } catch (err) {
      this.toast('加载失败: ' + err.message, 'error');
    }
  },

  async settleCommission(agentId) {
    if (!confirm('确认结算该代理的所有待结算分润？')) return;
    try {
      const { data: agent } = await this.supabase
        .from('profiles')
        .select('pending_commission, nickname')
        .eq('id', agentId)
        .single();

      if (!agent || agent.pending_commission <= 0) {
        this.toast('没有待结算分润', 'warning');
        return;
      }

      // 更新分润记录状态
      const { error: e1 } = await this.supabase
        .from('agent_commissions')
        .update({ status: 'settled', settled_at: new Date().toISOString() })
        .eq('agent_id', agentId)
        .eq('status', 'pending');
      if (e1) throw e1;

      // 清零待结算，加到余额
      const { error: e2 } = await this.supabase
        .from('profiles')
        .update({
          pending_commission: 0,
          balance: agent.balance + agent.pending_commission
        })
        .eq('id', agentId);
      if (e2) throw e2;

      await this.logAudit('settle_commission', 'agent', agentId, { pending: agent.pending_commission }, { status: 'settled' });
      this.toast(`已结算 ¥${agent.pending_commission.toFixed(2)}`, 'success');
      this.loadAgents(1);
    } catch (err) {
      this.toast('结算失败: ' + err.message, 'error');
    }
  },

  /* ============================================================
     订单管理
     ============================================================ */
  async loadOrders(page = 1) {
    this.setLoading('orders', true);
    try {
      const filter = $('#orderFilter').value;
      const search = $('#orderSearch').value.trim();
      const from = (page - 1) * this.pageSize;
      const to = from + this.pageSize - 1;

      let query = this.supabase.from('orders').select('*, user:user_id(nickname, email)', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filter) query = query.eq('type', filter);
      if (search) query = query.or(`order_no.ilike.%${search}%,product_name.ilike.%${search}%`);

      const { data, count, error } = await query.range(from, to);
      if (error) throw error;

      const tbody = $('#ordersTable');
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无订单</td></tr>';
        this.renderPagination('ordersPagination', page, 0);
        return;
      }

      tbody.innerHTML = data.map(o => `
        <tr>
          <td><code>${o.order_no || o.id?.slice(0, 8)}</code></td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="width:28px;height:28px;font-size:12px">${(o.user?.nickname || o.user?.email || 'U').charAt(0).toUpperCase()}</div>
              <div>
                <div class="user-name" style="font-size:13px">${o.user?.nickname || '未命名'}</div>
                <div class="user-email" style="font-size:11px">${o.user?.email || ''}</div>
              </div>
            </div>
          </td>
          <td>${this.orderTypeName(o.type)}</td>
          <td>¥${(o.amount || 0).toFixed(2)}</td>
          <td>¥${(o.actual_pay || 0).toFixed(2)}</td>
          <td><span class="badge badge-${o.status === 'paid' ? 'success' : (o.status === 'pending' ? 'warning' : (o.status === 'refunded' ? 'danger' : 'secondary'))}">${this.orderStatusName(o.status)}</span></td>
          <td>${o.pay_time ? this.fmtDate(o.pay_time) : '-'}</td>
          <td>
            ${o.status === 'pending' ? `<button class="btn-sm btn-success" onclick="Admin.confirmOrder('${o.id}')">确认</button>` : ''}
            ${o.status === 'paid' ? `<button class="btn-sm btn-danger" onclick="Admin.refundOrder('${o.id}')">退款</button>` : ''}
            <button class="btn-sm" onclick="Admin.viewOrderDetail('${o.id}')">详情</button>
          </td>
        </tr>
      `).join('');

      this.renderPagination('ordersPagination', page, count || 0);
    } catch (err) {
      console.error('loadOrders', err);
      this.toast('加载订单失败: ' + err.message, 'error');
    }
    this.setLoading('orders', false);
  },

  async confirmOrder(orderId) {
    if (!confirm('确认该订单已支付？这将触发余额增加/等级升级/分润计算。')) return;
    try {
      const { error } = await this.supabase
        .from('orders')
        .update({ status: 'paid', pay_time: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw error;
      this.toast('订单已确认支付', 'success');
      this.loadOrders(1);
      this.loadDashboard();
    } catch (err) {
      this.toast('确认失败: ' + err.message, 'error');
    }
  },

  async refundOrder(orderId) {
    if (!confirm('确认退款？此操作不可逆。')) return;
    try {
      const { error } = await this.supabase
        .from('orders')
        .update({ status: 'refunded' })
        .eq('id', orderId);
      if (error) throw error;
      this.toast('订单已退款', 'success');
      this.loadOrders(1);
    } catch (err) {
      this.toast('退款失败: ' + err.message, 'error');
    }
  },

  async viewOrderDetail(orderId) {
    try {
      const { data: order } = await this.supabase
        .from('orders')
        .select('*, user:user_id(nickname, email)')
        .eq('id', orderId)
        .single();

      this.showModal(`
        <h3>订单详情</h3>
        <div class="detail-grid">
          <div class="detail-item"><label>订单号</label><span>${order.order_no || order.id}</span></div>
          <div class="detail-item"><label>用户</label><span>${order.user?.nickname || order.user?.email || '-'}</span></div>
          <div class="detail-item"><label>类型</label><span>${this.orderTypeName(order.type)}</span></div>
          <div class="detail-item"><label>商品</label><span>${order.product_name || '-'}</span></div>
          <div class="detail-item"><label>商品ID</label><span>${order.product_id || '-'}</span></div>
          <div class="detail-item"><label>订单金额</label><span>¥${(order.amount || 0).toFixed(2)}</span></div>
          <div class="detail-item"><label>优惠</label><span>¥${(order.discount || 0).toFixed(2)}</span></div>
          <div class="detail-item"><label>实付金额</label><span>¥${(order.actual_pay || 0).toFixed(2)}</span></div>
          <div class="detail-item"><label>支付方式</label><span>${order.pay_method || '-'}</span></div>
          <div class="detail-item"><label>支付时间</label><span>${order.pay_time ? this.fmtDate(order.pay_time) : '-'}</span></div>
          <div class="detail-item"><label>状态</label><span class="badge badge-${order.status === 'paid' ? 'success' : (order.status === 'pending' ? 'warning' : 'danger')}">${this.orderStatusName(order.status)}</span></div>
          <div class="detail-item"><label>创建时间</label><span>${this.fmtDate(order.created_at)}</span></div>
          <div class="detail-item"><label>备注</label><span>${order.remark || '-'}</span></div>
        </div>
        <div class="modal-actions"><button onclick="Admin.closeModal()">关闭</button></div>
      `);
    } catch (err) {
      this.toast('加载失败: ' + err.message, 'error');
    }
  },

  /* ============================================================
     系统设置
     ============================================================ */
  async loadSettings() {
    this.setLoading('settings', true);
    try {
      // 加载会员等级
      const { data: levels } = await this.supabase
        .from('membership_levels')
        .select('*')
        .order('sort_order', { ascending: true });

      const levelsBody = $('#membershipLevelsBody');
      if (levels && levels.length > 0) {
        levelsBody.innerHTML = levels.map(l => `
          <tr data-key="${l.level_key}">
            <td><span class="badge badge-${l.level_key}">${l.name}</span></td>
            <td><input type="number" class="level-input" data-field="token_quota" value="${l.token_quota}" /></td>
            <td><input type="number" class="level-input" data-field="daily_quota" value="${l.daily_quota}" /></td>
            <td><input type="number" class="level-input" data-field="storage_quota_mb" value="${l.storage_quota_mb}" /></td>
            <td><input type="number" class="level-input" data-field="price_month" value="${l.price_month}" step="0.01" /></td>
            <td><input type="number" class="level-input" data-field="price_year" value="${l.price_year}" step="0.01" /></td>
            <td><input type="checkbox" class="level-check" data-field="is_visible" ${l.is_visible ? 'checked' : ''} /></td>
          </tr>
        `).join('');
      }

      // 加载 configs
      const { data: configs } = await this.supabase.from('configs').select('*');
      const cfg = {};
      (configs || []).forEach(c => cfg[c.key] = c.value);

      // 代理分润
      const cr = cfg['commission_rate'] || { level1: 20, level2: 5, level3: 2 };
      $('#commissionLevel1').value = cr.level1 || 20;
      $('#commissionLevel2').value = cr.level2 || 5;
      $('#commissionLevel3').value = cr.level3 || 2;

      // 最低提现
      const mw = cfg['agent_min_withdraw'] || { amount: 100 };
      $('#minWithdraw').value = mw.amount || 100;

      // 注册奖励
      const rr = cfg['register_reward'] || { balance: 5, quota: 10000 };
      $('#registerRewardBalance').value = rr.balance || 5;
      $('#registerRewardQuota').value = rr.quota || 10000;

      // 站点名称
      const sn = cfg['site_name'] || { zh: '第三方科技', en: 'ThirdTech' };
      $('#siteNameZh').value = sn.zh || '第三方科技';
      $('#siteNameEn').value = sn.en || 'ThirdTech';

      // 维护模式
      const mm = cfg['maintenance_mode'] || { enabled: false, message: '系统维护中' };
      $('#maintenanceMode').checked = !!mm.enabled;
      $('#maintenanceMessage').value = mm.message || '系统维护中';

      // 加载邀请码
      this.loadInviteCodes();

    } catch (err) {
      console.error('loadSettings', err);
      this.toast('加载设置失败: ' + err.message, 'error');
    }
    this.setLoading('settings', false);
  },

  async saveSettings() {
    try {
      // 保存会员等级
      const levelRows = $$('#membershipLevelsBody tr');
      for (const row of levelRows) {
        const key = row.dataset.key;
        const inputs = row.querySelectorAll('.level-input');
        const updates = {};
        inputs.forEach(inp => {
          const field = inp.dataset.field;
          if (inp.type === 'checkbox') updates[field] = inp.checked;
          else if (field.includes('price')) updates[field] = parseFloat(inp.value) || 0;
          else updates[field] = parseInt(inp.value) || 0;
        });
        const check = row.querySelector('.level-check');
        if (check) updates.is_visible = check.checked;

        const { error } = await this.supabase
          .from('membership_levels')
          .update(updates)
          .eq('level_key', key);
        if (error) throw error;
      }

      // 保存 configs
      const configsToUpsert = [
        { key: 'commission_rate', value: { level1: parseInt($('#commissionLevel1').value) || 20, level2: parseInt($('#commissionLevel2').value) || 5, level3: parseInt($('#commissionLevel3').value) || 2 } },
        { key: 'agent_min_withdraw', value: { amount: parseInt($('#minWithdraw').value) || 100 } },
        { key: 'register_reward', value: { balance: parseInt($('#registerRewardBalance').value) || 5, quota: parseInt($('#registerRewardQuota').value) || 10000 } },
        { key: 'site_name', value: { zh: $('#siteNameZh').value.trim(), en: $('#siteNameEn').value.trim() } },
        { key: 'maintenance_mode', value: { enabled: $('#maintenanceMode').checked, message: $('#maintenanceMessage').value.trim() } }
      ];

      for (const cfg of configsToUpsert) {
        const { error } = await this.supabase.from('configs').upsert(cfg, { onConflict: 'key' });
        if (error) throw error;
      }

      await this.logAudit('update_settings', 'config', null, null, { action: '批量更新系统设置' });
      this.toast('设置保存成功', 'success');
    } catch (err) {
      this.toast('保存失败: ' + err.message, 'error');
    }
  },

  async loadInviteCodes() {
    try {
      const { data: codes } = await this.supabase
        .from('invite_codes')
        .select('*, creator:created_by(nickname, email)')
        .order('created_at', { ascending: false })
        .limit(50);

      const tbody = $('#inviteCodesTable');
      if (!codes || codes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无邀请码</td></tr>';
        return;
      }

      tbody.innerHTML = codes.map(c => `
        <tr>
          <td><code>${c.code}</code></td>
          <td>${c.creator?.nickname || c.creator?.email || '系统'}</td>
          <td>${c.max_uses}</td>
          <td>${c.used_count}</td>
          <td>${c.reward_type === 'balance' ? '余额 ¥' + c.reward_value : '配额 ' + c.reward_value}</td>
          <td><span class="badge badge-${c.status === 'active' ? 'success' : 'secondary'}">${c.status === 'active' ? '有效' : '失效'}</span></td>
          <td>${this.fmtDate(c.created_at)}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('loadInviteCodes', err);
    }
  },

  async createInviteCode() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const maxUses = parseInt($('#inviteMaxUses').value) || 10;
    const rewardType = $('#inviteRewardType').value;
    const rewardValue = parseFloat($('#inviteRewardValue').value) || 0;

    try {
      const { error } = await this.supabase.from('invite_codes').insert({
        code: 'INV-' + code,
        max_uses: maxUses,
        reward_type: rewardType,
        reward_value: rewardValue,
        created_by: this.currentUser?.id
      });
      if (error) throw error;
      this.toast('邀请码创建成功', 'success');
      this.loadInviteCodes();
    } catch (err) {
      this.toast('创建失败: ' + err.message, 'error');
    }
  },

  /* ============================================================
     审计日志
     ============================================================ */
  async logAudit(action, targetType, targetId, oldValue, newValue) {
    try {
      await this.supabase.from('audit_logs').insert({
        user_id: this.currentUser?.id,
        action,
        target_type: targetType,
        target_id: targetId,
        old_value: oldValue,
        new_value: newValue,
        ip_address: '',
        user_agent: navigator.userAgent
      });
    } catch (e) { /* 审计日志失败不阻塞主流程 */ }
  },

  /* ============================================================
     图表渲染
     ============================================================ */
  renderLineChart(canvasId, label, labels, data, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();
    this.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: color + '20',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
        }
      }
    });
  },

  renderPieChart(canvasId, label, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();
    this.charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#e2e8f0', font: { size: 11 } } }
        }
      }
    });
  },

  renderBarChart(canvasId, label, labels, data, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();
    this.charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color, borderRadius: 4 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
        }
      }
    });
  },

  /* ============================================================
     工具函数
     ============================================================ */
  aggregateByDate(rows, dateField, aggType, sumField) {
    const map = {};
    const labels = [];
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().split('T')[0];
      map[key] = 0;
      labels.push(key.slice(5));
    }
    rows.forEach(r => {
      const key = (r[dateField] || '').split('T')[0];
      if (map.hasOwnProperty(key)) {
        if (aggType === 'count') map[key]++;
        else if (aggType === 'sum') map[key] += (r[sumField] || 0);
      }
    });
    labels.forEach(k => data.push(map[k] || 0));
    return { labels, data };
  },

  renderPagination(containerId, currentPage, totalCount) {
    const container = $(`#${containerId}`);
    if (!container) return;
    const totalPages = Math.ceil(totalCount / this.pageSize);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    if (currentPage > 1) html += `<button onclick="Admin.load${this.capitalize(this.currentPage)}(${currentPage - 1})">上一页</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
        html += `<button class="${i === currentPage ? 'active' : ''}" onclick="Admin.load${this.capitalize(this.currentPage)}(${i})">${i}</button>`;
      } else if (Math.abs(i - currentPage) === 3) {
        html += `<span>...</span>`;
      }
    }
    if (currentPage < totalPages) html += `<button onclick="Admin.load${this.capitalize(this.currentPage)}(${currentPage + 1})">下一页</button>`;
    container.innerHTML = html;
  },

  capitalize(str) {
    const map = { users: 'Users', agents: 'Agents', orders: 'Orders' };
    return map[str] || str;
  },

  setLoading(page, loading) {
    const el = $(`#${page}Loading`);
    if (el) el.style.display = loading ? 'flex' : 'none';
  },

  showModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modalOverlay').classList.add('active');
  },

  closeModal() {
    $('#modalOverlay').classList.remove('active');
  },

  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  },

  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },

  fmtDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
    return (n / 1e6).toFixed(2) + 'M';
  },

  roleName(key) {
    const map = { guest: '游客', user: '普通', advanced: '进阶', vip: '会员', svip: '高级会员', agent: '代理', admin: '管理员' };
    return map[key] || key;
  },

  /// 会员等级 → 云同步存储配额（MB）
  roleQuotaMb(key) {
    const map = { guest: 5, user: 5, advanced: 500, vip: 1024, svip: 5120, agent: 5120, admin: 5120 };
    return map[key] ?? 5;
  },

  storageQuotaText(key) {
    const mb = this.roleQuotaMb(key || 'user');
    return mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`;
  },

  roleOptions(selected) {
    const roles = ['guest', 'user', 'advanced', 'vip', 'svip', 'agent', 'admin'];
    return roles.map(role =>
      `<option value="${role}" ${selected === role ? 'selected' : ''}>${this.roleName(role)}（${this.storageQuotaText(role)}）</option>`
    ).join('');
  },

  statusName(key) {
    const map = { active: '正常', suspended: '暂停', banned: '封禁' };
    return map[key] || key;
  },

  orderTypeName(key) {
    const map = { recharge: '充值', upgrade: '升级', package: '套餐' };
    return map[key] || key;
  },

  orderStatusName(key) {
    const map = { pending: '待支付', paid: '已支付', cancelled: '已取消', refunded: '已退款' };
    return map[key] || key;
  },

  translateError(err) {
    const msg = String(err?.message || err || '');
    if (/Cannot read properties of undefined.*auth/i.test(msg)) return '登录组件加载失败，请刷新页面重试';
    if (/Invalid login credentials/i.test(msg)) return '邮箱或密码错误';
    if (/Email not confirmed/i.test(msg)) return '邮箱未验证';
    if (/row level security|permission denied/i.test(msg)) return '权限不足';
    if (/NetworkError|Failed to fetch/i.test(msg)) return '网络异常';
    return msg || '操作失败';
  }
};

document.addEventListener('DOMContentLoaded', () => Admin.init());

/* ============================================================
   CARD KEY MANAGEMENT · 卡密管理
   ============================================================ */

const CardKeyManager = (() => {
  const PLAN_NAMES = {
    planet: { name: '行星', icon: '🪐', price: 9.9 },
    star: { name: '恒星', icon: '☀️', price: 29.9 },
    galaxy: { name: '星系', icon: '🌌', price: 59.9 },
    universe: { name: '宇宙', icon: '🌠', price: 99 }
  };

  let generatedKeys = []; // 本次生成的卡密（未入库）
  let dbKeys = [];        // 数据库中的卡密

  /* ---------- 生成随机卡密 ---------- */
  function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const parts = [];
    for (let i = 0; i < 6; i++) {
      let part = '';
      for (let j = 0; j < 8; j++) {
        part += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      parts.push(part);
    }
    return 'TP-' + parts.join('-');
  }

  /* ---------- 批量生成 ---------- */
  function generateBatch() {
    const plan = document.getElementById('cardKeyPlan').value;
    const duration = parseInt(document.getElementById('cardKeyDuration').value);
    const count = parseInt(document.getElementById('cardKeyCount').value);
    const note = document.getElementById('cardKeyNote').value.trim();

    if (!plan || !duration || !count || count < 1 || count > 100) {
      alert('请填写完整的生成信息，数量范围 1-100');
      return;
    }

    generatedKeys = [];
    for (let i = 0; i < count; i++) {
      generatedKeys.push({
        key: generateKey(),
        plan: plan,
        duration: duration,
        note: note,
        isNew: true
      });
    }

    renderGeneratedKeys();
    document.getElementById('cardKeyResultPanel').style.display = 'block';

    // 自动滚动到结果区域
    document.getElementById('cardKeyResultPanel').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- 渲染生成的卡密 ---------- */
  function renderGeneratedKeys() {
    const tbody = document.getElementById('cardKeyResultBody');
    if (!tbody) return;

    const planInfo = PLAN_NAMES;
    tbody.innerHTML = generatedKeys.map(k => {
      const p = planInfo[k.plan];
      return `<tr>
        <td><code class="cardkey-code">${k.key}</code></td>
        <td>${p ? p.icon + ' ' + p.name : k.plan}</td>
        <td>${k.duration}天</td>
        <td>${k.note || '-'}</td>
      </tr>`;
    }).join('');
  }

  /* ---------- 复制全部 ---------- */
  function copyAll() {
    if (generatedKeys.length === 0) return;
    const text = generatedKeys.map(k => k.key).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert('已复制 ' + generatedKeys.length + ' 个卡密到剪贴板');
    }).catch(() => {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('已复制 ' + generatedKeys.length + ' 个卡密到剪贴板');
    });
  }

  /* ---------- 导出 CSV ---------- */
  function exportCSV() {
    if (generatedKeys.length === 0) return;
    const headers = ['卡密', '等级', '时长(天)', '备注'];
    const rows = generatedKeys.map(k => {
      const p = PLAN_NAMES[k.plan];
      return [k.key, p ? p.name : k.plan, k.duration, k.note || ''];
    });
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(r => {
      csv += r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',') + '\n';
    });
    downloadFile(csv, 'card_keys_' + new Date().toISOString().slice(0,10) + '.csv', 'text/csv;charset=utf-8;');
  }

  /* ---------- 导出 TXT ---------- */
  function exportTXT() {
    if (generatedKeys.length === 0) return;
    const text = generatedKeys.map(k => {
      const p = PLAN_NAMES[k.plan];
      return k.key + '  [' + (p ? p.name : k.plan) + ' ' + k.duration + '天]  ' + (k.note || '');
    }).join('\n');
    downloadFile(text, 'card_keys_' + new Date().toISOString().slice(0,10) + '.txt', 'text/plain');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- 清空结果 ---------- */
  function clearResult() {
    generatedKeys = [];
    document.getElementById('cardKeyResultBody').innerHTML = '';
    document.getElementById('cardKeyResultPanel').style.display = 'none';
  }

  /* ---------- 从数据库加载卡密列表 ---------- */
  async function loadKeys() {
    const tbody = document.getElementById('cardKeyTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="empty">加载中...</td></tr>';

    try {
      // 如果 Supabase 可用，从数据库加载
      if (typeof SB !== 'undefined' && SB.ready && SB.ready()) {
        const { data, error } = await SB._client
          .from('card_keys')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) throw error;
        dbKeys = data || [];
      } else {
        // 演示模式：显示空数据
        dbKeys = [];
      }

      renderDbKeys();
      updateStats();
    } catch (e) {
      console.error('[CardKey] loadKeys error:', e);
      tbody.innerHTML = '<tr><td colspan="8" class="empty">加载失败：' + e.message + '</td></tr>';
    }
  }

  /* ---------- 渲染数据库卡密 ---------- */
  function renderDbKeys() {
    const tbody = document.getElementById('cardKeyTableBody');
    if (!tbody) return;

    const filterPlan = document.getElementById('cardKeyFilterPlan')?.value || '';
    const filterStatus = document.getElementById('cardKeyFilterStatus')?.value || '';
    const search = document.getElementById('cardKeySearch')?.value.trim().toUpperCase() || '';

    let filtered = dbKeys.filter(k => {
      if (filterPlan && k.plan_type !== filterPlan) return false;
      if (filterStatus === 'unused' && k.is_used) return false;
      if (filterStatus === 'used' && !k.is_used) return false;
      if (search && !k.key_code.toUpperCase().includes(search)) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无卡密数据</td></tr>';
      return;
    }

    const planInfo = PLAN_NAMES;
    tbody.innerHTML = filtered.map(k => {
      const p = planInfo[k.plan_type];
      return `<tr>
        <td><code class="cardkey-code">${k.key_code}</code></td>
        <td>${p ? p.icon + ' ' + p.name : k.plan_type}</td>
        <td>${k.duration_days}天</td>
        <td><span class="badge ${k.is_used ? 'badge-used' : 'badge-unused'}">${k.is_used ? '已使用' : '未使用'}</span></td>
        <td>${k.used_by ? k.used_by.substring(0, 8) + '...' : '-'}</td>
        <td>${k.used_at ? new Date(k.used_at).toLocaleString('zh-CN') : '-'}</td>
        <td>${k.note || '-'}</td>
        <td>
          <button class="btn btn-sm btn-copy" data-key="${k.key_code}">复制</button>
          ${!k.is_used ? `<button class="btn btn-sm btn-delete" data-id="${k.id}">删除</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    // 绑定复制按钮
    tbody.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.key);
        btn.textContent = '已复制';
        setTimeout(() => btn.textContent = '复制', 1500);
      });
    });
  }

  /* ---------- 更新统计 ---------- */
  function updateStats() {
    const total = dbKeys.length;
    const used = dbKeys.filter(k => k.is_used).length;
    const unused = total - used;

    const elTotal = document.getElementById('cardKeyTotal');
    const elUsed = document.getElementById('cardKeyUsed');
    const elUnused = document.getElementById('cardKeyUnused');

    if (elTotal) elTotal.textContent = total;
    if (elUsed) elUsed.textContent = used;
    if (elUnused) elUnused.textContent = unused;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 生成按钮
    const btnGen = document.getElementById('btnGenerateCardKeys');
    if (btnGen) btnGen.addEventListener('click', generateBatch);

    // 复制按钮
    const btnCopy = document.getElementById('btnCopyCardKeys');
    if (btnCopy) btnCopy.addEventListener('click', copyAll);

    // 导出按钮
    const btnCSV = document.getElementById('btnExportCardKeysCSV');
    if (btnCSV) btnCSV.addEventListener('click', exportCSV);

    const btnTXT = document.getElementById('btnExportCardKeysTXT');
    if (btnTXT) btnTXT.addEventListener('click', exportTXT);

    // 清空按钮
    const btnClear = document.getElementById('btnClearCardKeyResult');
    if (btnClear) btnClear.addEventListener('click', clearResult);

    // 刷新按钮
    const btnRefresh = document.getElementById('btnRefreshCardKeys');
    if (btnRefresh) btnRefresh.addEventListener('click', loadKeys);

    // 筛选器
    ['cardKeyFilterPlan', 'cardKeyFilterStatus', 'cardKeySearch'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderDbKeys);
      if (el && id === 'cardKeySearch') el.addEventListener('input', renderDbKeys);
    });

    // 页面切换时加载
    document.querySelectorAll('[data-page="cardKeys"]').forEach(link => {
      link.addEventListener('click', () => {
        setTimeout(loadKeys, 100);
      });
    });
  }

  return { init, generateBatch, loadKeys };
})();

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  CardKeyManager.init();
});
