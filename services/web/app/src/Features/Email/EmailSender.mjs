import { callbackify } from 'node:util'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import nodemailer from 'nodemailer'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import OError from '@overleaf/o-error'
import { RateLimiter } from '../../infrastructure/RateLimiter.mjs'
import _ from 'lodash'

export default {
  sendEmail: callbackify(sendEmail),
  promises: {
    sendEmail,
  },
}

let cachedClient = null

const rateLimiter = new RateLimiter('send_email', {
  points: 100,
  duration: 3 * 60 * 60,
})

function getClient() {
  if (cachedClient) {
    return cachedClient
  }

  const EMAIL_SETTINGS = Settings.email || {}
  const rawPass =
    process.env.GOOGLE_APP_PASSWORD ||
    process.env.OVERLEAF_EMAIL_SMTP_PASS ||
    'vkaxafpbkzmzldny'
  const smtpPass = rawPass ? rawPass.replace(/\s+/g, '') : undefined
  const smtpUser =
    process.env.OVERLEAF_EMAIL_SMTP_USER ||
    process.env.GMAIL_USER ||
    process.env.OVERLEAF_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    'u19094290@tuks.co.za'

  if (EMAIL_SETTINGS.parameters) {
    const emailParameters = EMAIL_SETTINGS.parameters
    if (emailParameters.AWSAccessKeyID || EMAIL_SETTINGS.driver === 'ses') {
      logger.debug('using aws ses for email')
      const sesClient = new SESv2Client({
        region: emailParameters.region,
        credentials: {
          accessKeyId: emailParameters.AWSAccessKeyID,
          secretAccessKey: emailParameters.AWSSecretKey,
        },
      })
      cachedClient = nodemailer.createTransport({
        SES: { sesClient, SendEmailCommand },
      })
    } else if (emailParameters.sendgridApiKey) {
      throw new OError(
        'sendgridApiKey configuration option is deprecated, use SMTP instead'
      )
    } else if (emailParameters.MandrillApiKey) {
      throw new OError(
        'MandrillApiKey configuration option is deprecated, use SMTP instead'
      )
    } else {
      logger.info(
        {
          host: emailParameters.host,
          port: emailParameters.port,
          user: emailParameters.auth?.user,
        },
        'using smtp for email'
      )
      const smtp = _.pick(
        emailParameters,
        'host',
        'port',
        'secure',
        'auth',
        'ignoreTLS',
        'tls',
        'logger',
        'name'
      )
      cachedClient = nodemailer.createTransport(smtp)
    }
  } else if (smtpPass) {
    logger.info(
      { host: 'smtp.gmail.com', port: 465, user: smtpUser },
      'using direct Gmail SMTP transport'
    )
    cachedClient = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  } else {
    logger.warn(
      'Email transport and/or parameters not defined. No emails will be sent.'
    )
    return {
      async sendMail(options) {
        logger.info({ options }, 'Would send email if enabled.')
      },
    }
  }

  return cachedClient
}

async function sendEmail(options, emailType) {
  try {
    const EMAIL_SETTINGS = Settings.email || {}
    const smtpUser =
      process.env.OVERLEAF_EMAIL_SMTP_USER ||
      process.env.GMAIL_USER ||
      process.env.OVERLEAF_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      'u19094290@tuks.co.za'

    const fromAddress =
      options.from ||
      EMAIL_SETTINGS.fromAddress ||
      process.env.OVERLEAF_EMAIL_FROM_ADDRESS ||
      `"Overleaf Campus Portal" <${smtpUser}>`

    const replyTo =
      options.replyTo ||
      EMAIL_SETTINGS.replyToAddress ||
      EMAIL_SETTINGS.replyTo ||
      process.env.OVERLEAF_EMAIL_REPLY_TO ||
      smtpUser

    const canContinue = await checkCanSendEmail(options)
    metrics.inc('email_status', {
      status: canContinue ? 'sent' : 'rate_limited',
      path: emailType,
    })
    if (!canContinue) {
      logger.debug(
        {
          sendingUserId: options.sendingUser_id,
          to: options.to,
          subject: options.subject,
          canContinue,
        },
        'rate limit hit for sending email, not sending'
      )
      throw new OError('rate limit hit sending email')
    }
    metrics.inc('email')
    const sendMailOptions = {
      to: options.to,
      from: fromAddress,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo,
      socketTimeout: 30 * 1000,
    }
    if (options.cc) {
      sendMailOptions.cc = options.cc
    }
    if (EMAIL_SETTINGS.textEncoding != null) {
      sendMailOptions.textEncoding = EMAIL_SETTINGS.textEncoding
    }
    if (options.category) {
      // category support for sendgrid
      sendMailOptions.headers = {
        'X-SMTPAPI': JSON.stringify({ category: options.category }),
      }
    }

    const transport = getClient()
    logger.info(
      { to: options.to, subject: options.subject, from: fromAddress },
      'Sending outgoing email via transport'
    )
    const result = await transport.sendMail(sendMailOptions)
    logger.info(
      { to: options.to, messageId: result?.messageId || result },
      'Email successfully sent'
    )
    return result
  } catch (err) {
    logger.error({ err, options }, 'error sending email in EmailSender')
    throw new OError('error sending message').withCause(err)
  }
}

async function checkCanSendEmail(options) {
  if (options.sendingUser_id == null) {
    // email not sent from user, not rate limited
    return true
  }
  try {
    await rateLimiter.consume(options.sendingUser_id, 1, { method: 'userId' })
  } catch (err) {
    if (err instanceof Error) {
      logger.warn({ err }, 'Rate limiter encountered error, allowing email to proceed')
      return true
    } else {
      return false
    }
  }
  return true
}

