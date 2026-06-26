import _ from 'lodash'
import fs from 'node:fs'
import { join } from 'node:path'
import { config, inviteStore, Handler, Runtime } from '../model/index.js'
import { userIdCache } from '../utils/constants.js'
import { sendFriendMsg, sendGroupMsg, sendDirectMsg, sendGuildMsg } from './message-sender.js'
import { setFriendMap, setGroupMap } from './picker.js'
import { _makeClawConfigInteraction } from './claw.js'

function getQQBotActualMessageId(event) {
  return event.simple_message_id || event.message_id || (event.msg_elements?.[0]?.simple_message_id)
}

function mergeAdjacentTextSegments(segments) {
  const result = []
  for (const seg of segments) {
    const last = result[result.length - 1]
    if (last && last.type === 'text' && seg.type === 'text') {
      last.text += seg.text
    } else {
      result.push({ ...seg })
    }
  }
  return result.length ? result : segments
}

const callbackEventCache = new Map()

async function makeFriendMessage(adapter, data, event) {
  data.sender = {
    user_id: `${data.self_id}${adapter.sep}${event.sender.user_id}`,
    raw_user_id: event.sender.user_id,
    nickname: event.sender.user_name,
    avatar: `https://q.qlogo.cn/qqapp/${data.bot.info.appid}/${event.sender.user_id}/0`
  }
  Bot.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)

  for (const item of event.message_scene.ext) {
    if (item.startsWith("ref_msg_idx=")) {
      data.ref_msg_idx = item.slice("ref_msg_idx=".length);
    } else if (item.startsWith("msg_idx=")) {
      data.msg_idx = item.slice("msg_idx=".length);
    }
  }

  data.msg_elements = event.msg_elements || []

  data.platform = 'QQ-private'

  data.sendInputNotify = input_second => data.bot.sendFriendInputNotify(data.openid, 1, input_second || 30, data.message_id)

  data.reply = msg => {
    const source = { id: data.message_id }
    if (!data.message_id) {
      const cached = callbackEventCache.get(`${data.self_id}:user:${event.sender.user_id}`)
      if (cached) source.event_id = cached
    }
    return sendFriendMsg(adapter, { ...data, user_id: event.sender.user_id }, msg, source)
  }
  data.recallMsg = message_id => adapter.recallFriendMsg(data, message_id)
  await setFriendMap(adapter, data)

  const rawUserOpenid = event.sender?.user_id || ''
  if (rawUserOpenid) {
    inviteStore.recordC2cUser(data.self_id, rawUserOpenid, event.event_id || '', event.timestamp || '')
  }
  data.raw.invite = inviteStore.queryByUser(data.self_id, rawUserOpenid) || undefined
}

async function makeGroupMessage(adapter, data, event) {
  data.sender = {
    user_id: `${data.self_id}${adapter.sep}${event.sender.user_id}`,
    raw_user_id: event.sender.user_id,
    nickname: event.sender.user_name,
    avatar: `https://q.qlogo.cn/qqapp/${data.bot.info.appid}/${event.sender.user_id}/0`
  }

  for (const item of event.message_scene.ext) {
    if (item.startsWith("ref_msg_idx=")) {
      data.ref_msg_idx = item.slice("ref_msg_idx=".length);
    } else if (item.startsWith("msg_idx=")) {
      data.msg_idx = item.slice("msg_idx=".length);
    }
  }

  data.msg_elements = event.msg_elements || []

  data.reply_user = event.msg_elements?.[0]?.author || {}
  data.reply_id = data.reply_user?.member_openid || data.reply_user?.user_id || ''
  data.getReply = () => data.reply_id

  data.platform = 'QQ-group'
  data.group_openid = event.group_id

  data.group_id = `${data.self_id}${adapter.sep}${event.group_id}`
  if (config.toQQUin && Handler.has('ws.tool.findUserId')) {
    const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
    if (user_id?.custom) {
      userIdCache[user_id.custom] = data.user_id
      data.sender.user_id = user_id.custom
    }
  }

  const memberMap = data.bot.gml?.get(event.group_id)
  const memberInfo = memberMap?.get(event.sender.user_id)
  if (memberInfo) {
    data.member = {
      user_id: data.sender.user_id,
      nickname: memberInfo.nick || memberInfo.nickname,
      avatar: memberInfo.avatar,
      role: memberInfo.role
    }
  }

  const filterLog = config.filterLog?.[data.self_id] || []
  let logStat = filterLog.includes(_.trim(data.raw_message)) ? 'debug' : 'info'
  Bot.makeLog(logStat, `群消息：[${data.bot.nickname || data.self_id}] [${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)

  data.reply = msg => {
    const source = { id: data.message_id }
    if (!data.message_id) {
      const cached = callbackEventCache.get(`${data.self_id}:group:${event.group_id}`)
      if (cached) source.event_id = cached
    }
    return sendGroupMsg(adapter, { ...data, group_id: event.group_id }, msg, source)
  }
  data.recallMsg = message_id => adapter.recallGroupMsg(data, message_id)
  await setGroupMap(adapter, data)
}

async function makeDirectMessage(adapter, data, event) {
  data.sender = {
    ...data.bot.fl.get(`qg_${event.sender.user_id}`),
    ...event.sender,
    user_id: `qg_${event.sender.user_id}`,
    nickname: event.sender.user_name,
    avatar: event.author.avatar,
    guild_id: event.guild_id,
    channel_id: event.channel_id,
    src_guild_id: event.src_guild_id
  }
  Bot.makeLog('info', `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
  data.platform = 'guild-private'
  data.reply = msg =>
    sendDirectMsg(
      adapter,
      {
        ...data,
        user_id: event.user_id,
        guild_id: event.guild_id,
        channel_id: event.channel_id
      },
      msg,
      { id: data.message_id }
    )
  data.recallMsg = (message_id, hide) => adapter.recallDirectMsg(data, message_id, hide)
  await setFriendMap(adapter, data)
}

async function makeGuildMessage(adapter, data, event) {
  data.message_type = "group"
  data.sender = {
    ...data.bot.fl.get(`qg_${event.sender.user_id}`),
    ...event.sender,
    user_id: `qg_${event.sender.user_id}`,
    nickname: event.sender.user_name,
    card: event.member.nick,
    avatar: event.author.avatar,
    src_guild_id: event.guild_id,
    src_channel_id: event.channel_id
  }
  if (config.toQQUin && Handler.has('ws.tool.findUserId')) {
    const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
    if (user_id?.custom) {
      userIdCache[user_id.custom] = data.user_id
      data.sender.user_id = user_id.custom
    }
  }
  data.group_id = `qg_${event.guild_id}-${event.channel_id}`
  data.platform = 'guild-channel'
  Bot.makeLog('info', `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
  data.reply = msg =>
    sendGuildMsg(
      adapter,
      { ...data, guild_id: event.guild_id, channel_id: event.channel_id },
      msg,
      { id: data.message_id }
    )
  data.recallMsg = (message_id, hide) => adapter.recallGuildMsg(data, message_id, hide)
  await setFriendMap(adapter, data)
  await setGroupMap(adapter, data)
}

async function makeMessage(adapter, id, event) {
  const isAuditEvent = event.message_type === 'audit'
    || event.message_type === 'audit.pass'
    || event.constructor?.name === 'MessageAuditEvent'
    || typeof event.audit_id !== 'undefined'
    || typeof event.is_passed === 'boolean'
  if (isAuditEvent) {
    const subType = event.sub_type || (event.is_passed === true ? 'pass' : event.is_passed === false ? 'reject' : 'unknown')
    const auditInfo = {
      audit_id: event.audit_id,
      message_id: event.message_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id
    }
    Bot.makeLog('info', `消息审核${subType === 'pass' ? '通过' : subType === 'reject' ? '不通过' : '未知'} ${JSON.stringify(auditInfo)}`, id)
    Bot.em(`notice.audit.${subType}`, {
      ...event,
      self_id: id,
      bot: Bot[id],
      post_type: 'notice',
      notice_type: 'audit',
      sub_type: subType
    })
    return
  }

  const selfBotMentionIds = Array.isArray(event.mentions)
    ? event.mentions
      .filter(m => m?.bot === true && m?.is_you === true)
      .flatMap(m => [m.id, m.member_openid])
      .filter(Boolean)
    : []
  if (selfBotMentionIds.length) {
    const mentionReg = new RegExp(selfBotMentionIds.map(i => `<@${_.escapeRegExp(i)}>`).join('|'), 'g')
    if (event.raw_message) {
      event.raw_message = event.raw_message.replace(mentionReg, '').replace(/[ \t]{2,}/g, ' ').trim()
    }
    if (event.content) {
      event.content = event.content.replace(mentionReg, '').replace(/[ \t]{2,}/g, ' ').trim()
    }
  }

  if (config.filter_bot_msg) {
    if (event.author?.bot) return true
    if (Array.isArray(event.mentions)) {
      const isBotMentioned = event.mentions.some(m => m?.is_you === true && m?.scope !== 'all')
      if (!isBotMentioned && (event.mentions.some(m => m?.scope === 'all') || event.mentions.some(m => m?.bot === true && m?.is_you !== true))) return true
    }
  }

  const mentions = Array.isArray(event.mentions) ? event.mentions : []
  const atUser = mentions.find(m => !m.bot) ?? mentions.at(-1) ?? null

  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: event.post_type,
    message_type: event.message_type,
    sub_type: event.sub_type,
    message_id: getQQBotActualMessageId(event),
    get user_id() { return this.sender.user_id },
    message: mergeAdjacentTextSegments(adapter.normalizeSdkMessage(event.message)),
    raw_message: event.raw_message,
    mentions,
    at: config.getAt ? (atUser?.member_openid ? `${id}:${atUser.member_openid}` : null) : undefined,
    atall: mentions.some(m => m.scope === 'all'),
    atme: mentions.some(m => m?.is_you === true),
    atbot: mentions.some(m => m?.bot === true)
  }

  for (const i of data.message) {
    switch (i.type) {
      case 'at':
        if (data.message_type == 'group') i.qq = `${data.self_id}${adapter.sep}${i.user_id}`
        else i.qq = `qg_${i.user_id}`
        break
    }
  }

  switch (data.message_type) {
    case 'private':
    case 'direct':
      if (data.sub_type == 'friend') {
        await adapter.makeFriendMessage(data, event)
      } else {
        await adapter.makeDirectMessage(data, event)
      }
      break
    case 'group':
      await adapter.makeGroupMessage(data, event)
      break
    case 'guild':
      await adapter.makeGuildMessage(data, event)
      if (data.message.length === 0) {
        data.message.push({ type: 'text', text: '' })
      }
      break
    default:
      Bot.makeLog('warn', ['未知消息', data.message_type, data.sub_type, event], id)
      return
  }

  try {
    data.bot.stat.recv_msg_cnt++
  } catch (err) {
    try {
      data.bot.stat.recv_msg_cnt = (data.bot.stat.recv_msg_cnt || 0) + 1
    } catch (err2) {
      Bot.makeLog('debug', ['无法更新接收消息计数', err2], id)
    }
  }

  Bot[data.self_id].dau.setDau('receive_msg', data)
  Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
}

async function makeCallback(adapter, id, event) {
  if (event.data?.type === 2001 || event.data?.type === 2002) {
    return _makeClawConfigInteraction(adapter, id, event)
  }

  const reply = event.reply.bind(event)
  event.reply = async (...args) => {
    try {
      return await reply(...args)
    } catch (err) {
      Bot.makeLog('debug', ['回复按钮点击事件错误', err], id)
    }
  }

  const interactionEventId = event.notice_id?.startsWith?.('INTERACTION_CREATE:')
    ? event.notice_id
    : `INTERACTION_CREATE:${event.notice_id}`

  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'message',
    message_id: event.notice_id || event.event_id,
    message_type: event.notice_type,
    sub_type: 'callback',
    get user_id() { return this.sender.user_id },
    sender: { user_id: `${id}${adapter.sep}${event.operator_id}` },
    message: [],
    raw_message: ''
  }

  const callback = data.bot.callback[event.data?.resolved?.button_id]
  if (callback) {
    if (!event.group_id && callback.group_id) { event.group_id = callback.group_id }
    data.message_id = callback.id
    if (callback.message_id.length) {
      for (const id of callback.message_id) { data.message.push({ type: 'reply', id }) }
      data.raw_message += `[回复：${callback.message_id}]`
    }
    data.message.push({ type: 'text', text: callback.message })
    data.raw_message += callback.message
  } else {
    if (event.data?.resolved?.button_id) {
      data.message.push({ type: 'reply', id: event.data?.resolved?.button_id })
      data.raw_message += `[回复：${event.data?.resolved?.button_id}]`
    }
    if (event.data?.resolved?.button_data) {
      data.message.push({ type: 'text', text: event.data?.resolved?.button_data })
      data.raw_message += event.data?.resolved?.button_data
    } else {
      event.reply(1)
    }
  }
  event.reply(0)

  callbackEventCache.set(`${id}:group:${event.group_id}`, interactionEventId)
  callbackEventCache.set(`${id}:user:${event.operator_id}`, interactionEventId)

  const wrapWithEventId = (msg) => {
    msg = Array.isArray(msg) ? [...msg] : [msg]
    msg.unshift({ type: 'reply', id: `event_${interactionEventId}` })
    return msg
  }

  switch (data.message_type) {
    case 'direct':
    case 'friend':
      data.message_type = 'private'
      data.platform = 'QQ-private'
      Bot.makeLog('info', [`好友按钮点击事件：[${data.user_id}]`, data.raw_message], data.self_id)
      data.reply = msg => sendFriendMsg(
        adapter,
        { ...data, user_id: event.operator_id },
        wrapWithEventId(msg),
        { event_id: `event_${interactionEventId}` }
      )
      await setFriendMap(adapter, data)
      break
    case 'group':
      data.group_id = `${id}${adapter.sep}${event.group_id}`
      data.platform = 'QQ-group'
      Bot.makeLog('info', [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)
      data.reply = msg => sendGroupMsg(
        adapter,
        { ...data, group_id: event.group_id },
        wrapWithEventId(msg),
        { event_id: `event_${interactionEventId}` }
      )
      await setGroupMap(adapter, data)
      break
    case 'guild':
      break
    default:
      Bot.makeLog('warn', ['未知按钮点击事件', event], data.self_id)
  }

  Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
}

function makeNotice(adapter, id, event) {
  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: event.post_type,
    notice_type: event.notice_type,
    sub_type: event.sub_type,
    notice_id: event.notice_id,
    group_id: event.group_id,
    user_id: event.user_id || event.operator_id,
    platform: 'QQ-notice'
  }

  switch (data.sub_type) {
    case 'action':
      return adapter.makeCallback(id, event)
    case 'increase':
    case 'member.increase':
      Bot[data.self_id].dau.setDau('group_increase', data)
      Bot.makeLog('info', `群成员增加：[群:${event.group_id}, 用户:${event.user_id}]`, data.self_id)
      if (event.notice_type === 'group') {
        const inviterOpenid = event.operator_id || event.user_id || ''
        if (inviterOpenid) {
          inviteStore.recordGroupAdd(data.self_id, inviterOpenid, event.group_id, event.timestamp || '')
        }
        const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'Model', 'template', 'groupIncreaseMsg.js')
        if (fs.existsSync(path)) {
          import(`file://${path}`).then(i => i.default).then(async i => {
            let msg
            if (typeof i === 'function') {
              msg = await i(`${data.self_id}${adapter.sep}${event.group_id}`, `${data.self_id}${adapter.sep}${data.user_id}`, data.self_id)
            } else {
              msg = i
            }
            if (msg?.length > 0) {
              adapter.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(event.group_id, msg), msg)
            }
          })
        }
      }
      if (event.notice_type === 'friend') {
        const userOpenid = event.user_id || ''
        if (userOpenid) {
          inviteStore.recordC2cUser(data.self_id, userOpenid, event.event_id || '', event.timestamp || '')
        }
      }
      data.reply = msg => sendGroupMsg(adapter, { ...data, group_id: event.group_id }, msg, { event_id: event.event_id })
      Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
      Bot.em(`${data.post_type}.${data.notice_type}.member.${data.sub_type}`, data)
      return
    case 'decrease':
    case 'member.decrease':
      Bot[data.self_id].dau.setDau('group_decrease', data)
      Bot.makeLog('info', `群成员减少：[群:${event.group_id}, 用户:${event.user_id}]`, data.self_id)
      if (event.notice_type === 'group') {
        const kickerOpenid = event.operator_id || event.user_id || ''
        if (kickerOpenid) {
          inviteStore.recordGroupDel(data.self_id, kickerOpenid, event.group_id, event.timestamp || '')
        }
        const gml = data.bot.gml
        if (gml) {
          try {
            const memberInfo = gml.get(event.user_id) || Array.from(gml.values()).find(m =>
              m?.member_openid === event.user_id || m?.raw_user_id === event.user_id
            )
            if (memberInfo) {
              data.sender = {
                user_id: `${data.self_id}${adapter.sep}${event.user_id}`,
                raw_user_id: event.user_id,
                nickname: memberInfo.nick || memberInfo.nickname || event.user_id,
                avatar: memberInfo.avatar || ''
              }
              data.nickname = data.sender.nickname
            }
          } catch (e) {
            Bot.makeLog('debug', ['恢复离开成员信息失败', e.message], data.self_id)
          }
        }
      }
      data.reply = msg => sendGroupMsg(adapter, { ...data, group_id: event.group_id }, msg, { event_id: event.event_id })
      Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
      Bot.em(`${data.post_type}.${data.notice_type}.member.${data.sub_type}`, data)
      return
    case 'update':
    case 'member.update':
    case 'add':
    case 'remove':
      break
    case 'receive_open':
    case 'receive_close':
      Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
      break
    default:
      Bot.makeLog('warn', ['未知通知', event], id)
  }

  Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
}

function makeForumPost(adapter, id, event) {
  const eventData = event.d || event
  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'forum',
    event_type: 'FORUM_POST_CREATE',
    guild_id: eventData.guild_id,
    channel_id: eventData.channel_id,
    thread_id: eventData.post_info?.thread_id,
    post_id: eventData.post_info?.post_id,
    user_id: eventData.author_id,
    content: eventData.post_info?.content,
    timestamp: eventData.post_info?.date_time
  }

  adapter.getChannelThreadInfo(data.channel_id, data.thread_id).then(threadInfo => {
    const thread = threadInfo?.thread
    const title = thread?.thread_info?.title || '无标题'

    let contentText = ''
    try {
      const content = thread?.thread_info?.content || data.content
      if (content) {
        const contentObj = JSON.parse(content)
        if (contentObj.paragraphs && contentObj.paragraphs.length > 0) {
          contentText = contentObj.paragraphs
            .map(p => p.elems?.map(e => e.text?.text || '').join('') || '')
            .join('')
            .trim()

          if (contentText && contentText.length > 0) {
            contentText = contentText.substring(0, 100)
          }
        }
      }
    } catch (e) {
      const rawContent = String(thread?.thread_info?.content || data.content || '').trim()
      if (rawContent && rawContent.length > 0 && !/^[\{\[\<]/.test(rawContent)) {
        contentText = rawContent.substring(0, 100)
      }
    }

    const logMessage = contentText
      ? `论坛帖子创建：「${title}」${contentText}${contentText.length >= 100 ? '...' : ''}`
      : `论坛帖子创建：「${title}」`

    Bot.makeLog('info', [logMessage, event], id)
  }).catch(err => {
    Bot.makeLog('info', [`论坛帖子创建事件：[频道:${data.channel_id}, 主题:${data.thread_id}, 帖子:${data.post_id}]`, event], id)
  })

  Bot.em('forum.post.create', data)
}

function makeForumPostDelete(adapter, id, event) {
  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'forum',
    event_type: 'FORUM_POST_DELETE',
    channel_id: event.channel_id,
    thread_id: event.thread_id,
    user_id: event.operator?.id,
    timestamp: event.timestamp
  }

  Bot.makeLog('info', [`论坛帖子删除事件：[频道:${data.channel_id}, 主题:${data.thread_id}]`, event], id)

  Bot.em('forum.post.delete', data)
}

function makeForumReply(adapter, id, event) {
  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'forum',
    event_type: 'FORUM_REPLY_CREATE',
    channel_id: event.channel_id,
    thread_id: event.thread_id,
    reply_id: event.reply_id,
    user_id: event.author?.id,
    content: event.content,
    timestamp: event.timestamp
  }

  Bot.makeLog('info', [`论坛回复创建事件：[频道:${data.channel_id}, 主题:${data.thread_id}, 回复:${data.reply_id}]`, event], id)

  Bot.em('forum.reply.create', data)
}

function makeForumReplyDelete(adapter, id, event) {
  const data = {
    raw: event,
    bot: Bot[id],
    self_id: id,
    post_type: 'forum',
    event_type: 'FORUM_REPLY_DELETE',
    channel_id: event.channel_id,
    thread_id: event.thread_id,
    reply_id: event.reply_id,
    user_id: event.operator?.id,
    timestamp: event.timestamp
  }

  Bot.makeLog('info', [`论坛回复删除事件：[频道:${data.channel_id}, 主题:${data.thread_id}, 回复:${data.reply_id}]`, event], id)

  Bot.em('forum.reply.delete', data)
}

export function installMessageEvent(adapter) {
  adapter.makeFriendMessage = (data, event) => makeFriendMessage(adapter, data, event)
  adapter.makeGroupMessage = (data, event) => makeGroupMessage(adapter, data, event)
  adapter.makeDirectMessage = (data, event) => makeDirectMessage(adapter, data, event)
  adapter.makeGuildMessage = (data, event) => makeGuildMessage(adapter, data, event)
  adapter.makeMessage = (id, event) => makeMessage(adapter, id, event)
  adapter.makeCallback = (id, event) => makeCallback(adapter, id, event)
  adapter.makeNotice = (id, event) => makeNotice(adapter, id, event)
  adapter.makeForumPost = (id, event) => makeForumPost(adapter, id, event)
  adapter.makeForumPostDelete = (id, event) => makeForumPostDelete(adapter, id, event)
  adapter.makeForumReply = (id, event) => makeForumReply(adapter, id, event)
  adapter.makeForumReplyDelete = (id, event) => makeForumReplyDelete(adapter, id, event)
  adapter.callbackEventCache = callbackEventCache
}
