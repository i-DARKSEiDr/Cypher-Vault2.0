export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const uid = String(req.query.uid || '')
  if (!uid) return res.status(400).json({ error: 'missing_uid' })
  const { getManifest } = await import('../utils/manifest.js')
  const m = await getManifest(uid)
  if (!m.user) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true, manifest: m })
}
