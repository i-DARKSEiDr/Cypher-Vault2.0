import { put } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const uid = String(req.query.uid || '')
  if (!uid || uid.length !== 64) return res.status(400).json({ error: 'invalid_uid' })
  const nameHint = String(req.headers['x-filename'] || '').trim()
  const base = nameHint.length > 0 ? nameHint : `profile_${Date.now()}.png`
  const cleaned = base.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
  const safeName = cleaned.toLowerCase().match(/\.(png|jpg|jpeg)$/) ? cleaned : `${cleaned}.png`
  try {
    const blob = await put(`${uid}/${safeName}`, req, { access: 'public', addRandomSuffix: false, contentType: 'image/png' })
    const { updateProfile } = await import('../utils/manifest.js')
    const manifest = await updateProfile(uid, { profile_picture_url: blob.url, recent_profile_picture_url: blob.url })
    res.json({ ok: true, url: blob.url, manifest })
  } catch (e) {
    res.status(500).json({ error: 'upload_failed' })
  }
}
