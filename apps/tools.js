import _ from 'lodash'
import { config, configSave, importJS } from '../Model/index.js'

export async function refConfig() {
    return configSave().then(() => this.reply('配置已刷新', true))
}

export async function oneKeySendGroupMsg() {
    if (this.e.adapter_name !== 'QQBot') return false
    const msg = await importJS('Model/template/oneKeySendGroupMsg.js', 'default')
    if (msg === false) {
        this.reply('请先设置模版哦', true)
    } else {
        const groupList = this.e.bot.dau.dauDB === 'level' ? Object.keys(this.e.bot.dau.all_group) : [...this.e.bot.gl.keys()]
        const getMsg = typeof msg === 'function' ? msg : () => msg
        const errGroupList = []
        for (const key of groupList) {
            if (key === 'total') continue
            const id = this.e.bot.dau.dauDB === 'level' ? `${this.e.self_id}${this.e.bot.adapter.sep}${key}` : key
            const sendMsg = await getMsg(id)
            if (!sendMsg?.length) continue
            const sendRet = await this.e.bot.pickGroup(id).sendMsg(sendMsg)
            if (sendRet.error.length) {
                for (const i of sendRet.error) {
                    if (i.message.includes('机器人非群成员')) {
                        errGroupList.push(key)
                        break
                    }
                }
            }
        }
        if (errGroupList.length) await this.e.bot.dau.deleteNotExistGroup(errGroupList)
        logger.info(logger.green(`QQBot ${this.e.self_id} 群消息一键发送完成，共${groupList.length - 1}个群，失败${errGroupList.length}个`))
    }
}
