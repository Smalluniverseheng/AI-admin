#!/bin/bash
# AI Gateway Worker 部署脚本
# 在 Termux 或任何有 Node.js 的环境中运行

echo "=== AI Gateway 部署 ==="

# 1. 检查 wrangler
if ! command -v wrangler &> /dev/null; then
    echo "安装 wrangler..."
    npm install -g wrangler
fi

# 2. 登录（只需一次）
# wrangler login

# 3. 创建 KV 命名空间（只需一次）
# wrangler kv:namespace create "AI_GATEWAY_KV"
# 然后把返回的 id 填到 wrangler.toml 中

# 4. 设置 Secrets
echo "设置 Secrets..."
read -sp "WORKER_SECRET (用于加密用户 API Key): " WORKER_SECRET
echo
wrangler secret put WORKER_SECRET <<< "$WORKER_SECRET"

read -sp "SUPABASE_SERVICE_KEY (Service Role Key): " SUPABASE_KEY
echo
wrangler secret put SUPABASE_SERVICE_KEY <<< "$SUPABASE_KEY"

# 厂商 Keys（按需设置）
for key in OPENAI_KEY ANTHROPIC_KEY GOOGLE_KEY SILICONFLOW_KEY DEEPSEEK_KEY KIMI_KEY QWEN_KEY DOUBAO_KEY HUNYUAN_KEY SPARK_KEY MINIMAX_KEY BAICHUAN_KEY ZHIPU_KEY WENXIN_KEY COHERE_KEY MISTRAL_KEY GROQ_KEY PERPLEXITY_KEY TOGETHER_KEY FIREWORKS_KEY OPENROUTER_KEY; do
    read -sp "$key (按回车跳过): " val
    echo
    if [ -n "$val" ]; then
        wrangler secret put $key <<< "$val"
    fi
done

# 5. 部署
echo "部署 Worker..."
wrangler deploy

echo "=== 部署完成 ==="
echo "Worker 地址: https://ai-gateway.your-subdomain.workers.dev"
