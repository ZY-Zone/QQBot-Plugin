import { config } from '../model/index.js'
import { PER_BOT_CONFIG_KEYS } from '../utils/constants.js'

export { PER_BOT_CONFIG_KEYS }

export function ensureBotConfig(adapter, selfId = '') {
  if (!config.bots || typeof config.bots !== 'object' || Array.isArray(config.bots)) config.bots = {}
  const key = selfId || 'default'
  if (!config.bots[key] || typeof config.bots[key] !== 'object') config.bots[key] = {}
  const botConfig = config.bots[key]
  for (const cfgKey of PER_BOT_CONFIG_KEYS) {
    if (typeof botConfig[cfgKey] === 'undefined' && typeof config[cfgKey] !== 'undefined') {
      botConfig[cfgKey] = config[cfgKey]
    }
  }
  return botConfig
}

export function getBotConfigValue(adapter, selfId, key) {
  const botConfig = ensureBotConfig(adapter, selfId)
  return typeof botConfig[key] === 'undefined' ? config[key] : botConfig[key]
}

export function setBotConfigValue(adapter, selfId, key, value) {
  const botConfig = ensureBotConfig(adapter, selfId)
  botConfig[key] = value
}

export function getQRCodeRegExp(adapter, selfId = '') {
  const toQRCode = getBotConfigValue(adapter, selfId, 'toQRCode')
  if (toQRCode === false) return false
  if (toQRCode === 'url') return false
  if (typeof toQRCode === 'string') return new RegExp(toQRCode, 'g')
  return /(?<!\[(.*?)\]\()https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?/g
}

export function installConfigHelpers(adapter) {
  adapter.ensureBotConfig = (...args) => ensureBotConfig(adapter, ...args)
  adapter.getBotConfigValue = (...args) => getBotConfigValue(adapter, ...args)
  adapter.setBotConfigValue = (...args) => setBotConfigValue(adapter, ...args)
  adapter.getQRCodeRegExp = (...args) => getQRCodeRegExp(adapter, ...args)
}
