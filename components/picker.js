import { config } from '../Model/index.js'
import { userIdCache } from '../utils/constants.js'

function pickFriend(adapter, id, user_id) {
  if (config.toQQUin && userIdCache[user_id]) user_id = userIdCache[user_id]
  if (user_id.startsWith('qg_')) return adapter.pickGuildFriend(id, user_id)
  const i = {
    ...Bot[id].fl.get(user_id),
    self_id: id,
    bot: Bot[id],
    user_id: user_id.replace(`${id}${adapter.sep}`, ''),
    platform: 'QQ-private'
  }
  return {
    ...i,
    sendMsg: msg => adapter.sendFriendMsg(i, msg),
    sendWakeUp: message => adapter.sendWakeUp(i, message),
    recallMsg: message_id => adapter.recallFriendMsg(i, message_id),
    getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
  }
}

function pickMember(adapter, id, group_id, user_id) {
  if (typeof group_id !== "string") group_id = String(group_id)
  if (typeof user_id !== "string") user_id = String(user_id)
  if (config.toQQUin && userIdCache[user_id]) {
    user_id = userIdCache[user_id]
  }
  if (user_id.startsWith('qg_')) { return adapter.pickGuildMember(id, group_id, user_id) }
  const i = {
    ...Bot[id].fl.get(user_id),
    ...Bot[id].gml.get(group_id)?.get(user_id),
    self_id: id,
    bot: Bot[id],
    user_id: user_id.replace(`${id}${adapter.sep}`, ''),
    group_id: group_id.replace(`${id}${adapter.sep}`, ''),
    platform: 'QQ-group-member'
  }
  return {
    ...adapter.pickFriend(id, user_id),
    ...i
  }
}

function pickGroup(adapter, id, group_id) {
  if (typeof group_id !== "string") group_id = String(group_id)
  if (group_id.startsWith?.('qg_')) { return adapter.pickGuild(id, group_id) }
  const i = {
    ...Bot[id].gl.get(group_id),
    self_id: id,
    bot: Bot[id],
    group_id: group_id.replace?.(`${id}${adapter.sep}`, '') || group_id,
    platform: 'QQ-group'
  }
  const openid = value => String(value ?? '').replace(`${id}${adapter.sep}`, '')
  return {
    ...i,
    sendMsg: msg => adapter.sendGroupMsg(i, msg),
    pickMember: user_id => adapter.pickMember(id, group_id, user_id),
    recallMsg: message_id => adapter.recallGroupMsg(i, message_id),
    getMemberMap: () => i.bot.gml.get(group_id),
    // —— 群管理 API（对齐 OneBotv11 命名，底层调用官方 v2 接口）——
    getInfo: () => adapter.getGroupInfo(id, i.group_id),
    getBotState: () => adapter.getGroupBotState(id, i.group_id),
    getMuteState: () => adapter.getGroupMuteState(id, i.group_id),
    getGroupMemberInfo: user_id => adapter.getGroupMemberInfo(id, i.group_id, openid(user_id)),
    muteMember: (user_id, duration) => adapter.setGroupBan(id, i.group_id, openid(user_id), duration),
    getJoinRequestList: (cursor, limit) => adapter.getGroupJoinRequestList(id, i.group_id, cursor, limit),
    approveJoinRequest: (member_openid, options) => adapter.approvalJoinRequest(id, i.group_id, openid(member_openid), options),
    getJoinApprovalStrategies: (cursor, limit) => adapter.getJoinApprovalStrategies(id, cursor, limit),
    createJoinApprovalStrategy: body => adapter.createJoinApprovalStrategy(id, body),
    updateJoinApprovalStrategy: (strategy_id, body) => adapter.updateJoinApprovalStrategy(id, strategy_id, body),
    deleteJoinApprovalStrategy: strategy_id => adapter.deleteJoinApprovalStrategy(id, strategy_id),
    executeJoinApprovalStrategy: strategy_id => adapter.executeJoinApprovalStrategy(id, strategy_id),
    updateJoinApprovalWhitelist: (strategy_id, op, whitelist_users) => adapter.updateJoinApprovalWhitelist(id, strategy_id, op, whitelist_users)
  }
}

function pickGuildFriend(adapter, id, user_id) {
  const i = {
    ...Bot[id].fl.get(user_id),
    self_id: id,
    bot: Bot[id],
    user_id: user_id.replace(/^qg_/, ''),
    platform: 'guild-private'
  }
  return {
    ...i,
    sendMsg: msg => adapter.sendDirectMsg(i, msg),
    recallMsg: (message_id, hide) => adapter.recallDirectMsg(i, message_id, hide)
  }
}

function pickGuildMember(adapter, id, group_id, user_id) {
  const guild_id = group_id.replace(/^qg_/, '').split('-')
  const i = {
    ...Bot[id].fl.get(user_id),
    ...Bot[id].gml.get(group_id)?.get(user_id),
    self_id: id,
    bot: Bot[id],
    src_guild_id: guild_id[0],
    src_channel_id: guild_id[1],
    user_id: user_id.replace(/^qg_/, ''),
    platform: 'guild-channel-member'
  }
  return {
    ...adapter.pickGuildFriend(id, user_id),
    ...i,
    sendMsg: msg => adapter.sendDirectMsg(i, msg),
    recallMsg: (message_id, hide) => adapter.recallDirectMsg(i, message_id, hide)
  }
}

function pickGuild(adapter, id, group_id) {
  const guild_id = group_id.replace(/^qg_/, '').split('-')
  const i = {
    ...Bot[id].gl.get(group_id),
    self_id: id,
    bot: Bot[id],
    guild_id: guild_id[0],
    channel_id: guild_id[1],
    platform: 'guild-channel'
  }
  return {
    ...i,
    sendMsg: msg => adapter.sendGuildMsg(i, msg),
    recallMsg: (message_id, hide) => adapter.recallGuildMsg(i, message_id, hide),
    pickMember: user_id => adapter.pickGuildMember(id, group_id, user_id),
    getMemberMap: () => i.bot.gml.get(group_id),
    createChannel: (channelInfo) => adapter.createChannel(i, channelInfo)
  }
}

async function createChannel(adapter, data, channelInfo) {
  try {
    Bot.makeLog('info', `创建子频道：[${data.guild_id}] ${JSON.stringify(channelInfo)}`, data.self_id)
    const result = await data.bot.sdk.createChannel(data.guild_id, channelInfo)
    return result
  } catch (err) {
    Bot.makeLog('error', ['创建子频道错误', channelInfo, err], data.self_id)
    return false
  }
}

export async function setFriendMap(adapter, data) {
  if (!data.user_id) return
  await data.bot.fl.set(data.user_id, {
    ...data.bot.fl.get(data.user_id),
    ...data.sender
  })
}

export async function setGroupMap(adapter, data) {
  if (!data.group_id) return
  await data.bot.gl.set(data.group_id, {
    ...data.bot.gl.get(data.group_id),
    group_id: data.group_id
  })
  let gml = data.bot.gml.get(data.group_id)
  if (!gml) {
    gml = new Map()
    await data.bot.gml.set(data.group_id, gml)
  }
  await gml.set(data.user_id, {
    ...gml.get(data.user_id),
    ...data.sender
  })
}

export function installPicker(adapter) {
  adapter.pickFriend = (id, user_id) => pickFriend(adapter, id, user_id)
  adapter.pickMember = (id, group_id, user_id) => pickMember(adapter, id, group_id, user_id)
  adapter.pickGroup = (id, group_id) => pickGroup(adapter, id, group_id)
  adapter.pickGuildFriend = (id, user_id) => pickGuildFriend(adapter, id, user_id)
  adapter.pickGuildMember = (id, group_id, user_id) => pickGuildMember(adapter, id, group_id, user_id)
  adapter.pickGuild = (id, group_id) => pickGuild(adapter, id, group_id)
  adapter.createChannel = (data, channelInfo) => createChannel(adapter, data, channelInfo)
  adapter.setFriendMap = (data) => setFriendMap(adapter, data)
  adapter.setGroupMap = (data) => setGroupMap(adapter, data)
}
