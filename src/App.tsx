/**
 * XCP Tools — Arweave Mint & JSON Builder with BTC payment
 *
 * Cyberpunk-styled standalone app.
 * Flow: Connect wallet → Upload media → Build JSON → Pay 1984 sats → Reveal JSON URL
 */

import { useState, useCallback } from 'react'
import { uploadToArweave, waitForPayment, type UploadResult } from './api'
import { buildArioUrl, extForMimeType } from './arweave'
import './styles.css'

const PAYMENT_SATS = 1984
const PAYMENT_ADDRESS = 'bc1q0wv2d260yge8ravt7mqcjhvmu7wwp0de4yvt40'

interface MintedFile {
  name: string
  txid: string
  url: string
  ario_url: string
  content_type: string
}

type WalletType = 'unisat' | 'xverse' | null

export function App() {
  // Wallet
  const [walletType, setWalletType] = useState<WalletType>(null)
  const [address, setAddress] = useState<string | null>(null)

  // Upload
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [mintedFiles, setMintedFiles] = useState<MintedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)

  // JSON
  const [fields, setFields] = useState({
    asset: '', pgpsig: '', description: '', category: '', subcategory: '',
    image: '', image_large: '', image_large_hd: '', video: '', audio: '',
    twitter: '', website: '',
  })
  const [jsonString, setJsonString] = useState<string | null>(null)
  const [jsonMinted, setJsonMinted] = useState(false)
  const [jsonArioUrl, setJsonArioUrl] = useState<string | null>(null)

  // Payment
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'waiting' | 'paid' | 'error'>('idle')
  const [paymentTxid, setPaymentTxid] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // ── Wallet ──
  const connectUnisat = useCallback(async () => {
    const w = (window as any).unisat
    if (!w) { alert('UniSat wallet not found. Install the extension.'); return }
    try {
      const accounts = await w.requestAccounts()
      if (accounts.length) { setAddress(accounts[0]); setWalletType('unisat') }
    } catch (e: any) { alert('Connect failed: ' + (e.message || e)) }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null); setWalletType(null)
  }, [])

  // ── File Upload ──
  const handleFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => f.size <= 400 * 1024 * 1024)
    setQueuedFiles(prev => [...prev, ...valid])
  }, [])

  const uploadAll = useCallback(async () => {
    if (!queuedFiles.length) return
    setUploading(true); setUploadError(null)
    const toUpload = [...queuedFiles]
    for (let i = 0; i < toUpload.length; i++) {
      const f = toUpload[i]
      setUploadStatus(`Uploading ${f.name} (${i + 1}/${toUpload.length})...`)
      setUploadProgress(0)
      try {
        const result: UploadResult = await uploadToArweave(f, setUploadProgress)
        const ext = extForMimeType(result.content_type)
        const arioUrl = buildArioUrl(result.arweave_txid, ext || undefined)
        setMintedFiles(prev => [...prev, { name: f.name, txid: result.arweave_txid, url: result.url, ario_url: arioUrl, content_type: result.content_type }])
        setQueuedFiles(prev => prev.filter(x => x !== f))
      } catch (e: any) {
        setUploadError(e.message || 'Upload failed')
        setUploading(false); return
      }
    }
    setUploadStatus('All files uploaded!')
    setUploading(false)
  }, [queuedFiles])

  // ── JSON Builder ──
  const updateField = useCallback((k: string, v: string) => setFields(p => ({ ...p, [k]: v })), [])

  const generateJson = useCallback(() => {
    const obj: Record<string, string> = {}
    for (const [k, v] of Object.entries(fields)) { if (v.trim()) obj[k] = v.trim() }
    if (!Object.keys(obj).length) return
    setJsonString(JSON.stringify(obj, null, 2))
    setJsonMinted(false); setJsonArioUrl(null); setPaymentStatus('idle')
  }, [fields])

  // ── Mint JSON (upload to arweave) ──
  const mintJson = useCallback(async () => {
    if (!jsonString) return
    setUploadStatus('Minting JSON...')
    try {
      const blob = new File([jsonString], 'metadata.json', { type: 'application/json' })
      const result = await uploadToArweave(blob)
      const url = buildArioUrl(result.arweave_txid, 'json')
      setJsonArioUrl(url)
      setJsonMinted(true)
      setUploadStatus('JSON minted! Pay to reveal.')
    } catch (e: any) {
      setUploadError(e.message || 'Mint failed')
    }
  }, [jsonString])

  // ── Payment ──
  const initiatePayment = useCallback(async () => {
    if (!walletType || !address) { alert('Connect wallet first'); return }
    setPaymentStatus('waiting')
    try {
      if (walletType === 'unisat') {
        const w = (window as any).unisat
        const txid = await w.sendBitcoin(PAYMENT_ADDRESS, PAYMENT_SATS)
        if (txid) {
          setPaymentTxid(txid)
          setPaymentStatus('paid')
          return
        }
      }
      // Fallback: poll mempool
      const txid = await waitForPayment(PAYMENT_ADDRESS, PAYMENT_SATS, setUploadStatus)
      if (txid) {
        setPaymentTxid(txid)
        setPaymentStatus('paid')
      } else {
        setPaymentStatus('error')
        setUploadStatus('Payment not detected within timeout')
      }
    } catch (e: any) {
      // User might have rejected — still poll
      setUploadStatus('Waiting for payment in mempool...')
      const txid = await waitForPayment(PAYMENT_ADDRESS, PAYMENT_SATS, setUploadStatus, 5 * 60 * 1000)
      if (txid) { setPaymentTxid(txid); setPaymentStatus('paid') }
      else { setPaymentStatus('error'); setUploadStatus('Payment not detected') }
    }
  }, [walletType, address])

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }, [])

  return (
    <div className="container">
      <div className="header">
        <div className="header-rule" />
        <h1>ARWEAVE MINT & <span className="accent">XCP JSON</span> BUILDER</h1>
        <div className="sub">Upload media to Arweave &bull; Build asset JSON &bull; Pay 1984 sats &bull; Get permanent link</div>
        <div className="header-rule-bottom" />
      </div>

      {/* 1: UPLOAD MEDIA */}
      <Section num={1} title="Mint Media to Arweave">
        <div
          className="upload-zone"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)) }}
          onClick={() => document.getElementById('fileInput')?.click()}
        >
          <input id="fileInput" type="file" multiple accept="image/*,video/*,audio/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = '' }} />
          <div className="icon">&#x1F4BE;</div>
          <div className="label">Drop files here or <strong>click to browse</strong></div>
          <div className="formats">PNG &middot; JPG &middot; GIF &middot; MP4 &middot; WEBM &middot; MP3 &mdash; max 400MB</div>
        </div>

        {queuedFiles.length > 0 && (
          <div className="queued-files">
            {queuedFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} className="queued-file">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="fname">{f.name}</span>
                  <span className="fsize">{(f.size / 1024).toFixed(1)} KB</span>
                </div>
                <button className="remove-btn" onClick={() => setQueuedFiles(p => p.filter((_, j) => j !== i))}>&times;</button>
              </div>
            ))}
            <div className="actions">
              <button className="btn btn-magenta" onClick={uploadAll} disabled={uploading || !queuedFiles.length}>
                &#9654; {uploading ? `Uploading... ${uploadProgress}%` : `Mint ${queuedFiles.length} File(s)`}
              </button>
            </div>
          </div>
        )}

        {uploadError && <div className="status-msg error">{uploadError}</div>}
        {uploadStatus && !uploadError && <div className="status-msg">{uploadStatus}</div>}

        {mintedFiles.length > 0 && (
          <div className="minted-links">
            {mintedFiles.map((f, i) => (
              <div key={f.txid} className="minted-link">
                <div className="ml-icon">{f.content_type.startsWith('image') ? '🖼️' : f.content_type.startsWith('video') ? '🎬' : '🎵'}</div>
                <div className="ml-details">
                  <div className="ml-name">{f.name}</div>
                  <div className="ml-url">{f.ario_url}</div>
                  <div className="fill-buttons">
                    {f.content_type.startsWith('image') && (
                      <>
                        <button className="btn-fill" onClick={() => updateField('image', f.ario_url)}>→ Thumb</button>
                        <button className="btn-fill" onClick={() => updateField('image_large', f.ario_url)}>→ Image</button>
                        <button className="btn-fill" onClick={() => updateField('image_large_hd', f.ario_url)}>→ HiRes</button>
                      </>
                    )}
                    {f.content_type.startsWith('video') && <button className="btn-fill" onClick={() => updateField('video', f.ario_url)}>→ Video</button>}
                    {f.content_type.startsWith('audio') && <button className="btn-fill" onClick={() => updateField('audio', f.ario_url)}>→ Audio</button>}
                  </div>
                </div>
                <button className={`btn btn-cyan btn-sm${copied === `f-${i}` ? ' copied' : ''}`} onClick={() => copy(f.ario_url, `f-${i}`)}>
                  {copied === `f-${i}` ? 'COPIED!' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2: JSON BUILDER */}
      <Section num={2} title="Build Asset JSON">
        <div className="form-grid">
          <Field label="Asset Name" value={fields.asset} onChange={v => updateField('asset', v)} placeholder="e.g. MYTOKEN" />
          <Field label="Artist / PGPSIG" value={fields.pgpsig} onChange={v => updateField('pgpsig', v)} placeholder="Artist name" optional />
          <Field label="Description" value={fields.description} onChange={v => updateField('description', v)} placeholder="Text description" optional full textarea />
          <Field label="Category" value={fields.category} onChange={v => updateField('category', v)} optional select
            options={['', 'Art', 'Artist, Band or Public Figure', 'Brand or Product', 'Entertainment']} />
          <Field label="Subcategory" value={fields.subcategory} onChange={v => updateField('subcategory', v)} optional select
            options={['', 'NFT', 'Pepe', 'Artist', 'Musician / Band', 'Photographer', 'Fictional Character']} />
          <Field label="Thumbnail URL (48x48)" value={fields.image} onChange={v => updateField('image', v)} placeholder="https://...ar.io/..." optional full />
          <Field label="Large Image URL" value={fields.image_large} onChange={v => updateField('image_large', v)} placeholder="https://...ar.io/..." optional full />
          <Field label="HiRes Image URL" value={fields.image_large_hd} onChange={v => updateField('image_large_hd', v)} placeholder="https://...ar.io/..." optional full />
          <Field label="MP4 Video URL" value={fields.video} onChange={v => updateField('video', v)} placeholder="https://...ar.io/..." optional full />
          <Field label="MP3 Audio URL" value={fields.audio} onChange={v => updateField('audio', v)} placeholder="https://...ar.io/..." optional full />
          <Field label="Twitter / X" value={fields.twitter} onChange={v => updateField('twitter', v)} placeholder="https://x.com/..." optional />
          <Field label="Website" value={fields.website} onChange={v => updateField('website', v)} placeholder="https://..." optional />
        </div>
        <div className="actions">
          <button className="btn btn-cyan" onClick={generateJson}>Generate JSON</button>
          {jsonString && <button className={`btn btn-green btn-sm${copied === 'json' ? ' copied' : ''}`} onClick={() => copy(jsonString, 'json')}>{copied === 'json' ? 'COPIED!' : 'Copy JSON'}</button>}
        </div>
        {jsonString && <pre className="json-preview visible">{jsonString}</pre>}
      </Section>

      {/* 3: MINT JSON + PAY */}
      {jsonString && (
        <Section num={3} title="Mint JSON & Pay">
          {!jsonMinted ? (
            <div>
              <p className="hint">First, mint your JSON to Arweave (free). Then pay 1984 sats to reveal the permanent link.</p>
              <div className="actions">
                <button className="btn btn-magenta" onClick={mintJson}>&#9654; Mint JSON to Arweave</button>
              </div>
            </div>
          ) : paymentStatus !== 'paid' ? (
            <div>
              <p className="hint">JSON minted! Pay <strong className="yellow">1,984 sats</strong> to reveal your permanent link.</p>
              <div className="payment-box">
                <div className="payment-label">Send exactly:</div>
                <div className="payment-amount">{PAYMENT_SATS.toLocaleString()} sats</div>
                <div className="payment-label" style={{ marginTop: 12 }}>To address:</div>
                <div className="payment-addr" onClick={() => copy(PAYMENT_ADDRESS, 'addr')}>
                  {PAYMENT_ADDRESS}
                  {copied === 'addr' && <span className="copied-badge">COPIED</span>}
                </div>
              </div>
              <div className="actions">
                {address ? (
                  <button className="btn btn-green" onClick={initiatePayment} disabled={paymentStatus === 'waiting'}>
                    {paymentStatus === 'waiting' ? '⏳ Waiting for payment...' : '💰 Pay 1,984 sats'}
                  </button>
                ) : (
                  <p className="hint">Connect wallet above to pay, or send manually.</p>
                )}
              </div>
              {paymentStatus === 'error' && <div className="status-msg error">Payment not detected. Try again or send manually.</div>}
            </div>
          ) : (
            <div className="final-result visible">
              <div className="fr-label">&#10003; PAYMENT RECEIVED — JSON REVEALED</div>
              <div className="fr-url">{jsonArioUrl}</div>
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className={`btn btn-green${copied === 'final' ? ' copied' : ''}`} onClick={() => copy(jsonArioUrl!, 'final')}>
                  {copied === 'final' ? 'COPIED!' : 'Copy JSON Link'}
                </button>
              </div>
              <div className="fr-hint">Use this URL as your Counterparty / XCP token description</div>
              {paymentTxid && <div className="fr-txid">Payment TX: {paymentTxid.slice(0, 16)}...</div>}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-inner">
        <div className="section-label"><span className="num">{num}</span> {title}</div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, optional, full, textarea, select, options }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
  optional?: boolean; full?: boolean; textarea?: boolean; select?: boolean; options?: string[]
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label>{label} {optional && <span className="opt">(optional)</span>}</label>
      {select ? (
        <select value={value} onChange={e => onChange(e.target.value)}>
          {(options || []).map(o => <option key={o} value={o}>{o || '— None —'}</option>)}
        </select>
      ) : textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  )
}
