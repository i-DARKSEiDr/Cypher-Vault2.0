export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { uid, status } = req.body || {}
  if (!uid) return res.status(400).json({ error: 'missing_uid' })
  const { getManifest, saveManifest } = await import('../utils/manifest.js')
  const m = await getManifest(uid)
  if (!m.user) return res.status(404).json({ error: 'not_found' })
  m.remote_wipe_status = !!status
  await saveManifest(uid, m)
  res.json({ ok: true, remote_wipe_status: m.remote_wipe_status })
}
