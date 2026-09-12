# Inventario Completo de Endpoints — GymOS API (v1)

Este documento sirve como mapa integral de integración entre el Backend (`FastAPI`) y el Frontend (`React + Vite + TypeScript` SaaS Multi-Tenant).

### Resumen de Módulos
- **Total Endpoints Registrados en OpenAPI:** 87 endpoints.
- **Módulos con Lógica de Negocio y RLS Completa:** Módulos 00 a 07 (Autenticación, Control de Ingreso, Pantalla TV, Caja, Deportistas, Membresías, Entrenamiento, Clases).
- **Módulos Scaffolded (Listos para integrar):** Módulos 08 a 11 (Inventario, Personal, Reportes, Configuración MyGymOS).

| Módulo | Endpoint | Método | Autenticación | Request | Response | Estado de integración |
| ------ | -------- | ------ | ------------- | ------- | -------- | --------------------- |
| 00. Autenticación y Autorización | `/api/v1/auth/login` | **POST** | Pública | `body` | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/refresh` | **POST** | Pública | `body` | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/logout` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/recuperar-password/solicitar` | **POST** | Pública | `body` | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/recuperar-password/confirmar` | **POST** | Pública | `body` | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/me` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/permisos/matriz` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 1 |
| 00. Autenticación y Autorización | `/api/v1/auth/permisos/matriz` | **PUT** | Bearer | `body` | `array` | Backend Listo · Conectar en Fase 1 |
| 01. Control de Ingreso | `/api/v1/control-ingreso/checkin-manual` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 01. Control de Ingreso | `/api/v1/control-ingreso/checkin-huella` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 01. Control de Ingreso | `/api/v1/control-ingreso/cortesia` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 01. Control de Ingreso | `/api/v1/control-ingreso/ingresos-hoy` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 01. Control de Ingreso | `/api/v1/control-ingreso/evaluar-acceso/{deportista_id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 02. Pantalla TV | `/api/v1/pantalla-tv/display/{subdominio}` | **GET** | Pública | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 02. Pantalla TV | `/api/v1/pantalla-tv/config` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 02. Pantalla TV | `/api/v1/pantalla-tv/config` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 02. Pantalla TV | `/api/v1/pantalla-tv/regenerar-token` | **POST** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 02. Pantalla TV | `/api/v1/pantalla-tv/test-saludo` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/turnos/abrir` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/turnos/actual` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/turnos/cerrar` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/turnos/{turno_id}/cierre-forzado` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/turnos/{turno_id}/movimientos` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/ventas` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/ventas/{venta_id}/anular` | **POST** | Bearer | `body` | `object` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/pagos-membresia` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/pagos-membresia/{pago_id}/anular` | **POST** | Bearer | `body` | `object` | Backend Listo · Conectar en Fase 3 |
| 03. Caja y Turnos | `/api/v1/caja/egresos` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/buscar` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/estado` | **PATCH** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/invitacion-app` | **POST** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/mediciones` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/mediciones` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/huellas` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/huellas/{dedo}` | **DELETE** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 04. Deportistas y Biometría | `/api/v1/deportistas/{id}/suprimir-datos` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/planes` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/planes` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/planes/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/planes/{id}` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/planes/{id}/estado` | **PATCH** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/asignar` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/deportista/{deportista_id}` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/{id}/cambiar-plan` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/{id}/cancelar` | **POST** | Bearer | `body` | `object` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/{id}/congelar` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 05. Membresías y Planes | `/api/v1/membresias/{id}/descongelar` | **POST** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/ejercicios` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/ejercicios` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/ejercicios/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/ejercicios/{id}` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/ejercicios/{id}/estado` | **PATCH** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/plantillas` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/plantillas` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/plantillas/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/plantillas/{id}` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/plantillas/{id}` | **DELETE** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/asignar-rutina` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/deportistas/{deportista_id}/rutinas` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/rutinas-asignadas/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/rutinas-asignadas/{id}/estado` | **PATCH** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 06. Entrenamiento y Ejercicios | `/api/v1/entrenamiento/rutinas-asignadas/{id}/personalizar` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}` | **PUT** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/cancelar` | **PATCH** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/reservas` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/reservas` | **GET** | Bearer | - | `array` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{clase_id}/reservas/{reserva_id}` | **DELETE** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/asistencia` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/asistencia` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/cerrar` | **POST** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/calificaciones` | **POST** | Bearer | `body` | `ok` | Backend Listo · Conectar en Fase 3 |
| 07. Clases y Reservas | `/api/v1/clases/{id}/calificaciones` | **GET** | Bearer | - | `ok` | Backend Listo · Conectar en Fase 3 |
| 08. Inventario y Stock | `/api/v1/inventario/status` | **GET** | Pública | - | `ok` | Scaffolded Backend · Preparado |
| 09. Personal y Staff | `/api/v1/personal/status` | **GET** | Pública | - | `ok` | Scaffolded Backend · Preparado |
| 10. Reportes y Métricas | `/api/v1/reportes/status` | **GET** | Pública | - | `ok` | Scaffolded Backend · Preparado |
| 11. Configuración MyGymOS | `/api/v1/my-gym/status` | **GET** | Pública | - | `ok` | Scaffolded Backend · Preparado |
| Health | `/health` | **GET** | Pública | - | `ok` | Operativo |
| Root | `/` | **GET** | Pública | - | `ok` | Operativo |
