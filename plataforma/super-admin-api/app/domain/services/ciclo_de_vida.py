"""Constantes del ciclo de vida del gimnasio en el SaaS (requisitos SA §2)."""

# §2.4 y SA-RF-30/31: el enlace de exportación vale 30 días y la eliminación definitiva
# se habilita a los 30 días de la cancelación.
DIAS_RETENCION_CANCELADO = 30

# §2.2: "prueba_por_vencer" en el panel = estado prueba y 0 ≤ corte − hoy ≤ 2.
DIAS_AVISO_PRUEBA = 2

# Estados calculados que devuelve platform.estado_suscripcion().
ESTADOS_CALCULADOS = ("al_dia", "por_vencer", "en_gracia", "bloqueado")
# Filtros del panel: los calculados + "prueba_por_vencer".
FILTROS_ESTADO_CALCULADO = ESTADOS_CALCULADOS + ("prueba_por_vencer",)
