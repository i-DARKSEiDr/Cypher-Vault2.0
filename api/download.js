import { get } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { uid, name } = req.query;

  if (!uid || !name) {
    return res.status(400).json({ error: 'missing_parameters' });
  }

  try {
    // Construct blob path
    const blobPath = `${uid}/${name}`;

    // Get blob from Vercel storage
    const blob = await get(blobPath);

    if (!blob) {
      return res.status(404).json({ error: 'backup_not_found' });
    }

    // Stream the backup file to client
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', blob.size);

    res.status(200).send(blob);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'internal_error', reason: error.message });
  }
}
