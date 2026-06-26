import { config, configSave } from '../model/index.js'

export async function Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/i, '').trim().split(':')
    const bot_id = token.shift()
    token = token.join(':')
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    return configSave()
}
