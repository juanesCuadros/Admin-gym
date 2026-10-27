import React, { useCallback, useEffect, useState } from 'react';
import { Phone, Mail } from 'lucide-react';
import { reportesService } from '../../api/reportes.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA } from '../../utils/formato';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import type { MembresiaPorVencerItem, ReporteMembresiasPorVencerResponse } from '../../types/reportes.types';
import { ExportarReporte } from './ExportarReporte';

/** "Vence en 3 días (15/10/2026)" con la fecha de negocio tal cual llega (sin pasar por zona horaria). */
function textoVencimiento(fecha: string, dias: number): string {
  const f = formatFechaNegocio(fecha);
  if (dias === 0) return `Vence hoy (${f})`;
  if (dias > 0) return `Vence en ${dias} ${dias === 1 ? 'día' : 'días'} (${f})`;
  const n = Math.abs(dias);
  return `Venció hace ${n} ${n === 1 ? 'día' : 'días'} (${f})`;
}

/**
 * Reportes · Membresías (GW-RF-42, GW-RF-44): membresías por vencer con el contacto de cada deportista.
 * `GET /reportes/membresias-por-vencer?dias=` (sin `dias` aplica el umbral del gimnasio).
 */
export const ReporteMembresiasPage: React.FC = () => {
  const [diasBorrador, setDiasBorrador] = useState('');
  const [dias, setDias] = useState<number | undefined>(undefined);
  const [pagina, setPagina] = useState(1);
  const [reporte, setReporte] = useState<ReporteMembresiasPorVencerResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const diasValidos = diasBorrador.trim() === '' || (Number.isInteger(Number(diasBorrador)) && Number(diasBorrador) >= 1 && Number(diasBorrador) <= 90);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await reportesService.membresiasPorVencer({ dias, pagina, limite: FILAS_POR_PAGINA });
      setReporte(r);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [dias, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!diasValidos) return;
    setDias(diasBorrador.trim() === '' ? undefined : Number(diasBorrador));
    setPagina(1);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte de membresías</h1>
          <p className="page-subtitle">Membresías por vencer, con el contacto para avisar a tiempo</p>
        </div>
        <ExportarReporte parametros={{ tipo_reporte: 'membresias_por_vencer', dias }} disabled={cargando || !!error} />
      </div>

      <form onSubmit={aplicar} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ width: 260 }}>
          <Input
            label="Vencen en los próximos (días)"
            type="number"
            min={1}
            max={90}
            placeholder={reporte ? `Umbral del gimnasio: ${reporte.umbral_dias_aplicado}` : 'Umbral del gimnasio'}
            value={diasBorrador}
            onChange={(e) => setDiasBorrador(e.target.value)}
            error={diasValidos ? undefined : 'Entre 1 y 90 días.'}
          />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={!diasValidos || cargando}>
            Consultar
          </Button>
          {dias !== undefined && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDiasBorrador('');
                setDias(undefined);
                setPagina(1);
              }}
            >
              Usar el umbral del gimnasio
            </Button>
          )}
        </div>
      </form>

      {cargando && !reporte ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : reporte ? (
        reporte.total === 0 ? (
          <VacioInicial
            titulo="Ninguna membresía vence pronto"
            descripcion={`No hay membresías activas que venzan en los próximos ${reporte.umbral_dias_aplicado} días.`}
          />
        ) : (
          <Card title={`Vencen en los próximos ${reporte.umbral_dias_aplicado} días (${reporte.total})`}>
            <Table<MembresiaPorVencerItem>
              data={reporte.items}
              isLoading={cargando}
              keyExtractor={(m) => m.membresia_id}
              pagination={{ currentPage: pagina, totalPages: Math.max(1, reporte.total_paginas), onPageChange: setPagina }}
              columns={[
                {
                  header: 'Deportista',
                  render: (m) => (
                    <div>
                      <div style={{ fontWeight: 500 }}>{m.nombre}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{m.documento}</div>
                    </div>
                  ),
                },
                {
                  header: 'Contacto',
                  render: (m) => (
                    <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {m.telefono && (
                        <a href={`tel:${m.telefono}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <Phone size={13} /> {m.telefono}
                        </a>
                      )}
                      {m.correo && (
                        <a href={`mailto:${m.correo}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <Mail size={13} /> {m.correo}
                        </a>
                      )}
                      {!m.telefono && !m.correo && <span style={{ color: 'var(--text-muted)' }}>Sin contacto</span>}
                    </div>
                  ),
                },
                { header: 'Plan', render: (m) => m.plan_nombre },
                {
                  header: 'Vencimiento',
                  render: (m) => (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: m.dias_restantes <= 3 ? 'var(--warning)' : undefined, fontWeight: 500 }}>
                        {textoVencimiento(m.fecha_vencimiento, m.dias_restantes)}
                      </span>
                      {m.congelamiento_activo && <Badge variant="info">Congelada</Badge>}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )
      ) : null}

      <MensajeFijo tono="info" style={{ marginTop: 20 }}>
        Las listas de membresías activas y vencidas, y el contacto del titular en los planes grupales, todavía no los
        entrega el servidor en este reporte.
      </MensajeFijo>
    </div>
  );
};
