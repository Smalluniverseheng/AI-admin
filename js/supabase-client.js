/* Supabase 客户端配置 — 与 AI 平台共用数据库 */
const SUPABASE_URL = 'https://mxvxlgjzeboktufumxbp.supabase.co';

// ⚠️ 重要：替换为真实的 Supabase Anon Key
// 获取方式：Supabase 控制台 → Project Settings → API → anon/public key
// 格式示例：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx...
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 导出供 admin.js 使用
window.supabaseClient = supabase;
