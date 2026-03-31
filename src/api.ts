/** ACME API client for XCP Tools */

const API_BASE = '/api'

interface ApiResponse<T> {
  result: T
  error?: string
}

export interface UploadResult {
  arweave_txid: string
  url: string
  size_bytes: number
  content_type: string
}

/** Upload file to Arweave via ACME backend */
export async function uploadToArweave(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('content_type', file.type || 'application/octet-stream')

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/arweave/upload`)

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText) as ApiResponse<UploadResult>
          if (resp.result) resolve(resp.result)
          else reject(new Error(resp.error || 'Upload failed'))
        } catch { reject(new Error('Invalid response')) }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || `Upload failed (${xhr.status})`))
        } catch { reject(new Error(`Upload failed (${xhr.status})`)) }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.timeout = 30 * 60 * 1000
    xhr.send(formData)
  })
}

/** Check if a TX is in the mempool or confirmed */
export async function checkPayment(txid: string, address: string, amountSats: number): Promise<boolean> {
  try {
    const resp = await fetch(`https://mempool.space/api/address/${address}/txs`)
    if (!resp.ok) return false
    const txs = await resp.json()
    for (const tx of txs) {
      if (tx.txid === txid) {
        // Check outputs for correct amount to our address
        for (const vout of tx.vout) {
          if (vout.scriptpubkey_address === address && vout.value >= amountSats) {
            return true
          }
        }
      }
    }
    return false
  } catch {
    return false
  }
}

/** Poll mempool for a payment to address of at least amountSats */
export async function waitForPayment(
  address: string,
  amountSats: number,
  onStatus?: (msg: string) => void,
  maxWaitMs = 10 * 60 * 1000,
): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    onStatus?.('Waiting for payment...')
    try {
      const resp = await fetch(`https://mempool.space/api/address/${address}/txs/mempool`)
      if (resp.ok) {
        const txs = await resp.json()
        for (const tx of txs) {
          for (const vout of tx.vout) {
            if (vout.scriptpubkey_address === address && vout.value >= amountSats) {
              return tx.txid
            }
          }
        }
      }
      // Also check confirmed
      const resp2 = await fetch(`https://mempool.space/api/address/${address}/txs`)
      if (resp2.ok) {
        const txs2 = await resp2.json()
        for (const tx of txs2.slice(0, 5)) {
          for (const vout of tx.vout) {
            if (vout.scriptpubkey_address === address && vout.value >= amountSats) {
              return tx.txid
            }
          }
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 5000))
  }
  return null
}
