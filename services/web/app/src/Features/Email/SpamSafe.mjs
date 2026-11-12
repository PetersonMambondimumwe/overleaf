import XRegExp from 'xregexp'

// A note about SAFE_REGEX:
// We have to escape the escape characters because XRegExp compiles it first.
// So it's equivalent to `^[\p{L}\p{N}\s\-_!&\(\)]+$]
// \p{L} = any letter in any language
// \p{N} = any kind of numeric character
// https://www.regular-expressions.info/unicode.html#prop is a good resource for
// more obscure regex features. standard RegExp does not support these

const HAN_REGEX = XRegExp('\\p{Han}')
const SAFE_REGEX = XRegExp("^[\\p{L}\\p{N}\\s\\-_!'&\\(\\)]+$")
const EMAIL_REGEX = XRegExp('^[\\p{L}\\p{N}.+_-]+@[\\w.-]+$')
const SPAM_TAGS_REGEX = /qun|jiaqun|jia|jnd/i

function countDigits(str) {
  return (str.match(/\d/g) || []).length
}

const SpamSafe = {
  isSafeUserName(name) {
    if (!name || typeof name !== 'string') {
      return false
    }
    return SAFE_REGEX.test(name) && name.length <= 60
  },

  isSafeProjectName(name) {
    if (!name || typeof name !== 'string') {
      return false
    }
    if (SPAM_TAGS_REGEX.test(name)) {
      return false
    }

    if (HAN_REGEX.test(name)) {
      return SAFE_REGEX.test(name) && name.length <= 30
    }
    return SAFE_REGEX.test(name) && name.length <= 150
  },

  isSafeEmail(email) {
    if (!email || typeof email !== 'string') {
      return false
    }
    if (!EMAIL_REGEX.test(email) || email.length > 100) {
      return false
    }

    // Allow standard email formats including institutional student/staff IDs (e.g. u19094290@tuks.co.za)
    return true
  },

  safeUserName(name, alternative, project) {
    if (project == null) {
      project = false
    }
    if (SpamSafe.isSafeUserName(name)) {
      return name
    }
    return alternative
  },

  safeProjectName(name, alternative) {
    if (SpamSafe.isSafeProjectName(name)) {
      return name
    }
    return alternative
  },

  safeEmail(email, alternative) {
    if (SpamSafe.isSafeEmail(email)) {
      return email
    }
    return alternative
  },
}

export default SpamSafe
