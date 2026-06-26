export const startTime = new Date()

export const userIdCache = {}

export const URL_REGEXP = /(?<!\[(.*?)\]\()https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?/g
export const URL_REGEXP_FULL = /(?<!\[(.*?)\]\()(?<!<)https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?(?!>)/g

export let sharp = undefined
export let markdown_template = undefined
export let TmplPkg = undefined

export function initSharp(val) { sharp = val }
export function initMarkdownTemplate(val) { markdown_template = val }
export function initTmplPkg(val) { TmplPkg = val }

export const PER_BOT_CONFIG_KEYS = ['toQRCode', 'toCallback', 'toBotUpload', 'forceSilk', 'toQQUin', 'toImg', 'callStats', 'userStats']

export const CLAW_DEFAULT_CFG = {
  channel_type: 'qqbot',
  channel_ver: '1.7.1',
  claw_type: 'openclaw',
  claw_ver: '2026.3.24',
  require_mention: 'mention',
  group_policy: 'open',
  mention_patterns: '机器人, 助手',
  online_state: 'offline'
}
