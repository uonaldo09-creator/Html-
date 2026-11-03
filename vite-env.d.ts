/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Enable only against a verified isolated Convex staging deployment. */
  readonly VITE_CONVEX_AUTH_ENABLED?: string;
  readonly VITE_CONVEX_URL?: string;
  /** Firebase web SDK configuration (all optional — Google sign-in is disabled when unset). */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
