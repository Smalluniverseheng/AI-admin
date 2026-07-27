# AI Gateway Worker

Cloudflare Worker 作为 AI 聚合平台的后端网关。

## 功能
- 云端代理模式：进阶+用户上传的 API Key 由 Worker 代发
- 支持 23 家厂商的流式 SSE + 非流式 JSON
- 对话/消息持久化到 Supabase
- 用量统计写入 Supabase
- 请求缓存（Cloudflare KV，5 分钟 TTL）

## 部署

### 1. 安装依赖
```bash
npm install
```

### 2. 登录 Cloudflare
```bash
npx wrangler login
```

### 3. 创建 KV 命名空间
```bash
npx wrangler kv:namespace create "AI_GATEWAY_KV"
```
把返回的 `id` 填到 `wrangler.toml` 中。

### 4. 设置 Secrets
```bash
npx wrangler secret put WORKER_SECRET        # Worker 加密密钥
npx wrangler secret put SUPABASE_SERVICE_KEY # Supabase service_role key
npx wrangler secret put OPENAI_KEY           # 按需设置厂商 Key
npx wrangler secret put DEEPSEEK_KEY
npx wrangler secret put KIMI_KEY
# ... 其他厂商
```

### 5. 部署
```bash
npx wrangler deploy
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 对话（流式/非流式） |
| `/api/history` | GET | 获取历史对话/消息 |
| `/api/history` | POST | 保存历史对话 |
| `/api/upload-key` | POST | 上传加密 API Key |
| `/api/models` | GET | 获取支持的模型列表 |
| `/health` | GET | 健康检查 |

## 前端对接

前端通过 `js/cloud-agent.js` 对接，详见主站代码。
