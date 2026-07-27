/* Supabase 客户端配置 — 与 AI 平台共用数据库 */
const SUPABASE_URL = 'https://mxvxlgjzeboktufumxbp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3ODgxMzcsImV4cCI6MjA1ODM2NDEzN30.4-3r6a6nC9z3z3z3z3z3z3z3z3z3z3z3z3z3z3z3z3z';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 导出供 admin.js 使用
window.supabaseClient = supabase;
