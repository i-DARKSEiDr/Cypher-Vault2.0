import crypto from 'crypto';
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { uid } = req.query;

  if (!uid) {
    return res.status(400).json({ error: 'missing_user_id' });
  }

  try {
    // List all backup files for user
    const userPrefix = `${uid}/`;
    const blobs = await list({ prefix: userPrefix });

    if (!blobs.blobs || blobs.blobs.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Filter backup files and sort by upload time
    const backups = blobs.blobs
      .filter(blob => blob.pathname.endsWith('.enc'))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    if (backups.length === 0) {
      return res.status(404).json({ error: 'no_backups_found' });
    }

    // Get latest backup
    const latestFile = backups[0];
    const latestFileName = latestFile.pathname.split('/').pop();

    // Build manifest response
    const manifest = {
      ok: true,
      user: uid,
      latest: latestFileName,
      total: backups.length,
      remote_wipe_status: false,
      files: backups.map((blob) => ({
        name: blob.pathname.split('/').pop(),
        timestamp: new Date(blob.uploadedAt).toISOString(),
        size: blob.size,
        url: blob.downloadUrl
      }))
    };

    res.status(200).json(manifest);
  } catch (error) {
    console.error('Manifest error:', error);
    res.status(500).json({ error: 'internal_error', reason: error.message });
  }
}
