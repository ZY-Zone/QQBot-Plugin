import crypto from 'crypto'
import fs from 'node:fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

let SDK_VERSION = null

const FILE_TYPE_MAP = {
  '89504E47': '.png',
  '47494638': '.gif',
  'FFD8FF': '.jpg',
  '25504446': '.pdf',
  '494433': '.mp3',
  '52494646': '.wav',
  '00000018': '.mp4',
  '3026B2758E66CF11': '.wmv',
  'D0CF11E0': '.doc',
  '504B0304': '.zip',
  '7B22': '.json',
  'EFBBBF': '.txt',
  'FFFE': '.txt',
  'FEFF': '.txt'
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

function getBase64FromLocal(filepath) {
  return fs.readFileSync(filepath.replace("file://", "")).toString('base64')
}

async function getBase64FromWeb(url) {
  const https = require('https')
  const urlObj = new URL(url)
  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }
    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')))
    })
    req.on('error', reject)
    req.end()
  })
}

function getFileBase64(file) {
  if (file instanceof Uint8Array) return Buffer.from(file).toString('base64')
  if (Buffer.isBuffer(file)) return file.toString('base64')
  if (file.startsWith('http')) return getBase64FromWeb(file)
  if (file.startsWith('base64://')) return file.replace('base64://', '')
  try { return getBase64FromLocal(file) } catch { return file }
}

async function getFileBuffer(file_data) {
  if (file_data instanceof Uint8Array) return Buffer.from(file_data)
  if (Buffer.isBuffer(file_data)) return file_data
  if (file_data.startsWith('http')) {
    const res = await getBase64FromWeb(file_data)
    return Buffer.from(res, 'base64')
  }
  if (file_data.startsWith('base64://')) {
    return Buffer.from(file_data.replace('base64://', ''), 'base64')
  }
  try {
    const res = await getBase64FromLocal(file_data)
    return Buffer.from(res, 'base64')
  } catch {
    return Buffer.from(file_data)
  }
}

function extractFileName(file_data) {
  let file_name = ''
  let file_ext = ''
  
  if (typeof file_data !== 'string') return { file_name, file_ext }
  
  if (file_data.startsWith('file://')) {
    const path = require('path')
    const localPath = file_data.replace('file://', '')
    const baseName = path.basename(localPath)
    if (baseName) {
      file_name = baseName
      file_ext = path.extname(baseName)
    }
  } else if (file_data.startsWith('http')) {
    try {
      const url = new URL(file_data)
      const baseName = url.pathname.split('/').pop()
      if (baseName && baseName.includes('.')) {
        file_name = baseName
        file_ext = baseName.substring(baseName.lastIndexOf('.'))
      }
    } catch {}
  } else if (!file_data.startsWith('base64://')) {
    try {
      const path = require('path')
      const baseName = path.basename(file_data)
      if (baseName) {
        file_name = baseName
        file_ext = path.extname(baseName)
      }
    } catch {}
  }
  
  return { file_name, file_ext }
}

function detectFileExtension(fileBuffer) {
  const header = fileBuffer.toString('hex', 0, 16).toUpperCase()
  for (const [signature, ext] of Object.entries(FILE_TYPE_MAP)) {
    if (header.startsWith(signature)) return ext
  }
  return ''
}

function generateFileName(file_name, file_ext) {
  if (!file_ext) file_ext = ''
  
  if (!file_name) {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substr(2, 6)
    file_name = `up_${timestamp}_${random}${file_ext}`
  }
  
  if (file_name.length > 50) {
    const path = require('path')
    const ext = path.extname(file_name)
    const nameWithoutExt = file_name.substring(0, file_name.lastIndexOf('.'))
    const shortName = nameWithoutExt.substring(0, 30) + '...'
    file_name = shortName + ext
  }
  
  return file_name
}

async function uploadFileInChunks(request, target_id, target_type, fileBuffer, file_type, originalUploadFn, options = {}) {
  const file_size = fileBuffer.length
  const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex')
  const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex')
  const md5_10m = crypto.createHash('md5').update(fileBuffer.slice(0, 10002432)).digest('hex')
  
  const { file_name: extractedName, file_ext: extractedExt } = extractFileName(options.fileData)
  const detectedExt = detectFileExtension(fileBuffer)
  const file_name = generateFileName(extractedName || '', extractedExt || detectedExt)

  try {
    const { data: prepareResult } = await request.post(`/v2/${target_type}s/${target_id}/upload_prepare`, {
      file_type, file_name, file_size, md5, sha1, md5_10m
    })

    const { upload_id, parts } = prepareResult

    for (const part of parts) {
      const { index, presigned_url } = part
      const start = (index - 1) * prepareResult.block_size
      const end = Math.min(start + prepareResult.block_size, file_size)
      const partBuffer = fileBuffer.slice(start, end)

      const https = require('https')
      const urlObj = new URL(presigned_url)
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          path: urlObj.pathname + urlObj.search,
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': partBuffer.length }
        }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve()
          else reject(new Error(`HTTP ${res.statusCode}`))
        })
        req.on('error', reject)
        req.write(partBuffer)
        req.end()
      })

      await request.post(`/v2/${target_type}s/${target_id}/upload_part_finish`, {
        upload_id, part_index: index, block_size: partBuffer.length,
        md5: crypto.createHash('md5').update(partBuffer).digest('hex')
      })
    }

    const { data: filesResult } = await request.post(`/v2/${target_type}s/${target_id}/files`, {
      upload_id, srv_send_msg: options.srvSendMsg ?? false
    })

    return filesResult
  } catch (error) {
    console.error('分片上传失败:', error)
    if (originalUploadFn) {
      return originalUploadFn(fileBuffer, options)
    }
    const base64Data = fileBuffer.toString('base64')
    const { data: result } = await request.post(`/v2/${target_type}s/${target_id}/files`, {
      file_type, file_data: base64Data, srv_send_msg: false
    })
    return result
  }
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

  const originalUploadMedia = sdk.uploadMedia.bind(sdk)
  sdk.uploadMedia = async function(target_id, target_type, file_data, file_type, decode = false) {
    const fileBuffer = await getFileBuffer(file_data)
    const result = await uploadFileInChunks(
      this.request, target_id, target_type, fileBuffer, file_type,
      null, { fileData: file_data }
    )
    if (!decode) return result
  }

  enhanceWsAndBotInfo(sdk.sessionManager, false)

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

  sdk.sendRecallMessage = async function(endpointPath, message) {
    const Sender = require('qq-official-bot/lib/entries/sender.js').Sender
    const sender = new Sender(this, endpointPath, message)
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

  return sdk
}

function enhanceSdk12(sdk) {
  let MessageBuilder = null
  let fileUtils = null
  try {
    MessageBuilder = require('qq-official-bot/lib/message/builder.js').MessageBuilder
    fileUtils = require('qq-official-bot/lib/utils/file.js')
  } catch {}

  function patchMessageBuilderForFileType() {
    if (!MessageBuilder) return
    const proto = MessageBuilder.prototype
    if (proto.__qqBotAdapterFileMediaPatch) return
    proto.__qqBotAdapterFileMediaPatch = true

    proto.getMediaType = function(type) {
      return ['image', 'video', 'audio', 'file'].indexOf(type) + 1
    }

    const origProcessElement = proto.processElement
    proto.processElement = async function(elem) {
      if (elem?.type === 'file') return await this.handleMedia(elem)
      return await origProcessElement.call(this, elem)
    }

    const origHandleMedia = proto.handleMedia
    proto.handleMedia = async function(elem) {
      await origHandleMedia.call(this, elem)
      const fileRef = elem?.data?.file
      if (!this.isGuild && this.isFile && fileRef != null && this.filePayload) {
        this.filePayload._qqAdapterFileRef = fileRef
        this.filePayload._qqAdapterIsReply = !!(this.messagePayload.msg_id || this.messagePayload.event_id)
      }
    }
  }

  function patchMessageServiceForV2FileUpload() {
    if (!sdk.messageService) return
    const ms = sdk.messageService
    if (ms.__qqAdapterSendMessagePatch) return
    ms.__qqAdapterSendMessagePatch = true

    const orig = ms.sendMessage.bind(ms)
    ms.sendMessage = async function(endpointPath, message, source, options = {}) {
      if (!MessageBuilder) return orig(endpointPath, message, source, options)
      
      const messageBuilder = new MessageBuilder(this.appid, !endpointPath.startsWith('/v2'), source)
      const buildResult = await messageBuilder.build(message)

      const fp = buildResult.filePayload
      const ref = fp?._qqAdapterFileRef
      if (ref != null && endpointPath.startsWith('/v2')) {
        delete fp._qqAdapterFileRef
        const isReply = fp._qqAdapterIsReply
        delete fp._qqAdapterIsReply

        const m = /^\/v2\/(users|groups)\/([^/]+)/.exec(endpointPath)
        if (m) {
          const targetType = m[1] === 'users' ? 'user' : 'group'
          const targetId = m[2]
          const uploadResult = await this.fileProcessor.uploadMedia(ref, {
            targetType, targetId, fileType: fp.file_type, sendMessage: false
          })
          if (isReply) {
            buildResult.isFile = false
            buildResult.messagePayload.media = { file_info: uploadResult.file_info }
          } else {
            const fi = uploadResult?.file_info
            fp.file_data = typeof fi === 'string' && fi.length ? fi : uploadResult
            if (fp.srv_send_msg === undefined) fp.srv_send_msg = true
          }
        } else {
          fp.file_data = await Promise.resolve(fileUtils.getFileBase64(ref))
          if (fp.srv_send_msg === undefined) fp.srv_send_msg = true
        }
      } else if (fp?._qqAdapterFileRef != null) {
        delete fp._qqAdapterFileRef
        delete fp._qqAdapterIsReply
      }

      if (buildResult.isFile) return await this.sendFile(endpointPath, buildResult)
      return await this.sendRegularMessage(endpointPath, buildResult, options)
    }
  }

  patchMessageBuilderForFileType()

  if (sdk.messageService && sdk.messageService.fileProcessor) {
    const originalUploadMedia = sdk.messageService.fileProcessor.uploadMedia.bind(sdk.messageService.fileProcessor)
    sdk.messageService.fileProcessor.uploadMedia = async function(fileData, options) {
      const fileBuffer = await getFileBuffer(fileData)
      return uploadFileInChunks(
        this.request, options.targetId, options.targetType, fileBuffer, options.fileType,
        (buf, opts) => originalUploadMedia(buf, opts),
        { fileData, srvSendMsg: options.sendMessage }
      )
    }
  }

  patchMessageServiceForV2FileUpload()

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

  if (sdk.messageService) {
    sdk.messageService.sendRecallMessage = async function(endpointPath, message, source, options = {}) {
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

  return sdk
}

export function enhanceSDK(sdk) {
  return isSdk12() ? enhanceSdk12(sdk) : enhanceSdk3(sdk)
}