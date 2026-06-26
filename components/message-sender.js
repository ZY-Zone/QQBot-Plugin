import _ from 'lodash'
import { segment } from 'qq-official-bot'
import { config, Runtime, Handler } from '../model/index.js'
import { TmplPkg } from '../utils/constants.js'
import { makeMsg, makeRawMarkdownMsg, makeMarkdownMsg, makeGuildMsg } from './message-builder.js'
import { sendFiles } from './file.js'

async function sendMsg(adapter, data, send, msg) {
  const rets = { message_id: [], data: [], error: [] }
  let msgs

  const sendMsg = async () => {
    for (const i of msgs) {
      try {
        const payload = adapter.wrapOutgoingMessageForSdk12(i)
        Bot.makeLog('debug', ['发送消息', payload], data.self_id)
        const ret = await send(payload)
        Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

        rets.data.push(ret)
        if (ret.id) rets.message_id.push(ret.id)
        Bot[data.self_id].dau.setDau('send_msg', data)
      } catch (err) {
        logger.error(data.self_id, '发送消息错误', i, err)
        rets.error.push(err)
        return false
      }
    }
  }

  if (TmplPkg && TmplPkg?.Button && !data.toQQBotMD) {
    let fncName = /\[.*?\((\S+)\)\]/.exec(data.logFnc)[1]
    const Btn = TmplPkg.Button[fncName]

    if (msg.type === 'node') data.wsids = { toImg: config.toImg }

    let res
    if (Btn) res = Btn(data, msg)

    if (res?.nodeMsg) {
      data.toQQBotMD = true
      data.wsids = {
        text: res.nodeMsg,
        fnc: fncName,
        col: res.col
      }
    } else if (res) {
      data.toQQBotMD = true
      res = segment.button(...res)
      msg = _.castArray(msg)

      let _btn = msg.findIndex(b => b.type === 'button')
      if (_btn === -1) msg.push(res)
      else msg[_btn] = res
    }
  }

  const hasRawMessage = Array.isArray(msg) ? msg.some(m => m.type === 'raw') : msg.type === 'raw'

  if (hasRawMessage) {
    msgs = await makeRawMarkdownMsg(adapter, data, msg, true);
  } else if (config.markdown[data.self_id] === "legacy") {
    msgs = await makeMsg(adapter, data, msg);
  } else if (
    (config.markdown[data.self_id] || (data.toQQBotMD === true && config.customMD[data.self_id])) &&
    data.toQQBotMD !== false
  ) {
    if (config.markdown[data.self_id] == "raw") {
      msgs = await makeRawMarkdownMsg(adapter, data, msg, true);
    } else {
      msgs = await makeMarkdownMsg(adapter, data, msg);
    }

    const [mds, btns] = _.partition(msgs[0], v => v.type === "markdown");
    if (mds.length > 1) {
      for (const idx in mds) {
        msgs = mds[idx];
        if (idx === mds.length - 1) msgs.push(...btns);
        await sendMsg();
      }
      return rets;
    }
  } else {
    msgs = await makeRawMarkdownMsg(adapter, data, msg)
  }

  await sendMsg()

  if (data._files && data._files.length) {
    await sendFiles(adapter, data, data._files)
    data._files = []
  }

  if (Array.isArray(data._ret_id)) { data._ret_id.push(...rets.message_id) }
  return rets
}

export function sendFriendMsg(adapter, data, msg, event) {
  if (!event) event = {}
  if (data.smallbtn) event.smallbtn = true
  return sendMsg(adapter, data, msg => {
    if (data.smallbtn) event.smallbtn = true
    const options = {
      stream: data.stream || false,
      chunkSize: data.chunkSize,
      delay: data.delay
    }
    return data.bot.sdk.sendPrivateMessage(data.user_id, msg, event, options)
  }, msg)
}

export async function sendGroupMsg(adapter, data, msg, event) {
  if (!event) event = {}
  if (data.smallbtn) event.smallbtn = true

  if (Handler.has('QQBot.group.sendMsg')) {
    const res = await Handler.call(
      'QQBot.group.sendMsg',
      data,
      {
        self_id: data.self_id,
        group_id: `${data.self_id}${adapter.sep}${data.group_id}`,
        raw_group_id: data.group_id,
        user_id: data.user_id,
        msg,
        event
      }
    )
    if (res !== false) {
      return res
    }
  }
  return sendMsg(adapter, data, msg => {
    if (data.smallbtn) event.smallbtn = true
    return data.bot.sdk.sendGroupMessage(data.group_id, msg, event)
  }, msg)
}

async function sendGMsg(adapter, data, send, msg) {
  const rets = { message_id: [], data: [], error: [] }
  let msgs

  const sendMsg = async () => {
    for (const i of msgs) {
      try {
        const payload = adapter.wrapOutgoingMessageForSdk12(i)
        Bot.makeLog('debug', ['发送消息', payload], data.self_id)
        const ret = await send(payload)
        Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

        rets.data.push(ret)
        if (ret.id) rets.message_id.push(ret.id)
        Bot[data.self_id].dau.setDau('send_msg', data)
      } catch (err) {
        logger.error(data.self_id, '发送消息错误', i, err)
        rets.error.push(err)
        return false
      }
    }
  }

  msgs = await makeGuildMsg(adapter, data, msg)
  await sendMsg()
  return rets
}

export async function sendDirectMsg(adapter, data, msg, event) {
  if (!data.guild_id) {
    if (!data.src_guild_id) {
      Bot.makeLog('error', [`发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, msg], data.self_id)
      return false
    }
    const dms = await data.bot.sdk.createDirectSession(data.src_guild_id, data.user_id)
    data.guild_id = dms.guild_id
    data.channel_id = dms.channel_id
    data.bot.fl.set(`qg_${data.user_id}`, {
      ...data.bot.fl.get(`qg_${data.user_id}`),
      ...dms
    })
  }
  return sendGMsg(adapter, data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg, event), msg)
}

export function sendGuildMsg(adapter, data, msg, event) {
  return sendGMsg(adapter, data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg, event), msg)
}

export function installMessageSender(adapter) {
  adapter.sendMsg = (data, send, msg) => sendMsg(adapter, data, send, msg)
  adapter.sendFriendMsg = (data, msg, event) => sendFriendMsg(adapter, data, msg, event)
  adapter.sendGroupMsg = (data, msg, event) => sendGroupMsg(adapter, data, msg, event)
  adapter.sendGMsg = (data, send, msg) => sendGMsg(adapter, data, send, msg)
  adapter.sendDirectMsg = (data, msg, event) => sendDirectMsg(adapter, data, msg, event)
  adapter.sendGuildMsg = (data, msg, event) => sendGuildMsg(adapter, data, msg, event)
}
