import { config } from '../../model/index.js'

export async function DAUStat() {
  const pro = this.e.msg.includes('pro')
  const uin = this.e.msg.replace(/^#[Qq]+[Bb]ot[Dd][Aa][Uu]([Pp]ro)?/i, '') || this.e.self_id
  const dau = Bot[uin]?.dau
  if (!dau || !dau.dauDB) return false
  const msg = await dau.getDauStatsMsg(this.e, pro)
  if (msg.length) this.reply(msg, true)
}

export async function callStat() {
  if (!config.callStats) return false
  const dau = this.e.bot.dau
  if (!dau || !dau.dauDB) return false
  const msg = dau.getCallStatsMsg(this.e)
  if (msg.length) this.reply(msg, true)
}

export async function userStat() {
  if (!config.userStats) return false
  const dau = this.e.bot.dau
  if (!dau || !dau.dauDB) return false
  if (dau.dauDB === 'redis') {
    return this.reply('用户统计只适配了level,,,', true)
  }
  const msg = await dau.getUserStatsMsg(this.e)
  if (msg.length) this.reply(msg, true)
}
