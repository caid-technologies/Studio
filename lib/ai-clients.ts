import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// Claude — Logic Tree Builder + Code Generator
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Nemotron via NVIDIA API — Intent Parser Agent
// OpenAI SDK works with NVIDIA by changing the baseURL
export const nemotronClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY!,
})

// Model constants — single source of truth
export const MODELS = {
  nemotron: 'nvidia/nvidia-nemotron-nano-9b-v2',
  claude: 'claude-sonnet-4-5-20250929',
} as const
