"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QQBot = void 0;
const axios_1 = __importDefault(require("axios"));
const formdata_node_1 = require("formdata-node");
const log4js = __importStar(require("log4js"));
const events_1 = require("events");
const sessionManager_1 = require("./sessionManager");
const event_1 = require("./event");
const utils_1 = require("./utils");
class QQBot extends events_1.EventEmitter {
    constructor(config) {
        var _a;
        super();
        this.config = config;
        this.sessionManager = new sessionManager_1.SessionManager(this);
        this.baseUrl = `${((config) => {
          if (config?.ApiUrl?.startsWith('http')) {
             return config.ApiUrl
          } else if (config?.sendbox) {
             return 'https://sandbox.api.sgroup.qq.com'
          } else {
             return 'https://api.sgroup.qq.com'
          }
        })(config)}`;
        this.request = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: config.timeout || 5000,
            headers: {
                'User-Agent': `BotNodeSDK/0.0.1`
            }
        });
        this.request.interceptors.request.use((config) => {
            config.headers['Authorization'] = `QQBot ${this.sessionManager.access_token}`;
            config.headers['X-Union-Appid'] = this.config.appid;
            if (config['rest']) {
                const restObj = config['rest'];
                delete config['rest'];
                for (const key in restObj) {
                    config.url = config.url.replace(':' + key, restObj[key]);
                }
            }
            if (config.headers['Content-Type'] === 'multipart/form-data') {
                delete config.data.message_reference;
                const formData = new formdata_node_1.FormData();
                for (const key in config.data)
                    if (config.data[key] !== undefined)
                        formData.set(key, config.data[key]);
                config.data = formData;
            }
            return config;
        });
        this.request.interceptors.response.use((res) => res, (res) => {
            if (!res || !res.response || !res.response.data)
                return Promise.reject(res);
            const { code = res?.response.status, message = res?.response.statusText, data } = res?.response?.data || {};
            if ([304023, 304024].includes(code)) {
                this.logger.warn(message);
                return Promise.resolve(res.response.data);
            }
            const err = new Error(`request "${res.config.url}" error with code(${code}): ${message}`);
            return Promise.reject(err);
        });
        this.logger = log4js.getLogger(`[QQBot:${this.config.appid}]`);
        this.logger.level = (_a = this.config).logLevel || (_a.logLevel = 'info');
    }
    removeAt(payload) {
        if (this.config.removeAt === false)
            return;
        const reg = new RegExp(`<@!${this.self_id}>`);
        const isAtMe = reg.test(payload.content) && payload.mentions.some((mention) => mention.id === this.self_id);
        if (!isAtMe)
            return;
        payload.content = payload.content.replace(reg, '').trimStart();
    }
    processPayload(event_id, event, payload) {
        let [post_type, ...sub_type] = event.split('.');
        const result = {
            event_id,
            post_type,
            [`${post_type}_type`]: sub_type.join('.'),
            ...payload
        };
        const parser = event_1.EventParserMap.get(event);
        if (!parser) {
            this.logger.warn('unhandled event', event);
            return result;
        }
        return parser.apply(this, [event, result]);
    }
    dispatchEvent(event, wsRes) {
        this.logger.debug(event, wsRes);
        const payload = wsRes.d;
        const event_id = wsRes.id || '';
        if (!payload || !event)
            return;
        const transformEvent = event_1.QQEvent[event] || 'system';
        try {
            const result = this.processPayload(event_id, transformEvent, payload);
            if (!result)
                return this.logger.debug('解析事件失败', wsRes);
            this.em(transformEvent, result);
        }
        catch (error) {
            return this.logger.debug('解析事件失败', wsRes);
        }
    }
    /**
     * 上传多媒体文件
     * @param target_id 接受者id
     * @param target_type  接受者类型：user|group
     * @param file_data 文件数据：可以是本地文件(file://)或网络地址(http://)或base64或Buffer
     * @param file_type 数据类型：1 image;2 video; 3 audio; 4 file
     * @returns
     */
    async uploadMedia(target_id, target_type, file_data, file_type, decode = false) {
        // 获取文件Buffer
        let fileBuffer;
        if (file_data instanceof Uint8Array) {
            fileBuffer = Buffer.from(file_data);
        } else if (Buffer.isBuffer(file_data)) {
            fileBuffer = file_data;
        } else if (file_data.startsWith('http')) {
            const res = await (0, utils_1.getBase64FromWeb)(file_data);
            fileBuffer = Buffer.from(res, 'base64');
        } else if (file_data.startsWith('base64://')) {
            fileBuffer = Buffer.from(file_data.replace('base64://', ''), 'base64');
        } else {
            try {
                const res = await (0, utils_1.getBase64FromLocal)(file_data);
                fileBuffer = Buffer.from(res, 'base64');
            } catch {
                fileBuffer = Buffer.from(file_data);
            }
        }

        // 计算文件信息
        const file_size = fileBuffer.length;
        const md5 = (0, utils_1.md5)(fileBuffer);
        const sha1 = require('crypto').createHash('sha1').update(fileBuffer).digest('hex');
        const md5_10m = (0, utils_1.md5)(fileBuffer.slice(0, Math.min(10 * 1024 * 1024, file_size)));
        
        // 生成文件名
        let file_name = '';
        let file_ext = '';
        
        // 1. 尝试从文件路径或URL中获取文件名
        if (typeof file_data === 'string') {
            if (file_data.startsWith('file://')) {
                // 本地文件
                const path = require('path');
                const localPath = file_data.replace('file://', '');
                const baseName = path.basename(localPath);
                if (baseName) {
                    file_name = baseName;
                    file_ext = path.extname(baseName);
                }
            } else if (file_data.startsWith('http')) {
                // 网络链接
                try {
                    const url = new URL(file_data);
                    const pathname = url.pathname;
                    const baseName = pathname.split('/').pop();
                    if (baseName && baseName.includes('.')) {
                        file_name = baseName;
                        file_ext = baseName.substring(baseName.lastIndexOf('.'));
                    }
                } catch {}
            } else if (file_data.startsWith('base64://')) {
                // base64 数据，无法直接获取文件名
            } else {
                // 可能是本地文件路径
                try {
                    const path = require('path');
                    const baseName = path.basename(file_data);
                    if (baseName) {
                        file_name = baseName;
                        file_ext = path.extname(baseName);
                    }
                } catch {}
            }
        }
        
        // 2. 如果没有获取到文件名，根据文件内容识别类型
        if (!file_ext) {
            // 检查文件头，识别常见文件类型
            const fileTypeMap = {
                // 图片类型
                '89504E47': '.png',    // PNG
                '47494638': '.gif',    // GIF
                'FFD8FF': '.jpg',      // JPEG
                '25504446': '.pdf',    // PDF
                // 音频类型
                '494433': '.mp3',      // MP3
                '52494646': '.wav',    // WAV
                // 视频类型
                '00000018': '.mp4',    // MP4
                '3026B2758E66CF11': '.wmv', // WMV
                // 文档类型
                'D0CF11E0': '.doc',     // DOC
                '504B0304': '.zip',     // ZIP
                '7B22': '.json',        // JSON
                // 文本类型
                'EFBBBF': '.txt',       // UTF-8 文本
                'FFFE': '.txt',         // UTF-16 LE 文本
                'FEFF': '.txt'          // UTF-16 BE 文本
            };
            
            // 获取文件头的十六进制表示
            const header = fileBuffer.toString('hex', 0, 16).toUpperCase();
            
            // 尝试匹配文件类型
            for (const [signature, ext] of Object.entries(fileTypeMap)) {
                if (header.startsWith(signature)) {
                    file_ext = ext;
                    break;
                }
            }
        }
        
        // 3. 生成最终文件名
        if (!file_name) {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(36).substr(2, 6);
            file_name = `up_${timestamp}_${random}${file_ext}`;
        }
        
        // 4. 确保文件名长度合理
        if (file_name.length > 50) {
            const path = require('path');
            const ext = path.extname(file_name);
            const nameWithoutExt = file_name.substring(0, file_name.lastIndexOf('.'));
            const shortName = nameWithoutExt.substring(0, 30) + '...';
            file_name = shortName + ext;
        }

        try {
            // 1. 调用 upload_prepare
            const { data: prepareResult } = await this.request.post(`/v2/${target_type}s/${target_id}/upload_prepare`, {
                file_type,
                file_name,
                file_size,
                md5,
                sha1,
                md5_10m
            });

            const { upload_id, parts } = prepareResult;

            // 2. 用返回的 presigned_url 执行 PUT
            for (const part of parts) {
                const { index, presigned_url } = part;
                // 计算当前分片的范围
                const start = (index - 1) * prepareResult.block_size;
                const end = Math.min(start + prepareResult.block_size, file_size);
                const partBuffer = fileBuffer.slice(start, end);

                // 执行 PUT 请求
                await require('axios').put(presigned_url, partBuffer, {
                    headers: {
                        'Content-Type': 'application/octet-stream'
                    }
                });

                // 3. 调用 upload_part_finish
                await this.request.post(`/v2/${target_type}s/${target_id}/upload_part_finish`, {
                    upload_id,
                    part_index: index,
                    block_size: partBuffer.length,
                    md5: (0, utils_1.md5)(partBuffer)
                });
            }

            // 4. 最后调 /files 提交 upload_id
            const { data: filesResult } = await this.request.post(`/v2/${target_type}s/${target_id}/files`, {
                upload_id
            });

            if (!decode)
                return filesResult;
        } catch (error) {
            this.logger.error('分片上传失败:', error);
            // 失败时回退到原有的上传方式
            const base64Data = fileBuffer.toString('base64');
            const { data: result } = await this.request.post(`/v2/${target_type}s/${target_id}/files`, {
                file_type,
                file_data: base64Data,
                srv_send_msg: false,
            });
            if (!decode)
                return result;
        }
    }
    em(event, payload) {
        const eventNames = event.split('.');
        const [post_type, detail_type, ...sub_type] = eventNames;
        Object.assign(payload, {
            post_type,
            [`${post_type}_type`]: detail_type,
            sub_type: sub_type.join('.'),
            ...payload
        });
        let prefix = '';
        while (eventNames.length) {
            let fullEventName = `${prefix}.${eventNames.shift()}`;
            if (fullEventName.startsWith('.'))
                fullEventName = fullEventName.slice(1);
            this.emit(fullEventName, payload);
            prefix = fullEventName;
        }
    }
}
exports.QQBot = QQBot;
(function (QQBot) {
    function getFullTargetId(message) {
        switch (message.message_type) {
            case "private":
                return `private-${message.guild_id || message.user_id}`;
            case "group":
                return `group-${message.group_id}:${message.user_id}`;
            case "guild":
                return `guild-${message.channel_id}:${message.user_id}`;
        }
    }
    QQBot.getFullTargetId = getFullTargetId;
})(QQBot || (exports.QQBot = QQBot = {}));
