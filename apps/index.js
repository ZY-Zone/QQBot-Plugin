import plugin from '../../../lib/plugins/plugin.js'
import { config } from '../Model/index.js'
import { setMap } from './admin/setting.js'
import { List, Token, QRLogin } from './admin/account.js'
import { ImageLength, Setting, filterLog, turn_filter_bot } from './admin/setting.js'
import { DAUStat, callStat, userStat } from './admin/stats.js'
import { Markdown } from './markdown.js'
import { refConfig, oneKeySendGroupMsg } from './tools.js'

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
          reg: /^#[Qq]+[Bb]ot登录[0-9]+:([01]:[01]|2)$/i,
          fnc: 'QRLogin',
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
}

QQBotAdapter.prototype.List = List
QQBotAdapter.prototype.Token = Token
QQBotAdapter.prototype.QRLogin = QRLogin
QQBotAdapter.prototype.ImageLength = ImageLength
QQBotAdapter.prototype.Setting = Setting
QQBotAdapter.prototype.filterLog = filterLog
QQBotAdapter.prototype.turn_filter_bot = turn_filter_bot
QQBotAdapter.prototype.DAUStat = DAUStat
QQBotAdapter.prototype.callStat = callStat
QQBotAdapter.prototype.userStat = userStat
QQBotAdapter.prototype.Markdown = Markdown
QQBotAdapter.prototype.refConfig = refConfig
QQBotAdapter.prototype.oneKeySendGroupMsg = oneKeySendGroupMsg
