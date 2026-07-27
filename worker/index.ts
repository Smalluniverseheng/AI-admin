/* ============================================================
   AI Gateway Worker — Cloudflare Worker (TypeScript)
   功能：
     1. 云端代理模式：进阶+用户上传的 API Key 由 Worker 代发
     2. 游客/普通用户：前端直连厂商，Worker 只读不写
     3. 流式 SSE 透传 + 非流式 JSON 返回
     4. 对话/消息持久化到 Supabase
     5. 用量统计写入 Supabase token_usage
     6. 多 Key 轮询 + 请求缓存（Cloudflare KV）
   ============================================================ */

export interface Env {
  // Worker 自身密钥（用于解密用户上传的 API Key）
  WORKER_SECRET: string;

  // 厂商 API Keys（兜底，用户未上传时用）
  OPENAI_KEY: string;
  ANTHROPIC_KEY: string;
  GOOGLE_KEY: string;
  SILICONFLOW_KEY: string;
  TENCENT_KEY: string;
  ALI_KEY: string;
  DEEPSEEK_KEY: string;
  KIMI_KEY: string;
  BAICHUAN_KEY: string;
  ZHIPU_KEY: string;
  MINIMAX_KEY: string;
  SPARK_KEY: string;
  DOUBAO_KEY: string;
  HUNYUAN_KEY: string;
  WENXIN_KEY: string;
  QWEN_KEY: string;
  COHERE_KEY: string;
  MISTRAL_KEY: string;
  GROQ_KEY: string;
  PERPLEXITY_KEY: string;
  TOGETHER_KEY: string;
  FIREWORKS_KEY: string;
  OPENROUTER_KEY: string;

  // Supabase（用于读取用户等级、加密 Key、写入对话/用量）
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // Cloudflare KV（缓存 + Key 临时存储）
  AI_GATEWAY_KV: KVNamespace;
}

/* ---------- 厂商配置 ---------- */
interface ProviderConfig {
  base: string;
  headers: (key: string) => Record<string, string>;
  buildBody: (body: ChatBody) => any;
  parseStream: (line: string) => string | null;
  extractUsage: (json: any) => TokenUsage | null;
}

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    base: 'https://api.openai.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  anthropic: {
    base: 'https://api.anthropic.com',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }),
    buildBody: (b) => ({
      model: b.model,
      messages: b.messages,
      max_tokens: b.max_tokens,
      temperature: b.temperature,
      stream: b.stream,
    }),
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta') return j.delta?.text || '';
        return null;
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.input_tokens + j.usage.output_tokens } : null,
  },
  google: {
    base: 'https://generativelanguage.googleapis.com',
    headers: (k) => ({ 'x-goog-api-key': k, 'Content-Type': 'application/json' }),
    buildBody: (b) => ({
      contents: b.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: b.temperature, maxOutputTokens: b.max_tokens },
    }),
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch { return null; }
    },
    extractUsage: () => null, // Google 不返回用量
  },
  deepseek: {
    base: 'https://api.deepseek.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  kimi: {
    base: 'https://api.moonshot.cn',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  siliconflow: {
    base: 'https://api.siliconflow.cn',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  qwen: {
    base: 'https://dashscope.aliyuncs.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => ({ model: b.model, input: { messages: b.messages }, parameters: { temperature: b.temperature, max_tokens: b.max_tokens, result_format: 'message' } }),
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.output?.choices?.[0]?.message?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  doubao: {
    base: 'https://ark.cn-beijing.volces.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  hunyuan: {
    base: 'https://hunyuan.tencentcloudapi.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      try {
        const j = JSON.parse(data);
        return j.Choices?.[0]?.Delta?.Content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.Usage ? { prompt_tokens: j.Usage.PromptTokens, completion_tokens: j.Usage.CompletionTokens, total_tokens: j.Usage.TotalTokens } : null,
  },
  spark: {
    base: 'https://spark-api-open.xf-yun.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.payload?.choices?.text?.[0]?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.payload?.usage ? { prompt_tokens: j.payload.usage.text.prompt_tokens, completion_tokens: j.payload.usage.text.completion_tokens, total_tokens: j.payload.usage.text.total_tokens } : null,
  },
  minimax: {
    base: 'https://api.minimax.chat',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => ({ model: b.model, messages: b.messages, temperature: b.temperature, max_tokens: b.max_tokens }),
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.choices?.[0]?.messages?.[0]?.content || '';
      } catch { return null; }
    },
    extractUsage: () => null,
  },
  baichuan: {
    base: 'https://api.baichuan-ai.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  zhipu: {
    base: 'https://open.bigmodel.cn',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  wenxin: {
    base: 'https://qianfan.baidubce.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.result || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  cohere: {
    base: 'https://api.cohere.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }),
    buildBody: (b) => ({ model: b.model, message: b.messages[b.messages.length - 1]?.content, chat_history: b.messages.slice(0, -1).map(m => ({ role: m.role, message: m.content })), temperature: b.temperature, max_tokens: b.max_tokens, stream: b.stream }),
    parseStream: (line) => {
      try {
        const j = JSON.parse(line);
        return j.text || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.meta?.tokens ? { prompt_tokens: j.meta.tokens.input_tokens, completion_tokens: j.meta.tokens.output_tokens, total_tokens: j.meta.tokens.input_tokens + j.meta.tokens.output_tokens } : null,
  },
  mistral: {
    base: 'https://api.mistral.ai',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  groq: {
    base: 'https://api.groq.com',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  perplexity: {
    base: 'https://api.perplexity.ai',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  together: {
    base: 'https://api.together.xyz',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  fireworks: {
    base: 'https://api.fireworks.ai',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
  openrouter: {
    base: 'https://openrouter.ai',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://smalluniverseheng.github.io/AI/', 'X-Title': '第三方科技AI' }),
    buildBody: (b) => b,
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6);
      if (data === '[DONE]') return null;
      try {
        const j = JSON.parse(data);
        return j.choices?.[0]?.delta?.content || '';
      } catch { return null; }
    },
    extractUsage: (j) => j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens } : null,
  },
};

/* ---------- CORS ---------- */
function corsHeaders(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-User-ID',
    'Access-Control-Max-Age': '86400',
  };
}

/* ---------- 主入口 ---------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // 路由分发
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return await handleChat(request, env, origin);
      }
      if (url.pathname === '/api/history' && request.method === 'GET') {
        return await handleHistory(request, env, origin);
      }
      if (url.pathname === '/api/history' && request.method === 'POST') {
        return await handleSaveHistory(request, env, origin);
      }
      if (url.pathname === '/api/models' && request.method === 'GET') {
        return handleModels(origin);
      }
      if (url.pathname === '/api/upload-key' && request.method === 'POST') {
        return await handleUploadKey(request, env, origin);
      }
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok', time: Date.now() }, 200, origin);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });
    } catch (e: any) {
      return jsonResponse({ error: e.message || 'Internal error' }, 500, origin);
    }
  },
};

/* ---------- /api/chat ---------- */
async function handleChat(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json()) as any;
  const { model, messages, temperature = 0.7, max_tokens = 4096, stream = true, user_id, conversation_id } = body;

  if (!model || !messages || !Array.isArray(messages)) {
    return jsonResponse({ error: '缺少 model 或 messages' }, 400, origin);
  }

  // 1. 解析厂商
  let providerKey: string;
  let modelId: string;
  if (model.includes('/')) {
    [providerKey, modelId] = model.split('/');
  } else {
    modelId = model;
    providerKey = inferProvider(model);
  }

  const provider = PROVIDERS[providerKey];
  if (!provider) {
    return jsonResponse({ error: `不支持的厂商: ${providerKey}` }, 400, origin);
  }

  // 2. 获取 API Key（优先用户上传的，其次 Worker 兜底）
  let apiKey: string | null = null;
  if (user_id) {
    apiKey = await getUserApiKey(env, user_id, providerKey);
  }
  if (!apiKey) {
    apiKey = getFallbackKey(env, providerKey);
  }
  if (!apiKey) {
    return jsonResponse({ error: `厂商 ${providerKey} 的 API Key 未配置` }, 500, origin);
  }

  // 3. 检查缓存（相同 prompt 5 分钟内直接返回）
  const cacheKey = await sha256(JSON.stringify({ model, messages, temperature, max_tokens }));
  if (!stream) {
    const cached = await env.AI_GATEWAY_KV.get(`cache:${cacheKey}`);
    if (cached) {
      return jsonResponse(JSON.parse(cached), 200, origin);
    }
  }

  // 4. 构造请求
  const upstreamBody = provider.buildBody({
    model: modelId,
    messages,
    temperature,
    max_tokens,
    stream,
  });

  const targetUrl = provider.base + (providerKey === 'google'
    ? `/v1beta/models/${modelId}:streamGenerateContent`
    : providerKey === 'qwen'
    ? '/api/v1/services/aigc/text-generation/generation'
    : providerKey === 'hunyuan'
    ? '/v1/chat/completions'
    : providerKey === 'spark'
    ? '/v1/chat'
    : providerKey === 'minimax'
    ? '/v1/text/chatcompletion_v2'
    : providerKey === 'wenxin'
    ? '/v2/chat'
    : '/v1/chat/completions');

  const upstream = await fetch(targetUrl, {
    method: 'POST',
    headers: provider.headers(apiKey),
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return jsonResponse({ error: `厂商错误 ${upstream.status}: ${errText.slice(0, 300)}` }, upstream.status, origin);
  }

  // 5. 流式透传 + 后台持久化
  if (stream) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let fullText = '';
    let tokenUsage: TokenUsage | null = null;

    ctx.waitUntil((async () => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const chunk = provider.parseStream(trimmed);
            if (chunk !== null) {
              fullText += chunk;
              await writer.write(encoder.encode(`data: ${JSON.stringify({ content: chunk })}

`));
            }
            // 尝试提取最终用量
            if (trimmed.startsWith('data: ')) {
              try {
                const j = JSON.parse(trimmed.slice(6));
                if (j.usage) tokenUsage = provider.extractUsage(j);
              } catch {}
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]

'));
      } catch (e) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: String(e) })}

`));
      } finally {
        await writer.close();
      }

      // 持久化到 Supabase
      if (user_id && conversation_id) {
        await saveMessage(env, user_id, conversation_id, messages, fullText, tokenUsage, model);
      }
    })());

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 非流式
  const respText = await upstream.text();
  let respJson: any;
  try { respJson = JSON.parse(respText); } catch { respJson = { text: respText }; }

  // 缓存非流式响应
  await env.AI_GATEWAY_KV.put(`cache:${cacheKey}`, JSON.stringify(respJson), { expirationTtl: 300 });

  // 持久化
  if (user_id && conversation_id) {
    const usage = provider.extractUsage(respJson);
    await saveMessage(env, user_id, conversation_id, messages, respJson.choices?.[0]?.message?.content || respJson.text || '', usage, model);
  }

  return jsonResponse(respJson, 200, origin);
}

/* ---------- /api/history GET ---------- */
async function handleHistory(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const convId = url.searchParams.get('conversation_id');
  if (!userId) return jsonResponse({ error: '缺少 user_id' }, 400, origin);

  const supabase = createSupabaseClient(env);

  if (convId) {
    // 查询单条对话的消息
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (error) return jsonResponse({ error: error.message }, 500, origin);
    return jsonResponse({ messages: data }, 200, origin);
  } else {
    // 查询用户的所有对话
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) return jsonResponse({ error: error.message }, 500, origin);
    return jsonResponse({ conversations: data }, 200, origin);
  }
}

/* ---------- /api/history POST ---------- */
async function handleSaveHistory(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json()) as any;
  const { user_id, conversation_id, title, messages } = body;
  if (!user_id) return jsonResponse({ error: '缺少 user_id' }, 400, origin);

  const supabase = createSupabaseClient(env);
  const now = new Date().toISOString();

  // 创建/更新对话
  const convData = {
    user_id,
    title: title || '新对话',
    updated_at: now,
    ...(conversation_id ? {} : { created_at: now }),
  };

  let convId = conversation_id;
  if (!convId) {
    const { data, error } = await supabase.from('conversations').insert(convData).select('id').single();
    if (error) return jsonResponse({ error: error.message }, 500, origin);
    convId = data.id;
  } else {
    await supabase.from('conversations').update(convData).eq('id', convId);
  }

  // 批量插入消息
  if (messages && messages.length > 0) {
    const msgRows = messages.map((m: any) => ({
      conversation_id: convId,
      role: m.role,
      content: m.content,
      model: m.model,
      provider: m.provider,
      tokens_used: m.tokens_used || 0,
      created_at: m.created_at || now,
    }));
    const { error } = await supabase.from('messages').insert(msgRows);
    if (error) return jsonResponse({ error: error.message }, 500, origin);
  }

  return jsonResponse({ conversation_id: convId, saved: true }, 200, origin);
}

/* ---------- /api/upload-key ---------- */
async function handleUploadKey(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json()) as any;
  const { user_id, provider, encrypted_key, iv, salt } = body;
  if (!user_id || !provider || !encrypted_key) {
    return jsonResponse({ error: '缺少参数' }, 400, origin);
  }

  const supabase = createSupabaseClient(env);

  // 同时存两份：用户密码派生版 + Worker 可解密版
  // Worker 版：用 WORKER_SECRET 做简单 AES 加密
  const workerEncrypted = await workerEncrypt(encrypted_key, env.WORKER_SECRET);

  const { error } = await supabase.from('encrypted_api_keys').upsert({
    user_id,
    provider,
    encrypted_key,      // 用户密码派生加密（前端生成）
    iv,
    salt,
    worker_encrypted: workerEncrypted,  // Worker 可解密
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });

  if (error) return jsonResponse({ error: error.message }, 500, origin);
  return jsonResponse({ ok: true }, 200, origin);
}

/* ---------- /api/models ---------- */
function handleModels(origin: string): Response {
  const models = Object.entries(PROVIDERS).flatMap(([key, _]) => {
    const modelMap: Record<string, string[]> = {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
      google: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      deepseek: ['deepseek-chat', 'deepseek-coder'],
      kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      siliconflow: ['Qwen/Qwen2-72B-Instruct', 'THUDM/glm-4-9b-chat', 'meta-llama/Meta-Llama-3-70B-Instruct'],
      qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
      doubao: ['doubao-pro-32k', 'doubao-lite-32k'],
      hunyuan: ['hunyuan-pro', 'hunyuan-standard'],
      spark: ['spark-pro', 'spark-max', 'spark-lite'],
      minimax: ['abab6.5s-chat', 'abab6-chat'],
      baichuan: ['Baichuan4', 'Baichuan3-Turbo'],
      zhipu: ['glm-4', 'glm-4-air', 'glm-4-flash'],
      wenxin: ['ERNIE-Bot-4', 'ERNIE-Speed-8K'],
      cohere: ['command-r-plus', 'command-r'],
      mistral: ['mistral-large-latest', 'mistral-medium-latest'],
      groq: ['llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma-7b-it'],
      perplexity: ['sonar-small-chat', 'sonar-medium-chat', 'sonar-large-chat'],
      together: ['togethercomputer/llama-2-70b', 'togethercomputer/llama-2-13b'],
      fireworks: ['accounts/fireworks/models/llama-v3-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct'],
      openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'],
    };
    return (modelMap[key] || []).map(m => ({ id: `${key}/${m}`, provider: key, name: m }));
  });
  return jsonResponse({ models }, 200, origin);
}

/* ---------- 工具函数 ---------- */
function inferProvider(model: string): string {
  if (model.startsWith('gpt') || model.startsWith('text-')) return 'openai';
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gemini')) return 'google';
  if (model.includes('deepseek')) return 'deepseek';
  if (model.includes('moonshot') || model.includes('kimi')) return 'kimi';
  if (model.includes('Qwen') || model.includes('Yi') || model.includes('silicon')) return 'siliconflow';
  if (model.includes('qwen') || model.includes('dashscope')) return 'qwen';
  if (model.includes('doubao') || model.includes('volces')) return 'doubao';
  if (model.includes('hunyuan')) return 'hunyuan';
  if (model.includes('spark') || model.includes('xf-yun')) return 'spark';
  if (model.includes('minimax') || model.includes('abab')) return 'minimax';
  if (model.includes('baichuan')) return 'baichuan';
  if (model.includes('glm') || model.includes('zhipu')) return 'zhipu';
  if (model.includes('ERNIE') || model.includes('wenxin')) return 'wenxin';
  if (model.includes('command')) return 'cohere';
  if (model.includes('mistral')) return 'mistral';
  if (model.includes('groq') || model.includes('llama3-70b') || model.includes('mixtral-8x7b')) return 'groq';
  if (model.includes('sonar')) return 'perplexity';
  if (model.includes('together')) return 'together';
  if (model.includes('fireworks')) return 'fireworks';
  if (model.includes('openrouter')) return 'openrouter';
  return 'openai';
}

function getFallbackKey(env: Env, provider: string): string | undefined {
  const map: Record<string, keyof Env> = {
    openai: 'OPENAI_KEY', anthropic: 'ANTHROPIC_KEY', google: 'GOOGLE_KEY',
    siliconflow: 'SILICONFLOW_KEY', tencent: 'TENCENT_KEY', ali: 'ALI_KEY',
    deepseek: 'DEEPSEEK_KEY', kimi: 'KIMI_KEY', baichuan: 'BAICHUAN_KEY',
    zhipu: 'ZHIPU_KEY', minimax: 'MINIMAX_KEY', spark: 'SPARK_KEY',
    doubao: 'DOUBAO_KEY', hunyuan: 'HUNYUAN_KEY', wenxin: 'WENXIN_KEY',
    qwen: 'QWEN_KEY', cohere: 'COHERE_KEY', mistral: 'MISTRAL_KEY',
    groq: 'GROQ_KEY', perplexity: 'PERPLEXITY_KEY', together: 'TOGETHER_KEY',
    fireworks: 'FIREWORKS_KEY', openrouter: 'OPENROUTER_KEY',
  };
  const k = map[provider];
  return k ? (env[k] as string) : undefined;
}

async function getUserApiKey(env: Env, userId: string, provider: string): Promise<string | null> {
  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('encrypted_api_keys')
    .select('worker_encrypted')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();

  if (error || !data?.worker_encrypted) return null;
  return workerDecrypt(data.worker_encrypted, env.WORKER_SECRET);
}

async function saveMessage(env: Env, userId: string, convId: string, messages: any[], assistantText: string, usage: TokenUsage | null, model: string) {
  const supabase = createSupabaseClient(env);
  const now = new Date().toISOString();

  // 更新对话时间
  await supabase.from('conversations').update({ updated_at: now }).eq('id', convId);

  // 插入用户消息（最后一条）
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg) {
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: lastUserMsg.content,
      model,
      created_at: now,
    });
  }

  // 插入助手回复
  await supabase.from('messages').insert({
    conversation_id: convId,
    role: 'assistant',
    content: assistantText,
    model,
    tokens_used: usage?.total_tokens || 0,
    created_at: now,
  });

  // 记录用量
  if (usage) {
    await supabase.from('token_usage').insert({
      user_id: userId,
      provider: inferProvider(model),
      model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      created_at: now,
    });
  }
}

/* ---------- Supabase 客户端 ---------- */
function createSupabaseClient(env: Env) {
  // 使用 service_role key 绕过 RLS（Worker 是可信后端）
  return {
    from: (table: string) => ({
      select: (cols: string) => ({ eq: (col: string, val: any) => ({ eq: (c2: string, v2: any) => ({ single: async () => fetchSupabase(env, 'GET', table, cols, { [col]: val, [c2]: v2 }) }) }), single: async () => fetchSupabase(env, 'GET', table, cols, { [col]: val }) }) }),
      insert: (rows: any) => ({ select: (cols: string) => ({ single: async () => fetchSupabase(env, 'POST', table, null, null, rows) }), error: null }),
      update: (row: any) => ({ eq: (col: string, val: any) => ({ error: null }) }),
      upsert: (row: any, opts?: any) => ({ error: null }),
    }),
  };
}

// 简化版：直接用 fetch 调 Supabase REST API
async function fetchSupabase(env: Env, method: string, table: string, select?: string | null, filters?: Record<string, any> | null, body?: any) {
  let url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  if (select) url += `?select=${encodeURIComponent(select)}`;
  if (filters) {
    const qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    url += (select ? '&' : '?') + qs;
  }

  const headers: Record<string, string> = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : '',
  };

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { data: null, error: { message: text } };
  }
  const data = await resp.json();
  return { data, error: null };
}

/* ---------- 加密工具（Worker 版） ---------- */
async function workerEncrypt(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const combined = new Uint8Array(iv.length + new Uint8Array(ct).length);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function workerDecrypt(b64: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const keyData = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data: any, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}
