/** ar.io URL utilities */

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

function b64urlToBytes(s: string): Uint8Array {
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4) b += '='
  const d = atob(b)
  const a = new Uint8Array(d.length)
  for (let i = 0; i < d.length; i++) a[i] = d.charCodeAt(i)
  return a
}

function toB32(bytes: Uint8Array): string {
  let bits = ''
  for (let i = 0; i < bytes.length; i++) bits += bytes[i].toString(2).padStart(8, '0')
  let o = ''
  for (let i = 0; i < bits.length; i += 5) o += B32[parseInt(bits.substring(i, i + 5).padEnd(5, '0'), 2)]
  return o
}

export function buildArioUrl(txId: string, ext?: string): string {
  const sb = toB32(b64urlToBytes(txId))
  let u = `https://${sb}.ar.io/${txId}`
  if (ext) u += `?.${ext}`
  return u
}

export function extForMimeType(ct: string): string | null {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
    'audio/mpeg': 'mp3', 'application/json': 'json',
  }
  return map[ct] || null
}
