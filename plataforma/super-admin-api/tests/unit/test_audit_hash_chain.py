from app.core.security import compute_audit_hash
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.infrastructure.models.superadmin_models import Auditoria

def test_compute_audit_hash_deterministic():
    h1 = compute_audit_hash("0"*64, "actor-1", "LOGIN", "usuarios", "1", "{}", "2026-09-08T00:00:00")
    h2 = compute_audit_hash("0"*64, "actor-1", "LOGIN", "usuarios", "1", "{}", "2026-09-08T00:00:00")
    assert h1 == h2
    assert len(h1) == 64

def test_audit_chain_integrity_flow(db_session):
    repo = AuditRepository(db_session)
    
    # Add 3 sequential chained events
    e1 = repo.record_action(actor_id="admin-1", actor_nombre="Super Admin", accion="ACCION_1", entidad="test")
    e2 = repo.record_action(actor_id="admin-1", actor_nombre="Super Admin", accion="ACCION_2", entidad="test")
    e3 = repo.record_action(actor_id="admin-1", actor_nombre="Super Admin", accion="ACCION_3", entidad="test")

    assert e1.hash_previo == "0" * 64
    assert e2.hash_previo == e1.hash_actual
    assert e3.hash_previo == e2.hash_actual

    is_valid, corrupted_id = repo.verify_integrity()
    assert is_valid is True
    assert corrupted_id is None

def test_audit_chain_detects_tampering(db_session):
    repo = AuditRepository(db_session)
    e1 = repo.record_action(actor_id="admin-1", actor_nombre="Super Admin", accion="ACCION_A", entidad="test")
    e2 = repo.record_action(actor_id="admin-1", actor_nombre="Super Admin", accion="ACCION_B", entidad="test")

    # Manually tamper with e1 in the database
    e1.accion = "ACCION_ALTERADA_ILEGITIMA"
    db_session.commit()

    is_valid, corrupted_id = repo.verify_integrity()
    assert is_valid is False
    assert corrupted_id == e1.id
