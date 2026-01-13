import crypto from 'crypto';
import { list, head } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { username, recoveryKey } = req.body;

  if (!recoveryKey) {
    return res.status(400).json({ error: 'missing_recovery_key' });
  }

  try {
    // Derive user ID from recovery key
    const user = crypto.createHash('sha256').update(recoveryKey).digest('hex');

    // List files in user directory
    const userPrefix = `${user}/`;
    const blobs = await list({ prefix: userPrefix });

    if (!blobs.blobs || blobs.blobs.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Find the latest backup file
    const backups = blobs.blobs
      .filter(blob => blob.pathname.endsWith('.enc'))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    if (backups.length === 0) {
      return res.status(404).json({ error: 'no_backup_found' });
    }

    const latestFile = backups[0];
    const latestFileName = latestFile.pathname.split('/').pop();

    // Build manifest
    const manifest = {
      ok: true,
      user,
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

    res.status(200).json({ ok: true, manifest });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'internal_error', reason: error.message });
  }
}
