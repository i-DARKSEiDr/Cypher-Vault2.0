export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const ok = !!process.env.BLOB_READ_WRITE_TOKEN
  res.json({ ok: true, hasBlobToken: ok })
}
