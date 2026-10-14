/** Configuración de compilación del sitio público (ver .env.example). */
export const API_URL = import.meta.env.VITE_API_URL || '/api/v1'
export const DOMINIO_BASE = import.meta.env.VITE_DOMINIO_BASE || 'gymdeskcolombia.com'
/** Solo dígitos con indicativo (ej. 57XXXXXXXXXX). Vacío: no hay WhatsApp de contacto configurado. */
export const CONTACTO_WHATSAPP = (import.meta.env.VITE_CONTACTO_WHATSAPP || '').replace(/\D/g, '')

export function enlaceWhatsApp(texto?: string): string | null {
  if (!CONTACTO_WHATSAPP) return null
  const base = `https://wa.me/${CONTACTO_WHATSAPP}`
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base
}
