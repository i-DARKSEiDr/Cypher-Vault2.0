# Cypher-Vault2.0
Cypher-Vault2.0 Admin Panel.

CSV Export
- Endpoint: GET /api/export?uid=<SHA256(device_key)>
- Returns: text/csv with profile row and file list
- Admin panel adds "Export CSV" button after login

Profile Backup/Restore
- Upload encrypted backup: POST /upload?uid=<uid> with headers X-Username, X-Timestamp, X-Filename
- Profile metadata update: POST /api/profile { uid, username, deviceKey?, profilePictureUrl?, recentProfilePictureUrl? }
- Profile picture upload: POST /api/uploadPic?uid=<uid> body=image; updates manifest URLs
- Login/restore: POST /api/login { username, recoveryKey } returns manifest with latest file and Blob URL

Manifest Fields
- user, username, latest, total, remote_wipe_status, files[]
- device_key_hash (SHA-256), profile_picture_url, recent_profile_picture_url, last_updated_password_file

Deployment
- Vercel project with Node 24.x, @vercel/blob configured; push to GitHub triggers redeploy
