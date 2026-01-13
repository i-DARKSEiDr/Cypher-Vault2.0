import crypto from 'crypto';
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { uid } = req.query;
  const filename = req.headers['x-filename'] || `backup_${Date.now()}.enc`;

  if (!uid) {
    return res.status(400).json({ error: 'missing_user_id' });
  }

  try {
    // Validate HMAC signature
    const timestamp = req.headers['x-timestamp'];
    const bodySha = req.headers['x-body-sha256'];
    const signature = req.headers['x-signature'];
    const recoveryKey = req.headers['x-recovery-key'];

    if (!timestamp || !bodySha || !signature) {
      return res.status(401).json({ error: 'missing_auth_headers' });
    }

    // Verify user ID
    const expectedUser = crypto.createHash('sha256').update(recoveryKey).digest('hex');
    if (uid !== expectedUser) {
      return res.status(401).json({ error: 'user_id_mismatch' });
    }

    // Get request body as buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Verify HMAC
    const mac = crypto.createHmac('sha256', recoveryKey);
    const msg = `${uid}|${timestamp}|${bodySha}`;
    mac.update(msg);
    const expectedSig = mac.digest('hex');

    if (signature !== expectedSig) {
      return res.status(401).json({ error: 'signature_mismatch' });
    }

    // Upload to Vercel Blob
    const blobPath = `${uid}/${filename}`;
    const blob = await put(blobPath, body, {
      access: 'public',
      contentType: 'application/octet-stream'
    });

    res.status(200).json({
      ok: true,
      name: filename,
      url: blob.url,
      size: body.length
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'internal_error', reason: error.message });
  }
}
