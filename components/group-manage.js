// 群管理 API：封装 QQ 官方 API v2 群管理接口（对齐 bot-docs 2026-08-10 新增文档），
// 通过 adapter / Bot[id] / pickGroup 群对象按 OneBotv11 命名方式暴露

async function request(adapter, id, method, url, body) {
  try {
    const bot = Bot[id]
    const res = await bot.sdk.request[method](url, body)
    return res?.data ?? res
  } catch (err) {
    Bot.makeLog('error', [`群管理接口错误 ${method.toUpperCase()} ${url}`, body || '', err], id)
    throw err
  }
}

function toOpenid(adapter, id, value) {
  return String(value ?? '').replace(`${id}${adapter.sep}`, '')
}

// —— 群基础信息 ——

function getGroupInfo(adapter, id, group_openid) {
  return request(adapter, id, 'get', `/v2/groups/${group_openid}/info`)
}

function getGroupBotState(adapter, id, group_openid) {
  return request(adapter, id, 'get', `/v2/groups/${group_openid}/bot_state`)
}

function getGroupMemberInfo(adapter, id, group_openid, member_openid) {
  return request(adapter, id, 'get', `/v2/groups/${group_openid}/members/${member_openid}`)
}

// —— 群禁言管理（/v2/groups/{group_openid}/restrict_chat_setting）——

function getGroupMuteState(adapter, id, group_openid) {
  return request(adapter, id, 'get', `/v2/groups/${group_openid}/restrict_chat_setting`)
}

// duration 单位秒；>0 增加/更新禁言，<=0 解除禁言；mute_expire_at 为 RFC3339 格式
function setGroupBan(adapter, id, group_openid, member_openid, duration = 0) {
  const time = Number(duration)
  const members = [{
    op: time > 0 ? 'add' : 'del',
    member_openid: toOpenid(adapter, id, member_openid),
    mute_expire_at: time > 0 ? new Date(Date.now() + time * 1000).toISOString() : ''
  }]
  return request(adapter, id, 'post', `/v2/groups/${group_openid}/restrict_chat_setting`, { members })
}

// —— 入群申请管理 ——

function getGroupJoinRequestList(adapter, id, group_openid, cursor = '', limit = 20) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  qs.set('limit', limit)
  return request(adapter, id, 'get', `/v2/groups/${group_openid}/join_request_list?${qs}`)
}

// options: { op?: 'approve'|'decline', approve?: boolean, join_request_id?, reject_reason?, add_to_member_blacklist? }
function approvalJoinRequest(adapter, id, group_openid, member_openid, options = {}) {
  const body = { op: options.op ?? (options.approve ? 'approve' : 'decline') }
  if (options.join_request_id) body.join_request_id = options.join_request_id
  if (body.op === 'decline' && options.reject_reason) body.reject_reason = String(options.reject_reason)
  if (body.op === 'decline' && options.add_to_member_blacklist) body.add_to_member_blacklist = true
  return request(adapter, id, 'post', `/v2/groups/${group_openid}/approval_join_request/${member_openid}`, body)
}

// —— 入群自动审批策略（/v2/groups/join_approval_strategy）——

function getJoinApprovalStrategies(adapter, id, cursor = '', limit = 20) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  qs.set('limit', limit)
  return request(adapter, id, 'get', `/v2/groups/join_approval_strategy?${qs}`)
}

function createJoinApprovalStrategy(adapter, id, body) {
  return request(adapter, id, 'post', '/v2/groups/join_approval_strategy', body)
}

function updateJoinApprovalStrategy(adapter, id, strategy_id, body) {
  return request(adapter, id, 'patch', `/v2/groups/join_approval_strategy/${strategy_id}`, body)
}

function deleteJoinApprovalStrategy(adapter, id, strategy_id) {
  return request(adapter, id, 'delete', `/v2/groups/join_approval_strategy/${strategy_id}`)
}

function executeJoinApprovalStrategy(adapter, id, strategy_id) {
  return request(adapter, id, 'post', `/v2/groups/join_approval_strategy/${strategy_id}/execute`)
}

// op: 'add' | 'del'，whitelist_users 为 QQ 号码字符串数组（单次最多 10000 个）
function updateJoinApprovalWhitelist(adapter, id, strategy_id, op, whitelist_users) {
  return request(adapter, id, 'post', `/v2/groups/join_approval_strategy/${strategy_id}/whitelist_users`, { op, whitelist_users })
}

export function installGroupManage(adapter) {
  adapter.getGroupInfo = (id, group_openid) => getGroupInfo(adapter, id, group_openid)
  adapter.getGroupBotState = (id, group_openid) => getGroupBotState(adapter, id, group_openid)
  adapter.getGroupMemberInfo = (id, group_openid, member_openid) => getGroupMemberInfo(adapter, id, group_openid, member_openid)
  adapter.getGroupMuteState = (id, group_openid) => getGroupMuteState(adapter, id, group_openid)
  adapter.setGroupBan = (id, group_openid, member_openid, duration) => setGroupBan(adapter, id, group_openid, member_openid, duration)
  adapter.getGroupJoinRequestList = (id, group_openid, cursor, limit) => getGroupJoinRequestList(adapter, id, group_openid, cursor, limit)
  adapter.approvalJoinRequest = (id, group_openid, member_openid, options) => approvalJoinRequest(adapter, id, group_openid, member_openid, options)
  adapter.getJoinApprovalStrategies = (id, cursor, limit) => getJoinApprovalStrategies(adapter, id, cursor, limit)
  adapter.createJoinApprovalStrategy = (id, body) => createJoinApprovalStrategy(adapter, id, body)
  adapter.updateJoinApprovalStrategy = (id, strategy_id, body) => updateJoinApprovalStrategy(adapter, id, strategy_id, body)
  adapter.deleteJoinApprovalStrategy = (id, strategy_id) => deleteJoinApprovalStrategy(adapter, id, strategy_id)
  adapter.executeJoinApprovalStrategy = (id, strategy_id) => executeJoinApprovalStrategy(adapter, id, strategy_id)
  adapter.updateJoinApprovalWhitelist = (id, strategy_id, op, whitelist_users) => updateJoinApprovalWhitelist(adapter, id, strategy_id, op, whitelist_users)
}
