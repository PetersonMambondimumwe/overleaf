import { callbackify } from 'node:util'
import logger from '@overleaf/logger'
import { Project } from '../../models/Project.mjs'
import EmailHandler from '../Email/EmailHandler.mjs'
import Settings from '@overleaf/settings'

const CollaboratorsEmailHandler = {
  _buildInviteUrl(project, invite) {
    const rawUrl =
      Settings.siteUrl ||
      process.env.OVERLEAF_SITE_URL ||
      process.env.SITE_URL ||
      'http://localhost'
    const baseUrl = rawUrl.replace(/\/+$/, '')
    return `${baseUrl}/project/${project._id}/invite/token/${invite.token}`
  },

  async notifyUserOfProjectInvite(projectId, email, invite, sendingUser) {
    logger.info(
      {
        projectId,
        toEmail: email,
        sendingUserId: sendingUser?._id,
        inviteToken: invite?.token,
      },
      'CollaboratorsEmailHandler: notifying user of project invite'
    )

    // eslint-disable-next-line no-restricted-syntax
    const project = await Project.findOne({ _id: projectId })
      .select('name owner_ref')
      .populate('owner_ref')
      .exec()

    if (!project) {
      logger.error(
        { projectId, email },
        'CollaboratorsEmailHandler: project not found for invite notification'
      )
      return
    }

    const inviteUrl = CollaboratorsEmailHandler._buildInviteUrl(project, invite)
    const emailOptions = {
      to: email,
      replyTo:
        sendingUser?.email ||
        project?.owner_ref?.email ||
        Settings.email?.replyTo ||
        process.env.OVERLEAF_EMAIL_REPLY_TO ||
        process.env.OVERLEAF_ADMIN_EMAIL ||
        'u19094290@tuks.co.za',
      project: {
        name: project.name,
      },
      inviteUrl,
      owner: project.owner_ref,
      sendingUser,
      sendingUser_id: sendingUser?._id,
    }

    logger.info(
      { to: email, inviteUrl, projectName: project.name },
      'CollaboratorsEmailHandler: dispatching sendEmail(projectInvite)'
    )

    await EmailHandler.promises.sendEmail('projectInvite', emailOptions)
  },
}

export default {
  promises: CollaboratorsEmailHandler,
  notifyUserOfProjectInvite: callbackify(
    CollaboratorsEmailHandler.notifyUserOfProjectInvite
  ),
  _buildInviteUrl: CollaboratorsEmailHandler._buildInviteUrl,
}
