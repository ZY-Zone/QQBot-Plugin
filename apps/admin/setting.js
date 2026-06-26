import _ from 'lodash'
import { config, configSave } from '../../model/index.js'
import { sharp } from '../../utils/constants.js'

export const setMap = {
  二维码: 'toQRCode',
  按钮回调: 'toCallback',
  转换: 'toQQUin',
  转图片: 'toImg',
  调用统计: 'callStats',
  用户统计: 'userStats',
  文字链: 'TextChains',
  机器人消息过滤: 'filter_bot_msg'
}

export async function ImageLength() {
  const imageLength = +this.e.msg.replace(/^#[Qq]+[Bb]ot图片限制/, "").trim()
  if (!(imageLength > 0)) return this.reply("请输入正确数字", true)
  if (!sharp) return this.reply("请检查 sharp 是否正确安装", true)
  this.reply(`图片大小已限制为 ${imageLength}MB`, true)
  config.imageLength = imageLength
  return configSave()
}

export async function Setting() {
  const reg = /^#[Qq]+[Bb]ot设置(.+)\s*(开启|关闭)$/i
  const regRet = reg.exec(this.e.msg)
  const state = regRet[2] == '开启'
  config[setMap[regRet[1]]] = state
  this.reply('设置成功,已' + (state ? '开启' : '关闭'), true)
  await configSave()
}

export async function filterLog() {
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

export async function turn_filter_bot(e) {
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
