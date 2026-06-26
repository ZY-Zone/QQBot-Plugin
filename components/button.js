import { randomUUID } from 'node:crypto'
import _ from 'lodash'
import { config } from '../Model/index.js'
import { URL_REGEXP, URL_REGEXP_FULL, userIdCache } from '../utils/constants.js'
import { makeQRCode, makeMarkdownImage } from './image.js'

export function makeButton(adapter, data, button) {
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
        msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${adapter.sep}`, ''))
      }
    }
  }
  return msg
}

export function makeButtons(adapter, data, button_square) {
  const msgs = []
  for (const button_row of button_square) {
    const buttons = []
    for (let button of button_row) {
      button = makeButton(adapter, data, button)
      if (button) buttons.push(button)
    }
    if (buttons.length) { msgs.push({ type: 'button', buttons }) }
  }
  return msgs
}

export function makeTextChain(adapter, data, button) {
  let msg

  if (button.input) msg = `text="${button.input}"`
  else if (button.callback) msg = `text="${button.callback}"`
  else if (button.link) msg = `text="${button.link}"`
  else return false

  if (button.text) msg += ` show="[${button.text}]"`
  return `<qqbot-cmd-input ${msg} />`
}

export function makeTextChains(adapter, data, button_square) {
  const msgs = []
  for (const button_row of button_square) {
    const buttons = []
    for (let button of button_row) {
      button = makeTextChain(adapter, data, button)
      if (button) buttons.push(button)
    }
    if (buttons.length) msgs.push(buttons.join(" "))
  }
  if (msgs.length) msgs.unshift("")
  return msgs.join("\n")
}

export function makeMarkdownText_(adapter, data, text) {
  if (adapter.toQRCodeMode === 'url') {
    text = text.replace(URL_REGEXP_FULL, '<$&>')
  } else if (adapter.toQRCodeRegExp) {
    text = text.replace(adapter.toQRCodeRegExp, (url) => {
      return makeTextChain(adapter, data, { text: "链接", link: url })
    })
  }
  return text
    .replace(/\n/g, "\r")
    .replace(/@\u200B/g, "@")
    .replace(/<qqbot-\u200B/g, "<qqbot-")
}

export function makeMarkdownText(adapter, data, text, content) {
  const match = text.match(/!?\[.*?\]\s*\(\w+:\/\/.*?\)/g)
  if (match) {
    const temp = []
    let last = ""
    for (const i of match) {
      const match = i.match(/(!?\[.*?\])\s*(\(\w+:\/\/.*?\))/)
      text = text.split(i)
      temp.push([last + makeMarkdownText_(adapter, data, text.shift()), match[1]])
      text = text.join(i)
      last = match[2]
    }
    temp[0][0] = content + temp[0][0]
    return [last + makeMarkdownText_(adapter, data, text), temp]
  }
  return [makeMarkdownText_(adapter, data, text)]
}

export function makeMarkdownTemplate(adapter, data, templates) {
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

export function makeMarkdownTemplatePush(adapter, content, template, templates) {
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

export function installButton(adapter) {
  adapter.makeButton = (data, button) => makeButton(adapter, data, button)
  adapter.makeButtons = (data, button_square) => makeButtons(adapter, data, button_square)
  adapter.makeTextChain = (data, button) => makeTextChain(adapter, data, button)
  adapter.makeTextChains = (data, button_square) => makeTextChains(adapter, data, button_square)
  adapter.makeMarkdownText_ = (data, text) => makeMarkdownText_(adapter, data, text)
  adapter.makeMarkdownText = (data, text, content) => makeMarkdownText(adapter, data, text, content)
  adapter.makeMarkdownTemplate = (data, templates) => makeMarkdownTemplate(adapter, data, templates)
  adapter.makeMarkdownTemplatePush = (content, template, templates) => makeMarkdownTemplatePush(adapter, content, template, templates)
}
