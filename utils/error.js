import fetch from 'node-fetch'

export function getQQBotAuthError(data) {
  const code = Number(data?.code || data?.err_code)
  const message = String(data?.message || data?.msg || data || '')
  if (code === 100016) return 'secret输入错误'
  if (code === 10004) return 'appid输入错误'
  if (code === 100007) return '机器人被封禁/不存在'
  if (message.includes('code(100016)')) return 'secret输入错误'
  if (message.includes('code(10004)')) return 'appid输入错误'
  if (message.includes('code(100007)')) return '机器人被封禁/不存在'
  return ''
}

export function isQQBotReadOnlyError(data) {
  const message = String(data?.message || data?.msg || data || '')
  return Number(data?.code || data?.err_code) === 11300 || message.includes('code(11300)') || message.includes('link type check failed')
}

export function isQQBotCanceledError(data) {
  const message = String(data?.message || data?.msg || data || '')
  return Number(data?.code || data?.err_code) === 11700 || message.includes('code(11700)') || message.includes('robot has canceled')
}

export function isQQBotRateLimitError(data) {
  const message = String(data?.message || data?.msg || data || '')
  return Number(data?.code || data?.err_code) === 100017 || message.includes('code(100017)') || message.includes('接口调用超过频率限制')
}

export function isQQBotSdkError(data) {
  const message = String(data?.message || data?.msg || data?.stack || data || '')
  return message.includes('request "') || message.includes('qq-official-bot') || message.includes('/gateway/bot')
}

export async function validateQQBotToken(tokenText) {
  const parts = String(tokenText || '').split(':')
  const [selfId, appid, token, secret, sandboxRaw, intentRaw] = parts
  if (!selfId || !appid || !secret || parts.length < 6) return { ok: false, error: '配置格式错误' }
  const sandbox = sandboxRaw === '1'
  try {
    const tokenRes = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: appid, clientSecret: secret })
    })
    const tokenData = await tokenRes.json()
    const accessToken = tokenData?.access_token
    if (!accessToken) return { ok: false, error: getQQBotAuthError(tokenData) || 'secret验证失败' }
    const apiBase = sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'
    const meRes = await fetch(`${apiBase}/users/@me`, {
      headers: { Authorization: `QQBot ${accessToken}`, 'X-Union-Appid': appid }
    })
    const me = await meRes.json()
    return { ok: true, selfId, appid, token, secret, sandbox, intentRaw, me }
  } catch (err) {
    return { ok: false, error: getQQBotAuthError(err) || err.message || 'secret验证失败' }
  }
}
