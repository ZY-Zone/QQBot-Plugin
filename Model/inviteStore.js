import fs from 'node:fs'
import { join } from 'node:path'
import { pluginPath } from './common.js'

const JSON_DATA_DIR = join(process.cwd(), 'data', 'QQBotInvite')
const LEVEL_DATA_DIR = join(pluginPath, 'db', 'invite')

class InviteStore {
  constructor () {
    this.type = 'json'
    this._data = {}
    this._c2c = {}
    this._db = null
    this._saveTimer = null
    this._c2cSaveTimer = null
    this._writeQueue = Promise.resolve()
    this._c2cWriteQueue = Promise.resolve()
    this._writeSeq = 0
    this._ready = false
  }

  _dataJsonPath () { return join(JSON_DATA_DIR, 'invite.json') }
  _c2cJsonPath () { return join(JSON_DATA_DIR, 'c2c_openids.json') }

  async init (type = 'json') {
    if (this._ready && this.type === type) return
    if (this._ready) await this.close()

    this.type = type
    this._data = {}
    this._c2c = {}

    if (type === 'level') {
      try {
        const { default: Level } = await import('./level.js')
        fs.mkdirSync(LEVEL_DATA_DIR, { recursive: true })
        this._db = new Level(LEVEL_DATA_DIR)
        await this._db.open()
        for await (const [key, value] of this._db.db.iterator()) {
          if (String(key).startsWith('__c2c__')) {
            const selfId = String(key).replace('__c2c__', '')
            this._c2c[selfId] = value
          } else {
            this._data[key] = value
          }
        }
      } catch (err) {
        logger.error('[QQBot-Plugin] inviteStore LevelDB init failed, fallback to json:', err.message)
        this.type = 'json'
        if (this._db) { try { this._db.close() } catch {} this._db = null }
      }
    }

    if (this.type === 'json') {
      fs.mkdirSync(JSON_DATA_DIR, { recursive: true })
      this._loadJson(this._dataJsonPath(), '_data')
      this._loadJson(this._c2cJsonPath(), '_c2c')
    }

    this._ready = true
  }

  _loadJson (file, field) {
    try {
      const raw = fs.readFileSync(file, 'utf-8')
      this[field] = JSON.parse(raw) || {}
    } catch {
      this[field] = {}
    }
  }

  _scheduleDataSave () {
    if (this.type === 'level' && this._db) return
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      this._writeJsonAtomic(this._dataJsonPath(), this._data, '_writeQueue')
      this._saveTimer = null
    }, 1000)
  }

  _scheduleC2cSave () {
    if (this.type === 'level' && this._db) return
    if (this._c2cSaveTimer) clearTimeout(this._c2cSaveTimer)
    this._c2cSaveTimer = setTimeout(() => {
      this._writeJsonAtomic(this._c2cJsonPath(), this._c2c, '_c2cWriteQueue')
      this._c2cSaveTimer = null
    }, 1000)
  }

  _writeJsonAtomic (file, data, queueKey) {
    this[queueKey] = this[queueKey]
      .catch(() => {})
      .then(async () => {
        const tmp = `${file}.${process.pid}.${Date.now()}.${++this._writeSeq}.tmp`
        try {
          await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
          await fs.promises.rename(tmp, file)
        } catch (err) {
          try { await fs.promises.unlink(tmp) } catch {}
          logger.error('[QQBot-Plugin] inviteStore JSON save error:', err)
        }
      })
  }

  async _saveInviteData (key) {
    if (this.type === 'level' && this._db) {
      await this._db.set(key, this._data[key], 0)
    } else {
      this._scheduleDataSave()
    }
  }

  async _saveC2cData (selfId) {
    if (this.type === 'level' && this._db) {
      await this._db.set(`__c2c__${selfId}`, this._c2c[selfId] || {}, 0)
    } else {
      this._scheduleC2cSave()
    }
  }

  // ========== invite data ==========
  _ensureInvite (selfId, userOpenid) {
    const key = `${selfId}:${userOpenid}`
    if (!this._data[key]) {
      this._data[key] = { number: 0, kick: 0, time: '', kicktime: '' }
    }
    return this._data[key]
  }

  recordGroupAdd (selfId, userOpenid, groupOpenid, timestamp = '') {
    const key = `${selfId}:${userOpenid}`
    const inv = this._ensureInvite(selfId, userOpenid)
    inv.number = (inv.number || 0) + 1
    inv.time = this._resolveTime(timestamp)
    this._saveInviteData(key)
    return inv
  }

  recordGroupDel (selfId, userOpenid, groupOpenid, timestamp = '') {
    const key = `${selfId}:${userOpenid}`
    const inv = this._ensureInvite(selfId, userOpenid)
    inv.kick = (inv.kick || 0) + 1
    inv.kicktime = this._resolveTime(timestamp)
    this._saveInviteData(key)
    return inv
  }

  getInvite (selfId, userOpenid) {
    const key = `${selfId}:${userOpenid}`
    return this._data[key] || { number: 0, kick: 0, time: '', kicktime: '' }
  }

  // ========== C2C openid records (for recall) ==========
  recordC2cUser (selfId, userOpenid, eventId = '', timestamp = '') {
    if (!this._c2c[selfId]) this._c2c[selfId] = {}
    const existing = this._c2c[selfId][userOpenid]
    const now = this._resolveTime(timestamp)
    if (!existing) {
      this._c2c[selfId][userOpenid] = { firstTime: now, lastActive: now, eventId }
    } else {
      existing.lastActive = now
      if (eventId) existing.eventId = eventId
    }
    this._saveC2cData(selfId)
  }

  _resolveTime (timestamp) {
    if (!timestamp) return new Date().toISOString()
    if (typeof timestamp === 'number' || /^\d+$/.test(String(timestamp))) {
      const num = Number(timestamp)
      if (Number.isFinite(num)) return new Date(num < 10000000000 ? num * 1000 : num).toISOString()
    }
    const d = new Date(timestamp)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
    return new Date().toISOString()
  }

  getC2cUsers (selfId) {
    return this._c2c[selfId] || {}
  }

  getC2cUserCount (selfId) {
    return Object.keys(this._c2c[selfId] || {}).length
  }

  getC2cUser (selfId, userOpenid) {
    return this._c2c[selfId]?.[userOpenid] || null
  }

  getRecallableList (selfId) {
    const users = this._c2c[selfId] || {}
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const canRecall = []
    const cannotRecall = []
    for (const [openid, info] of Object.entries(users)) {
      const lastActive = new Date(info.lastActive).getTime()
      if (now - lastActive > thirtyDays) {
        cannotRecall.push({ openid, ...info, reason: '超过30天' })
        continue
      }
      const period = this._calcPeriod(lastActive, now)
      if (period === null) {
        cannotRecall.push({ openid, ...info, reason: '超过30天' })
        continue
      }
      const blocked = this._getPeriodBlockedReason(info, period)
      if (blocked) {
        cannotRecall.push({ openid, ...info, reason: blocked, period })
      } else {
        canRecall.push({ openid, ...info, period })
      }
    }
    canRecall.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
    cannotRecall.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
    return { canRecall, cannotRecall }
  }

  _calcPeriod (lastActiveMs, nowMs) {
    const diffDays = this._naturalDayDiff(lastActiveMs, nowMs)
    if (diffDays === 0) return '0'
    if (diffDays >= 1 && diffDays <= 3) return '1'
    if (diffDays >= 4 && diffDays <= 7) return '2'
    if (diffDays >= 8 && diffDays <= 30) return '3'
    return null
  }

  _naturalDayDiff (fromMs, toMs) {
    const tzOffset = 8 * 60 * 60 * 1000
    const from = new Date(fromMs + tzOffset).toISOString().slice(0, 10)
    const to = new Date(toMs + tzOffset).toISOString().slice(0, 10)
    const fromDay = Date.parse(`${from}T00:00:00.000Z`)
    const toDay = Date.parse(`${to}T00:00:00.000Z`)
    return Math.floor((toDay - fromDay) / (24 * 60 * 60 * 1000))
  }

  _isPeriodAlreadySent (info, period) {
    const sentTime = info.wakeupSent?.[period]
    if (!sentTime) return false
    if (period === '0') {
      const sentMs = new Date(sentTime).getTime()
      const lastActiveMs = new Date(info.lastActive).getTime()
      if (Number.isFinite(sentMs) && Number.isFinite(lastActiveMs) && lastActiveMs > sentMs) return false
    }
    return true
  }

  _getPeriodBlockedReason (info, period) {
    if (this._getWakeupAttemptCount(info, period) >= 2) return `周期${period}本地当天已尝试2次`
    if (this._isPeriodAlreadySent(info, period)) return `周期${period}已发送`
    const failed = info.wakeupFailed?.[period]
    if (!failed) return ''
    if (period === '0') {
      const failMs = new Date(failed.time).getTime()
      const lastActiveMs = new Date(info.lastActive).getTime()
      if (Number.isFinite(failMs) && Number.isFinite(lastActiveMs) && lastActiveMs > failMs) return ''
    }
    return failed.msg ? `周期${period}失败: ${failed.msg}` : `周期${period}失败`
  }

  _getWakeupAttemptCount (info, period) {
    const attempts = info.wakeupAttempts?.[period]
    if (!Array.isArray(attempts)) return 0
    const now = Date.now()
    return attempts.filter(item => {
      const time = new Date(item?.time || item).getTime()
      if (!Number.isFinite(time)) return false
      if (period === '0') return this._naturalDayDiff(time, now) === 0
      return true
    }).length
  }

  markWakeupAttempt (selfId, userOpenid, period = '') {
    if (!this._c2c[selfId]?.[userOpenid] || period === null || typeof period === 'undefined') return
    const user = this._c2c[selfId][userOpenid]
    if (!user.wakeupAttempts) user.wakeupAttempts = {}
    if (!Array.isArray(user.wakeupAttempts[period])) user.wakeupAttempts[period] = []
    user.wakeupAttempts[period].push({ time: new Date().toISOString() })
    if (user.wakeupAttempts[period].length > 20) user.wakeupAttempts[period] = user.wakeupAttempts[period].slice(-20)
    this._saveC2cData(selfId)
  }

  markWakeupSent (selfId, userOpenid, period = '', timestamp = '') {
    if (!this._c2c[selfId]?.[userOpenid]) return
    const user = this._c2c[selfId][userOpenid]
    if (!user.wakeupSent) user.wakeupSent = {}
    user.wakeupSent[period] = this._resolveTime(timestamp)
    this._saveC2cData(selfId)
  }

  markWakeupError (selfId, userOpenid, errorCode, errorMsg = '') {
    if (!this._c2c[selfId]?.[userOpenid]) return
    const user = this._c2c[selfId][userOpenid]
    if (!user.wakeupErrors) user.wakeupErrors = []
    user.wakeupErrors.push({ code: errorCode, msg: errorMsg, time: new Date().toISOString() })
    if (user.wakeupErrors.length > 10) user.wakeupErrors = user.wakeupErrors.slice(-10)
    this._saveC2cData(selfId)
  }

  markWakeupFailed (selfId, userOpenid, period = '', errorCode = 0, errorMsg = '') {
    if (!this._c2c[selfId]?.[userOpenid] || period === null || typeof period === 'undefined') return
    const user = this._c2c[selfId][userOpenid]
    if (!user.wakeupFailed) user.wakeupFailed = {}
    user.wakeupFailed[period] = { code: errorCode || 0, msg: errorMsg || '', time: new Date().toISOString() }
    this._saveC2cData(selfId)
  }

  getUserWakeupPeriod (selfId, userOpenid) {
    const user = this._c2c[selfId]?.[userOpenid]
    if (!user) return null
    return this._calcPeriod(new Date(user.lastActive).getTime(), Date.now())
  }

  isWakeupSentInPeriod (selfId, userOpenid) {
    const period = this.getUserWakeupPeriod(selfId, userOpenid)
    if (period === null) return { sent: false, period: null, expired: true }
    const user = this._c2c[selfId]?.[userOpenid]
    const reason = this._getPeriodBlockedReason(user, period)
    if (!reason) return { sent: false, period, expired: false }
    return { sent: true, period, expired: false, sentTime: user.wakeupSent?.[period], reason }
  }

  // ========== Storage switch/migration ==========
  getAllData () {
    return { data: { ...this._data }, c2c: JSON.parse(JSON.stringify(this._c2c)) }
  }

  async migrateFrom (oldData) {
    if (oldData.data && typeof oldData.data === 'object') {
      for (const [key, value] of Object.entries(oldData.data)) {
        this._data[key] = value
        if (this.type === 'level' && this._db) await this._db.set(key, value, 0)
      }
    }
    if (oldData.c2c && typeof oldData.c2c === 'object') {
      for (const [selfId, users] of Object.entries(oldData.c2c)) {
        this._c2c[selfId] = users
        if (this.type === 'level' && this._db) await this._db.set(`__c2c__${selfId}`, users, 0)
      }
    }
    if (this.type === 'json') {
      this._scheduleDataSave()
      this._scheduleC2cSave()
    }
    return {
      inviteCount: Object.keys(oldData.data || {}).length,
      c2cCount: Object.values(oldData.c2c || {}).reduce((sum, users) => sum + Object.keys(users).length, 0)
    }
  }

  async close () {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null }
    if (this._c2cSaveTimer) { clearTimeout(this._c2cSaveTimer); this._c2cSaveTimer = null }
    if (this.type === 'json' && this._ready) {
      this._writeJsonAtomic(this._dataJsonPath(), this._data, '_writeQueue')
      this._writeJsonAtomic(this._c2cJsonPath(), this._c2c, '_c2cWriteQueue')
      await Promise.allSettled([this._writeQueue, this._c2cWriteQueue])
    }
    if (this._db) {
      try { this._db.close() } catch {}
      this._db = null
    }
    this._ready = false
  }
}

const store = new InviteStore()
export default store
