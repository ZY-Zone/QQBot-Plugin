import _ from 'lodash'
import fs from 'node:fs'
import crypto from 'node:crypto'
import fetch from 'node-fetch'
import { config } from '../Model/index.js'

export function _parseFileSegment(adapter, i, data) {
  let fileData = {
    file: null,
    name: null,
    force_chunk: false,
    recall_time: 0
  }

  if (typeof i.file === 'string') {
    fileData.file = i.file

    if (typeof i.name === 'object' && i.name !== null) {
      fileData.name = i.name.name || null
      fileData.force_chunk = typeof i.name.force_chunk !== 'undefined' ? !!i.name.force_chunk : false
      fileData.recall_time = Number(i.name.recall_time) || 0
    } else {
      fileData.name = i.name || null

      let thirdParam = undefined
      if (typeof i.force_chunk !== 'undefined') {
        thirdParam = i.force_chunk
      } else if (typeof i.data !== 'undefined' && typeof i.data !== 'object') {
        thirdParam = i.data
      } else if (typeof i[2] !== 'undefined') {
        thirdParam = i[2]
      } else if (typeof i['2'] !== 'undefined') {
        thirdParam = i['2']
      } else if (Array.isArray(i.args) && i.args.length > 0) {
        thirdParam = i.args[0]
      }
      fileData.force_chunk = typeof thirdParam !== 'undefined' ? !!thirdParam : false

      let fourthParam = undefined
      if (typeof i.recall_time !== 'undefined') {
        fourthParam = i.recall_time
      } else if (typeof i[3] !== 'undefined') {
        fourthParam = i[3]
      } else if (typeof i['3'] !== 'undefined') {
        fourthParam = i['3']
      } else if (Array.isArray(i.args) && i.args.length > 1) {
        fourthParam = i.args[1]
      }
      fileData.recall_time = Number(fourthParam) || 0
    }
  } else if (typeof i.file === 'object' && i.file !== null) {
    if (i.file.file) {
      fileData.file = i.file.file
      fileData.name = i.file.name || i.name || null
      fileData.force_chunk = typeof i.file.force_chunk !== 'undefined'
        ? !!i.file.force_chunk
        : (typeof i.force_chunk !== 'undefined' ? !!i.force_chunk : false)
      fileData.recall_time = Number(i.file.recall_time ?? i.recall_time) || 0
    } else {
      fileData.file = i.file
      fileData.name = i.name || null
      fileData.force_chunk = typeof i.force_chunk !== 'undefined' ? !!i.force_chunk : false
      fileData.recall_time = Number(i.recall_time) || 0
    }
  }

  if (!fileData.name && typeof fileData.file === 'string' && fileData.file.startsWith('http')) {
    try {
      const url = new URL(fileData.file)
      const lastSegment = url.pathname.split('/').pop()
      const fileNameWithoutParams = lastSegment.split('?')[0]
      if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
        fileData.name = decodeURIComponent(fileNameWithoutParams)
      }
    } catch { }
  }

  return fileData
}

async function recallMessageById(adapter, data, message_id, target_type, target_id) {
  try {
    const url = `/v2/${target_type}s/${target_id}/messages/${message_id}`
    Bot.makeLog('debug', ['撤回消息', { url, target_type, target_id, message_id }], data.self_id)
    await data.bot.sdk.request.delete(url)
    Bot.makeLog('info', [`撤回${target_type === 'group' ? '群' : '私聊'}文件消息成功`, { target_id, message_id }], data.self_id)
  } catch (err) {
    Bot.makeLog('error', ['撤回消息失败', { target_type, target_id, message_id }, err.message, err.response?.data], data.self_id)
  }
}

async function uploadFileToQQ(adapter, data, target_id, target_type, file_data, file_name, force_chunk = false) {
  if (typeof file_data === 'string' && file_data.startsWith('http') && !force_chunk) {
    let fileSizeMB = 0
    try {
      const headResponse = await fetch(file_data, { method: 'HEAD' })
      const contentLength = headResponse.headers.get('content-length')
      fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0
      Bot.makeLog('info', [`网络文件大小: ${fileSizeMB.toFixed(2)} MB`], data.self_id)
    } catch (err) {
      Bot.makeLog('debug', ['无法获取文件大小，尝试直传', err.message], data.self_id)
    }

    Bot.makeLog('info', ['检测到网络 URL，使用直传（不下载文件）', { url: file_data.substring(0, 100), file_name }], data.self_id)

    try {
      const filesUrl = `/v2/${target_type}s/${target_id}/files`
      const filesData = {
        file_type: 4,
        srv_send_msg: false,
        url: file_data,
        file_name: file_name || extractFileNameFromUrl(adapter, file_data)
      }

      Bot.makeLog('debug', ['URL 直传', filesUrl, filesData], data.self_id)

      const { data: result } = await data.bot.sdk.request.post(filesUrl, filesData)

      Bot.makeLog('info', ['URL 直传成功，无需下载文件', result], data.self_id)

      return result
    } catch (error) {
      Bot.makeLog('warn', ['URL 直传失败', error.message, error.response?.data], data.self_id)

      if (fileSizeMB > 10) {
        Bot.makeLog('info', [`文件大于 10MB (${fileSizeMB.toFixed(2)} MB)，降级为分片上传`], data.self_id)
        force_chunk = true
      } else {
        Bot.makeLog('info', [`文件较小 (${fileSizeMB.toFixed(2)} MB)，降级为 base64 上传`], data.self_id)
      }
    }
  }

  const getFileBuffer = async (file_data) => {
    if (file_data instanceof Uint8Array) {
      return Buffer.from(file_data)
    } else if (Buffer.isBuffer(file_data)) {
      return file_data
    } else if (typeof file_data === 'string') {
      if (file_data.startsWith('http')) {
        Bot.makeLog('info', ['开始下载网络文件...'], data.self_id)
        const response = await fetch(file_data)
        const buffer = Buffer.from(await response.arrayBuffer())
        Bot.makeLog('info', [`下载完成，大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`], data.self_id)
        return buffer
      } else if (file_data.startsWith('base64://')) {
        return Buffer.from(file_data.replace('base64://', ''), 'base64')
      } else if (file_data.startsWith('file://')) {
        return fs.readFileSync(file_data.replace('file://', ''))
      } else {
        try {
          return fs.readFileSync(file_data)
        } catch {
          return Buffer.from(file_data)
        }
      }
    } else {
      throw new Error('不支持的文件数据类型')
    }
  }

  const extractFileName = (file_data, fileBuffer) => {
    let name = ''
    let ext = ''

    if (typeof file_data === 'string') {
      if (file_data.startsWith('http')) {
        try {
          const url = new URL(file_data)
          const pathname = url.pathname
          const segments = pathname.split('/')
          const lastSegment = segments[segments.length - 1]
          const fileNameWithoutParams = lastSegment.split('?')[0]
          if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
            name = decodeURIComponent(fileNameWithoutParams)
            ext = name.substring(name.lastIndexOf('.'))
          }
        } catch { }
      } else if (file_data.startsWith('file://')) {
        const path = file_data.replace('file://', '')
        name = path.split('/').pop() || path.split('\\').pop()
        if (name && name.includes('.')) {
          ext = name.substring(name.lastIndexOf('.'))
        }
      } else {
        name = file_data.split('/').pop() || file_data.split('\\').pop()
        if (name && name.includes('.')) {
          ext = name.substring(name.lastIndexOf('.'))
        }
      }
    }

    if (!ext && fileBuffer) {
      const header = fileBuffer.toString('hex', 0, 16).toUpperCase()
      const fileTypeMap = {
        '89504E47': '.png',
        '47494638': '.gif',
        'FFD8FF': '.jpg',
        '25504446': '.pdf',
        '494433': '.mp3',
        '52494646': '.wav',
        '00000018': '.mp4',
        '00000020': '.mp4',
        'D0CF11E0': '.doc',
        '504B0304': '.zip',
        '7B22': '.json',
        '3C3F786D': '.xml',
        'EFBBBF': '.txt',
        'FFFE': '.txt',
        'FEFF': '.txt'
      }

      for (const [signature, extension] of Object.entries(fileTypeMap)) {
        if (header.startsWith(signature)) {
          ext = extension
          break
        }
      }

      if (header.startsWith('52494646')) {
        const riffType = fileBuffer.toString('hex', 8, 12).toUpperCase()
        if (riffType === '57454250') {
          ext = '.webp'
        } else {
          ext = '.wav'
        }
      }
    }

    if (!name || !name.includes('.')) {
      const timestamp = Date.now().toString(36)
      const random = Math.random().toString(36).substring(2, 8)
      name = `file_${timestamp}_${random}${ext || '.bin'}`
    }

    if (name.length > 100) {
      const extension = name.substring(name.lastIndexOf('.'))
      const baseName = name.substring(0, name.lastIndexOf('.'))
      name = baseName.substring(0, 80) + '...' + extension
    }

    return name
  }

  try {
    const fileBuffer = await getFileBuffer(file_data)
    const file_size = fileBuffer.length

    if (!file_name) {
      file_name = extractFileName(file_data, fileBuffer)
    }

    const shouldUseChunk = force_chunk || target_type === 'user'

    Bot.makeLog('debug', ['上传方式判断', { force_chunk, target_type, shouldUseChunk, file_size_mb: (file_size / 1024 / 1024).toFixed(2) }], data.self_id)

    if (!shouldUseChunk && target_type === 'group') {
      Bot.makeLog('debug', ['群聊使用 base64 直传', { target_id, file_name, size: file_size }], data.self_id)

      const filesUrl = `/v2/${target_type}s/${target_id}/files`
      const base64Data = fileBuffer.toString('base64')
      const filesData = {
        file_type: 4,
        srv_send_msg: false,
        file_data: base64Data,
        file_name: file_name
      }

      const { data: result } = await data.bot.sdk.request.post(filesUrl, filesData)

      Bot.makeLog('debug', ['群聊 base64 直传成功', result], data.self_id)

      return result
    }

    const md5Hash = crypto.createHash('md5').update(fileBuffer).digest('hex')
    const sha1Hash = crypto.createHash('sha1').update(fileBuffer).digest('hex')
    const MD5_10M_SIZE = 10002432
    const md5_10m = crypto.createHash('md5')
      .update(fileBuffer.slice(0, Math.min(MD5_10M_SIZE, file_size)))
      .digest('hex')

    Bot.makeLog('debug', ['准备分片上传', { target_id, target_type, file_name, file_size }], data.self_id)

    const { data: prepareResult } = await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/upload_prepare`, {
      file_type: 4,
      file_name,
      file_size,
      md5: md5Hash,
      sha1: sha1Hash,
      md5_10m
    })

    const { upload_id, parts } = prepareResult

    for (const part of parts) {
      const { index, presigned_url } = part
      const start = (index - 1) * prepareResult.block_size
      const end = Math.min(start + prepareResult.block_size, file_size)
      const partBuffer = fileBuffer.slice(start, end)

      await fetch(presigned_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': partBuffer.length },
        body: partBuffer
      })

      await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/upload_part_finish`, {
        upload_id,
        part_index: index,
        block_size: partBuffer.length,
        md5: crypto.createHash('md5').update(partBuffer).digest('hex')
      })
    }

    const { data: filesResult } = await data.bot.sdk.request.post(`/v2/${target_type}s/${target_id}/files`, {
      upload_id,
      srv_send_msg: false
    })

    Bot.makeLog('info', ['分片上传成功', filesResult], data.self_id)

    return filesResult
  } catch (error) {
    Bot.makeLog('error', ['文件上传失败', error.message], data.self_id)
    throw error
  }
}

function extractFileNameFromUrl(adapter, url) {
  try {
    const urlObj = new URL(url)
    const lastSegment = urlObj.pathname.split('/').pop()
    const fileNameWithoutParams = lastSegment.split('?')[0]
    if (fileNameWithoutParams && fileNameWithoutParams.includes('.')) {
      return decodeURIComponent(fileNameWithoutParams)
    }
  } catch { }
  return null
}

async function sendFileMessage(adapter, data, target_id, target_type, fileInfo) {
  try {
    let actualFile, actualName, actualForceChunk, actualRecallTime

    if (typeof fileInfo.file === 'object' && fileInfo.file !== null && fileInfo.file.file) {
      actualFile = fileInfo.file.file
      actualName = fileInfo.file.name || fileInfo.name
      actualForceChunk = !!(fileInfo.file.force_chunk || fileInfo.force_chunk)
      actualRecallTime = fileInfo.file.recall_time ?? fileInfo.recall_time ?? 0
    } else {
      actualFile = fileInfo.file
      actualName = fileInfo.name
      actualForceChunk = !!(fileInfo.force_chunk)
      actualRecallTime = fileInfo.recall_time ?? 0
    }

    actualRecallTime = Number(actualRecallTime) || 0

    Bot.makeLog('debug', ['解析后的文件信息', {
      actualFile: typeof actualFile === 'string' ? actualFile : 'Buffer',
      actualName,
      actualForceChunk,
      actualRecallTime
    }], data.self_id)

    const result = await uploadFileToQQ(
      adapter,
      data,
      target_id,
      target_type,
      actualFile,
      actualName,
      actualForceChunk
    )

    const messageUrl = `/v2/${target_type}s/${target_id}/messages`
    const messageData = {
      msg_type: 7,
      media: { file_info: result.file_info }
    }

    if (data.message_id) {
      messageData.msg_id = data.message_id
    }

    Bot.makeLog('debug', ['发送文件消息', messageUrl, messageData], data.self_id)

    const { data: sendResult } = await data.bot.sdk.request.post(messageUrl, messageData)

    Bot.makeLog('debug', ['文件消息发送成功', sendResult], data.self_id)

    if (actualRecallTime > 0 && sendResult && sendResult.id) {
      const msgId = sendResult.id
      Bot.makeLog('info', [`文件消息将在 ${actualRecallTime} 秒后撤回`, { msgId, target_type, target_id }], data.self_id)
      setTimeout(async () => {
        await recallMessageById(adapter, data, msgId, target_type, target_id)
      }, actualRecallTime * 1000)
    }

    return { id: sendResult.id }
  } catch (error) {
    Bot.makeLog('error', ['文件消息发送失败', error.message], data.self_id)
    throw error
  }
}

export async function sendFiles(adapter, data, files) {
  let target_type, target_id

  if (data.group_id) {
    target_type = 'group'
    target_id = data.raw?.group_id || data.group_id.replace(`${data.self_id}${adapter.sep}`, '')
  } else {
    target_type = 'user'
    target_id = data.raw?.sender?.user_id || data.user_id.replace(`${data.self_id}${adapter.sep}`, '')
  }

  Bot.makeLog('debug', ['准备发送文件列表', { target_type, target_id, count: files.length }], data.self_id)

  for (const fileInfo of files) {
    try {
      await sendFileMessage(adapter, data, target_id, target_type, fileInfo)
      Bot.makeLog('info', ['文件发送成功', { target_type, target_id, file: fileInfo.name, force_chunk: fileInfo.force_chunk, recall_time: fileInfo.recall_time }], data.self_id)
    } catch (err) {
      Bot.makeLog('error', ['发送文件失败', fileInfo, err.message, err.response?.data], data.self_id)
    }
  }
}

async function recallMsg(adapter, data, recall, message_id) {
  if (!Array.isArray(message_id)) message_id = [message_id]
  const msgs = []
  for (const i of message_id) {
    try {
      msgs.push(await recall(i))
    } catch (err) {
      Bot.makeLog('debug', ['撤回消息错误', i, err], data.self_id)
      msgs.push(false)
    }
  }
  return msgs
}

function recallFriendMsg(adapter, data, message_id) {
  Bot.makeLog('info', `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
  return recallMsg(adapter, data, i => data.bot.sdk.recallFriendMessage(data.user_id, i), message_id)
}

function recallGroupMsg(adapter, data, message_id) {
  Bot.makeLog('info', `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
  return recallMsg(adapter, data, i => data.bot.sdk.recallGroupMessage(data.group_id, i), message_id)
}

function recallDirectMsg(adapter, data, message_id, hide = config.hideGuildRecall) {
  Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道私聊消息：[${data.guild_id}] ${message_id}`, data.self_id)
  return recallMsg(adapter, data, i => data.bot.sdk.recallDirectMessage(data.guild_id, i, hide), message_id)
}

function recallGuildMsg(adapter, data, message_id, hide = config.hideGuildRecall) {
  Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道消息：[${data.channel_id}] ${message_id}`, data.self_id)
  return recallMsg(adapter, data, i => data.bot.sdk.recallGuildMessage(data.channel_id, i, hide), message_id)
}

export function installFile(adapter) {
  adapter._parseFileSegment = (i, data) => _parseFileSegment(adapter, i, data)
  adapter.recallMessageById = (data, message_id, target_type, target_id) => recallMessageById(adapter, data, message_id, target_type, target_id)
  adapter.uploadFileToQQ = (data, target_id, target_type, file_data, file_name, force_chunk) => uploadFileToQQ(adapter, data, target_id, target_type, file_data, file_name, force_chunk)
  adapter.sendFileMessage = (data, target_id, target_type, fileInfo) => sendFileMessage(adapter, data, target_id, target_type, fileInfo)
  adapter.sendFiles = (data, files) => sendFiles(adapter, data, files)
  adapter.recallMsg = (data, recall, message_id) => recallMsg(adapter, data, recall, message_id)
  adapter.recallFriendMsg = (data, message_id) => recallFriendMsg(adapter, data, message_id)
  adapter.recallGroupMsg = (data, message_id) => recallGroupMsg(adapter, data, message_id)
  adapter.recallDirectMsg = (data, message_id, hide) => recallDirectMsg(adapter, data, message_id, hide)
  adapter.recallGuildMsg = (data, message_id, hide) => recallGuildMsg(adapter, data, message_id, hide)
  adapter.extractFileNameFromUrl = (url) => extractFileNameFromUrl(adapter, url)
}
