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
        console.error('Firebase Auth Error:', err);
        const msgs = {
            'auth/wrong-password': 'Senha incorreta.',
            'auth/user-not-found': 'Usuário não encontrado.',
            'auth/invalid-credential': 'Credenciais inválidas (verifique o e-mail e a senha).',
            'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
            'auth/user-disabled': 'Esta conta foi desativada pelo administrador.',
            'auth/invalid-email': 'Formato de e-mail inválido.'
        };
        showToast(msgs[err.code] || `Erro ao fazer login (${err.code}): ${err.message}`, 'error');
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
        console.error('Google Auth Error:', err);
        if (err.code !== 'auth/popup-closed-by-user') {
            showToast(`Erro ao entrar com Google (${err.code}): ${err.message}`, 'error');
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
    const titles = { stats:'Visão Geral', users:'Usuários', freights:'Fretes', documents:'Documentos', notifications:'Notificações', logs:'Logs de Segurança', setup:'Gerenciamento de Acesso' };
    document.getElementById('sectionTitle').innerText = titles[id] || '';
    loadData(id);
    // Mobile: close sidebar
    document.getElementById('sidebar').classList.remove('active');
}

function refreshSection() {
    const icon = document.getElementById('refreshIcon');
    if (icon) icon.classList.add('ph-spin');
    loadData(activeSection).finally(() => {
        if (icon) setTimeout(() => icon.classList.remove('ph-spin'), 500);
    });
}

// Atualização automática a cada 30 segundos
setInterval(() => {
    if (activeSection === 'documents') loadPendingDocs();
    if (activeSection === 'freights') loadFreights();
    if (activeSection === 'stats') loadStats();
}, 30000);

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

async function loadData(id) {
    try {
        // Keep stats and badges updated across all views
        if (id !== 'stats') {
            loadStats().catch(console.error);
        }
        
        if (id === 'stats') await loadStats();
        else if (id === 'users') await loadUsers();
        else if (id === 'freights') await loadFreights();
        else if (id === 'documents') await loadPendingDocs();
        else if (id === 'notifications') await loadUsersDropdown();
        else if (id === 'logs') await loadLogs();
        else if (id === 'settings') await loadSettings();
        else if (id === 'setup') await loadAdmins();
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
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set('statShippers', d.shippers || 0);
    set('statDrivers', d.drivers || 0);
    set('statPending', d.pendingDocs || 0);
    set('statFreights', d.totalFreights || 0);
    set('badgePending', d.pendingDocs || 0);
    set('verifyCount', `${d.pendingDocs || 0} Pendentes`);
    set('statTotal', (d.shippers || 0) + (d.drivers || 0));

    // Render growth chart dynamically
    const chartContainer = document.getElementById('growthChartContainer');
    if (chartContainer && d.monthlyStats && d.monthlyStats.length) {
        const maxCount = Math.max(...d.monthlyStats.map(m => m.count), 1);
        chartContainer.innerHTML = d.monthlyStats.map((m, idx) => {
            const heightPercent = Math.max(5, Math.round((m.count / maxCount) * 100));
            const isLast = idx === d.monthlyStats.length - 1;
            const barClass = isLast
                ? 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-lg'
                : 'bg-slate-100 hover:bg-slate-200';
            const textClass = isLast
                ? 'font-bold text-brand'
                : 'font-medium text-slate-500';
            return `
                <div class="flex-1 flex flex-col items-center gap-3 h-full justify-end">
                    <div class="relative w-full group flex flex-col items-center justify-end h-full">
                        <!-- Tooltip showing exact count on hover -->
                        <div class="absolute -top-8 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-md">
                            ${m.count} frete(s)
                        </div>
                        <div class="w-full rounded-t-md transition-all duration-500 ${barClass}" style="height: ${heightPercent}%"></div>
                    </div>
                    <span class="text-xs ${textClass}">${m.monthName}</span>
                </div>
            `;
        }).join('');
    }
}

let currentUsersList = [];

async function loadUsers() {
    const h = await getHeaders();
    const role = document.getElementById('roleFilter')?.value || '';
    const url = role ? `${API}/users?role=${role}` : `${API}/users`;
    const resObj = await request(url, { headers: h });
    currentUsersList = resObj.users || [];
    updateUsersStats();
    filterAndRenderUsers();
}

function updateUsersStats() {
    const total = currentUsersList.length;
    const drivers = currentUsersList.filter(u => u.role === 'driver').length;
    const shippers = currentUsersList.filter(u => u.role === 'shipper').length;
    
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    setVal('usersStatTotal', total);
    setVal('usersStatDrivers', drivers);
    setVal('usersStatShippers', shippers);
}

function filterAndRenderUsers() {
    const q = document.getElementById('userSearchInput')?.value.trim().toLowerCase() || '';
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    let filtered = [...currentUsersList];
    if (q) {
        filtered = filtered.filter(u => 
            (u.name && u.name.toLowerCase().includes(q)) ||
            (u.email && u.email.toLowerCase().includes(q)) ||
            (u.uid && u.uid.toLowerCase().includes(q)) ||
            (u.phone && u.phone.includes(q))
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-slate-500"><i class="ph ph-users-three text-4xl mb-2 text-slate-300"></i><p class="font-bold">Nenhum usuário correspondente</p></td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((u, idx) => {
        const init = u.name ? u.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : 'U';
        const roleLabel = u.role === 'driver' ? 'Motorista' : u.role === 'shipper' ? 'Embarcador' : 'Admin';
        
        let roleBadge = 'bg-blue-50 text-blue-700 border border-blue-100';
        if (u.role === 'shipper') roleBadge = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
        else if (u.role === 'admin') roleBadge = 'bg-purple-50 text-purple-700 border border-purple-100';

        let docBadge = 'bg-slate-50 text-slate-600 border border-slate-200';
        let docStatus = u.documentStatus || u.docStatus || 'Pendente';
        if (docStatus === 'verified' || docStatus === 'Aprovado') {
            docBadge = 'bg-green-50 text-green-700 border border-green-200';
            docStatus = 'Verificado';
        } else if (docStatus === 'pending' || docStatus === 'Pendente' || docStatus === 'Em Análise') {
            docBadge = 'bg-amber-50 text-amber-700 border border-amber-250';
            docStatus = 'Pendente';
        } else if (docStatus === 'rejected' || docStatus === 'Reprovado') {
            docBadge = 'bg-red-50 text-red-700 border border-red-200';
            docStatus = 'Reprovado';
        }

        const hasFcm = !!(u.fcmToken || u.fcmTokenEnabled);
        const fcmBadge = hasFcm
            ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200" title="Token FCM registrado"><i class="ph ph-bell-ringing"></i> Push Ativo</span>'
            : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-400 border border-slate-200" title="Sem token FCM"><i class="ph ph-bell-slash"></i> Inativo</span>';

        const zebraClass = idx % 2 === 0 ? '' : 'bg-[#f8f9fb]';

        return `<tr class="${zebraClass} hover:bg-blue-50/40 transition-colors">
            <td class="px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-blue-500/10">${init}</div>
                <div>
                  <span class="font-bold text-slate-800">${san(u.name)}</span>
                  <p class="text-[10px] font-mono text-slate-400 mt-0.5">UID: ${u.uid.substring(0,10)}…</p>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 text-slate-600 font-medium">${san(u.email)}</td>
            <td class="px-6 py-4 text-slate-500 font-mono text-xs">${san(u.phone||'—')}</td>
            <td class="px-6 py-4">
              <div class="flex flex-col gap-1.5 items-start">
                <span class="px-2.5 py-1 rounded-full text-xs font-bold ${roleBadge}">${roleLabel}</span>
                ${fcmBadge}
              </div>
            </td>
            <td class="px-6 py-4">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${docBadge}">${docStatus}</span>
            </td>
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

        const timeVal = f.createdAt ? (f.createdAt._seconds ? f.createdAt._seconds * 1000 : f.createdAt) : null;
        const dateStr = timeVal ? new Date(timeVal).toLocaleDateString('pt-BR') : '';

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

let docActiveTab = 'all';
let docCurrentPage = 1;
const DOC_PAGE_SIZE = 15;

async function loadPendingDocs() {
    const h = await getHeaders();
    const resObj = await request(`${API}/pending-docs`, { headers: h });
    pendingUsers = resObj.pendingDocs || [];

    // --- Populate stat cards ---
    const total = pendingUsers.length;
    const pending = pendingUsers.filter(u => !u.docStatus || u.docStatus === 'Pendente').length;
    const verified = pendingUsers.filter(u => u.docStatus === 'Aprovado').length;
    const flagged = pendingUsers.filter(u => u.docStatus === 'Reprovado').length;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set('docsTotalActive', total);
    set('docsPendingCount', pending);
    set('docsVerifiedToday', verified);
    set('docsFlagged', flagged);

    docCurrentPage = 1;
    renderDocsTable();
}

function getFilteredDocs() {
    let list = [...pendingUsers];

    // Tab filter
    if (docActiveTab === 'pending') {
        list = list.filter(u => !u.docStatus || u.docStatus === 'Pendente');
    } else if (docActiveTab === 'verified') {
        list = list.filter(u => u.docStatus === 'Aprovado');
    }

    // Search
    const searchEl = document.getElementById('docSearchInput');
    const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (q) {
        list = list.filter(u => {
            const docId = `DOC-${u.uid.substring(0,6).toUpperCase()}`;
            return (u.name && u.name.toLowerCase().includes(q)) ||
                   (u.placa && u.placa.toLowerCase().includes(q)) ||
                   (u.email && u.email.toLowerCase().includes(q)) ||
                   docId.toLowerCase().includes(q);
        });
    }

    // Role filter
    const roleEl = document.getElementById('docRoleFilter');
    const role = roleEl ? roleEl.value : 'all';
    if (role !== 'all') {
        list = list.filter(u => u.role === role);
    }

    // Date filter
    const dateEl = document.getElementById('docDateFilter');
    const dateFilter = dateEl ? dateEl.value : 'all';
    if (dateFilter !== 'all' && list.some(u => u.createdAt)) {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        list = list.filter(u => {
            if (!u.createdAt) return false;
            const timeVal = u.createdAt._seconds ? u.createdAt._seconds * 1000 : u.createdAt;
            const d = new Date(timeVal);
            if (dateFilter === 'today') return d >= startOfDay;
            if (dateFilter === 'week') { const weekAgo = new Date(now.getTime() - 7*24*60*60*1000); return d >= weekAgo; }
            if (dateFilter === 'month') { const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); return d >= monthAgo; }
            return true;
        });
    }

    return list;
}

function renderDocsTable() {
    const filtered = getFilteredDocs();
    const tbody = document.getElementById('docsTableBody');

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-[#737685]">
            <i class="ph ph-check-circle text-4xl mb-2 text-green-400"></i>
            <p class="font-bold mt-2 text-[#172B4D]">Nenhum documento encontrado</p>
            <p class="text-xs mt-1">Tente alterar os filtros ou a aba selecionada.</p>
        </td></tr>`;
        const showCountEl = document.getElementById('docsShowingCount');
        if (showCountEl) showCountEl.innerText = 'Exibindo 0 documentos';
        const pagEl = document.getElementById('docsPagination');
        if (pagEl) pagEl.innerHTML = '';
        return;
    }

    // Pagination
    const totalPages = Math.ceil(filtered.length / DOC_PAGE_SIZE);
    if (docCurrentPage > totalPages) docCurrentPage = totalPages;
    const start = (docCurrentPage - 1) * DOC_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + DOC_PAGE_SIZE);

    tbody.innerHTML = pageItems.map((u, idx) => {
        const init = u.name ? u.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : 'U';
        
        let badgeClass = 'bg-orange-100 text-orange-700';
        let badgeText = 'PENDENTE';
        if (u.docStatus === 'Aprovado') { badgeClass = 'bg-green-100 text-[#36B37E]'; badgeText = 'VERIFICADO'; }
        else if (u.docStatus === 'Reprovado') { badgeClass = 'bg-red-100 text-[#ba1a1a]'; badgeText = 'REPROVADO'; }
        
        const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '---';
        const docId = `DOC-${u.uid.substring(0,6).toUpperCase()}`;
        const zebraClass = idx % 2 === 0 ? '' : 'bg-[#f8f9fb]';

        return `<tr class="${zebraClass} hover:bg-blue-50/40 transition-colors">
            <td class="pl-6 pr-3 py-4"><input type="checkbox" class="doc-row-check rounded border-[#DFE1E6] text-[#003d9b] focus:ring-[#003d9b]"></td>
            <td class="px-3 py-4 font-bold text-[#003d9b]">${docId}</td>
            <td class="px-3 py-4 text-[#737685]">${u.role === 'shipper' ? 'Embarcador' : 'Motorista'}</td>
            <td class="px-3 py-4">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-[#f3f4f6] border border-[#DFE1E6] flex items-center justify-center text-[9px] font-bold text-[#434654] uppercase">${init}</div>
                <span class="font-bold text-[#172B4D]">${san(u.name)}</span>
              </div>
            </td>
            <td class="px-3 py-4 text-[#737685] uppercase font-mono text-xs">${san(u.placa || 'Não informado')}</td>
            <td class="px-3 py-4 text-[#737685]">${dateStr}</td>
            <td class="px-3 py-4">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">${badgeText}</span>
            </td>
            <td class="px-6 py-4 text-right">
              <button class="w-8 h-8 inline-flex items-center justify-center rounded hover:bg-[#e1e2e4] text-[#434654] transition-colors" onclick="inspectDoc('${u.uid}')" title="Analisar documento">
                <i class="ph ph-eye text-lg"></i>
              </button>
            </td>
        </tr>`;
    }).join('');

    // Showing count
    const showCountEl = document.getElementById('docsShowingCount');
    if (showCountEl) {
        const from = start + 1;
        const to = Math.min(start + DOC_PAGE_SIZE, filtered.length);
        showCountEl.innerText = `Exibindo ${from}-${to} de ${filtered.length} documentos`;
    }

    // Pagination buttons
    renderDocsPagination(totalPages);
}

function renderDocsPagination(totalPages) {
    const container = document.getElementById('docsPagination');
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button onclick="goDocPage(${docCurrentPage - 1})" ${docCurrentPage === 1 ? 'disabled' : ''} class="w-8 h-8 flex items-center justify-center rounded hover:bg-[#e1e2e4] ${docCurrentPage === 1 ? 'opacity-30 cursor-not-allowed' : ''}"><i class="ph ph-caret-left"></i></button>`;

    for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 1 && Math.abs(i - docCurrentPage) > 1) {
            if (i === 4) html += `<span class="w-8 h-8 flex items-center justify-center text-[#737685]">…</span>`;
            continue;
        }
        const active = i === docCurrentPage;
        html += `<button onclick="goDocPage(${i})" class="w-8 h-8 flex items-center justify-center rounded ${active ? 'bg-[#003d9b] text-white' : 'hover:bg-[#e1e2e4] text-[#172B4D]'} font-bold text-xs">${i}</button>`;
    }

    html += `<button onclick="goDocPage(${docCurrentPage + 1})" ${docCurrentPage === totalPages ? 'disabled' : ''} class="w-8 h-8 flex items-center justify-center rounded hover:bg-[#e1e2e4] ${docCurrentPage === totalPages ? 'opacity-30 cursor-not-allowed' : ''}"><i class="ph ph-caret-right"></i></button>`;
    container.innerHTML = html;
}

function goDocPage(page) {
    const filtered = getFilteredDocs();
    const totalPages = Math.ceil(filtered.length / DOC_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    docCurrentPage = page;
    renderDocsTable();
}

function setDocTab(tab) {
    docActiveTab = tab;
    docCurrentPage = 1;

    // Update tab visuals
    ['All', 'Pending', 'Verified'].forEach(t => {
        const el = document.getElementById(`docTab${t}`);
        if (!el) return;
        const isActive = t.toLowerCase() === tab || (t === 'All' && tab === 'all');
        el.className = `px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all ${isActive ? 'text-[#003d9b] bg-blue-50 border-b-2 border-[#003d9b]' : 'text-[#737685] hover:text-[#172B4D] hover:bg-gray-50'}`;
    });

    renderDocsTable();
}

function filterDocsTable() {
    docCurrentPage = 1;
    renderDocsTable();
}

function toggleAllDocCheckboxes(master) {
    document.querySelectorAll('.doc-row-check').forEach(cb => cb.checked = master.checked);
}

function exportDocsCSV() {
    const filtered = getFilteredDocs();
    if (!filtered.length) { showToast('Nenhum documento para exportar.', 'error'); return; }

    const headers = ['Doc ID', 'Tipo', 'Nome', 'Email', 'Placa', 'Status', 'Data'];
    const rows = filtered.map(u => {
        const docId = `DOC-${u.uid.substring(0,6).toUpperCase()}`;
        const tipo = u.role === 'shipper' ? 'Embarcador' : 'Motorista';
        const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '';
        const status = u.docStatus || 'Pendente';
        return [docId, tipo, u.name || '', u.email || '', u.placa || '', status, dateStr].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `documentos_pegafrete_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado com sucesso!', 'success');
}

function showDocsHelp() {
    const helpHtml = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
        <div style="background:#fff;border-radius:12px;max-width:520px;width:90%;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,0.2);position:relative;">
            <button onclick="this.closest('div[style*=fixed]').remove()" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#737685;" title="Fechar">✕</button>
            <h2 style="font-family:Inter,sans-serif;font-size:20px;font-weight:700;color:#172B4D;margin-bottom:16px;">
                <i class="ph ph-question" style="color:#003d9b;margin-right:8px;"></i> Central de Ajuda — Documentos
            </h2>
            <div style="font-family:Inter,sans-serif;font-size:13px;color:#434654;line-height:1.7;">
                <p style="margin-bottom:12px;"><b>🔍 Busca:</b> Digite o nome, placa ou ID do documento na barra de pesquisa para localizar rapidamente.</p>
                <p style="margin-bottom:12px;"><b>📑 Abas:</b> Use <b>Todos</b>, <b>Pendentes</b> ou <b>Verificados</b> para filtrar os documentos por status.</p>
                <p style="margin-bottom:12px;"><b>📅 Filtros:</b> Combine o filtro de data (Hoje, Esta semana, Este mês) com o filtro por tipo (Motorista, Embarcador).</p>
                <p style="margin-bottom:12px;"><b>📥 Exportar CSV:</b> Clique em "Exportar CSV" para baixar os dados filtrados em formato planilha.</p>
                <p style="margin-bottom:12px;"><b>👁️ Analisar:</b> Clique no ícone do olho para abrir os documentos do usuário e aprovar ou reprovar.</p>
                <p><b>⚙️ Configurações:</b> O botão de engrenagem leva à página de configurações globais do sistema.</p>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', helpHtml);
}


let currentDocUrl = '';
let currentDocZoom = 1;
let currentDocRotation = 0;

function inspectDoc(uid) {
    const u = pendingUsers.find(p => p.uid === uid);
    if (!u) return;
    inspectedUser = u;

    document.getElementById('docsListView').style.display = 'none';
    document.getElementById('docsDetailView').style.display = 'block';

    const docId = `DOC-${u.uid.substring(0,6).toUpperCase()}`;
    document.getElementById('detailDocProtocol').innerText = `Protocolo: #${docId} • ${u.role === 'shipper' ? 'Embarcador' : 'Motorista'}: ${san(u.name)}`;

    const badge = document.getElementById('detailDocStatusBadge');
    const text = document.getElementById('detailDocStatusText');
    if (u.docStatus === 'Aprovado') {
        badge.className = 'px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded-full flex items-center gap-2 shadow-sm';
        text.innerText = 'VERIFICADO';
    } else if (u.docStatus === 'Reprovado') {
        badge.className = 'px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-full flex items-center gap-2 shadow-sm';
        text.innerText = 'REPROVADO';
    } else {
        badge.className = 'px-4 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-full flex items-center gap-2 shadow-sm';
        text.innerText = 'EM ANÁLISE';
    }

    const fields = [
        { id: 'phone', label: 'Telefone', value: u.phone },
        { id: 'vehicle', label: 'Veículo', value: u.vehicle },
        { id: 'antt', label: 'ANTT/RNTRC', value: u.antt },
        { id: 'cnh', label: 'CNH', value: u.cnh },
        { id: 'placa', label: 'Placa', value: u.placa }
    ];

    const icons = {
        phone: 'ph ph-phone',
        vehicle: 'ph ph-truck',
        antt: 'ph ph-hash',
        cnh: 'ph ph-identification-card',
        placa: 'ph ph-credit-card'
    };

    const fieldsContainer = document.getElementById('evalFieldsContainer');
    fieldsContainer.innerHTML = fields.map(f => {
        const iconClass = icons[f.id] || 'ph ph-info';
        return `
        <div class="space-y-1.5 eval-field-row" data-field="${f.id}">
          <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">${f.label}</label>
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <i class="${iconClass} absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
              <input class="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm font-semibold text-slate-800 bg-slate-50 focus:outline-none" type="text" value="${san(f.value || 'Não informado')}" readonly/>
            </div>
            <button class="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-all btn-check-field shrink-0" type="button" onclick="toggleFieldStatus(this, 'ok')" title="Validar campo">
              <i class="ph-fill ph-check-circle text-lg"></i>
            </button>
            <button class="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all btn-cancel-field shrink-0" type="button" onclick="toggleFieldStatus(this, 'error')" title="Rejeitar campo">
              <i class="ph-fill ph-x-circle text-lg"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    const docUrls = u.documentUrls || {};
    const labels = {
        'cnhFrente': 'CNH Frente', 'cnhVerso': 'CNH Verso',
        'cpfFrente': 'CPF Frente', 'cpfVerso': 'CPF Verso',
        'crlv': 'CRLV', 'residencia': 'Comp. de Residência'
    };

    const thumbsContainer = document.getElementById('docThumbnailsContainer');
    const mainImg = document.getElementById('mainDocImage');
    const noDocState = document.getElementById('noDocState');

    let thumbsHtml = '';
    let firstDocUrl = '';
    let firstDocLabel = '';
    currentDocZoom = 1;
    currentDocRotation = 0;

    for (const key in docUrls) {
        if (docUrls[key]) {
            const label = labels[key] || key;
            const indStatus = (u.documentStatuses && u.documentStatuses[key]) ? u.documentStatuses[key] : 'Pendente';
            if (!firstDocUrl) { firstDocUrl = docUrls[key]; firstDocLabel = label; }
            thumbsHtml += `
            <div class="flex flex-col gap-2 bg-white border border-slate-200 p-2.5 rounded-xl transition-all hover:shadow-sm">
              <div class="cursor-pointer transition-all doc-thumb text-center flex flex-col items-center justify-center p-2 rounded-lg gap-1.5" onclick="setMainDoc('${docUrls[key]}', '${label}', this)">
                <i class="ph ph-file-text text-xl text-blue-500"></i>
                <p class="text-[9px] font-extrabold text-slate-600 uppercase tracking-wider truncate w-full">${label}</p>
              </div>
              <select class="ind-doc-status text-[10px] font-bold p-1.5 rounded-md border border-slate-200 outline-none text-slate-600 bg-slate-50 cursor-pointer focus:ring-1 focus:ring-blue-500/20" data-key="${key}">
                  <option value="Pendente" ${indStatus==='Pendente'?'selected':''}>Pendente</option>
                  <option value="Aprovado" ${indStatus==='Aprovado'?'selected':''}>Aprovar</option>
                  <option value="Reprovado" ${indStatus==='Reprovado'?'selected':''}>Recusar</option>
              </select>
            </div>`;
        }
    }

    if (firstDocUrl) {
        thumbsContainer.innerHTML = thumbsHtml;
        setMainDoc(firstDocUrl, firstDocLabel, thumbsContainer.firstElementChild?.querySelector('.doc-thumb'));
        mainImg.style.display = 'block';
        noDocState.style.display = 'none';
    } else {
        thumbsContainer.innerHTML = '';
        mainImg.style.display = 'none';
        noDocState.style.display = 'flex';
        document.getElementById('currentDocLabel').innerText = 'NENHUM DOCUMENTO';
    }

    toggleRejectArea(false);
}

function setMainDoc(url, label, thumbEl) {
    currentDocUrl = url;
    const img = document.getElementById('mainDocImage');
    img.src = url;
    document.getElementById('currentDocLabel').innerText = label;

    currentDocZoom = 1;
    currentDocRotation = 0;
    updateDocTransform();

    document.querySelectorAll('.doc-thumb').forEach(t => {
        t.classList.remove('bg-blue-50', 'ring-1', 'ring-blue-400');
    });
    if (thumbEl) {
        thumbEl.classList.add('bg-blue-50', 'ring-1', 'ring-blue-400');
    }
}

function zoomDoc(step) {
    currentDocZoom += step;
    if (currentDocZoom < 0.2) currentDocZoom = 0.2;
    if (currentDocZoom > 5) currentDocZoom = 5;
    updateDocTransform();
}

function rotateDoc() {
    currentDocRotation += 90;
    updateDocTransform();
}

function updateDocTransform() {
    const img = document.getElementById('mainDocImage');
    if (img) img.style.transform = `scale(${currentDocZoom}) rotate(${currentDocRotation}deg)`;
}

function downloadCurrentDoc() {
    if (currentDocUrl) window.open(currentDocUrl, '_blank');
}

function toggleFieldStatus(btn, state) {
    const row = btn.closest('.eval-field-row');
    const checkBtn = row.querySelector('.btn-check-field');
    const cancelBtn = row.querySelector('.btn-cancel-field');

    checkBtn.className = "w-11 h-11 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-colors btn-check-field";
    cancelBtn.className = "w-11 h-11 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors btn-cancel-field";

    if (state === 'ok') {
        checkBtn.className = "w-11 h-11 rounded-lg border border-green-500 bg-green-500 flex items-center justify-center text-white transition-colors btn-check-field is-active";
    } else if (state === 'error') {
        cancelBtn.className = "w-11 h-11 rounded-lg border border-red-500 bg-red-500 flex items-center justify-center text-white transition-colors btn-cancel-field is-active";
    }
}

function closeDocDetail() {
    document.getElementById('docsDetailView').style.display = 'none';
    document.getElementById('docsListView').style.display = 'block';
    inspectedUser = null;
}

function toggleRejectArea(show) {
    const area = document.getElementById('rejectAreaNew');
    if (area) {
        if (show) {
            area.classList.remove('hidden');
        } else {
            area.classList.add('hidden');
            document.getElementById('rejectReasonNew').value = '';
        }
    }
}

function rejectVerification() {
    const rejectArea = document.getElementById('rejectAreaNew');
    if (rejectArea.classList.contains('hidden')) {
        toggleRejectArea(true);
        return;
    }

    const reason = document.getElementById('rejectReasonNew').value.trim();
    if (!reason) {
        showToast('Por favor, informe o motivo da rejeição.', 'error');
        return;
    }

    // Se houver documentos pendentes sem rejeição clara no select, marcamos como reprovado para facilitar.
    let hasReprovado = false;
    document.querySelectorAll('.ind-doc-status').forEach(select => {
        if (select.value === 'Reprovado') hasReprovado = true;
    });
    
    if (!hasReprovado) {
        document.querySelectorAll('.ind-doc-status').forEach(select => {
            if (select.value === 'Pendente') select.value = 'Reprovado';
        });
    }

    submitDocVerification('Reprovado', reason);
}

function approveVerification() {
    let hasCancel = false;
    document.querySelectorAll('.btn-cancel-field.is-active').forEach(() => hasCancel = true);
    
    if (hasCancel) {
        showToast('Atenção: Alguns campos foram marcados com erro. Use o botão REPROVAR para notificar o usuário.', 'error');
        return;
    }
    
    let hasReprovado = false;
    let hasPendente = false;
    document.querySelectorAll('.ind-doc-status').forEach(select => {
        if (select.value === 'Reprovado') hasReprovado = true;
        if (select.value === 'Pendente') hasPendente = true;
    });

    let globalStatus = 'Aprovado';
    if (hasReprovado) globalStatus = 'Reprovado';
    else if (hasPendente) globalStatus = 'Pendente';

    if (globalStatus === 'Reprovado') {
        const rejectArea = document.getElementById('rejectAreaNew');
        if (rejectArea && rejectArea.classList.contains('hidden')) {
            showToast('Existem documentos recusados. Por favor, escreva o motivo e clique em REPROVAR.', 'error');
            toggleRejectArea(true);
            return;
        }
        const reason = document.getElementById('rejectReasonNew').value.trim();
        if (!reason) {
            showToast('Por favor, informe o motivo da rejeição.', 'error');
            return;
        }
        submitDocVerification('Reprovado', reason);
    } else {
        submitDocVerification(globalStatus, '');
    }
}

async function submitDocVerification(status, reason) {
    if (!inspectedUser) return;

    const documentStatuses = {};
    document.querySelectorAll('.ind-doc-status').forEach(select => {
        documentStatuses[select.dataset.key] = select.value;
    });

    try {
        const h = await getHeaders();
        const response = await fetch(`${API}/docs/${inspectedUser.uid}/status`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ status, reason, documentStatuses })
        });

        if (!response.ok) throw new Error('Falha ao atualizar status');

        showToast(`Documentação atualizada para ${status}`, 'success');
        closeDocDetail();
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

            let methodStr = '';
            if (n.sendInternal !== false && n.sendPush === true) {
                methodStr = 'Interno + Push';
            } else if (n.sendPush === true) {
                methodStr = 'Push FCM';
            } else {
                methodStr = 'Interno';
            }

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
                    <span class="text-[10px] text-slate-400 mt-2 block">${dateStr} — ${targetStr} [${methodStr}]</span>
                    
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

// === NOTIFICATIONS ===
async function handleSendNotification(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSendNotif'), orig = btn.innerHTML;
    const sendInternal = document.getElementById('notifySendInternal').checked;
    const sendPush = document.getElementById('notifySendPush').checked;

    if (!sendInternal && !sendPush) {
        showToast('Selecione pelo menos uma opção de envio (Mensagem interna e/ou Push FCM).', 'error');
        return;
    }

    btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Enviando...';
    try {
        const h = await getHeaders();
        const body = { 
            targetUid: document.getElementById('notifyTarget').value, 
            title: document.getElementById('notifyTitle').value.trim(), 
            message: document.getElementById('notifyMessage').value.trim(),
            sendInternal,
            sendPush
        };
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
async function handleAdminRole(e) {
    e.preventDefault();
    const btn = document.getElementById('btnAdminRole');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Processando...';
    try {
        const h = await getHeaders();
        const email = document.getElementById('newAdminEmail').value.trim();
        const role = document.getElementById('newAdminRole').value;
        const r = await fetch(`${API}/roles`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ email, role })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        document.getElementById('newAdminEmail').value = '';
        await loadAdmins();
    } catch (error) {
        showToast('Falha: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

async function loadAdmins() {
    const container = document.getElementById('adminsListContainer');
    if (!container) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/admins`, { headers: h });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        
        const admins = d.admins || [];
        if (admins.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-slate-500">Nenhum administrador encontrado.</div>';
            return;
        }

        container.innerHTML = admins.map(a => {
            const roleLabels = { 'owner': 'Proprietário', 'editor': 'Editor', 'viewer': 'Visualizador' };
            const roleColors = { 
                'owner': 'bg-purple-100 text-purple-700 border-purple-200', 
                'editor': 'bg-blue-100 text-blue-700 border-blue-200', 
                'viewer': 'bg-slate-100 text-slate-700 border-slate-200' 
            };
            
            const rLabel = roleLabels[a.role] || a.role;
            const rColor = roleColors[a.role] || roleColors['viewer'];

            return `
            <div class="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                <div>
                    <p class="font-bold text-sm text-slate-800">${san(a.email)}</p>
                    <p class="text-xs text-slate-500 font-mono mt-0.5">UID: ${san(a.id)}</p>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-bold px-2 py-1 rounded border ${rColor}">${rLabel}</span>
                    <button onclick="revokeAdmin('${a.id}')" class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors" title="Revogar Acesso">
                        <i class="ph ph-trash text-lg"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

    } catch (error) {
        container.innerHTML = `<div class="text-center py-8 text-red-500">Erro ao carregar: ${error.message}</div>`;
    }
}

async function revokeAdmin(uid) {
    if (!confirm('Tem certeza que deseja remover o acesso administrativo deste usuário?')) return;
    try {
        const h = await getHeaders();
        const r = await fetch(`${API}/roles/${uid}`, { method: 'DELETE', headers: h });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(d.message, 'success');
        await loadAdmins();
    } catch (error) {
        showToast('Erro: ' + error.message, 'error');
    }
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

async function deleteFreight() {
    if (!selectedFreightId) return;
    if (!confirm('Tem certeza que deseja APAGAR este frete? Esta ação é irreversível.')) return;
    try {
        const h = await getHeaders();
        const res = await fetch(`${API}/freights/${selectedFreightId}`, { method: 'DELETE', headers: h });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || 'Erro ao apagar frete');
        showToast('Frete apagado com sucesso', 'success');
        document.getElementById('freightDetailsContainer').style.display = 'none';
        document.getElementById('freightEmptyState').style.display = 'flex';
        loadFreights();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function clearLogs() {
    if (!confirm('Tem certeza que deseja limpar todos os logs de segurança?')) return;
    try {
        const h = await getHeaders();
        const res = await fetch(`${API}/logs`, { method: 'DELETE', headers: h });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || 'Erro ao limpar logs');
        showToast('Logs limpos com sucesso', 'success');
        loadLogs();
    } catch (err) {
        showToast(err.message, 'error');
    }
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
