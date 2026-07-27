/* AI 管理后台逻辑 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const Admin = {
  currentUser: null,
  currentPage: 'dashboard',

  init() {
    this.bindEvents();
    this.checkSession();
  },

  // 检查登录状态
  async checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      this.currentUser = session.user;
      this.showAdmin();
    } else {
      this.showLogin();
    }
  },

  // 绑定事件
  bindEvents() {
    // 登录
    $('#loginBtn').addEventListener('click', () => this.login());
    $('#loginPassword').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 退出
    $('#logoutBtn').addEventListener('click', () => this.logout());

    // 导航切换
    $$('.sidebar nav a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.navigate(page);
      });
    });

    // 保存设置
    $('#saveSettings').addEventListener('click', () => this.saveSettings());
  },

  // 登录
  async login() {
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const errorEl = $('#loginError');

    if (!email || !password) {
      errorEl.textContent = '请输入邮箱和密码';
      return;
    }

    $('#loginBtn').textContent = '登录中...';
    $('#loginBtn').disabled = true;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email, password
    });

    $('#loginBtn').textContent = '登录';
    $('#loginBtn').disabled = false;

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    // 检查是否为管理员
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      errorEl.textContent = '无权访问：您不是管理员';
      await supabaseClient.auth.signOut();
      return;
    }

    this.currentUser = data.user;
    this.showAdmin();
  },

  // 退出
  async logout() {
    await supabaseClient.auth.signOut();
    this.currentUser = null;
    this.showLogin();
  },

  // 显示登录页
  showLogin() {
    $('#loginPage').classList.add('active');
    $('#adminPage').classList.remove('active');
    $('#loginEmail').value = '';
    $('#loginPassword').value = '';
    $('#loginError').textContent = '';
  },

  // 显示管理后台
  showAdmin() {
    $('#loginPage').classList.remove('active');
    $('#adminPage').classList.add('active');
    $('#adminEmail').textContent = this.currentUser?.email || 'Admin';
    this.loadDashboard();
  },

  // 页面导航
  navigate(page) {
    this.currentPage = page;

    // 更新导航高亮
    $$('.sidebar nav a').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // 切换内容
    $$('.content').forEach(section => {
      section.classList.toggle('active', section.id === page);
    });

    // 加载数据
    if (page === 'dashboard') this.loadDashboard();
    if (page === 'users') this.loadUsers();
    if (page === 'agents') this.loadAgents();
    if (page === 'orders') this.loadOrders();
  },

  // 加载仪表盘数据
  async loadDashboard() {
    // 总用户数
    const { count: userCount } = await supabaseClient
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    $('#statUsers').textContent = userCount || 0;

    // 代理数
    const { count: agentCount } = await supabaseClient
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'agent');
    $('#statAgents').textContent = agentCount || 0;

    // 今日订单
    const today = new Date().toISOString().split('T')[0];
    const { count: orderCount } = await supabaseClient
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today);
    $('#statOrders').textContent = orderCount || 0;

    // 今日收入
    const { data: revenue } = await supabaseClient
      .from('orders')
      .select('amount')
      .gte('created_at', today)
      .eq('status', 'paid');
    const total = revenue?.reduce((sum, o) => sum + (o.amount || 0), 0) || 0;
    $('#statRevenue').textContent = '¥' + total.toFixed(2);
  },

  // 加载用户列表
  async loadUsers() {
    const { data: users, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('加载用户失败:', error);
      return;
    }

    const tbody = $('#usersTable');
    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无用户</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:14px">
              ${(u.nickname || u.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div>${u.nickname || '未设置昵称'}</div>
              <div style="font-size:12px;color:var(--text-muted)">${u.email || ''}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-${u.role || 'user'}">${u.role || 'user'}</span></td>
        <td>${u.token_used || 0} / ${u.token_quota || 0}</td>
        <td>${new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
        <td>
          <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick="Admin.editUser('${u.id}')">编辑</button>
        </td>
      </tr>
    `).join('');
  },

  // 加载代理列表
  async loadAgents() {
    const { data: agents, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('role', 'agent')
      .order('created_at', { ascending: false });

    const tbody = $('#agentsTable');
    if (error || !agents || agents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无代理</td></tr>';
      return;
    }

    tbody.innerHTML = agents.map(a => `
      <tr>
        <td>${a.nickname || a.email || '未知'}</td>
        <td>${a.agent_code || '—'}</td>
        <td>0</td>
        <td>¥0.00</td>
        <td><span class="badge badge-agent">正常</span></td>
        <td>
          <button class="btn-primary" style="padding:6px 12px;font-size:12px">查看</button>
        </td>
      </tr>
    `).join('');
  },

  // 加载订单列表
  async loadOrders() {
    const { data: orders, error } = await supabaseClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    const tbody = $('#ordersTable');
    if (error || !orders || orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无订单</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>${o.id?.slice(0, 8) || '—'}</td>
        <td>${o.user_id?.slice(0, 8) || '—'}</td>
        <td>${o.type || '—'}</td>
        <td>¥${o.amount || 0}</td>
        <td><span class="badge badge-${o.status === 'paid' ? 'success' : 'warning'}">${o.status || 'unknown'}</span></td>
        <td>${new Date(o.created_at).toLocaleString('zh-CN')}</td>
      </tr>
    `).join('');
  },

  // 保存设置
  async saveSettings() {
    const freeQuota = parseInt($('#freeQuota').value) || 100000;
    const vipQuota = parseInt($('#vipQuota').value) || 1000000;
    const commissionRate = parseInt($('#commissionRate').value) || 20;

    // 保存到 configs 表
    const { error } = await supabaseClient
      .from('configs')
      .upsert([
        { key: 'free_quota', value: freeQuota },
        { key: 'vip_quota', value: vipQuota },
        { key: 'commission_rate', value: commissionRate }
      ]);

    if (error) {
      alert('保存失败: ' + error.message);
    } else {
      alert('设置已保存');
    }
  },

  // 编辑用户（占位）
  editUser(userId) {
    alert('编辑用户: ' + userId + '\n（后续实现弹窗编辑）');
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => Admin.init());
