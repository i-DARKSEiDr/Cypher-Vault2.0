import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: true }))
app.use(express.json()) // For JSON bodies

const DATA_DIR = path.resolve(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const PANEL_DIR = path.resolve(__dirname, 'admin-panel')

// Serve static files from admin-panel directory
app.use(express.static(PANEL_DIR))
app.use('/uploads', express.static(DATA_DIR))

// Serve index.html for any non-API route (for client-side routing)
app.get('*', (req, res, next) => {
  // Skip API routes and static file requests
  if (req.path.startsWith('/api') || 
      req.path.startsWith('/uploads') ||
      req.path.includes('.')) {
    return next()
  }
  
  const indexPath = path.join(PANEL_DIR, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).json({ error: 'Admin panel not found' })
  }
})

function ensureUserDir(user) {
  const dir = path.join(DATA_DIR, user)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

// Upload Handler
app.post('/upload', (req, res) => {
  const uid = req.query.uid
  if (!uid || uid.length !== 64) {
    return res.status(400).json({ error: 'invalid_uid' })
  }

  const username = req.get('X-Username') || 'Unknown'
  const ts = req.get('X-Timestamp') || Date.now().toString()
  const dir = ensureUserDir(uid)
  const filename = `backup_${ts}.enc`
  const filePath = path.join(dir, filename)

  const stream = fs.createWriteStream(filePath)
  req.pipe(stream)

  stream.on('finish', () => {
    const status = updateManifest(uid, dir, username)
    res.json({ ok: true, remote_wipe_status: status })
  })

  stream.on('error', (err) => {
    console.error(err)
    res.status(500).json({ error: 'write_failed' })
  })
})

// Login Handler (Task 1)
app.post('/api/login', (req, res) => {
  const { username, recoveryKey } = req.body
  if (!username || !recoveryKey) return res.status(400).json({ error: 'missing_fields' })

  const uid = sha256(recoveryKey)
  const dir = path.join(DATA_DIR, uid)
  const manifestPath = path.join(dir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'user_not_found' })
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    
    console.log(`Login attempt for UID: ${uid.substring(0, 8)}...`)
    console.log(`Provided username: '${username}'`)
    console.log(`Stored username: '${manifest.username}'`)

    const storedUsername = manifest.username || 'Unknown'

    // Case-insensitive check for username, OR if stored is Unknown (first login before new backup)
    if (storedUsername === 'Unknown' || storedUsername.toLowerCase() === username.trim().toLowerCase()) {
      res.json({ ok: true, uid: uid, manifest: manifest })
    } else {
      console.log("Username mismatch")
      res.status(401).json({ error: 'invalid_credentials' })
    }
  } catch (e) {
    console.error("Login error", e)
    res.status(500).json({ error: 'server_error' })
  }
})

// Get manifest (for admin panel)
app.get('/api/manifest', (req, res) => {
  const uid = req.query.uid
  if (!uid || uid.length !== 64) {
    return res.status(400).json({ error: 'invalid_uid' })
  }

  const dir = path.join(DATA_DIR, uid)
  const manifestPath = path.join(dir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'user_not_found' })
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    res.json({ ok: true, manifest })
  } catch (e) {
    res.status(500).json({ error: 'server_error' })
  }
})

// Remote Wipe Toggle (Task 3)
app.post('/api/wipe', (req, res) => {
  const { uid, status } = req.body
  if (!uid) return res.status(400).json({ error: 'missing_uid' })

  const dir = path.join(DATA_DIR, uid)
  const manifestPath = path.join(dir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'not_found' })

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.remote_wipe_status = !!status
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    res.json({ ok: true, remote_wipe_status: manifest.remote_wipe_status })
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    ok: true, 
    status: 'Server is running',
    timestamp: new Date().toISOString()
  })
})

function updateManifest(uid, dir, username) {
  try {
    const manifestPath = path.join(dir, 'manifest.json')
    let currentManifest = {}
    if (fs.existsSync(manifestPath)) {
      try { currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
    }

    const files = fs.readdirSync(dir).filter(n => n.endsWith('.enc')).sort()
    const latest = files.at(-1) || null
    const total = files.length
    
    // Preserve existing wipe status, default to false
    const wipeStatus = currentManifest.remote_wipe_status || false
    
    // Use new username if provided, else keep existing
    const finalUsername = username !== 'Unknown' ? username : (currentManifest.username || 'Unknown')

    const fileList = files.map(n => {
      let tsStr = n.replace('backup_', '').replace('.enc', '')
      let dateStr = "Unknown Date"
      try {
        const ts = parseInt(tsStr)
        if (!isNaN(ts)) {
          dateStr = new Date(ts).toLocaleString()
        }
      } catch {}
      
      return { 
        name: n,
        timestamp: dateStr,
        raw_ts: tsStr
      }
    })

    const manifest = {
      user: uid,
      username: finalUsername,
      latest: latest,
      total: total,
      remote_wipe_status: wipeStatus,
      files: fileList,
      updated: new Date().toISOString()
    }
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return wipeStatus
  } catch (e) {
    console.error("Manifest update failed", e)
    return false
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

const port = process.env.PORT || 8080
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`)
  console.log(`Admin panel served from: ${PANEL_DIR}`)
  console.log(`Data directory: ${DATA_DIR}`)
})
