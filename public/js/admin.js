/* PegaFrete Admin Portal — Client Logic */

const firebaseConfig = {
    apiKey: "AIzaSyD7lL5jSj57oLL_wWJWbImUD2Y7TKk3gRI",
    authDomain: "pegafrete-logistica.firebaseapp.com",
    projectId: "pegafrete-logistica",
    storageBucket: "pegafrete-logistica.firebasestorage.app",
    messagingSenderId: "783503103566",
    appId: "1:783503103566:web:840c03b02cda1ba82c151f"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const API = `${window.location.origin}/api/admin`;

let activeSection = 'stats';
let pendingUsers = [];
let inspectedUser = null;

// === AUTH LIFECYCLE ===
document.addEventListener('DOMContentLoaded', () => {
    const isLogin = !window.location.pathname.includes('dashboard');

    auth.onAuthStateChanged(async user => {
        if (user) {
            try {
                const result = await user.getIdTokenResult(true);
                if (result.claims.admin === true) {
                    if (isLogin) { window.location.href = 'dashboard'; return; }
                    const el = document.getElementById('adminName');
                    if (el) el.innerText = user.email.split('@')[0];
                    switchSection(activeSection);
                } else {
                    showToast('Acesso negado. Sem privilégios de administrador.', 'error');
                    await auth.signOut();
                    if (!isLogin) setTimeout(() => window.location.href = '/', 2000);
                }
            } catch (e) {
                console.error(e);
                showToast('Erro ao validar sessão.', 'error');
            }
        } else if (!isLogin) {
            window.location.href = '/';
        }
    });
});

async function getHeaders() {
    const token = await auth.currentUser.getIdToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// === LOGIN ===
async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btnLogin');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Autenticando...';

    try {
        await auth.signInWithEmailAndPassword(
            document.getElementById('email').value.trim(),
            document.getElementById('password').value
        );
        showToast('Login efetuado! Verificando permissões...', 'info');
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = orig;
        const msgs = {
            'auth/wrong-password': 'Senha incorreta.',
            'auth/user-not-found': 'Usuário não encontrado.',
            'auth/invalid-credential': 'Credenciais inválidas.',
            'auth/too-many-requests': 'Muitas tentativas. Tente em breve.'
        };
        showToast(msgs[err.code] || 'Erro ao fazer login.', 'error');
    }
}

function logoutAdmin() { auth.signOut().then(() => window.location.href = '/'); }
function togglePass() {
    const p = document.getElementById('password'), i = document.getElementById('toggleIcon');
    p.type = p.type === 'password' ? 'text' : 'password';
    i.className = p.type === 'password' ? 'ph ph-eye' : 'ph ph-eye-slash';
}

// === NAVIGATION ===
function switchSection(id) {
    activeSection = id;
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
    });
    document.querySelectorAll('.dashboard-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`section-${id}`);
    if (target) target.classList.add('active');
    const titles = { stats:'Visão Geral', users:'Usuários', freights:'Fretes', documents:'Documentos', notifications:'Notificações', logs:'Logs de Segurança', setup:'Configurar Admin' };
    document.getElementById('sectionTitle').innerText = titles[id] || '';
    loadData(id);
    // Mobile: close sidebar
    document.getElementById('sidebar').classList.remove('active');
}

function refreshSection() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('ph-spin');
    loadData(activeSection).finally(() => setTimeout(() => icon.classList.remove('ph-spin'), 500));
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

async function loadData(id) {
    try {
        if (id === 'stats') await loadStats();
        else if (id === 'users') await loadUsers();
        else if (id === 'freights') await loadFreights();
        else if (id === 'documents') await loadPendingDocs();
        else if (id === 'notifications') await loadUsersDropdown();
        else if (id === 'logs') await loadLogs();
    } catch (e) { console.error(e); showToast('Erro de comunicação com a API.', 'error'); }
}

// === DATA LOADERS ===
async function loadStats() {
    const h = await getHeaders();
    const r = await fetch(`${API}/stats`, { headers: h });
    if (!r.ok) throw new Error();
    const d = await r.json();
    document.getElementById('statShippers').innerText = d.totalShippers;
    document.getElementById('statDrivers').innerText = d.totalDrivers;
    document.getElementById('statPending').innerText = d.pendingDocuments;
    document.getElementById('statFreights').innerText = d.totalFreights;
    document.getElementById('badgePending').innerText = d.pendingDocuments;
    document.getElementById('verifyCount').innerText = `${d.pendingDocuments} Pendentes`;
    document.getElementById('statTotal').innerText = d.totalShippers + d.totalDrivers;
}

async function loadUsers() {
    const h = await getHeaders();
    const role = document.getElementById('roleFilter')?.value || '';
    const url = role ? `${API}/users?role=${role}` : `${API}/users`;
    const r = await fetch(url, { headers: h });
    if (!r.ok) throw new Error();
    const users = await r.json();
    const tbody = document.getElementById('usersTableBody');
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6">Nenhum usuário encontrado.</td></tr>'; return; }
    tbody.innerHTML = users.map(u => {
        const init = u.name ? u.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : 'U';
        const roleLabel = u.role === 'driver' ? 'Motorista' : u.role === 'shipper' ? 'Embarcador' : 'Admin';
        const docBadge = u.documentStatus === 'verified' ? 'badge-green' : u.documentStatus === 'pending' ? 'badge-purple' : 'badge-orange';
        return `<tr>
            <td><div class="table-user"><div class="user-initials">${init}</div><div><span class="user-meta-name">${san(u.name)}</span><br><span style="font-size:11px;color:var(--text-m)">UID: ${u.uid.substring(0,10)}…</span></div></div></td>
            <td>${san(u.email)}</td><td>${san(u.phone||'—')}</td>
            <td><span class="badge-inline badge-orange">${roleLabel}</span></td>
            <td><span class="badge-inline ${docBadge}">${san(u.documentStatus||'N/A')}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="editUser('${u.uid}')"><i class="ph ph-pencil"></i></button></td>
        </tr>`;
    }).join('');
}

async function loadFreights() {
    const h = await getHeaders();
    const r = await fetch(`${API}/freights`, { headers: h });
    if (!r.ok) throw new Error();
    const freights = await r.json();
    const tbody = document.getElementById('freightsTableBody');
    if (!freights.length) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6">Nenhum frete encontrado.</td></tr>'; return; }
    tbody.innerHTML = freights.map(f => `<tr>
        <td>${san(f.origem)}</td><td>${san(f.destino)}</td><td>R$ ${san(f.valor)}</td>
        <td>${san(f.tipo)}</td><td>${san(f.veiculo)}</td>
        <td><span class="badge-inline ${f.status==='concluida'?'badge-green':'badge-orange'}">${san(f.status||'ativa')}</span></td>
        <td><button class="btn btn-secondary btn-sm" onclick="editFreight('${f.id}')"><i class="ph ph-pencil"></i></button></td>
    </tr>`).join('');
}

async function loadPendingDocs() {
    const h = await getHeaders();
    const r = await fetch(`${API}/documents/pending`, { headers: h });
    if (!r.ok) throw new Error();
    pendingUsers = await r.json();
    const tbody = document.getElementById('docsTableBody');
    if (!pendingUsers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6"><i class="ph ph-check-circle" style="font-size:32px;color:var(--success)"></i><p class="mt-2" style="font-weight:700">Nenhum documento pendente!</p></td></tr>';
        return;
    }
    tbody.innerHTML = pendingUsers.map(u => {
        const init = u.name ? u.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : 'U';
        return `<tr>
            <td><div class="table-user"><div class="user-initials">${init}</div><span class="user-meta-name">${san(u.name)}</span></div></td>
            <td>${san(u.email)}</td><td>${san(u.phone||'—')}</td><td>${san(u.address||'—')}</td>
            <td><span class="badge-inline badge-purple">${san(u.vehicle||'Doc')}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="inspectDoc('${u.uid}')">Analisar <i class="ph ph-magnifying-glass"></i></button></td>
        </tr>`;
    }).join('');
}

async function loadUsersDropdown() {
    const sel = document.getElementById('notifyTarget');
    sel.innerHTML = '<option value="all">Todos (Broadcast)</option><option disabled>── Usuário Específico ──</option>';
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/users`, { headers: h });
        if (!r.ok) return;
        const users = await r.json();
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.uid;
            opt.innerText = `${u.name||'Sem Nome'} (${u.role==='driver'?'Motorista':'Embarcador'})`;
            sel.appendChild(opt);
        });
    } catch (_) {}
}

async function loadLogs() {
    const h = await getHeaders();
    const r = await fetch(`${API}/logs`, { headers: h });
    if (!r.ok) throw new Error();
    const logs = await r.json();
    const tbody = document.getElementById('logsTableBody');
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6">Sem registros.</td></tr>'; return; }
    tbody.innerHTML = logs.map(l => {
        let dt = '—';
        if (l.timestamp) {
            const d = l.timestamp._seconds ? new Date(l.timestamp._seconds*1000) : new Date(l.timestamp);
            dt = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
        }
        return `<tr><td style="white-space:nowrap;color:var(--text-m)">${dt}</td><td style="font-family:monospace">${l.uid}</td><td><span class="log-event">${san(l.event)}</span></td><td>${san(l.details)}</td><td>${san(l.page||'API')}</td></tr>`;
    }).join('');
}

// === DOCUMENT VERIFICATION ===
function inspectDoc(uid) {
    const u = pendingUsers.find(x => x.uid === uid);
    if (!u) return;
    inspectedUser = u;
    document.getElementById('docName').innerText = u.name || '—';
    document.getElementById('docCpf').innerText = u.cpf || u.cnpj || '—';
    document.getElementById('docVehicle').innerText = u.vehicle || '—';
    const frame = document.getElementById('docFrame');
    if (u.documentsUrl || u.cnhUrl) {
        frame.innerHTML = `<img src="${u.documentsUrl||u.cnhUrl}" alt="Documento" onerror="this.parentElement.innerHTML='<div style=\\'padding:24px;text-align:center;color:var(--text-m)\\'>Não foi possível carregar.</div>'">`;
    } else {
        frame.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-m)"><i class="ph ph-image-square" style="font-size:64px"></i><p>Nenhum arquivo enviado.</p></div>';
    }
    toggleReject(false);
    document.getElementById('docModal').classList.add('active');
}
function closeDocModal() { document.getElementById('docModal').classList.remove('active'); inspectedUser = null; }
function toggleReject(show) { document.getElementById('rejectArea').style.display = show ? 'block' : 'none'; if (!show) document.getElementById('rejectReason').value = ''; }

async function verifyDoc(status) {
    if (!inspectedUser) return;
    const reason = document.getElementById('rejectReason').value.trim();
    if (status === 'rejected' && !reason) { showToast('Informe o motivo da rejeição.', 'error'); return; }
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/documents/verify`, { method: 'POST', headers: h, body: JSON.stringify({ uid: inspectedUser.uid, status, reason }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        closeDocModal();
        refreshSection();
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// === NOTIFICATIONS ===
async function handleSendNotification(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSendNotif'), orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Enviando...';
    try {
        const h = await getHeaders();
        const body = { targetUid: document.getElementById('notifyTarget').value, title: document.getElementById('notifyTitle').value.trim(), message: document.getElementById('notifyMessage').value.trim() };
        const r = await fetch(`${API}/notifications/send`, { method: 'POST', headers: h, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        document.getElementById('notifyTitle').value = '';
        document.getElementById('notifyMessage').value = '';
        // Add to local history
        const hist = document.getElementById('notifHistory');
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `<div class="history-icon"><i class="ph ph-paper-plane"></i></div><div class="history-content"><h4>${san(body.title)}</h4><p>${san(body.message)}</p><span class="history-date">Agora — ${body.targetUid==='all'?'Broadcast':'Privado'}</span></div>`;
        hist.insertBefore(item, hist.firstChild);
    } catch (e) { showToast('Falha: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
}

// === SETUP CLAIMS ===
async function handleSetupClaims(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSetup'), orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Processando...';
    try {
        const r = await fetch(`${window.location.origin}/api/admin/setup-claims`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: document.getElementById('setupUid').value.trim(), secret: document.getElementById('setupSecret').value })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        document.getElementById('setupUid').value = '';
        document.getElementById('setupSecret').value = '';
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
}

// === EDIT STUBS (prompt user via browser prompt for simplicity) ===
async function editUser(uid) {
    const field = prompt('Campo a editar (name, phone, address, role, documentStatus):');
    if (!field) return;
    const value = prompt(`Novo valor para "${field}":`);
    if (value === null) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/users/${uid}`, { method:'PUT', headers:h, body:JSON.stringify({[field]:value}) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        loadUsers();
    } catch (e) { showToast('Erro: '+e.message, 'error'); }
}

async function editFreight(id) {
    const field = prompt('Campo a editar (status, status_pagamento, pagamento_liberado, obs):');
    if (!field) return;
    const value = prompt(`Novo valor para "${field}":`);
    if (value === null) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/freights/${id}`, { method:'PUT', headers:h, body:JSON.stringify({[field]:value}) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        loadFreights();
    } catch (e) { showToast('Erro: '+e.message, 'error'); }
}

// === UTILS ===
function san(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;') : ''; }

function showToast(msg, type='success') {
    const t = document.getElementById('toast');
    const icons = { success:'<i class="ph-fill ph-check-circle" style="color:#22c55e;font-size:20px"></i>', error:'<i class="ph-fill ph-warning-circle" style="color:#ef4444;font-size:20px"></i>', info:'<i class="ph-fill ph-info" style="color:#3b82f6;font-size:20px"></i>' };
    t.innerHTML = `${icons[type]||icons.info} <span>${san(msg)}</span>`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4000);
}
