/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Contacto de MVC mostrado en /bloqueado. */
  readonly VITE_MVC_CONTACTO?: string;
  /**
   * Submódulos activos en este despliegue, separados por comas. Vacío = todos.
   * Acepta ids de módulo (`caja`) o de submódulo (`caja.punto_de_venta`); ver `src/navegacion.ts`.
   */
  readonly VITE_MODULOS_ACTIVOS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
