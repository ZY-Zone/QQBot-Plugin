import makeConfig from '../../../lib/plugins/config.js'
import YAML from 'yaml'
import fs from 'node:fs'

let { config, configSave } = await makeConfig('QQBot', {
  tips: '',
  WsUrl: { 114514: 'ws://...' },
  permission: 'master',
  dauDB: 'redis',
  toQRCode: true,
  toCallback: true,
  toBotUpload: true,
  hideGuildRecall: false,
  toQQUin: false,
  toImg: true,
  callStats: false,
  userStats: false,
  callbacks: {
    open: true,
    url: 'http://yue1314.asia/callback',
    appid: 'appid',
    group: 'group',
    msg: 'msg',
    id: 'id',
  },
  markdown: {
    template: 'abcdefghij'
  },
  sendButton: true,
  customMD: {},
  mdSuffix: {},
  btnSuffix: {},
  filterLog: {},
  simplifiedSdkLog: false,
  markdownImgScale: 1.0,
  sep: '',
  addGroupUseEventID: true,
  bot: {
    sandbox: false,
    maxRetry: Infinity,
    timeout: 30000
  },
  token: []
}, {
  tips: [
    '欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空 & 小叶 & TS霆生',
    '地址：https://gitee.com/ts-yf/QQBot-Plugin'
  ]
})

function refConfig () {
  config = YAML.parse(fs.readFileSync('config/QQBot.yaml', 'utf-8'))
}

export {
  config,
  configSave,
  refConfig
}
