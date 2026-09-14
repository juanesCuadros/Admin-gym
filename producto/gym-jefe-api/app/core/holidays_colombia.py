from datetime import date, timedelta
from typing import Dict, Set


def calcular_pascua(year: int) -> date:
    """
    Calcula la fecha del Domingo de Pascua / Resurrección para un año dado
    utilizando el algoritmo de Butcher (cómputo eclesiástico gregoriano anónimo).
    """
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def trasladar_lunes_emiliani(d: date) -> date:
    """
    Aplica la Ley Emiliani (Ley 51 de 1983):
    Si el festivo no cae en lunes (weekday 0), se traslada al lunes inmediatamente siguiente.
    """
    # weekday(): 0 es Lunes, 6 es Domingo
    dias_para_lunes = (7 - d.weekday()) % 7
    return d + timedelta(days=dias_para_lunes)


def obtener_festivos_colombia(year: int) -> Dict[date, str]:
    """
    Retorna un diccionario {fecha: nombre_festivo} con los 18 festivos oficiales
    de Colombia para el año especificado, aplicando las reglas de la Ley Emiliani
    y las fechas móviles de la Semana Santa y Pascua.
    """
    festivos: Dict[date, str] = {}

    # 1. Festivos fijos (no se trasladan)
    festivos[date(year, 1, 1)] = "Año Nuevo"
    festivos[date(year, 5, 1)] = "Día del Trabajo"
    festivos[date(year, 7, 20)] = "Día de la Independencia"
    festivos[date(year, 8, 7)] = "Batalla de Boyacá"
    festivos[date(year, 12, 8)] = "Inmaculada Concepción"
    festivos[date(year, 12, 25)] = "Navidad"

    # 2. Festivos con Ley Emiliani (se trasladan al lunes siguiente)
    festivos[trasladar_lunes_emiliani(date(year, 1, 6))] = "Día de los Reyes Magos"
    festivos[trasladar_lunes_emiliani(date(year, 3, 19))] = "Día de San José"
    festivos[trasladar_lunes_emiliani(date(year, 6, 29))] = "San Pedro y San Pablo"
    festivos[trasladar_lunes_emiliani(date(year, 8, 15))] = "Asunción de la Virgen"
    festivos[trasladar_lunes_emiliani(date(year, 10, 12))] = "Día de la Raza"
    festivos[trasladar_lunes_emiliani(date(year, 11, 1))] = "Todos los Santos"
    festivos[trasladar_lunes_emiliani(date(year, 11, 11))] = "Independencia de Cartagena"

    # 3. Festivos relativos a Pascua
    pascua = calcular_pascua(year)
    festivos[pascua - timedelta(days=3)] = "Jueves Santo"
    festivos[pascua - timedelta(days=2)] = "Viernes Santo"

    # Relativos a Pascua sujetos a Ley Emiliani (traslado al lunes)
    # Ascensión del Señor: 40 días después de Pascua (jueves +39 días), trasladado al lunes (+43 días)
    festivos[pascua + timedelta(days=43)] = "Ascensión del Señor"
    # Corpus Christi: 60 días después de Pascua, trasladado al lunes (+64 días)
    festivos[pascua + timedelta(days=64)] = "Corpus Christi"
    # Sagrado Corazón de Jesús: 68 días después de Pascua, trasladado al lunes (+71 días)
    festivos[pascua + timedelta(days=71)] = "Sagrado Corazón de Jesús"

    return festivos


def es_festivo_colombia(d: date) -> bool:
    """Retorna True si la fecha corresponde a un festivo oficial en Colombia."""
    festivos_del_ano = obtener_festivos_colombia(d.year)
    return d in festivos_del_ano
