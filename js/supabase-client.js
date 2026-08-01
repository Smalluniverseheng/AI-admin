/* Supabase 客户端配置 — 与 AI 平台共用数据库 */
const SUPABASE_URL = 'https://mxvxlgjzeboktufumxbp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_WzUzAQK5cOEsn7QwFB2cAw_ubIkG7RJ';

// 依赖已改为本地 js/vendor/supabase.min.js，避免 CDN 被拦截后出现 auth 未定义。
if (window.supabase?.createClient) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseInitError = '';
} else {
  window.supabaseClient = null;
  window.supabaseInitError = 'Supabase SDK 加载失败，请刷新页面重试';
  console.error(window.supabaseInitError);
}
