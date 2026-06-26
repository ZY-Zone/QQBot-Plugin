import { config } from '../model/index.js'
import { URL_REGEXP, URL_REGEXP_FULL } from '../utils/constants.js'
import { isSdk12, getSDKVersion } from '../model/sdkEnhancer.js'
import { installConnection } from './connection.js'
import { installMessageEvent } from './message-event.js'
import { installMessageBuilder } from './message-builder.js'
import { installMessageSender } from './message-sender.js'
import { installImage } from './image.js'
import { installButton } from './button.js'
import { installFile } from './file.js'
import { installPicker } from './picker.js'
import { installRecall } from './recall.js'
import { installClaw } from './claw.js'
import { installConfigHelpers } from './config.js'

export class QQBotAdapterEngine {
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

    installConnection(this)
    installMessageEvent(this)
    installMessageBuilder(this)
    installMessageSender(this)
    installImage(this)
    installButton(this)
    installFile(this)
    installPicker(this)
    installRecall(this)
    installClaw(this)
    installConfigHelpers(this)
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
}

export const adapter = new QQBotAdapterEngine()
