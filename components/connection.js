import fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import fetch from 'node-fetch'
import { Bot as QQBot } from 'qq-official-bot'
import { encode as encodeSilk, isSilk } from 'silk-wasm'
import { config, Dau, inviteStore } from '../model/index.js'
import { enhanceSDK, isSdk12, getSDKVersion } from '../model/sdkEnhancer.js'

async function makeRecord(adapter, file) {
    if (config.toBotUpload) for (const i of Bot.uin) {
      if (!Bot[i].uploadRecord) continue
      try {
        const url = await Bot[i].uploadRecord(file)
        if (url) return url
      } catch (err) {
        Bot.makeLog("error", ["Bot", i, "语音上传错误", file, err])
      }
    }
    const buffer = await Bot.Buffer(file)
    if (!Buffer.isBuffer(buffer)) return file
    if (isSilk(buffer)) return buffer

    if (!config.forceSilk) {
      const ext = typeof file === 'string' ? file.split('?')[0].split('.').pop()?.toLowerCase() : ''
      if (['silk', 'wav', 'mp3', 'flac'].includes(ext)) return file
    }

    const convFile = join("temp", randomUUID())
    try {
      fs.writeFileSync(convFile, buffer)
      await Bot.exec(`ffmpeg -i "${convFile}" -f s16le -ar 48000 -ac 1 "${convFile}.pcm"`)
      file = (await encodeSilk(fs.readFileSync(`${convFile}.pcm`), 48000)).data
    } catch (err) {
      Bot.makeLog("error", ["silk 转码错误", file, err])
    }

    for (const i of [convFile, `${convFile}.pcm`]) {
      try {
        fs.unlinkSync(i)
      } catch (err) { }
    }
    return file
  }

function getFriendMap(adapter, id) {
    return Bot.getMap(`${adapter.path}${id}/Friend`)
  }

function getGroupMap(adapter, id) {
    return Bot.getMap(`${adapter.path}${id}/Group`)
  }

function getMemberMap(adapter, id) {
    return Bot.getMap(`${adapter.path}${id}/Member`)
  }

async function connect(adapter, token) {
    token = token.split(':')
    const id = token[0]
    const opts = {
      ...config.bot,
      WsUrl: config?.WsUrl[id] || '',
      ApiUrl: config?.ApiUrl[id] || '',
      appid: token[1],
      token: token[2],
      secret: token[3],
      intents: [
        'GUILDS',
        'GUILD_MEMBERS',
        'GUILD_MESSAGE_REACTIONS',
        'DIRECT_MESSAGE',
        'INTERACTION',
        'MESSAGE_AUDIT'
      ],
      mode: 'websocket'
    }

    if (Number(token[4])) {
      opts.intents.push('GROUP_AND_C2C_EVENT')
      opts.intents.push('GROUP_MEMBER')
    }

    if (Number(token[5])) opts.intents.push('GUILD_MESSAGES')
    else opts.intents.push('PUBLIC_GUILD_MESSAGES')

    Bot[id] = {
      adapter,
      sdk: enhanceSDK(new QQBot(opts)),
      login() {
        return new Promise(resolve => {
          this.sdk.receiver.once("ready", resolve)
          this.sdk.start()
        })
      },
      logout() {
        return new Promise(resolve => {
          this.sdk.receiver.once("close", resolve)
          this.sdk.stop()
        })
      },

      uin: id,
      info: { id, ...opts, avatar: `https://q.qlogo.cn/g?b=qq&s=0&nk=${id}` },
      get nickname() { return this.sdk.nickname },
      get avatar() { return this.info.avatar },

      version: {
        id: adapter.id,
        name: adapter.name,
        version: adapter.version
      },
      stat: {
        start_time: Date.now() / 1000,
        recv_msg_cnt: 0
      },

      pickFriend: user_id => adapter.pickFriend(id, user_id),
      get pickUser() { return this.pickFriend },
      getFriendMap() { return this.fl },
      fl: await adapter.getFriendMap(id),

      pickMember: (group_id, user_id) => adapter.pickMember(id, group_id, user_id),
      pickGroup: group_id => adapter.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: await adapter.getGroupMap(id),
      gml: await adapter.getMemberMap(id),

      dau: new Dau(id, adapter.sep, config.dauDB),

      async getChannelThreads(channel_id) {
        const { data: result } = await this.sdk.request.get(`/channels/${channel_id}/threads`)
        return result
      },

      async getChannelThreadInfo(channel_id, thread_id) {
        const { data: result } = await this.sdk.request.get(`/channels/${channel_id}/threads/${thread_id}`)
        return result
      },

      async sendFriendInputNotify(user_id, input_type, input_second, msg_id) {
        const result = await this.sdk.request.post(`/v2/users/${user_id}/messages`, {
          msg_type: 6,
          input_notify: { input_type, input_second },
          msg_id
        })
        return result.data?.ext_info || { ref_idx: '' }
      },

      callback: {}
    }

    Bot[id].sdk.logger = {}
    for (const i of ['trace', 'debug', 'info', 'mark', 'warn', 'error', 'fatal']) {
      Bot[id].sdk.logger[i] = (...args) => {
        if (config.simplifiedSdkLog) {
          if (args?.[0]?.match?.(/^send to/)) {
            args[0] = args[0].replace(/<(.+?)(,.*?)>/g, (v, k1, k2) => {
              return `<${k1}>`
            })
          } else if (args?.[0]?.match?.(/^recv from/)) {
            return
          }
        }
        Bot.makeLog(i, args, id)
      }
    }

    Bot[id].sdk.on('message', event => {
      void adapter.makeMessage(id, event).catch(e =>
        Bot.makeLog('error', [`${adapter.name} makeMessage`, e], id))
    })
    Bot[id].sdk.on('notice', event => adapter.makeNotice(id, event))
    Bot[id].sdk.on('FORUM_POST_CREATE', event => adapter.makeForumPost(id, event))
    Bot[id].sdk.on('FORUM_POST_DELETE', event => adapter.makeForumPostDelete(id, event))
    Bot[id].sdk.on('FORUM_REPLY_CREATE', event => adapter.makeForumReply(id, event))
    Bot[id].sdk.on('FORUM_REPLY_DELETE', event => adapter.makeForumReplyDelete(id, event))

    patchSessionManager(Bot[id].sdk.sessionManager)

    await Bot[id].dau.init()

    try {
      if (token[4] === "2") {
        await Bot[id].sdk.sessionManager.getAccessToken()
        Bot[id].login = () => adapter.appid[opts.appid] = Bot[id]
        Bot[id].logout = () => delete adapter.appid[opts.appid]
      }

      await Bot[id].login()
      Object.assign(Bot[id].info, await Bot[id].sdk.getSelfInfo())
    } catch (err) {
      Bot.makeLog("error", [`${adapter.name}(${adapter.id}) ${adapter.version} 连接失败`, err], id)
      return false
    }

    Bot.makeLog("mark", `${adapter.name}(${adapter.id}) ${adapter.version} ${Bot[id].nickname} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

async function makeWebHookSign(adapter, id, req, secret) {
    const { sign } = (await import("tweetnacl")).default
    const { plain_token, event_ts } = req.body.d
    while (secret.length < 32) secret = secret.repeat(2).slice(0, 32)
    const signature = Buffer.from(
      sign.detached(
        Buffer.from(`${event_ts}${plain_token}`),
        sign.keyPair.fromSeed(Buffer.from(secret)).secretKey,
      ),
    ).toString("hex")
    Bot.makeLog("debug", ["QQBot 签名生成", { plain_token, signature }], id)
    req.res.send({ plain_token, signature })
  }

function patchSessionManager(sessionManager) {
  if (!sessionManager || typeof sessionManager.sendWs !== 'function' || sessionManager.__yunzaiSafeSendWs) return
  const originalSendWs = sessionManager.sendWs.bind(sessionManager)
  sessionManager.sendWs = function (data) {
    if (!this.bot?.ws || this.bot.ws.readyState !== 1) {
      this.bot?.logger?.debug?.('[SESSION-MANAGER] WebSocket 未就绪，跳过发送')
      return false
    }
    try {
      return originalSendWs(data)
    } catch (err) {
      this.bot?.logger?.warn?.('[SESSION-MANAGER] 发送 WebSocket 消息失败', err.message)
      return false
    }
  }
  Object.defineProperty(sessionManager, '__yunzaiSafeSendWs', { value: true })
}

function makeWebHook(adapter, req) {
    const appid = req.headers["x-bot-appid"]
    if (!adapter.appid.hasOwnProperty(appid))
      return Bot.makeLog("warn", "找不到对应Bot", appid)
    if (req.body?.d.hasOwnProperty("plain_token"))
      return adapter.makeWebHookSign(adapter.appid[appid].uin, req, adapter.appid[appid].info.secret)
    if (req.body.hasOwnProperty('t'))
      adapter.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
    req.res.send({ code: 0 })
  }

async function load(adapter) {
    Bot.express.use(`/${adapter.name}`, adapter.makeWebHook)
    Bot.express.quiet.push(`/${adapter.name}`)

    try {
      await inviteStore.init(config.inviteDB || 'level')
      Bot.makeLog('info', ['召回系统存储初始化完成', config.inviteDB || 'level'], 'QQBot-Plugin')
    } catch (err) {
      Bot.makeLog('error', ['召回系统存储初始化失败', err.message], 'QQBot-Plugin')
    }

    for (const token of config.token) {
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
    }
  }

export function installConnection(adapter) {
  adapter.getFriendMap = (id) => getFriendMap(adapter, id)
  adapter.getGroupMap = (id) => getGroupMap(adapter, id)
  adapter.getMemberMap = (id) => getMemberMap(adapter, id)
  adapter.connect = (token) => connect(adapter, token)
  adapter.makeWebHookSign = (id, req, secret) => makeWebHookSign(adapter, id, req, secret)
  adapter.makeWebHook = (req) => makeWebHook(adapter, req)
  adapter.load = () => load(adapter)
  adapter.makeRecord = (file) => makeRecord(adapter, file)
}
