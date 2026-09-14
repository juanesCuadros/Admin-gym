# Apple Human Interface Guidelines — Principios de Diseño para Sitios Web de Gestión de Pagos y Acciones

> Documento generado para uso de IAs como guía de diseño.  
> Fuente: [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)  
> Adaptado específicamente para: dashboards financieros, portales de pagos, gestión de transacciones, módulos de acciones y flujos de cobro.

---

## 1. PRINCIPIOS FUNDAMENTALES

Estos ocho principios son la base de toda decisión de diseño. Cada elemento del sistema debe poder justificarse en función de ellos.

### 1.1 Propósito (Purpose)
- Diseña con intención. Pregunta constantemente: **¿para qué existe esta pantalla?**
- Identifica qué es lo más importante para el usuario (ver su saldo, hacer un pago, revisar un historial) y haz que eso sea brillante.
- Evita features por feature. Cada elemento debe ganarse su lugar en la interfaz.
- **Aplicado a pagos:** La acción principal (pagar, transferir, aprobar) debe ser visible y accesible de inmediato. Elimina fricción innecesaria antes de que el usuario llegue a esa acción.

### 1.2 Agencia (Agency)
- El usuario usa tu producto para lograr sus metas. **No te interpongas.**
- Permite exploración libre sin bloquear flujos. Si necesitas un flujo guiado, haz que sea fácil saltarse o escapar de él.
- **Recuperación de errores:** Cuando los usuarios saben que pueden deshacer una acción o volver a un estado anterior, se sienten libres de explorar. Diseña el perdón: recuperarse de lo inesperado no debe costar tiempo ni trabajo al usuario.
- **Aplicado a pagos:** Un pago fallido debe poder reintentarse en un clic. Una transferencia en proceso debe poder cancelarse si aún es posible. Cada acción destructiva o irreversible debe tener confirmación y, cuando sea posible, opción de deshacer.

### 1.3 Responsabilidad (Responsibility)
- Tu trabajo impacta la vida de personas reales. En pagos, un error tiene consecuencias directas.
- Sé completamente transparente sobre lo que hace tu producto y por qué.
- Solicita solo los permisos y datos que realmente necesitas para funcionar.
- Cuando recopilas datos, explica exactamente qué recopilas y cómo los usas.
- **Aplicado a pagos:** Muestra siempre: montos exactos, comisiones, tasas de conversión, y fechas de procesamiento antes de confirmar. Nunca ocultes costos hasta el último paso.

### 1.4 Familiaridad (Familiarity)
- Las personas traen conocimiento del mundo real y de otras aplicaciones. Aprovecha eso.
- Usa patrones ya establecidos: tablas de transacciones, estados de cuenta, formularios de tarjeta, badges de estado.
- Una vez que estableces un comportamiento o apariencia para un elemento, aplícalo en todo el diseño.
- Da retroalimentación clara y consistente: muestra cuándo los controles están disponibles, indica cuando el contenido cambia, usa patrones del sistema para alertas.
- **Aplicado a pagos:** El ícono de candado para seguridad, el ícono de tarjeta para métodos de pago, el color verde para exitoso y rojo para error son convenciones que los usuarios ya conocen. Respétalas.

### 1.5 Flexibilidad (Flexibility)
- Las personas usan tu software de formas únicas. Entre más tu diseño lo reconozca, más bienvenidos se sentirán.
- Diseña para todos: toma en cuenta la diversidad de personas, perspectivas y necesidades.
- Trata la accesibilidad como una prioridad desde el inicio, no como un parche posterior.
- Considera múltiples métodos de entrada: teclado, touch, voz.
- **Aplicado a pagos:** Un portal financiero puede ser usado por una persona mayor con visión reducida, por alguien en un dispositivo móvil con una mano, o por un contador en pantalla grande. El diseño debe funcionar para todos.

### 1.6 Simplicidad (Simplicity)
- La simplicidad no es minimalismo. Es una experiencia enfocada que mantiene lo importante cerca.
- Elimina lo innecesario. Cada elemento debe ganar su lugar.
- Sé conciso en el texto: cuando encuentras la forma más simple de decir algo, suele ser la más universal y útil.
- Establece jerarquía visual clara para que los usuarios sepan dónde están y qué viene después.
- **Aplicado a pagos:** Un resumen de transacción no necesita mostrar 15 columnas. Muestra: fecha, descripción, monto, estado. El resto puede estar en el detalle.

### 1.7 Craft (Calidad)
- Cada elemento refleja cuánto te importa la experiencia.
- Sé deliberado con cada decisión: tipografía precisa, animaciones suaves, texto bien redactado.
- Prototipa temprano, prueba enfoques nuevos, descarta lo que no funciona.
- El shipping no es la línea de llegada. Mantén la interfaz actualizada con las capacidades de la plataforma.
- **Aplicado a pagos:** Un estado de carga mal hecho destruye la confianza. Un mensaje de error vago genera ansiedad. El detalle en los micro-momentos define la percepción de calidad y seguridad.

### 1.8 Deleite (Delight)
- Las personas recuerdan cómo las hizo sentir un producto.
- Identifica la emoción que quieres inspirar. Un portal de pagos debe inspirar **confianza**, **control** y **claridad**.
- No confundas deleite con decoración. El deleite no puede interponerse al propósito central.
- Cada interacción es una oportunidad para mostrar qué representa tu software.
- **Aplicado a pagos:** Una animación de éxito al confirmar un pago, un resumen claro post-transacción, o un mensaje empático en caso de error son micro-momentos de deleite que construyen confianza.

---

## 2. COLOR

### 2.1 Principios de uso del color
- Usa el color de forma **consistente** para comunicar lo mismo siempre. Si el color azul indica una acción, no lo uses para texto decorativo.
- Nunca uses solo el color para diferenciar estados o comunicar información crítica. Añade texto, íconos o formas.
- Asegúrate de que todos los colores funcionen en modo claro, oscuro y de alto contraste.
- Prueba los colores bajo diferentes condiciones de iluminación.

### 2.2 Contraste y accesibilidad
| Tamaño de texto | Peso | Ratio de contraste mínimo |
|----------------|------|--------------------------|
| Hasta 17pt | Cualquiera | 4.5:1 |
| 18pt o más | Cualquiera | 3:1 |
| Cualquier tamaño | Bold | 3:1 |

- Usa calculadoras de contraste (WCAG AA) para verificar combinaciones.
- Proporciona variantes de alto contraste cuando sea necesario.

### 2.3 Semántica del color para portales financieros
- **Verde / positivo:** saldo a favor, transacción exitosa, pago confirmado.
- **Rojo / negativo:** error, cargo, deuda, acción destructiva.
- **Amarillo / advertencia:** pendiente, en revisión, próximo a vencer.
- **Azul / neutro-acción:** botones de acción principal, enlaces, elementos interactivos.
- **Gris / inactivo:** elementos deshabilitados, información secundaria.
- ⚠️ **Importante:** El rojo/verde tiene significado inverso en algunas culturas (ej: China usa rojo para positivo en finanzas). Si el producto es internacional, considera iconografía adicional.

### 2.4 Color en jerarquía de fondo (iOS/web equivalente)
- **Nivel primario:** fondo general de la vista.
- **Nivel secundario:** agrupaciones de contenido (cards, secciones).
- **Nivel terciario:** agrupaciones dentro de las secundarias (sub-cards, campos).

### 2.5 Botones y color de acento
- Usa color de acento en el botón de la **acción más probable** en cada vista.
- Máximo 1-2 botones con color de acento por vista para no generar sobrecarga cognitiva.
- Las acciones destructivas usan rojo del sistema, no el color de acento.
- No asignes rol "primario" a botones destructivos, aunque sean la acción más probable.

---

## 3. TIPOGRAFÍA

### 3.1 Principios generales
- El texto es parte esencial de la experiencia de usuario, no decoración.
- Usa tamaños de fuente recomendados por plataforma para garantizar legibilidad.
- Soporta ajuste dinámico de tamaño de texto (Dynamic Type en iOS, escalado en web).
- Los pesos más gruesos son más fáciles de leer en tamaños pequeños.

### 3.2 Tamaños recomendados
| Plataforma | Tamaño por defecto | Tamaño mínimo |
|-----------|-------------------|---------------|
| iOS/iPadOS | 17pt | 11pt |
| macOS | 13pt | 10pt |
| Web (equivalente) | ~16-17px | ~11-12px |

### 3.3 Jerarquía tipográfica para portales de pagos
```
H1 — Título de sección/página:        32–40px, Bold
H2 — Subtítulo / nombre de módulo:    24–28px, Semibold
H3 — Encabezado de card/tabla:        18–20px, Medium
Body — Contenido principal:            15–17px, Regular
Secondary — Labels, metadatos:         13–14px, Regular
Caption — Hints, notas al pie:         11–12px, Regular o Light
Monospace — Números de cuenta, IDs:    13–15px, Monospace
```

### 3.4 Reglas para portales financieros
- Usa fuente **monoespaciada** para números de cuenta, IBANs, CVVs, IDs de transacción. Elimina ambigüedad.
- Los montos deben ser siempre legibles y bien alineados (alineación derecha en tablas).
- No uses pesos de fuente muy delgados (Thin/Ultralight) para información crítica.
- Texto de acción en botones: usa Title Case (Primera Letra En Mayúscula) para acciones, Sentence case para descripciones.

---

## 4. LAYOUT Y JERARQUÍA VISUAL

### 4.1 Principios de layout
- Agrupa elementos relacionados usando espacio negativo, fondos, colores, materiales o líneas separadoras.
- La información más importante debe estar visible de inmediato, sin hacer scroll en la mayoría de casos.
- Extiende el contenido para llenar el espacio disponible. No dejes áreas vacías sin justificación.
- Diferencia claramente los controles del contenido con jerarquía visual consistente.

### 4.2 Jerarquía visual
- Coloca los elementos más importantes en la parte superior y lado izquierdo (en culturas de lectura izquierda→derecha).
- Alinea componentes para hacer el contenido escaneable y comunicar organización.
- Usa **progressive disclosure**: no muestres toda la información a la vez. Revela detalle bajo demanda.
- Deja suficiente espacio alrededor de los controles: mínimo 12pt para elementos con borde, 24pt para elementos sin borde.

### 4.3 Tamaño mínimo de controles
| Plataforma | Tamaño por defecto | Tamaño mínimo |
|-----------|-------------------|---------------|
| iOS/iPadOS (touch) | 44×44pt | 28×28pt |
| macOS (cursor) | 28×28pt | 20×20pt |
| Web (touch) | 44×44px | 32×32px |
| Web (cursor) | 24×24px | 20×20px |

### 4.4 Grid y espaciado para dashboards financieros
```
Padding de contenedor:     16–24px
Gap entre cards:           12–16px
Padding interno de card:   16–20px
Espacio entre secciones:   32–48px
Ancho máximo de contenido: 1200–1440px
Columnas en desktop:       12 columnas
Columnas en tablet:        8 columnas
Columnas en mobile:        4 columnas
```

### 4.5 Adaptabilidad
- Diseña para que el layout se adapte graciosamente a diferentes tamaños de pantalla.
- Mantén posiciones de contenido y controles consistentes y predecibles al cambiar de dispositivo.
- Prepárate para cambios de tamaño de texto (Dynamic Type / escalado de accesibilidad).
- Prueba siempre en los tamaños de layout más grande y más pequeño.

---

## 5. ACCESIBILIDAD

### 5.1 Cuatro dimensiones de accesibilidad

**Visión:**
- Soporta textos más grandes (hasta 200% de tamaño original).
- Verifica contraste en modo claro, oscuro y alto contraste.
- Nunca transmitas información solo con color. Añade iconografía, texto o formas.
- Proporciona texto alternativo para imágenes y gráficos (VoiceOver / screen readers).

**Audición:**
- No dependas solo de audio para comunicar información crítica.
- Añade señales visuales cuando uses cues auditivos (éxito, error, alerta).

**Motricidad:**
- Controles con área de toque suficiente (mínimo 44×44px en touch).
- Espacio suficiente entre controles para evitar toques accidentales (~12pt de padding).
- Usa gestos simples para acciones frecuentes. Ofrece alternativas a gestos complejos.
- Soporta navegación completa por teclado (Tab, Enter, Escape, flechas).

**Cognición:**
- Mantén acciones simples e intuitivas usando gestos e interacciones conocidas.
- Minimiza elementos de interfaz con auto-dismiss por tiempo.
- Permite que el usuario controle el audio/video (no autoplay).
- Reduce animaciones complejas para usuarios con preferencia de movimiento reducido.

### 5.2 Reglas críticas para portales financieros
- Todos los campos de formulario deben tener labels visibles, no solo placeholders (los placeholders desaparecen al escribir).
- Los estados de error deben ser perceptibles: cambio de color + ícono + texto descriptivo.
- El flujo de pago completo debe ser navegable por teclado sin usar mouse.
- Los números de cuenta y montos deben ser legibles por screen readers (sin guiones que confundan la pronunciación, o con aria-label adecuado).
- Los mensajes de confirmación y error deben anunciarse a lectores de pantalla (aria-live o roles ARIA apropiados).

---

## 6. BOTONES Y CONTROLES

### 6.1 Principios de botones
- Un botón comunica su función mediante: estilo visual, contenido (texto/ícono) y rol semántico.
- Siempre incluye un estado de presión/hover para botones personalizados.
- El área mínima de toque es 44×44pt para asegurar selección fácil con cualquier método de entrada.

### 6.2 Jerarquía de botones
```
Primario (Primary):    Acción más importante de la vista. Color de acento. Máximo 1–2 por vista.
Secundario:            Acción complementaria. Borde o fondo neutro.
Terciario / Ghost:     Acción de menor peso. Solo texto o borde sutil.
Destructivo:           Elimina datos o es irreversible. Color rojo del sistema.
Cancelar:              Cancela la acción actual. Nunca rojo.
```

### 6.3 Reglas de uso
- Usa estilo, **no tamaño**, para distinguir la opción preferida entre múltiples opciones de mismo nivel.
- No asignes rol primario a botones destructivos aunque sean la acción más probable.
- Limita los botones prominentes a 1–2 por vista para reducir carga cognitiva.
- Los labels de botones deben comenzar con un verbo: "Pagar", "Confirmar", "Transferir", "Cancelar orden".
- Evita labels vagos: "OK", "Aceptar", "Listo" son menos informativos que "Confirmar pago", "Guardar cambios".

### 6.4 Estados de botón que debes implementar
```
Default    → apariencia normal
Hover      → retroalimentación al pasar el cursor
Pressed    → retroalimentación al hacer clic/tap
Focus      → visible para navegación por teclado (outline claro)
Disabled   → visualmente atenuado, no clickeable
Loading    → indicador de actividad dentro del botón (ej: "Procesando…")
```

### 6.5 Botones en flujos de pago
- El botón de "Confirmar pago" debe ser el más prominente de la pantalla.
- Muestra un **estado de carga** inmediatamente al hacer clic en "Confirmar" mientras se procesa.
- Deshabilita el botón durante el procesamiento para evitar doble envío.
- Tras el éxito, cambia a estado de "Pago exitoso" con retroalimentación visual clara.

---

## 7. ESCRITURA Y CONTENIDO (UX WRITING)

### 7.1 Voz de la aplicación
- Define la voz antes de escribir cualquier texto. Para un portal de pagos: **confiable, claro, directo, humano pero profesional.**
- Crea un glosario de términos comunes y úsalos consistentemente en toda la interfaz.
- Adapta el tono al contexto: no es lo mismo un mensaje de éxito que un mensaje de error.

### 7.2 Mejores prácticas
- **Sé claro:** Elige palabras fácilmente comprensibles. Si puedes usar menos palabras, hazlo.
- **Escribe para todos:** Usa lenguaje simple, evita jerga técnica y terminología que excluye.
- **Orientación a la acción:** Usa voz activa. Labels de botones y links deben usar verbos.
- **Construye patrones de lenguaje:** Consistencia construye familiaridad.
- **Capitalización consistente:** Elige entre Title Case o sentence case por tipo de elemento y mantenlo uniforme.

### 7.3 Reglas específicas para flujos financieros

**Mensajes de error:**
- ✅ "El número de tarjeta ingresado no es válido. Revisa los 16 dígitos."
- ❌ "Error 4012: campo inválido."
- ✅ "Tu sesión expiró por seguridad. Inicia sesión nuevamente para continuar."
- ❌ "Error de autenticación."
- Muestra el error **junto al campo** que lo genera, no solo arriba del formulario.
- Describe qué hacer para corregirlo, no solo qué salió mal.
- Evita interjecciones: "¡Ups!" o "¡Vaya!" suenan insinceras en un contexto financiero.

**Flujos de múltiples pasos:**
- Indica el inicio: "Comenzar transferencia", "Configurar pago".
- Indica progreso: "Continuar" o "Siguiente" (consistente durante todo el flujo).
- Indica el final: "Confirmar y pagar", "Finalizar", "Listo".

**Campos de formulario:**
- Labels claros y visibles en todo momento (no solo como placeholder).
- Placeholder como ejemplo: "ej. 4242 4242 4242 4242" o "nombre@ejemplo.com".
- Guía inline al usuario sobre el formato esperado.
- Nunca uses placeholders como sustitutos del label.

**Mensajes de éxito:**
- Sé específico: "Transferencia de $50.000 COP a Juan García enviada exitosamente."
- Incluye la próxima acción: "Ver comprobante" o "Volver al inicio".

**Estados vacíos:**
- Un historial vacío no es un problema, es una oportunidad de onboarding.
- Explica qué hace esa sección y cómo comenzar: "Aquí verás tus transacciones. Realiza tu primer pago para comenzar."

---

## 8. PRIVACIDAD Y SEGURIDAD (CRÍTICO EN PAGOS)

### 8.1 Principios fundamentales de privacidad
- Solicita acceso solo a los datos que realmente necesitas.
- Sé completamente transparente sobre cómo usas los datos desde el primer momento.
- Procesa datos en el dispositivo/servidor seguro donde sea posible, evitando round-trips innecesarios.
- Adopta protecciones de privacidad del sistema y mejores prácticas de seguridad.

### 8.2 Solicitud de permisos
- Solicita permiso **solo cuando tu app claramente lo necesita**, no al inicio por defecto.
- Espera a que el usuario muestre interés en la feature que requiere el permiso.
- Escribe textos de propósito claros: frase activa, completa, específica y fácil de entender.
- ✅ "Usamos tu ubicación para detectar pagos sospechosos fuera de tu zona habitual."
- ❌ "Se necesita acceso a la ubicación para una mejor experiencia."

### 8.3 Protección de datos
- **Nunca almacenes contraseñas u información sensible en texto plano.**
- Usa almacenamiento seguro (keychain, encrypted storage) para datos sensibles.
- Para autenticación: prefiere passkeys, Face ID, Touch ID sobre contraseñas solas.
- Usa autenticación de dos factores para operaciones críticas (transferencias grandes, cambio de contraseña, cambio de cuenta bancaria).
- Evita inventar esquemas de autenticación propios cuando existen estándares.

### 8.4 Transparencia en portales de pago
- Muestra claramente antes de confirmar:
  - Monto exacto a pagar/transferir
  - Comisiones y cargos adicionales
  - Tiempo estimado de procesamiento
  - Última instancia de cancelación
- Indica el nivel de seguridad: HTTPS, PCI DSS, cifrado de extremo a extremo (sin términos técnicos innecesarios para el usuario final).
- Muestra siempre el número parcial de la tarjeta (**** **** **** 4242) para que el usuario confirme qué tarjeta usará.

---

## 9. MOVIMIENTO Y ANIMACIÓN

### 9.1 Principios de movimiento
- Añade movimiento **con propósito**, no como decoración.
- Las animaciones deben ser breves y precisas — ligeras y no intrusivas.
- Ofrece siempre la opción de reducir animaciones (Reduce Motion / `prefers-reduced-motion`).
- El movimiento nunca debe ser la única forma de comunicar información importante.
- Permite que los usuarios cancelen o interrumpan animaciones.

### 9.2 Movimiento funcional vs. decorativo
```
Funcional (siempre implementar):
  - Transición entre pasos del flujo de pago (indica progreso)
  - Aparición de mensajes de error/éxito (atrae atención)
  - Estado de carga de botón (retroalimentación de procesamiento)
  - Colapso/expansión de detalles de transacción
  
Decorativo (implementar con cuidado):
  - Animaciones de celebración al completar un pago (breve, una sola vez)
  - Transiciones entre secciones del dashboard
  - Efectos hover en cards de resumen
```

### 9.3 Retroalimentación animada
- Si una acción no se completa instantáneamente, muestra un indicador de actividad.
- La retroalimentación de movimiento debe seguir los gestos y expectativas del usuario.
- Usa animaciones de fade en lugar de movimiento físico para reubicaciones de objetos.
- Duración recomendada para micro-animaciones: 150ms–300ms. Nunca más de 500ms para feedback.

### 9.4 Respeta `prefers-reduced-motion`
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 10. PATRONES ESPECÍFICOS PARA PORTALES FINANCIEROS

### 10.1 Dashboard principal
- **Información de primer orden:** saldo total, movimientos recientes, alertas activas.
- **Información de segundo orden:** detalles de cada cuenta, próximos pagos.
- **Información de tercer orden (bajo demanda):** historial completo, reportes, configuración.
- Usa cards/widgets para agrupar información relacionada.
- El saldo principal debe ser el elemento más prominente visualmente.
- Incluye un acceso rápido a las acciones más frecuentes (pagar, transferir, recargar).

### 10.2 Tabla de transacciones
**Columnas recomendadas (en orden de prioridad visual):**
```
1. Estado         → badge de color + texto (Exitoso, Pendiente, Fallido)
2. Fecha          → formato relativo para recientes ("Hace 2 horas"), absoluto para antiguas
3. Descripción    → nombre del comercio, tipo de transacción
4. Categoría      → ícono + texto (opcional)
5. Monto          → alineado a la derecha, moneda explícita, color según tipo (ingreso/egreso)
6. Acciones       → ver detalle, descargar comprobante
```

- Diferencia visualmente ingresos (+) y egresos (−) con color Y signo Y posición.
- Permite filtrar por fecha, estado, monto, tipo.
- Ofrece búsqueda de texto libre para encontrar transacciones por nombre.
- Paginación o carga infinita con lazy loading.

### 10.3 Flujo de pago (multi-step)
**Estructura recomendada:**
```
Paso 1: Seleccionar destinatario / método de pago
Paso 2: Ingresar monto y concepto
Paso 3: Revisar resumen completo (monto, comisión, destinatario, método)
Paso 4: Confirmar con autenticación (PIN, biometría, 2FA)
Paso 5: Resultado (éxito o error con acción clara)
```

**Reglas del flujo:**
- Muestra un **indicador de progreso** claro (stepper) durante todo el flujo.
- Permite volver al paso anterior sin perder los datos ingresados.
- En el paso de revisión, muestra TODA la información relevante antes de confirmar.
- El botón de confirmación debe estar siempre visible, nunca requiriendo scroll en mobile.
- Tras la confirmación, deshabilita el botón inmediatamente para evitar doble envío.
- El resultado debe incluir: número de referencia, monto, fecha, y acciones (comprobante, volver al inicio).

### 10.4 Formularios
- Cada campo debe tener label visible (no solo placeholder).
- Valida en tiempo real cuando el usuario termina de escribir en un campo (on blur), no en cada keystroke.
- Agrupa campos relacionados con separadores visuales o secciones con título.
- Autoformatea campos conocidos: número de tarjeta (grupos de 4), teléfono, montos.
- Campos opcionales marcados como "(Opcional)", no los obligatorios como "(Requerido)" — invierte el supuesto.
- Nunca borres el contenido de un campo al mostrar un error de validación.

### 10.5 Estados de la interfaz
Implementa todos estos estados para cada vista y componente:
```
Cargando (Loading):      Skeleton screens o spinners. Nunca pantalla en blanco.
Vacío (Empty):           Ilustración + texto explicativo + acción primaria.
Error (Error):           Mensaje claro + causa + acción de recuperación.
Sin conexión (Offline):  Banner de notificación + funcionalidad offline donde sea posible.
Éxito (Success):         Confirmación visual + resumen de lo completado + próximo paso.
Advertencia (Warning):   Banner/toast no bloqueante para información importante no crítica.
```

### 10.6 Notificaciones y alertas
- Usa el nivel correcto de alerta según urgencia e importancia:
  - **Alert modal:** requiere acción inmediata, bloquea el flujo (uso excepcional).
  - **Toast / Snackbar:** feedback transitorio no crítico (éxito, información).
  - **Banner inline:** errores de validación de formulario, advertencias persistentes.
  - **Notificación push:** eventos fuera de la app (pago recibido, alerta de seguridad).

- Regla de oro: ¿El usuario NECESITA actuar ahora? → Alert. ¿Solo necesita saber? → Toast.
- Los mensajes de error en formularios van **junto al campo afectado**, no solo arriba.

---

## 11. MODO OSCURO (DARK MODE)

- Diseña siempre ambas variantes: modo claro y modo oscuro.
- No inviertas simplemente los colores — recrea la paleta para cada modo.
- Los colores semánticos (éxito, error, advertencia) deben ajustarse para mantener contraste en ambos modos.
- Las sombras en modo oscuro deben ser más sutiles o reemplazadas por bordes sutiles.
- Los números y montos deben ser igualmente legibles en ambos modos.

```css
/* Ejemplo de estructura CSS variables */
:root {
  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F5F5F5;
  --color-text-primary: #1C1C1E;
  --color-text-secondary: #6C6C70;
  --color-success: #34C759;
  --color-error: #FF3B30;
  --color-warning: #FF9500;
  --color-action: #007AFF;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-primary: #1C1C1E;
    --color-bg-secondary: #2C2C2E;
    --color-text-primary: #FFFFFF;
    --color-text-secondary: #8E8E93;
    --color-success: #30D158;
    --color-error: #FF453A;
    --color-warning: #FF9F0A;
    --color-action: #0A84FF;
  }
}
```

---

## 12. CHECKLIST DE DISEÑO ANTES DE IMPLEMENTAR

Usa esta lista para revisar cada vista o componente antes de desarrollarlo:

### Propósito y contenido
- [ ] ¿Está claro el propósito principal de esta pantalla?
- [ ] ¿La acción más importante es visualmente la más prominente?
- [ ] ¿Se puede eliminar algún elemento sin perder funcionalidad?

### Accesibilidad
- [ ] ¿Todos los textos tienen contraste suficiente (4.5:1 para texto pequeño)?
- [ ] ¿La información crítica se comunica con más de solo color?
- [ ] ¿Todos los controles tienen área de toque ≥44×44px?
- [ ] ¿El flujo completo es navegable por teclado?
- [ ] ¿Los campos de formulario tienen labels visibles (no solo placeholders)?
- [ ] ¿Los estados de error son descriptivos y accionables?

### Interacción
- [ ] ¿Los botones tienen todos sus estados (default, hover, pressed, focus, disabled, loading)?
- [ ] ¿Los formularios validan en tiempo real (on blur)?
- [ ] ¿Los campos sensibles tienen autoformato (tarjeta, teléfono, monto)?
- [ ] ¿Las acciones destructivas o irreversibles tienen confirmación?
- [ ] ¿El usuario puede deshacer o cancelar donde sea posible?

### Retroalimentación
- [ ] ¿Cada acción tiene retroalimentación visual inmediata?
- [ ] ¿Los estados de carga están implementados (skeleton / spinner)?
- [ ] ¿Los estados vacíos tienen orientación al usuario?
- [ ] ¿Los mensajes de error aparecen junto al elemento afectado?

### Escritura
- [ ] ¿Los labels de botones comienzan con un verbo?
- [ ] ¿El tono es consistente con la voz definida de la aplicación?
- [ ] ¿Los mensajes de error describen la causa Y la solución?
- [ ] ¿Se usa lenguaje simple, sin jerga innecesaria?

### Privacidad y seguridad
- [ ] ¿Se muestran todos los costos y comisiones antes de confirmar?
- [ ] ¿Los datos sensibles están enmascarados cuando no son necesarios?
- [ ] ¿Las acciones críticas requieren confirmación de identidad (PIN/biometría)?
- [ ] ¿La pantalla de confirmación muestra toda la información relevante?

---

## REFERENCIAS

- [Apple Human Interface Guidelines — Design Principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Apple HIG — Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG — Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Apple HIG — Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
- [Apple HIG — Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
