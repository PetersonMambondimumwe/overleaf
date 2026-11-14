import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Settings from '@overleaf/settings'
import { parseReq, z } from '../../infrastructure/Validation.mjs'
import AuthenticationController from './AuthenticationController.mjs'
import UserGetter from '../User/UserGetter.mjs'
import UserCreator from '../User/UserCreator.mjs'
import { User } from '../../models/User.mjs'

const JWKS_TTL_MS = 60 * 60 * 1000
const CLOCK_SKEW_SECONDS = 60
const jwksCache = new Map()

const loginSchema = z.object({
  body: z.object({
    token: z.string().min(20).max(8192),
  }),
})

function decodeJwtSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

/**
 * Clerk publishable keys embed the Frontend API host: `pk_test_<base64(host$)>`
 * for the classic format, or the host itself in newer keys. The value is public
 * (it ships to the browser), so deriving the host here is safe.
 */
export function frontendApiFromPublishableKey(key) {
  if (!key) return null
  const match = /^pk_(?:test|live)_(.+)$/.exec(key)
  if (!match) return null
  const raw = match[1]
  const candidates = []
  try {
    const decoded = Buffer.from(raw, 'base64')
      .toString('utf8')
      .replace(/\$$/, '')
      .trim()
    candidates.push(decoded)
  } catch {
    // not base64 -- fall through to the raw value
  }
  candidates.push(raw.replace(/\$$/, '').trim())
  return (
    candidates.find(
      candidate =>
        /^[a-z0-9.-]+$/i.test(candidate) &&
        candidate.includes('.') &&
        candidate.length < 255
    ) || null
  )
}

async function getJwks(issuer) {
  const cached = jwksCache.get(issuer)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys
  }
  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new OError('Failed to fetch Clerk JWKS', {
      issuer,
      status: response.status,
    })
  }
  const { keys } = await response.json()
  if (!Array.isArray(keys)) {
    throw new OError('Malformed Clerk JWKS response', { issuer })
  }
  jwksCache.set(issuer, { keys, fetchedAt: Date.now() })
  return keys
}

async function verifySessionToken(token) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new OError('Malformed Clerk session token')
  }
  let header, payload
  try {
    header = decodeJwtSegment(parts[0])
    payload = decodeJwtSegment(parts[1])
  } catch (error) {
    throw new OError('Malformed Clerk session token').withCause(error)
  }
  if (header.alg !== 'RS256') {
    throw new OError('Unexpected Clerk token algorithm', { alg: header.alg })
  }
  const issuer = payload.iss
  if (
    typeof issuer !== 'string' ||
    !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(issuer)
  ) {
    throw new OError('Unexpected Clerk token issuer', { issuer })
  }

  const keys = await getJwks(issuer)
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA')
  if (!jwk) {
    throw new OError('Clerk signing key not found', { kid: header.kid })
  }
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  )
  if (!valid) {
    throw new OError('Invalid Clerk session token signature')
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SECONDS) {
    throw new OError('Clerk session token has expired')
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    throw new OError('Clerk session token is not valid yet')
  }
  if (!payload.sub) {
    throw new OError('Clerk session token has no subject')
  }
  return payload
}

async function fetchClerkUser(userId) {
  const secretKey = Settings.clerk?.secretKey
  if (!secretKey) {
    throw new OError('Clerk secret key is not configured')
  }
  const response = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!response.ok) {
    throw new OError('Failed to load Clerk user', {
      userId,
      status: response.status,
    })
  }
  return response.json()
}

function primaryEmail(clerkUser) {
  const addresses = clerkUser.email_addresses || []
  const primary =
    addresses.find(
      address => address.id === clerkUser.primary_email_address_id
    ) || addresses[0]
  if (!primary?.email_address) return null
  return {
    email: primary.email_address.trim().toLowerCase(),
    verified: primary.verification?.status === 'verified',
  }
}

function isAllowedEmailDomain(email) {
  const domains = Settings.clerk?.allowedEmailDomains || []
  if (domains.length === 0) return true
  const domain = email.split('@').pop()
  return domains.includes(domain)
}

async function findOrCreateUser({ email, firstName, lastName, clerkUserId }) {
  let user = await UserGetter.promises.getUserByAnyEmail(email)
  if (!user) {
    user = await UserCreator.promises.createNewUser(
      {
        email,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        analyticsId: crypto.randomUUID(),
      },
      { confirmedAt: new Date() }
    )
    logger.info({ email, userId: user._id }, 'created user from Clerk sign-in')
  }
  if (user.suspended) {
    const error = new OError('Account suspended')
    error.status = 403
    error.publicMessage = 'Your Overleaf account is suspended.'
    throw error
  }
  const adminEmail = (
    Settings.adminEmail ||
    process.env.OVERLEAF_ADMIN_EMAIL ||
    'u19094290@tuks.co.za'
  )
    .trim()
    .toLowerCase()
  const isAdmin = email.trim().toLowerCase() === adminEmail

  const updateFields = { holdingAccount: false }
  if (isAdmin) {
    updateFields.isAdmin = true
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: updateFields,
      $addToSet: {
        thirdPartyIdentifiers: {
          providerId: 'clerk',
          externalUserId: clerkUserId,
        },
      },
    }
  ).exec()
  if (isAdmin) {
    user.isAdmin = true
  }
  return user
}

async function login(req, res) {
  try {
    const { body } = parseReq(req, loginSchema)
    const claims = await verifySessionToken(body.token)
    const clerkUser = await fetchClerkUser(claims.sub)
    const emailInfo = primaryEmail(clerkUser)
    if (!emailInfo) {
      return res.status(403).json({
        message: {
          type: 'error',
          text: 'Your Google account has no email address.',
        },
      })
    }
    if (!emailInfo.verified) {
      return res.status(403).json({
        message: {
          type: 'error',
          text: 'Your Google email address is not verified.',
        },
      })
    }
    if (!isAllowedEmailDomain(emailInfo.email)) {
      return res.status(403).json({
        message: {
          type: 'error',
          text: `Only ${Settings.clerk.allowedEmailDomains
            .map(domain => `@${domain}`)
            .join(', ')} accounts can sign in to this Overleaf instance.`,
        },
      })
    }

    const user = await findOrCreateUser({
      email: emailInfo.email,
      firstName: clerkUser.first_name,
      lastName: clerkUser.last_name,
      clerkUserId: claims.sub,
    })

    AuthenticationController.setAuditInfo(req, { method: 'Google (Clerk)' })
    await AuthenticationController.promises.finishLogin(user, req, res)
  } catch (error) {
    if (error?.name === 'ZodError' || /Validation failed/.test(error?.message)) {
      return res.status(400).json({
        message: { type: 'error', text: 'Malformed sign-in request.' },
      })
    }
    if (error?.status === 403) {
      return res
        .status(403)
        .json({ message: { type: 'error', text: error.publicMessage } })
    }
    logger.err({ err: error }, 'Clerk sign-in failed')
    res.status(401).json({
      message: {
        type: 'error',
        text: 'Could not verify your Google sign-in. Please try again.',
      },
    })
  }
}

export default {
  login,
  frontendApiFromPublishableKey,
}
