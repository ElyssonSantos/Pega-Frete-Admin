require('dotenv').config();
const admin = require('firebase-admin');

let credentialEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

try {
    if (!credentialEnv) {
        console.error('FIREBASE_SERVICE_ACCOUNT_JSON não encontrado.');
        process.exit(1);
    }
    try {
        if (credentialEnv.startsWith('"') && credentialEnv.endsWith('"')) {
            credentialEnv = credentialEnv.slice(1, -1);
        }
        if (credentialEnv.startsWith("'") && credentialEnv.endsWith("'")) {
            credentialEnv = credentialEnv.slice(1, -1);
        }
        const parsed = JSON.parse(credentialEnv);
        if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        admin.initializeApp({ credential: admin.credential.cert(parsed) });
    } catch (e) {
        admin.initializeApp({ credential: admin.credential.cert(credentialEnv) });
    }
    console.log('Firebase Admin inicializado com sucesso.');
} catch (e) {
    console.error('Erro na inicialização do Firebase:', e.message);
    process.exit(1);
}

const db = admin.firestore();

async function migrateLegacyMessages() {
    console.log('Buscando mensagens do sistema...');
    const allMessages = await db.collection('system_messages').get();
  
    const legacyMessages = [];
    allMessages.forEach(doc => {
        const data = doc.data();
        // Identifica mensagens que não estão vinculadas a um admin_notification
        if (!data.notificationId && data.type && data.type.startsWith('admin')) {
            legacyMessages.push({ id: doc.id, ...data });
        }
    });

    console.log(`Encontradas ${legacyMessages.length} mensagens antigas (legadas).`);
    if(legacyMessages.length === 0) return;
  
    // Agrupa por título e mensagem
    const grouped = {};
    legacyMessages.forEach(msg => {
        const key = `${msg.title || ''}_|_${msg.message || ''}`;
        if (!grouped[key]) {
            grouped[key] = {
                title: msg.title,
                message: msg.message,
                createdAt: msg.createdAt,
                type: msg.type,
                messages: []
            };
        }
        grouped[key].messages.push(msg.id);
    });

    const batches = [db.batch()];
    let currentBatch = 0;
    let opsCount = 0;
    let count = 0;
  
    const addOp = () => {
        opsCount++;
        // Limite Firestore é 500 operações por batch
        if (opsCount >= 490) {
            batches.push(db.batch());
            currentBatch++;
            opsCount = 0;
        }
    };

    for (const key in grouped) {
        const group = grouped[key];
        const notifRef = db.collection('admin_notifications').doc();
        let targetUid = 'legacy';
        
        if (group.type === 'admin_broadcast') targetUid = 'all';
        else if (group.type === 'admin_shippers_broadcast') targetUid = 'shippers';
        else if (group.type === 'admin_drivers_broadcast') targetUid = 'drivers';
        else if (group.type === 'admin_notification') targetUid = 'individual'; // we don't have the target easily, but we can assume

        batches[currentBatch].set(notifRef, {
            targetUid,
            title: group.title || '',
            message: group.message || '',
            sentCount: group.messages.length,
            sentBy: 'sistema_legado',
            createdAt: group.createdAt || admin.firestore.FieldValue.serverTimestamp()
        });
        addOp();

        group.messages.forEach(msgId => {
            batches[currentBatch].update(db.collection('system_messages').doc(msgId), {
                notificationId: notifRef.id
            });
            addOp();
            count++;
        });
    }

    console.log(`Processando migração em ${batches.length} lote(s)...`);
    for(const batch of batches) {
        await batch.commit(); 
    }
  
    console.log(`Migradas ${count} mensagens para ${Object.keys(grouped).length} registros de notificação no painel administrativo.`);
}

migrateLegacyMessages()
    .then(() => process.exit(0))
    .catch(e => {
        console.error('Erro durante a migração:', e);
        process.exit(1);
    });
