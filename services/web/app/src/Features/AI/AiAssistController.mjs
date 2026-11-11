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

const requestSchema = z.object({
  params: z.object({
    Project_id: z.string().regex(/^[0-9a-f]{24}$/),
  }),
  body: z.object({
    action: z.enum([
      'grammar',
      'clarity',
      'formal',
      'shorten',
      'active',
      'summarise',
    ]),
    text: z.string().min(1),
  }),
})

// Very small in-memory rate limiter: a single web instance, a handful of users.
const requestLog = new Map()

function withinRateLimit(userId) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = Settings.ai?.requestsPerMinute || 15
  const recent = (requestLog.get(userId) || []).filter(t => now - t < windowMs)
  if (recent.length >= limit) {
    requestLog.set(userId, recent)
    return false
  }
  recent.push(now)
  requestLog.set(userId, recent)
  return true
}

function stripCodeFence(text) {
  const trimmed = text.trim()
  const fence = /^```(?:latex|tex|text)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed)
  return fence ? fence[1].trim() : trimmed
}

async function callAnthropic({ model, maxTokens, action, text }) {
  if (!Settings.ai?.apiKey) {
    throw new OError('Anthropic API key is not configured')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': Settings.ai.apiKey,
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
          content: `Task: ${ACTIONS[action].instruction}\n\nText to edit:\n<text>\n${text}\n</text>`,
        },
      ],
    }),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new OError('Anthropic request failed', {
      status: response.status,
      body: body.slice(0, 500),
    })
  }
  const data = JSON.parse(body)
  const raw = (data.content || [])
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
    usage: data.usage,
    model: data.model,
  }
}

async function assist(req, res) {
  if (!Settings.ai?.enabled || !Settings.ai?.apiKey) {
    return res.status(503).json({
      message: {
        type: 'error',
        text: 'The AI assistant is not configured on this instance.',
      },
    })
  }

  const { params, body } = parseReq(req, requestSchema)
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res.status(401).json({ message: { type: 'error', text: 'Not logged in.' } })
  }

  const text = body.text
  if (text.length > Settings.ai.maxInputChars) {
    return res.status(400).json({
      message: {
        type: 'error',
        text: `The selection is too long (${text.length} characters). Select up to ${Settings.ai.maxInputChars}.`,
      },
    })
  }
  if (!withinRateLimit(userId)) {
    return res.status(429).json({
      message: {
        type: 'error',
        text: 'Too many AI requests. Wait a minute and try again.',
      },
    })
  }

  const action = ACTIONS[body.action]
  const maxTokens = Math.min(
    Settings.ai.maxOutputTokens,
    Math.max(action.maxTokens, Math.ceil(text.length / 2))
  )

  try {
    const { result, usage, model } = await callAnthropic({
      model: Settings.ai.model,
      maxTokens,
      action: body.action,
      text,
    })
    logger.info(
      {
        userId: String(userId),
        projectId: params.Project_id,
        action: body.action,
        model,
        inputChars: text.length,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      },
      'AI assist request'
    )
    res.json({ result })
  } catch (error) {
    logger.warn(
      { err: error, userId: String(userId), action: body.action, info: error.info },
      'AI assist request failed'
    )
    let userText = 'The AI service could not complete the request. Please try again.'
    if (error.info?.status === 401) {
      userText = 'Anthropic API key is invalid or expired. Check server settings.'
    } else if (error.info?.status === 429) {
      userText = 'Anthropic rate limit reached. Please wait a moment and try again.'
    } else if (error.info?.status === 400) {
      userText = 'Request rejected by AI service. Check that the selected text contains valid input.'
    }
    res.status(502).json({
      message: {
        type: 'error',
        text: userText,
      },
    })
  }
}

export default {
  assist: expressify(assist),
}
