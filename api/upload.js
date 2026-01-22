import { put } from '@vercel/blob'
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const uid = String(req.query.uid || '')
  if (!uid || uid.length !== 64) return res.status(400).json({ error: 'invalid_uid' })
  const username = String(req.headers['x-username'] || 'Unknown')
  const ts = String(req.headers['x-timestamp'] || Date.now().toString())
  const requested = String(req.headers['x-filename'] || '').trim()
  const base = requested.length > 0 ? requested : `backup_${ts}.enc`
  const cleaned = base.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
  const safeName = cleaned.toLowerCase().endsWith('.enc') ? cleaned : `${cleaned}.enc`
  const blob = await put(`${uid}/${safeName}`, req, { access: 'public', addRandomSuffix: false })
  const { updateAfterUpload } = await import('../utils/manifest.js')
  const manifest = await updateAfterUpload(uid, username, safeName, blob.url)
  res.json({ ok: true, name: safeName, remote_wipe_status: manifest.remote_wipe_status })
}
