import { put, list, del } from '@vercel/blob'

export async function getManifest(uid) {
  const { blobs } = await list({ prefix: `${uid}/manifest.json` })
  if (blobs && blobs.length > 0) {
    const exact = blobs.find(b => b.pathname === `${uid}/manifest.json`) || blobs[blobs.length - 1]
    const res = await fetch(exact.url)
    if (res.ok) return await res.json()
  }
  return { user: uid, username: 'Unknown', latest: null, total: 0, remote_wipe_status: false, files: [] }
}

export async function saveManifest(uid, manifest) {
  await put(`${uid}/manifest.json`, JSON.stringify(manifest, null, 2), { access: 'public', addRandomSuffix: false })
}

export async function listFiles(uid) {
  const { blobs } = await list({ prefix: `${uid}/` })
  return blobs.filter(b => b.pathname.endsWith('.enc')).map(b => ({ name: b.pathname.split('/').pop(), url: b.url }))
}

export async function updateProfile(uid, patch) {
  const current = await getManifest(uid)
  if (!current.user) {
    throw new Error('not_found')
  }
  const next = { ...current }
  if (typeof patch.username === 'string' && patch.username.trim().length > 0) next.username = patch.username.trim()
  if (typeof patch.profile_picture_url === 'string') next.profile_picture_url = patch.profile_picture_url
  if (typeof patch.recent_profile_picture_url === 'string') next.recent_profile_picture_url = patch.recent_profile_picture_url
  if (typeof patch.device_key_hash === 'string') next.device_key_hash = patch.device_key_hash
  next.last_updated_password_file = next.latest || null
  await saveManifest(uid, next)
  return next
}

export async function updateAfterUpload(uid, username, fileName, url) {
  const current = await getManifest(uid)
  const files = await listFiles(uid)
  files.sort((a,b)=>a.name.localeCompare(b.name))
  const latest = fileName || (files.length>0 ? files[files.length-1].name : null)
  const total = files.length
  const wipe = current.remote_wipe_status || false
  const finalUsername = username !== 'Unknown' ? username : (current.username || 'Unknown')
  const detailed = files.map(f => {
    const tsStr = f.name.replace('backup_', '').replace('.enc', '')
    let dateStr = 'Unknown Date'
    const n = parseInt(tsStr)
    if (!isNaN(n)) dateStr = new Date(n).toLocaleString()
    return { name: f.name, url: f.url, timestamp: dateStr, raw_ts: tsStr }
  })
  const manifest = { user: uid, username: finalUsername, latest, total, remote_wipe_status: wipe, files: detailed }
  await saveManifest(uid, manifest)
  return manifest
}

export async function wipeAll(uid) {
  const { blobs } = await list({ prefix: `${uid}/` })
  for (const b of blobs) {
    if (b.pathname !== `${uid}/manifest.json`) await del(b.url)
  }
}
