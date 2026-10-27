import React from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { MensajeFijo } from '../../components/estados/Estados';

/**
 * Historial de turnos (GW-RF-10, GW-RF-13).
 *
 * El backend no tiene un endpoint para listar turnos: solo existen `GET /caja/turnos/actual`
 * y `GET /caja/turnos/{turno_id}/movimientos`, que exige conocer el id. Sin la lista no hay
 * forma honesta de mostrar el historial, así que la pantalla lo dice y no inventa filas.
 *
 * Endpoint que falta (ver reporte del carril 5):
 *   GET /caja/turnos?estado=cerrado&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&staff_id=&con_descuadre=&pagina=&limite=20
 *   → { items: TurnoResumenDto[] (+ abierto_por_nombre, cerrado_por_nombre, revisado_por_nombre, nota_revision),
 *       total, pagina, limite, total_paginas }
 *   Permiso `caja:leer`. Fechas por día de Bogotá sobre `abierto_en`.
 */
export const HistorialTurnosPage: React.FC = () => (
  <div>
    <div className="page-header">
      <div>
        <h1 className="page-title">Historial de turnos</h1>
        <p className="page-subtitle">Turnos de caja cerrados, con su arqueo y descuadre</p>
      </div>
    </div>

    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '56px 20px',
        background: 'var(--bg-surface)',
        border: '1px dashed var(--border-color)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 20,
      }}
    >
      <History size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
      <div style={{ fontSize: '1.05rem', fontWeight: 500, marginBottom: 6 }}>El historial aún no está disponible</div>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 520, margin: 0 }}>
        El servidor todavía no permite consultar la lista de turnos cerrados. Mientras tanto, el turno abierto y sus
        movimientos se ven en <Link to="/caja">Caja · Turno actual</Link>, y los ingresos por periodo en{' '}
        <Link to="/reportes">Reportes · Ingresos</Link>.
      </p>
    </div>

    <MensajeFijo tono="info" titulo="Disponible pronto">
      Aquí vas a poder ver cada turno cerrado con su base, el efectivo esperado, el conteo, la diferencia y los
      movimientos, y filtrarlos por fecha, persona y descuadre.
    </MensajeFijo>
  </div>
);
