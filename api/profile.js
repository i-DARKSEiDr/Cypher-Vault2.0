import crypto from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { uid, username, deviceKey, profilePictureUrl, recentProfilePictureUrl } = req.body || {}
  const id = String(uid || '')
  if (!id || id.length !== 64) return res.status(400).json({ error: 'invalid_uid' })
  try {
    const { updateProfile } = await import('../utils/manifest.js')
    const device_key_hash = deviceKey ? await (async () => {
      const enc = new TextEncoder();
      const data = enc.encode(String(deviceKey));
      const buf = await (crypto.webcrypto?.subtle ?? globalThis.crypto?.subtle).digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => ('0'+b.toString(16)).slice(-2)).join('')
    })() : undefined
    const updated = await updateProfile(id, {
      username,
      profile_picture_url: profilePictureUrl,
      recent_profile_picture_url: recentProfilePictureUrl,
      device_key_hash
    })
    res.json({ ok: true, manifest: updated })
  } catch (e) {
    if (e && e.message === 'not_found') return res.status(404).json({ error: 'not_found' })
    res.status(500).json({ error: 'update_failed' })
  }
}
