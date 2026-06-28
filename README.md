<div align="center">

# TRSS-Yunzai QQBot Plugin

TRSS-Yunzai QQBot 适配器 插件

</div>

# Tip

此版本基于[叶](https://github.com/XasYer/Yunzai-QQBot-Plugin)的自用版修改，会在`任意时间`直接进行更改，且`不会`与上游一致  
班级群： [1057604000](https://qm.qq.com/q/Rv6pE8M8Ug)

<details><summary>自己部署webhook转发服务</summary>

- Node.js后端：[Node.js-qbot-webhook-to-websocket（Gitee）](https://gitee.com/ts-yf/Node.js-qbot-webhook-to-websocket) | [Node.js-qbot-webhook-to-websocket（Github）](https://github.com/Ts-yf/Node.js-qbot-webhook-to-websocket)

</details>

<details><summary>使用TS霆生のwebhook转发服务（免费）</summary>

1. QQ机器人后台回调配置链接：`https://bot.191800.xyz/webhook?secret={secret}`，`{secret}`替换为`bot secret`
2. 插件ws连接配置：`wss://bot.191800.xyz/ws/{secret}`，`{secret}`替换为`bot secret`

</details>

## 自用Fork版

0. 自定义ws接收地址，在`config/QQBot.yaml`中添加以下配置项，`BotQQ`改为`机器人QQ号`
   ```yml
   WsUrl:
     BotQQ: ws://...
     BotQQ: ws://...
   ```
1. `Model/template/groupIncreaseMsg_default.js`中`自定义入群发送主动消息`
2. `#QQBotDAU` / `#QQBotDAUpro`
3. `#QQBot调用统计` 根据`e.reply()`发送的消息进行统计,每条消息仅统计一次,未做持久化处理,默认关闭,`#QQBot设置调用统计开启`
4. `#QQBot用户统计`: 对比昨日的用户数据,默认关闭,`#QQBot设置用户统计开启`
5. `config/QQBot.yaml`中使用以下自定义模版,如果设置了全局md会优先使用自定义模版,配合`e.toQQBotMD = true`将特定消息`转换`成md,亦可在`全局md模式下`通过`e.toQQBotMD = false`将特定消息`不转换`成md
   - 方法1: 直接修改`config/QQBot.yaml` **(推荐)**
     ```yml
     customMD:
       BotQQ:
         custom_template_id: 模版id
         keys:
           - key1 # 对应的模版key名字
           - key2
           # ... 最多10个
     ```
   - 方法2: 在`Model/template`目录下新建`markdownTemplate.js`文件,写入以下内容 **(不推荐)**
     ```js
     // params为数组,每一项为{key:string,values: ['\u200B']} // values固定为['\u200B']
     export defalut {
       custom_template_id: '',
       params: []
     }
     ```
6. `config/QQBot.yaml`中使用以下配置项,在`全局MD`时会`以MD的模式`自动加入`params`中
   ```yml
   mdSuffix:
     BotQQ:
       - key: key1
         values:
           - value # 如果用到了key则不会添加
       - key: key2
         values:
           # \ 需转义 \\
           - "{{ e.msg.replace(/^#/g, '\\/') }}" # {{}}中为动态参数,会在发送时替换成对应值,目前仅有e可用,也可以传入js表达式等等
       # ...
   ```
7. `config/QQBot.yaml`中使用以下配置项,在`全局MD`时会`以button的模式`自动加入`按钮指定行数并独占一行`,当`超过`5排按钮时`不会添加`
   ```yml
   btnSuffix:
     BotQQ:
       position: 1 # 位置:第几行 1 - 5
       values:
         - text: test
           callback: test
           show: # 达成什么条件才会显示
             type: random # 目前仅支持 random
             data: 50 # 0-100
         - text: test2
           input: test2
         # ... 最多10个
   ```
8. `config/QQBot.yaml`中使用前台日志消息过滤,将会不在前台打印自定的消息内容，防log刷屏
   - **自定义消息采取完整消息匹配，非关键词匹配**
   - **非必要不建议开启此项**
     > 注意：_只会过滤部分QQBot的日志_
   ```yml
   filterLog:
     BotQQ:
       - 垃圾机器人
       # ...
   ```
9. `config/QQBot.yaml`中`simplifiedSdkLog`是否简化sdk日志,若设置为`true`则不会打印` recv from Group(xxx):  xxx`,并且会简化发送为`send to Group(xxx): <markdown><button>`
10. ~~`#QQBot一键群发`: 需要先配置模版 `template/oneKeySendGroupMsg_default.js`~~
11. `config/QQBot.yaml`中`markdownImgScale: 1`是否对markdown中的图片进行等比例缩放,0.5为缩小50%,1.5为放大50%,以此类推
12. `config/QQBot.yaml`中`sendButton: true`未开启全局MD时是否单独发送按钮
13. `config/QQBot.yaml`中`dauDB: level`选择存储dau数据的数据库,可选: `level`, `redis`,以及`false`关闭dau统计(仅每日发言用户和群)
    - `level`
      - 优点: 统计了大部分数据
      - 缺点: 缓存存一份,level存一份
    - `redis`
      - 优点: 大部分使用redis存储,不会缓存
      - 缺点: 没有缓存所以有些没统计
14. 已适配YePanel,提供dau统计和设置功能
15. `config/QQBot.yaml`中`bus`是否使用ws中转站
   - 使用ws中转站可以降低成本,只需要一台低性能云服务器即可通过IP白名单验证,后端可使用本地服务器
   - 填写格式:
   ```
   bus: {
     BotQQ: "example.com"
   }
   ```
   - 后端搭建[[QQBotWs](https://github.com/Admilkk/QQBotWs)]
16. `config/QQBot.yaml`中`forceSilk: true`强制将语音转为silk格式再发送
17. `config/QQBot.yaml`中`markdown.prefix`/`markdown.suffix`为原生MD消息注入固定前后缀文本，`markdown.affixMode`控制注入策略
    - `prefix`: 在所有原生MD内容前插入的文本（如 `"【Bot】"`）
    - `suffix`: 在所有原生MD内容后插入的文本（如 `"\n---\nPowered by QQBot"`）
    - `affixMode`: 可选 `smart`（默认）或 `all`
      - `smart`: 仅在内容包含多行、图片、按钮、显式markdown或node元素时注入
      - `all`: 所有raw markdown消息均注入
    ```yml
    markdown:
      template: abcdefghij
      prefix: '【Bot】\n'      # 前缀（需用单引号包裹转义符）
      suffix: '\n---'          # 后缀
      affixMode: smart         # smart(默认) | all
    ```

<details><summary>QR扫码登录</summary>

支持通过扫码授权的方式登录，适用于没有AppSecret的场景。

</details>

<details><summary>群成员增减事件</summary>

- `member.increase`/`member.decrease` 事件通知
- 入群自动发送欢迎模板消息
- 支持自定义 `Model/template/groupIncreaseMsg.js` 模板

</details>

<details><summary>其他新增配置</summary>

- `hideGuildRecall: false` — 撤回频道消息是否隐藏
- `smallbtn: false` — 启用小按钮（font_size: small）
- `filter_bot_msg: false` — 过滤其他bot消息
- `filter_only_at_other_bot: false` — 过滤纯@其他bot的消息
- `rawButton: {}` — 逐bot切换原生按钮/文字回退
- `stream: false` — 流式消息发送（长文本分段）
- `mdSuffix`/`btnSuffix` 配置（见上方第6、7点）

</details>

<details><summary>模块化结构</summary>

```
index.js              # 入口（32行）
components/
├── adapter.js         # 引擎类 + install
├── connection.js      # WebSocket连接 + intents
├── message-event.js   # 事件处理
├── message-sender.js  # 消息发送
├── message-builder.js # 消息构建
├── file.js            # 文件上传/撤回
├── picker.js          # 对象获取
├── recall.js          # 召回系统
├── button.js          # 按钮
├── image.js           # 图片
├── claw.js            # 龙虾配置
└── config.js          # 配置助手
model/
├── sdkEnhancer.js     # SDK增强
├── config.js          # YAML配置
├── dau.js             # DAU统计
└── inviteStore.js     # 邀请存储
```

</details>

## 安装教程

1. 准备：[TRSS-Yunzai](../../../Yunzai)
2. 在云崽根目录/plugins 下打开终端运行命令：`git clone https://github.com/ZY-Zone/QQBot-Plugin.git`
3. 打开QQBot-Plugin，执行依赖安装命令：`pnpm i`
4. 打开：[QQ 开放平台](https://q.qq.com) 创建 Bot：  
   ① 创建机器人  
   ② 开发设置 → 得到 `机器人QQ号:AppID:Token:AppSecret`
5. 输入：`#QQBot设置机器人QQ号:AppID:Token:AppSecret:[01]:[01]`

## 格式示例

- 机器人QQ号 `114` AppID `514` Token `1919` AppSecret `810` 群Bot 频道私域

```
#QQBot设置114:514:1919:810:1:1
```

- WebHook

```
#QQBot设置114:514:1919:810:2
```

需要启用公网 HTTPS，开放平台添加 {url}/QQBot

- 扫码登录（无需AppSecret）

```
#QQBot登录114:1:1
#QQBot登录114:2 # WebHook模式
```

扫码授权的方式会重置密钥，请注意保存新的密钥

## 发送图片（二选一）

- MD消息模式：使用内置图床发送图片
- 切换普通消息，输入 `#QQBotMD机器人QQ号:legacy`

## 使用教程

### 账号管理
- `#QQBot账号` — 查看已连接账号列表
- `#QQBot设置114:514:1919:810:1:1` — 添加/删除账号（机器人QQ号:AppID:Token:AppSecret:群Bot:频道私域）
- `#QQBot登录114:1:1` — 扫码授权登录（机器人QQ号:群Bot:频道私域）

### 消息模式
- `#QQBotMD114:raw` — 原生MD消息（支持按钮）
- `#QQBotMD114:legacy` — 普通消息模式
- `#QQBotMD114:1909831031_980983013` — 设置Markdown模板ID
- `#QQBot图片限制3` — 限制图片大小（MB）

### 功能开关
- `#QQBot设置二维码 开启/关闭` — 链接转二维码
- `#QQBot设置按钮回调 开启/关闭` — 按钮回调模式
- `#QQBot设置转换 开启/关闭` — QQ号转UID（需ws-plugin）
- `#QQBot设置转图片 开启/关闭` — 转发转图片（需ws-plugin）
- `#QQBot设置调用统计 开启/关闭`
- `#QQBot设置用户统计 开启/关闭`
- `#QQBot设置文字链 开启/关闭` — 按钮转文字链
- `#QQBot设置机器人消息过滤 开启/关闭`
- `#开启bot消息过滤` / `#关闭bot消息过滤`

### 统计
- `#QQBotDAU` / `#QQBotDAUpro` — 日活跃统计
- `#QQBot调用统计` — 按reply统计
- `#QQBot用户统计` — 对比昨日用户数据

### 其他
- `#QQBot刷新config` — 刷新配置文件
- `#QQBot添加/删除过滤日志xxx` — 过滤前台日志
- `#QQBot一键群发` — 群发消息（需配置模板）
- `#QQBot帮助` — 帮助菜单

## 上游项目 - 排名不分先后

| 项目 | 作者 | 仓库地址 |
|------|------|----------|
| **TRSS原版（时雨）** | TimeRainStarSky | [Gitee](https://gitee.com/TimeRainStarSky/Yunzai-QQBot-Plugin) |
| **windtrace（风）** | wind-trace | [Gitee](https://gitee.com/wind-trace-typ/Yunzai-QQBot-Plugin) |
| **IKUN** | ikun25000 | [Gitee](https://gitee.com/ikun25000/QQBot-Plugin) |
| **TS霆生** | ts-yf | [Gitee](https://gitee.com/ts-yf/QQBot-Plugin) |
| **小丞** | A-Kevin1217 | [GitHub](https://github.com/A-Kevin1217/QQBot-Plugin) |
| **叶** | XasYer | [GitHub](https://github.com/XasYer/Yunzai-QQBot-Plugin) |
