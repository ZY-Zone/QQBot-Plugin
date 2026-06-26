import _ from 'lodash'
import { segment } from 'qq-official-bot'
import { config, Runtime, Handler } from '../model/index.js'
import { TmplPkg, URL_REGEXP, URL_REGEXP_FULL, userIdCache, sharp, markdown_template } from '../utils/constants.js'
import { patchSegmentImageSizeOptions, pickImageSizeOptions, convertURL } from '../utils/helpers.js'
import { makeMarkdownImage } from './image.js'
import { makeButton, makeButtons, makeTextChain, makeTextChains, makeMarkdownText_, makeMarkdownText, makeMarkdownTemplate, makeMarkdownTemplatePush } from './button.js'
import { _parseFileSegment } from './file.js'

export async function makeRawMarkdownMsg(adapter, data, msg, keyboard) {
  patchSegmentImageSizeOptions()
  const messages = []
  const button = []
  const files = []
  let content = ''
  let reply

  const msgArray = Array.isArray(msg) ? msg : [msg]

  const imageIndices = []
  const imagePromises = []
  for (let idx = 0; idx < msgArray.length; idx++) {
    const item = msgArray[idx]
    if (item && typeof item === 'object' && item.type === 'image') {
      imageIndices.push(idx)
      imagePromises.push(makeMarkdownImage(adapter, data, item.file, item.summary, item))
    }
  }
  let imageResults = []
  if (imagePromises.length > 0) {
    try {
      imageResults = await Promise.all(imagePromises)
    } catch (err) {
      Bot.makeLog('error', ['图片并行处理出错，降级为串行', err], data.self_id)
      imageResults = []
      for (let j = 0; j < imagePromises.length; j++) {
        try {
          const item = msgArray[imageIndices[j]]
          imageResults.push(await makeMarkdownImage(adapter, data, item.file, item.summary, item))
        } catch (e) {
          Bot.makeLog('error', [`处理第${j + 1}张图片失败`, e], data.self_id)
          imageResults.push({ des: '![图片加载失败]', url: '()' })
        }
      }
    }
  }

  let imageIndex = 0
  for (let i of msgArray) {
    if (typeof i === "object") i = { ...i }
    else i = { type: "text", text: Bot.String(i) }

    if (i.type === 'image' && imageResults[imageIndex]) {
      const { des, url } = imageResults[imageIndex]
      content += `${des}${url}`
      imageIndex++
      continue
    }

    switch (i.type) {
      case 'record':
        i.type = 'audio'
        i.file = await adapter.makeRecord(i.file)
      case 'video':
      case 'face':
      case 'ark':
      case 'embed':
        messages.push([i])
        content += ''
        break
      case 'file': {
        Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
        const fileData = _parseFileSegment(adapter, i, data)
        files.push(fileData)
        Bot.makeLog('debug', ['收集文件消息', fileData], data.self_id)
        content += ''
        break
      }
      case "at":
        if (i.qq === "all") content += "<qqbot-at-everyone />"
        else
          content += `<@${i.qq?.replace?.(`${data.self_id}${adapter.sep}`, "")}>`
        break
      case 'text':
        content += await adapter.makeRawMarkdownText(data, i.text, keyboard && button)
        break
      case 'image':
        break
      case 'markdown':
        if (typeof i.data == 'object') {
          let markdownObj = { type: 'markdown', ...i.data }
          if (i.data.hide_avatar_and_center) {
            markdownObj.style = { layout: 'hide_avatar_and_center', ...markdownObj.style }
            delete markdownObj.hide_avatar_and_center
          }
          messages.push([markdownObj])
        }
        else content += i.data
        break
      case "button":
        if (config?.TextChains) content += makeTextChains(adapter, data, i.data)
        else button.push(...makeButtons(adapter, data, i.data))
        break
      case "reply":
        if (i.id.startsWith("event_"))
          reply = { type: "reply", event_id: i.id.replace(/^event_/, "") }
        else reply = i
        continue
      case 'node':
        for (const { message } of i.data) { messages.push(...(await makeRawMarkdownMsg(adapter, data, message, keyboard && button))) }
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
        content += await adapter.makeRawMarkdownText(data, JSON.stringify(i), keyboard && button)
    }
  }

  if (content) {
    const prefix = config.markdown?.prefix || ''
    const suffix = config.markdown?.suffix || ''
    if (prefix || suffix) content = prefix + content + suffix
    messages.unshift([{ type: "markdown", content }])
  }

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

export async function makeMarkdownMsg(adapter, data, msg) {
  patchSegmentImageSizeOptions()
  const messages = []
  const button = []
  const files = []
  let template = []
  let templates = []
  let content = ''
  let reply
  const length = markdown_template?.params?.length || config.customMD?.[data.self_id]?.keys?.length || config.markdown.template.length

  const msgArray = Array.isArray(msg) ? msg : [msg]

  const mdImageIndices = []
  const mdImagePromises = []
  for (let idx = 0; idx < msgArray.length; idx++) {
    const item = msgArray[idx]
    if (item && typeof item === 'object' && item.type === 'image') {
      mdImageIndices.push(idx)
      mdImagePromises.push(makeMarkdownImage(adapter, data, item.file, item.summary, item))
    }
  }
  let mdImageResults = []
  if (mdImagePromises.length > 0) {
    try {
      mdImageResults = await Promise.all(mdImagePromises)
    } catch (err) {
      Bot.makeLog('error', ['Markdown 图片并行处理出错，降级为串行', err], data.self_id)
      mdImageResults = []
      for (let j = 0; j < mdImagePromises.length; j++) {
        try {
          const item = msgArray[mdImageIndices[j]]
          mdImageResults.push(await makeMarkdownImage(adapter, data, item.file, item.summary, item))
        } catch (e) {
          Bot.makeLog('error', [`处理第${j + 1}张图片失败`, e], data.self_id)
          mdImageResults.push({ des: '![图片加载失败]', url: '()' })
        }
      }
    }
  }

  let mdImageIndex = 0
  for (let i of msgArray) {
    if (typeof i == 'object') i = { ...i }
    else i = { type: 'text', text: Bot.String(i) }

    if (i.type === 'image' && mdImageResults[mdImageIndex]) {
      const { des, url } = mdImageResults[mdImageIndex]
      template = makeMarkdownTemplatePush(adapter, [[content, des]], template, templates)
      const limit = template.length % (length - 1)
      if (template.length && !limit) {
        if (content) template.push(content)
        template.push(des)
      } else template.push(content + des)
      content = url
      mdImageIndex++
      continue
    }

    switch (i.type) {
      case 'record':
        i.type = 'audio'
        i.file = await adapter.makeRecord(i.file)
      case 'video':
      case 'face':
      case 'ark':
      case 'embed':
        messages.push([i])
        content += ''
        break
      case 'file': {
        Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
        const fileData = _parseFileSegment(adapter, i, data)
        files.push(fileData)
        Bot.makeLog('debug', ['收集文件消息', fileData], data.self_id)
        content += ''
        break
      }
      case 'at':
        if (i.qq == 'all') content += '"<qqbot-at-everyone />'
        else {
          if (config.toQQUin && userIdCache[i.qq]) i.qq = userIdCache[i.qq]
          content += `<@${i.qq?.replace?.(`${data.self_id}${adapter.sep}`, '')}>`
        }
        break
      case "text": {
        const [text, temp] = makeMarkdownText(adapter, data, i.text, content)
        if (Array.isArray(temp)) {
          template = makeMarkdownTemplatePush(adapter, temp, template, templates)
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
            button.push(...makeButtons(adapter, data, b.data ? b.data : [b]))
          }
        } else if (TmplPkg && TmplPkg?.nodeMsg) {
          messages.push(...(await makeMarkdownMsg(adapter, data, TmplPkg.nodeMsg(i.data))))
          continue
        } else {
          for (const { message } of i.data) {
            messages.push(...(await makeMarkdownMsg(adapter, data, message)))
          }
          continue
        }
      case 'image':
        break
      case 'markdown':
        if (typeof i.data == 'object') {
          let markdownObj = { type: 'markdown', ...i.data }
          if (i.data.hide_avatar_and_center) {
            markdownObj.style = { layout: 'hide_avatar_and_center', ...markdownObj.style }
            delete markdownObj.hide_avatar_and_center
          }
          messages.push([markdownObj])
        }
        else content += i.data
        break
      case 'button':
        if (config?.TextChains) content += makeTextChains(adapter, data, i.data)
        else button.push(...makeButtons(adapter, data, i.data))
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
        const [text, temp] = makeMarkdownText(adapter, data, Bot.String(i), content)
        if (Array.isArray(temp)) {
          template = makeMarkdownTemplatePush(adapter, temp, template, templates)
          content = text
        } else {
          content += text
        }
      }
    }
  }

  if (content) template.push(content)
  if (template.length > length) {
    const templates = _(template).chunk(length).map(v => makeMarkdownTemplate(adapter, data, v)).value()
    messages.push(...templates)
  } else if (template.length) {
    const tmp = makeMarkdownTemplate(adapter, data, template)
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
    button.splice(position, 0, ...makeButtons(adapter, data, [btn]))
  }

  if (button.length) {
    for (const i of messages) {
      if (i[0].type == 'markdown') i.push(...button.splice(0, 5))
      if (!button.length) break
    }
    while (button.length) {
      messages.push([
        ...makeMarkdownTemplate(adapter, data, [' ']),
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

export async function makeMsg(adapter, data, msg) {
  patchSegmentImageSizeOptions()
  const sendType = ['audio', 'image', 'video', 'file']
  const messages = []
  const button = []
  const files = []
  const botId = data?.self_id?.toString()
  if (botId && config.keyboard && config.keyboard[botId]) {
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
        i.file = await adapter.makeRecord(i.file)
      case 'video':
      case 'file': {
        Bot.makeLog('debug', ['file segment 原始结构', i], data.self_id)
        const fileData = _parseFileSegment(adapter, i, data)
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
          i.file = await adapter.compressImage(data, i.file)
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
        config.sendButton && button.push(...makeButtons(adapter, data, i.data))
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
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
        } else {
          for (const { message } of i.data) {
            messages.push(...(await makeMsg(adapter, data, message)))
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
      if (adapter.toQRCodeRegExp) {
        const match = i.text.match(adapter.toQRCodeRegExp)
        if (match) {
          for (const url of match) {
            const msg = segment.image(await adapter.makeQRCode(url))
            if (message.some(s => sendType.includes(s.type))) {
              messages.push(message)
              message = []
            }
            message.push(msg)
            i.text = i.text.replace(url, '[链接(请扫码查看)]')
          }
        }
      } else if (adapter.toQRCodeMode === 'url') {
        const match = i.text.match(URL_REGEXP)
        if (match) {
          for (const url of match) {
            i.text = i.text.replace(url, convertURL(url))
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

export async function makeGuildMsg(adapter, data, msg) {
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
        config.sendButton && button.push(...makeButtons(adapter, data, i.data))
        continue
      case 'node':
        for (const { message } of i.data) { messages.push(...(await makeGuildMsg(adapter, data, message))) }
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
      if (adapter.toQRCodeRegExp) {
        const match = i.text.match(adapter.toQRCodeRegExp)
        if (match) {
          for (const url of match) {
            const msg = segment.image(await adapter.makeQRCode(url))
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
      } else if (adapter.toQRCodeMode === 'url') {
        const match = i.text.match(URL_REGEXP)
        if (match) {
          for (const url of match) {
            i.text = i.text.replace(url, convertURL(url))
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

export function installMessageBuilder(adapter) {
  adapter.makeRawMarkdownMsg = (data, msg, keyboard) => makeRawMarkdownMsg(adapter, data, msg, keyboard)
  adapter.makeMarkdownMsg = (data, msg) => makeMarkdownMsg(adapter, data, msg)
  adapter.makeMsg = (data, msg) => makeMsg(adapter, data, msg)
  adapter.makeGuildMsg = (data, msg) => makeGuildMsg(adapter, data, msg)
}
