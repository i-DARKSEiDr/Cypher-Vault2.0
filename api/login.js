import crypto from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { username, recoveryKey } = req.body || {}
  if (!username || !recoveryKey) return res.status(400).json({ error: 'missing_fields' })
  const enc = new TextEncoder()
  const data = enc.encode(String(recoveryKey))
  const hash = await crypto.webcrypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(hash)).map(b => ('0'+b.toString(16)).slice(-2)).join('')
  const uid = hex
  const { getManifest, saveManifest } = await import('../utils/manifest.js')
  let manifest = await getManifest(uid)
  if (!manifest.user) {
    manifest = { user: uid, username: username || 'Unknown', latest: null, total: 0, remote_wipe_status: false, files: [] }
    await saveManifest(uid, manifest)
  }
  const stored = manifest.username || 'Unknown'
  if (stored === 'Unknown' || stored.toLowerCase() === String(username).trim().toLowerCase()) {
    res.json({ ok: true, uid, manifest })
  } else {
    res.status(401).json({ error: 'invalid_credentials' })
  }
}
