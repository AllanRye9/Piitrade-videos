/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin for split deployments (e.g. frontend on Vercel). Empty = same-origin. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
