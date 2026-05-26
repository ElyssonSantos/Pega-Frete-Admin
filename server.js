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

// ───────────────────────── Firebase Admin Init ─────────────────────────

function initializeFirebase() {
  const credentialEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (credentialEnv) {
    try {
      // Tenta parsear como JSON string
      const parsed = JSON.parse(credentialEnv);
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
      console.log('✅ Firebase Admin inicializado com JSON da env.');
      return;
    } catch {
      // Se falhar, tenta como caminho de arquivo
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const serviceAccount = require(path.resolve(credentialEnv));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('✅ Firebase Admin inicializado com arquivo de credencial.');
        return;
      } catch (fileErr) {
        console.error('⚠️  Falha ao ler credencial do arquivo:', fileErr.message);
      }
    }
  }

  // Fallback: Application Default Credentials (ADC)
  admin.initializeApp();
  console.log('✅ Firebase Admin inicializado com ADC (Application Default Credentials).');
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
    'http://127.0.0.1:5000',
    /\.vercel\.app$/
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
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
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

// ───────────────────────── ROTAS DA API ─────────────────────────

// ── POST /api/admin/setup-claims ──
// Bootstrap: promove UID para admin usando secret
app.post('/api/admin/setup-claims', async (req, res) => {
  try {
    const { uid, secret } = req.body;

    if (!uid || !secret) {
      return res.status(400).json({ error: 'Campos uid e secret são obrigatórios.' });
    }

    if (secret !== process.env.ADMIN_SETUP_SECRET) {
      return res.status(403).json({ error: 'Secret inválido.' });
    }

    // Define Custom Claims
    await auth.setCustomUserClaims(uid, { admin: true });

    // Atualiza role no Firestore
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      await userRef.update({ role: 'admin' });
    } else {
      await userRef.set({ role: 'admin', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    await logSecurityEvent(uid, 'ADMIN_CLAIM_SET', 'Usuário promovido a admin via setup-claims');

    return res.json({
      success: true,
      message: `Usuário ${uid} agora é administrador. O usuário deve fazer logout e login novamente para ativar as permissões.`
    });
  } catch (error) {
    console.error('Erro em setup-claims:', error);
    return res.status(500).json({ error: 'Erro interno ao configurar claims.' });
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
      if (data.documentStatus === 'pending') pendingDocs++;
    });

    // Contagem de fretes por status
    const freightsByStatus = {};
    freightsSnap.forEach(doc => {
      const s = doc.data().status || 'unknown';
      freightsByStatus[s] = (freightsByStatus[s] || 0) + 1;
    });

    return res.json({
      totalUsers: usersSnap.size,
      shippers,
      drivers,
      totalFreights: freightsSnap.size,
      freightsByStatus,
      pendingDocs,
      totalLogs: logsSnap.empty ? 0 : 'N/A'
    });
  } catch (error) {
    console.error('Erro em stats:', error);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
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
      'obs', 'valor'
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

    const batch = db.batch();

    // 1. Atualizar status do documento no perfil do usuário
    const userRef = db.collection('users').doc(uid);
    batch.update(userRef, {
      documentStatus: status,
      documentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      documentVerifierUid: req.user.uid
    });

    // 2. Notificar o usuário via system_messages
    const msgRef = db.collection('system_messages').doc();
    const notifTitle = status === 'verified'
      ? '✅ Documentos Aprovados'
      : '❌ Documentos Rejeitados';
    const notifMessage = status === 'verified'
      ? 'Seus documentos foram analisados e aprovados pela equipe PegaFrete. Você já pode acessar todos os recursos da plataforma.'
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

// ── POST /api/admin/notifications/send ──
app.post('/api/admin/notifications/send', verifyAdminToken, async (req, res) => {
  try {
    const { targetUid, title, message } = req.body;

    if (!targetUid || !title || !message) {
      return res.status(400).json({
        error: 'Campos obrigatórios: targetUid (uid ou "all"), title, message.'
      });
    }

    let sentCount = 0;

    if (targetUid === 'all') {
      // Broadcast para todos
      const usersSnap = await db.collection('users').get();
      const batch = db.batch();
      let batchCount = 0;

      const batches = [batch];
      let currentBatch = batch;

      usersSnap.forEach(doc => {
        if (batchCount >= 499) {
          // Firestore batch limit: 500
          currentBatch = db.batch();
          batches.push(currentBatch);
          batchCount = 0;
        }

        const msgRef = db.collection('system_messages').doc();
        currentBatch.set(msgRef, {
          userUid: doc.id,
          title,
          message,
          read: false,
          type: 'admin_broadcast',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        batchCount++;
        sentCount++;
      });

      for (const b of batches) {
        await b.commit();
      }
    } else {
      // Mensagem individual
      await db.collection('system_messages').add({
        userUid: targetUid,
        title,
        message,
        read: false,
        type: 'admin_notification',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      sentCount = 1;
    }

    await logSecurityEvent(
      req.user.uid,
      'NOTIFICATION_SENT',
      `Admin enviou notificação para ${targetUid === 'all' ? 'todos (' + sentCount + ' usuários)' : targetUid}. Título: ${title}`
    );

    return res.json({
      success: true,
      message: `Notificação enviada para ${sentCount} usuário(s).`,
      sentCount
    });
  } catch (error) {
    console.error('Erro em send notification:', error);
    return res.status(500).json({ error: 'Erro ao enviar notificação.' });
  }
});

// ── GET /api/admin/logs ──
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
