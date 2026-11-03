import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

/**
 * Firebase web configuration is supplied exclusively through environment
 * variables (VITE_FIREBASE_*). No API keys or project identifiers are checked
 * into the repository — see .env.example for the full list.
 *
 * Note: the Firebase web apiKey is not a server secret (it ships to browsers),
 * but committing per-project identifiers still leaks infrastructure details
 * and makes rotating a project painful. Keep them in the environment.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Whether the Firebase web SDK has enough configuration to initialize.
 * Google sign-in is gracefully disabled when this is false.
 */
export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app: FirebaseApp | null = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
  } catch (err) {
    console.error('[firebase] Failed to initialize the Firebase web SDK:', err);
  }
} else {
  console.warn(
    '[firebase] VITE_FIREBASE_* environment variables are not set. Google sign-in is unavailable.'
  );
}

export const auth: Auth | null = app ? getAuth(app) : null;
export const googleProvider = new GoogleAuthProvider();

// Customize Google Provider scopes if needed
googleProvider.setCustomParameters({
  prompt: 'select_account',
});
