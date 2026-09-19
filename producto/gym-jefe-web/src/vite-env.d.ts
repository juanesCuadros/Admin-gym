/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Contacto de MVC mostrado en /bloqueado. */
  readonly VITE_MVC_CONTACTO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
