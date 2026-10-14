from app.domain.services.subdomain_generator import SubdomainGenerator

def test_slugify_standard_name():
    assert SubdomainGenerator.slugify("Power Gym") == "power-gym"

def test_slugify_accents_and_special_chars():
    assert SubdomainGenerator.slugify("Gimnasio Élite & Acción!") == "gimnasio-elite-accion"

def test_slugify_length_bounds():
    very_long_name = "A" * 80
    slug = SubdomainGenerator.slugify(very_long_name)
    assert len(slug) == 63
    assert SubdomainGenerator.is_valid(slug)

def test_is_valid_valid_subdomains():
    assert SubdomainGenerator.is_valid("power-gym")
    assert SubdomainGenerator.is_valid("gym123")
    assert SubdomainGenerator.is_valid("fitness-club-2026")

def test_is_valid_invalid_subdomains():
    assert not SubdomainGenerator.is_valid("-invalid")
    assert not SubdomainGenerator.is_valid("invalid-")
    assert not SubdomainGenerator.is_valid("Has_Underscore")
    assert not SubdomainGenerator.is_valid("UPPERCASE")
    assert not SubdomainGenerator.is_valid("a")


# --- SA-RF-05 ---------------------------------------------------------------
def test_ca1_ejemplo_del_requisito():
    assert SubdomainGenerator.slugify("Gimnasio Ñandú") == "gimnasio-nandu"


def test_ca2_longitud_3_a_63():
    assert SubdomainGenerator.is_valid("abc")
    assert not SubdomainGenerator.is_valid("ab")
    assert SubdomainGenerator.is_valid("a" * 63)
    assert not SubdomainGenerator.is_valid("a" * 64)
    assert SubdomainGenerator.is_valid("a" * 51)  # antes el límite era 50


def test_ca3_palabras_reservadas():
    for palabra in ("admin", "www", "api", "app", "mail"):
        assert not SubdomainGenerator.is_valid(palabra)
        assert SubdomainGenerator.es_reservado(palabra)
        # El subdominio autogenerado a partir de un nombre reservado se corrige.
        assert SubdomainGenerator.is_valid(SubdomainGenerator.slugify(palabra))
    assert SubdomainGenerator.is_valid("admin-gym")
