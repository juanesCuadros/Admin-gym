import re
import unicodedata

# SA-RF-05 CA3: palabras reservadas que nunca pueden ser subdominio de un gimnasio.
SUBDOMINIOS_RESERVADOS = frozenset({"admin", "www", "api", "app", "mail"})

LONGITUD_MINIMA = 3
LONGITUD_MAXIMA = 63  # límite de etiqueta DNS (RFC 1035)


class SubdomainGenerator:
    """Generación y validación del subdominio del gimnasio (SA-RF-05)."""

    # Solo a-z, 0-9 y '-'; no empieza ni termina en guion; de 3 a 63 caracteres (CA2).
    # Mismo patrón que el CHECK de superadmin.gimnasios (migración 033).
    SUBDOMAIN_REGEX = re.compile(r'^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$')

    @classmethod
    def slugify(cls, name: str) -> str:
        """`Gimnasio Ñandú` → `gimnasio-nandu`: minúsculas, sin tildes, espacios a guion (CA1)."""
        normalized = unicodedata.normalize('NFKD', name or "")
        ascii_str = normalized.encode('ASCII', 'ignore').decode('utf-8').lower()
        clean = re.sub(r'[^a-z0-9]+', '-', ascii_str).strip('-')

        if len(clean) > LONGITUD_MAXIMA:
            clean = clean[:LONGITUD_MAXIMA].rstrip('-')
        if len(clean) < LONGITUD_MINIMA:
            clean = f"{clean}-gym" if clean else "gym"
        if clean in SUBDOMINIOS_RESERVADOS:
            clean = f"{clean}-gym"
        return clean

    @classmethod
    def es_reservado(cls, subdomain: str) -> bool:
        return subdomain in SUBDOMINIOS_RESERVADOS

    @classmethod
    def is_valid(cls, subdomain: str) -> bool:
        """Formato válido (CA2) y no reservado (CA3)."""
        return bool(cls.SUBDOMAIN_REGEX.match(subdomain or "")) and not cls.es_reservado(subdomain)
