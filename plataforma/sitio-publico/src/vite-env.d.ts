/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_DOMINIO_BASE?: string
  readonly VITE_CONTACTO_WHATSAPP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
