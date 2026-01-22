const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { put, list, del } = require('@vercel/blob')
const fetch = (global.fetch) ? global.fetch : require('undici').fetch

const isVercel = !!process.env.VERCEL
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN
const DATA_DIR = isVercel ? path.resolve('/tmp/data') : path.resolve(__dirname, 'data')

try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) } catch (e) {}

const app = express()
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: true }))
app.use(express.json())

// Static admin panel assets
const PANEL_DIR = path.resolve(__dirname, 'admin-panel')
app.use(express.static(PANEL_DIR))
if (!isVercel) {
  app.use('/uploads', express.static(DATA_DIR))
}

process.on('uncaughtException', (err) => { try { console.error('uncaught', err && err.stack ? err.stack : err) } catch (e) {} })
process.on('unhandledRejection', (err) => { try { console.error('unhandled', err && err.stack ? err.stack : err) } catch (e) {} })

function ensureUserDir(user) {
  const dir = path.join(DATA_DIR, user)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

async function getManifest(uid) {
  if (USE_BLOB) {
    try {
      const { blobs } = await list({ prefix: `${uid}/manifest.json` })
      if (blobs && blobs.length > 0) {
        const exact = blobs.find(b => b.pathname === `${uid}/manifest.json`) || blobs[blobs.length - 1]
        const response = await fetch(exact.url)
        if (response.ok) return await response.json()
      }
      return {}
    } catch (e) {
      return {}
    }
  } else {
    const dir = path.join(DATA_DIR, uid)
    const manifestPath = path.join(dir, 'manifest.json')
    if (fs.existsSync(manifestPath)) return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return {}
  }
}

async function saveManifest(uid, manifest) {
  if (USE_BLOB) {
    try {
      try {
        const { blobs } = await list({ prefix: `${uid}/manifest.json` })
        for (const b of blobs) {
          if (b.pathname !== `${uid}/manifest.json`) {
            try { await del(b.url) } catch (e) {}
          }
        }
      } catch (e) {}
      await put(`${uid}/manifest.json`, JSON.stringify(manifest, null, 2), { access: 'public', addRandomSuffix: false })
      return true
    } catch (e) {
      return false
    }
  } else {
    const dir = ensureUserDir(uid)
    const manifestPath = path.join(dir, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return true
  }
}

async function updateManifestLogic(uid, username, newFileBlob = null) {
  try {
    const current = await getManifest(uid)
    let filesList = []
    if (USE_BLOB) {
      const { blobs } = await list({ prefix: `${uid}/` })
      filesList = blobs.filter(b => b.pathname.endsWith('.enc')).map(b => {
        const name = path.basename(b.pathname)
        return { name, url: b.url }
      })
    } else {
      const dir = ensureUserDir(uid)
      const files = fs.readdirSync(dir).filter(n => n.endsWith('.enc'))
      filesList = files.map(n => ({ name: n, url: `/uploads/${uid}/${n}` }))
    }
    filesList.sort((a, b) => a.name.localeCompare(b.name))
    let latest = filesList.length > 0 ? filesList[filesList.length - 1].name : null
    if (newFileBlob && newFileBlob.pathname) {
      try { latest = path.basename(newFileBlob.pathname) } catch (e) {}
    }
    const total = filesList.length
    const wipeStatus = current.remote_wipe_status || false
    const finalUsername = username !== 'Unknown' ? username : (current.username || 'Unknown')
    const detailedList = filesList.map(f => {
      let tsStr = f.name.replace('backup_', '').replace('.enc', '')
      let dateStr = 'Unknown Date'
      try {
        const ts = parseInt(tsStr)
        if (!isNaN(ts)) dateStr = new Date(ts).toLocaleString()
      } catch (e) {}
      return { name: f.name, url: f.url, timestamp: dateStr, raw_ts: tsStr }
    })
    const manifest = { user: uid, username: finalUsername, latest, total, remote_wipe_status: wipeStatus, files: detailedList }
    if (current.settings) manifest.settings = current.settings
    await saveManifest(uid, manifest)
    return wipeStatus
  } catch (e) {
    return false
  }
}

app.get('/health', (req, res) => {
  try { res.json({ ok: true, node: process.version, hasBlob: !!process.env.BLOB_READ_WRITE_TOKEN }) } catch (e) { res.status(500).json({ ok: false }) }
})

app.get('/api/env', (req, res) => {
  try { res.json({ ok: true, isVercel, USE_BLOB, hasToken: !!process.env.BLOB_READ_WRITE_TOKEN, node: process.version }) }
  catch (e) { res.status(500).json({ ok: false }) }
})

app.get('/favicon.ico', (req, res) => { try { res.status(204).end() } catch (e) { res.status(204).end() } })

app.get('/api/selftest', async (req, res) => {
  try {
    const tok = !!process.env.BLOB_READ_WRITE_TOKEN
    res.json({ ok: true, node: process.version, hasBlobToken: tok })
  } catch (e) { res.status(500).json({ ok: false }) }
})

app.post('/upload', async (req, res) => {
  if (isVercel && !USE_BLOB) return res.status(500).json({ error: 'blob_token_missing' })
  const uid = req.query.uid
  if (!uid || uid.length !== 64) return res.status(400).json({ error: 'invalid_uid' })
  const username = req.get('X-Username') || 'Unknown'
  const ts = req.get('X-Timestamp') || Date.now().toString()
  const requestedName = (req.get('X-Filename') || '').toString().trim()
  const base = requestedName.length > 0 ? requestedName : `backup_${ts}.enc`
  const cleaned = base.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
  const safeName = cleaned.toLowerCase().endsWith('.enc') ? cleaned : `${cleaned}.enc`
  try {
    console.log(`[upload] uid=${uid} name=${safeName} blob=${USE_BLOB ? 'vercel-blob' : 'disk'}`)
    if (USE_BLOB) {
      const blob = await put(`${uid}/${safeName}`, req, { access: 'public', addRandomSuffix: false })
      const status = await updateManifestLogic(uid, username, { pathname: `${uid}/${safeName}`, url: blob.url })
      console.log(`[upload] done uid=${uid} name=${safeName} ok=true url=${blob.url}`)
      res.json({ ok: true, name: safeName, remote_wipe_status: status })
    } else {
      const dir = ensureUserDir(uid)
      const filePath = path.join(dir, safeName)
      const stream = fs.createWriteStream(filePath)
      req.pipe(stream)
      stream.on('finish', async () => {
        const status = await updateManifestLogic(uid, username, { pathname: `${uid}/${safeName}`, url: `/uploads/${uid}/${safeName}` })
        console.log(`[upload] done uid=${uid} name=${safeName} ok=true path=${filePath}`)
        res.json({ ok: true, name: safeName, remote_wipe_status: status })
      })
      stream.on('error', (err) => {
        console.error(err)
        console.log(`[upload] fail uid=${uid} name=${safeName}`)
        res.status(500).json({ error: 'write_failed' })
      })
    }
  } catch (e) {
    const reason = (e && e.message) ? e.message : 'unknown'
    console.log(`[upload] fail uid=${uid} name=${safeName} reason=${reason}`)
    res.status(500).json({ error: 'upload_failed', reason })
  }
})

app.post('/api/login', async (req, res) => {
  const { username, recoveryKey } = req.body
  if (!username || !recoveryKey) return res.status(400).json({ error: 'missing_fields' })
  const uid = sha256(recoveryKey)
  try {
    let manifest = await getManifest(uid)
    if (!manifest.user) {
      manifest = { user: uid, username: username || 'Unknown', latest: null, total: 0, remote_wipe_status: false, files: [] }
      await saveManifest(uid, manifest)
    }
    const storedUsername = manifest.username || 'Unknown'
    if (storedUsername === 'Unknown' || storedUsername.toLowerCase() === username.trim().toLowerCase()) {
      res.setHeader('Set-Cookie', `cv_session=${uid}; Path=/; HttpOnly; SameSite=Lax`)
      res.json({ ok: true, uid, manifest })
    } else {
      res.status(401).json({ error: 'invalid_credentials' })
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error' })
  }
})

app.post('/api/settings/update', async (req, res) => {
  const { uid, settings } = req.body || {}
  if (!uid || !settings) return res.status(400).json({ error: 'missing_fields' })
  try {
    const m = await getManifest(uid)
    if (!m.user) return res.status(404).json({ error: 'not_found' })
    m.settings = settings
    await saveManifest(uid, m)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})

app.get('/api/settings', async (req, res) => {
  const uid = req.query.uid
  if (!uid) return res.status(400).json({ error: 'missing_uid' })
  try {
    const m = await getManifest(uid)
    if (!m.user) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, settings: m.settings || {} })
  } catch (e) { res.status(500).json({ error: 'server_error' }) }
})

app.get('/api/manifest', async (req, res) => {
  const uid = req.query.uid
  if (!uid) return res.status(400).json({ error: 'missing_uid' })
  try {
    const manifest = await getManifest(uid)
    if (!manifest.user) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, manifest })
  } catch (e) { res.status(500).json({ error: 'server_error' }) }
})

app.get('/api/download', async (req, res) => {
  const uid = req.query.uid
  const name = req.query.name
  if (!uid || !name) return res.status(400).json({ error: 'missing_params' })
  try {
    if (USE_BLOB) {
      const { blobs } = await list({ prefix: `${uid}/${name}`, limit: 1 })
      if (blobs.length === 0) return res.status(404).json({ error: 'file_not_found' })
      const response = await fetch(blobs[0].url)
      if (!response.ok) return res.status(502).json({ error: 'blob_fetch_failed' })
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      const body = response.body
      if (body && typeof Readable.fromWeb === 'function') {
        Readable.fromWeb(body).pipe(res)
      } else if (body && body.pipe) {
        body.pipe(res)
      } else {
        res.status(500).json({ error: 'stream_not_supported' })
      }
    } else {
      const filePath = path.join(DATA_DIR, uid, name)
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' })
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
      fs.createReadStream(filePath).pipe(res)
    }
  } catch (e) { res.status(500).json({ error: 'server_error' }) }
})

app.post('/api/wipe/request', async (req, res) => {
  const { uid } = req.body || {}
  if (!uid) return res.status(400).json({ error: 'missing_uid' })
  try {
    const m = await getManifest(uid)
    if (!m.user) return res.status(404).json({ error: 'not_found' })
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    m.pending_wipe_code = code
    m.pending_wipe_at = Date.now()
    await saveManifest(uid, m)
    res.json({ ok: true, code })
  } catch (e) { res.status(500).json({ error: 'server_error' }) }
})

app.post('/api/wipe/confirm', async (req, res) => {
  const { uid, code } = req.body || {}
  if (!uid || !code) return res.status(400).json({ error: 'missing_fields' })
  try {
    const m = await getManifest(uid)
    if (!m.user) return res.status(404).json({ error: 'not_found' })
    const valid = m.pending_wipe_code && m.pending_wipe_code === code && Math.abs(Date.now() - (m.pending_wipe_at || 0)) < 5 * 60 * 1000
    if (!valid) return res.status(400).json({ error: 'invalid_code' })
    if (USE_BLOB) {
      const { blobs } = await list({ prefix: `${uid}/` })
      for (const b of blobs) { await del(b.url) }
    } else {
      const dir = path.join(DATA_DIR, uid)
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
        for (const f of files) { try { fs.unlinkSync(path.join(dir, f)) } catch (e) {} }
        try { fs.rmdirSync(dir) } catch (e) {}
      }
    }
    const post = { user: uid, username: m.username || 'Unknown', latest: null, total: 0, remote_wipe_status: true, files: [] }
    await saveManifest(uid, post)
    res.json({ ok: true, remote_wipe_status: true })
  } catch (e) { res.status(500).json({ error: 'server_error' }) }
})

app.get('/', (req, res) => {
  const indexPath = path.join(PANEL_DIR, 'index.html')
  try {
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath)
  } catch (e) {}
  res.json({ ok: true })
})

const port = process.env.PORT || 8080
if (!isVercel) { app.listen(port, '0.0.0.0', () => {}) }

module.exports = (req, res) => app(req, res)
