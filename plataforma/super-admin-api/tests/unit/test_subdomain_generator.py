from app.domain.services.subdomain_generator import SubdomainGenerator

def test_slugify_standard_name():
    assert SubdomainGenerator.slugify("Power Gym") == "power-gym"

def test_slugify_accents_and_special_chars():
    assert SubdomainGenerator.slugify("Gimnasio Élite & Acción!") == "gimnasio-elite-accion"

def test_slugify_length_bounds():
    very_long_name = "A" * 60
    slug = SubdomainGenerator.slugify(very_long_name)
    assert len(slug) <= 50
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
    assert not SubdomainGenerator.is_valid("a")  # Too short (min 2)
