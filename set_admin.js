/**
 * PegaFrete Admin — Script de Promoção de Administrador Seguro
 * 
 * Este script roda localmente via terminal usando a chave privada (Service Account)
 * para promover um usuário a administrador com toda a segurança.
 * Não expõe nenhuma rota pública no servidor para isso.
 * 
 * Uso:
 *   node set_admin.js email@exemplo.com
 *   ou
 *   node set_admin.js USER_UID
 */

const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const credentialEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!credentialEnv) {
  console.error('❌ ERRO: FIREBASE_SERVICE_ACCOUNT_JSON não configurado no seu arquivo .env');
  process.exit(1);
}

// Inicializa o Firebase Admin SDK
try {
  let serviceAccount;
  if (credentialEnv.startsWith('{')) {
    serviceAccount = JSON.parse(credentialEnv);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else {
    serviceAccount = require(path.resolve(credentialEnv));
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin inicializado com sucesso.');
} catch (e) {
  console.error('❌ Erro ao inicializar o Firebase Admin:', e.message);
  process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

async function promoteUser() {
  const target = process.argv[2];

  if (!target) {
    console.log('\n📖 Como usar:');
    console.log('  node set_admin.js "usuario@email.com"');
    console.log('  ou');
    console.log('  node set_admin.js "UID_DO_USUARIO"\n');
    process.exit(0);
  }

  let userRecord;
  try {
    if (target.includes('@')) {
      console.log(`🔍 Buscando usuário por email: ${target}...`);
      userRecord = await auth.getUserByEmail(target);
    } else {
      console.log(`🔍 Buscando usuário por UID: ${target}...`);
      userRecord = await auth.getUser(target);
    }
  } catch (err) {
    console.error('❌ Usuário não encontrado no Firebase Authentication:', err.message);
    process.exit(1);
  }

  const uid = userRecord.uid;
  console.log(`👤 Usuário localizado: ${userRecord.email || 'Sem email'} (UID: ${uid})`);

  try {
    // 1. Configura a Custom Claim no Firebase Auth
    console.log('⚙️  Definindo custom claims { admin: true }...');
    await auth.setCustomUserClaims(uid, { admin: true });

    // 2. Atualiza a role para 'admin' no Firestore
    console.log('💾 Atualizando documento de usuário no Firestore...');
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      await userRef.update({ 
        role: 'admin',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await userRef.set({ 
        role: 'admin', 
        email: userRecord.email || '',
        name: userRecord.displayName || 'Admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    console.log(`\n🎉 SUCESSO! O usuário ${userRecord.email || uid} agora é um Administrador.`);
    console.log('💡 IMPORTANTE: Se o usuário estiver logado, ele precisa fazer Logout e Login novamente para carregar as novas permissões.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao definir permissões de administrador:', error.message);
    process.exit(1);
  }
}

promoteUser();
