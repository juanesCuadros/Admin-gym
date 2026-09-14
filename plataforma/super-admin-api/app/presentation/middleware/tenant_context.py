from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request

class TenantContextMiddleware(BaseHTTPMiddleware):
    """
    Captures tenant identification header X-Tenant-Id for platform requests,
    allowing downstream dependency injection to enforce PostgreSQL RLS policies.
    """
    async def dispatch(self, request: Request, call_next):
        tenant_id = request.headers.get("X-Tenant-Id")
        if tenant_id:
            request.state.tenant_id = tenant_id
        else:
            request.state.tenant_id = None

        response = await call_next(request)
        return response
