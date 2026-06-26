import { importJS } from './Model/index.js'
import { initSharp, initMarkdownTemplate, initTmplPkg } from './utils/constants.js'
import { patchSegmentImageSizeOptions, patchSegmentFile } from './utils/helpers.js'

const startTime = new Date()
const startLog = () => logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

// 异步初始化全局变量
try {
  const mdTemplate = await importJS('Model/template/markdownTemplate.js', 'default')
  if (mdTemplate) initMarkdownTemplate(mdTemplate)
} catch {}
try {
  const tmpl = await importJS('templates/index.js')
  if (tmpl) initTmplPkg(tmpl)
} catch {}
if (true) {
  const { config } = await import('./Model/index.js')
  if (config.imageLength) try {
    const s = (await import("sharp")).default
    initSharp(s)
  } catch (err) {
    Bot.makeLog("error", ["sharp 导入错误，图片压缩关闭", err], "QQBot-Plugin")
  }
}

patchSegmentImageSizeOptions()
patchSegmentFile()

startLog()

import { adapter } from './components/adapter.js'
Bot.adapter.push(adapter)

export { QQBotAdapter } from './apps/index.js'

const endTime = new Date()
logger.info(logger.green(`- QQBot 适配器插件 加载完成! 耗时：${endTime - startTime}ms`))
