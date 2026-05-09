import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

let SDK_VERSION = null

const StreamInputMode = {
  REPLACE: "replace",
}

const StreamInputState = {
  GENERATING: 1,
  DONE: 10,
}

const StreamContentType = {
  MARKDOWN: "markdown",
}

export function getSDKVersion() {
  let version = '1.0.3'
  
  try {
    const pkg = require('qq-official-bot/package.json')
    const nodeModulesVersion = pkg.version || '1.0.3'
    version = nodeModulesVersion
  } catch (e) {}
  
  SDK_VERSION = version
  return version
}

export function isSdk12() {
  const version = getSDKVersion()
  
  const parts = version.split('.').map(Number)
  const target = [1, 0, 12]
  
  for (let i = 0; i < 3; i++) {
    if (parts[i] > target[i]) return true
    if (parts[i] < target[i]) return false
  }
  return true
}

function enhanceWsAndBotInfo(sessionManager, isSdk12 = false) {
  const originalGetWsUrl = sessionManager.getWsUrl.bind(sessionManager)
  
  sessionManager.getWsUrl = async function() {
    const customUrl = this.bot.config?.WsUrl || this.bot.config?.wsUrl
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - WsUrl: ${this.bot.config?.WsUrl}, wsUrl: ${this.bot.config?.wsUrl}, customUrl: ${customUrl}`)
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - 当前 wsUrl: ${this.wsUrl}, _wsUrl: ${this._wsUrl}, isSdk12: ${isSdk12}`)
    
    if (customUrl && (customUrl.startsWith('ws://') || customUrl.startsWith('wss://'))) {
      this.bot.logger.info(`[ZYBOT-CLIENT] 使用自定义WsUrl: ${customUrl}`)
      
      if (isSdk12) {
        this._wsUrl = customUrl
        this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - SDK 1.0.12: 设置 _wsUrl = ${customUrl}`)
        return this._wsUrl
      } else {
        this.wsUrl = customUrl
        this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - SDK 1.0.3: 设置 wsUrl = ${customUrl}`)
        return new Promise(resolve => resolve())
      }
    }
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - 使用原始方法获取 URL`)
    return originalGetWsUrl.call(this)
  }

  sessionManager.getBotInfo = async function() {
    try {
      if (isSdk12 && this.bot.botService && this.bot.botService.getSelfInfo) {
        this.BotInfo = await this.bot.botService.getSelfInfo()
      } else {
        const { data } = await this.bot.request.get("/users/@me")
        if (!data) throw new Error("获取Bot信息异常")
        this.BotInfo = data
      }
    } catch (error) {
      console.error('获取Bot信息失败:', error)
    }
  }
}

function enhanceSdk3Events() {
  try {
    const eventModule = require('qq-official-bot/lib/event/index.js')
    const messageModule = require('qq-official-bot/lib/event/message.js')
    eventModule.QQEvent.GROUP_MESSAGE_CREATE = 'message.group'
    eventModule.EventParserMap.set(eventModule.QQEvent.GROUP_MESSAGE_CREATE, messageModule.MessageEvent.parse)
  } catch (e) {}
}

function enhanceSdk3(sdk) {
  const originalConstructor = Object.getPrototypeOf(sdk).constructor
  Object.getPrototypeOf(sdk).constructor = function(opts) {
    originalConstructor.call(this, opts)
    const baseUrl = `${((config) => {
      if (config?.ApiUrl?.startsWith('http')) return config.ApiUrl
      if (config?.sendbox) return 'https://sandbox.api.sgroup.qq.com'
      return 'https://api.sgroup.qq.com'
    })(opts)}`
    if (this.request && this.request.defaults) {
      this.request.defaults.baseURL = baseUrl
    }
  }

  enhanceWsAndBotInfo(sdk.sessionManager, false)
  enhanceSdk3Events()

  const originalCheckNeedToRestart = sdk.sessionManager.checkNeedToRestart.bind(sdk.sessionManager)
  sdk.sessionManager.checkNeedToRestart = async function() {
    const originWsUrl = this.wsUrl
    const originAccessToken = this.access_token
    this.bot.logger.debug(`[SDK-ENHANCER] checkNeedToRestart - 原始 wsUrl: ${originWsUrl}, 原始 token: ${originAccessToken ? '存在' : '不存在'}`)

    await this.getAccessToken()
    await this.getWsUrl()
    this.bot.logger.debug(`[SDK-ENHANCER] checkNeedToRestart - 获取后 wsUrl: ${this.wsUrl}`)

    await this.getBotInfo()
    if (!this.bot.ws || ![0, 1].includes(this.bot.ws.readyState)) {
      this.bot.logger.debug(`[SDK-ENHANCER] checkNeedToRestart - ws 不存在或未就绪，需要重启`)
      return true
    }
    const checked = originWsUrl !== this.wsUrl || originAccessToken !== this.access_token
    this.bot.logger.debug(`[SDK-ENHANCER] checkNeedToRestart - URL变化: ${originWsUrl !== this.wsUrl}, Token变化: ${originAccessToken !== this.access_token}`)
    if (checked) {
      this.bot.logger.debug(`[SDK-ENHANCER] checkNeedToRestart - 需要重启，停止现有连接`)
      await this.stop()
    }
    return checked
  }

  const originalStartListen = sdk.sessionManager.startListen.bind(sdk.sessionManager)
  sdk.sessionManager.startListen = function() {
    const botInfo = this.BotInfo
    const originalOnMessage = this.bot.ws.on
    const self = this

    this.bot.ws.on = function(event, handler) {
      if (event === 'message') {
        const wrappedHandler = (data) => {
          const wsRes = JSON.parse(data)
          if (wsRes.t === 'READY' && botInfo && self.bot.config?.WsUrl?.startsWith('ws')) {
            wsRes.d.user = { id: botInfo.id, username: botInfo.username, avatar: botInfo.avatar, bot: true }
            data = JSON.stringify(wsRes)
          }
          handler(data)
        }
        return originalOnMessage.call(this, event, wrappedHandler)
      }
      return originalOnMessage.call(this, event, handler)
    }
    originalStartListen.call(this)
  }

  const Sender = require('qq-official-bot/lib/entries/sender.js').Sender
  const originalSenderConstructor = Sender.prototype.constructor
  Sender.prototype.constructor = function(bot, baseUrl, message, source = {}) {
    this.bot = bot
    originalSenderConstructor.call(this, bot, baseUrl, message, source)
    this.smallbtn = source.smallbtn
  }
  
  const originalProcessMessage = Sender.prototype.processMessage
  Sender.prototype.processMessage = async function() {
    await originalProcessMessage.call(this)
    const smallbtn = this.smallbtn || this.source?.smallbtn
    if (smallbtn && this.messagePayload.keyboard) {
      if (!this.messagePayload.keyboard.content) {
        this.messagePayload.keyboard.content = {}
      }
      this.messagePayload.keyboard.content.style = { font_size: "small" }
    }
  }
  
  sdk.sendRecallMessage = async function(endpointPath, message, source = {}) {
    const sender = new Sender(this, endpointPath, message, source)
    await sender.processMessage()
    
    if (sender.messagePayload) {
      delete sender.messagePayload.msg_id
      delete sender.messagePayload.event_id
      sender.messagePayload.is_wakeup = true
    }
    
    if (sender.isFile) {
      const { data: result } = await this.request.post(endpointPath + '/files', sender.filePayload)
      return result
    }
    
    const { data: result } = await this.request.post(endpointPath + '/messages', sender.messagePayload, {
      headers: { 'Content-Type': sender.contentType }
    })
    return result
  }

  sdk.sendPrivateStreamMessage = async function(user_id, message, source, options = {}) {
    let chunkSize = options.chunkSize || Math.ceil(message.length / 2)
    const delay = options.delay || 100
    this.logger?.info(`开始发送流式私聊消息到用户(${user_id}), 总长度: ${message.length}字符`)
    let streamMsgId = null
    let index = 0
    let currentContent = ""

    try {
      for (let i = 0; i < message.length; i += chunkSize) {
        const chunk = message.substring(i, i + chunkSize)
        currentContent += chunk

        const req = {
          input_mode: StreamInputMode.REPLACE,
          input_state: i + chunkSize >= message.length ? StreamInputState.DONE : StreamInputState.GENERATING,
          content_type: StreamContentType.MARKDOWN,
          content_raw: currentContent,
          event_id: source?.event_id || `event_${Date.now()}`,
          msg_id: source?.id || `msg_${Date.now()}`,
          index: index++,
        }

        if (streamMsgId) req.stream_msg_id = streamMsgId

        const response = await this.request.post(`/v2/users/${user_id}/stream_messages`, req)

        if (!streamMsgId && response.data && response.data.id) streamMsgId = response.data.id

        this.logger?.debug(`发送分片 ${index}/${Math.ceil(message.length / chunkSize)}: ${currentContent.length}字符`)

        if (i + chunkSize < message.length) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      this.logger?.info(`流式私聊消息发送完成: ${currentContent.length}字符`)
      return { id: streamMsgId, content: currentContent }

    } catch (error) {
      this.logger?.error(`流式消息发送失败: ${error.message}`)
      throw error
    }
  }

  sdk.sendPrivateMessage = async function(user_id, message, source, options = {}) {
    this.logger?.debug('[SDK3 sendPrivateMessage] 被调用')
    this.logger?.debug('[SDK3 sendPrivateMessage] user_id:', user_id)
    this.logger?.debug('[SDK3 sendPrivateMessage] message:', message)
    this.logger?.debug('[SDK3 sendPrivateMessage] source:', JSON.stringify(source, null, 2))
    this.logger?.debug('[SDK3 sendPrivateMessage] options:', options)
    if (options.stream) {
      try {
        let content = await this.processMessage?.(message) || message
        if (!content) throw new Error()
        if (Array.isArray(content)) {
          content = content.map(item => {
            if (item.type === 'markdown') return item.content || ''
            if (item.type === 'text') return item.text || ''
            return ''
          }).join('')
        }
        if (!content || typeof content !== 'string') throw new Error('流式消息内容必须是字符串')
        const result = await this.sendPrivateStreamMessage(user_id, content, source, options)
        return result
      } catch (e) {
        this.logger?.error(`流式失败发送消息,转为普通消息: ${e.message}`)
      }
    }
    this.logger?.debug('[SDK3 sendPrivateMessage] 创建 Sender 实例')
    const sender = new Sender(this, `/v2/users/${user_id}`, message, source)
    const result = await sender.sendMsg()
    this.logger?.debug('[SDK3 sendPrivateMessage] 发送完成，sender.messagePayload:', JSON.stringify(sender.messagePayload, null, 2))
    this.logger?.info(`send to User(${user_id}): ${sender.brief}`)
    return result
  }

  return sdk
}

function enhanceSdk12(sdk) {

  if (sdk.sessionManager) {
    enhanceWsAndBotInfo(sdk.sessionManager, true)

    if (sdk.sessionManager.authManager) {
      const originalFetchNewToken = sdk.sessionManager.authManager.fetchNewToken
      if (originalFetchNewToken) {
        const origFetchNewToken = originalFetchNewToken.bind(sdk.sessionManager.authManager)
        sdk.sessionManager.authManager.fetchNewToken = async function() {
          const tokenInfo = await origFetchNewToken()
          if (typeof tokenInfo.expires_in === 'string') {
            tokenInfo.expires_in = parseInt(tokenInfo.expires_in, 10) || 0
          }
          if (tokenInfo.expires_in < 300) return await this.fetchNewToken()
          return tokenInfo
        }
      }

      const originalScheduleTokenRefresh = sdk.sessionManager.authManager.scheduleTokenRefresh
      if (originalScheduleTokenRefresh) {
        const origScheduleTokenRefresh = originalScheduleTokenRefresh.bind(sdk.sessionManager.authManager)
        sdk.sessionManager.authManager.scheduleTokenRefresh = function() {
          if (this.refreshTimer) clearTimeout(this.refreshTimer)
          if (!this.currentToken) return
          const expiresIn = parseInt(this.currentToken.expires_in, 10) || 0
          let refreshTime = (expiresIn - this.config.tokenRefreshBuffer) * 1000
          if (refreshTime <= 0 && expiresIn > 0) refreshTime = 1000
          if (refreshTime > 0) {
            this.refreshTimer = setTimeout(async () => {
              try {
                this.logger.debug("[AUTH] 自动刷新访问令牌")
                await this.refreshAccessToken()
              } catch (error) {
                this.logger.error("[AUTH] 自动刷新令牌失败:", error)
                setTimeout(() => this.scheduleTokenRefresh(), 10000)
              }
            }, refreshTime)
            this.logger.debug(`[AUTH] 令牌刷新已计划，将在 ${refreshTime / 1000} 秒后执行`)
          }
        }
      }

      const originalSetToken = sdk.sessionManager.authManager.setToken
      if (originalSetToken) {
        const origSetToken = originalSetToken.bind(sdk.sessionManager.authManager)
        sdk.sessionManager.authManager.setToken = function(tokenInfo) {
          if (typeof tokenInfo.expires_in === 'string') {
            tokenInfo.expires_in = parseInt(tokenInfo.expires_in, 10) || 0
          }
          tokenInfo.expires_at = Date.now() + (tokenInfo.expires_in * 1000)
          origSetToken(tokenInfo)
        }
      }
    }

    const originalStart = sdk.sessionManager.start.bind(sdk.sessionManager)
    sdk.sessionManager.start = async function() {
      if (this.receiver && this.receiver.handleReadyEvent) {
        const originalHandleReadyEvent = this.receiver.handleReadyEvent.bind(this.receiver)
        this.receiver.handleReadyEvent = (packet) => {
          if (this.bot.config?.WsUrl?.startsWith('ws') && this.BotInfo) {
            packet.d.user = { id: this.BotInfo.id, username: this.BotInfo.username, avatar: this.BotInfo.avatar, bot: true }
          }
          return originalHandleReadyEvent(packet)
        }
      }

      if (this.authManager && this.authManager.refreshAccessToken) {
        await this.authManager.refreshAccessToken()
      } else if (this.getAccessToken) {
        await this.getAccessToken()
      }
      await this.getBotInfo()

      if (this.receiver) {
        return new Promise(resolve => {
          this.receiver.emit('start', this)
          this.receiver.on('ready', resolve)
        })
      }
      
      return originalStart()
    }
  }

  const forumEvents = ['notice.forum.post.create', 'notice.forum.post.delete', 'notice.forum.reply.create', 'notice.forum.reply.delete']
  for (const event of forumEvents) {
    sdk.on(event, (payload) => {
      if (event.includes('post.create')) sdk.emit('FORUM_POST_CREATE', payload)
      else if (event.includes('post.delete')) sdk.emit('FORUM_POST_DELETE', payload)
      else if (event.includes('reply.create')) sdk.emit('FORUM_REPLY_CREATE', payload)
      else if (event.includes('reply.delete')) sdk.emit('FORUM_REPLY_DELETE', payload)
    })
  }

  let MessageBuilder
  try {
    MessageBuilder = require('qq-official-bot/lib/message/builder.js').MessageBuilder
    if (MessageBuilder) {
      const originalBuilderConstructor = MessageBuilder.prototype.constructor
      MessageBuilder.prototype.constructor = function(appid, isGuild, source) {
        this.bot = null
        originalBuilderConstructor.call(this, appid, isGuild, source)
        this.smallbtn = source?.smallbtn
      }
      
      const originalProcessButtons = MessageBuilder.prototype.processButtons
      MessageBuilder.prototype.processButtons = async function() {
        await originalProcessButtons.call(this)
        const smallbtn = this.smallbtn || this.source?.smallbtn
        if (smallbtn && this.messagePayload.keyboard) {
          if (!this.messagePayload.keyboard.content) {
            this.messagePayload.keyboard.content = {}
          }
          this.messagePayload.keyboard.content.style = { font_size: "small" }
        }
      }
    }
  } catch (e) {}
  
  if (sdk.messageService) {
    sdk.messageService.sendRecallMessage = async function(endpointPath, message, source = {}, options = {}) {
      if (!MessageBuilder) return this.sendMessage(endpointPath, message, source, options)
      
      const messageBuilder = new MessageBuilder(this.appid, !endpointPath.startsWith('/v2'), source)
      const buildResult = await messageBuilder.build(message)
      
      if (buildResult.messagePayload) {
        delete buildResult.messagePayload.msg_id
        delete buildResult.messagePayload.event_id
        buildResult.messagePayload.is_wakeup = true
      }
      
      if (buildResult.isFile) return await this.sendFile(endpointPath, buildResult)
      return await this.sendRegularMessage(endpointPath, buildResult, options)
    }
  }

  if (sdk.request && sdk.request.interceptors) {
    sdk.request.interceptors.request.use(function(config) {
      if (sdk.sessionManager && sdk.sessionManager.authManager && sdk.sessionManager.authManager.currentToken) {
        config.headers.Authorization = `QQBot ${sdk.sessionManager.authManager.currentToken.access_token}`
      }
      return config
    }, function(error) { return Promise.reject(error) })

    sdk.request.interceptors.response.use(function(response) { return response }, async function(error) {
      if (error.response && error.response.data && error.response.data.code === 11244) {
        try {
          if (sdk.sessionManager && sdk.sessionManager.authManager && sdk.sessionManager.authManager.refreshAccessToken) {
            await sdk.sessionManager.authManager.refreshAccessToken()
            const originalRequest = error.config
            originalRequest.headers.Authorization = `QQBot ${sdk.sessionManager.authManager.currentToken.access_token}`
            return sdk.request(originalRequest)
          }
        } catch (refreshError) {
          return Promise.reject(error)
        }
      }
      return Promise.reject(error)
    })
  }

  sdk.sendPrivateStreamMessage = async function(user_id, message, source, options = {}) {
    let chunkSize = options.chunkSize || Math.ceil(message.length / 2)
    const delay = options.delay || 100
    this.logger?.info(`开始发送流式私聊消息到用户(${user_id}), 总长度: ${message.length}字符`)
    let streamMsgId = null
    let index = 0
    let currentContent = ""

    try {
      for (let i = 0; i < message.length; i += chunkSize) {
        const chunk = message.substring(i, i + chunkSize)
        currentContent += chunk

        const req = {
          input_mode: StreamInputMode.REPLACE,
          input_state: i + chunkSize >= message.length ? StreamInputState.DONE : StreamInputState.GENERATING,
          content_type: StreamContentType.MARKDOWN,
          content_raw: currentContent,
          event_id: source?.event_id || `event_${Date.now()}`,
          msg_id: source?.id || `msg_${Date.now()}`,
          index: index++,
        }

        if (streamMsgId) req.stream_msg_id = streamMsgId

        const response = await this.request.post(`/v2/users/${user_id}/stream_messages`, req)

        if (!streamMsgId && response.data && response.data.id) streamMsgId = response.data.id

        this.logger?.debug(`发送分片 ${index}/${Math.ceil(message.length / chunkSize)}: ${currentContent.length}字符`)

        if (i + chunkSize < message.length) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      this.logger?.info(`流式私聊消息发送完成: ${currentContent.length}字符`)
      return { id: streamMsgId, content: currentContent }

    } catch (error) {
      this.logger?.error(`流式消息发送失败: ${error.message}`)
      throw error
    }
  }

  sdk.sendPrivateMessage = async function(user_id, message, source, options = {}) {
    this.logger?.debug('[SDK12 sendPrivateMessage] 被调用')
    this.logger?.debug('[SDK12 sendPrivateMessage] user_id:', user_id)
    this.logger?.debug('[SDK12 sendPrivateMessage] message:', message)
    this.logger?.debug('[SDK12 sendPrivateMessage] source:', JSON.stringify(source, null, 2))
    this.logger?.debug('[SDK12 sendPrivateMessage] options:', options)
    if (options.stream) {
      try {
        let content = message
        if (this.processMessage) {
          content = await this.processMessage(message)
        }
        if (!content) throw new Error()
        const result = await this.sendPrivateStreamMessage(user_id, content, source, options)
        return result
      } catch (e) {
        this.logger?.error(`流式失败发送消息,转为普通消息`)
        this.logger?.info?.(message)
      }
    }
    
    if (MessageBuilder) {
      this.logger?.debug('[SDK12 sendPrivateMessage] 使用 MessageBuilder')
      const messageBuilder = new MessageBuilder(this.appid, false, source)
      const buildResult = await messageBuilder.build(message)
      this.logger?.debug('[SDK12 sendPrivateMessage] buildResult:', JSON.stringify(buildResult, null, 2))
      const endpointPath = `/v2/users/${user_id}`
      
      if (buildResult.isFile) {
        return await this.sendFile(endpointPath, buildResult)
      }
      return await this.sendRegularMessage(endpointPath, buildResult, options)
    } else {
      this.logger?.debug('[SDK12 sendPrivateMessage] 回退使用 Sender')
      const sender = new Sender(this, `/v2/users/${user_id}`, message, source)
      const result = await sender.sendMsg()
      this.logger?.info(`send to User(${user_id}): ${sender.brief}`)
      return result
    }
  }

  return sdk
}

export function enhanceSDK(sdk) {
  return isSdk12() ? enhanceSdk12(sdk) : enhanceSdk3(sdk)
}
