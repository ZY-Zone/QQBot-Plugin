import { config } from '../Model/index.js'
import { CLAW_DEFAULT_CFG } from '../utils/constants.js'

function ensureClawConfig(adapter, selfId = '') {
  if (!config.claw || typeof config.claw !== 'object') config.claw = {}
  if (!config.claw.bots || typeof config.claw.bots !== 'object') config.claw.bots = {}
  const key = selfId || 'default'
  if (!config.claw.bots[key] || typeof config.claw.bots[key] !== 'object') config.claw.bots[key] = {}
  const claw = config.claw.bots[key]
  if (typeof claw.online !== 'boolean') claw.online = false
  if (typeof claw.code !== 'string') claw.code = String(claw.code ?? '0')
  if (!claw.json || typeof claw.json !== 'object' || Array.isArray(claw.json)) claw.json = {}
  return claw
}

function getClawCfg(adapter, selfId = '') {
  const claw = ensureClawConfig(adapter, selfId)
  return { ...CLAW_DEFAULT_CFG, ...claw.json, online_state: claw.online ? 'online' : 'offline' }
}

export async function _makeClawConfigInteraction(adapter, id, event) {
  const type = Number(event.data?.type)
  const claw = ensureClawConfig(adapter, id)
  const noticeData = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'notice',
    notice_type: 'claw_cfg',
    sub_type: type === 2002 ? 'update' : 'query',
    notice_id: event.notice_id,
    group_id: event.group_id ? `${id}${adapter.sep}${event.group_id}` : '',
    user_id: event.operator_id || event.user_id || '',
    interaction_type: type,
    resolved: event.data?.resolved || {}
  }
  Bot.em(`${noticeData.post_type}.${noticeData.notice_type}.${noticeData.sub_type}`, noticeData)

  if (!claw.online) {
    try { await event.reply(Number(claw.code) || 0) } catch {}
    return
  }

  const body = {
    code: claw.code === '0' ? 0 : Number(claw.code) || 0,
    data: { claw_cfg: getClawCfg(adapter, id) }
  }

  try {
    await event.bot.request.put(`/interactions/${event.notice_id}`, body)
    Bot.makeLog('debug', ['龙虾配置交互响应成功', { type, body }], id)
  } catch (err) {
    Bot.makeLog('error', ['龙虾配置交互响应失败', err.message, err.response?.data], id)
  }
}

export function installClaw(adapter) {
  adapter.ensureClawConfig = (selfId) => ensureClawConfig(adapter, selfId)
  adapter.getClawCfg = (selfId) => getClawCfg(adapter, selfId)
  adapter._makeClawConfigInteraction = (id, event) => _makeClawConfigInteraction(adapter, id, event)
}

export { CLAW_DEFAULT_CFG }
