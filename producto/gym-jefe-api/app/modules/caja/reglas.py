from datetime import date, timedelta
from typing import Tuple


def calcular_vencimiento_renovacion_c2(
    venc_actual: date,
    hoy: date,
    dias_duracion: int,
    dias_gracia_mora: int,
    tuvo_checkin_en_gracia: bool
) -> Tuple[date, date]:
    """
    Función pura que implementa la Regla C2 de renovación (GW-RF-25 CA1 y CA2).

    Retorna:
        Tuple[date, date]: (fecha_inicio_nuevo_periodo, nueva_fecha_vencimiento)

    Criterios de Aceptación:
    - CA1: Si la membresía está vigente (venc_actual >= hoy):
      Suma días desde el vencimiento actual, sin perder días.
      fecha_inicio = venc_actual
      nueva_fecha_venc = venc_actual + dias_duracion

    - CA2: Si la membresía está en gracia o vencida (venc_actual < hoy):
      * Si el deportista hizo check-in en algún día de la ventana de gracia (venc+1 ... venc+g):
        El nuevo periodo cuenta desde venc_actual.
        fecha_inicio = venc_actual
        nueva_fecha_venc = venc_actual + dias_duracion
      * Si no entró en la gracia:
        El nuevo periodo cuenta desde el día de la renovación (hoy).
        fecha_inicio = hoy
        nueva_fecha_venc = hoy + dias_duracion
    """
    if venc_actual >= hoy:
        fecha_inicio = venc_actual
    else:
        if tuvo_checkin_en_gracia:
            fecha_inicio = venc_actual
        else:
            fecha_inicio = hoy

    nueva_fecha_venc = fecha_inicio + timedelta(days=dias_duracion)
    return fecha_inicio, nueva_fecha_venc
