export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const uid = String(req.query.uid || '')
  const name = String(req.query.name || '')
  if (!uid || !name) return res.status(400).json({ error: 'missing_params' })
  const { list } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: `${uid}/${name}`, limit: 1 })
  if (!blobs || blobs.length === 0) return res.status(404).json({ error: 'file_not_found' })
  const response = await fetch(blobs[0].url)
  if (!response.ok) return res.status(502).json({ error: 'blob_fetch_failed' })
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  const body = response.body
  if (body && typeof ReadableStream !== 'undefined') {
    const reader = body.getReader()
    const pump = async () => {
      const { done, value } = await reader.read()
      if (done) { res.end(); return }
      res.write(Buffer.from(value))
      await pump()
    }
    await pump()
  } else {
    res.status(500).json({ error: 'stream_not_supported' })
  }
}
