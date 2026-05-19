import _ from 'lodash'
import fs from 'node:fs'
import crypto from 'node:crypto'
import QRCode from 'qrcode'
import fetch from 'node-fetch'
import { join } from 'node:path'
import imageSize from 'image-size'
import { randomUUID } from 'node:crypto'
import { encode as encodeSilk, isSilk } from 'silk-wasm'
import { Dau, importJS, Runtime, Handler, config, configSave, refConfig, splitMarkDownTemplate, getMustacheTemplating } from './Model/index.js'
import { Bot as QQBot } from 'qq-official-bot'
import { enhanceSDK, isSdk12, getSDKVersion } from './Model/sdkEnhancer.js'

const startTime = new Date()
logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

const userIdCache = {}
const markdown_template = await importJS('Model/template/markdownTemplate.js', 'default')
const TmplPkg = await importJS('templates/index.js')
const URL_REGEXP = /(?<!\[(.*?)\]\()https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?/g
const URL_REGEXP_FULL = /(?<!\[(.*?)\]\()(?<!<)https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?(?!>)/g
let sharp
if (config.imageLength) try {
  sharp = (await import("sharp")).default
} catch (err) {
  Bot.makeLog("error", ["sharp 导入错误，图片压缩关闭", err], "QQBot-Plugin")
}

function pickImageSizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false

  const source = options.data && typeof options.data === 'object' && !Array.isArray(options.data)
    ? { ...options.data, ...options }
    : options

  const result = {}
  for (const key of ['width', 'height', 'scale']) {
    const value = Number(source[key])
    if (Number.isFinite(value) && value > 0) result[key] = value
  }
  return Object.keys(result).length ? result : false
}

function patchSegmentImageSizeOptions() {
  const segment = globalThis.segment
  if (!segment || typeof segment.image !== 'function' || segment.image.__qqbotImageSizePatched) return

  const originImage = segment.image
  const patchedImage = function (file, options, ...args) {
    const sizeOptions = pickImageSizeOptions(options)
    const image = sizeOptions
      ? originImage.call(this, file, ...args)
      : originImage.call(this, file, options, ...args)

    if (sizeOptions && image && typeof image === 'object') {
      if (image.data && typeof image.data === 'object' && !Array.isArray(image.data)) {
        Object.assign(image.data, sizeOptions)
      } else {
        Object.assign(image, sizeOptions)
      }
    }

    return image
  }

  Object.defineProperty(patchedImage, '__qqbotImageSizePatched', { value: true })
  segment.image = patchedImage
}

patchSegmentImageSizeOptions()

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = 'QQbot v26.4.26.' + getSDKVersion()

    const toQRCode = config.toQRCode
    if (toQRCode === true) {
      this.toQRCodeRegExp = URL_REGEXP
    } else if (toQRCode === 'url') {
      this.toQRCodeRegExp = false
      this.toQRCodeMode = 'url'
    } else if (toQRCode === false) {
      this.toQRCodeRegExp = false
    } else {
      this.toQRCodeRegExp = new RegExp(toQRCode, 'g')
    }

    this.sep = config.sep || ((process.platform == 'win32') && '') || ':'
    this.rawgroup = {}
    this.appid = {}
    this.useSdk12 = isSdk12()
  }

  normalizeSdkMessage(segments) {
    if (!Array.isArray(segments)) return []
    return segments.map(seg => {
      if (seg == null || typeof seg !== 'object') return seg
      const inner = seg.data
      if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
        const { data: _, ...rest } = seg
        return { ...rest, ...inner }
      }
      return { ...seg }
    })
  }

  wrapSegmentForSdk12(elem) {
    if (elem == null || typeof elem !== 'object') return elem
    if (typeof elem.type !== 'string') return elem
    const d = elem.data
    if (d != null && typeof d === 'object' && !Array.isArray(d)) return elem
    const { type, ...rest } = elem
    return { type, data: rest }
  }

  wrapOutgoingMessageForSdk12(message) {
    if (!this.useSdk12) return message
    if (Array.isArray(message)) return message.map(s => this.wrapSegmentForSdk12(s))
    if (message != null && typeof message === 'object' && typeof message.type === 'string')
      return this.wrapSegmentForSdk12(message)
    return message
  }

  async makeRecord(file) {
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

  convertURL(url) {
    if (url == null) return '';
    const urlStr = String(url);
    const parts = urlStr.split('://');
    if (parts.length === 1) return urlStr.toUpperCase();
    const protocol = parts[0].toLowerCase();
    const rest = parts.slice(1).join('://');
    const [hostPart, remaining = ''] = rest.split(/[/?#]/);
    const separatorIndex = rest.indexOf(hostPart) + hostPart.length;
    return (
      protocol + '://' +
      hostPart.toUpperCase() +
      rest.slice(separatorIndex)
    );
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace('data:image/png;base64,', 'base64://')
  }

  async makeRawMarkdownText(data, text, button) {
    if (this.toQRCodeMode === 'url') {
      text = text.replace(URL_REGEXP_FULL, '<$&>')
    } else if (this.toQRCodeRegExp) {
      const match = text.match(this.toQRCodeRegExp)
      if (match) {
        for (const url of match) {
          button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
          const img = await this.makeMarkdownImage(data, await this.makeQRCode(url), '二维码')
          text = text.replace(url, `${img.des}${img.url}`)
        }
      }
    }
    return text.replace(/@\u200B/g, '@').replace(/<qqbot-\u200B/g, "<qqbot-")
  }

  async makeBotImage(file) {
    if (config.toBotUpload) {
      for (const i of Bot.uin) {
        if (!Bot[i].uploadImage) continue
        try {
          const image = await Bot[i].uploadImage(file)
          if (image.url) return image
        } catch (err) {
          Bot.makeLog('error', ['Bot', i, '图片上传错误', file, err])
        }
      }
    }
  }

  async uploadToTencentCOS(buffer) {
    try {
      const fetchImpl = typeof fetch !== 'undefined' ? fetch : await import('node-fetch').then(module => module.default);
      const getResponse = await fetchImpl(`https://ci-exhibition.cloud.tencent.com/samples/createUploadKey?ext=png&ciProcess=sensitive-content-recognition`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 22041216C Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.179 Mobile Safari/537.36',
          'sec-ch-ua-platform': '"Android"',
          'origin': 'https://cloud.tencent.com',
          'x-requested-with': 'mark.via',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://cloud.tencent.com/act/pro/ciExhibition?from=15775&tab=contentReview&sub=pictureReview'
        }
      });
      if (!getResponse.ok) {
        throw new Error(`获取上传凭证失败: ${getResponse.status}`);
      }
      const uploadData = await getResponse.json();
      if (!uploadData?.data?.key || !uploadData?.data?.uploadAuthorization) {
        throw new Error('获取腾讯 COS 上传凭证失败：返回数据格式异常');
      }
      const uploadKey = uploadData.data.key;
      const uploadAuth = uploadData.data.uploadAuthorization;
      const uploadUrl = "https://ci-h5-demo-1258125638.cos.ap-chengdu.myqcloud.com/" + uploadKey;
      const putResponse = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': uploadAuth,
          'Content-Length': buffer.length.toString(),
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 22041216C Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.179 Mobile Safari/537.36',
          'sec-ch-ua-platform': '"Android"',
          'origin': 'https://cloud.tencent.com',
          'x-requested-with': 'mark.via',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://cloud.tencent.com/act/pro/ciExhibition?from=15775&tab=contentReview&sub=pictureReview'
        },
        body: buffer
      });
      if (putResponse.status === 200) {
        const finalImageUrl = uploadUrl.startsWith('http')
          ? uploadUrl
          : 'https://' + uploadUrl;
        return { success: true, url: finalImageUrl };
      } else {
        Bot.makeLog('error', ['腾讯 COS 上传失败', putResponse.status], 'QQBot-Plugin');
        throw new Error(`COS 上传返回异常状态码: ${putResponse.status}`);
      }
    } catch (error) {
      Bot.makeLog('error', ['腾讯 COS 上传失败', error.message], 'QQBot-Plugin');
      return {
        success: false,
        error: error.message
      };
    }
  }

  async makeMarkdownImage(data, file, summary = '图片', options = {}) {
    const buffer = await Bot.Buffer(file)
    const image =
      await this.uploadToTencentCOS(buffer) ||
      await this.makeBotImage(buffer) ||
      { url: await Bot.fileToUrl(file) }

    if (!image.width || !image.height) {
      try {
        const size = imageSize(buffer)
        image.width = size.width
        image.height = size.height
      } catch (err) {
        Bot.makeLog('error', ['图片分辨率检测错误', file, err], data.self_id)
      }
    }

    const imageSizeOptions = pickImageSizeOptions(options) || {}
    const scale = imageSizeOptions.scale || config.markdownImgScale

    if (imageSizeOptions.width && imageSizeOptions.height) {
      image.width = Math.floor(imageSizeOptions.width)
      image.height = Math.floor(imageSizeOptions.height)
    } else if (imageSizeOptions.width && image.width && image.height) {
      image.height = Math.floor(image.height * imageSizeOptions.width / image.width)
      image.width = Math.floor(imageSizeOptions.width)
    } else if (imageSizeOptions.height && image.width && image.height) {
      image.width = Math.floor(image.width * imageSizeOptions.height / image.height)
      image.height = Math.floor(imageSizeOptions.height)
    } else {
      image.width = Math.floor(image.width * scale)
      image.height = Math.floor(image.height * scale)
    }

    if (Handler.has('QQBot.makeMarkdownImage')) {
      const res = await Handler.call(
        'QQBot.makeMarkdownImage',
        data,
        {
          image,
          buffer,
          file,
          summary,
          config
        }
      )
      if (res) {
        typeof res == 'object' ? Object.assign(image, res) : image.url = res
      }
    }

    return {
      des: `![${summary} #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`
    }
  }

  makeButton(data, button) {
    const msg = {
      id: randomUUID(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style: button.style ?? 1,
        ...button.QQBot?.render_data
      }
    }

    if (button.input) {
      msg.action = {
        type: button.type ?? 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        reply: button.reply ?? false,
        anchor: button.anchor ?? 0,
        click_limit: button.click_limit ?? undefined,
        at_bot_show_channel_list: button.at_bot_show_channel_list ?? false,
        unsupport_tips: button.unsupport_tips || '当前客户端不支持此操作',
        ...button.QQBot?.action
      }
    } else if (button.callback) {
      // 修改这里，对type=1的按钮也使用服务端回调机制
      if (config.toCallback || button.type === 1) {
        msg.action = {
          type: button.type ?? 1,
          permission: { type: 2 },
          reply: button.reply ?? false,
          enter: button.enter ?? false,
          anchor: button.anchor ?? 0,
          click_limit: button.click_limit ?? undefined,
          at_bot_show_channel_list: button.at_bot_show_channel_list ?? false,
          unsupport_tips: button.unsupport_tips || '当前客户端不支持此操作',
          ...button.QQBot?.action
        }
        if (!Array.isArray(data._ret_id)) data._ret_id = []

        data.bot.callback[msg.id] = {
          id: data.message_id,
          user_id: data.user_id,
          group_id: data.group_id,
          message: button.callback,
          message_id: data._ret_id
        }
        setTimeout(() => delete data.bot.callback[msg.id], 300000)
      } else {
        msg.action = {
          type: button.type ?? 2,
          permission: { type: 2 },
          data: button.callback,
          enter: true,
          reply: button.reply ?? false,
          anchor: button.anchor ?? 0,
          click_limit: button.click_limit ?? undefined,
          at_bot_show_channel_list: button.at_bot_show_channel_list ?? false,
          unsupport_tips: button.unsupport_tips || '当前客户端不支持此操作',
          ...button.QQBot?.action
        }
      }
    } else if (button.link) {
      msg.action = {
        type: button.type ?? 0,
        permission: { type: 2 },
        data: button.link,
        reply: button.reply ?? false,
        enter: button.enter ?? false,
        anchor: button.anchor ?? 0,
        click_limit: button.click_limit ?? undefined,
        at_bot_show_channel_list: button.at_bot_show_channel_list ?? false,
        unsupport_tips: button.unsupport_tips || '当前客户端不支持此操作',
        ...button.QQBot?.action
      }
    } else return false

    if (button.content || button.confirm_text || button.cancel_text) {
      msg.action.modal = {
        content: button.content || '是否确认操作?',
        confirm_text: button.confirm_text || '是',
        cancel_text: button.cancel_text || '否'
      }
    }

    if (button.permission) {
      if (button.permission == 'admin') {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission)) button.permission = [button.permission]
        for (let id of button.permission) {
          if (config.toQQUin && userIdCache[id]) id = userIdCache[id]
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ''))
        }
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = []
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button)
        if (button) buttons.push(button)
      }
      if (buttons.length) { msgs.push({ type: 'button', buttons }) }
    }
    return msgs
  }

  makeTextChain(data, button) {
    let msg

    if (button.input) msg = `text="${button.input}"`
    else if (button.callback) msg = `text="${button.callback}"`
    else if (button.link) msg = `text="${button.link}"`
    else return false

    if (button.text) msg += ` show="[${button.text}]"`
    return `<qqbot-cmd-input ${msg} />`
  }

  makeTextChains(data, button_square) {
    const msgs = []
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeTextChain(data, button)
        if (button) buttons.push(button)
      }
      if (buttons.length) msgs.push(buttons.join(" "))
    }
    if (msgs.length) msgs.unshift("")
    return msgs.join("\n")
  }

  async makeRawMarkdownMsg(data, msg, keyboard) {
    patchSegmentImageSizeOptions()
    const messages = []
    const button = []
    const files = []
    let content = ''
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'face':
        case 'ark':
        case 'embed':
          messages.push([i])
          content += ''
          break
        case 'file': {
          Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
          const fileData = this._parseFileSegment(i, data)
          files.push(fileData)
          Bot.makeLog('debug', ['收集文件消息', fileData], data.self_id)
          content += ''
          break
        }
        case "at":
          if (i.qq === "all") content += "<qqbot-at-everyone />"
          else
            content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, "")}>`
          break
        case 'text':
          content += await this.makeRawMarkdownText(data, i.text, keyboard && button)
          break
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary, i)
          content += `${des}${url}`
          break
        } case 'markdown':
          if (typeof i.data == 'object') {
            let markdownObj = { type: 'markdown', ...i.data }
            // 添加对hide_avatar_and_center的支持
            if (i.data.hide_avatar_and_center) {
              markdownObj.style = { layout: 'hide_avatar_and_center', ...markdownObj.style }
              delete markdownObj.hide_avatar_and_center
            }
            messages.push([markdownObj])
          }
          else content += i.data
          break
        case "button":
          if (config?.TextChains) content += this.makeTextChains(data, i.data)
          else button.push(...this.makeButtons(data, i.data))
          break
        case "reply":
          if (i.id.startsWith("event_"))
            reply = { type: "reply", event_id: i.id.replace(/^event_/, "") }
          else reply = i
          continue
        case 'node':
          for (const { message } of i.data) { messages.push(...(await this.makeRawMarkdownMsg(data, message, keyboard && button))) }
          continue
        case 'raw':
          if (Array.isArray(i.data)) {
            messages.push(i.data)
          } else if (i.data && (i.data.type === 'keyboard' || i.data.type === 'button')) {
            button.push(i.data)
          } else {
            messages.push([i.data])
          }
          break
        case 'stream':
          data.stream = true
          data.chunkSize = i.data?.chunkSize ?? config.chunkSize
          data.delay = i.data?.delay ?? config.delay
          break
        case 'small':
          data.smallbtn = true
          continue
        default:
          content += await this.makeRawMarkdownText(data, JSON.stringify(i), keyboard && button)
      }
    }

    if (content) messages.unshift([{ type: "markdown", content }])

    if (button.length) {
      for (const i of messages) {
        if (i[0].type === "markdown") i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          { type: 'markdown', content: ' ' },
          ...button.splice(0, 5)
        ])
      }
    }

    if (reply) {
      for (const i in messages) {
        if (Array.isArray(messages[i])) messages[i].unshift(reply)
        else messages[i] = [reply, messages[i]]
      }
    }

    if (files.length) data._files = files
    return messages
  }

  makeMarkdownText_(data, text) {
    if (this.toQRCodeMode === 'url') {
      text = text.replace(URL_REGEXP_FULL, '<$&>')
    } else if (this.toQRCodeRegExp) {
      text = text.replace(this.toQRCodeRegExp, (url) => {
        return this.makeTextChain(data, { text: "链接", link: url })
      })
    }
    return text
      .replace(/\n/g, "\r")
      .replace(/@\u200B/g, "@")
      .replace(/<qqbot-\u200B/g, "<qqbot-")
  }

  makeMarkdownText(data, text, content) {
    const match = text.match(/!?\[.*?\]\s*\(\w+:\/\/.*?\)/g)
    if (match) {
      const temp = []
      let last = ""
      for (const i of match) {
        const match = i.match(/(!?\[.*?\])\s*(\(\w+:\/\/.*?\))/)
        text = text.split(i)
        temp.push([last + this.makeMarkdownText_(data, text.shift()), match[1]])
        text = text.join(i)
        last = match[2]
      }
      temp[0][0] = content + temp[0][0]
      return [last + this.makeMarkdownText_(data, text), temp]
    }
    return [this.makeMarkdownText_(data, text)]
  }

  makeMarkdownTemplate(data, templates) {
    const msgs = []
    for (const template of templates) {
      if (!template.length) continue

      const params = []
      for (const i in template)
        params.push({
          key: config.markdown.template[i],
          values: [template[i]],
        })

      msgs.push([
        {
          type: "markdown",
          custom_template_id: config.markdown[data.self_id],
          params,
        },
      ])
    }
    return msgs
  }

  makeMarkdownTemplatePush(content, template, templates) {
    for (const i of content) {
      if (template.length === config.markdown.template.length - 1) {
        template.push(i.shift())
        template = i
        templates.push(template)
      } else {
        template.push(i.join(""))
      }
    }
    return template
  }

  async makeMarkdownMsg(data, msg) {
    patchSegmentImageSizeOptions()
    const messages = []
    const button = []
    const files = []
    let template = []
    let content = ''
    let reply
    const length = markdown_template?.params?.length || config.customMD?.[data.self_id]?.keys?.length || config.markdown.template.length

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') i = { ...i }
      else i = { type: 'text', text: Bot.String(i) }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'face':
        case 'ark':
        case 'embed':
          messages.push([i])
          content += ''
          break
        case 'file': {
          Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
          const fileData = this._parseFileSegment(i, data)
          files.push(fileData)
          Bot.makeLog('debug', ['收集文件消息', fileData], data.self_id)
          content += ''
          break
        }
        case 'at':
          if (i.qq == 'all') content += '"<qqbot-at-everyone />'
          else {
            if (config.toQQUin && userIdCache[i.qq]) i.qq = userIdCache[i.qq]
            content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>`
          }
          break
        case "text": {
          const [text, temp] = this.makeMarkdownText(data, i.text, content)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
          break
        }
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
            const getButton = data => {
              return data.flatMap(item => {
                if (Array.isArray(item.message)) {
                  return item.message.flatMap(msg => {
                    if (msg.type === 'node') return getButton(msg.data)
                    if (msg.type === 'button') return msg
                    return []
                  })
                }
                if (typeof item.message === 'object') {
                  if (item.message.type === 'button') return item.message
                  if (item.message.type === 'node') return getButton(item.message.data)
                }
                return []
              })
            }
            const btn = getButton(i.data)
            let result = btn.reduce((acc, cur) => {
              const duplicate = acc.find(obj => obj.text === cur.text && obj.callback === cur.callback && obj.input === cur.input && obj.link === cur.link)
              if (!duplicate) return acc.concat([cur])
              else return acc
            }, [])

            const e = {
              reply: (msg) => {
                i = msg
              },
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }

            e.runtime = new Runtime(e)
            i.data.cfg = { retType: 'msgId', returnID: true }
            let { wsids } = await Handler.call('ws.tool.toImg', e, i.data)

            if (!result.length && data.wsids && data.wsids?.fnc) {
              wsids = wsids.map((id, k) => ({ text: `${data.wsids.text}${k}`, callback: `#ws查看${id}` }))
              result = _.chunk(_.tail(wsids), data.wsids.col)
            }

            for (const b of result) {
              button.push(...this.makeButtons(data, b.data ? b.data : [b]))
            }
          } else if (TmplPkg && TmplPkg?.nodeMsg) {
            messages.push(...(await this.makeMarkdownMsg(data, TmplPkg.nodeMsg(i.data))))
            continue
          } else {
            for (const { message } of i.data) {
              messages.push(...(await this.makeMarkdownMsg(data, message)))
            }
            continue
          }
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary, i)
          template = this.makeMarkdownTemplatePush([[content, des]], template, templates)
          const limit = template.length % (length - 1)

          // 图片数量超过模板长度时
          if (template.length && !limit) {
            if (content) template.push(content)
            template.push(des)
          } else template.push(content + des)

          content = url
          break
        }
        case 'markdown':
          if (typeof i.data == 'object') {
            let markdownObj = { type: 'markdown', ...i.data }
            // 添加对hide_avatar_and_center的支持
            if (i.data.hide_avatar_and_center) {
              markdownObj.style = { layout: 'hide_avatar_and_center', ...markdownObj.style }
              delete markdownObj.hide_avatar_and_center
            }
            messages.push([markdownObj])
          }
          else content += i.data
          break
        case 'button':
          if (config?.TextChains) content += this.makeTextChains(data, i.data)
          else button.push(...this.makeButtons(data, i.data))
          break
        case 'reply':
          if (i.id.startsWith('event_')) {
            reply = { type: 'reply', event_id: i.id.replace(/^event_/, '') }
          } else {
            reply = i
          }
          continue
        case 'raw':
          if (Array.isArray(i.data)) {
            messages.push(i.data)
          } else if (i.data && (i.data.type === 'keyboard' || i.data.type === 'button')) {
            button.push(i.data)
          } else {
            messages.push([i.data])
          }
          break
        case 'custom':
          template.push(...i.data)
          break
        case 'stream':
          data.stream = true
          data.chunkSize = i.data?.chunkSize ?? config.chunkSize
          data.delay = i.data?.delay ?? config.delay
          break
        case 'small':
          data.smallbtn = true
          continue
        default: {
          const [text, temp] = this.makeMarkdownText(data, Bot.String(i), content)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
        }
      }
    }

    if (content) template.push(content)
    if (template.length > length) {
      const templates = _(template).chunk(length).map(v => this.makeMarkdownTemplate(data, v)).value()
      messages.push(...templates)
    } else if (template.length) {
      const tmp = this.makeMarkdownTemplate(data, template)
      if (tmp.length > 1) {
        messages.push(...tmp.map(i => ([i])))
      } else {
        messages.push(tmp)
      }
    }

    if (template.length && button.length < 5 && config.btnSuffix[data.self_id]) {
      let { position, values } = config.btnSuffix[data.self_id]
      position = +position - 1
      if (position > button.length) {
        position = button.length
      }
      const btn = values.filter(i => {
        if (i.show) {
          switch (i.show.type) {
            case 'random':
              if (i.show.data <= _.random(1, 100)) return false
              break
            default:
              break
          }
        }
        return true
      })
      button.splice(position, 0, ...this.makeButtons(data, [btn]))
    }

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == 'markdown') i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          ...this.makeMarkdownTemplate(data, [' ']),
          ...button.splice(0, 5)
        ])
      }
    }
    if (reply) {
      for (const i of messages) {
        i.unshift(reply)
      }
    }
    if (files.length) data._files = files
    return messages
  }
  async compressImage(data, file) {
    try {
      const size = config.imageLength * 1024 * 1024
      const buffer = await Bot.Buffer(file, { http: true })

      if (!Buffer.isBuffer(buffer))
        return file

      if (buffer.length <= size)
        return buffer

      let quality = 105, output
      do {
        quality -= 10
        output = await sharp(buffer).jpeg({ quality }).toBuffer()
        Bot.makeLog("debug", `图片压缩完成 ${quality}%(${(output.length / 1024).toFixed(2)}KB)`, data.self_id)
      } while (output.length > size && quality > 10)

      return output
    } catch (err) {
      Bot.makeLog("error", ["图片压缩错误", err], data.self_id)
      return file
    }
  }

  async makeMsg(data, msg) {
    patchSegmentImageSizeOptions()
    const sendType = ['audio', 'image', 'video', 'file']
    const messages = []
    const button = []
    const files = []
    // 添加全局按钮
    const botId = data?.self_id?.toString()
    if (botId && config.keyboard && config.keyboard[botId]) {
      // 使用用户指定的按钮格式
      messages.push([{
        type: 'keyboard',
        id: config.keyboard[botId]
      }])
    }
    let message = []
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          continue
        case 'text':
          if (!i.text || !i.text.trim()) continue
          break
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'file': {
          Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
          const fileData = this._parseFileSegment(i, data)
          files.push(fileData)
          Bot.makeLog('debug', ['收集文件消息', fileData], data.self_id)
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          break
        }
        case 'image':
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          if (sharp && i.file)
            i.file = await this.compressImage(data, i.file)
          break
        case 'reply':
          if (i.id.startsWith('event_')) {
            reply = { type: 'reply', event_id: i.id.replace(/^event_/, '') }
          } else {
            reply = i
          }
          continue
        case 'markdown':
          if (typeof i.data == 'object') { i = { type: 'markdown', ...i.data } } else { i = { type: 'markdown', content: i.data } }
          break
        case 'button':
          config.sendButton && button.push(...this.makeButtons(data, i.data))
          continue
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
            const e = {
              reply: (msg) => {
                i = msg
              },
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }
            e.runtime = new Runtime(e)
            await Handler.call('ws.tool.toImg', e, i.data)
            // i.file = await Bot.fileToUrl(i.file)
            if (message.some(s => sendType.includes(s.type))) {
              messages.push(message)
              message = []
            }
          } else {
            for (const { message } of i.data) {
              messages.push(...(await this.makeMsg(data, message)))
            }
          }
          break
        case 'raw':
          if (Array.isArray(i.data)) {
            messages.push(i.data)
          } else if (i.data && (i.data.type === 'keyboard' || i.data.type === 'button')) {
            button.push(i.data)
          } else {
            messages.push([i.data])
          }
          break
        default:
          i = { type: 'text', text: JSON.stringify(i) }
      }

      if (i.type === 'text' && i.text) {
        if (this.toQRCodeRegExp) {
          const match = i.text.match(this.toQRCodeRegExp)
          if (match) {
            for (const url of match) {
              const msg = segment.image(await this.makeQRCode(url))
              if (message.some(s => sendType.includes(s.type))) {
                messages.push(message)
                message = []
              }
              message.push(msg)
              i.text = i.text.replace(url, '[链接(请扫码查看)]')
            }
          }
        } else if (this.toQRCodeMode === 'url') {
          const match = i.text.match(URL_REGEXP)
          if (match) {
            for (const url of match) {
              i.text = i.text.replace(url, this.convertURL(url))
            }
          }
        }
      }

      if (i.type !== 'node') message.push(i)
    }

    if (message.length) { messages.push(message) }

    while (button.length) {
      messages.push([{
        type: 'keyboard',
        content: { rows: button.splice(0, 5) }
      }])
    }

    if (reply) {
      for (const i of messages) i.unshift(reply)
    }
    if (files.length) data._files = files
    return messages
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          const payload = this.wrapOutgoingMessageForSdk12(i)
          Bot.makeLog('debug', ['发送消息', payload], data.self_id)
          const ret = await send(payload)
          Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
          Bot[data.self_id].dau.setDau('send_msg', data)
        } catch (err) {
          // Bot.makeLog('error', ['发送消息错误', i, err], data.self_id)
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

    // 检查是否包含raw类型的消息，如果包含则使用makeRawMarkdownMsg处理
    const hasRawMessage = Array.isArray(msg) ? msg.some(m => m.type === 'raw') : msg.type === 'raw'

    if (hasRawMessage) {
      // 对于包含raw消息的情况，使用makeRawMarkdownMsg处理，确保markdown和按钮在同一消息中
      msgs = await this.makeRawMarkdownMsg(data, msg, true);
    } else if (config.markdown[data.self_id] === "legacy") {
      // legacy 模式：使用普通消息
      msgs = await this.makeMsg(data, msg);
    } else if (
      (config.markdown[data.self_id] || (data.toQQBotMD === true && config.customMD[data.self_id])) &&
      data.toQQBotMD !== false
    ) {
      // markdown 模式
      if (config.markdown[data.self_id] == "raw") {
        msgs = await this.makeRawMarkdownMsg(data, msg, true);
      } else {
        msgs = await this.makeMarkdownMsg(data, msg);
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
      msgs = await this.makeRawMarkdownMsg(data, msg)
    }

    // if (await sendMsg() === false) {
    //   msgs = await this.makeMsg(data, msg)
    //   await sendMsg()
    // }
    // 只尝试发送一次，避免重复发送
    await sendMsg()

    if (data._files && data._files.length) {
      await this.sendFiles(data, data._files)
      data._files = []
    }

    if (Array.isArray(data._ret_id)) { data._ret_id.push(...rets.message_id) }
    return rets
  }

  sendFriendMsg(data, msg, event) {
    if (!event) event = {}
    if (data.smallbtn) event.smallbtn = true
    return this.sendMsg(data, msg => {
      if (data.smallbtn) event.smallbtn = true
      const options = {
        stream: data.stream || false,
        chunkSize: data.chunkSize,
        delay: data.delay
      }
      return data.bot.sdk.sendPrivateMessage(data.user_id, msg, event, options)
    }, msg)
  }

  async sendGroupMsg(data, msg, event) {
    if (!event) event = {}
    if (data.smallbtn) event.smallbtn = true

    if (Handler.has('QQBot.group.sendMsg')) {
      const res = await Handler.call(
        'QQBot.group.sendMsg',
        data,
        {
          self_id: data.self_id,
          group_id: `${data.self_id}${this.sep}${data.group_id}`,
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
    return this.sendMsg(data, msg => {
      if (data.smallbtn) event.smallbtn = true
      return data.bot.sdk.sendGroupMessage(data.group_id, msg, event)
    }, msg)
  }

  async makeGuildMsg(data, msg) {
    patchSegmentImageSizeOptions()
    const messages = []
    let message = []
    let reply
    let button = []
    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          i.user_id = i.qq?.replace?.(/^qg_/, '')
        case 'text':
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'image':
          message.push(i)
          if (button.length) {
            message.push({
              type: 'keyboard',
              content: { rows: button }
            })
            button = []
          }
          messages.push(message)
          message = []
          continue
        case 'record':
        case 'video':
        case 'file':
          return []
        case 'reply':
          if (i.id.startsWith('event_')) {
            reply = { type: 'reply', event_id: i.id.replace(/^event_/, '') }
          } else {
            reply = i
          }
          continue
        case 'markdown':
          if (typeof i.data == 'object') { i = { type: 'markdown', ...i.data } } else { i = { type: 'markdown', content: i.data } }
          break
        case 'button':
          config.sendButton && button.push(...this.makeButtons(data, i.data))
          continue
        case 'node':
          for (const { message } of i.data) { messages.push(...(await this.makeGuildMsg(data, message))) }
          continue
        case 'raw':
          if (Array.isArray(i.data)) {
            messages.push(i.data)
          } else if (i.data && (i.data.type === 'keyboard' || i.data.type === 'button')) {
            button.push(i.data)
          } else {
            messages.push([i.data])
          }
          break
        default:
          i = { type: 'text', text: JSON.stringify(i) }
      }

      if (i.type == 'text' && i.text) {
        if (this.toQRCodeRegExp) {
          const match = i.text.match(this.toQRCodeRegExp)
          if (match) {
            for (const url of match) {
              const msg = segment.image(await this.makeQRCode(url))
              message.push(msg)
              if (button.length) {
                message.push({
                  type: 'keyboard',
                  content: { rows: button }
                })
                button = []
              }
              messages.push(message)
              message = []
              i.text = i.text.replace(url, '[链接(请扫码查看)]')
            }
          }
        } else if (this.toQRCodeMode === 'url') {
          const match = i.text.match(URL_REGEXP)
          if (match) {
            for (const url of match) {
              i.text = i.text.replace(url, this.convertURL(url))
            }
          }
        }
      }

      message.push(i)
    }

    if (message.length) {
      if (button.length) {
        message.push({
          type: 'keyboard',
          content: { rows: button }
        })
      }
      messages.push(message)
    } else if (button.length) {
      messages.push([
        { type: 'text', text: ' ' },
        {
          type: 'keyboard',
          content: { rows: button }
        }
      ])
    }

    if (reply) {
      for (const i of messages) i.unshift(reply)
    }
    return messages
  }

  async sendGMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          const payload = this.wrapOutgoingMessageForSdk12(i)
          Bot.makeLog('debug', ['发送消息', payload], data.self_id)
          const ret = await send(payload)
          Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
          Bot[data.self_id].dau.setDau('send_msg', data)
        } catch (err) {
          // Bot.makeLog('error', ['发送消息错误', i, err], data.self_id)
          logger.error(data.self_id, '发送消息错误', i, err)
          rets.error.push(err)
          return false
        }
      }
    }

    msgs = await this.makeGuildMsg(data, msg)
    // if (await sendMsg() === false) {
    //   msgs = await this.makeGuildMsg(data, msg)
    //   await sendMsg()
    // }
    // 只尝试发送一次，避免重复发送
    await sendMsg()
    return rets
  }

  async sendDirectMsg(data, msg, event) {
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
    return this.sendGMsg(data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg, event), msg)
  }

  _parseFileSegment(i, data) {
    let fileData = {
      file: null,
      name: null,
      force_chunk: false,
      recall_time: 0
    }

    if (typeof i.file === 'string') {
      fileData.file = i.file

      if (typeof i.name === 'object' && i.name !== null) {
        fileData.name = i.name.name || null
        fileData.force_chunk = typeof i.name.force_chunk !== 'undefined' ? !!i.name.force_chunk : false
        fileData.recall_time = Number(i.name.recall_time) || 0
      } else {
        fileData.name = i.name || null

        let thirdParam = undefined
        if (typeof i.force_chunk !== 'undefined') {
          thirdParam = i.force_chunk
        } else if (typeof i.data !== 'undefined' && typeof i.data !== 'object') {
          thirdParam = i.data
        } else if (typeof i[2] !== 'undefined') {
          thirdParam = i[2]
        } else if (typeof i['2'] !== 'undefined') {
          thirdParam = i['2']
        } else if (Array.isArray(i.args) && i.args.length > 0) {
          thirdParam = i.args[0]
        }
        fileData.force_chunk = typeof thirdParam !== 'undefined' ? !!thirdParam : false

        let fourthParam = undefined
        if (typeof i.recall_time !== 'undefined') {
          fourthParam = i.recall_time
        } else if (typeof i[3] !== 'undefined') {
          fourthParam = i[3]
        } else if (typeof i['3'] !== 'undefined') {
          fourthParam = i['3']
        } else if (Array.isArray(i.args) && i.args.length > 1) {
          fourthParam = i.args[1]
        }
        fileData.recall_time = Number(fourthParam) || 0
      }
    } else if (typeof i.file === 'object' && i.file !== null) {
      if (i.file.file) {
        fileData.file = i.file.file
        fileData.name = i.file.name || i.name || null
        fileData.force_chunk = typeof i.file.force_chunk !== 'undefined'
          ? !!i.file.force_chunk
          : (typeof i.force_chunk !== 'undefined' ? !!i.force_chunk : false)
        fileData.recall_time = Number(i.file.recall_time ?? i.recall_time) || 0
      } else {
        fileData.file = i.file
        fileData.name = i.name || null
        fileData.force_chunk = typeof i.force_chunk !== 'undefined' ? !!i.force_chunk : false
        fileData.recall_time = Number(i.recall_time) || 0
      }
    }

    if (!fileData.name && typeof fileData.file === 'string' && fileData.file.startsWith('http')) {
      try {
        const url = new URL(fileData.file)
        const lastSegment = url.pathname.split('/').pop()
        const fileNameWithoutParams = lastSegment.split('?')[0]
        if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
          fileData.name = decodeURIComponent(fileNameWithoutParams)
        }
      } catch { }
    }

    return fileData
  }

  async recallMessageById(data, message_id, target_type, target_id) {
    try {
      const url = `/v2/${target_type}s/${target_id}/messages/${message_id}`
      Bot.makeLog('debug', ['撤回消息', { url, target_type, target_id, message_id }], data.self_id)
      await data.bot.sdk.request.delete(url)
      Bot.makeLog('info', [`撤回${target_type === 'group' ? '群' : '私聊'}文件消息成功`, { target_id, message_id }], data.self_id)
    } catch (err) {
      Bot.makeLog('error', ['撤回消息失败', { target_type, target_id, message_id }, err.message, err.response?.data], data.self_id)
    }
  }

  async uploadFileToQQ(data, target_id, target_type, file_data, file_name, force_chunk = false) {
    if (typeof file_data === 'string' && file_data.startsWith('http') && !force_chunk) {
      let fileSizeMB = 0
      try {
        const headResponse = await fetch(file_data, { method: 'HEAD' })
        const contentLength = headResponse.headers.get('content-length')
        fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0
        Bot.makeLog('info', [`网络文件大小: ${fileSizeMB.toFixed(2)} MB`], data.self_id)
      } catch (err) {
        Bot.makeLog('debug', ['无法获取文件大小，尝试直传', err.message], data.self_id)
      }

      Bot.makeLog('info', ['检测到网络 URL，使用直传（不下载文件）', { url: file_data.substring(0, 100), file_name }], data.self_id)

      try {
        const filesUrl = `/v2/${target_type}s/${target_id}/files`
        const filesData = {
          file_type: 4,
          srv_send_msg: false,
          url: file_data,
          file_name: file_name || this.extractFileNameFromUrl(file_data)
        }

        Bot.makeLog('debug', ['URL 直传', filesUrl, filesData], data.self_id)

        const { data: result } = await data.bot.sdk.request.post(filesUrl, filesData)

        Bot.makeLog('info', ['URL 直传成功，无需下载文件', result], data.self_id)

        return result
      } catch (error) {
        Bot.makeLog('warn', ['URL 直传失败', error.message, error.response?.data], data.self_id)

        if (fileSizeMB > 10) {
          Bot.makeLog('info', [`文件大于 10MB (${fileSizeMB.toFixed(2)} MB)，降级为分片上传`], data.self_id)
          force_chunk = true
        } else {
          Bot.makeLog('info', [`文件较小 (${fileSizeMB.toFixed(2)} MB)，降级为 base64 上传`], data.self_id)
        }
      }
    }

    const getFileBuffer = async (file_data) => {
      if (file_data instanceof Uint8Array) {
        return Buffer.from(file_data)
      } else if (Buffer.isBuffer(file_data)) {
        return file_data
      } else if (typeof file_data === 'string') {
        if (file_data.startsWith('http')) {
          Bot.makeLog('info', ['开始下载网络文件...'], data.self_id)
          const response = await fetch(file_data)
          const buffer = Buffer.from(await response.arrayBuffer())
          Bot.makeLog('info', [`下载完成，大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`], data.self_id)
          return buffer
        } else if (file_data.startsWith('base64://')) {
          return Buffer.from(file_data.replace('base64://', ''), 'base64')
        } else if (file_data.startsWith('file://')) {
          return fs.readFileSync(file_data.replace('file://', ''))
        } else {
          try {
            return fs.readFileSync(file_data)
          } catch {
            return Buffer.from(file_data)
          }
        }
      } else {
        throw new Error('不支持的文件数据类型')
      }
    }

    const extractFileName = (file_data, fileBuffer) => {
      let name = ''
      let ext = ''

      if (typeof file_data === 'string') {
        if (file_data.startsWith('http')) {
          try {
            const url = new URL(file_data)
            const pathname = url.pathname
            const segments = pathname.split('/')
            const lastSegment = segments[segments.length - 1]
            const fileNameWithoutParams = lastSegment.split('?')[0]
            if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
              name = decodeURIComponent(fileNameWithoutParams)
              ext = name.substring(name.lastIndexOf('.'))
            }
          } catch { }
        } else if (file_data.startsWith('file://')) {
          const path = file_data.replace('file://', '')
          name = path.split('/').pop() || path.split('\\').pop()
          if (name && name.includes('.')) {
            ext = name.substring(name.lastIndexOf('.'))
          }
        } else {
          name = file_data.split('/').pop() || file_data.split('\\').pop()
          if (name && name.includes('.')) {
            ext = name.substring(name.lastIndexOf('.'))
          }
        }
      }

      if (!ext && fileBuffer) {
        const header = fileBuffer.toString('hex', 0, 16).toUpperCase()
        const fileTypeMap = {
          '89504E47': '.png',
          '47494638': '.gif',
          'FFD8FF': '.jpg',
          '25504446': '.pdf',
          '494433': '.mp3',
          '52494646': '.wav',
          '00000018': '.mp4',
          '00000020': '.mp4',
          'D0CF11E0': '.doc',
          '504B0304': '.zip',
          '7B22': '.json',
          '3C3F786D': '.xml',
          'EFBBBF': '.txt',
          'FFFE': '.txt',
          'FEFF': '.txt'
        }

        for (const [signature, extension] of Object.entries(fileTypeMap)) {
          if (header.startsWith(signature)) {
            ext = extension
            break
          }
        }

        if (header.startsWith('52494646')) {
          const riffType = fileBuffer.toString('hex', 8, 12).toUpperCase()
          if (riffType === '57454250') {
            ext = '.webp'
          } else {
            ext = '.wav'
          }
        }
      }

      if (!name || !name.includes('.')) {
        const timestamp = Date.now().toString(36)
        const random = Math.random().toString(36).substring(2, 8)
        name = `file_${timestamp}_${random}${ext || '.bin'}`
      }

      if (name.length > 100) {
        const extension = name.substring(name.lastIndexOf('.'))
        const baseName = name.substring(0, name.lastIndexOf('.'))
        name = baseName.substring(0, 80) + '...' + extension
      }

      return name
    }

    try {
      const fileBuffer = await getFileBuffer(file_data)
      const file_size = fileBuffer.length

      if (!file_name) {
        file_name = extractFileName(file_data, fileBuffer)
      }

      const shouldUseChunk = force_chunk || target_type === 'user'

      Bot.makeLog('debug', ['上传方式判断', { force_chunk, target_type, shouldUseChunk, file_size_mb: (file_size / 1024 / 1024).toFixed(2) }], data.self_id)

      if (!shouldUseChunk && target_type === 'group') {
        Bot.makeLog('debug', ['群聊使用 base64 直传', { target_id, file_name, size: file_size }], data.self_id)

        const filesUrl = `/v2/${target_type}s/${target_id}/files`
        const base64Data = fileBuffer.toString('base64')
        const filesData = {
          file_type: 4,
          srv_send_msg: false,
          file_data: base64Data,
          file_name: file_name
        }

        const { data: result } = await data.bot.sdk.request.post(filesUrl, filesData)

        Bot.makeLog('debug', ['群聊 base64 直传成功', result], data.self_id)

        return result
      }

      const md5Hash = crypto.createHash('md5').update(fileBuffer).digest('hex')
      const sha1Hash = crypto.createHash('sha1').update(fileBuffer).digest('hex')
      const MD5_10M_SIZE = 10002432
      const md5_10m = crypto.createHash('md5')
        .update(fileBuffer.slice(0, Math.min(MD5_10M_SIZE, file_size)))
        .digest('hex')

      Bot.makeLog('debug', ['准备分片上传', { target_id, target_type, file_name, file_size }], data.self_id)

      const { data: prepareResult } = await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/upload_prepare`, {
        file_type: 4,
        file_name,
        file_size,
        md5: md5Hash,
        sha1: sha1Hash,
        md5_10m
      })

      const { upload_id, parts } = prepareResult

      for (const part of parts) {
        const { index, presigned_url } = part
        const start = (index - 1) * prepareResult.block_size
        const end = Math.min(start + prepareResult.block_size, file_size)
        const partBuffer = fileBuffer.slice(start, end)

        await fetch(presigned_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': partBuffer.length },
          body: partBuffer
        })

        await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/upload_part_finish`, {
          upload_id,
          part_index: index,
          block_size: partBuffer.length,
          md5: crypto.createHash('md5').update(partBuffer).digest('hex')
        })
      }

      const { data: filesResult } = await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/files`, {
        upload_id,
        srv_send_msg: false
      })

      Bot.makeLog('info', ['分片上传成功', filesResult], data.self_id)

      return filesResult
    } catch (error) {
      Bot.makeLog('error', ['文件上传失败', error.message], data.self_id)
      throw error
    }
  }

  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url)
      const lastSegment = urlObj.pathname.split('/').pop()
      const fileNameWithoutParams = lastSegment.split('?')[0]
      if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
        return decodeURIComponent(fileNameWithoutParams)
      }
    } catch { }
    return null
  }

  async sendFileMessage(data, target_id, target_type, fileInfo) {
    try {
      let actualFile, actualName, actualForceChunk, actualRecallTime

      if (typeof fileInfo.file === 'object' && fileInfo.file !== null && fileInfo.file.file) {
        actualFile = fileInfo.file.file
        actualName = fileInfo.file.name || fileInfo.name
        actualForceChunk = !!(fileInfo.file.force_chunk || fileInfo.force_chunk)
        actualRecallTime = fileInfo.file.recall_time ?? fileInfo.recall_time ?? 0
      } else {
        actualFile = fileInfo.file
        actualName = fileInfo.name
        actualForceChunk = !!(fileInfo.force_chunk)
        actualRecallTime = fileInfo.recall_time ?? 0
      }

      actualRecallTime = Number(actualRecallTime) || 0

      Bot.makeLog('debug', ['解析后的文件信息', {
        actualFile: typeof actualFile === 'string' ? actualFile : 'Buffer',
        actualName,
        actualForceChunk,
        actualRecallTime
      }], data.self_id)

      const result = await this.uploadFileToQQ(
        data,
        target_id,
        target_type,
        actualFile,
        actualName,
        actualForceChunk
      )

      const messageUrl = `/v2/${target_type}s/${target_id}/messages`
      const messageData = {
        msg_type: 7,
        media: { file_info: result.file_info }
      }

      if (data.message_id) {
        messageData.msg_id = data.message_id
      }

      Bot.makeLog('debug', ['发送文件消息', messageUrl, messageData], data.self_id)

      const { data: sendResult } = await data.bot.sdk.request.post(messageUrl, messageData)

      Bot.makeLog('debug', ['文件消息发送成功', sendResult], data.self_id)

      if (actualRecallTime > 0 && sendResult && sendResult.id) {
        const msgId = sendResult.id
        Bot.makeLog('info', [`文件消息将在 ${actualRecallTime} 秒后撤回`, { msgId, target_type, target_id }], data.self_id)
        setTimeout(async () => {
          await this.recallMessageById(data, msgId, target_type, target_id)
        }, actualRecallTime * 1000)
      }

      return { id: sendResult.id }
    } catch (error) {
      Bot.makeLog('error', ['文件消息发送失败', error.message], data.self_id)
      throw error
    }
  }

  async sendFiles(data, files) {
    let target_type, target_id

    if (data.group_id) {
      target_type = 'group'
      target_id = data.raw?.group_id || data.group_id.replace(`${data.self_id}${this.sep}`, '')
    } else {
      target_type = 'user'
      target_id = data.raw?.sender?.user_id || data.user_id.replace(`${data.self_id}${this.sep}`, '')
    }

    Bot.makeLog('debug', ['准备发送文件列表', { target_type, target_id, count: files.length }], data.self_id)

    for (const fileInfo of files) {
      try {
        await this.sendFileMessage(data, target_id, target_type, fileInfo)
        Bot.makeLog('info', ['文件发送成功', { target_type, target_id, file: fileInfo.name, force_chunk: fileInfo.force_chunk, recall_time: fileInfo.recall_time }], data.self_id)
      } catch (err) {
        Bot.makeLog('error', ['发送文件失败', fileInfo, err.message, err.response?.data], data.self_id)
      }
    }
  }

  async sendInputNotify(user_id, input_type, input_second, msg_id) {
    const result = await data.bot.sdk.request.post(`/v2/users/${user_id}/messages`, { msg_type: 6, input_notify: { input_type, input_second }, msg_id })
    return result.data?.ext_info || { ref_idx: '' }
  }

  async recallMsg(data, recall, message_id) {
    if (!Array.isArray(message_id)) message_id = [message_id]
    const msgs = []
    for (const i of message_id) {
      try {
        msgs.push(await recall(i))
      } catch (err) {
        Bot.makeLog('debug', ['撤回消息错误', i, err], data.self_id)
        msgs.push(false)
      }
    }
    return msgs
  }

  recallFriendMsg(data, message_id) {
    Bot.makeLog('info', `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallFriendMessage(data.user_id, i), message_id)
  }

  recallGroupMsg(data, message_id) {
    Bot.makeLog('info', `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallGroupMessage(data.group_id, i), message_id)
  }

  recallDirectMsg(data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道私聊消息：[${data.guild_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallDirectMessage(data.guild_id, i, hide), message_id)
  }

  recallGuildMsg(data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道消息：[${data.channel_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallGuildMessage(data.channel_id, i, hide), message_id)
  }

  sendGuildMsg(data, msg, event) {
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) user_id = userIdCache[user_id]
    if (user_id.startsWith('qg_')) return this.pickGuildFriend(id, user_id)

    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      sendWakeUp: message => this.sendWakeUp(i, message),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
    }
  }

  pickMember(id, group_id, user_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    if (typeof user_id !== "string") user_id = String(user_id)
    if (config.toQQUin && userIdCache[user_id]) {
      user_id = userIdCache[user_id]
    }
    if (user_id.startsWith('qg_')) { return this.pickGuildMember(id, group_id, user_id) }
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ''),
      group_id: group_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i
    }
  }

  pickGroup(id, group_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    if (group_id.startsWith?.('qg_')) { return this.pickGuild(id, group_id) }
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace?.(`${id}${this.sep}`, '') || group_id
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      recallMsg: message_id => this.recallGroupMsg(i, message_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  pickGuildFriend(id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(/^qg_/, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide)
    }
  }

  pickGuildMember(id, group_id, user_id) {
    const guild_id = group_id.replace(/^qg_/, '').split('-')
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      src_guild_id: guild_id[0],
      src_channel_id: guild_id[1],
      user_id: user_id.replace(/^qg_/, '')
    }
    return {
      ...this.pickGuildFriend(id, user_id),
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide)
    }
  }

  pickGuild(id, group_id) {
    const guild_id = group_id.replace(/^qg_/, '').split('-')
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      guild_id: guild_id[0],
      channel_id: guild_id[1]
    }
    return {
      ...i,
      sendMsg: msg => this.sendGuildMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallGuildMsg(i, message_id, hide),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
      createChannel: (channelInfo) => this.createChannel(i, channelInfo)
    }
  }

  // 创建子频道
  async createChannel(data, channelInfo) {
    try {
      Bot.makeLog('info', `创建子频道：[${data.guild_id}] ${JSON.stringify(channelInfo)}`, data.self_id)
      const result = await data.bot.sdk.createChannel(data.guild_id, channelInfo)
      return result
    } catch (err) {
      Bot.makeLog('error', ['创建子频道错误', channelInfo, err], data.self_id)
      return false
    }
  }

  async makeFriendMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
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

    data.sendInputNotify = input_second => data.bot.sdk.sendFriendInputNotify(data.openid, 1, input_second || 30, data.message_id)

    data.reply = msg =>
      this.sendFriendMsg({ ...data, user_id: event.sender.user_id }, msg, { id: data.message_id })
    await this.setFriendMap(data)
  }

  async makeGroupMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
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

    data.mentions = event.mentions || []

    let atUser = data.mentions.length ? [...data.mentions].reverse().find(m => !m.bot) : null

    if (!atUser && data.mentions.length) {
        atUser = data.mentions.at(-1);
    }

    data.at = data.mentions.length ? data.mentions.slice().reverse().find(m => !m.bot)?.member_openid || data.mentions.at(-1)?.member_openid : null

    data.at = data.at ? `${data.self_id}:${data.at}` : null

    data.atall = data.mentions.some(m => m.scope === 'all')

    data.atme = !!(data.at &&  atUser?.is_you)
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    if (config.toQQUin && Handler.has('ws.tool.findUserId')) {
      const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
      if (user_id?.custom) {
        userIdCache[user_id.custom] = data.user_id
        data.sender.user_id = user_id.custom
      }
    }

    // 自定义消息过滤前台日志防刷屏(自欺欺人大法)
    const filterLog = config.filterLog?.[data.self_id] || []
    let logStat = filterLog.includes(_.trim(data.raw_message)) ? 'debug' : 'info'
    Bot.makeLog(logStat, `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)

    data.reply = msg =>
      this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
    await this.setGroupMap(data)
  }

  async makeDirectMessage(data, event) {
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
    data.reply = msg =>
      this.sendDirectMsg(
        {
          ...data,
          user_id: event.user_id,
          guild_id: event.guild_id,
          channel_id: event.channel_id
        },
        msg,
        { id: data.message_id }
      )
    await this.setFriendMap(data)
  }

  async makeGuildMessage(data, event) {
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
    Bot.makeLog('info', `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg =>
      this.sendGuildMsg(
        { ...data, guild_id: event.guild_id, channel_id: event.channel_id },
        msg,
        { id: data.message_id }
      )
    await this.setFriendMap(data)
    await this.setGroupMap(data)
  }

  async setFriendMap(data) {
    if (!data.user_id) return
    await data.bot.fl.set(data.user_id, {
      ...data.bot.fl.get(data.user_id),
      ...data.sender
    })
  }

  async setGroupMap(data) {
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

  sendWakeUp(data, message) {
    return this.sendMsg(data, msg => data.bot.sdk.messageService.sendRecallMessage(`/v2/users/${data.user_id}`, msg), message)
  }

  async makeMessage(id, event) {
    if (event.author?.bot && config.filter_bot_msg) {
      // 发送方本身是机器人，直接丢弃
      if (event.author?.bot) return true
      // 消息里 @ 了别的机器人（bot=true 且不是当前 Bot），丢弃
      if (Array.isArray(event.mentions) && event.mentions.some(m => m?.bot === true && m?.is_you !== true)) return true
    }

    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id() { return this.sender.user_id },
      message: this.normalizeSdkMessage(event.message),
      raw_message: event.raw_message
    }

    if (event.message_type == 'audit.pass') {
      Bot.makeLog('info', [`群主动消息审核：[${id}${this.sep}${event.group_openid}]`, event.sub_type], event.self_id)
      Bot.em(`notice.audit.${event.sub_type}`, {
        ...event,
        self_id: id,
        bot: Bot[id],
        post_type: 'notice',
        notice_type: 'audit'
      })
      return
    }

    for (const i of data.message) {
      switch (i.type) {
        case 'at':
          if (data.message_type == 'group') i.qq = `${data.self_id}${this.sep}${i.user_id}`
          else i.qq = `qg_${i.user_id}`
          break
      }
    }

    switch (data.message_type) {
      case 'private':
      case 'direct':
        if (data.sub_type == 'friend') {
          await data.bot.sdk.sendFriendInputNotify(event.sender?.user_id, 1, 30, data.message_id)
          await this.makeFriendMessage(data, event)
        } else {
          await this.makeDirectMessage(data, event)
        }
        break
      case 'group':
        await this.makeGroupMessage(data, event)
        break
      case 'guild':
        await this.makeGuildMessage(data, event)
        if (data.message.length === 0) {
          data.message.push({ type: 'text', text: '' })
        }
        break
      default:
        Bot.makeLog('warn', ['未知消息', data.message_type, data.sub_type, event], id)
        return
    }

    // 修复recv_msg_cnt的递增问题
    try {
      data.bot.stat.recv_msg_cnt++
    } catch (err) {
      // 如果直接递增失败，尝试使用赋值方式
      try {
        data.bot.stat.recv_msg_cnt = (data.bot.stat.recv_msg_cnt || 0) + 1
      } catch (err2) {
        // 忽略错误，确保程序继续运行
        Bot.makeLog('debug', ['无法更新接收消息计数', err2], id)
      }
    }

    Bot[data.self_id].dau.setDau('receive_msg', data)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeCallback(id, event) {
    const reply = event.reply.bind(event)
    event.reply = async (...args) => {
      try {
        return await reply(...args)
      } catch (err) {
        Bot.makeLog('debug', ['回复按钮点击事件错误', err], data.self_id)
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
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
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

    const wrapWithEventId = (msg) => {
      msg = Array.isArray(msg) ? [...msg] : [msg]
      msg.unshift({ type: 'reply', id: `event_${interactionEventId}` })
      return msg
    }

    switch (data.message_type) {
      case 'direct':
      case 'friend':
        data.message_type = 'private'
        Bot.makeLog('info', [`好友按钮点击事件：[${data.user_id}]`, data.raw_message], data.self_id)
        data.reply = msg => this.sendFriendMsg(
          { ...data, user_id: event.operator_id },
          wrapWithEventId(msg),
          { event_id: `event_${interactionEventId}` }
        )
        await this.setFriendMap(data)
        break
      case 'group':
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog('info', [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)
        data.reply = msg => this.sendGroupMsg(
          { ...data, group_id: event.group_id },
          wrapWithEventId(msg),
          { event_id: `event_${interactionEventId}` }
        )
        await this.setGroupMap(data)
        break
      case 'guild':
        break
      default:
        Bot.makeLog('warn', ['未知按钮点击事件', event], data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeNotice(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      sub_type: event.sub_type,
      notice_id: event.notice_id,
      group_id: event.group_id,
      user_id: event.user_id || event.operator_id
    }

    switch (data.sub_type) {
      case 'action':
        return this.makeCallback(id, event)
      case 'increase':
        Bot[data.self_id].dau.setDau('group_increase', data)
        if (event.notice_type === 'group') {
          const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'Model', 'template', 'groupIncreaseMsg.js')
          if (fs.existsSync(path)) {
            import(`file://${path}`).then(i => i.default).then(async i => {
              let msg
              if (typeof i === 'function') {
                msg = await i(`${data.self_id}${this.sep}${event.group_id}`, `${data.self_id}${this.sep}${data.user_id}`, data.self_id)
              } else {
                msg = i
              }
              if (msg?.length > 0) {
                this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(event.group_id, msg), msg)
              }
            })
          }
        }
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { event_id: event.event_id })
        Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
        return
      case 'decrease':
        Bot[data.self_id].dau.setDau('group_decrease', data)
      case 'update':
      case 'member.increase':
      case 'member.decrease':
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

  makeForumPost(id, event) {
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

    // 获取帖子详细信息以显示标题和内容
    this.getChannelThreadInfo(data.channel_id, data.thread_id).then(threadInfo => {
      const thread = threadInfo?.thread
      const title = thread?.thread_info?.title || '无标题'

      // 解析帖子内容
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
              contentText = contentText.substring(0, 100) // 增加内容长度限制
            }
          }
        }
      } catch (e) {
        // JSON解析失败，尝试直接解析为文本
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
      // 获取详细信息失败时的备用日志
      Bot.makeLog('info', [`论坛帖子创建事件：[频道:${data.channel_id}, 主题:${data.thread_id}, 帖子:${data.post_id}]`, event], id)
    })

    // 触发事件
    Bot.em('forum.post.create', data)
  }

  makeForumPostDelete(id, event) {
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

    // 触发事件
    Bot.em('forum.post.delete', data)
  }

  makeForumReply(id, event) {
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

    // 触发事件
    Bot.em('forum.reply.create', data)
  }

  makeForumReplyDelete(id, event) {
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

    // 触发事件
    Bot.em('forum.reply.delete', data)
  }

  getFriendMap(id) {
    return Bot.getMap(`${this.path}${id}/Friend`)
  }

  getGroupMap(id) {
    return Bot.getMap(`${this.path}${id}/Group`)
  }

  getMemberMap(id) {
    return Bot.getMap(`${this.path}${id}/Member`)
  }

  async connect(token) {
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

    if (Number(token[4])) opts.intents.push('GROUP_AND_C2C_EVENT')

    if (Number(token[5])) opts.intents.push('GUILD_MESSAGES')
    else opts.intents.push('PUBLIC_GUILD_MESSAGES')

    Bot[id] = {
      adapter: this,
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
        id: this.id,
        name: this.name,
        version: this.version
      },
      stat: {
        start_time: Date.now() / 1000,
        recv_msg_cnt: 0
      },

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser() { return this.pickFriend },
      getFriendMap() { return this.fl },
      fl: await this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      callbacks: async (group, msg, btnid) => await this.callbacks(opts.appid, group, msg, btnid),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: await this.getGroupMap(id),
      gml: await this.getMemberMap(id),

      dau: new Dau(id, this.sep, config.dauDB),

      // 获取频道线程列表
      async getChannelThreads(channel_id) {
        const { data: result } = await this.sdk.request.get(`/channels/${channel_id}/threads`)
        return result
      },

      // 获取频道线程信息
      async getChannelThreadInfo(channel_id, thread_id) {
        const { data: result } = await this.sdk.request.get(`/channels/${channel_id}/threads/${thread_id}`)
        return result
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
      void this.makeMessage(id, event).catch(e =>
        Bot.makeLog('error', [`${this.name} makeMessage`, e], id))
    })
    Bot[id].sdk.on('notice', event => this.makeNotice(id, event))
    Bot[id].sdk.on('FORUM_POST_CREATE', event => this.makeForumPost(id, event))
    Bot[id].sdk.on('FORUM_POST_DELETE', event => this.makeForumPostDelete(id, event))
    Bot[id].sdk.on('FORUM_REPLY_CREATE', event => this.makeForumReply(id, event))
    Bot[id].sdk.on('FORUM_REPLY_DELETE', event => this.makeForumReplyDelete(id, event))

    await Bot[id].dau.init()

    try {
      if (token[4] === "2") {
        await Bot[id].sdk.sessionManager.getAccessToken()
        Bot[id].login = () => this.appid[opts.appid] = Bot[id]
        Bot[id].logout = () => delete this.appid[opts.appid]
      }

      await Bot[id].login()
      Object.assign(Bot[id].info, await Bot[id].sdk.getSelfInfo())
    } catch (err) {
      Bot.makeLog("error", [`${this.name}(${this.id}) ${this.version} 连接失败`, err], id)
      return false
    }

    Bot.makeLog("mark", `${this.name}(${this.id}) ${this.version} ${Bot[id].nickname} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async makeWebHookSign(id, req, secret) {
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

  makeWebHook(req) {
    const appid = req.headers["x-bot-appid"]
    if (!this.appid.hasOwnProperty(appid))
      return Bot.makeLog("warn", "找不到对应Bot", appid)
    if (req.body?.d.hasOwnProperty("plain_token"))
      return this.makeWebHookSign(req, this.appid[appid].info.secret)
    if (req.body.hasOwnProperty('t'))
      this.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
    req.res.send({ code: 0 })
  }

  async load() {
    Bot.express.use(`/${this.name}`, this.makeWebHook.bind(this))
    Bot.express.quiet.push(`/${this.name}`)
    for (const token of config.token) {
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
    }
  }
}()

Bot.adapter.push(adapter)

const setMap = {
  二维码: 'toQRCode',
  按钮回调: 'toCallback',
  转换: 'toQQUin',
  转图片: 'toImg',
  调用统计: 'callStats',
  用户统计: 'userStats',
  文字链: 'TextChains',
  机器人消息过滤: 'filter_bot_msg'
}

export class QQBotAdapter extends plugin {
  constructor() {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      rule: [
        {
          reg: /^#[Qq]+[Bb]ot(帮助|help)$/i,
          fnc: 'help',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot账号$/i,
          fnc: 'List',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot设置[0-9]+:[0-9]+:.+:.+:([01]:[01]|2)$/i,
          fnc: 'Token',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?[0-9]+:/i,
          fnc: 'Markdown',
          permission: config.permission
        },
        {
          reg: "^#[Qq]+[Bb]ot图片限制[0-9]+$",
          fnc: "ImageLength",
          permission: config.permission,
        },
        {
          reg: new RegExp(`^#[Qq]+[Bb]ot设置(${Object.keys(setMap).join('|')})\\s*(开启|关闭)$`, 'i'),
          fnc: 'Setting',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot[Dd][Aa][Uu]/i,
          fnc: 'DAUStat',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot调用统计$/i,
          fnc: 'callStat',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot用户统计$/i,
          fnc: 'userStat',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot刷新co?n?fi?g$/i,
          fnc: 'refConfig',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot(添加|删除)过滤日志/i,
          fnc: 'filterLog',
          permission: config.permission
        },
        {
          reg: /^#[Qq]+[Bb]ot一键群发$/i,
          fnc: 'oneKeySendGroupMsg',
          permission: config.permission
        },
        {
          reg: '^#(开启|关闭)([Bb][Oo][Tt]|机器人)(消息)?过滤$',
          fnc: 'turn_filter_bot',
          permission: config.permission,
        }
      ]
    })
  }

  help() {
    this.reply(['# QQBot 帮助', segment.button(
      [
        { text: 'dau', callback: '#QQBotdau' },
        { text: 'daupro', callback: '#QQBotdaupro' }
      ],
      [
        { text: '调用统计', callback: '#QQBot调用统计' },
        { text: '用户统计', callback: '#QQBot用户统计' }
      ],
      [
        { text: `${config.TextChains ? '关闭' : '开启'}文字链`, callback: `#QQBot设置文字链${config.TextChains ? '关闭' : '开启'}` },
        { text: `${config.toCallback ? '关闭' : '开启'}按钮回调`, callback: `#QQBot设置按钮回调${config.toCallback ? '关闭' : '开启'}` }
      ],
      [
        { text: `${config.callStats ? '关闭' : '开启'}调用统计`, callback: `#QQBot设置调用统计${config.callStats ? '关闭' : '开启'}` },
        { text: `${config.userStats ? '关闭' : '开启'}用户统计`, callback: `#QQBot设置用户统计${config.userStats ? '关闭' : '开启'}` }
      ],
      [
        { text: `${config.filter_bot_msg ? '关闭' : '开启'}机器人消息过滤`, callback: `#QQBot设置机器人消息过滤${config.filter_bot_msg ? '关闭' : '开启'}` }
      ]
    )])
  }

  refConfig() {
    refConfig()
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join('\n')}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Qq]+[Bb]ot设置/i, '').trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
      this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await adapter.connect(token)) {
        config.token.push(token)
        this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        this.reply('账号连接失败', true)
        return false
      }
    }
    return configSave()
  }

  Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/i, '').trim().split(':')
    const bot_id = token.shift()
    token = token.join(':')
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    return configSave()
  }

  ImageLength() {
    const imageLength = +this.e.msg.replace(/^#[Qq]+[Bb]ot图片限制/, "").trim()
    if (!(imageLength > 0)) return this.reply("请输入正确数字", true)
    if (!sharp) return this.reply("请检查 sharp 是否正确安装", true)
    this.reply(`图片大小已限制为 ${imageLength}MB`, true)
    config.imageLength = imageLength
    return configSave()
  }

  async Setting() {
    const reg = /^#[Qq]+[Bb]ot设置(.+)\s*(开启|关闭)$/i
    const regRet = reg.exec(this.e.msg)
    const state = regRet[2] == '开启'
    config[setMap[regRet[1]]] = state
    this.reply('设置成功,已' + (state ? '开启' : '关闭'), true)
    await configSave()
  }

  async DAUStat() {
    const pro = this.e.msg.includes('pro')
    const uin = this.e.msg.replace(/^#[Qq]+[Bb]ot[Dd][Aa][Uu]([Pp]ro)?/i, '') || this.e.self_id
    const dau = Bot[uin]?.dau
    if (!dau || !dau.dauDB) return false
    const msg = await dau.getDauStatsMsg(this.e, pro)
    if (msg.length) this.reply(msg, true)
  }

  async callStat() {
    if (!config.callStats) return false
    const dau = this.e.bot.dau
    if (!dau || !dau.dauDB) return false
    const msg = dau.getCallStatsMsg(this.e)
    if (msg.length) this.reply(msg, true)
  }

  async userStat() {
    if (!config.userStats) return false
    const dau = this.e.bot.dau
    if (!dau || !dau.dauDB) return false
    if (dau.dauDB === 'redis') {
      return this.reply('用户统计只适配了level,,,', true)
    }
    const msg = await dau.getUserStatsMsg(this.e)
    if (msg.length) this.reply(msg, true)
  }

  // 自欺欺人大法
  async filterLog() {
    const match = /^#[Qq]+[Bb]ot(添加|删除)过滤日志(.*)/i.exec(this.e.msg)
    let msg = _.trim(match[2]) || ''
    if (!msg) return false

    let isAdd = match[1] === '添加'
    const filterLog = config.filterLog[this.e.self_id] || []
    const has = filterLog.includes(msg)

    if (has && isAdd) return false
    else if (!has && !isAdd) return false
    else if (!has && isAdd) {
      filterLog.push(msg)
      msg = `【${msg}】添加成功， info日志已过滤该消息`
    } else {
      _.pull(filterLog, msg)
      msg = `【${msg}】删除成功， info日志已恢复打印该消息`
    }
    config.filterLog[this.e.self_id] = filterLog
    await configSave()
    this.reply(msg, true)
  }

  async turn_filter_bot(e) {
    if (e.msg.includes('开启')) {
      config.filter_bot_msg = true
      await configSave()
      return this.reply('开启bot消息过滤成功')
    }
    if (e.msg.includes('关闭')) {
      config.filter_bot_msg = false
      await configSave()
      return this.reply('关闭bot消息过滤成功')
    }
    return this.reply('修改失败')
  }

  async oneKeySendGroupMsg() {
    if (this.e.adapter_name !== 'QQBot') return false
    const msg = await importJS('Model/template/oneKeySendGroupMsg.js', 'default')
    if (msg === false) {
      this.reply('请先设置模版哦', true)
    } else {
      const groupList = this.e.bot.dau.dauDB === 'level' ? Object.keys(this.e.bot.dau.all_group) : [...this.e.bot.gl.keys()]
      const getMsg = typeof msg === 'function' ? msg : () => msg
      const errGroupList = []
      for (const key of groupList) {
        if (key === 'total') continue
        const id = this.e.bot.dau.dauDB === 'level' ? `${this.e.self_id}${this.e.bot.adapter.sep}${key}` : key
        const sendMsg = await getMsg(id)
        if (!sendMsg?.length) continue
        const sendRet = await this.e.bot.pickGroup(id).sendMsg(sendMsg)
        if (sendRet.error.length) {
          for (const i of sendRet.error) {
            if (i.message.includes('机器人非群成员')) {
              errGroupList.push(key)
              break
            }
          }
        }
      }
      if (errGroupList.length) await this.e.bot.dau.deleteNotExistGroup(errGroupList)
      logger.info(logger.green(`QQBot ${this.e.self_id} 群消息一键发送完成，共${groupList.length - 1}个群，失败${errGroupList.length}个`))
    }
  }
}

const endTime = new Date()
logger.info(logger.green(`- QQBot 适配器插件 加载完成! 耗时：${endTime - startTime}ms`))
