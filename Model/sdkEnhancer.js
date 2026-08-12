import { createRequire } from 'module'

const require = createRequire(import.meta.url)

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
  let version = '1.2.3'

  try {
    const pkg = require('qq-official-bot/package.json')
    const nodeModulesVersion = pkg.version || '1.2.3'
    version = nodeModulesVersion
  } catch (e) {}

  return version
}

export function isSdk12() {
  return true
}

function enhanceWsAndBotInfo(sessionManager) {
  const originalGetWsUrl = sessionManager.getWsUrl.bind(sessionManager)

  sessionManager.getWsUrl = async function() {
    const customUrl = this.bot.config?.WsUrl || this.bot.config?.wsUrl
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - WsUrl: ${this.bot.config?.WsUrl}, wsUrl: ${this.bot.config?.wsUrl}, customUrl: ${customUrl}`)
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - 当前 wsUrl: ${this.wsUrl}, _wsUrl: ${this._wsUrl}`)

    if (customUrl && (customUrl.startsWith('ws://') || customUrl.startsWith('wss://'))) {
      this.bot.logger.info(`[ZYBOT-CLIENT] 使用自定义WsUrl: ${customUrl}`)
      this._wsUrl = customUrl
      this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - 设置 _wsUrl = ${customUrl}`)
      return this._wsUrl
    }
    this.bot.logger.debug(`[SDK-ENHANCER] getWsUrl - 使用原始方法获取 URL`)
    return originalGetWsUrl.call(this)
  }

  sessionManager.getBotInfo = async function() {
    try {
      if (this.bot.botService && this.bot.botService.getSelfInfo) {
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

function enhanceSdk12(sdk) {

  // 补全 SDK 事件映射：
  // - GROUP_MEMBER_ADD / GROUP_MEMBER_REMOVE（1<<24 群成员变化，SDK>=1.2.4 已内置，缺失时兜底）
  // - GROUP_JOIN_REQUEST（1<<25 用户申请加群，SDK 未内置，需手动映射为 request.group，sub_type=add）
  try {
    const eventsMod = require('qq-official-bot/lib/events/index.js')
    const QQEvent = eventsMod?.QQEvent
    if (QQEvent) {
      if (!QQEvent.GROUP_MEMBER_ADD) QQEvent.GROUP_MEMBER_ADD = 'notice.group.member.increase'
      if (!QQEvent.GROUP_MEMBER_REMOVE) QQEvent.GROUP_MEMBER_REMOVE = 'notice.group.member.decrease'
      if (!QQEvent.GROUP_JOIN_REQUEST) QQEvent.GROUP_JOIN_REQUEST = 'request.group'
      if (!QQEvent.SUBSCRIBE_MESSAGE_STATUS) QQEvent.SUBSCRIBE_MESSAGE_STATUS = 'notice.subscribe_message'
      if (eventsMod.EventParserMap && !eventsMod.EventParserMap.has('request.group')) {
        eventsMod.EventParserMap.set('request.group', function (event, result) {
          return Object.assign(result, {
            sub_type: result.sub_type || 'add',
            user_id: result.member_openid ?? result.user_id,
            group_id: result.group_openid ?? result.group_id,
            raw_user_id: result.member_openid,
            join_request_id: result.join_request_id ?? result.flag,
          })
        })
      }
      if (eventsMod.EventParserMap && !eventsMod.EventParserMap.has('notice.subscribe_message')) {
        eventsMod.EventParserMap.set('notice.subscribe_message', function (event, result) {
          return Object.assign(result, {
            sub_type: result.sub_type || 'status',
            user_id: result.openid ?? result.user_id,
            group_id: result.group_openid ?? result.group_id,
          })
        })
      }
    }
  } catch (e) {
    sdk.logger?.debug?.('[SDK-ENHANCER] 群事件映射补全失败', e?.message)
  }

  if (sdk.sessionManager) {
    enhanceWsAndBotInfo(sdk.sessionManager)

    // 群成员事件订阅兜底：确保 websocket 连接订阅中包含 1<<24（GROUP_MEMBER_ADD / GROUP_MEMBER_REMOVE）
    // 仅对配置了 GROUP_MEMBER intent（群机器人）时强制置位，SDK>=1.2.4 原生支持，此处为幂等兜底
    const originalGetValidIntends = sdk.sessionManager.getValidIntends?.bind(sdk.sessionManager)
    if (originalGetValidIntends) {
      sdk.sessionManager.getValidIntends = function () {
        let result = originalGetValidIntends()
        if ((this.bot?.config?.intents || []).includes('GROUP_MEMBER')) {
          result = result | (1 << 24)
        }
        return result
      }
    }

    if (sdk.sessionManager.authManager) {
      const originalFetchNewToken = sdk.sessionManager.authManager.fetchNewToken
      if (originalFetchNewToken) {
        const origFetchNewToken = originalFetchNewToken.bind(sdk.sessionManager.authManager)
        sdk.sessionManager.authManager.fetchNewToken = async function() {
          const tokenInfo = await origFetchNewToken()
          if (typeof tokenInfo.expires_in === 'string') {
            tokenInfo.expires_in = parseInt(tokenInfo.expires_in, 10) || 0
          }
          if (tokenInfo.expires_in < 30) return await this.fetchNewToken()
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
                this.bot.logger.debug("[AUTH] 自动刷新访问令牌")
                await this.refreshAccessToken()
              } catch (error) {
                this.bot.logger.error("[AUTH] 自动刷新令牌失败:", error)
                setTimeout(() => this.scheduleTokenRefresh(), 10000)
              }
            }, refreshTime)
            this.bot.logger.debug(`[AUTH] 令牌刷新已计划，将在 ${refreshTime / 1000} 秒后执行`)
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
        // 校验图片转存结果：转存失败则返回错误且不发送消息
        if (this.source?.forceVerifyImageResource) this.messagePayload.force_verify_image_resource = true
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

      if (buildResult.isFile) {
        buildResult.messagePayload.media = await this.uploadFile(endpointPath, buildResult)
      }

      return await this.sendRegularMessage(endpointPath, buildResult, options)
    }
  }

  // 接口域名增强：自定义 ApiUrl 优先，其次沙箱，默认使用官方正式域名 api.bot.qq.com（2026-08 起生效）
  const apiUrl = sdk.config?.ApiUrl
  if (sdk.request?.defaults) {
    if (typeof apiUrl === 'string' && apiUrl.startsWith('http')) {
      sdk.request.defaults.baseURL = apiUrl
    } else if (sdk.config?.sendbox || sdk.config?.sandbox) {
      sdk.request.defaults.baseURL = 'https://sandbox.api.sgroup.qq.com'
    } else {
      sdk.request.defaults.baseURL = 'https://api.bot.qq.com'
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
    this.logger?.debug('[sendPrivateMessage] 被调用')
    this.logger?.debug('[sendPrivateMessage] user_id:', user_id)
    this.logger?.debug('[sendPrivateMessage] message:', message)
    this.logger?.debug('[sendPrivateMessage] source:', JSON.stringify(source, null, 2))
    this.logger?.debug('[sendPrivateMessage] options:', options)
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

    if (this.messageService) {
      this.logger?.debug('[sendPrivateMessage] 使用 messageService.sendPrivateMessage')
      return await this.messageService.sendPrivateMessage(user_id, message, source, options)
    }

    throw new Error('messageService 不可用')
  }

  return sdk
}

export function enhanceSDK(sdk) {
  return enhanceSdk12(sdk)
}
