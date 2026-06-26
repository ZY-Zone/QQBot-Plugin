import _ from 'lodash'

export function pickImageSizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false

  const source = options.data && typeof options.data === 'object' && !Array.isArray(options.data)
    ? { ...options.data, ...options }
    : options

  const result = {}
  for (const key of ['width', 'height', 'scale']) {
    const value = Number(source[key])
    if (Number.isFinite(value) && value > 0) result[key] = value
  }
  return Object.keys(result).length ? result : false
}

export function patchSegmentImageSizeOptions() {
  const segment = globalThis.segment
  if (!segment || typeof segment.image !== 'function' || segment.image.__qqbotImageSizePatched) return

  const originImage = segment.image
  const patchedImage = function (file, options, ...args) {
    const sizeOptions = pickImageSizeOptions(options)
    const image = sizeOptions
      ? originImage.call(this, file, ...args)
      : originImage.call(this, file, options, ...args)

    if (sizeOptions && image && typeof image === 'object') {
      if (image.data && typeof image.data === 'object' && !Array.isArray(image.data)) {
        Object.assign(image.data, sizeOptions)
      } else {
        Object.assign(image, sizeOptions)
      }
    }

    return image
  }

  Object.defineProperty(patchedImage, '__qqbotImageSizePatched', { value: true })
  segment.image = patchedImage
}

export function patchSegmentFile() {
  const segment = globalThis.segment
  if (!segment || typeof segment.file !== 'function') return

  const originalSegmentFile = segment.file.bind(segment)
  segment.file = function (file, name, forceChunk, recallTime) {
    let result
    if (typeof file === 'object' && file !== null && !Buffer.isBuffer(file)) {
      result = originalSegmentFile(file)
      if (typeof file.force_chunk !== 'undefined') result.force_chunk = file.force_chunk
      if (typeof file.recall_time !== 'undefined') result.recall_time = file.recall_time
    } else {
      result = originalSegmentFile(file, name)
      result.name = name
      if (typeof forceChunk !== 'undefined') result.force_chunk = forceChunk
      if (typeof recallTime !== 'undefined') result.recall_time = recallTime
    }
    return result
  }
}

export function convertURL(url) {
  if (url == null) return '';
  const urlStr = String(url);
  const parts = urlStr.split('://');
  if (parts.length === 1) return urlStr.toUpperCase();
  const protocol = parts[0].toLowerCase();
  const rest = parts.slice(1).join('://');
  const [hostPart, remaining = ''] = rest.split(/[/?#]/);
  const separatorIndex = rest.indexOf(hostPart) + hostPart.length;
  return (
    protocol + '://' +
    hostPart.toUpperCase() +
    rest.slice(separatorIndex)
  );
}

export function extractFileNameFromUrl(url) {
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
