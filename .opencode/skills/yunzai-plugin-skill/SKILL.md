# Yunzai 插件开发完整技能指南

## 目录

1. [OneBot11 协议接入详解](#onebot11-协议接入详解)
2. [图片渲染系统](#图片渲染系统)
3. [标准渲染模板](#标准渲染模板)
4. [Guoba 配置界面](#guoba-配置界面)
5. [插件开发最佳实践](#插件开发最佳实践)

---

## OneBot11 协议接入详解

### 1.1 协议适配器架构

Yunzai 采用适配器模式支持多协议接入，OneBotv11 适配器位于 `plugins/adapter/OneBotv11.js`。

#### 核心类结构

```javascript
class OneBotv11Adapter {
  id = "QQ"           // 适配器标识
  name = "OneBotv11"  // 适配器名称
  path = this.name    // WebSocket 路径
  echo = new Map()    // 请求响应映射
  timeout = 60000     // API 超时时间
}
```

### 1.2 WebSocket 连接流程

```
协议端 (go-cqhttp/LLOneBot/Lagrange)
    ↓ 反向 WebSocket 连接
Yunzai Server (ws://localhost:2536/OneBotv11)
    ↓ 触发 message 事件
OneBotv11Adapter.message()
    ↓ 分发到对应处理器
connect / message / notice / request
```

### 1.3 配置协议端

略

### 1.4 核心 API 调用

#### 发送 API 请求

```javascript
// 适配器内部封装
sendApi(data, ws, action, params = {}) {
  const echo = ulid()  // 生成唯一标识
  const request = { action, params, echo }
  ws.sendMsg(request)
  
  // 使用 Promise.withResolvers 等待响应
  const cache = Promise.withResolvers()
  this.echo.set(echo, cache)
  
  // 设置超时
  setTimeout(() => {
    cache.reject(Bot.makeError("请求超时", request))
  }, this.timeout)
  
  return cache.promise
}
```

#### 常用 API 列表

| API | 功能 | 参数 |
|-----|------|------|
| `send_msg` | 发送消息 | `user_id`/`group_id`, `message` |
| `delete_msg` | 撤回消息 | `message_id` |
| `get_msg` | 获取消息 | `message_id` |
| `get_friend_list` | 获取好友列表 | - |
| `get_group_list` | 获取群列表 | - |
| `get_group_member_list` | 获取群成员 | `group_id` |
| `set_group_ban` | 禁言成员 | `group_id`, `user_id`, `duration` |
| `set_group_kick` | 踢出成员 | `group_id`, `user_id` |
| `upload_group_file` | 上传群文件 | `group_id`, `file`, `name` |
| `get_forward_msg` | 获取转发消息 | `message_id` |

### 1.5 消息格式转换

#### Yunzai 消息段 → OneBot 消息段

```javascript
// 文本
{ type: "text", data: { text: "消息内容" } }

// @某人
{ type: "at", data: { qq: "123456" } }

// 图片
{ type: "image", data: { file: "base64://..." } }

// 回复
{ type: "reply", data: { id: "12345" } }

// 转发消息节点
{ type: "node", data: { name: "昵称", uin: "123", content: [...] } }
```

#### 发送消息示例

```javascript
// 发送文本
await e.reply("Hello World")

// 发送图片
await e.reply(segment.image("http://example.com/img.jpg"))

// 发送混合消息
await e.reply([
  segment.at(user_id),
  "\n",
  segment.image("base64://..."),
  "\n文本内容"
])

// 发送转发消息（合并转发）
const forwardMsg = Bot.makeForwardMsg([
  { user_id: 123, nickname: "用户1", message: "消息1" },
  { user_id: 456, nickname: "用户2", message: "消息2" }
])
await e.reply(forwardMsg)
```

### 1.6 事件处理

#### 消息事件

```javascript
// 私聊消息
Bot.on("message.private", (e) => {
  console.log(e.user_id, e.message)
})

// 群消息
Bot.on("message.group", (e) => {
  console.log(e.group_id, e.user_id, e.message)
})
```

#### 通知事件

```javascript
// 群成员增加
Bot.on("notice.group.increase", (e) => {
  console.log(`新成员：${e.user_id}`)
})

// 群成员减少
Bot.on("notice.group.decrease", (e) => {
  console.log(`成员离开：${e.user_id}`)
})

// 群禁言
Bot.on("notice.group.ban", (e) => {
  console.log(`禁言：${e.user_id} ${e.duration}秒`)
})
```

#### 请求事件

```javascript
// 好友申请
Bot.on("request.friend.add", (e) => {
  // 同意申请
  e.approve(true)
  // 拒绝申请
  e.approve(false, "拒绝理由")
})

// 群申请
Bot.on("request.group.add", (e) => {
  e.approve(true)
})
```

---

## 图片渲染系统

### 2.1 渲染器架构

Yunzai 使用 Puppeteer + art-template 实现图片渲染。

```
插件调用 puppeteer.render()
    ↓
Renderer.dealTpl() 处理模板
    ↓
art-template 渲染 HTML
    ↓
Puppeteer.screenshot() 截图
    ↓
返回图片 Buffer
```

### 2.2 渲染器配置

#### config/default_config/renderer.yaml

```yaml
# 渲染器名称
name: puppeteer

# Puppeteer 配置
chromiumPath: ''        # Chromium 路径（可选）
puppeteerWS: ''         # Puppeteer WebSocket 地址（可选）
puppeteerTimeout: 0     # 截图超时时间（毫秒）

# 截图参数
pageGotoParams:
  timeout: 120000
  waitUntil: "networkidle2"
```

### 2.3 渲染方法详解

#### 基础渲染

```javascript
import { puppeteer } from "../model/index.js"

// 方式1：使用插件内 puppeteer 实例
await puppeteer.render("template/name", {
  // 模板数据
  title: "标题",
  content: "内容"
}, {
  e,           // 事件对象（必需）
  scale: 1.2  // 缩放比例
})

// 方式2：使用全局 Renderer
const renderer = Renderer.getRenderer()
const img = await renderer.render("template/name", data)
```

#### 完整渲染参数

```javascript
await puppeteer.render(name, data, options)

// name: 模板路径（相对于 resources 目录）
// data: 模板数据对象
// options: {
//   e: 事件对象（必需）
//   scale: 缩放比例（默认 1.0）
//   saveId: 保存ID（默认使用 name）
// }
```

#### data 数据对象详解

```javascript
{
  // 模板文件路径（必需）
  tplFile: "./plugins/your-plugin/resources/template/index.html",
  
  // 其他自定义数据
  title: "页面标题",
  list: [/* 数据列表 */],
  
  // 系统注入数据
  _res_path: "./resources/",  // 资源路径
  sys: {
    scale: "data-scale=1.2",
    copyright: "Yunzai-Bot"
  }
}
```

### 2.4 高级截图功能

#### 分页截图

```javascript
await puppeteer.render("template/name", {
  tplFile: "...",
  multiPage: true,           // 启用分页
  multiPageHeight: 4000,     // 每页高度（默认 4000px）
  // ... 其他数据
})
```

#### 截图参数

```javascript
{
  imgType: "jpeg",           // 图片格式：jpeg/png
  quality: 90,               // 图片质量（jpeg 有效）
  omitBackground: false,     // 是否透明背景
  path: "/path/to/save.jpg"  // 保存路径（可选）
}
```

### 2.5 yenai-plugin 渲染封装

#### 封装示例

```javascript
// model/index.js
export { default as puppeteer } from "#yenai.puppeteer"

// components/index.js 中定义别名
"#yenai.puppeteer": "./plugins/yenai-plugin/components/puppeteer.js"
```

#### 使用示例

```javascript
import { puppeteer } from "../model/index.js"

// 渲染帮助界面
await puppeteer.render("help/index", {
  helpCfg: config,
  helpGroup: groups,
  bg: "background.jpg",
  colCount: 3
}, {
  e,
  scale: 1.2
})
```

---

## 标准渲染模板

### 3.1 模板目录结构

```
resources/
├── common/
│   ├── layout/
│   │   └── default.html      # 默认布局模板
│   ├── common.css            # 公共样式
│   └── font/                 # 字体文件
├── help/
│   ├── index.html            # 帮助模板
│   ├── index.css             # 帮助样式
│   └── imgs/                 # 背景图片
└── admin/
    ├── index.html            # 配置界面模板
    └── index.css
```

### 3.2 布局模板详解

#### default.html（标准布局）

```html
<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <link rel="preload" href="{{_res_path}}common/font/FZB.woff" as="font">
  <link rel="stylesheet" type="text/css" href="{{_res_path}}common/common.css" />
  <title>{{title}}</title>
  {{block 'css'}}{{/block}}
</head>
<body class="elem-{{element||'hydro'}} {{displayMode||'default'}}-mode" {{@sys.scale}}>
  <div class="container" id="container">
    {{block 'main'}}{{/block}}
    <div class="copyright">{{@sys.copyright}}</div>
  </div>
</body>
</html>
```

#### 继承布局模板

```html
{{extend defaultLayout}}

{{block 'css'}}
<link rel="stylesheet" href="{{_res_path}}/help/index.css" />
<style>
  .container {
    background: url("{{_res_path}}/help/imgs/{{bg}}") center;
  }
</style>
{{/block}}

{{block 'main'}}
<!-- 主内容区域 -->
<div class="content">
  {{each list item}}
  <div class="item">{{item.name}}</div>
  {{/each}}
</div>
{{/block}}
```

### 3.3 帮助界面模板

#### help/index.html

```html
{{extend defaultLayout}}

{{block 'css'}}
<link rel="stylesheet" type="text/css" href="{{_res_path}}/help/index.css" />
<style>
  .container {
    background: url("{{_res_path}}/help/imgs/{{bg}}") center !important;
    background-size: cover !important;
  }
</style>
{{/block}}

{{block 'main'}}
<div class="info-box">
  <div class="head-box type{{bgType}}">
    <div class="title">{{helpCfg.title||"使用帮助"}}</div>
    <div class="label">{{helpCfg.subTitle || "Yunzai-Bot"}}</div>
  </div>
</div>

{{each helpGroup group}}
{{set len = group?.list?.length || 0 }}
<div class="cont-box">
  <div class="help-group">{{group.group}}</div>
  {{if len > 0}}
  <div class="help-table">
    <div class="tr">
      {{each group.list help idx}}
      <div class="td">
        <span class="help-icon" style="{{help.css}}"></span>
        <strong class="help-title">{{help.title}}</strong>
        <span class="help-desc">{{help.desc}}</span>
      </div>
      {{if idx%colCount === colCount-1 && idx>0 && idx< len-1}}
    </div>
    <div class="tr">
      {{/if}}
      {{/each}}
    </div>
  </div>
  {{/if}}
</div>
{{/each}}
{{/block}}
```

#### 帮助配置数据结构

```javascript
// config/system/help_system.js
export const helpCfg = {
  title: "xx帮助",
  subTitle: "Yunzai-Bot & xx-Plugin",
  columnCount: 3,           // 列数
  colWidth: 265,            // 列宽
  theme: "all",
  themeExclude: ["default"],
  style: {
    fontColor: "#ceb78b",
    descColor: "#eee",
    contBgColor: "rgba(6, 21, 31, .5)",
    contBgBlur: 3,
    headerBgColor: "rgba(6, 21, 31, .4)",
    rowBgColor1: "rgba(6, 21, 31, .2)",
    rowBgColor2: "rgba(6, 21, 31, .35)"
  }
}

export const helpList = [
  {
    group: "功能分组名称",
    auth: "master",  // 权限：master/owner/admin（可选）
    list: [
      {
        icon: 1,                    // 图标编号
        title: "#命令",             // 命令
        desc: "功能描述"            // 描述
      }
    ]
  }
]
```

### 3.4 配置界面模板

#### admin/index.html

```html
{{extend defaultLayout}}

{{block 'css'}}
<link rel="stylesheet" href="{{_res_path}}/admin/index.css" />
{{/block}}

{{block 'main'}}
<div class="config-box">
  <div class="config-header">
    <h2>{{title}}</h2>
  </div>
  
  {{each groups group}}
  <div class="config-group">
    <div class="group-title">{{group.name}}</div>
    
    {{each group.items item}}
    <div class="config-item">
      <div class="item-label">{{item.label}}</div>
      <div class="item-value">{{item.value}}</div>
      <div class="item-desc">{{item.desc}}</div>
    </div>
    {{/each}}
  </div>
  {{/each}}
</div>
{{/block}}
```

### 3.5 art-template 语法

#### 基础语法

```html
<!-- 变量输出 -->
{{name}}
{{user.name}}
{{user['name']}}

<!-- 不转义输出 HTML -->
{{@htmlContent}}

<!-- 条件判断 -->
{{if user}}
  <div>{{user.name}}</div>
{{else if guest}}
  <div>访客</div>
{{else}}
  <div>匿名</div>
{{/if}}

<!-- 循环 -->
{{each list item index}}
  <div>{{index}}: {{item.name}}</div>
{{/each}}

<!-- 设置变量 -->
{{set temp = value}}

<!-- 引入子模板 -->
{{include './header.html'}}
```

#### 过滤器

```html
<!-- 默认值 -->
{{name | default:'匿名'}}

<!-- 日期格式化 -->
{{time | date:'yyyy-MM-dd'}}

<!-- 截取字符串 -->
{{content | truncate:20}}
```

---

## Guoba 配置界面

### 4.1 Guoba 简介

Guoba 是 Yunzai 的图形化配置管理插件，支持通过 Web 界面管理插件配置。

### 4.2 接入 Guoba

#### 创建 guoba.support.js

```javascript
// guoba.support.js
export { supportGuoba } from "./guoba/index.js"
```

#### 创建 guoba/index.js

```javascript
import pluginInfo from "./pluginInfo.js"
import configInfo from "./configInfo.js"

export function supportGuoba() {
  return {
    pluginInfo,
    configInfo
  }
}
```

### 4.3 插件信息配置

#### guoba/pluginInfo.js

```javascript
export default {
  // 插件名称
  name: "yenai-plugin",
  // 插件标题
  title: "椰奶插件",
  // 插件描述
  description: "Yunzai 扩展插件",
  // 作者
  author: "@yenai",
  // 版本
  version: "1.0.0",
  // 仓库地址
  repo: "https://github.com/your-repo/yenai-plugin",
  // 图标
  icon: "mdi:puzzle",
  // 依赖
  depends: []
}
```

### 4.4 配置信息配置

#### guoba/configInfo.js

```javascript
import { schemas, getConfigData, setConfigData } from "./schemas/index.js"

export default {
  schemas,           // 表单 schema
  getConfigData,     // 获取配置方法
  setConfigData      // 保存配置方法
}
```

### 4.5 Schema 定义

#### guoba/schemas/index.js

```javascript
import notice from "./notice.js"
import other from "./other.js"

// 合并所有 schemas
export const schemas = [
  ...notice,
  ...other
]

// 获取配置数据
export function getConfigData() {
  return {
    notice: Config.getNotice(),
    other: Config.other
  }
}

// 保存配置数据
export function setConfigData(data, { Result }) {
  // 保存到配置文件
  Config.setNotice(data.notice)
  Config.setOther(data.other)
  
  return Result.ok({}, "保存成功")
}
```

#### Schema 字段类型

```javascript
// guoba/schemas/notice.js
export default [
  {
    field: "notice.friendRecall",
    label: "好友撤回通知",
    component: "Switch",        // 组件类型
    required: false,
    defaultValue: true
  },
  {
    field: "notice.groupRecall",
    label: "群撤回通知",
    component: "Switch"
  },
  {
    field: "notice.groupIncrease",
    label: "群成员增加通知",
    component: "Switch"
  },
  {
    field: "notice.groupDecrease",
    label: "群成员减少通知",
    component: "Switch"
  },
  // 分组
  {
    component: "Divider",
    label: "通知设置"
  },
  // 输入框
  {
    field: "notice.customMsg",
    label: "自定义消息",
    component: "Input",
    placeholder: "请输入自定义消息"
  },
  // 数字输入
  {
    field: "notice.timeout",
    label: "超时时间",
    component: "InputNumber",
    min: 0,
    max: 3600,
    defaultValue: 30
  },
  // 下拉选择
  {
    field: "notice.mode",
    label: "通知模式",
    component: "Select",
    options: [
      { label: "简洁", value: "simple" },
      { label: "详细", value: "detail" }
    ]
  },
  // 多选
  {
    field: "notice.types",
    label: "通知类型",
    component: "CheckboxGroup",
    options: [
      { label: "文本", value: "text" },
      { label: "图片", value: "image" }
    ]
  }
]
```

### 4.6 支持的组件类型

| 组件 | 用途 | 配置项 |
|------|------|--------|
| `Switch` | 开关 | `defaultValue` |
| `Input` | 文本输入 | `placeholder` |
| `InputNumber` | 数字输入 | `min`, `max`, `step` |
| `Select` | 下拉选择 | `options` |
| `RadioGroup` | 单选组 | `options` |
| `CheckboxGroup` | 多选组 | `options` |
| `Textarea` | 多行文本 | `rows` |
| `Slider` | 滑块 | `min`, `max`, `step` |
| `Divider` | 分隔线 | `label` |
| `Alert` | 提示信息 | `message`, `type` |

---

## 插件开发最佳实践

### 5.1 目录结构规范

```
your-plugin/
├── index.js                    # 入口文件
├── guoba.support.js            # Guoba 支持（可选）
├── package.json                # 依赖配置（可选）
├── apps/                       # 功能模块
│   ├── index.js                # 主插件
│   ├── admin/                  # 管理功能
│   └── events/                 # 事件监听
├── components/                 # 公共组件
│   ├── index.js                # 组件导出
│   ├── Data.js                 # 数据工具
│   └── Config.js               # 配置管理
├── config/                     # 配置文件
│   ├── default_config/         # 默认配置
│   ├── config/                 # 用户配置（运行时）
│   └── system/                 # 系统配置
├── guoba/                      # Guoba 配置
│   ├── index.js
│   ├── pluginInfo.js
│   ├── configInfo.js
│   └── schemas/
├── model/                      # 数据模型
│   ├── index.js
│   └── api/
├── resources/                  # 资源文件
│   ├── common/
│   ├── help/
│   └── admin/
└── lib/                        # 工具库
```

### 5.2 插件基类使用

```javascript
import plugin from "../../lib/plugins/plugin.js"

export class MyPlugin extends plugin {
  constructor() {
    super({
      name: "插件名称",
      dsc: "插件描述",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#测试$",
          fnc: "test",
          permission: "all"
        }
      ],
      task: [
        {
          name: "定时任务",
          cron: "0 0 * * *",
          fnc: "dailyTask"
        }
      ]
    })
  }

  async test(e) {
    await e.reply("测试成功")
    return true
  }

  async dailyTask() {
    // 定时任务逻辑
  }
}
```

### 5.3 配置管理

#### Config.js 封装

```javascript
import YAML from "yaml"
import fs from "fs"

const _path = process.cwd()
const plugin = "your-plugin"

export default class Config {
  // 获取配置
  static getConfig(name) {
    const file = `${_path}/plugins/${plugin}/config/config/${name}.yaml`
    if (!fs.existsSync(file)) {
      // 复制默认配置
      this.copyDefault(name)
    }
    return YAML.parse(fs.readFileSync(file, "utf8"))
  }
  
  // 保存配置
  static setConfig(name, data) {
    const file = `${_path}/plugins/${plugin}/config/config/${name}.yaml`
    fs.writeFileSync(file, YAML.stringify(data))
  }
  
  // 复制默认配置
  static copyDefault(name) {
    const defaultFile = `${_path}/plugins/${plugin}/config/default_config/${name}.yaml`
    const configFile = `${_path}/plugins/${plugin}/config/config/${name}.yaml`
    if (fs.existsSync(defaultFile)) {
      fs.mkdirSync(`${_path}/plugins/${plugin}/config/config`, { recursive: true })
      fs.copyFileSync(defaultFile, configFile)
    }
  }
}
```

### 5.4 图片渲染封装

```javascript
// components/puppeteer.js
import { segment } from "oicq"

export default {
  async render(template, data, options = {}) {
    const { e, scale = 1.0 } = options
    
    if (!e) {
      logger.error("[render] 缺少事件对象 e")
      return false
    }
    
    // 获取渲染器
    const renderer = Renderer.getRenderer()
    
    // 准备模板数据
    const templateData = {
      ...data,
      tplFile: `./plugins/your-plugin/resources/${template}.html`,
      _res_path: `./plugins/your-plugin/resources/`
    }
    
    // 渲染
    const img = await renderer.render(template, templateData)
    
    if (!img) {
      logger.error("[render] 图片渲染失败")
      return false
    }
    
    return segment.image(img)
  }
}
```

### 5.5 错误处理

```javascript
async myFunction(e) {
  try {
    // 业务逻辑
    const result = await api.call()
    
    if (!result) {
      await e.reply("操作失败，请稍后重试")
      return false
    }
    
    await e.reply("操作成功")
    return true
  } catch (err) {
    logger.error("[插件名] 错误:", err)
    await e.reply(`操作失败: ${err.message}`)
    return false
  }
}
```

### 5.6 日志规范

```javascript
// 不同级别的日志
logger.trace("跟踪信息")   // 最详细
logger.debug("调试信息")   // 调试
logger.info("一般信息")    // 普通
logger.mark("重要标记")    // 重要
logger.warn("警告信息")    // 警告
logger.error("错误信息")   // 错误

// 带标签的日志
logger.info(`[插件名] 消息内容`)
logger.mark(`[图片生成][模板名] 完成`)
```

### 5.7 权限检查

```javascript
// 检查主人权限
if (!e.isMaster) {
  await e.reply("暂无权限，只有主人才能操作")
  return false
}

// 检查群主权限
if (e.group && !e.member.is_owner) {
  await e.reply("暂无权限，只有群主才能操作")
  return false
}

// 检查管理员权限
if (e.group && !e.member.is_admin && !e.member.is_owner) {
  await e.reply("暂无权限，只有管理员才能操作")
  return false
}
```

### 5.8 常用工具函数

```javascript
import _ from "lodash"
import moment from "moment"

// 睡眠等待
await util.sleep(1000)  // 1秒

// 随机数
_.random(1, 100)

// 日期格式化
moment().format("YYYY-MM-DD HH:mm:ss")

// 数组分块
_.chunk(array, 10)

// 去重
_.uniq(array)

// 深拷贝
_.cloneDeep(obj)

// 获取对象值
_.get(obj, "path.to.value", defaultValue)
```

---

## 附录

### A. 完整插件示例

```javascript
// plugins/my-plugin/apps/index.js
import plugin from "../../../lib/plugins/plugin.js"
import { puppeteer } from "../model/index.js"
import Config from "../components/Config.js"

export class MyPlugin extends plugin {
  constructor() {
    super({
      name: "我的插件",
      dsc: "插件描述",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#我的帮助$",
          fnc: "help"
        },
        {
          reg: "^#我的设置$",
          fnc: "settings",
          permission: "master"
        }
      ]
    })
  }

  async help(e) {
    const helpCfg = Config.getConfig("help")
    
    const img = await puppeteer.render("help/index", {
      helpCfg,
      helpGroup: [
        {
          group: "基础功能",
          list: [
            { icon: 1, title: "#命令1", desc: "功能1" },
            { icon: 2, title: "#命令2", desc: "功能2" }
          ]
        }
      ],
      bg: "default.jpg",
      colCount: 3
    }, { e, scale: 1.2 })
    
    if (img) {
      await e.reply(img)
    }
    return true
  }

  async settings(e) {
    // 设置逻辑
    return true
  }
}
```

### B. 参考资源

- [Yunzai 开发文档](https://github.com/TimeRainStarSky/Yunzai/tree/docs)
- [OneBot v11 协议](https://github.com/botuniverse/onebot-11)
- [art-template 文档](https://aui.github.io/art-template/)
- [Puppeteer 文档](https://pptr.dev/)

---

## 6. 机器人账号操作详解

### 6.1 Bot 对象结构

```javascript
// Bot 对象结构（以 OneBotv11 为例）
Bot[uin] = {
  // 基础信息
  uin: 123456789,
  nickname: "机器人昵称",
  avatar: "https://q.qlogo.cn/g?b=qq&s=0&nk=123456789",
  
  // 适配器信息
  adapter: OneBotv11Adapter,
  ws: WebSocket,
  
  // 统计信息
  stat: {
    start_time: 1234567890,
    packet_lost: 0,
    message_received: 100,
    message_sent: 50
  },
  
  // 好友列表
  fl: Map<user_id, friend_info>,
  
  // 群组列表
  gl: Map<group_id, group_info>,
  
  // 群成员列表
  gml: Map<group_id, Map<user_id, member_info>>,
  
  // Cookie 信息
  cookies: {
    "qun.qq.com": "cookie_string",
    "qzone.qq.com": "cookie_string"
  },
  
  // CSRF Token
  bkn: 123456789
}
```

### 6.2 发送消息

#### 发送好友消息

```javascript
// 方式1：使用 pickFriend
await Bot.pickFriend(user_id).sendMsg(message)

// 方式2：通过 Bot 对象
await Bot[bot_id].pickFriend(user_id).sendMsg(message)

// 方式3：使用 Bot.sendFriendMsg
await Bot.sendFriendMsg(bot_id, user_id, message)

// 实际示例
async sendFriendMsg(e) {
  let bot = Bot[bot_id] //指定特定Bot
  let qq = 123456789
  
  // 检查是否为好友
  if (!bot.fl.get(Number(qq))) {
    return e.reply("❎ 好友列表查无此人")
  }
  
  // 发送消息
  await bot.pickFriend(qq).sendMsg(e.message)
    .then(() => e.reply(`✅ ${qq} 私聊消息已送达`))
    .catch(err => logger.error("发送失败", err))
}
```

#### 发送群消息

```javascript
// 方式1：使用 pickGroup
await Bot.pickGroup(group_id).sendMsg(message)

// 方式2：通过群对象
await e.group.sendMsg(message)

// 实际示例
async sendGroupMsg(e) {
  let bot = Bot
  let group_id = 123456789
  
  // 检查是否在群中
  if (!bot.gl.get(Number(group_id))) {
    return e.reply("❎ 群聊列表查无此群")
  }
  
  // 发送消息
  await bot.pickGroup(group_id).sendMsg(e.message)
    .then(() => e.reply(`✅ ${group_id} 群聊消息已送达`))
    .catch(err => logger.error("发送失败", err))
}

// 批量发送群消息
async sendGroupListMsg(e) {
  let group_ids = [123456, 789012, 345678]
  
  for (let group_id of group_ids) {
    await Bot.pickGroup(group_id).sendMsg(e.message)
    await sleep(5000) // 间隔5秒，防止风控
  }
}
```

### 6.3 获取列表信息

#### 获取好友列表

```javascript
// 获取好友数组
const friendArray = await Bot.getFriendArray()
// 返回: [{ user_id, nickname, ... }, ...]

// 获取好友ID列表
const friendList = Bot.getFriendList()
// 返回: [123456, 789012, ...]

// 获取好友Map
const friendMap = Bot.getFriendMap()
// 返回: Map<user_id, friend_info>

// 遍历好友列表
for (const [user_id, info] of Bot.fl) {
  console.log(user_id, info.nickname)
}
```

#### 获取群组列表

```javascript
// 获取群组数组
const groupArray = await Bot.getGroupArray()
// 返回: [{ group_id, group_name, ... }, ...]

// 获取群组ID列表
const groupList = Bot.getGroupList()

// 获取群组Map
const groupMap = Bot.getGroupMap()

// 遍历群组列表
for (const [group_id, info] of Bot.gl) {
  console.log(group_id, info.group_name)
}
```

### 6.4 机器人资料管理

#### 修改昵称

```javascript
// 设置昵称
await Bot.setNickname("新昵称")

// 或通过 pickFriend
await Bot.pickFriend(Bot.uin).setNickname("新昵称")
```

#### 修改头像

```javascript
// 设置头像（支持URL、Buffer、base64）
await Bot.setAvatar("https://example.com/avatar.jpg")
await Bot.setAvatar(Buffer.from(...))
await Bot.setAvatar("base64://...")
```

#### 设置资料

```javascript
// 设置完整资料
await Bot.setProfile({
  nickname: "昵称",
  sex: 1,  // 0: 未知, 1: 男, 2: 女
  age: 18,
  sign: "个性签名"
})
```

### 6.5 QQ空间操作

#### 获取说说列表

```javascript
import request from "../lib/request/request.js"

async getQzone(num = 20, pos = 0) {
  const url = "https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6"
  
  return await request.get(url, {
    headers: {
      Cookie: Bot.cookies["qzone.qq.com"]
    },
    params: {
      uin: Bot.uin,
      pos,
      num,
      g_tk: Bot.bkn,
      format: "json"
    },
    responseType: "json"
  })
}

// 使用
let list = await getQzone(5, 0)
console.log(list.msglist)
```

#### 发表说说

```javascript
async setQzone(content, images = []) {
  const url = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6"
  
  return request.post(url, {
    headers: {
      Cookie: Bot.cookies["qzone.qq.com"]
    },
    params: { g_tk: Bot.bkn },
    data: {
      con: content,
      hostuin: Bot.uin,
      format: "json"
    },
    responseType: "json"
  })
}
```

#### 删除说说

```javascript
async delQzone(tid, t1_source) {
  const url = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6"
  
  return request.post(url, {
    headers: { Cookie: Bot.cookies["qzone.qq.com"] },
    params: { g_tk: Bot.bkn },
    data: { tid, t1_source, hostuin: Bot.uin },
    responseType: "json"
  })
}
```

### 6.6 好友管理

#### 删除好友

```javascript
// 删除好友
await Bot.pickFriend(user_id).delete()

// 删除后刷新好友列表
await Bot.getFriendMap()
```

#### 处理好友申请

```javascript
// 监听好友申请
Bot.on("request.friend.add", async (e) => {
  // 同意申请
  await e.approve(true)
  
  // 拒绝申请
  await e.approve(false, "拒绝理由")
})

// 主动处理
await Bot.setFriendAddRequest(flag, true, "备注")
```

#### 点赞

```javascript
// 给好友点赞
await Bot.pickFriend(user_id).thumbUp(10)  // 点赞10次
```

### 6.7 群公告管理

#### 获取群公告列表

```javascript
async getAnnouncelist(group_id) {
  const url = "https://web.qun.qq.com/cgi-bin/announce/get_t_list"
  
  return await request.get(url, {
    headers: { Cookie: Bot.cookies["qun.qq.com"] },
    params: {
      bkn: Bot.bkn,
      qid: group_id,
      ft: 23,
      s: 0,
      n: 20
    },
    responseType: "json"
  })
}
```

#### 发送群公告

```javascript
async setAnnounce(group_id, msg, img) {
  const data = {
    qid: group_id,
    bkn: Bot.bkn,
    text: msg,
    pinned: 0,
    type: 1
  }
  
  if (img) {
    // 上传图片逻辑
    const res = await uploadImg(img)
    data.pic = res.id
  }
  
  let url = `https://web.qun.qq.com/cgi-bin/announce/add_qun_notice?bkn=${Bot.bkn}`
  return await request.post(url, {
    data,
    headers: { Cookie: Bot.cookies["qun.qq.com"] }
  })
}
```

#### 删除群公告

```javascript
async delAnnounce(group_id, num) {
  // 先获取公告fid
  let fid = await getAnnouncelist(group_id, num)
  
  let url = "https://web.qun.qq.com/cgi-bin/announce/del_feed"
  return await request.post(url, {
    params: { bkn: Bot.bkn },
    data: { fid: fid.fid, qid: group_id },
    headers: { Cookie: Bot.cookies["qun.qq.com"] }
  })
}
```

---

## 7. 群聊管理详解

### 7.1 群基础操作

#### 获取群信息

```javascript
// 获取群信息
const groupInfo = await Bot.pickGroup(group_id).getInfo()

// 获取群头像URL
const avatarUrl = Bot.pickGroup(group_id).getAvatarUrl()
// 返回: https://p.qlogo.cn/gh/{group_id}/{group_id}/0
```

#### 设置群名称

```javascript
await Bot.pickGroup(group_id).setName("新群名")
// 或
await e.group.setName("新群名")
```

#### 设置群头像

```javascript
await Bot.pickGroup(group_id).setAvatar("https://example.com/group-avatar.jpg")
```

#### 退群/解散群

```javascript
// 退群
await Bot.pickGroup(group_id).quit()

// 解散群（需要群主权限）
await Bot.pickGroup(group_id).quit(true)
```

### 7.2 成员管理

#### 获取成员信息

```javascript
// 获取成员数组
const memberArray = await Bot.pickGroup(group_id).getMemberArray()

// 获取成员Map
const memberMap = await Bot.pickGroup(group_id).getMemberMap()

// 获取特定成员信息
const memberInfo = await Bot.pickGroup(group_id).pickMember(user_id).getInfo()

// 获取成员头像
const avatarUrl = Bot.pickGroup(group_id).pickMember(user_id).getAvatarUrl()
```

#### 禁言成员

```javascript
// 禁言单个成员（秒）
await Bot.pickGroup(group_id).muteMember(user_id, 3600)  // 禁言1小时

// 通过成员对象
await e.group.pickMember(user_id).mute(3600)

// 批量禁言
async muteMembers(group_id, user_ids, duration) {
  for (let user_id of user_ids) {
    await Bot.pickGroup(group_id).muteMember(user_id, duration)
  }
}
```

#### 解除禁言

```javascript
// 解除禁言（duration设为0）
await Bot.pickGroup(group_id).muteMember(user_id, 0)
```

#### 踢出成员

```javascript
// 踢出成员
await Bot.pickGroup(group_id).kickMember(user_id)

// 踢出并拉黑
await Bot.pickGroup(group_id).kickMember(user_id, true)

// 批量踢人
async BatchKickMember(group_id, user_ids) {
  // 每20个一组
  for (let chunk of _.chunk(user_ids, 20)) {
    await request.post("https://qun.qq.com/cgi-bin/qun_mgr/delete_group_member", {
      data: {
        gc: group_id,
        ul: chunk.join("|"),
        flag: 0,
        bkn: Bot.bkn
      }
    })
    await sleep(2000)  // 间隔2秒
  }
}
```

#### 设置管理员

```javascript
// 设置管理员
await Bot.pickGroup(group_id).setAdmin(user_id, true)

// 取消管理员
await Bot.pickGroup(group_id).setAdmin(user_id, false)
```

#### 设置群名片

```javascript
await Bot.pickGroup(group_id).setCard(user_id, "新名片")
```

#### 设置群头衔

```javascript
// 设置专属头衔（群主权限）
await Bot.pickGroup(group_id).setTitle(user_id, "头衔名称", -1)  // -1表示永久

// 成员自己申请头衔
await e.group.setTitle(e.user_id, "申请的头衔")
```

### 7.3 全体禁言

```javascript
// 开启全体禁言
await Bot.pickGroup(group_id).muteAll(true)

// 关闭全体禁言
await Bot.pickGroup(group_id).muteAll(false)

// 或通过 e.group
await e.group.muteAll(true)
```

### 7.4 群文件管理

#### 获取群文件系统

```javascript
const fs = Bot.pickGroup(group_id).fs

// 获取文件系统信息
await fs.df()  // disk free

// 列出根目录文件
await fs.ls()

// 列出文件夹内文件
await fs.ls(folder_id)
```

#### 上传群文件

```javascript
// 上传文件
await Bot.pickGroup(group_id).sendFile("/path/to/file.txt", "file.txt")

// 上传到指定文件夹
await Bot.pickGroup(group_id).fs.upload("/path/to/file.txt", folder_id, "file.txt")
```

#### 删除群文件

```javascript
await Bot.pickGroup(group_id).fs.rm(file_id, busid)
```

#### 创建文件夹

```javascript
await Bot.pickGroup(group_id).fs.mkdir("新文件夹")
```

### 7.5 群精华消息

```javascript
// 设置精华消息
await Bot.setEssenceMessage(message_id)

// 移除精华消息
await Bot.removeEssenceMessage(message_id)

// 获取精华消息列表
await Bot.pickGroup(group_id).getEssence()
```

### 7.6 定时群管任务

```javascript
import schedule from "node-schedule"

// 设置定时禁言
async setMuteTask(group_id, cron, type, bot_id) {
  // cron 格式: "0 0 22 * * ?" 每天22:00
  const task = {
    group_id,
    cron,
    type,  // true: 禁言, false: 解禁
    bot_id
  }
  
  // 保存到Redis
  await redis.set(`yenai:muteTask:${group_id}:${type}`, JSON.stringify(task))
  
  // 创建定时任务
  schedule.scheduleJob(cron, async () => {
    await Bot.pickGroup(group_id).muteAll(type)
  })
}

// 取消定时任务
async delMuteTask(group_id, type) {
  await redis.del(`yenai:muteTask:${group_id}:${type}`)
}
```

### 7.7 群成员活跃度统计

```javascript
// 获取不活跃成员
async getNoactiveList(group_id, time, unit) {
  // time: 时间数值, unit: 单位（天/周/月）
  const members = await Bot.pickGroup(group_id).getMemberMap()
  
  let inactiveList = []
  for (const [user_id, info] of members) {
    // 根据 last_sent_time 判断
    if (info.last_sent_time < Date.now() / 1000 - time * unit) {
      inactiveList.push(info)
    }
  }
  
  return inactiveList
}

// 获取从未发言的成员
async getNeverSpeak(group_id) {
  const members = await Bot.pickGroup(group_id).getMemberMap()
  
  return Array.from(members.values()).filter(member => 
    member.last_sent_time === 0 || !member.last_sent_time
  )
}
```

---

## 8. 实用工具函数

### 8.1 权限检查工具

```javascript
/**
 * 检查权限
 * @param {object} e - 事件对象
 * @param {string} permission - 用户所需权限 (master/admin/owner/all)
 * @param {string} role - Bot所需权限 (admin/owner/all)
 * @returns {boolean}
 */
function checkPermission(e, permission = "all", role = "all") {
  // 检查Bot权限
  if (role === "owner" && !e.group.is_owner) {
    e.reply("❎ Bot权限不足，需要群主权限")
    return false
  }
  if (role === "admin" && !e.group.is_admin && !e.group.is_owner) {
    e.reply("❎ Bot权限不足，需要管理员权限")
    return false
  }
  
  // 检查用户权限
  if (!e.isMaster) {
    const member = e.group.pickMember(e.user_id)
    if (permission === "master") {
      e.reply("❎ 该命令仅限主人可用")
      return false
    } else if (permission === "owner" && !member.is_owner) {
      e.reply("❎ 该命令仅限群主可用")
      return false
    } else if (permission === "admin" && !member.is_admin && !member.is_owner) {
      e.reply("❎ 该命令仅限管理可用")
      return false
    }
  }
  
  return true
}
```

### 8.2 消息处理工具

#### 获取引用消息

```javascript
/**
 * 获取引用消息
 * @param {object} e - 消息事件
 * @param {object} options - 选项
 * @param {boolean} options.img - 是否获取图片
 * @param {boolean} options.file - 是否获取文件
 */
async function takeSourceMsg(e, { img, file } = {}) {
  let source = ""
  
  // 方式1：使用 getReply
  if (e.getReply) {
    source = await e.getReply()
  }
  // 方式2：通过 source 获取
  else if (e.source) {
    if (e.group?.getChatHistory) {
      source = (await e.group.getChatHistory(e.source.seq, 1)).pop()
    } else if (e.friend?.getChatHistory) {
      source = (await e.friend.getChatHistory(e.source.time, 1)).pop()
    }
  }
  
  if (!source) return false
  
  // 提取图片
  if (img) {
    let imgArr = []
    for (let i of source.message) {
      if (i.type === "image") imgArr.push(i.url)
    }
    return imgArr.length ? imgArr : false
  }
  
  // 提取文件
  if (file) {
    if (source.message[0].type === "file") {
      let { fid } = source.message[0]
      return e.group?.getFileUrl(fid)
    }
    return false
  }
  
  return source
}
```

#### 创建转发消息

```javascript
/**
 * 创建转发消息
 * @param {object} e - 事件对象
 * @param {Array} msgList - 消息列表
 * @param {object} options - 选项
 */
async function getforwardMsg(e, msgList, { xmlTitle = "聊天记录" } = {}) {
  const forwardMsg = []
  
  for (let msg of msgList) {
    forwardMsg.push({
      user_id: Bot.uin,
      nickname: Bot.nickname,
      message: Array.isArray(msg) ? msg : [msg]
    })
  }
  
  const msg = Bot.makeForwardMsg(forwardMsg)
  return e.reply(msg)
}
```

### 8.3 Cookie 处理工具

```javascript
/**
 * 获取并解析 Cookie
 * @param {string} domain - 域名，如 "qun.qq.com"
 * @param {object} bot - Bot对象
 * @param {boolean} transformation - 是否转换为Puppeteer格式
 */
function getck(domain, bot = Bot, transformation = false) {
  let cookie = bot.cookies[domain]
  
  function parseCkString(str) {
    const pairs = str.split(";")
    const obj = {}
    pairs.forEach(pair => {
      const [key, value] = pair.trim().split("=")
      if (key) obj[key] = decodeURIComponent(value)
    })
    return obj
  }
  
  const ck = parseCkString(cookie)
  
  if (transformation) {
    // 转换为Puppeteer浏览器使用的格式
    let arr = []
    for (let i in ck) {
      arr.push({
        name: i,
        value: ck[i],
        domain: domain,
        path: "/",
        expires: Date.now() + 3600 * 1000
      })
    }
    return arr
  }
  
  return ck
}

/**
 * 计算 GTK (用于QQ空间等接口)
 * @param {string} skey - skey值
 */
function getGtk(skey) {
  let hash = 5381
  for (let i = 0; i < skey.length; i++) {
    hash += (hash << 5) + skey.charCodeAt(i)
  }
  return hash & 0x7fffffff
}
```

### 8.4 数字转换工具

```javascript
/**
 * 中文数字转阿拉伯数字
 * @param {string} chinaNum - 中文数字，如 "一百二十三"
 */
function translateChinaNum(chinaNum) {
  if (!chinaNum) return 0
  
  const chinaNumMap = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100, '千': 1000, '万': 10000,
    '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
    '陆': 6, '柒': 7, '捌': 8, '玖': 9
  }
  
  let result = 0
  let temp = 0
  
  for (let char of chinaNum) {
    const num = chinaNumMap[char]
    if (num >= 10) {
      if (temp === 0) temp = 1
      result += temp * num
      temp = 0
    } else {
      temp = temp * 10 + num
    }
  }
  
  return result + temp
}
```

### 8.5 限流工具

```javascript
/**
 * 每日次数限制
 * @param {number} userId - 用户ID
 * @param {string} key - 限制键
 * @param {number} maxLimit - 最大次数
 */
async function limit(userId, key, maxLimit) {
  if (maxLimit <= 0) return true
  
  let redisKey = `plugin:${key}:limit:${userId}`
  let nowNum = await redis.get(redisKey)
  
  if (nowNum > maxLimit) return false
  
  if (!nowNum) {
    // 设置过期时间为当天结束
    const expire = moment().add(1, "days").startOf("day").diff(undefined, "second")
    await redis.set(redisKey, 1, { EX: expire })
  } else {
    await redis.incr(redisKey)
  }
  
  return true
}

// 使用
if (!await limit(e.user_id, "command_name", 10)) {
  return e.reply("今日次数已用完")
}
```

### 8.6 异常处理工具

```javascript
/**
 * 统一异常处理
 * @param {object} e - 事件对象
 * @param {Error} error - 错误对象
 * @param {object} options - 选项
 */
function handleException(e, error, { MsgTemplate } = {}) {
  if (!(error instanceof Error)) return false
  
  let errMsg = error.message
  logger.error(error)
  
  if (MsgTemplate) {
    errMsg = MsgTemplate.replace(/{error}/g, errMsg)
  }
  
  return e.reply(errMsg)
}

// 自定义错误类
class ReplyError extends Error {
  constructor(message) {
    super(message)
    this.name = "ReplyError"
  }
}
```

### 8.7 异步池工具

```javascript
/**
 * 异步池，控制并发数
 * @param {number} poolLimit - 并发限制
 * @param {Array} array - 任务数组
 * @param {Function} iteratorFn - 迭代函数
 */
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = []
  const executing = []
  
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item, array))
    ret.push(p)
    
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1))
      executing.push(e)
      if (executing.length >= poolLimit) {
        await Promise.race(executing)
      }
    }
  }
  
  return Promise.all(ret)
}

// 使用示例
await asyncPool(5, userList, async (user) => {
  await sendMsg(user.id, "消息")
})
```

---

*文档版本: 2.0*  
*最后更新: 2026-02-23*

---

## 提取转发消息内图片（高级技巧）

> 感谢 [m0_69204072](https://gitcode.com/m0_69204072/dna) 提供的参考实现。

### 核心能力

在 Yunzai 中，转发消息（合并转发）内的图片无法直接通过 `e.img` 获取，需要递归解析转发消息结构。此技巧支持：
- 单层转发消息内图片提取
- 双层/多层嵌套转发递归解析
- 兼容 TRSS-Yunzai / ICQQ / NapCat 不同的消息结构

### 关键 API

```javascript
// 获取转发消息内容（通过 resid/forwardId）
const forwardMsgs = await e.bot.getForwardMsg(forwardId)

// 获取引用消息（通过 reply_id）
const sourceMsg = await e.getReply(e.reply_id, { message_type: e.message_type })

// 获取聊天历史（通过 source.seq）
const chatHistory = e.isGroup
  ? await e.group.getChatHistory(e.source.seq, 1)
  : await e.friend.getChatHistory(e.source.seq, 1)
```

### 转发消息结构适配

不同框架的转发消息结构不同，需要兼容多种路径：

```javascript
// 转发消息类型判断
msg.type === 'multimsg'   // multimsg 类型，resid 在 msg.resid 或 msg.id
msg.type === 'forward'    // TRSS/ICQQ 封装的 forward 类型
msg.type === 'text'/'json' // 文本中包含 [CQ:forward,id=xxx]

// forward 类型内容提取（兼容多种存储路径）
const forwardContent = Array.isArray(msg.data?.content) ? msg.data.content  // 优先：msg.data.content
  : Array.isArray(msg.content) ? msg.content
  : msg.content?.message ? [msg.content]
  : Array.isArray(msg.messages) ? msg.messages
  : [];

// 子消息段提取
const subMessages = Array.isArray(itm.message) ? itm.message
  : Array.isArray(itm.msg) ? itm.msg
  : (itm.content ? [itm.content] : []);
```

### 完整示例：提取转发图片插件

```javascript
export class GetForwardImgPlugin extends plugin {
  constructor() {
    super({
      name: '提取转发图片',
      dsc: '提取转发消息图片（支持多层转发）',
      event: 'message',
      priority: -5000,
      rule: [{ reg: /^#取图片$/, fnc: 'getForwardImages' }]
    });
  }

  async getForwardImages(e) {
    const imgList = await this.extractImages(e);
    if (!imgList.length) return e.reply('❌ 未检测到任何图片');

    await e.reply(`✅ 提取到 ${imgList.length} 张图片：`);
    // 分批发送，每批最多9张
    for (let i = 0; i < imgList.length; i += 9) {
      const batch = imgList.slice(i, i + 9).map(url => segment.image(url));
      await e.reply(batch);
    }
  }

  async extractImages(e) {
    let imgList = e.img || [];

    // 递归解析消息段
    const parseMessages = async (messages, depth = 0) => {
      if (depth > 5) return; // 防止无限递归
      for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;

        // 图片类型
        if (msg.type === 'image' || msg.type === 'img') {
          const url = msg.url || msg.data?.url || msg.data?.file || msg.file;
          if (url && !imgList.includes(url)) imgList.push(url);
        }
        // multimsg 转发
        else if (msg.type === 'multimsg') {
          const fid = msg.resid || msg.id;
          if (fid && e.bot?.getForwardMsg) {
            const fwdMsgs = await e.bot.getForwardMsg(fid).catch(() => []);
            for (const fm of fwdMsgs) {
              if (Array.isArray(fm.message)) await parseMessages(fm.message, depth + 1);
            }
          }
        }
        // forward 类型（TRSS/ICQQ）
        else if (msg.type === 'forward') {
          const content = Array.isArray(msg.data?.content) ? msg.data.content
            : Array.isArray(msg.content) ? msg.content
            : Array.isArray(msg.messages) ? msg.messages : [];
          for (const itm of content) {
            const sub = Array.isArray(itm?.message) ? itm.message
              : Array.isArray(itm?.msg) ? itm.msg : [];
            if (sub.length) await parseMessages(sub, depth + 1);
          }
        }
        // 文本中的 CQ 转发码
        else if (['text', 'json', 'plain'].includes(msg.type)) {
          const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.data || '');
          const match = text.match(/\[CQ:forward,id=(\d+)\]/) || text.match(/"resid":"(.*?)"/);
          if (match?.[1] && e.bot?.getForwardMsg) {
            const fwdMsgs = await e.bot.getForwardMsg(match[1]).catch(() => []);
            for (const fm of fwdMsgs) {
              if (Array.isArray(fm.message)) await parseMessages(fm.message, depth + 1);
            }
          }
        }
      }
    };

    // 解析引用消息
    let sourceMsg = null;
    if (e.reply_id) {
      sourceMsg = await e.getReply(e.reply_id, { message_type: e.message_type }).catch(() => null);
    } else if (e.source?.seq) {
      const history = e.isGroup
        ? await e.group.getChatHistory(e.source.seq, 1).catch(() => [])
        : await e.friend.getChatHistory(e.source.seq, 1).catch(() => []);
      sourceMsg = history?.pop();
    }
    if (sourceMsg) {
      const segs = Array.isArray(sourceMsg.message) ? sourceMsg.message
        : Array.isArray(sourceMsg.content) ? sourceMsg.content : [];
      await parseMessages(segs);
    }

    // 解析当前消息
    if (Array.isArray(e.message)) await parseMessages(e.message);

    // 去重 + 过滤有效 URL
    return [...new Set(imgList)].filter(url =>
      url?.startsWith('http://') || url?.startsWith('https://') || url?.startsWith('file://') || url?.startsWith('/')
    );
  }
}
```

### 要点总结

1. **`e.img` 只包含当前消息的直接图片**，转发消息内的图片需要通过 `e.bot.getForwardMsg()` 获取
2. **递归深度限制**：防止恶意嵌套导致无限递归，建议限制 5 层
3. **兼容多种消息结构**：不同 OneBot 实现（NapCat/ICQQ/go-cqhttp）的转发消息字段位置不同
4. **分批发送**：大量图片分批发送避免消息过长被截断
5. **错误处理**：`getForwardMsg` 可能失败（消息过期/权限不足），需要 catch
