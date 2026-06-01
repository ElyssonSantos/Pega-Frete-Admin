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

async function loginComGoogle() {
    const btn = document.getElementById('btnGoogle');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Conectando...';

    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
        showToast('Login efetuado! Verificando permissões...', 'info');
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = orig;
        if (err.code !== 'auth/popup-closed-by-user') {
            showToast('Erro ao entrar com Google.', 'error');
        }
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
        else if (id === 'settings') await loadSettings();
    } catch (e) { console.error(e); showToast(e.message || 'Erro de comunicação com a API.', 'error'); }
}

async function request(url, options = {}) {
    const r = await fetch(url, options);
    if (!r.ok) {
        let msg = 'Erro de comunicação com a API.';
        try {
            const d = await r.json();
            if (d && d.error) msg = d.error;
        } catch {}
        throw new Error(msg);
    }
    return r.json();
}

// === DATA LOADERS ===
async function loadStats() {
    const h = await getHeaders();
    const d = await request(`${API}/stats`, { headers: h });
    document.getElementById('statShippers').innerText = d.shippers || 0;
    document.getElementById('statDrivers').innerText = d.drivers || 0;
    document.getElementById('statPending').innerText = d.pendingDocs || 0;
    document.getElementById('statFreights').innerText = d.totalFreights || 0;
    document.getElementById('badgePending').innerText = d.pendingDocs || 0;
    document.getElementById('verifyCount').innerText = `${d.pendingDocs || 0} Pendentes`;
    document.getElementById('statTotal').innerText = (d.shippers || 0) + (d.drivers || 0);
}

async function loadUsers() {
    const h = await getHeaders();
    const role = document.getElementById('roleFilter')?.value || '';
    const url = role ? `${API}/users?role=${role}` : `${API}/users`;
    const resObj = await request(url, { headers: h });
    const users = resObj.users || [];
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

let currentFreights = [];
let selectedFreightId = null;

async function loadFreights() {
    const h = await getHeaders();
    const resObj = await request(`${API}/freights`, { headers: h });
    currentFreights = resObj.freights || [];
    selectedFreightId = null;
    renderFreightsList();
}

function renderFreightsList() {
    const container = document.getElementById('freightsListContainer');
    if (!container) return;
    
    if (!currentFreights.length) { 
        container.innerHTML = '<div class="text-center py-8 text-slate-500">Nenhum frete encontrado.</div>'; 
        return; 
    }
    
    container.innerHTML = currentFreights.map(f => {
        const isSelected = f.id === selectedFreightId;
        const borderClass = isSelected ? 'border-l-blue-600 bg-blue-50/50' : 'border-l-transparent hover:bg-slate-50';
        
        let statusColor = 'bg-yellow-100 text-yellow-700';
        let statusText = 'Pendente';
        if (f.status === 'concluida' || f.status === 'entregue') {
            statusColor = 'bg-green-100 text-green-700';
            statusText = 'Entregue';
        } else if (f.status === 'em_andamento') {
            statusColor = 'bg-blue-100 text-blue-700';
            statusText = 'Em Andamento';
        } else if (f.status === 'cancelada') {
            statusColor = 'bg-red-100 text-red-700';
            statusText = 'Cancelada';
        }

        const dateStr = f.createdAt ? new Date(f.createdAt).toLocaleDateString() : '';

        return `
            <div onclick="selectFreight('${f.id}')" class="p-4 border-b border-slate-50 cursor-pointer transition-colors border-l-4 ${borderClass}">
              <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-bold ${isSelected ? 'text-blue-700' : 'text-slate-500'} uppercase">${san(f.veiculo)} • ${san(f.tipo)}</span>
                <span class="text-xs font-bold text-slate-900">R$ ${san(f.valor)}</span>
              </div>
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                  <span class="text-sm font-medium text-slate-700 truncate">${san(f.origem)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                  <span class="text-sm font-medium text-slate-700 truncate">${san(f.destino)}</span>
                </div>
              </div>
              <div class="mt-3 flex justify-between items-center">
                <span class="text-[10px] ${statusColor} px-2 py-0.5 rounded font-bold uppercase">${statusText}</span>
                <span class="text-[10px] text-slate-400">${dateStr}</span>
              </div>
            </div>
        `;
    }).join('');
}

function selectFreight(id) {
    selectedFreightId = id;
    renderFreightsList();
    
    const freight = currentFreights.find(f => f.id === id);
    if (!freight) return;

    document.getElementById('freightEmptyState').style.display = 'none';
    document.getElementById('freightDetailsContainer').style.display = 'flex';

    document.getElementById('detailRoute').innerText = `${san(freight.origem)} → ${san(freight.destino)}`;
    document.getElementById('detailRef').innerText = `Ref: #${freight.id.substring(0, 8).toUpperCase()}`;
    
    document.getElementById('detailValue').innerText = `R$ ${san(freight.valor)}`;
    document.getElementById('detailVehicle').innerText = san(freight.veiculo);
    document.getElementById('detailType').innerText = san(freight.tipo);
    
    document.getElementById('detailDistance').innerText = freight.distancia ? `${san(freight.distancia)} km` : '---';
    document.getElementById('detailOrigin').innerText = san(freight.origem);
    document.getElementById('detailDestination').innerText = san(freight.destino);
    
    document.getElementById('detailCommodity').innerText = san(freight.mercadoria || 'Diversos');
    document.getElementById('detailWeight').innerText = freight.peso ? `${san(freight.peso)} kg` : '---';
    document.getElementById('detailVolume').innerText = freight.volume ? `${san(freight.volume)} m³` : '---';
    
    document.getElementById('detailCollection').innerText = freight.coleta ? san(freight.coleta) : '---';
    document.getElementById('detailDelivery').innerText = freight.previsao ? san(freight.previsao) : '---';
    
    let urgText = 'NORMAL';
    let urgClass = 'bg-blue-50 text-blue-600';
    if (freight.urgencia === 'alta' || freight.urgencia === 'Alta') { urgText = 'ALTA'; urgClass = 'bg-red-50 text-red-600'; }
    else if (freight.urgencia === 'media' || freight.urgencia === 'Média') { urgText = 'MÉDIA'; urgClass = 'bg-orange-50 text-orange-600'; }
    else if (freight.urgencia === 'baixa' || freight.urgencia === 'Baixa') { urgText = 'BAIXA'; urgClass = 'bg-slate-50 text-slate-600'; }
    
    const urgEl = document.getElementById('detailUrgency');
    urgEl.innerText = urgText;
    urgEl.className = `text-xs px-2 py-0.5 rounded font-bold ${urgClass}`;
}

async function loadPendingDocs() {
    const h = await getHeaders();
    const resObj = await request(`${API}/pending-docs`, { headers: h });
    pendingUsers = resObj.pendingDocs || [];
    const tbody = document.getElementById('docsTableBody');
    if (!pendingUsers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6"><i class="ph ph-check-circle" style="font-size:32px;color:var(--success)"></i><p class="mt-2" style="font-weight:700">Nenhum documento pendente!</p></td></tr>';
        return;
    }
    tbody.innerHTML = pendingUsers.map(u => {
        const init = u.name ? u.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : 'U';
        return `<tr>
            <td><div class="table-user"><div class="user-initials">${init}</div><span class="user-meta-name">${san(u.name)}</span></div></td>
            <td>${san(u.email)}</td><td>${san(u.phone||'—')}</td><td>${san(u.city||'—')} - ${san(u.vehicle||'—')}</td>
            <td><span class="badge-inline badge-purple">${san(u.docStatus||'Pendente')}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="inspectDoc('${u.uid}')">Analisar <i class="ph ph-magnifying-glass"></i></button></td>
        </tr>`;
    }).join('');
}

function inspectDoc(uid) {
    const u = pendingUsers.find(p => p.uid === uid);
    if (!u) return;
    inspectedUser = u;

    document.getElementById('docModal').classList.add('active');
    document.getElementById('docName').innerText = san(u.name);
    document.getElementById('docPhone').innerText = san(u.phone || 'Não informado');
    document.getElementById('docVehicle').innerText = san(u.vehicle || 'Não informado');
    document.getElementById('docAntt').innerText = san(u.antt || 'Não informado');
    document.getElementById('docCnhLabel').innerText = san(u.cnh || 'Não informado');
    document.getElementById('docPlaca').innerText = san(u.placa || 'Não informado');

    const docUrls = u.documentUrls || {};
    const frame = document.getElementById('docFrame');
    
    if (docUrls.cnh) {
        let imagesHtml = `<div style="flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 4px; position: relative; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <span style="position: absolute; top: 6px; left: 6px; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; background: rgba(255,255,255,0.95); padding: 3px 8px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); z-index: 2;">CNH / RNTRC</span>
            <img src="${docUrls.cnh}" style="width: 100%; height: 100%; object-fit: contain; cursor: zoom-in; border-radius: 4px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" onclick="window.open('${docUrls.cnh}')" title="Clique para ampliar CNH">
        </div>`;
        if (docUrls.id) {
            imagesHtml += `<div style="flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 4px; position: relative; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <span style="position: absolute; top: 6px; left: 6px; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; background: rgba(255,255,255,0.95); padding: 3px 8px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); z-index: 2;">Doc / Veículo</span>
                <img src="${docUrls.id}" style="width: 100%; height: 100%; object-fit: contain; cursor: zoom-in; border-radius: 4px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" onclick="window.open('${docUrls.id}')" title="Clique para ampliar Identificação">
            </div>`;
        }
        frame.innerHTML = `<div style="display: flex; flex-direction: ${docUrls.id ? 'row' : 'column'}; gap: 12px; width: 100%; height: 100%; padding: 12px; background: #f8fafc; border-radius: inherit;">${imagesHtml}</div>`;
    } else {
        frame.innerHTML = `<div class="text-slate-500 text-sm flex flex-col items-center justify-center h-full w-full bg-slate-50"><i class="ph ph-file-dashed text-4xl mb-2 text-slate-300"></i><span class="font-medium text-slate-400">Sem imagem disponível</span></div>`;
    }
    
    toggleReject(false);
}

function closeDocModal() {
    document.getElementById('docModal').classList.remove('active');
    inspectedUser = null;
}

function toggleReject(show) {
    const rejectArea = document.getElementById('rejectArea');
    if (rejectArea) rejectArea.style.display = show ? 'block' : 'none';
}

async function verifyDoc(action) {
    if (!inspectedUser) return;
    
    let status = action === 'verified' ? 'Aprovado' : 'Reprovado';
    let reason = '';
    
    if (status === 'Reprovado') {
        reason = document.getElementById('rejectReason').value.trim();
        if (!reason) {
            showToast('Informe o motivo da rejeição.', 'error');
            return;
        }
    }
    
    try {
        const h = await getHeaders();
        const response = await fetch(`${API}/docs/${inspectedUser.uid}/status`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ status, reason })
        });
        
        if (!response.ok) throw new Error('Falha ao atualizar status');
        
        showToast(`Documentação ${status}`, 'success');
        closeDocModal();
        await loadPendingDocs();
        
    } catch (err) {
        console.error(err);
        showToast('Erro ao validar documento.', 'error');
    }
}

async function loadUsersDropdown() {
    // Agora carrega o histórico de notificações em vez de preencher o select (que agora é estático)
    await loadNotificationsHistory();
}

async function loadNotificationsHistory() {
    const hist = document.getElementById('notifHistory');
    if (!hist) return;
    try {
        const h = await getHeaders();
        const resObj = await request(`${API}/notifications`, { headers: h });
        const notifications = resObj.notifications || [];
        
        if (!notifications.length) {
            hist.innerHTML = `
              <div class="p-4 bg-slate-50 rounded-lg border border-slate-100 flex gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><i class="ph ph-info"></i></div>
                <div>
                  <h4 class="text-sm font-bold text-slate-800">Sistema</h4>
                  <p class="text-xs text-slate-600 mt-1">Nenhuma notificação enviada.</p>
                </div>
              </div>`;
            return;
        }

        hist.innerHTML = notifications.map(n => {
            let dateStr = '—';
            if (n.createdAt) {
                const d = new Date(n.createdAt);
                dateStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
            }
            
            let targetStr = 'Privado';
            if (n.targetUid === 'all') targetStr = 'Todos os Usuários';
            else if (n.targetUid === 'shippers') targetStr = 'Todos os Embarcadores';
            else if (n.targetUid === 'drivers') targetStr = 'Todos os Transportadores';

            const title = n.title ? san(n.title) : '<span class="text-slate-400 italic">Sem título</span>';
            const message = n.message ? san(n.message) : '<span class="text-slate-400 italic">Sem mensagem</span>';

            return `
              <div class="p-4 bg-white rounded-lg border border-slate-200 flex justify-between items-start gap-3 shadow-sm hover:shadow transition-shadow">
                <div class="flex gap-3 w-full">
                  <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <i class="ph ph-paper-plane"></i>
                  </div>
                  <div class="flex-1">
                    <div class="flex justify-between items-start">
                      <h4 class="text-sm font-bold text-slate-800">${title}</h4>
                      <button onclick="deleteNotification('${n.id}')" class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" title="Apagar Mensagem">
                        <i class="ph ph-trash text-base"></i>
                      </button>
                    </div>
                    <p class="text-xs text-slate-600 mt-1">${message}</p>
                    <span class="text-[10px] text-slate-400 mt-2 block">${dateStr} — ${targetStr}</span>
                    
                    <div class="mt-3 bg-slate-50 p-2 rounded border border-slate-100">
                      <div class="flex justify-between text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
                        <span>Estatísticas de Engajamento</span>
                        <span class="${(n.viewPercentage || 0) > 50 ? 'text-green-600' : 'text-orange-500'}">${n.viewPercentage || 0}% Taxa de Abertura</span>
                      </div>
                      <div class="flex gap-4 text-[11px] font-medium mt-2">
                        <div class="flex items-center gap-1 text-slate-600 bg-slate-200/50 px-2 py-0.5 rounded">
                          <i class="ph-fill ph-users"></i> ${n.sentCount || 0} Enviados
                        </div>
                        <div class="flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">
                          <i class="ph-fill ph-eye"></i> ${n.views || 0} Vistos
                        </div>
                        <div class="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          <i class="ph-fill ph-eye-closed"></i> ${n.nonViews || 0} Não vistos
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;
        }).join('');
    } catch (e) {
        console.error(e);
        hist.innerHTML = `<div class="p-4 text-center text-red-500 text-sm">Erro ao carregar histórico: ${e.message}</div>`;
    }
}

async function deleteNotification(id) {
    if (!confirm('Deseja realmente apagar esta notificação? Isso removerá a mensagem das caixas de entrada dos destinatários.')) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/notifications/${id}`, { method: 'DELETE', headers: h });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        await loadNotificationsHistory();
    } catch (e) {
        showToast('Erro ao apagar: ' + e.message, 'error');
    }
}

async function loadLogs() {
    const h = await getHeaders();
    const resObj = await request(`${API}/logs`, { headers: h });
    const logs = resObj.logs || [];
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
        await loadNotificationsHistory();
    } catch (e) { showToast('Falha: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
}

// === SETUP CLAIMS ===

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

async function deleteSelectedFreight() {
    if (!selectedFreightId) return;
    if (!confirm('Deseja realmente apagar este frete? Esta ação não pode ser desfeita.')) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/freights/${selectedFreightId}`, { method: 'DELETE', headers: h });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        document.getElementById('freightEmptyState').style.display = 'flex';
        document.getElementById('freightDetailsContainer').style.display = 'none';
        loadFreights();
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function changeFreightStatus() {
    if (!selectedFreightId) return;
    editFreight(selectedFreightId);
}

// === SETTINGS ===
async function loadSettings() {
    try {
        const h = await getHeaders();
        const resObj = await request(`${API}/settings`, { headers: h });
        const isAuto = resObj.settings?.autoApproveDrivers || false;
        
        const toggle = document.getElementById('toggleAutoApproval');
        const badge = document.getElementById('autoApprovalBadge');
        
        if (toggle) toggle.checked = isAuto;
        if (badge) {
            badge.innerText = isAuto ? 'Ativado' : 'Desativado';
            badge.className = isAuto ? 'bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider' : 'bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider';
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar configurações globais.', 'error');
    }
}

async function updateAutoApproval(checked) {
    try {
        const h = await getHeaders();
        const resObj = await fetch(`${API}/settings`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ autoApproveDrivers: checked })
        });
        
        if (!resObj.ok) throw new Error('Falha ao atualizar configuração');
        
        const badge = document.getElementById('autoApprovalBadge');
        if (badge) {
            badge.innerText = checked ? 'Ativado' : 'Desativado';
            badge.className = checked ? 'bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider' : 'bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider';
        }
        
        showToast(`Aprovação Automática ${checked ? 'ativada' : 'desativada'} com sucesso!`, 'success');
    } catch (e) {
        console.error(e);
        showToast('Erro ao salvar configuração.', 'error');
        // Revert toggle
        document.getElementById('toggleAutoApproval').checked = !checked;
    }
}
window.updateAutoApproval = updateAutoApproval;

async function editFreight(id = selectedFreightId) {
    if (!id) return;
    const field = prompt('Campo a editar (status, valor, veiculo, tipo, distancia, peso, volume, coleta, previsao, urgencia, obs):');
    if (!field) return;
    const value = prompt(`Novo valor para "${field}":`);
    if (value === null) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/freights/${id}`, { method:'PUT', headers:h, body:JSON.stringify({[field]:value}) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        await loadFreights();
        if (selectedFreightId === id) selectFreight(id);
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
