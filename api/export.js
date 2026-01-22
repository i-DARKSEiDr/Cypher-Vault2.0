export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const uid = String(req.query.uid || '')
  if (!uid || uid.length !== 64) return res.status(400).json({ error: 'invalid_uid' })
  const { getManifest, listFiles } = await import('../utils/manifest.js')
  try {
    const m = await getManifest(uid)
    if (!m.user) return res.status(404).json({ error: 'not_found' })
    const files = await listFiles(uid)
    const lines = []
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"'
    lines.push(["user","username","latest","total","remote_wipe_status","device_key_hash","profile_picture_url","recent_profile_picture_url"].map(esc).join(','))
    lines.push([
      m.user || '',
      m.username || 'Unknown',
      m.latest || '',
      m.total || 0,
      !!m.remote_wipe_status,
      m.device_key_hash || '',
      m.profile_picture_url || '',
      m.recent_profile_picture_url || ''
    ].map(esc).join(','))
    lines.push('')
    lines.push(["name","timestamp","raw_ts","url"].map(esc).join(','))
    const detailed = (m.files && Array.isArray(m.files) && m.files.length>0) ? m.files : files.map(f => ({ name: f.name, url: f.url, timestamp: '', raw_ts: '' }))
    for (const f of detailed) {
      lines.push([
        f.name || '',
        f.timestamp || '',
        f.raw_ts || '',
        f.url || ''
      ].map(esc).join(','))
    }
    const csv = lines.join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="cv_export_${uid.slice(0,8)}.csv"`)
    res.status(200).send(csv)
  } catch (e) {
    res.status(500).json({ error: 'export_failed' })
  }
}
