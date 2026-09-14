import re
import unicodedata

class SubdomainGenerator:
    """Domain service for generating and validating tenant subdomains (RF-05)."""

    SUBDOMAIN_REGEX = re.compile(r'^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$')

    @classmethod
    def slugify(cls, name: str) -> str:
        """Converts gym name to a clean, RFC-compliant DNS subdomain string."""
        # Normalize unicode (decompose accents)
        normalized = unicodedata.normalize('NFKD', name)
        ascii_str = normalized.encode('ASCII', 'ignore').decode('utf-8').lower()
        
        # Replace whitespace and invalid chars with hyphen
        clean = re.sub(r'[^a-z0-9]+', '-', ascii_str)
        # Strip leading/trailing hyphens
        clean = clean.strip('-')
        
        # Ensure length constraints (2 to 50 chars)
        if len(clean) < 2:
            clean = f"{clean}gym" if clean else "gym"
        if len(clean) > 50:
            clean = clean[:50].rstrip('-')
            
        return clean

    @classmethod
    def is_valid(cls, subdomain: str) -> bool:
        """Checks if a subdomain strictly satisfies the PostgreSQL CHECK constraint regex."""
        return bool(cls.SUBDOMAIN_REGEX.match(subdomain))
