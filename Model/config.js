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
  hideGuildRecall: false,
  imageLength: 3,
  toQQUin: false,
  toImg: false,
  callStats: false,
  userStats: false,
  markdown: {
    template: 'abcdefghij'
  },
  keyboard: {},  // 按钮模板ID映射，格式如："3889001286": "102076896_1763887100"

  sendButton: false,
  customMD: {},
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
