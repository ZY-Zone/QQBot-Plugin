import { config, inviteStore } from '../Model/index.js'

function ensureRecallConfig(adapter, selfId = '') {
  if (!config.recall || typeof config.recall !== 'object') config.recall = {}
  if (!config.recall.bots || typeof config.recall.bots !== 'object') config.recall.bots = {}
  const key = selfId || 'default'
  if (!config.recall.bots[key] || typeof config.recall.bots[key] !== 'object') config.recall.bots[key] = {}
  const rc = config.recall.bots[key]
  if (typeof rc.markdown !== 'string') rc.markdown = ''
  if (typeof rc.buttonEnabled !== 'boolean') rc.buttonEnabled = false
  if (!rc.button || typeof rc.button !== 'object') rc.button = null
  if (typeof rc.batchCount !== 'number') rc.batchCount = 0
  return rc
}

function sendWakeUp(adapter, data, message) {
  return adapter.sendMsg(data, msg => data.bot.sdk.messageService.sendRecallMessage(`/v2/users/${data.user_id}`, msg), message)
}

async function _sendWakeupMessage(adapter, selfId, userOpenid, mdOverride, buttonOverride, buttonEnabledOverride, force = false) {
  const bot = Bot[selfId]
  if (!bot) return { success: false, error: 'bot不可用' }

  if (!force) {
    const periodCheck = inviteStore.isWakeupSentInPeriod(selfId, userOpenid)
    if (periodCheck.expired) return { success: false, error: '用户超过30天，不可召回', skipped: true }
    if (periodCheck.sent) return { success: false, error: `当前周期(${periodCheck.period})已发送过召回`, skipped: true }
  }

  const rc = ensureRecallConfig(adapter, selfId)
  const md = mdOverride || rc.markdown || ''
  const btnEnabled = typeof buttonEnabledOverride === 'boolean' ? buttonEnabledOverride : rc.buttonEnabled
  const btn = buttonOverride || rc.button
  const isRaw = config.markdown?.[selfId] === 'raw'

  const payload = {
    msg_type: 0,
    content: md || '。',
    msg_seq: Math.floor(Math.random() * 1000000) + 1,
    is_wakeup: true
  }

  if (isRaw && md) {
    payload.msg_type = 2
    payload.markdown = { content: md }
    delete payload.content
    if (btnEnabled && btn) {
      payload.keyboard = { content: btn, bot_appid: Number(bot.info?.appid || 0) }
    }
  }

  try {
    const attemptPeriod = inviteStore.getUserWakeupPeriod(selfId, userOpenid)
    if (attemptPeriod !== null) inviteStore.markWakeupAttempt(selfId, userOpenid, attemptPeriod)
    const { data: result } = await bot.sdk.request.post(`/v2/users/${userOpenid}/messages`, payload)
    Bot.makeLog('info', [`[${selfId}] 召回消息发送成功`, { userOpenid, id: result?.id }], selfId)
    const period = inviteStore.getUserWakeupPeriod(selfId, userOpenid)
    if (period !== null) inviteStore.markWakeupSent(selfId, userOpenid, period, result?.timestamp || '')
    return { success: true, data: result }
  } catch (err) {
    const errCode = err.response?.data?.err_code || err.response?.data?.code || 0
    const errMsg = err.response?.data?.message || err.message || ''
    Bot.makeLog('warn', [`[${selfId}] 召回消息发送失败`, userOpenid, errMsg], selfId)
    const period = inviteStore.getUserWakeupPeriod(selfId, userOpenid)
    if (period !== null) inviteStore.markWakeupFailed(selfId, userOpenid, period, errCode, errMsg)
    return { success: false, error: errMsg, errCode }
  }
}

export function installRecall(adapter) {
  adapter.ensureRecallConfig = (selfId) => ensureRecallConfig(adapter, selfId)
  adapter.sendWakeUp = (data, message) => sendWakeUp(adapter, data, message)
  adapter._sendWakeupMessage = (selfId, userOpenid, mdOverride, buttonOverride, buttonEnabledOverride, force) => _sendWakeupMessage(adapter, selfId, userOpenid, mdOverride, buttonOverride, buttonEnabledOverride, force)
}
