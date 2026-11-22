import React, { useCallback, useEffect, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Input } from '@web/components/ui/Input';
import { formatCOP, formatFecha, formatHora } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import type { CierreDiario } from '../types/caja.types';

const conSigno = (n: number) => (n === 0 ? formatCOP(0) : `${n < 0 ? '−' : '+'}${formatCOP(Math.abs(n))}`);

/**
 * Cierre diario de esta estación (A3): el resumen de los turnos que se abrieron ese día, con lo que hay en la
 * estación aunque no haya red. El cuadre mensual, que exige conexión, llega con la fase 3B.
 */
export const CierreDiarioPanel: React.FC = () => {
  const [fecha, setFecha] = useState('');
  const [cierre, setCierre] = useState<CierreDiario | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (dia: string) => {
    try {
      const c = await cajaService.cierreDiario(dia || undefined);
      setCierre(c);
      if (!dia) setFecha(c.fecha);
      setError(null);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  }, []);

  useEffect(() => {
    void cargar(fecha);
  }, [fecha, cargar]);

  const t = cierre?.totales;
  return (
    <section className="gd-panel">
      <div className="gd-panel-encabezado">
        <div>
          <h2 className="gd-titulo" style={{ fontSize: '1.15rem', marginBottom: 2 }}>Cierre diario</h2>
          <p className="gd-subtitulo" style={{ margin: 0 }}>Los turnos que se abrieron ese día en esta estación.</p>
        </div>
        <div style={{ width: 190 }}>
          <Input type="date" aria-label="Día del cierre" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>
      {error && <MensajeError>{error}</MensajeError>}
      {cierre && t && (
        cierre.turnos.length === 0 ? (
          <p className="gd-vacio">No hubo turnos de caja el {formatFecha(`${cierre.fecha}T12:00:00-05:00`)} en esta estación.</p>
        ) : (
          <>
            {cierre.sin_subir > 0 && (
              <div className="gd-aviso" role="status" style={{ marginBottom: 12 }}>
                <CloudUpload size={16} style={{ flexShrink: 0 }} />
                <span>{cierre.sin_subir} movimientos de este día aún no han subido al servidor. El resumen es el de la estación.</span>
              </div>
            )}
            <dl className="gd-caja-cifras">
              <div><dt>Bases</dt><dd>{formatCOP(t.base_inicial)}</dd></div>
              <div><dt>Efectivo cobrado</dt><dd>{formatCOP(t.ventas_efectivo)}</dd></div>
              <div><dt>Otros medios</dt><dd>{formatCOP(t.ventas_otro)}</dd></div>
              <div><dt>Egresos</dt><dd>−{formatCOP(t.egresos_efectivo)}</dd></div>
              <div className="gd-caja-esperado"><dt>Efectivo esperado</dt><dd>{formatCOP(t.total_esperado_efectivo)}</dd></div>
            </dl>
            <div className="gd-cierre-columnas">
              <div>
                <h3 className="gd-titulo" style={{ fontSize: '0.95rem' }}>Por medio de pago</h3>
                <dl className="gd-conteos">
                  {t.por_metodo.length === 0 && <div><dt>Sin ventas</dt><dd>{formatCOP(0)}</dd></div>}
                  {t.por_metodo.map((p) => (
                    <div key={`${p.metodo}-${p.tipo_medio}`}><dt>{p.metodo}</dt><dd>{formatCOP(p.monto)}</dd></div>
                  ))}
                  <div><dt>Ventas</dt><dd>{t.num_ventas}</dd></div>
                  <div><dt>Egresos</dt><dd>{t.num_egresos}</dd></div>
                </dl>
              </div>
              <div>
                <h3 className="gd-titulo" style={{ fontSize: '0.95rem' }}>Arqueo</h3>
                <dl className="gd-conteos">
                  <div><dt>Efectivo contado (turnos cerrados)</dt><dd>{formatCOP(cierre.efectivo_contado)}</dd></div>
                  <div><dt>Diferencia</dt><dd style={{ color: cierre.diferencia === 0 ? 'var(--success)' : 'var(--danger)' }}>{conSigno(cierre.diferencia)}</dd></div>
                  <div><dt>Turnos abiertos</dt><dd>{cierre.turnos_abiertos}</dd></div>
                </dl>
              </div>
            </div>
            <table className="gd-tabla" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Turno</th><th>Abrió</th><th style={{ textAlign: 'right' }}>Esperado</th><th style={{ textAlign: 'right' }}>Contado</th><th style={{ textAlign: 'right' }}>Diferencia</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {cierre.turnos.map((r) => (
                  <tr key={r.turno.id}>
                    <td>{formatHora(r.turno.abierto_en)}{r.turno.cerrado_en ? ` – ${formatHora(r.turno.cerrado_en)}` : ''}</td>
                    <td>{r.turno.abierto_por_nombre ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatCOP(r.totales.total_esperado_efectivo)}</td>
                    <td style={{ textAlign: 'right' }}>{r.turno.efectivo_contado !== null ? formatCOP(r.turno.efectivo_contado) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.turno.diferencia !== null ? conSigno(r.turno.diferencia) : '—'}</td>
                    <td>
                      <Badge variant={r.turno.estado === 'abierto' ? 'info' : 'neutral'}>{r.turno.estado === 'abierto' ? 'Abierto' : 'Cerrado'}</Badge>
                      {r.turno.sin_confirmar && <Badge variant="warning" style={{ marginLeft: 6 }}>Abierto sin red</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </section>
  );
};
