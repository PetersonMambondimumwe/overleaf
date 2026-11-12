import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Settings from '@overleaf/settings'
import { parseReq, z } from '../../infrastructure/Validation.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import { expressify } from '@overleaf/promise-utils'

const ACTIONS = {
  grammar: {
    instruction:
      'Correct grammar, spelling, punctuation and agreement. Make the smallest possible changes; do not rewrite sentences that are already correct.',
    maxTokens: 1024,
  },
  clarity: {
    instruction:
      'Improve clarity and flow while keeping the meaning identical. Prefer shorter, clearer sentences.',
    maxTokens: 1024,
  },
  formal: {
    instruction:
      'Rewrite in a formal academic register suitable for a journal article. Keep the meaning and all technical details.',
    maxTokens: 1024,
  },
  shorten: {
    instruction:
      'Shorten the text by roughly 30% without losing any technical content or citations.',
    maxTokens: 1024,
  },
  active: {
    instruction:
      'Convert passive voice constructions into direct, clear active voice wherever appropriate, keeping all technical terms and citations intact.',
    maxTokens: 1024,
  },
  summarise: {
    instruction:
      'Summarise the text in two to four sentences, keeping the key technical claims.',
    maxTokens: 512,
  },
}

const SYSTEM_PROMPT = [
  'You are an expert academic writing assistant embedded in the Overleaf LaTeX editor.',
  'You receive a fragment of a LaTeX document and a task. Apply the task and return ONLY the revised fragment.',
  'Preserve every LaTeX command, environment, math expression, citation, reference, label, comment and formatting exactly as written.',
  'Return the revised fragment wrapped in <revised> and </revised> tags, and nothing else.',
  'Never repeat the original text and never add labels such as "Corrected:" or explanations.',
  "Keep the author's language and voice.",
].join(' ')

const requestSchema = z
  .object({
    params: z
      .object({
        Project_id: z.string().regex(/^[0-9a-f]{24}$/).optional(),
        project_id: z.string().regex(/^[0-9a-f]{24}$/).optional(),
      })
      .passthrough(),
    body: z
      .object({
        action: z.enum([
          'grammar',
          'clarity',
          'formal',
          'shorten',
          'active',
          'summarise',
        ]),
        text: z.string().min(1),
        _csrf: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough()

// Very small in-memory rate limiter: a single web instance, a handful of users.
const requestLog = new Map()

function withinRateLimit(userId) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = Settings.ai?.requestsPerMinute || 15
  const key = String(userId)
  const recent = (requestLog.get(key) || []).filter(t => now - t < windowMs)
  if (recent.length >= limit) {
    requestLog.set(key, recent)
    return false
  }
  recent.push(now)
  requestLog.set(key, recent)
  return true
}

function stripCodeFence(text) {
  const trimmed = text.trim()
  const fence = /^```(?:latex|tex|text)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed)
  return fence ? fence[1].trim() : trimmed
}

function getCleanApiKey() {
  const raw = Settings.ai?.apiKey || process.env.ANTHROPIC_API_KEY || ''
  return String(raw).trim().replace(/^["']|["']$/g, '')
}

async function callAnthropic({ model, maxTokens, action, text }) {
  const apiKey = getCleanApiKey()
  if (!apiKey) {
    throw new OError('Anthropic API key is not configured')
  }

  const promptAction = ACTIONS[action]
  if (!promptAction) {
    throw new OError(`Invalid action: ${action}`)
  }

  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Task: ${promptAction.instruction}\n\nText to edit:\n<text>\n${text}\n</text>`,
          },
        ],
      }),
    })
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError'
    throw new OError(
      isTimeout
        ? 'Anthropic API request timed out after 60 seconds'
        : `Could not connect to Anthropic API: ${err.message || err}`,
      {
        status: isTimeout ? 504 : 503,
        networkError: true,
        originalError: err.message,
      }
    )
  }

  const rawBody = await response.text()
  let data = null
  try {
    data = JSON.parse(rawBody)
  } catch (e) {
    data = null
  }

  if (!response.ok) {
    const errorDetail =
      data?.error?.message || data?.message || rawBody.slice(0, 300)
    throw new OError(
      `Anthropic request failed (${response.status}): ${errorDetail}`,
      {
        status: response.status,
        detail: errorDetail,
        body: rawBody.slice(0, 500),
      }
    )
  }

  const raw = (data?.content || [])
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
  const tagged = /<revised>([\s\S]*?)<\/revised>/i.exec(raw)
  const result = (tagged ? tagged[1] : raw).trim()
  if (!result) {
    throw new OError('Anthropic returned an empty completion')
  }
  return {
    result: tagged ? result : stripCodeFence(result),
    usage: data?.usage,
    model: data?.model || model,
  }
}

async function assist(req, res) {
  const apiKey = getCleanApiKey()
  if (!Settings.ai?.enabled || !apiKey) {
    return res.status(503).json({
      message: {
        type: 'error',
        text: 'The AI assistant is not configured on this instance. Please configure ANTHROPIC_API_KEY in server environment.',
      },
      error: 'The AI assistant is not configured on this instance.',
    })
  }

  let params
  let body
  try {
    const parsed = parseReq(req, requestSchema, { logOnly: true })
    params = parsed.params || {}
    body = parsed.body || {}
  } catch (err) {
    logger.warn({ err }, 'AI assist request validation failed')
    return res.status(400).json({
      message: {
        type: 'error',
        text: 'Invalid request: ' + (err.message || 'validation failed'),
      },
      error: err.message || 'validation failed',
    })
  }

  const projectId =
    params.Project_id ||
    params.project_id ||
    req.params?.Project_id ||
    req.params?.project_id

  const userId =
    SessionManager.getLoggedInUserId(req.session) ||
    req.user?._id ||
    req.session?.passport?.user
  if (!userId) {
    return res.status(401).json({
      message: { type: 'error', text: 'Not logged in.' },
      error: 'Not logged in.',
    })
  }

  const text = (body.text || '').trim()
  if (!text) {
    return res.status(400).json({
      message: { type: 'error', text: 'Selected text cannot be empty.' },
      error: 'Selected text cannot be empty.',
    })
  }

  const maxInputChars = Settings.ai?.maxInputChars || 6000
  if (text.length > maxInputChars) {
    return res.status(400).json({
      message: {
        type: 'error',
        text: `The selection is too long (${text.length} characters). Select up to ${maxInputChars}.`,
      },
      error: `The selection is too long (${text.length} characters). Select up to ${maxInputChars}.`,
    })
  }

  if (!withinRateLimit(userId)) {
    return res.status(429).json({
      message: {
        type: 'error',
        text: 'Too many AI requests. Wait a minute and try again.',
      },
      error: 'Too many AI requests. Wait a minute and try again.',
    })
  }

  const action = ACTIONS[body.action]
  if (!action) {
    return res.status(400).json({
      message: { type: 'error', text: `Unknown AI action: ${body.action}` },
      error: `Unknown AI action: ${body.action}`,
    })
  }

  const maxTokens = Math.min(
    Settings.ai?.maxOutputTokens || 1024,
    Math.max(action.maxTokens, Math.ceil(text.length / 2))
  )

  const model =
    Settings.ai?.model ||
    process.env.OVERLEAF_AI_MODEL ||
    'claude-3-5-haiku-latest'

  try {
    const { result, usage, model: usedModel } = await callAnthropic({
      model,
      maxTokens,
      action: body.action,
      text,
    })
    logger.info(
      {
        userId: String(userId),
        projectId,
        action: body.action,
        model: usedModel,
        inputChars: text.length,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      },
      'AI assist request completed successfully'
    )
    res.json({ result })
  } catch (error) {
    logger.warn(
      {
        err: error,
        userId: String(userId),
        projectId,
        action: body?.action,
        info: error.info,
      },
      'AI assist request failed'
    )
    const status = error.info?.status || 500
    const detail = error.info?.detail || error.message || ''

    let userText = 'The AI service could not complete the request. Please try again.'
    if (status === 401) {
      userText = detail
        ? `Anthropic authentication failed: ${detail}`
        : 'Anthropic API key is invalid or expired. Check server settings.'
    } else if (status === 429) {
      userText = detail
        ? `Anthropic rate limit reached: ${detail}`
        : 'Anthropic rate limit reached. Please wait a moment and try again.'
    } else if (status === 400 || status === 404) {
      userText = detail
        ? `Anthropic error: ${detail}`
        : 'Request rejected by AI service. Check that the model name and selected text are valid.'
    } else if (error.info?.networkError) {
      userText = detail || 'Network error connecting to Anthropic API.'
    } else if (detail) {
      userText = `AI service error: ${detail}`
    }

    res.status(status >= 400 && status < 600 ? status : 500).json({
      message: {
        type: 'error',
        text: userText,
      },
      error: userText,
    })
  }
}

export default {
  assist: expressify(assist),
}
