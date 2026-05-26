const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const credentialEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccount = require(path.resolve(credentialEnv));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

async function checkUser() {
  const email = 'elyssongamer@gmail.com';
  console.log(`Checking user: ${email}`);
  
  try {
    const userRecord = await auth.getUserByEmail(email);
    console.log('Firebase Auth User:');
    console.log(JSON.stringify({
      uid: userRecord.uid,
      email: userRecord.email,
      customClaims: userRecord.customClaims,
      displayName: userRecord.displayName,
      disabled: userRecord.disabled,
      providers: userRecord.providerData.map(p => p.providerId)
    }, null, 2));

    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    if (userDoc.exists) {
      console.log('\nFirestore User Document:');
      console.log(JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.log('\nFirestore User Document does NOT exist for UID:', userRecord.uid);
    }
  } catch (error) {
    console.error('Error checking user:', error.message);
  }
}

checkUser().then(() => process.exit(0));
