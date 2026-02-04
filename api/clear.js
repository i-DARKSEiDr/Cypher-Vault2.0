import { list, del } from '@vercel/blob'

export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 })

  if (!process.env.BLOB_READ_WRITE_TOKEN) return new Response(JSON.stringify({ error: 'blob_token_missing' }), { status: 500 })

  const bypassHeader = req.headers.get('X-Bypass-Token')
  const bypassEnv = process.env.BYPASS_TOKEN
  if (typeof bypassEnv === 'string' && bypassEnv.length > 0) {
    if (bypassHeader !== bypassEnv) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { uid, all } = body || {}

  try {
    if (all) {
      const { blobs } = await list()
      let deleted = 0
      for (const b of blobs) {
        try { await del(b.pathname); deleted++ } catch (_) {}
      }
      return new Response(JSON.stringify({ ok: true, scope: 'all', deleted, total: blobs.length }), { status: 200 })
    }

    if (!uid || typeof uid !== 'string' || uid.length !== 64) {
      return new Response(JSON.stringify({ error: 'invalid_uid' }), { status: 400 })
    }
    const { blobs } = await list({ prefix: `${uid}/` })
    let deleted = 0
    for (const b of blobs) {
      try { await del(b.pathname); deleted++ } catch (_) {}
    }
    return new Response(JSON.stringify({ ok: true, scope: 'user', uid, deleted, total: blobs.length }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })
  }
}

