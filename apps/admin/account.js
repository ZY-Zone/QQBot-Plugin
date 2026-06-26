import fs from 'node:fs'
import { join } from 'node:path'
import { adapter } from '../../components/adapter.js'
import { config, configSave } from '../../model/index.js'
import { qrRegister, BindStatus } from '../../model/qr-auth.js'

export async function List() {
  this.reply(`共${config.token.length}个账号：\n${config.token.join('\n')}`, true)
}

export async function Token() {
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

export async function QRLogin() {
  const match = /^#[Qq]+[Bb]ot登录([0-9]+):([01]):([01])$/i.exec(this.e.msg)
  const matchWebhook = /^#[Qq]+[Bb]ot登录([0-9]+):2$/i.exec(this.e.msg)

  let qqId, param1, param2, isWebhook = false

  if (match) {
    qqId = match[1]
    param1 = match[2]
    param2 = match[3]
  } else if (matchWebhook) {
    qqId = matchWebhook[1]
    param1 = '2'
    param2 = '0'
    isWebhook = true
  } else {
    return this.reply('指令格式错误\n普通模式: #QQBot登录QQ号:参数1:参数2\nWebhook模式: #QQBot登录QQ号:2', true)
  }

  await this.reply(`正在为 QQ ${qqId} 生成扫码登录二维码 (${isWebhook ? 'Webhook模式' : '普通模式'})，请稍候...`, true)

  const tempDir = join(process.cwd(), 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    const result = await qrRegister({
      timeoutSeconds: 300,
      onQRCode: async (imageBuffer, url) => {
        const qrFile = join(tempDir, `qqbot_qr_${Date.now()}.gif`)
        fs.writeFileSync(qrFile, imageBuffer)

        logger.info(`[QQBot] 二维码已保存到: ${qrFile}`)
        logger.info(`[QQBot] 二维码链接: ${url}`)

        await this.reply([
          segment.image(imageBuffer),
          `\n请使用手机 QQ 扫描二维码登录\n或打开链接: ${url}\n\n二维码图片已保存到: ${qrFile}`
        ])
      },
      onStatusChange: async (status, message) => {
        if (status === BindStatus.COMPLETED) {
          logger.info(`[QQBot] 扫码成功: ${message}`)
        } else if (status === BindStatus.EXPIRED) {
          logger.info(`[QQBot] 二维码过期: ${message}`)
          await this.reply(`二维码状态: ${message}`)
        } else if (status === BindStatus.PENDING) {
          logger.info(`[QQBot] 等待扫码: ${message}`)
        } else {
          logger.info(`[QQBot] 状态: ${message}`)
        }
      }
    })

    if (!result) {
      return await this.reply('扫码登录失败或超时', true)
    }

    const { appId, clientSecret, userOpenid } = result

    logger.info(`[QQBot] 扫码成功!`)
    logger.info(`[QQBot] AppID: ${appId}`)
    logger.info(`[QQBot] UserOpenID: ${userOpenid}`)

    const token = `${qqId}:${appId}:QQBot:${clientSecret}:${param1}:${param2}`

    const existingIndex = config.token.findIndex(t => t.startsWith(`${qqId}:`))

    if (await adapter.connect(token)) {
      if (existingIndex >= 0) {
        config.token[existingIndex] = token
      } else {
        config.token.push(token)
      }
      await configSave()
      await this.reply(`扫码登录成功！\nQQ号: ${qqId}\nAppID: ${appId}\n账号已保存并连接`, true)
    } else {
      await this.reply(`扫码登录成功，但连接失败\nQQ号: ${qqId}\nAppID: ${appId}\n请检查机器人配置`, true)
    }
  } catch (err) {
    console.error('[QQBot] 扫码登录错误:', err)
    await this.reply(`扫码登录出错: ${err.message}`, true)
  }
}
