import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { put, list, del } from '@vercel/blob'
import 'dotenv/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: true }))
app.use(express.json()) // For JSON bodies

const isVercel = !!process.env.VERCEL
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN
const DATA_DIR = path.resolve(__dirname, 'data')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const PANEL_DIR = path.resolve(__dirname, 'admin-panel')
app.use(express.static(PANEL_DIR))
app.use('/uploads', express.static(DATA_DIR))

// Fallback route to serve index.html for client-side routing
app.get('/', (req, res) => {
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

// Helper: Get Manifest
async function getManifest(uid) {
    if (USE_BLOB) {
        try {
            // List files to find manifest.json
            const { blobs } = await list({ prefix: `${uid}/manifest.json`, limit: 1 })
            if (blobs.length > 0) {
                const response = await fetch(blobs[0].url)
                if (response.ok) return await response.json()
            }
            return {} // Default empty
        } catch (e) {
            console.error("Blob getManifest error", e)
            return {}
        }
    } else {
        const dir = path.join(DATA_DIR, uid)
        const manifestPath = path.join(dir, 'manifest.json')
        if (fs.existsSync(manifestPath)) {
            return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        }
        return {}
    }
}

// Helper: Save Manifest
async function saveManifest(uid, manifest) {
    if (USE_BLOB) {
        try {
            // Overwrite manifest.json
            await put(`${uid}/manifest.json`, JSON.stringify(manifest, null, 2), {
                access: 'public',
                addRandomSuffix: false // Ensure we overwrite
            })
            return true
        } catch (e) {
            console.error("Blob saveManifest error", e)
            return false
        }
    } else {
        const dir = ensureUserDir(uid)
        const manifestPath = path.join(dir, 'manifest.json')
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
        return true
    }
}

// Helper: Update Manifest Logic (Shared)
async function updateManifestLogic(uid, username, newFileBlob = null) {
    try {
        const currentManifest = await getManifest(uid)
        
        let filesList = []
        
        if (USE_BLOB) {
            // List all .enc files in the folder
            const { blobs } = await list({ prefix: `${uid}/backup_` })
            filesList = blobs.filter(b => b.pathname.endsWith('.enc')).map(b => {
                // pathname: uid/backup_TS.enc
                const name = path.basename(b.pathname)
                return { name, url: b.url }
            })
        } else {
            const dir = ensureUserDir(uid)
            const files = fs.readdirSync(dir).filter(n => n.endsWith('.enc'))
            filesList = files.map(n => ({ name: n, url: `/uploads/${uid}/${n}` }))
        }

        filesList.sort((a, b) => a.name.localeCompare(b.name)) // Sort by name (timestamp)

        const latest = filesList.at(-1)?.name || null
        const total = filesList.length
        
        const wipeStatus = currentManifest.remote_wipe_status || false
        const finalUsername = username !== 'Unknown' ? username : (currentManifest.username || 'Unknown')

        const detailedList = filesList.map(f => {
            let tsStr = f.name.replace('backup_', '').replace('.enc', '')
            let dateStr = "Unknown Date"
            try {
                const ts = parseInt(tsStr)
                if (!isNaN(ts)) dateStr = new Date(ts).toLocaleString()
            } catch {}
            
            return { 
                name: f.name,
                url: f.url,
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
            files: detailedList
        }
        
        await saveManifest(uid, manifest)
        return wipeStatus
    } catch (e) {
        console.error("Manifest logic error", e)
        return false
    }
}


// Upload Handler (Unified)
app.post('/upload', async (req, res) => {
    const uid = req.query.uid
    if (!uid || uid.length !== 64) {
        return res.status(400).json({ error: 'invalid_uid' })
    }

    const username = req.get('X-Username') || 'Unknown'
    const ts = req.get('X-Timestamp') || Date.now().toString()
    const filename = `backup_${ts}.enc`

    try {
        if (USE_BLOB) {
            // Upload to Blob
            await put(`${uid}/${filename}`, req, { access: 'public' })
            const status = await updateManifestLogic(uid, username)
            res.json({ ok: true, remote_wipe_status: status })
        } else {
            // Upload to Disk
            const dir = ensureUserDir(uid)
            const filePath = path.join(dir, filename)
            const stream = fs.createWriteStream(filePath)
            
            req.pipe(stream)
            
            stream.on('finish', async () => {
                const status = await updateManifestLogic(uid, username)
                res.json({ ok: true, remote_wipe_status: status })
            })
            
            stream.on('error', (err) => {
                console.error(err)
                res.status(500).json({ error: 'write_failed' })
            })
        }
    } catch (e) {
        console.error("Upload error", e)
        res.status(500).json({ error: 'upload_failed' })
    }
})

// Login Handler (Task 1)
app.post('/api/login', async (req, res) => {
    const { username, recoveryKey } = req.body
    if (!username || !recoveryKey) return res.status(400).json({ error: 'missing_fields' })

    const uid = sha256(recoveryKey)

    try {
        const manifest = await getManifest(uid)
        
        if (!manifest.user) { // Check if manifest exists/valid
            return res.status(404).json({ error: 'user_not_found' })
        }
        
        console.log(`Login attempt for UID: ${uid.substring(0, 8)}...`)

        const storedUsername = manifest.username || 'Unknown'

        // Case-insensitive check
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

// Remote Wipe Toggle (Task 3)
app.post('/api/wipe', async (req, res) => {
    const { uid, status } = req.body
    if (!uid) return res.status(400).json({ error: 'missing_uid' })

    try {
        const manifest = await getManifest(uid)
        if (!manifest.user) return res.status(404).json({ error: 'not_found' })

        manifest.remote_wipe_status = !!status
        await saveManifest(uid, manifest)
        
        res.json({ ok: true, remote_wipe_status: manifest.remote_wipe_status })
    } catch (e) {
        res.status(500).json({ error: 'update_failed' })
    }
})

// Vercel Blob Upload Handler (Direct)
app.post('/api/blob/upload', async (req, res) => {
    const filename = req.query.filename || 'blob.txt'
    
    // Check if token exists
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.warn('Missing BLOB_READ_WRITE_TOKEN environment variable')
        // We continue, as it might fail inside 'put' or user might have it set elsewhere
    }

    try {
        // req is a stream in Express
        const blob = await put(filename, req, {
            access: 'public',
        })
        res.json(blob)
    } catch (error) {
        console.error('Blob upload failed:', error)
        res.status(500).json({ error: error.message })
    }
})

// Export for Vercel serverless, run locally with app.listen
const port = process.env.PORT || 8080
if (!isVercel) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`)
  })
}

export default app
