import _ from 'lodash'
import settings from '@overleaf/settings'
import moment from 'moment'
import { fontFamily, colors } from './emailStyles.mjs'
import EmailMessageHelper from './EmailMessageHelper.mjs'
import StringHelper from '../Helpers/StringHelper.mjs'
import BaseEmailLayout from './Layouts/BaseEmailLayout.mjs'
import SpamSafe from './SpamSafe.mjs'
import ctaEmailBody from './Bodies/cta-email.mjs'
import NoCTAEmailBody from './Bodies/NoCTAEmailBody.mjs'

function _emailBodyPlainText(content, opts, ctaEmail) {
  let emailBody = `${content.greeting(opts, true)}`
  emailBody += `\r\n\r\n`
  emailBody += `${content.message(opts, true).join('\r\n\r\n')}`

  if (ctaEmail) {
    emailBody += `\r\n\r\n`
    emailBody += `${content.ctaText(opts, true)}: ${content.ctaURL(opts, true)}`
  }

  if (
    content.secondaryMessage(opts, true) &&
    content.secondaryMessage(opts, true).length > 0
  ) {
    emailBody += `\r\n\r\n`
    emailBody += `${content.secondaryMessage(opts, true).join('\r\n\r\n')}`
  }

  emailBody += `\r\n\r\n`
  emailBody += `Regards,\r\nThe ${settings.appName} Team - ${settings.siteUrl}`

  if (
    settings.email &&
    settings.email.template &&
    settings.email.template.customFooter
  ) {
    emailBody += `\r\n\r\n`
    emailBody += settings.email.template.customFooter
  }

  const footerMessage = content.footerMessage(opts, true)
  if (footerMessage) {
    emailBody += `\r\n\r\n`
    emailBody += footerMessage
  }

  return emailBody
}

function ctaTemplate(content) {
  if (
    !content.ctaURL ||
    !content.ctaText ||
    !content.message ||
    !content.subject
  ) {
    throw new Error('missing required CTA email content')
  }
  if (!content.title) {
    content.title = () => {}
  }
  if (!content.greeting) {
    content.greeting = () => 'Hi,'
  }
  if (!content.secondaryMessage) {
    content.secondaryMessage = () => []
  }
  if (!content.gmailGoToAction) {
    content.gmailGoToAction = () => {}
  }
  if (!content.footerMessage) {
    content.footerMessage = () => {}
  }
  return {
    subject(opts) {
      return content.subject(opts)
    },
    layout(opts) {
      return BaseEmailLayout(opts)
    },
    footerMessage(opts) {
      return content.footerMessage(opts)
    },
    plainTextTemplate(opts) {
      return _emailBodyPlainText(content, opts, true)
    },
    compiledTemplate(opts) {
      return ctaEmailBody({
        title: content.title(opts),
        greeting: content.greeting(opts),
        message: content.message(opts),
        secondaryMessage: content.secondaryMessage(opts),
        ctaText: content.ctaText(opts),
        ctaURL: content.ctaURL(opts),
        gmailGoToAction: content.gmailGoToAction(opts),
        StringHelper,
      })
    },
  }
}

function NoCTAEmailTemplate(content) {
  if (content.greeting == null) {
    content.greeting = () => 'Hi,'
  }
  if (!content.message) {
    throw new Error('missing message')
  }
  if (!content.secondaryMessage) {
    content.secondaryMessage = () => []
  }
  if (!content.footerMessage) {
    content.footerMessage = () => {}
  }
  return {
    subject(opts) {
      return content.subject(opts)
    },
    layout(opts) {
      return BaseEmailLayout(opts)
    },
    footerMessage(opts) {
      return content.footerMessage(opts)
    },
    plainTextTemplate(opts) {
      return _emailBodyPlainText(content, opts, false)
    },
    compiledTemplate(opts) {
      return NoCTAEmailBody({
        title:
          typeof content.title === 'function' ? content.title(opts) : undefined,
        greeting: content.greeting(opts),
        highlightedText:
          typeof content.highlightedText === 'function'
            ? content.highlightedText(opts)
            : undefined,
        message: content.message(opts),
        StringHelper,
      })
    },
  }
}

function buildEmail(templateName, opts) {
  const template = templates[templateName]
  opts.body = template.compiledTemplate(opts)
  opts.footerMessage = template.footerMessage
    ? template.footerMessage(opts)
    : ''
  return {
    subject: template.subject(opts),
    html: template.layout(opts),
    text: template.plainTextTemplate && template.plainTextTemplate(opts),
  }
}

const templates = {}

templates.registered = ctaTemplate({
  subject() {
    return `Activate your ${settings.appName} Account`
  },
  message(opts) {
    return [
      `Congratulations, you've just had an account created for you on ${
        settings.appName
      } with the email address '${_.escape(opts.to)}'.`,
      'Click here to set your password and log in:',
    ]
  },
  secondaryMessage() {
    return [
      `If you have any questions or problems, please contact ${settings.adminEmail}`,
    ]
  },
  ctaText() {
    return 'Set password'
  },
  ctaURL(opts) {
    return opts.setNewPasswordUrl
  },
})

templates.canceledSubscription = ctaTemplate({
  subject() {
    return `${settings.appName} thoughts`
  },
  message() {
    return [
      `We are sorry to see you cancelled your ${settings.appName} premium subscription. Would you mind giving us some feedback on what the site is lacking at the moment via this quick survey?`,
    ]
  },
  secondaryMessage() {
    return ['Thank you in advance!']
  },
  ctaText() {
    return 'Leave feedback'
  },
  ctaURL(opts) {
    return 'https://docs.google.com/forms/d/e/1FAIpQLSfa7z_s-cucRRXm70N4jEcSbFsZeb0yuKThHGQL8ySEaQzF0Q/viewform?usp=sf_link'
  },
})

templates.canceledSubscriptionOrAddOn = ctaTemplate({
  subject() {
    return `${settings.appName} thoughts`
  },
  message() {
    return [
      `We are sorry to see you cancelled your ${settings.appName} subscription. Would you mind giving us some feedback on what the site is lacking at the moment via this quick survey?`,
    ]
  },
  secondaryMessage() {
    return ['Thank you in advance!']
  },
  ctaText() {
    return 'Leave feedback'
  },
  ctaURL(opts) {
    return 'https://digitalscience.qualtrics.com/jfe/form/SV_2n2aSlWgvoxXdGK'
  },
})

templates.reactivatedSubscription = ctaTemplate({
  subject() {
    return `Subscription Reactivated - ${settings.appName}`
  },
  message(opts) {
    return ['Your subscription was reactivated successfully.']
  },
  ctaText() {
    return 'View Subscription Dashboard'
  },
  ctaURL(opts) {
    return `${settings.siteUrl}/user/subscription`
  },
})

templates.passwordResetRequested = ctaTemplate({
  subject() {
    return `Password Reset - ${settings.appName}`
  },
  title() {
    return 'Password Reset'
  },
  message() {
    return [`We got a request to reset your ${settings.appName} password.`]
  },
  secondaryMessage() {
    return [
      "If you ignore this message, your password won't be changed.",
      "If you didn't request a password reset, let us know.",
    ]
  },
  ctaText() {
    return 'Reset password'
  },
  ctaURL(opts) {
    return opts.setNewPasswordUrl
  },
})

templates.confirmCode = NoCTAEmailTemplate({
  greeting(opts) {
    return ''
  },
  subject(opts) {
    return `Confirm your email address on Overleaf (${opts.confirmCode})`
  },
  title(opts) {
    return 'Confirm your email address'
  },
  message(opts, isPlainText) {
    const msg = opts.welcomeUser
      ? [
          `Welcome to Overleaf! We're so glad you joined us.`,
          'Use this 6-digit confirmation code to finish your setup.',
        ]
      : ['Use this 6-digit code to confirm your email address.']

    if (isPlainText && opts.confirmCode) {
      msg.push(opts.confirmCode)
    }
    return msg
  },
  highlightedText(opts) {
    return opts.confirmCode
  },
})

function _getInviterDetails(opts) {
  const user = opts.sendingUser || opts.owner || {}
  const firstName = (user.first_name || '').trim()
  const lastName = (user.last_name || '').trim()
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const email = (user.email || '').trim()

  const displayName = fullName || email || 'A colleague'
  return {
    displayName,
    email,
  }
}

templates.projectInvite = {
  subject(opts) {
    const { displayName } = _getInviterDetails(opts)
    const projectName = opts.project?.name
    if (projectName && displayName) {
      return `"${projectName}" — collaboration invitation from ${displayName}`
    }
    if (projectName) {
      return `"${projectName}" — project shared with you on ${settings.appName}`
    }
    if (displayName) {
      return `${displayName} shared a project with you on ${settings.appName}`
    }
    return `An ${settings.appName} project has been shared with you`
  },
  layout(opts) {
    return BaseEmailLayout(opts)
  },
  footerMessage() {
    return ''
  },
  plainTextTemplate(opts) {
    const { displayName, email } = _getInviterDetails(opts)
    const projectName = opts.project?.name || 'Untitled Project'
    const inviterText =
      email && email !== displayName ? `${displayName} (${email})` : displayName

    let body = `PROJECT INVITATION\r\n\r\n`
    body += `Hi,\r\n\r\n`
    body += `${inviterText} has invited you to collaborate on the LaTeX project "${projectName}" on ${settings.appName}.\r\n\r\n`
    body += `Project Name: ${projectName}\r\n`
    body += `Access: Full Edit Access\r\n\r\n`
    body += `To accept this invitation and open the project, visit:\r\n`
    body += `${opts.inviteUrl}\r\n\r\n`
    body += `If you do not have an account yet, you can sign in directly with your institutional Google account.\r\n\r\n`
    body += `Regards,\r\nThe ${settings.appName} Team - ${settings.siteUrl || ''}\r\n`
    return body
  },
  compiledTemplate(opts) {
    const { displayName, email } = _getInviterDetails(opts)
    const projectName = opts.project?.name || 'Untitled Project'
    const inviteUrl = opts.inviteUrl || '#'
    const appName = settings.appName || 'Overleaf'

    const escapedDisplayName = _.escape(displayName)
    const escapedEmail = _.escape(email)
    const escapedProjectName = _.escape(projectName)
    const escapedInviteUrl = _.escape(inviteUrl)
    const escapedAppName = _.escape(appName)

    const inviterHtml =
      escapedEmail && escapedEmail !== escapedDisplayName
        ? `<strong>${escapedDisplayName}</strong> (<a href="mailto:${escapedEmail}" style="color: ${colors.ctaGreen}; text-decoration: none;">${escapedEmail}</a>)`
        : `<strong>${escapedDisplayName}</strong>`

    return `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 9999px; padding: 4px 14px; font-family: ${fontFamily}; font-size: 11px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 0.8px;">
            Project Invitation
          </td>
        </tr>
      </table>

      <h1 style="margin: 0 0 16px 0; font-family: ${fontFamily}; font-size: 24px; font-weight: 700; color: #0f172a; line-height: 32px; letter-spacing: -0.3px;">
        You've been invited to collaborate
      </h1>

      <p style="margin: 0 0 24px 0; font-family: ${fontFamily}; font-size: 15px; color: #334155; line-height: 24px;">
        ${inviterHtml} has invited you to collaborate on a LaTeX project on <strong>${escapedAppName}</strong>.
      </p>

      <!-- Project Card -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 0 0 28px 0;">
        <tr>
          <td style="padding: 20px 24px;">
            <div style="font-family: ${fontFamily}; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.8px; margin-bottom: 8px;">
              Project Title
            </div>
            <div style="font-family: ${fontFamily}; font-size: 18px; font-weight: 700; color: #0f172a; line-height: 26px; word-break: break-word;">
              ${escapedProjectName}
            </div>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #edf2f7; width: 100%;">
              <tr>
                <td style="font-family: ${fontFamily}; font-size: 13px; color: #64748b; line-height: 18px;">
                  Access: <strong style="color: #047857;">Full Edit Access</strong>
                </td>
                <td align="right" style="font-family: ${fontFamily}; font-size: 13px; color: #64748b; line-height: 18px;">
                  Invited by: <strong style="color: #334155;">${escapedDisplayName}</strong>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA Button -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 28px auto; width: 100%;">
        <tr>
          <td align="center">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" bgcolor="${colors.ctaGreen}" style="background-color: ${colors.ctaGreen}; border-radius: 8px;">
                  <a href="${escapedInviteUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: ${fontFamily}; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px; text-align: center; letter-spacing: 0.2px;">
                    Accept Invitation &amp; Open Project &rarr;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Direct URL Fallback -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f1f5f9; border-radius: 8px; margin: 0 0 24px 0;">
        <tr>
          <td style="padding: 14px 18px;">
            <p style="margin: 0 0 6px 0; font-family: ${fontFamily}; font-size: 12px; font-weight: 600; color: #475569;">
              Button not working? Copy and paste this URL into your browser:
            </p>
            <p style="margin: 0; font-family: ${fontFamily}; font-size: 13px; line-height: 18px; word-break: break-all;">
              <a href="${escapedInviteUrl}" style="color: ${colors.ctaGreen}; text-decoration: underline;">${escapedInviteUrl}</a>
            </p>
          </td>
        </tr>
      </table>

      <p style="margin: 0; font-family: ${fontFamily}; font-size: 13px; color: #64748b; line-height: 20px;">
        💡 If you don't have an Overleaf account yet, simply click the button above and log in with your institutional Google account to gain immediate access.
      </p>

      <script type="application/ld+json">
        ${StringHelper.stringifyJsonForScript({
          '@context': 'http://schema.org',
          '@type': 'EmailMessage',
          potentialAction: {
            '@type': 'ViewAction',
            target: inviteUrl,
            url: inviteUrl,
            name: 'Accept Invitation & Open Project',
          },
          description: `Join "${projectName}" on ${appName}`,
        })}
      </script>
    `
  },
}

templates.verifyEmailToJoinTeam = ctaTemplate({
  subject(opts) {
    return `${opts.reminder ? 'Reminder: ' : ''}${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'A collaborator')
    )} has invited you to join a group subscription on ${settings.appName}`
  },
  title(opts) {
    return `${opts.reminder ? 'Reminder: ' : ''}${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'A collaborator')
    )} has invited you to join a group subscription on ${settings.appName}`
  },
  message(opts) {
    return [
      `Please click the button below to join the group subscription and enjoy the benefits of an upgraded ${settings.appName} account.`,
    ]
  },
  ctaText(opts) {
    return 'Join now'
  },
  ctaURL(opts) {
    return opts.acceptInviteUrl
  },
})

templates.verifyEmailToJoinManagedUsers = ctaTemplate({
  subject(opts) {
    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'a collaborator')
    )} to join an ${settings.appName} group subscription.`
  },
  title(opts) {
    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'a collaborator')
    )} to join an ${settings.appName} group subscription.`
  },
  message(opts) {
    return [
      `By joining this group, you'll have access to ${settings.appName} premium features such as additional collaborators, greater maximum compile time, and real-time track changes.`,
    ]
  },
  secondaryMessage(opts, isPlainText) {
    const changeProjectOwnerLink = EmailMessageHelper.displayLink(
      'change project owner',
      `${settings.siteUrl}/learn/how-to/How_to_Transfer_Project_Ownership`,
      isPlainText
    )

    return [
      `<b>User accounts in this group are managed by ${_.escape(
        _formatUserNameAndEmail(opts.admin, 'an admin')
      )}</b>`,
      `If you accept, you’ll transfer the management of your ${settings.appName} account to the owner of the group subscription, who will then have admin rights over your account and control over your stuff.`,
      `If you have personal projects in your ${settings.appName} account that you want to keep separate, that’s not a problem. You can set up another account under a personal email address and change the ownership of your personal projects to the new account. Find out how to ${changeProjectOwnerLink}.`,
    ]
  },
  ctaURL(opts) {
    return opts.acceptInviteUrl
  },
  ctaText(opts) {
    return 'Accept invitation'
  },
  greeting() {
    return ''
  },
})

templates.inviteNewUserToJoinManagedUsers = ctaTemplate({
  subject(opts) {
    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'a collaborator')
    )} to join an ${settings.appName} group subscription.`
  },
  title(opts) {
    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${_.escape(
      _formatUserNameAndEmail(opts.inviter, 'a collaborator')
    )} to join an ${settings.appName} group subscription.`
  },
  message(opts) {
    return ['']
  },
  secondaryMessage(opts) {
    return [
      `<b>User accounts in this group are managed by ${_.escape(
        _formatUserNameAndEmail(opts.admin, 'an admin')
      )}.</b>`,
      `If you accept, the owner of the group subscription will have admin rights over your account and control over your stuff.`,
      `<b>What is ${settings.appName}?</b>`,
      `${settings.appName} is the collaborative online LaTeX editor loved by researchers and technical writers. With thousands of ready-to-use templates and an array of LaTeX learning resources you’ll be up and running in no time.`,
    ]
  },
  ctaURL(opts) {
    return opts.acceptInviteUrl
  },
  ctaText(opts) {
    return 'Accept invitation'
  },
  greeting() {
    return ''
  },
})

templates.groupSSOLinkingInvite = ctaTemplate({
  subject(opts) {
    const subjectPrefix = opts.reminder ? 'Reminder: ' : 'Action required: '
    return `${subjectPrefix}Authenticate your Overleaf account`
  },
  title(opts) {
    const titlePrefix = opts.reminder ? 'Reminder: ' : ''
    return `${titlePrefix}Single sign-on enabled`
  },
  message(opts) {
    return [
      `Hi,
      <div>
        Your group administrator has enabled single sign-on for your group.
      </div>
      </br>
      <div>
        <strong>What does this mean for you?</strong>
      </div>
      </br>
      <div>
        You won't need to remember a separate email address and password to sign in to Overleaf.
        All you need to do is authenticate your existing Overleaf account with your SSO provider.
      </div>
      `,
    ]
  },
  secondaryMessage(opts) {
    return [``]
  },
  ctaURL(opts) {
    return opts.authenticateWithSSO
  },
  ctaText(opts) {
    return 'Authenticate with SSO'
  },
  greeting() {
    return ''
  },
})

templates.groupSSOReauthenticate = ctaTemplate({
  subject(opts) {
    return 'Action required: Reauthenticate your Overleaf account'
  },
  title(opts) {
    return 'Action required: Reauthenticate SSO'
  },
  message(opts) {
    return [
      `Hi,
      <div>
      Single sign-on for your Overleaf group has been updated.
      This means you need to reauthenticate your Overleaf account with your group’s SSO provider.
      </div>
      `,
    ]
  },
  secondaryMessage(opts) {
    if (!opts.isManagedUser) {
      return ['']
    } else {
      const passwordResetUrl = `${settings.siteUrl}/user/password/reset`
      return [
        `If you’re not currently logged in to Overleaf, you'll need to <a href="${passwordResetUrl}">set a new password</a> to reauthenticate.`,
      ]
    }
  },
  ctaURL(opts) {
    return opts.authenticateWithSSO
  },
  ctaText(opts) {
    return 'Reauthenticate now'
  },
  greeting() {
    return ''
  },
})

templates.groupSSODisabled = ctaTemplate({
  subject(opts) {
    if (opts.userIsManaged) {
      return `Action required: Set your Overleaf password`
    } else {
      return 'A change to your Overleaf login options'
    }
  },
  title(opts) {
    return `Single sign-on disabled`
  },
  message(opts, isPlainText) {
    const loginUrl = `${settings.siteUrl}/login`
    let whatDoesThisMeanExplanation = [
      `You can still log in to Overleaf using one of our other <a href="${loginUrl}" style="color: #0F7A06; text-decoration: none;">login options</a> or with your email address and password.`,
      `If you don't have a password, you can set one now.`,
    ]
    if (opts.userIsManaged) {
      whatDoesThisMeanExplanation = [
        'You now need an email address and password to sign in to your Overleaf account.',
      ]
    }

    const message = [
      'Your group administrator has disabled single sign-on for your group.',
      '<br/>',
      '<b>What does this mean for you?</b>',
      ...whatDoesThisMeanExplanation,
    ]

    return message.map(m => {
      return EmailMessageHelper.cleanHTML(m, isPlainText)
    })
  },
  secondaryMessage(opts) {
    return [``]
  },
  ctaURL(opts) {
    return opts.setNewPasswordUrl
  },
  ctaText(opts) {
    return 'Set your new password'
  },
})

templates.surrenderAccountForManagedUsers = ctaTemplate({
  subject(opts) {
    const admin = _.escape(_formatUserNameAndEmail(opts.admin, 'an admin'))

    const toGroupName = opts.groupName ? ` to ${opts.groupName}` : ''

    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${admin} to transfer management of your ${
      settings.appName
    } account${toGroupName}`
  },
  title(opts) {
    const admin = _.escape(_formatUserNameAndEmail(opts.admin, 'an admin'))

    const toGroupName = opts.groupName ? ` to ${opts.groupName}` : ''

    return `${
      opts.reminder ? 'Reminder: ' : ''
    }You’ve been invited by ${admin} to transfer management of your ${
      settings.appName
    } account${toGroupName}`
  },
  message(opts, isPlainText) {
    const admin = _.escape(_formatUserNameAndEmail(opts.admin, 'an admin'))

    const managedUsersLink = EmailMessageHelper.displayLink(
      'user account management',
      `${settings.siteUrl}/learn/how-to/Understanding_Managed_Overleaf_Accounts`,
      isPlainText
    )

    return [
      `Your ${settings.appName} account ${_.escape(
        opts.to
      )} is part of ${admin}'s group. They’ve now enabled ${managedUsersLink} for the group. This will ensure that projects aren’t lost when someone leaves the group.`,
    ]
  },
  secondaryMessage(opts, isPlainText) {
    const transferProjectOwnershipLink = EmailMessageHelper.displayLink(
      'change project owner',
      `${settings.siteUrl}/learn/how-to/How_to_Transfer_Project_Ownership`,
      isPlainText
    )

    return [
      `<b>What does this mean for you?</b>`,
      `If you accept, you’ll transfer the management of your ${settings.appName} account to the owner of the group subscription, who will then have admin rights over your account and control over your stuff.`,
      `If you have personal projects in your ${settings.appName} account that you want to keep separate, that’s not a problem. You can set up another account under a personal email address and change the ownership of your personal projects to the new account. Find out how to ${transferProjectOwnershipLink}.`,
      `If you think this invitation has been sent in error please contact your group administrator.`,
    ]
  },
  ctaURL(opts) {
    return opts.acceptInviteUrl
  },
  ctaText(opts) {
    return 'Accept invitation'
  },
  greeting() {
    return ''
  },
})

templates.domainReverificationFailed = ctaTemplate({
  subject(opts) {
    if (opts.capturedByGroup) {
      return `Action needed: re-verify ${opts.domain} to keep adding users automatically`
    }
    return `${opts.domain} needs re-verifying`
  },
  title(opts) {
    const domain = _.escape(opts.domain)
    if (opts.capturedByGroup) {
      return `Action needed: re-verify ${domain}`
    }
    return `${domain} needs re-verifying`
  },
  greeting(opts, isPlainText) {
    const greeting = opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'
    return EmailMessageHelper.cleanHTML(greeting, isPlainText)
  },
  message(opts) {
    const domain = _.escape(opts.domain)
    if (opts.capturedByGroup) {
      const date = moment(opts.gracePeriodEndDate).format('MMMM D, YYYY')
      return [
        `We weren't able to verify your domain ${domain} during our latest check, so its verification has lapsed.`,
        `Right now, anyone with an email address at ${domain} is added to your group automatically. If the domain isn't re-verified by ${date}, we'll stop adding them. Existing members aren't affected.`,
        `To fix this, check that your DNS TXT record still matches the one shown in your group settings. Once it's in place, we'll re-verify the domain automatically.`,
      ]
    }
    return [
      `We weren't able to verify your domain ${domain} during our latest check, so it's no longer verified.`,
      `To re-verify it, check that your DNS TXT record still matches the one shown in your group settings. Once it's in place, we'll verify it automatically.`,
    ]
  },
  ctaURL(opts) {
    return opts.domainSettingsUrl
  },
  ctaText() {
    return 'Go to group settings'
  },
})

templates.testEmail = ctaTemplate({
  subject() {
    return `A Test Email from ${settings.appName}`
  },
  title() {
    return `A Test Email from ${settings.appName}`
  },
  greeting() {
    return 'Hi,'
  },
  message() {
    return [`This is a test Email from ${settings.appName}`]
  },
  ctaText() {
    return `Open ${settings.appName}`
  },
  ctaURL() {
    return settings.siteUrl
  },
})

templates.ownershipTransferConfirmationPreviousOwner = NoCTAEmailTemplate({
  subject(opts) {
    return `Project ownership transfer - ${settings.appName}`
  },
  title(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'Your project')
    )
    return `${projectName} - Owner change`
  },
  message(opts, isPlainText) {
    const nameAndEmail = _.escape(
      _formatUserNameAndEmail(opts.newOwner, 'a collaborator')
    )
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'your project')
    )
    const projectNameDisplay = isPlainText
      ? projectName
      : `<b>${projectName}</b>`
    return [
      `As per your request, we have made ${nameAndEmail} the owner of ${projectNameDisplay}.`,
      `If you haven't asked to change the owner of ${projectNameDisplay}, please get in touch with us via ${settings.adminEmail}.`,
    ]
  },
})

templates.ownershipTransferConfirmationNewOwner = ctaTemplate({
  subject(opts) {
    return `Project ownership transfer - ${settings.appName}`
  },
  title(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'Your project')
    )
    return `${projectName} - Owner change`
  },
  message(opts, isPlainText) {
    const nameAndEmail = _.escape(
      _formatUserNameAndEmail(opts.previousOwner, 'A collaborator')
    )
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'a project')
    )
    const projectNameEmphasized = isPlainText
      ? projectName
      : `<b>${projectName}</b>`
    return [
      `${nameAndEmail} has made you the owner of ${projectNameEmphasized}. You can now manage ${projectName} sharing settings.`,
    ]
  },
  ctaText(opts) {
    return 'View project'
  },
  ctaURL(opts) {
    const projectUrl = `${
      settings.siteUrl
    }/project/${opts.project._id.toString()}`
    return projectUrl
  },
})

templates.accessRequest = ctaTemplate({
  subject(opts) {
    const requester = _.escape(
      _formatUserNameAndEmail(opts.requester, 'A collaborator')
    )
    const role = opts.privilegeLevel === 'review' ? 'reviewer' : 'editor'
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'your project')
    )
    return `${requester} requested ${role} access to ${projectName} - ${settings.appName}`
  },
  title(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'Your project')
    )
    return `${projectName} - Access request`
  },
  message(opts, isPlainText) {
    const requester = _.escape(
      _formatUserNameAndEmail(opts.requester, 'A collaborator')
    )
    const role = opts.privilegeLevel === 'review' ? 'reviewer' : 'editor'
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'your project')
    )
    const projectNameDisplay = isPlainText
      ? projectName
      : `<b>${projectName}</b>`
    return [
      `${requester} has requested ${role} access to ${projectNameDisplay}.`,
      `Open the share settings to grant access, or dismiss the request if you don’t want to share.`,
    ]
  },
  ctaText(opts) {
    return 'Manage sharing'
  },
  ctaURL(opts) {
    return `${settings.siteUrl}/project/${opts.project._id.toString()}?share=1`
  },
})

templates.accessRequestGranted = ctaTemplate({
  subject(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'a project')
    )
    return `Your access request to ${projectName} was granted - ${settings.appName}`
  },
  title(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'A project')
    )
    return `${projectName} - Access granted`
  },
  message(opts, isPlainText) {
    const role = opts.privilegeLevel === 'review' ? 'reviewer' : 'editor'
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'a project')
    )
    const projectNameDisplay = isPlainText
      ? projectName
      : `<b>${projectName}</b>`
    return [
      `Your access request to ${projectNameDisplay} was granted. You now have ${role} access.`,
    ]
  },
  ctaText(opts) {
    return 'Open project'
  },
  ctaURL(opts) {
    return `${settings.siteUrl}/project/${opts.project._id.toString()}`
  },
})

templates.accessRequestDeclined = NoCTAEmailTemplate({
  subject(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'a project')
    )
    return `Your access request to ${projectName} was declined - ${settings.appName}`
  },
  title(opts) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'A project')
    )
    return `${projectName} - Access request declined`
  },
  message(opts, isPlainText) {
    const projectName = _.escape(
      SpamSafe.safeProjectName(opts.project.name, 'a project')
    )
    const projectNameDisplay = isPlainText
      ? projectName
      : `<b>${projectName}</b>`
    return [
      `Your request for additional access to ${projectNameDisplay} was declined by the project owner. You still have your current access.`,
    ]
  },
})

templates.userOnboardingEmail = NoCTAEmailTemplate({
  subject(opts) {
    return `Getting more out of ${settings.appName}`
  },
  greeting(opts) {
    return ''
  },
  title(opts) {
    return `Getting more out of ${settings.appName}`
  },
  message(opts, isPlainText) {
    const learnLatexLink = EmailMessageHelper.displayLink(
      'Learn LaTeX in 30 minutes',
      `${settings.siteUrl}/learn/latex/Learn_LaTeX_in_30_minutes?utm_source=overleaf&utm_medium=email&utm_campaign=onboarding`,
      isPlainText
    )
    const templatesLinks = EmailMessageHelper.displayLink(
      'Find a beautiful template',
      `${settings.siteUrl}/latex/templates?utm_source=overleaf&utm_medium=email&utm_campaign=onboarding`,
      isPlainText
    )
    const collaboratorsLink = EmailMessageHelper.displayLink(
      'Work with your collaborators',
      `${settings.siteUrl}/learn/how-to/Sharing_a_project?utm_source=overleaf&utm_medium=email&utm_campaign=onboarding`,
      isPlainText
    )
    const siteLink = EmailMessageHelper.displayLink(
      'www.overleaf.com',
      settings.siteUrl,
      isPlainText
    )
    const userSettingsLink = EmailMessageHelper.displayLink(
      'here',
      `${settings.siteUrl}/user/email-preferences`,
      isPlainText
    )
    const onboardingSurveyLink = EmailMessageHelper.displayLink(
      'Join our user feedback program',
      'https://forms.gle/DB7pdk2B1VFQqVVB9',
      isPlainText
    )
    return [
      `Thanks for signing up for ${settings.appName} recently. We hope you've been finding it useful! Here are some key features to help you get the most out of the service:`,
      `${learnLatexLink}: In this tutorial we provide a quick and easy first introduction to LaTeX with no prior knowledge required. By the time you are finished, you will have written your first LaTeX document!`,
      `${templatesLinks}: If you're looking for a template or example to get started, we've a large selection available in our template gallery, including CVs, project reports, journal articles and more.`,
      `${collaboratorsLink}: One of the key features of Overleaf is the ability to share projects and collaborate on them with other users. Find out how to share your projects with your colleagues in this quick how-to guide.`,
      `${onboardingSurveyLink} to help us make Overleaf even better!`,
      'Thanks again for using Overleaf :)',
      `Lee`,
      `Lee Shalit<br />CEO<br />${siteLink}<hr>`,
      `You're receiving this email because you've recently signed up for an Overleaf account. If you've previously subscribed to emails about product offers and company news and events, you can unsubscribe ${userSettingsLink}.`,
    ]
  },
})

templates.securityAlert = NoCTAEmailTemplate({
  subject(opts) {
    return `Overleaf security note: ${opts.action}`
  },
  title(opts) {
    return opts.action.charAt(0).toUpperCase() + opts.action.slice(1)
  },
  message(opts, isPlainText) {
    const dateFormatted = moment().format('dddd D MMMM YYYY')
    const timeFormatted = moment().format('HH:mm')
    const helpLink = EmailMessageHelper.displayLink(
      'quick guide',
      `${settings.siteUrl}/learn/how-to/Keeping_your_account_secure`,
      isPlainText
    )

    const actionDescribed = EmailMessageHelper.cleanHTML(
      opts.actionDescribed,
      isPlainText
    )

    if (!opts.message) {
      opts.message = []
    }
    const message = opts.message.map(m => {
      return EmailMessageHelper.cleanHTML(m, isPlainText)
    })

    return [
      `We are writing to let you know that ${actionDescribed} on ${dateFormatted} at ${timeFormatted} GMT.`,
      ...message,
      `If this was you, you can ignore this email.`,
      `If this was not you, we recommend getting in touch with our support team at ${settings.adminEmail} to report this as potentially suspicious activity on your account.`,
      `We also encourage you to read our ${helpLink} to keeping your ${settings.appName} account safe.`,
    ]
  },
})

const GIT_TOKEN_DOCS_URL =
  'https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens#how-to-generate-authentication-tokens'

templates.gitTokenExpiringSoon = NoCTAEmailTemplate({
  subject() {
    return 'Your Overleaf token is about to expire'
  },
  title() {
    return 'Your token is about to expire'
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'
  },
  message(opts, isPlainText) {
    const settingsLink = EmailMessageHelper.displayLink(
      'account settings',
      `${settings.siteUrl}/user/settings`,
      isPlainText
    )
    const docsLink = EmailMessageHelper.displayLink(
      'our docs',
      GIT_TOKEN_DOCS_URL,
      isPlainText
    )
    return [
      `One of your Git authentication tokens is about to expire. This means you won't be able to use your token to authenticate when performing git operations.`,
      `If you haven't already, you'll need to generate a new token in your ${settingsLink}.`,
      `Take a look at ${docsLink} if you need more help.`,
      'All the best,',
      'Team Overleaf',
    ]
  },
})

templates.gitTokenExpired = NoCTAEmailTemplate({
  subject() {
    return 'Your Overleaf token has expired'
  },
  title() {
    return 'Token expired'
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'
  },
  message(opts, isPlainText) {
    const settingsLink = EmailMessageHelper.displayLink(
      'account settings',
      `${settings.siteUrl}/user/settings`,
      isPlainText
    )
    const docsLink = EmailMessageHelper.displayLink(
      'our docs',
      GIT_TOKEN_DOCS_URL,
      isPlainText
    )
    return [
      `One of your Git authentication tokens has expired. This means you won't be able to use it to authenticate when performing git operations.`,
      `If you haven't already, you'll need to generate a new token in your ${settingsLink}.`,
      `Take a look at ${docsLink} if you need more help.`,
      'All the best,',
      'Team Overleaf',
    ]
  },
})

templates.SAMLDataCleared = ctaTemplate({
  subject(opts) {
    return `Institutional Login No Longer Linked - ${settings.appName}`
  },
  title(opts) {
    return 'Institutional Login No Longer Linked'
  },
  message(opts, isPlainText) {
    return [
      `We're writing to let you know that due to a bug on our end, we've had to temporarily disable logging into your ${settings.appName} through your institution.`,
      `To get it going again, you'll need to relink your institutional email address to your ${settings.appName} account via your settings.`,
    ]
  },
  secondaryMessage() {
    return [
      `If you ordinarily log in to your ${settings.appName} account through your institution, you may need to set or reset your password to regain access to your account first.`,
      'This bug did not affect the security of any accounts, but it may have affected license entitlements for a small number of users. We are sorry for any inconvenience that this may cause for you.',
      `If you have any questions, please get in touch with our support team at ${settings.adminEmail} or by replying to this email.`,
    ]
  },
  ctaText(opts) {
    return 'Update my emails and affiliations'
  },
  ctaURL(opts) {
    return `${settings.siteUrl}/user/settings`
  },
})

templates.welcomeWithoutCTA = NoCTAEmailTemplate({
  subject() {
    return `Welcome to ${settings.appName}`
  },
  title() {
    return `Welcome to ${settings.appName}`
  },
  greeting() {
    return 'Hi,'
  },
  message(opts, isPlainText) {
    const logInAgainDisplay = EmailMessageHelper.displayLink(
      'log in again',
      `${settings.siteUrl}/login`,
      isPlainText
    )
    const helpGuidesDisplay = EmailMessageHelper.displayLink(
      'Help Guides',
      `${settings.siteUrl}/learn`,
      isPlainText
    )
    const templatesDisplay = EmailMessageHelper.displayLink(
      'Templates',
      `${settings.siteUrl}/templates`,
      isPlainText
    )

    return [
      `Thanks for signing up to ${settings.appName}! If you ever get lost, you can ${logInAgainDisplay} with the email address '${opts.to}'.`,
      `If you're new to LaTeX, take a look at our ${helpGuidesDisplay} and ${templatesDisplay}.`,
      `PS. We love talking to our users about ${settings.appName}. Reply to this email to get in touch with us directly, whatever the reason. Questions, comments, problems, suggestions, all welcome!`,
    ]
  },
})

templates.removeGroupMember = NoCTAEmailTemplate({
  subject(opts) {
    return `Your ${settings.appName} account has been removed from ${opts.adminName}’s group`
  },
  title(opts) {
    return `Your ${settings.appName} account has been removed from ${opts.adminName}’s group`
  },
  greeting() {
    return ''
  },
  message() {
    const passwordResetUrl = `${settings.siteUrl}/user/password/reset`

    return [
      'Don’t worry, your account and projects are still accessible. But there are a few changes to be aware of:',
      '<ul>' +
        `<li>Your account will have reverted to a free ${settings.appName} plan.</li>`,
      `<li>Any project collaborators have been set to read-only (you can invite one collaborator per project on the free plan).</li>`,
      `<li>If you previously logged in via SSO, you’ll need to <a href="${passwordResetUrl}">set a password</a> to access your account.</li>` +
        '</ul>',
      `If you think this has been done in error, please contact your group admin.`,
      `Thanks!`,
      `Team ${settings.appName}`,
    ]
  },
})

templates.taxExemptCertificateRequired = NoCTAEmailTemplate({
  subject(opts) {
    return `Action required: Tax exemption verification for Overleaf [${opts.ein}]`
  },
  title() {
    return 'Action required: Tax exemption verification'
  },
  greeting() {
    return ''
  },
  message(opts) {
    return [
      'Thanks for letting us know your organization is tax exempt. To confirm this, we need some additional verification.',
      'Please reply to this email with one of the following documents attached:',
      '<ul>',
      '<li>Your IRS determination letter (for non-profits and similar organizations)</li>',
      '<li>Your state resale or exemption certificate</li>',
      '</ul>',
      `These should match the EIN you provided: ${opts.ein}.`,
      'If you have any questions, let us know by replying to this email.',
      '<br/>',
      'Best wishes,',
      'Team Overleaf',
      '<br/>',
      `Our reference: ${opts.stripeCustomerId}`,
    ]
  },
})

function taxIdInvalidTemplate({ noun, descriptor }) {
  return ctaTemplate({
    subject() {
      return `Action required: Update your ${noun} on ${settings.appName}`
    },
    title() {
      return `Action required: Update your ${noun}`
    },
    greeting() {
      return 'Hi,'
    },
    message() {
      return [
        `We're writing to let you know that the ${descriptor} you entered did not validate successfully.`,
        `Please update your ${noun} on your billing information page:`,
      ]
    },
    secondaryMessage() {
      return [
        `If you do not update your ${noun}, your next invoice may be subject to additional taxes.`,
        'If you require a new invoice, please let us know by replying to this email.',
      ]
    },
    ctaText() {
      return `Update ${noun}`
    },
    ctaURL() {
      return `${settings.siteUrl}/user/subscription`
    },
    footerMessage(opts) {
      return `Our reference: ${opts.stripeCustomerId}`
    },
  })
}

templates.taxIdInvalidVat = taxIdInvalidTemplate({
  noun: 'VAT number',
  descriptor: 'VAT number',
})

templates.taxIdInvalidNonVat = taxIdInvalidTemplate({
  noun: 'tax ID',
  descriptor: 'tax identifier',
})

templates.groupMemberLimitWarning = ctaTemplate({
  subject(opts) {
    return `Action needed: your Overleaf group is nearly out of licenses`
  },
  title(opts) {
    return `Action needed: your Overleaf group is nearly out of licenses`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message(opts) {
    return [
      `Your Overleaf group <b>${opts.groupName}</b> is close to its license limit.`,
      `<b>${opts.currentMembers} of ${opts.membersLimit} licenses are in use (${opts.remainingSeats} remaining).</b>`,
      'Because domain capture is enabled, users from your domain can join automatically via SSO.' +
        '<br/>' +
        '<b>Once all licenses are used, new users won’t be able to join.</b>',
      '<b>What you can do now:</b>',
      '<ul>' +
        (opts.canUseFlexibleLicensing
          ? '<li>Add more licenses, or</li>'
          : '<li>Contact us to add more licenses, or</li>') +
        '<li>Remove inactive users to free up licenses</li>' +
        '</ul>',
    ]
  },
  ctaText(opts) {
    return opts.canUseFlexibleLicensing ? 'Add licenses' : 'Contact us'
  },
  ctaURL(opts) {
    return opts.canUseFlexibleLicensing
      ? `${settings.siteUrl}/user/subscription/group/add-users`
      : `${settings.siteUrl}/contact`
  },
})

templates.groupMemberLimitReached = ctaTemplate({
  subject(opts) {
    return `Action needed: your Overleaf group is out of licenses`
  },
  title(opts) {
    return `Action needed: your Overleaf group is out of licenses`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message(opts) {
    return [
      `Your Overleaf group <b>${opts.groupName}</b> has used all ${opts.membersLimit} of its licenses.`,
      'Because domain capture is enabled, new users from your domain can no longer ' +
        'join automatically.',
      '<b>What you can do now:</b>',
      '<ul>' +
        (opts.canUseFlexibleLicensing
          ? '<li>Add more licenses, or</li>'
          : '<li>Contact us to add more licenses, or</li>') +
        '<li>Remove inactive users to free up licenses</li>' +
        '</ul>',
    ]
  },
  ctaText(opts) {
    return opts.canUseFlexibleLicensing ? 'Add licenses' : 'Contact us'
  },
  ctaURL(opts) {
    return opts.canUseFlexibleLicensing
      ? `${settings.siteUrl}/user/subscription/group/add-users`
      : `${settings.siteUrl}/contact`
  },
})

templates.groupAiFeaturesDisabled = NoCTAEmailTemplate({
  subject() {
    return `AI features have been disabled for your ${settings.appName} group`
  },
  title() {
    return `AI features disabled`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message() {
    return [
      `Your organization has disabled AI features for your ${settings.appName} group. This means you won't see AI Assistant or other ${settings.appName} AI tools in the editor.`,
      `If you have questions about this change, please contact your group administrator.`,
    ]
  },
})

templates.groupAiFeaturesEnabled = NoCTAEmailTemplate({
  subject() {
    return `AI features have been enabled for your ${settings.appName} group`
  },
  title() {
    return `AI features enabled`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message() {
    return [
      `Your organization has enabled AI features for your ${settings.appName} group. You now have access to AI Assistant and other ${settings.appName} AI tools in the editor.`,
      `If you have questions about this change, please contact your group administrator.`,
    ]
  },
})

templates.groupSharedWorkspaceDisabledForOwner = ctaTemplate({
  subject() {
    return `Your shared workspace has been disabled`
  },
  title() {
    return `Your projects are back in your personal list.`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message(opts) {
    const groupName = _.escape(opts.groupName)
    return [
      `Your group administrator has disabled the shared workspace for ${groupName}.`,
      `Projects you owned in the workspace have been returned to your personal projects list. They’re no longer visible to the whole group — only collaborators you’d actively shared them with still have access.`,
      `You don’t need to do anything. You can find your projects in your projects list as usual.`,
    ]
  },
  ctaText() {
    return 'Open your projects'
  },
  ctaURL() {
    return `${settings.siteUrl}/project`
  },
})

templates.groupSharedWorkspaceDisabledForMember = ctaTemplate({
  subject() {
    return `Your group's shared workspace has been disabled`
  },
  title() {
    return `Here's what's changed for your group.`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message(opts) {
    const groupName = _.escape(opts.groupName)
    return [
      `Your group administrator has disabled the shared workspace for ${groupName}.`,
      `Projects that were in the shared workspace have been returned to their owners. You’ll still have access to any projects their owners have shared with you directly — but projects you could only see through the shared workspace may no longer be visible.`,
      `You don’t need to do anything. If you’re not sure whether you still have access to a project, check with the project owner or your group administrator.`,
    ]
  },
  ctaText() {
    return 'Open your projects'
  },
  ctaURL() {
    return `${settings.siteUrl}/project`
  },
})

templates.groupSharedWorkspaceDisabledForAdmin = ctaTemplate({
  subject(opts) {
    return `Shared workspace disabled for ${opts.groupName}`
  },
  title() {
    return `Here's a summary of what changed for your group.`
  },
  greeting(opts) {
    return opts.firstName ? `Hi ${opts.firstName},` : 'Hi there,'
  },
  message(opts) {
    const groupName = _.escape(opts.groupName)
    return [
      `You’ve disabled the shared workspace for ${groupName}. Here's a summary of what happened.`,
      '<ul>' +
        '<li>Projects in the workspace have been returned to their owners and are no longer visible to the whole group.</li>' +
        '<li>Each project is now shared only with the collaborators the owner had already added.</li>' +
        '<li>Group members have been notified of the change.</li>' +
        '</ul>',
      `No further action is needed on your part.`,
    ]
  },
  ctaText() {
    return 'Open your projects'
  },
  ctaURL() {
    return `${settings.siteUrl}/project`
  },
})

templates.groupDomainCapturedByGroupChanged = ctaTemplate({
  subject(opts) {
    return opts.domainCapturedByGroup
      ? `Domain capture now active for ${opts.domain}`
      : `Domain capture now inactive for ${opts.domain}`
  },
  title(opts) {
    return opts.domainCapturedByGroup
      ? `Domain capture is active for ${_.escape(opts.domain)}`
      : `Domain capture is inactive for ${_.escape(opts.domain)}`
  },
  greeting(opts, isPlainText) {
    const greeting = opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'
    return EmailMessageHelper.cleanHTML(greeting, isPlainText)
  },
  message(opts) {
    if (opts.domainCapturedByGroup) {
      return [
        `Users with a <b>${_.escape(opts.domain)}</b> email address on their account will be able to join your group through domain capture.`,
      ]
    }
    return [
      `Users with a <b>${_.escape(opts.domain)}</b> email address on their account will no longer be able to join your group through domain capture. Anyone already in your group is unaffected.`,
      `If you didn't expect this or want to re-enable domain capture, please contact ${settings.adminEmail}.`,
    ]
  },
  ctaText() {
    return 'Manage domains'
  },
  ctaURL(opts) {
    return `${settings.siteUrl}/manage/groups/${opts.groupId}/settings`
  },
})

templates.domainVerifiedForGroup = NoCTAEmailTemplate({
  subject(opts) {
    if (opts.capturedByGroup) {
      return `Your domain is verified`
    } else {
      return 'Your domain is verified — ready to capture?'
    }
  },
  greeting(opts, isPlainText) {
    const greeting = opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'
    return EmailMessageHelper.cleanHTML(greeting, isPlainText)
  },
  message(opts, isPlainText) {
    const message = [
      `We've verified <b>${_.escape(opts.domain)}</b> for your Overleaf group.`,
    ]

    if (opts.capturedByGroup) {
      message.push(`Your group will continue capturing users with this domain.`)
    } else {
      message.push(
        `To complete the capture, reply to this email and we'll take it from there.`,
        `Once captured, existing Overleaf users with a <b>${_.escape(opts.domain)}</b> address will be invited to join your group. Until they accept, they won't be able to access Overleaf. New users who sign up with <b>${_.escape(opts.domain)}</b> will be added to your group automatically.`,
        `You'll receive a confirmation email once the capture is active.`
      )
    }

    return message.map(m => {
      return EmailMessageHelper.cleanHTML(m, isPlainText)
    })
  },
})

function _formatUserNameAndEmail(user, placeholder) {
  if (user.first_name && user.last_name) {
    const fullName = `${user.first_name} ${user.last_name}`
    if (SpamSafe.isSafeUserName(fullName)) {
      if (SpamSafe.isSafeEmail(user.email)) {
        return `${fullName} (${user.email})`
      } else {
        return fullName
      }
    }
  }
  return SpamSafe.safeEmail(user.email, placeholder)
}

export default {
  templates,
  ctaTemplate,
  NoCTAEmailTemplate,
  buildEmail,
}
