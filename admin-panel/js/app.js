const API_BASE = (window.API_BASE || '').replace(/\/$/, '')
const dbg = document.getElementById('debugLog')
function logLine(t){ if(!dbg) return; const d=document.createElement('div'); d.textContent=String(t); dbg.appendChild(d); dbg.scrollTop = dbg.scrollHeight }
async function sha256Hex(msg){const enc=new TextEncoder();const data=enc.encode(msg);const hash=await crypto.subtle.digest('SHA-256',data);const arr=Array.from(new Uint8Array(hash));return arr.map(b=>('0'+b.toString(16)).slice(-2)).join('')}
function setText(id,t){document.getElementById(id).textContent=t}
function setLink(id,href,text){const a=document.getElementById(id);a.href=href;a.textContent=text}

let currentUid = null;
let currentWipeStatus = false;

async function login(){
    const btn=document.getElementById('verify');
    const status=document.getElementById('status');
    btn.disabled=true;
    status.textContent='Verifying...';
    status.className='';
    
    const username=document.getElementById('username').value.trim();
    const key=document.getElementById('key').value.trim();
    logLine('verify_click')
    logLine('api_base=' + API_BASE)
    
    if(!username || !key){
        status.textContent='Enter username and key';
        status.className='err';
        btn.disabled=false;
        return;
    }

    try{
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, recoveryKey: key })
        });
        logLine('login_status=' + res.status)

        if(!res.ok){
            if (res.status === 404) {
                 status.textContent = 'Account not found (Check Key)';
            } else if (res.status === 401) {
                 status.textContent = 'Username incorrect';
            } else {
                 status.textContent = 'Verification failed';
            }
            status.className='err';
            btn.disabled=false;
            return;
        }

        const data = await res.json();
        currentUid = data.uid;
        const manifest = data.manifest;
        logLine('uid=' + currentUid)
        logLine('files=' + (manifest.files ? manifest.files.length : 0))

        status.textContent='Verified';
        status.className='ok';
        document.getElementById('data').style.display='block';
        
        updateUI(manifest);

    }catch(e){
        logLine('error=' + (e && e.message ? e.message : 'unknown'))
        console.error(e);
        status.textContent='Error connecting to server';
        status.className='err';
    }
    btn.disabled=false;
}

function updateUI(manifest){
    currentWipeStatus = manifest.remote_wipe_status;
    setText('wipe', String(currentWipeStatus));
    setText('total', String(manifest.total));
    
    const latestFile = manifest.latest || (manifest.files.length > 0 ? manifest.files[manifest.files.length-1].name : '');
    if(latestFile){
        // Check if the manifest file object has a direct URL (for Blob), otherwise construct download link
        const fileObj = manifest.files.find(f => f.name === latestFile);
        const latestUrl = (fileObj && fileObj.url) 
             ? fileObj.url 
             : `${API_BASE}/api/download?uid=${currentUid}&name=${latestFile}`;
             
        setLink('latest', latestUrl, latestFile);
        
        // ADD DEEP LINK BUTTON
        const deepLink = `ciphervault://import?uid=${currentUid}&url=${encodeURIComponent(latestUrl)}&name=${latestFile}`;
        const container = document.getElementById('latest').parentNode;
        
        // Remove existing deep link button if any to avoid duplicates on re-render
        const existingBtn = document.getElementById('deepLinkBtn');
        if(existingBtn) existingBtn.remove();
        
        const btn = document.createElement('a');
        btn.id = 'deepLinkBtn';
        btn.href = deepLink;
        btn.textContent = "Direct Import to App";
        btn.style.marginLeft = "10px";
        btn.style.padding = "4px 8px";
        btn.style.background = "#4f46e5";
        btn.style.color = "white";
        btn.style.textDecoration = "none";
        btn.style.borderRadius = "4px";
        btn.style.fontSize = "0.9em";
        container.appendChild(btn);
        
        logLine('latest=' + latestFile)
    } else {
        setText('latest', 'None');
    }

    const wipeBtn = document.getElementById('wipeBtn');
    if(currentWipeStatus){
        wipeBtn.textContent = "Cancel Wipe";
        wipeBtn.style.background = "#16a34a"; // Green to cancel
    } else {
        wipeBtn.textContent = "Wipe Data";
        wipeBtn.style.background = "#ef4444"; // Red to wipe
    }

    const list = document.getElementById('fileList');
    list.innerHTML = '';
    if(manifest.files && manifest.files.length > 0){
        manifest.files.forEach(f => {
            const li = document.createElement('li');
            li.style.marginBottom = '4px';
            li.style.padding = '8px';
            li.style.background = '#f1f5f9';
            li.style.borderRadius = '8px';
            
            const nameSpan = document.createElement('span');
            nameSpan.style.fontWeight = 'bold';
            nameSpan.textContent = f.name;
            
            const timeSpan = document.createElement('span');
            timeSpan.style.marginLeft = '12px';
            timeSpan.style.color = '#64748b';
            timeSpan.textContent = f.timestamp || f.name;

            const link = document.createElement('a');
            // Use f.url if available (Blob), otherwise use download endpoint
            link.href = f.url ? f.url : `${API_BASE}/api/download?uid=${currentUid}&name=${f.name}`;
            link.textContent = 'Download';
            link.style.float = 'right';
            link.style.color = '#4f46e5';
            link.style.textDecoration = 'none';

            li.appendChild(nameSpan);
            li.appendChild(timeSpan);
            li.appendChild(link);
            list.appendChild(li);
        });
    }
}

async function toggleWipe(){
    if(!currentUid) return;
    const newStatus = !currentWipeStatus;
    const btn = document.getElementById('wipeBtn');
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/wipe`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uid: currentUid, status: newStatus })
        });
        
        if(res.ok){
            const data = await res.json();
            currentWipeStatus = data.remote_wipe_status;
            setText('wipe', String(currentWipeStatus));
            if(currentWipeStatus){
                btn.textContent = "Cancel Wipe";
                btn.style.background = "#16a34a";
            } else {
                btn.textContent = "Wipe Data";
                btn.style.background = "#ef4444";
            }
        } else {
            alert('Failed to update wipe status');
        }
    } catch(e) {
        console.error(e);
        alert('Error updating wipe status');
    }
    btn.disabled = false;
}

document.getElementById('verify').addEventListener('click', login);
document.getElementById('wipeBtn').addEventListener('click', toggleWipe);
async function uploadBackup(){
  const username=document.getElementById('username').value.trim();
  const key=document.getElementById('key').value.trim();
  const fileInput=document.getElementById('uploadFile');
  const f=fileInput && fileInput.files && fileInput.files[0];
  if(!username||!key||!f){
    logLine('error=Enter username, key, and pick .enc file')
    return
  }
  const uid=await sha256Hex(key)
  const ts=Date.now().toString()
  logLine('upload_start uid='+uid)
  try{
    const res=await fetch(`${API_BASE}/upload?uid=${uid}`,{
      method:'POST',
      headers:{'Content-Type':'application/octet-stream','X-Username':username,'X-Timestamp':ts},
      body:f
    })
    logLine('upload_status='+res.status)
    if(res.ok){
      await login()
    }
  }catch(e){
    logLine('error='+(e&&e.message?e.message:'unknown'))
  }
}
document.getElementById('uploadBtn').addEventListener('click', uploadBackup)
async function exportCsv(){
  try{
    const username=document.getElementById('username').value.trim();
    const key=document.getElementById('key').value.trim();
    if(!username||!key){ alert('Enter username and key first'); return }
    const uid=await sha256Hex(key)
    const url=`${API_BASE}/api/export?uid=${uid}`
    const res=await fetch(url)
    if(!res.ok){ alert('Export failed'); return }
    const blob=await res.blob()
    const a=document.createElement('a')
    a.href=URL.createObjectURL(blob)
    a.download=`cv_export_${uid.slice(0,8)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }catch(e){ alert('Export error') }
}
document.getElementById('exportCsv').addEventListener('click', exportCsv)
