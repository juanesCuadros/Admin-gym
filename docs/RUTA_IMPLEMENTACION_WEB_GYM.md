# Ruta de Implementación: Web-Gym (Landing Page Pública Multi-Tenant)

> **Documento de Arquitectura y Especificación Técnica**  
> **Proyecto:** `Web-Gym` (Sitio Web Público y Personalizable para cada Gimnasio)  
> **Ubicación:** Carpeta independiente en la raíz: `/Web-Gym` (desacoplada de `Admin-gym` y `Super-admin`)  
> **Objetivo:** Proporcionar a cada gimnasio cliente su propia página web moderna, personalizable, ultra rápida y con enlace directo a WhatsApp, sin tener que programar una web diferente para cada cliente.

---

## 1. Visión y Concepto del Proyecto

Cada gimnasio que adquiere el sistema contará automáticamente con su propia página web accesible vía:
- **Subdominio automático:** `https://<subdominio>.gymos.io` (ejemplo: `powergym.gymos.io`, `titangym.gymos.io`).
- **Ruta alternativa:** `https://gymos.io/gym/<landing_slug>`.
- **Dominio propio (Fase posterior opcional):** `https://powergym.com`.

La aplicación `Web-Gym` será un **proyecto frontend independiente**, ligero, optimizado para conversión (atraer nuevos socios) y con diseño de primer nivel ("efecto WOW") que refleje la energía del gimnasio.

---

## 2. Solución al Dilema de los Colores y Contraste (La Regla de Oro)

El usuario planteó una duda muy importante de diseño:
> *"No sé si los colores por las letras puede que queden letras en fondos negros o del mismo color, o qué sugieres..."*

Si permites que un dueño de gimnasio elija colores arbitrariamente para el fondo y para el texto, ocurre el "Efecto MySpace": pueden elegir letras negras sobre fondo negro, o rojo fluorescente sobre verde, haciendo que la web sea ilegible y se vea poco profesional.

### La Solución Técnica Profesional:
Para garantizar que **la web siempre se vea hermosa, legible y profesional**, implementaremos tres capas de protección:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SISTEMA INTELIGENTE DE COLOR Y CONTRASTE             │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Estructura Fija de Superficies:                                     │
│    • El usuario elige el ESTILO BASE: Modo Oscuro (Dark) o Modo Claro  │
│    • Los fondos y textos principales están curados por diseño.         │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Color de Marca (Primary & Accent):                                  │
│    • El gimnasio solo elige su Color Primario (ej. Rojo, Naranja, Azul)│
│    • Este color se aplica a BOTONES, DETALLES, BORDES e INSIGNIAS.     │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Algoritmo WCAG de Luminancia Relativa (Auto-Contrast):              │
│    • La web calcula en tiempo real el contraste del botón.             │
│    • Si eligen un amarillo claro -> El texto del botón se vuelve NEGRO.│
│    • Si eligen un azul oscuro -> El texto del botón se vuelve BLANCO.  │
│    • ¡Es imposible que quede texto ilegible o del mismo color!        │
└────────────────────────────────────────────────────────────────────────┘
```

#### Fórmula del Algoritmo de Luminancia (WCAG 2.1):
```typescript
export function getOptimalTextColor(hexColor: string): '#FFFFFF' | '#0F172A' {
  // Convertir HEX a RGB
  const rgb = hexToRgb(hexColor);
  // Calcular luminancia relativa según estándar WCAG
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  // Si el fondo es claro (> 0.55), texto oscuro; si es oscuro, texto blanco
  return luminance > 0.55 ? '#0F172A' : '#FFFFFF';
}
```

#### Presets Curados de 1 Clic (Recomendados):
En el panel del administrador (`Configuración MyGymOS`), se le ofrecen combinaciones ya validadas por diseñadores, más un selector libre:
1. **Iron Dark:** Fondo negro grafito (`#090D16`), acentos rojo fuego (`#E11D48`), texto blanco.
2. **Titan Gold:** Fondo oscuro (`#0B0F19`), acentos ámbar / oro (`#F59E0B`), texto blanco.
3. **Cyberpunk Neon:** Fondo azul noche (`#030712`), acentos cian brillante (`#06B6D4`), texto blanco.
4. **Emerald Wellness:** Fondo blanco marfil (`#F8FAFC`), acentos verde esmeralda (`#10B981`), texto grafito.
5. **Personalizado:** El usuario ingresa su color HEX exacto, y el sistema ajusta el contraste automáticamente.

---

## 3. Arquitectura del Proyecto `Web-Gym`

### Estructura en el Monorepo / Workspace
```text
FitApp/
├── Admin-gym/             # Panel del gimnasio (Jefe, Recepción, Entrenador)
├── Super-admin/           # Panel del dueño del SaaS
└── Web-Gym/               # [NUEVO] Frontend público independiente de las Landings
    ├── public/            # Favicon, assets estáticos genéricos
    ├── src/
    │   ├── api/           # Consumo de datos públicos desde gym-jefe-api
    │   │   ├── client.ts
    │   │   └── landing.service.ts
    │   ├── components/    # Secciones modulares de la Landing
    │   │   ├── hero/      # Portada impactante con CTA a WhatsApp
    │   │   ├── planes/    # Tarjetas con precios y características
    │   │   ├── horarios/  # Horarios semanales e indicador "Abierto Ahora"
    │   │   ├── galeria/   # Carrusel / Grid de fotos de las instalaciones
    │   │   ├── clases/    # Clases grupales disponibles
    │   │   ├── ubicacion/ # Dirección, Google Maps y contacto
    │   │   ├── navbar/    # Barra de navegación con logo del gym
    │   │   ├── footer/    # Redes sociales y branding
    │   │   └── ui/        # Botón flotante WhatsApp, badges, modales
    │   ├── contexts/      # TenantContext (resuelve subdominio y tokens)
    │   ├── hooks/         # useTenantLanding, useColorContrast
    │   ├── styles/        # CSS variables dinámicas y diseño responsive
    │   │   ├── index.css  # Tokens de diseño y reset
    │   │   └── landing.css
    │   ├── utils/         # Cálculo de contraste WCAG, formateo de moneda
    │   ├── App.tsx        # Router y orquestador
    │   └── main.tsx
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── Dockerfile
```

---

## 4. Secciones que Tendrá Cada Página Web

Cada gimnasio tendrá una página web estructurada para convertir visitantes en clientes:

| Sección | Contenido Dinámico Proveniente del Backend |
| :--- | :--- |
| **1. Header / Navbar** | Logo del gimnasio, nombre, botón de acceso rápido y botón flotante de WhatsApp. |
| **2. Hero (Portada)** | Título motivacional, banner de fondo del gimnasio, indicador en vivo:  <br>`🟢 ABIERTO AHORA` o `🔴 CERRADO HASTA LAS 06:00 AM`. |
| **3. Planes y Tarifas** | Tarjetas con los planes de membresía vigentes (mes, trimestre, año), lista de beneficios, plan recomendado/más vendido y botón *"Quiero este plan"* que abre WhatsApp con el plan preseleccionado. |
| **4. Galería / Instalaciones** | Mosaico visual de fotos del gimnasio (pesas, cardio, vestidores, zona funcional) con vista ampliada (lightbox). |
| **5. Clases Grupales** | Muestra de clases disponibles (Spinning, Funcional, Cross, Yoga) para que los prospectos vean la variedad. |
| **6. Horarios de Atención** | Horarios detallados de Lunes a Domingo y festivos. |
| **7. Ubicación y Contacto** | Dirección física, teléfono, ciudad, integración con enlace de Google Maps / Waze. |
| **8. Redes y Footer** | Enlaces directos a su Instagram, Facebook y WhatsApp oficial. |

---

## 5. Endpoints de Soporte en el Backend (`gym-jefe-api`)

Para alimentar la página web sin comprometer la seguridad ni exponer datos privados, crearemos un endpoint público consolidado:

### `GET /api/v1/public/landing/{subdominio}`
Endpoint público de alto rendimiento (cacheable):
```json
{
  "gimnasio_id": "9d8ed8dc-e879-4c43-bc84-43b80b0f0fe8",
  "nombre": "PowerGym Iron Club",
  "subdominio": "powergym",
  "descripcion": "El mejor centro de entrenamiento de fuerza y acondicionamiento de la ciudad.",
  "logo_url": "https://cdn.gymos.io/logos/powergym.png",
  "banner_url": "https://cdn.gymos.io/banners/powergym.jpg",
  "colores": {
    "primary": "#E11D48",
    "secondary": "#F43F5E",
    "accent": "#F59E0B",
    "theme_mode": "dark"
  },
  "contacto": {
    "direccion": "Calle 45 # 12-34",
    "ciudad": "Medellín",
    "telefono": "+57 300 123 4567",
    "whatsapp": "573001234567",
    "instagram": "powergym_med",
    "facebook": "powergymmedellin"
  },
  "horarios": {
    "lunes_viernes": "05:00 - 22:00",
    "sabados": "07:00 - 18:00",
    "domingos_festivos": "08:00 - 14:00"
  },
  "galeria": [
    "https://cdn.gymos.io/galeria/img1.jpg",
    "https://cdn.gymos.io/galeria/img2.jpg"
  ],
  "planes": [
    {
      "id": "uuid-plan-1",
      "nombre": "Plan Mensual VIP",
      "precio": 120000,
      "duracion_dias": 30,
      "descripcion": "Acceso ilimitado a todas las zonas y clases grupales.",
      "destacado": true
    }
  ]
}
```

---

## 6. Ruta de Implementación Paso a Paso (Roadmap)

### Fase 1: Creación del Proyecto `Web-Gym`
1. Inicializar el proyecto en la carpeta raíz `Web-Gym` con **Vite + React 19 + TypeScript**.
2. Configurar la estructura de estilos con soporte para tokens dinámicos en CSS (`--primary`, `--primary-contrast`, `--bg-body`, etc.).
3. Implementar el módulo `utils/contrast.ts` con el algoritmo WCAG de luminancia relativa.

### Fase 2: Motor de Resolución Multi-Tenant
1. Crear el `TenantContext.tsx` que detecta automáticamente el subdominio:
   - En producción: lee `window.location.hostname` (ej. `powergym.gymos.io` $\to$ subdominio = `powergym`).
   - En desarrollo local: permite probar mediante query param `?subdomain=powergym` o preset predeterminado.
2. Inyectar dinámicamente las variables de color en `:root` al cargar los datos del gimnasio.

### Fase 3: Componentes de la Landing Page
1. **Hero & Navbar:** Con botón flotante persistente de WhatsApp.
2. **Pricing Cards (Planes):** Renderizado elegante de membresías con botón interactivo de compra/información.
3. **Sección de Horarios:** Con cálculo automático en vivo si el gimnasio está abierto o cerrado en ese instante según la hora local de Colombia.
4. **Galería de Fotos:** Con visor modal ampliado.
5. **Ubicación y Footer:** Con mapa y enlaces a redes sociales.

### Fase 4: Integración y Backend
1. Consolidar el endpoint `GET /api/v1/public/landing/{subdominio}` en `Admin-gym/producto/gym-jefe-api` conectando `platform.tenant`, `superadmin.gimnasios`, `superadmin.gimnasio_galeria` y `platform.planes`.
2. Habilitar CORS en FastAPI para permitir llamadas desde el dominio de la landing.

### Fase 5: Conexión con el Panel del Jefe (`gym-jefe-web`)
1. En la pantalla de [`ConfiguracionPage.tsx`](file:///c:/Users/Nitro%205/Documents/Juan/ProyectosMVC/FitApp/Admin-gym/producto/gym-jefe-web/src/pages/configuracion/ConfiguracionPage.tsx), agregar un botón **"Ver Mi Página Web"** y un previsualizador en vivo donde el Jefe vea en tiempo real cómo luce su página web cuando cambia el logo o los colores.

### Fase 6: Despliegue en Servidor (Nginx & Docker)
1. Crear `Dockerfile` ligero con Nginx para servir `Web-Gym`.
2. Configurar Nginx wildcard en el VPS (`*.gymos.io`) para que cualquier subdominio nuevo apunte automáticamente al contenedor de `Web-Gym` sin necesidad de reiniciar Nginx ni crear configuraciones manuales por cliente.
