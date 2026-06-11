import makeConfig from '../../../lib/plugins/config.js'
import YAML from 'yaml'
import fs from 'node:fs'

let { config, configSave } = await makeConfig('QQBot', {
  tips: '',
  WsUrl: { 114514: 'ws://...' },
  ApiUrl: { 114514: 'http://...' },
  permission: 'master',
  dauDB: 'redis',
  toQRCode: false,
  toCallback: true,
  toBotUpload: true,
  forceSilk: false,
  hideGuildRecall: false,
  imageLength: 3,
  toQQUin: false,
  toImg: false,
  tencentCOS: true,
  callStats: false,
  userStats: false,
  markdown: {
    template: 'abcdefghij',
    prefix: '',
    suffix: ''
  },
  keyboard: {},  // 按钮模板ID映射，格式如："3889001286": "102076896_1763887100"
  filter_bot_msg: false,
  sendButton: false,
  customMD: {},
  getAt: true,
  mdSuffix: {},
  btnSuffix: {},
  filterLog: {},
  simplifiedSdkLog: false,
  markdownImgScale: 1.0,
  sep: '',
  TextChains: false,
  stream: false,
  smallbtn: false,
  chunkSize: 2,
  delay: 100,
  bots: {},           // Per-bot 配置覆盖
  offlineDetect: {    // 掉线检测配置
    enabled: false,
    interval: 5,
    notify: true,
    autoReconnect: true,
    heartbeatTimeout: 30000
  },
  recall: { bots: {} },    // 召回系统配置
  claw: { bots: {} },      // Claw 配置交互
  inviteDB: 'level',       // 邀请/召回存储后端
  bot: {
    sandbox: false,
    maxRetry: Infinity,
    timeout: 30000
  },
  token: []
}, {
  tips: [
    '欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空 & 小叶 & 小丞 & TS霆生',
    '地址：https://gitee.com/ts-yf/QQBot-Plugin'
  ]
})

function refConfig() {
  config = YAML.parse(fs.readFileSync('config/QQBot.yaml', 'utf-8'))
}

export {
  config,
  configSave,
  refConfig
}
