/**
 * PegaFrete Admin — API Gateway + Static Server
 * Express.js + Firebase Admin SDK
 *
 * Todas as rotas /api/admin/* (exceto setup-claims) exigem
 * token JWT com custom claim { admin: true }.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');

// ── Globais de Diagnóstico ──
let firebaseInitStatus = {
  success: false,
  error: null,
  method: null
};

// ───────────────────────── Firebase Admin Init ─────────────────────────

function initializeFirebase() {
  let credentialEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (credentialEnv) {
    try {
      // Remove aspas externas extras se existirem
      if (credentialEnv.startsWith('"') && credentialEnv.endsWith('"')) {
        credentialEnv = credentialEnv.slice(1, -1);
      }
      if (credentialEnv.startsWith("'") && credentialEnv.endsWith("'")) {
        credentialEnv = credentialEnv.slice(1, -1);
      }

      const parsed = JSON.parse(credentialEnv);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
      console.log('✅ Firebase Admin inicializado com JSON da env.');
      firebaseInitStatus = { success: true, method: 'env_json' };
      return;
    } catch (parseErr) {
      console.error('⚠️  Falha ao parsear JSON da env:', parseErr.message);
      firebaseInitStatus.error = `Falha ao parsear JSON da env: ${parseErr.message}`;
      // Se falhar, tenta como caminho de arquivo
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const serviceAccount = require(path.resolve(credentialEnv));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('✅ Firebase Admin inicializado com arquivo de credencial.');
        firebaseInitStatus = { success: true, method: 'file_path' };
        return;
      } catch (fileErr) {
        console.error('⚠️  Falha ao ler credencial do arquivo:', fileErr.message);
        firebaseInitStatus.error += ` | Falha ao ler arquivo: ${fileErr.message}`;
      }
    }
  }

  // Fallback: Application Default Credentials (ADC)
  try {
    admin.initializeApp();
    console.log('✅ Firebase Admin inicializado com ADC (Application Default Credentials).');
    firebaseInitStatus = { success: true, method: 'adc', error: firebaseInitStatus.error || 'Nenhum JSON fornecido' };
  } catch (err) {
    firebaseInitStatus = { success: false, method: 'none', error: `Falha geral no init: ${err.message}` };
  }
}

initializeFirebase();

const db = admin.firestore();
const auth = admin.auth();

// ───────────────────────── Express App ─────────────────────────

const app = express();

// ── Middlewares Globais ──

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://www.gstatic.com",
        "https://apis.google.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "https://cdn.tailwindcss.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://unpkg.com",
        "https://cdn.jsdelivr.net"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'",
        "https://*.googleapis.com",
        "https://*.firebaseio.com",
        "https://*.firebaseapp.com",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "wss://*.firebaseio.com",
        "https://www.gstatic.com"
      ],
      frameSrc: ["'self'", "https://*.firebaseapp.com"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

app.use(cors({
  origin: [
    'http://localhost:5000',
    'http://localhost:3000',
    'https://pegafreteadmin.vercel.app'
  ],
  credentials: true
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));

// ── Servidor Estático ──
app.use(express.static(path.join(__dirname, 'public')));

// ───────────────────────── Middleware de Autenticação ─────────────────────────

async function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);

    if (decodedToken.admin !== true) {
      return res.status(403).json({ error: 'Acesso negado. Permissão de administrador necessária.' });
    }

    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erro ao verificar token:', error.message);
    const initInfo = `[Init: ${firebaseInitStatus.method}, Error: ${firebaseInitStatus.error}]`;
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: `Token expirado. ${error.message} ${initInfo}` });
    }
    return res.status(401).json({ error: `Token inválido: ${error.message} ${initInfo}` });
  }
}

// ───────────────────────── Utilitários ─────────────────────────

async function logSecurityEvent(uid, event, details, page = 'admin-panel') {
  try {
    await db.collection('security_logs').add({
      uid,
      event,
      details,
      page,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Erro ao gravar log de segurança:', err.message);
  }
}

// ── DELETE /api/admin/logs ──
app.delete('/api/admin/logs', verifyAdminToken, async (req, res) => {
  try {
    const logsSnap = await db.collection('security_logs').get();
    const batch = db.batch();
    logsSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    await logSecurityEvent(req.user.uid, 'LOGS_CLEARED', 'Admin limpou o histórico de logs de segurança');
    return res.json({ success: true, message: 'Logs limpos com sucesso.' });
  } catch (error) {
    console.error('Erro ao limpar logs:', error);
    return res.status(500).json({ error: 'Erro ao limpar logs de segurança.' });
  }
});

// ───────────────────────── ROTAS DA API ─────────────────────────

// ── Rota de Setup-claims removida por segurança (Zero Trust) ──

// ── GET /api/admin/settings ──
app.get('/api/admin/settings', verifyAdminToken, async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('system_config').get();
    if (!doc.exists) {
      return res.json({ settings: { autoApproveDrivers: false } });
    }
    return res.json({ settings: doc.data() });
  } catch (error) {
    console.error('Erro em settings:', error);
    return res.status(500).json({ error: 'Erro ao buscar configurações.' });
  }
});

// ── POST /api/admin/settings ──
app.post('/api/admin/settings', verifyAdminToken, async (req, res) => {
  try {
    const { autoApproveDrivers } = req.body;
    await db.collection('settings').doc('system_config').set({ autoApproveDrivers }, { merge: true });
    await logSecurityEvent(req.user.uid, 'SETTINGS_UPDATE', `Aprovação Automática: ${autoApproveDrivers}`);
    return res.json({ message: 'Configurações salvas com sucesso.' });
  } catch (error) {
    console.error('Erro ao salvar settings:', error);
    return res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

// ── GET /api/admin/stats ──
app.get('/api/admin/stats', verifyAdminToken, async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const freightsSnap = await db.collection('freights').get();
    const logsSnap = await db.collection('security_logs').orderBy('timestamp', 'desc').limit(1).get();

    let shippers = 0;
    let drivers = 0;
    let pendingDocs = 0;

    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.role === 'shipper') shippers++;
      else if (data.role === 'driver') drivers++;
      if (data.documentStatus === 'pending' || data.docStatus === 'Pendente' || data.docStatus === 'Em Análise') pendingDocs++;
    });

    // Contagem de fretes por status
    const freightsByStatus = {};
    freightsSnap.forEach(doc => {
      const s = doc.data().status || 'unknown';
      freightsByStatus[s] = (freightsByStatus[s] || 0) + 1;
    });

    // Group freights by month (last 5 months)
    const monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthlyStats = [];
    
    // Create the last 5 months structure
    for (let i = 4; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthlyStats.push({
        monthName: monthsNames[d.getMonth()],
        year: d.getFullYear(),
        monthNum: d.getMonth(),
        count: 0
      });
    }

    freightsSnap.forEach(doc => {
      const data = doc.data();
      if (data.createdAt) {
        let date;
        if (typeof data.createdAt.toDate === 'function') {
          date = data.createdAt.toDate();
        } else if (data.createdAt._seconds) {
          date = new Date(data.createdAt._seconds * 1000);
        } else {
          date = new Date(data.createdAt);
        }
        
        if (date && !isNaN(date.getTime())) {
          const m = date.getMonth();
          const y = date.getFullYear();
          const found = monthlyStats.find(item => item.monthNum === m && item.year === y);
          if (found) {
            found.count++;
          }
        }
      }
    });

    return res.json({
      totalUsers: usersSnap.size,
      shippers,
      drivers,
      totalFreights: freightsSnap.size,
      freightsByStatus,
      pendingDocs,
      totalLogs: logsSnap.empty ? 0 : 'N/A',
      monthlyStats
    });
  } catch (error) {
    console.error('Erro em stats:', error);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

// ── GET /api/admin/pending-docs ──
app.get('/api/admin/pending-docs', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const pendingUsers = [];

    snapshot.forEach(doc => {
      const u = doc.data();
      const hasDocs = u.documentUrls && Object.keys(u.documentUrls).length > 0;
      const hasStatus = u.docStatus || u.documentStatus;
      
      if (hasDocs || hasStatus) {
        pendingUsers.push({
          uid: doc.id,
          name: u.nome || u.name,
          email: u.email,
          phone: u.telefone || u.phone,
          city: u.endereco || u.city,
          vehicle: u.veiculo || u.vehicle || (u.role === 'shipper' ? 'Embarcador' : 'Não informado'),
          antt: u.antt || 'Não informado',
          cnh: u.cnh || 'Não informado',
          placa: u.placa || 'Não informado',
          role: u.role,
          docStatus: u.docStatus || u.documentStatus || 'Pendente',
          documentUrls: u.documentUrls || {},
          documentStatuses: u.documentStatuses || {},
          createdAt: u.createdAt
        });
      }
    });

    return res.json({ pendingDocs: pendingUsers });
  } catch (error) {
    console.error('Erro em pending-docs:', error);
    return res.status(500).json({ error: 'Erro ao buscar documentos pendentes.' });
  }
});

// ── POST /api/admin/docs/:uid/status ──
app.post('/api/admin/docs/:uid/status', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { status, reason, documentStatuses } = req.body;
    
    if (!['Aprovado', 'Reprovado', 'Bloqueado', 'Pendente'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const role = userSnap.exists ? (userSnap.data().role || 'driver') : 'driver';

    const updateData = { 
      docStatus: status,
      documentStatus: status === 'Aprovado' ? 'verified' : (status === 'Reprovado' ? 'rejected' : 'pending')
    };
    if (reason) updateData.rejectionReason = reason;
    if (documentStatuses) updateData.documentStatuses = documentStatuses;

    await userRef.update(updateData);
    await logSecurityEvent(req.user.uid, 'DOC_STATUS_CHANGE', `Atualizou documentação de ${uid} para ${status}`);

    // Enviar notificação in-app
    let notificationText = '';
    if (status === 'Aprovado') {
      if (role === 'shipper') {
        notificationText = 'Boas notícias! Seus documentos foram validados e aprovados. Você agora tem acesso total para publicar novos fretes.';
      } else {
        notificationText = 'Boas notícias! Seus documentos foram validados e aprovados. Você agora tem acesso total para aceitar cargas e negociar fretes.';
      }
    } else if (status === 'Reprovado') {
      notificationText = `Atenção: Houve um problema na validação da sua documentação. Motivo: ${reason || 'Não informado'}. Acesse seu perfil para reenviar.`;
    } else if (status === 'Bloqueado') {
      notificationText = 'Sua conta foi bloqueada devido a irregularidades na documentação. Entre em contato com o suporte para mais detalhes.';
    }

    if (notificationText) {
      await db.collection('system_messages').add({
        userUid: uid,
        text: notificationText,
        sender: "Pega Frete",
        isMe: false,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.json({ message: 'Status atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    return res.status(500).json({ error: 'Erro ao atualizar status do documento.' });
  }
});

// ── GET /api/admin/users ──
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  try {
    const { role } = req.query;
    let query = db.collection('users');

    if (role && ['driver', 'shipper', 'admin'].includes(role)) {
      query = query.where('role', '==', role);
    }

    const snapshot = await query.get();
    const users = [];

    snapshot.forEach(doc => {
      users.push({ uid: doc.id, ...doc.data() });
    });

    return res.json({ users, total: users.length });
  } catch (error) {
    console.error('Erro em list users:', error);
    return res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// ── GET /api/admin/users/:uid ──
app.get('/api/admin/users/:uid', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Buscar dados do Firebase Auth
    let authUser = null;
    try {
      authUser = await auth.getUser(uid);
    } catch {
      // Usuário pode não existir no Auth
    }

    return res.json({
      uid,
      ...userDoc.data(),
      auth: authUser ? {
        email: authUser.email,
        emailVerified: authUser.emailVerified,
        disabled: authUser.disabled,
        lastSignIn: authUser.metadata.lastSignInTime,
        creationTime: authUser.metadata.creationTime,
        providers: authUser.providerData.map(p => p.providerId)
      } : null
    });
  } catch (error) {
    console.error('Erro em get user:', error);
    return res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
});

// ── PUT /api/admin/users/:uid ──
app.put('/api/admin/users/:uid', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;

    // Campos permitidos para atualização
    const allowedFields = [
      'name', 'email', 'phone', 'cpf', 'cnpj',
      'address', 'role', 'vehicle', 'documentStatus',
      'rating', 'entregas'
    ];

    const sanitized = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        sanitized[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    }

    sanitized.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    sanitized.updatedBy = req.user.uid;

    await db.collection('users').doc(uid).update(sanitized);

    await logSecurityEvent(
      req.user.uid,
      'USER_UPDATED',
      `Admin atualizou usuário ${uid}: ${Object.keys(sanitized).join(', ')}`
    );

    return res.json({ success: true, message: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro em update user:', error);
    return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// ── GET /api/admin/freights ──
app.get('/api/admin/freights', verifyAdminToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    let query = db.collection('freights').orderBy('createdAt', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }

    // Paginação simples via offset
    const offset = (pageNum - 1) * limitNum;
    const snapshot = await query.offset(offset).limit(limitNum).get();

    const freights = [];
    snapshot.forEach(doc => {
      freights.push({ id: doc.id, ...doc.data() });
    });

    // Total (para paginação)
    let totalQuery = db.collection('freights');
    if (status) {
      totalQuery = totalQuery.where('status', '==', status);
    }
    const countSnap = await totalQuery.count().get();
    const total = countSnap.data().count;

    return res.json({
      freights,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Erro em list freights:', error);
    return res.status(500).json({ error: 'Erro ao listar fretes.' });
  }
});

// ── PUT /api/admin/freights/:id ──
app.put('/api/admin/freights/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'status', 'status_pagamento', 'pagamento_liberado',
      'obs', 'valor', 'veiculo', 'tipo', 'distancia',
      'peso', 'volume', 'coleta', 'previsao', 'urgencia'
    ];

    const sanitized = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        sanitized[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    }

    sanitized.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    sanitized.updatedBy = req.user.uid;

    await db.collection('freights').doc(id).update(sanitized);

    await logSecurityEvent(
      req.user.uid,
      'FREIGHT_UPDATED',
      `Admin atualizou frete ${id}: ${Object.keys(sanitized).join(', ')}`
    );

    return res.json({ success: true, message: 'Frete atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro em update freight:', error);
    return res.status(500).json({ error: 'Erro ao atualizar frete.' });
  }
});

// ── DELETE /api/admin/freights/:id ──
app.delete('/api/admin/freights/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.collection('freights').doc(id).delete();

    await logSecurityEvent(
      req.user.uid,
      'FREIGHT_DELETED',
      `Admin removeu o frete ${id}`
    );

    return res.json({ success: true, message: 'Frete apagado com sucesso.' });
  } catch (error) {
    console.error('Erro em delete freight:', error);
    return res.status(500).json({ error: 'Erro ao apagar frete.' });
  }
});

// ── GET /api/admin/documents/pending ──
app.get('/api/admin/documents/pending', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users')
      .where('documentStatus', '==', 'pending')
      .get();

    const pending = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      pending.push({
        uid: doc.id,
        name: data.name || 'Sem nome',
        email: data.email || '',
        phone: data.phone || '',
        role: data.role || '',
        cpf: data.cpf || '',
        cnpj: data.cnpj || '',
        documentStatus: data.documentStatus,
        createdAt: data.createdAt
      });
    });

    return res.json({ pending, total: pending.length });
  } catch (error) {
    console.error('Erro em pending docs:', error);
    return res.status(500).json({ error: 'Erro ao buscar documentos pendentes.' });
  }
});

// ── POST /api/admin/documents/verify ──
app.post('/api/admin/documents/verify', verifyAdminToken, async (req, res) => {
  try {
    const { uid, status, reason } = req.body;

    if (!uid || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Campos obrigatórios: uid, status (verified|rejected).'
      });
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const role = userSnap.data().role || 'driver';

    const batch = db.batch();

    // 1. Atualizar status do documento no perfil do usuário
    batch.update(userRef, {
      documentStatus: status,
      docStatus: status === 'verified' ? 'Aprovado' : 'Reprovado',
      documentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      documentVerifierUid: req.user.uid
    });

    // 2. Notificar o usuário via system_messages
    const msgRef = db.collection('system_messages').doc();
    const notifTitle = status === 'verified'
      ? '✅ Documentos Aprovados'
      : '❌ Documentos Rejeitados';
    const notifMessage = status === 'verified'
      ? (role === 'shipper'
        ? 'Boas notícias! Seus documentos foram validados e aprovados. Você agora tem acesso total para publicar novos fretes.'
        : 'Boas notícias! Seus documentos foram validados e aprovados. Você agora tem acesso total para aceitar cargas e negociar fretes.')
      : `Seus documentos foram analisados e rejeitados. Motivo: ${reason || 'Não especificado'}. Por favor, envie novamente os documentos corretos.`;

    batch.set(msgRef, {
      userUid: uid,
      title: notifTitle,
      message: notifMessage,
      read: false,
      type: 'document_verification',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Log de auditoria
    const logRef = db.collection('security_logs').doc();
    batch.set(logRef, {
      uid: req.user.uid,
      event: 'DOCUMENT_VERIFIED',
      details: `Documento de ${uid} ${status}. ${reason ? 'Motivo: ' + reason : ''}`,
      page: 'admin-documents',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    return res.json({
      success: true,
      message: `Documento ${status === 'verified' ? 'aprovado' : 'rejeitado'} com sucesso.`
    });
  } catch (error) {
    console.error('Erro em document verify:', error);
    return res.status(500).json({ error: 'Erro ao verificar documento.' });
  }
});

// ── Limpeza de Token FCM Inválido ──
async function clearInvalidFcmToken(token) {
  try {
    const usersSnap = await db.collection('users').where('fcmToken', '==', token).get();
    const batch = db.batch();
    usersSnap.forEach(doc => {
      batch.update(doc.ref, {
        fcmToken: admin.firestore.FieldValue.delete(),
        fcmTokenUpdatedAt: admin.firestore.FieldValue.delete()
      });
    });

    const fcmSnap = await db.collection('fcm_tokens').where('token', '==', token).get();
    fcmSnap.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`[FCM] Token inválido limpo: ${token}`);
  } catch (err) {
    console.error('[FCM] Erro ao limpar token inválido:', err.message);
  }
}

// ── POST /api/admin/notifications/send ──
app.post('/api/admin/notifications/send', verifyAdminToken, async (req, res) => {
  try {
    const { targetUid, title, message, sendInternal = true, sendPush = false } = req.body;

    if (!targetUid || (!title && !message)) {
      return res.status(400).json({
        error: 'É necessário preencher o destinatário e pelo menos o título ou a mensagem.'
      });
    }

    const tTitle = title ? title.trim() : '';
    const tMessage = message ? message.trim() : '';

    let internalSentCount = 0;
    let pushSentCount = 0;
    let pushFailCount = 0;

    // Criar o documento de histórico de notificações em admin_notifications
    const notifRef = db.collection('admin_notifications').doc();
    const notificationId = notifRef.id;

    // ── 1. ENVIO INTERNO (DENTRO DO APP) ──
    if (sendInternal) {
      if (targetUid === 'all' || targetUid === 'shippers' || targetUid === 'drivers') {
        let usersQuery = db.collection('users');
        if (targetUid === 'shippers') {
          usersQuery = usersQuery.where('role', '==', 'shipper');
        } else if (targetUid === 'drivers') {
          usersQuery = usersQuery.where('role', '==', 'driver');
        }

        const usersSnap = await usersQuery.get();
        const batch = db.batch();
        let batchCount = 0;
        const batches = [batch];
        let currentBatch = batch;

        usersSnap.forEach(doc => {
          if (batchCount >= 499) {
            currentBatch = db.batch();
            batches.push(currentBatch);
            batchCount = 0;
          }

          const msgRef = db.collection('system_messages').doc();
          currentBatch.set(msgRef, {
            userUid: doc.id,
            title: tTitle,
            message: tMessage,
            read: false,
            type: targetUid === 'all' ? 'admin_broadcast' : (targetUid === 'shippers' ? 'admin_shippers_broadcast' : 'admin_drivers_broadcast'),
            notificationId: notificationId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          batchCount++;
          internalSentCount++;
        });

        for (const b of batches) {
          await b.commit();
        }
      } else {
        // Mensagem individual
        await db.collection('system_messages').add({
          userUid: targetUid,
          title: tTitle,
          message: tMessage,
          read: false,
          type: 'admin_notification',
          notificationId: notificationId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        internalSentCount = 1;
      }
    }

    // ── 2. ENVIO PUSH EXTERNO (FCM) ──
    if (sendPush) {
      const tokens = [];
      if (targetUid === 'all' || targetUid === 'shippers' || targetUid === 'drivers') {
        let fcmQuery = db.collection('fcm_tokens');
        if (targetUid === 'shippers') {
          fcmQuery = fcmQuery.where('role', '==', 'shipper');
        } else if (targetUid === 'drivers') {
          fcmQuery = fcmQuery.where('role', '==', 'driver');
        }
        const snap = await fcmQuery.get();
        snap.forEach(doc => {
          const data = doc.data();
          if (data.token) tokens.push(data.token);
        });

        // Fallback: Se a coleção global fcm_tokens não retornou nenhum token, busca na coleção users
        if (tokens.length === 0) {
          let usersQuery = db.collection('users').where('fcmToken', '!=', null);
          if (targetUid === 'shippers') {
            usersQuery = usersQuery.where('role', '==', 'shipper');
          } else if (targetUid === 'drivers') {
            usersQuery = usersQuery.where('role', '==', 'driver');
          }
          const usersSnap = await usersQuery.get();
          usersSnap.forEach(doc => {
            const data = doc.data();
            if (data.fcmToken) tokens.push(data.fcmToken);
          });
        }
      } else {
        // Usuário individual
        const fcmDoc = await db.collection('fcm_tokens').doc(targetUid).get();
        if (fcmDoc.exists && fcmDoc.data().token) {
          tokens.push(fcmDoc.data().token);
        } else {
          // Fallback para o documento do usuário
          const uDoc = await db.collection('users').doc(targetUid).get();
          if (uDoc.exists && uDoc.data().fcmToken) {
            tokens.push(uDoc.data().fcmToken);
          }
        }
      }

      if (tokens.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
          const batch = tokens.slice(i, i + BATCH_SIZE);
          const fcmMessage = {
            notification: {
              title: tTitle || 'PegaFrete',
              body: tMessage || ''
            },
            data: {
              click_action: '/',
              tag: 'pegafrete'
            },
            tokens: batch,
            android: {
              priority: 'high',
              notification: {
                sound: 'default',
                channelId: 'pegafrete_channel'
              }
            },
            webpush: {
              notification: {
                icon: '/pegafrete_logo_new.jpg',
                badge: '/favicon.svg',
                tag: 'pegafrete-notification'
              },
              fcmOptions: {
                link: '/'
              }
            }
          };

          try {
            const response = await admin.messaging().sendEachForMulticast(fcmMessage);
            pushSentCount += response.successCount;
            pushFailCount += response.failureCount;

            // Limpa tokens inativos assincronamente
            response.responses.forEach(async (resp, idx) => {
              if (!resp.success) {
                const errCode = resp.error?.code;
                if (errCode === 'messaging/registration-token-not-registered' || errCode === 'messaging/invalid-argument') {
                  await clearInvalidFcmToken(batch[idx]);
                }
              }
            });
          } catch (fcmErr) {
            console.error('[FCM] Erro ao disparar lote de push:', fcmErr);
          }
        }
      }
    }

    // Salva no histórico administrativo
    await notifRef.set({
      targetUid,
      title: tTitle,
      message: tMessage,
      sendInternal,
      sendPush,
      sentCount: sendInternal ? internalSentCount : pushSentCount,
      pushSentCount,
      pushFailCount,
      sentBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logSecurityEvent(
      req.user.uid,
      'NOTIFICATION_SENT',
      `Admin enviou notificação (${sendInternal ? 'Interna' : ''} ${sendPush ? 'Push' : ''}) para ${
        targetUid === 'all' ? 'todos' : (targetUid === 'shippers' ? 'embarcadores' : (targetUid === 'drivers' ? 'transportadores' : targetUid))
      }. Título: ${tTitle}. Interna: ${internalSentCount} enviadas. Push: ${pushSentCount} enviados (${pushFailCount} falhas).`
    );

    let finalMsg = '';
    if (sendInternal && sendPush) {
      finalMsg = `Mensagem interna enviada para ${internalSentCount} usuário(s) e Push enviado para ${pushSentCount} dispositivo(s).`;
    } else if (sendInternal) {
      finalMsg = `Mensagem interna enviada para ${internalSentCount} usuário(s).`;
    } else {
      finalMsg = `Notificação Push enviada para ${pushSentCount} dispositivo(s) (${pushFailCount} falhas).`;
    }

    return res.json({
      success: true,
      message: finalMsg,
      sentCount: internalSentCount || pushSentCount,
      pushSentCount,
      notification: {
        id: notificationId,
        targetUid,
        title: tTitle,
        message: tMessage,
        sentCount: internalSentCount || pushSentCount,
        pushSentCount,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Erro em send notification:', error);
    return res.status(500).json({ error: 'Erro ao enviar notificação.' });
  }
});

// ── GET /api/admin/notifications ──
app.get('/api/admin/notifications', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await db.collection('admin_notifications')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const notifications = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        targetUid: data.targetUid,
        title: data.title || '',
        message: data.message || '',
        sentCount: data.sentCount || 0,
        sentBy: data.sentBy || '',
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      });
    });

    // Populate view statistics
    await Promise.all(notifications.map(async (notif) => {
      try {
        const msgsSnap = await db.collection('system_messages')
          .where('notificationId', '==', notif.id)
          .get();
        
        let views = 0;
        let nonViews = 0;
        
        msgsSnap.forEach(msgDoc => {
          if (msgDoc.data().read === true) views++;
          else nonViews++;
        });
        
        notif.views = views;
        notif.nonViews = nonViews;
        
        const total = views + nonViews;
        notif.viewPercentage = total > 0 ? Math.round((views / total) * 100) : 0;
        
      } catch (err) {
        console.error('Error fetching stats for notif', notif.id, err);
        notif.views = 0;
        notif.nonViews = 0;
        notif.viewPercentage = 0;
      }
    }));

    return res.json({ notifications, total: notifications.length });
  } catch (error) {
    console.error('Erro em get notifications history:', error);
    return res.status(500).json({ error: 'Erro ao buscar histórico de notificações.' });
  }
});

// ── DELETE /api/admin/notifications/:id ──
app.delete('/api/admin/notifications/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Remover do admin_notifications
    const notifRef = db.collection('admin_notifications').doc(id);
    const notifDoc = await notifRef.get();
    
    if (!notifDoc.exists) {
      return res.status(404).json({ error: 'Notificação não encontrada no histórico.' });
    }

    const notifData = notifDoc.data();

    // 2. Remover todas as system_messages correspondentes
    const messagesSnap = await db.collection('system_messages')
      .where('notificationId', '==', id)
      .get();

    const batch = db.batch();
    let batchCount = 0;
    const batches = [batch];
    let currentBatch = batch;

    messagesSnap.forEach(doc => {
      if (batchCount >= 499) {
        currentBatch = db.batch();
        batches.push(currentBatch);
        batchCount = 0;
      }
      currentBatch.delete(doc.ref);
      batchCount++;
    });

    for (const b of batches) {
      await b.commit();
    }

    // 3. Excluir o documento principal do histórico
    await notifRef.delete();

    await logSecurityEvent(
      req.user.uid,
      'NOTIFICATION_DELETED',
      `Admin removeu a notificação ${id}. Título: ${notifData.title || 'Nenhum'}`
    );

    return res.json({
      success: true,
      message: 'Notificação e mensagens correspondentes apagadas com sucesso.'
    });
  } catch (error) {
    console.error('Erro em delete notification:', error);
    return res.status(500).json({ error: 'Erro ao apagar notificação.' });
  }
});

// ── POST /api/admin/roles ──
app.post('/api/admin/roles', verifyAdminToken, async (req, res) => {
  try {
    const { email, uid, role } = req.body;
    let targetUid = uid;

    if (email && !targetUid) {
      try {
        const userRecord = await auth.getUserByEmail(email);
        targetUid = userRecord.uid;
      } catch (err) {
        return res.status(404).json({ error: 'Usuário não encontrado com este email no Authentication.' });
      }
    }

    if (!targetUid) {
      return res.status(400).json({ error: 'Email ou UID obrigatório.' });
    }

    const validRoles = ['owner', 'editor', 'viewer'];
    const assignedRole = validRoles.includes(role) ? role : 'viewer';

    await auth.setCustomUserClaims(targetUid, { admin: true, adminRole: assignedRole });

    await db.collection('admins').doc(targetUid).set({
      email: email || '',
      uid: targetUid,
      role: assignedRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      addedBy: req.user.uid
    }, { merge: true });

    await logSecurityEvent(
      req.user.uid,
      'ADMIN_ADDED_OR_UPDATED',
      `Admin configurado: ${targetUid} com cargo de ${assignedRole}`
    );

    return res.json({ success: true, message: `Administrador (${assignedRole}) configurado com sucesso!` });
  } catch (error) {
    console.error('Erro ao configurar admin:', error);
    return res.status(500).json({ error: 'Erro ao configurar cargo administrativo.' });
  }
});

// ── GET /api/admin/admins ──
app.get('/api/admin/admins', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await db.collection('admins').get();
    const adminsList = [];
    snapshot.forEach(doc => {
      adminsList.push({ id: doc.id, ...doc.data() });
    });
    return res.json({ admins: adminsList });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao listar administradores.' });
  }
});

// ── DELETE /api/admin/roles/:uid ──
app.delete('/api/admin/roles/:uid', verifyAdminToken, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    if (targetUid === req.user.uid) {
      return res.status(400).json({ error: 'Você não pode remover seu próprio acesso.' });
    }

    await auth.setCustomUserClaims(targetUid, { admin: false });
    await db.collection('admins').doc(targetUid).delete();

    await logSecurityEvent(
      req.user.uid,
      'ADMIN_REMOVED',
      `Acesso administrativo removido do UID: ${targetUid}`
    );

    return res.json({ success: true, message: 'Acesso revogado com sucesso.' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao revogar acesso.' });
  }
});
app.get('/api/admin/logs', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await db.collection('security_logs')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const logs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        uid: data.uid || '',
        event: data.event || '',
        details: data.details || '',
        page: data.page || '',
        timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
      });
    });

    return res.json({ logs, total: logs.length });
  } catch (error) {
    console.error('Erro em logs:', error);
    return res.status(500).json({ error: 'Erro ao buscar logs.' });
  }
});

// ───────────────────────── Catch-all (SPA) ─────────────────────────

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ───────────────────────── Start Server ─────────────────────────

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n🚀 PegaFrete Admin Server rodando na porta ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});

module.exports = app;
