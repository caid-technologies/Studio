/**
 * Unified LLM client supporting NVIDIA NIM, OpenRouter, and Databricks
 * Primary: NVIDIA NIM for Nemotron (structured output via guided_json)
 * Fallback: OpenRouter for multi-model routing
 * Optional: Databricks for vector search and alternative LLM gateway
 */

import { devLog, devWarn } from '@/lib/logger'

// ─── NVIDIA NIM (Direct) ────────────────────────────────────────

export async function nimChat(
  messages: any[],
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
    guidedJson?: any
    minThinkingTokens?: number
    maxThinkingTokens?: number
    stream?: boolean
  } = {}
) {
  const {
    model = 'nvidia/nvidia-nemotron-nano-9b-v2',
    maxTokens = 1024,
    temperature = 0.6,
    guidedJson,
    minThinkingTokens = 0,
    maxThinkingTokens = 0,
    stream = false,
  } = options

  const body: any = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: 0.95,
    stream,
  }

  // Add thinking tokens for agentic reasoning
  if (maxThinkingTokens > 0) {
    body.extra_body = {
      min_thinking_tokens: minThinkingTokens,
      max_thinking_tokens: maxThinkingTokens,
    }
  }

  // Add structured output constraint
  if (guidedJson) {
    if (!body.extra_body) body.extra_body = {}
    body.extra_body.guided_json = guidedJson
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── OpenRouter (Unified Gateway with Fallback) ──────────────────

export async function openRouterChat(
  messages: any[],
  options: {
    model?: string | string[]
    maxTokens?: number
    temperature?: number
    responseFormat?: any
    route?: 'preferred' | 'random' | 'fallback'
    plugins?: any[]
    stream?: boolean
  } = {}
) {
  const {
    model = 'anthropic/claude-sonnet-4',
    maxTokens = 1024,
    temperature = 0.7,
    responseFormat,
    route = 'fallback',
    plugins = [{ id: 'response-healing' }], // Auto-heal malformed JSON
    stream = false,
  } = options

  const body: any = {
    messages,
    max_tokens: maxTokens,
    temperature,
    stream,
    ...(Array.isArray(model) ? { models: model, route } : { model }),
    ...(responseFormat && { response_format: responseFormat }),
    ...(plugins.length > 0 && { plugins }),
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Studio',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Databricks LLM Gateway ────────────────────────────────────────

export async function databricksChat(
  endpoint: string,
  messages: any[],
  options: {
    maxTokens?: number
    temperature?: number
    responseFormat?: any
  } = {}
) {
  const { maxTokens = 1024, temperature = 0.7, responseFormat } = options

  const host = process.env.DATABRICKS_HOST
  const token = process.env.DATABRICKS_TOKEN

  if (!host || !token) {
    throw new Error('Databricks not configured: missing DATABRICKS_HOST or DATABRICKS_TOKEN')
  }

  const body: any = {
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(responseFormat && { response_format: responseFormat }),
  }

  const response = await fetch(`${host}/serving-endpoints/${endpoint}/invocations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Databricks error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Databricks Vector Search ──────────────────────────────────────

export async function databricksVectorSearch(
  indexName: string,
  query: string,
  options: {
    numResults?: number
    columns?: string[]
    filters?: Record<string, any>
  } = {}
) {
  const { numResults = 5, columns = [], filters = {} } = options

  const host = process.env.DATABRICKS_HOST
  const token = process.env.DATABRICKS_TOKEN

  if (!host || !token) {
    throw new Error('Databricks not configured: missing DATABRICKS_HOST or DATABRICKS_TOKEN')
  }

  const body: any = {
    query_text: query,
    num_results: numResults,
    ...(columns.length > 0 && { columns }),
    ...(Object.keys(filters).length > 0 && { filters_json: JSON.stringify(filters) }),
  }

  const response = await fetch(`${host}/api/2.0/vector-search/indexes/${indexName}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Databricks Vector Search error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Hybrid Chat: NIM → OpenRouter Fallback ────────────────────────

/**
 * Intelligent routing: use NIM for structured intent parsing (via guided_json),
 * fall back to OpenRouter for general-purpose chat and code generation
 */
export async function hybridChat(
  messages: any[],
  options: {
    purpose?: 'intent-parsing' | 'code-generation' | 'design-reasoning'
    guidedJsonSchema?: any
    useThinking?: boolean
    fallbackToOpenRouter?: boolean
  } = {}
) {
  const {
    purpose = 'code-generation',
    guidedJsonSchema,
    useThinking = false,
    fallbackToOpenRouter = true,
  } = options

  // Use NIM for structured intent parsing with thinking
  if (purpose === 'intent-parsing' && guidedJsonSchema) {
    try {
      const result = await nimChat(messages, {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        temperature: 0.1,
        guidedJson: guidedJsonSchema,
        maxThinkingTokens: useThinking ? 2048 : 0,
        maxTokens: 512,
      })
      return result
    } catch (error) {
      if (!fallbackToOpenRouter) throw error
      devWarn('[llm-clients] NIM intent parsing failed, falling back to OpenRouter')
    }
  }

  // Use NIM with thinking for design reasoning
  if (purpose === 'design-reasoning' && useThinking) {
    try {
      const result = await nimChat(messages, {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        temperature: 0.6,
        minThinkingTokens: 1024,
        maxThinkingTokens: 3000,
        maxTokens: 2048,
      })
      return result
    } catch (error) {
      if (!fallbackToOpenRouter) throw error
      devWarn('[llm-clients] NIM design reasoning failed, falling back to OpenRouter')
    }
  }

  // Default to OpenRouter for code generation and general chat
  return openRouterChat(messages, {
    model:
      purpose === 'code-generation'
        ? 'anthropic/claude-sonnet-4'
        : 'nvidia/nemotron-nano-9b-v2',
    temperature: purpose === 'code-generation' ? 0.3 : 0.7,
    maxTokens: purpose === 'code-generation' ? 2048 : 1024,
    route: 'fallback',
  })
}

// ─── NIM Embeddings for Vector Similarity ──────────────────────────

export async function nimEmbeddings(
  texts: string[],
  options: {
    model?: 'code' | 'qa' // code: nv-embedcode-7b-v1, qa: nv-embedqa-e5-v5
  } = {}
) {
  const { model = 'qa' } = options

  const modelId =
    model === 'code' ? 'nvidia/nv-embedcode-7b-v1' : 'nvidia/nv-embedqa-e5-v5'

  const response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      input: texts,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM Embeddings error ${response.status}: ${error}`)
  }

  const data = await response.json()
  return data.data // Array of { embedding, index }
}

// ─── Vision-Language: Nemotron 12B VL (sketch analysis) ────────────

export async function nimVisionChat(
  messages: any[], // Can include { role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "text", text }] }
  options: {
    maxTokens?: number
    temperature?: number
    guidedJson?: any
  } = {}
) {
  const { maxTokens = 1024, temperature = 0.6, guidedJson } = options

  const body: any = {
    model: 'nvidia/nemotron-nano-12b-v2-vl',
    messages,
    max_tokens: maxTokens,
    temperature,
  }

  if (guidedJson) {
    body.extra_body = { guided_json: guidedJson }
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM Vision error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── OpenAI Direct ─────────────────────────────────────────────

export async function openaiChat(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
) {
  const {
    model = 'gpt-4o',
    maxTokens = 2048,
    temperature = 0.7,
  } = options

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Google Gemini ─────────────────────────────────────────────

export async function geminiChat(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
) {
  const {
    model = 'gemini-2.0-flash',
    maxTokens = 2048,
    temperature = 0.7,
  } = options

  // Convert from OpenAI message format to Gemini format
  const systemMsg = messages.find(m => m.role === 'system')
  const nonSystemMsgs = messages.filter(m => m.role !== 'system')

  const contents = nonSystemMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  }

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] }
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini error ${response.status}: ${error}`)
  }

  const data = await response.json()

  // Normalize to OpenAI-compatible format
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return {
    choices: [{
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
  }
}

// ─── RESILIENT CHAT — Tries providers in order until one works ──

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openrouter'

const PROVIDER_ORDER: Provider[] = ['anthropic', 'openai', 'gemini', 'openrouter']

/**
 * In-memory provider cooldown (best-effort). On serverless, each instance has its own map;
 * cooldown still reduces hammering within a warm process but is not a global distributed lockout.
 */
const failedProviders: Map<Provider, number> = new Map()
const FAILURE_COOLDOWN = 60_000 // 1 minute before retrying a failed provider

function isProviderAvailable(provider: Provider): boolean {
  const failedAt = failedProviders.get(provider)
  if (!failedAt) return true
  if (Date.now() - failedAt > FAILURE_COOLDOWN) {
    failedProviders.delete(provider)
    return true
  }
  return false
}

function markProviderFailed(provider: Provider) {
  failedProviders.set(provider, Date.now())
  devWarn(`[llm] Provider ${provider} marked as failed, will retry in ${FAILURE_COOLDOWN / 1000}s`)
}

export async function resilientChat(
  messages: Array<{ role: string; content: string }>,
  options: {
    maxTokens?: number
    temperature?: number
    preferredProvider?: Provider
    purpose?: string // for logging
  } = {}
): Promise<{ text: string; provider: Provider }> {
  const {
    maxTokens = 2048,
    temperature = 0.7,
    preferredProvider,
    purpose = 'unknown',
  } = options

  // Build provider order — preferred first, then the rest
  const order = preferredProvider
    ? [preferredProvider, ...PROVIDER_ORDER.filter(p => p !== preferredProvider)]
    : [...PROVIDER_ORDER]

  const errors: string[] = []

  for (const provider of order) {
    if (!isProviderAvailable(provider)) {
      devLog(`[llm] Skipping ${provider} (recently failed)`)
      continue
    }

    // Check if API key exists
    if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) continue
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) continue
    if (provider === 'gemini' && !process.env.GOOGLE_GEMINI_API_KEY) continue
    if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) continue

    try {
      devLog(`[llm] Trying ${provider} for ${purpose}...`)
      let text = ''

      switch (provider) {
        case 'anthropic': {
          // Use OpenRouter to route to Anthropic (avoids direct SDK dependency)
          const result = await openRouterChat(messages, {
            model: 'anthropic/claude-sonnet-4',
            maxTokens,
            temperature,
            route: 'fallback',
          })
          text = result.choices?.[0]?.message?.content || ''
          break
        }
        case 'openai': {
          const result = await openaiChat(messages, {
            model: 'gpt-4o',
            maxTokens,
            temperature,
          })
          text = result.choices?.[0]?.message?.content || ''
          break
        }
        case 'gemini': {
          const result = await geminiChat(messages, {
            model: 'gemini-2.0-flash',
            maxTokens,
            temperature,
          })
          text = result.choices?.[0]?.message?.content || ''
          break
        }
        case 'openrouter': {
          // Use OpenRouter with non-Anthropic model as last resort
          const result = await openRouterChat(messages, {
            model: ['openai/gpt-4o', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
            maxTokens,
            temperature,
            route: 'fallback',
          })
          text = result.choices?.[0]?.message?.content || ''
          break
        }
      }

      if (text) {
        devLog(`[llm] ✓ ${provider} succeeded for ${purpose} (${text.length} chars)`)
        return { text, provider }
      }

      throw new Error('Empty response')
    } catch (err: any) {
      const errMsg = err?.message || String(err)
      devWarn(`[llm] ✗ ${provider} failed for ${purpose}: ${errMsg.substring(0, 100)}`)
      errors.push(`${provider}: ${errMsg.substring(0, 80)}`)

      // Mark as failed if it's a credit/auth error
      if (
        errMsg.includes('credit balance') ||
        errMsg.includes('insufficient') ||
        errMsg.includes('quota') ||
        errMsg.includes('rate_limit') ||
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('429')
      ) {
        markProviderFailed(provider)
      }
    }
  }

  throw new Error(`All providers failed for ${purpose}:\n${errors.join('\n')}`)
}
