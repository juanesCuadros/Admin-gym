import React, { useCallback, useEffect, useState } from 'react';
import { DoorOpen, CheckCircle2, XCircle, Gift, Phone, Mail } from 'lucide-react';
import { reportesService } from '../../api/reportes.service';
import { Card, KpiCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFechaHora } from '../../utils/formato';
import { formatFechaNegocio, hoyBogota, sumarDias } from '../../utils/fechasBogota';
import type {
  DeportistaInactivoItem,
  ReporteAsistenciaResponse,
  ReporteDeportistasInactivosResponse,
  TopDeportistaAsistencia,
} from '../../types/reportes.types';
import { ExportarReporte } from './ExportarReporte';

/** Barras horizontales simples con el valor escrito (sin librería de gráficos). */
const Barras: React.FC<{ filas: Array<{ etiqueta: string; valor: number }> }> = ({ filas }) => {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {filas.map((f) => (
        <div key={f.etiqueta} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 44px', gap: 8, alignItems: 'center', fontSize: '0.825rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{f.etiqueta}</span>
          <div style={{ height: 12, background: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-xs)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(f.valor / max) * 100}%`,
                height: '100%',
                background: 'var(--primary)',
                borderRadius: 'var(--radius-xs)',
              }}
            />
          </div>
          <span style={{ textAlign: 'right', fontWeight: 600 }}>{f.valor}</span>
        </div>
      ))}
    </div>
  );
};

const hora = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Reportes · Asistencia (GW-RF-43, GW-RF-44): afluencia por hora y día, deportistas más constantes
 * y deportistas sin asistencia en N días (métrica distinta del estado `desactivado`).
 * `GET /reportes/asistencia` y `GET /reportes/deportistas-inactivos`.
 */
export const ReporteAsistenciaPage: React.FC = () => {
  // Afluencia
  const [borrador, setBorrador] = useState({ fecha_inicio: sumarDias(hoyBogota(), -6), fecha_fin: hoyBogota() });
  const [aplicados, setAplicados] = useState(borrador);
  const [reporte, setReporte] = useState<ReporteAsistenciaResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const errorFechas = borrador.fecha_inicio > borrador.fecha_fin ? 'La fecha inicial no puede ser posterior a la final.' : null;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setReporte(await reportesService.asistencia(aplicados));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [aplicados]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Sin asistencia
  const [diasBorrador, setDiasBorrador] = useState('15');
  const [dias, setDias] = useState(15);
  const [pagina, setPagina] = useState(1);
  const [inactivos, setInactivos] = useState<ReporteDeportistasInactivosResponse | null>(null);
  const [cargandoInactivos, setCargandoInactivos] = useState(true);
  const [errorInactivos, setErrorInactivos] = useState<unknown>(null);
  const diasValidos = Number.isInteger(Number(diasBorrador)) && Number(diasBorrador) >= 1 && Number(diasBorrador) <= 365;

  const cargarInactivos = useCallback(async () => {
    setCargandoInactivos(true);
    try {
      setInactivos(
        await reportesService.deportistasInactivos({ dias_sin_asistencia: dias, pagina, limite: FILAS_POR_PAGINA })
      );
      setErrorInactivos(null);
    } catch (e) {
      setErrorInactivos(e);
    } finally {
      setCargandoInactivos(false);
    }
  }, [dias, pagina]);

  useEffect(() => {
    cargarInactivos();
  }, [cargarInactivos]);

  const porHora = reporte
    ? [...reporte.afluencia_por_hora]
        .sort((a, b) => a.hora - b.hora)
        .filter((h) => h.cantidad > 0)
        .map((h) => ({ etiqueta: hora(h.hora), valor: h.cantidad }))
    : [];
  const porDia = reporte
    ? [...reporte.afluencia_por_dia_semana].sort((a, b) => a.dia_num - b.dia_num).map((d) => ({ etiqueta: d.dia_nombre, valor: d.cantidad }))
    : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte de asistencia</h1>
          <p className="page-subtitle">Afluencia por horario y deportistas que dejaron de venir</p>
        </div>
        <ExportarReporte parametros={{ tipo_reporte: 'asistencia', ...aplicados }} disabled={cargando || !!error} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!errorFechas) setAplicados({ ...borrador });
        }}
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}
      >
        <div style={{ width: 170 }}>
          <Input
            label="Desde"
            type="date"
            value={borrador.fecha_inicio}
            max={borrador.fecha_fin}
            onChange={(e) => setBorrador({ ...borrador, fecha_inicio: e.target.value })}
            error={errorFechas ?? undefined}
          />
        </div>
        <div style={{ width: 170 }}>
          <Input
            label="Hasta"
            type="date"
            value={borrador.fecha_fin}
            min={borrador.fecha_inicio}
            onChange={(e) => setBorrador({ ...borrador, fecha_fin: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={!!errorFechas || cargando}>
            Consultar
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const base = { fecha_inicio: sumarDias(hoyBogota(), -6), fecha_fin: hoyBogota() };
              setBorrador(base);
              setAplicados(base);
            }}
          >
            Últimos 7 días
          </Button>
        </div>
      </form>

      {cargando && !reporte ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : reporte ? (
        <>
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            Periodo: {formatFechaNegocio(reporte.fecha_inicio)} a {formatFechaNegocio(reporte.fecha_fin)}
          </p>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KpiCard label="Intentos de ingreso" value={reporte.total_accesos} icon={<DoorOpen size={18} />} />
            <KpiCard label="Permitidos" value={reporte.accesos_permitidos} icon={<CheckCircle2 size={18} />} />
            <KpiCard label="Denegados" value={reporte.accesos_denegados} icon={<XCircle size={18} />} />
            <KpiCard label="Cortesías" value={reporte.cortesias} icon={<Gift size={18} />} />
          </div>

          {reporte.total_accesos === 0 ? (
            <VacioInicial titulo="Sin ingresos en el periodo" descripcion="No se registraron check-ins entre esas fechas." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 20 }}>
              <Card title="Ingresos por hora">
                {porHora.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Sin datos.</p>
                ) : (
                  <Barras filas={porHora} />
                )}
              </Card>
              <Card title="Ingresos por día de la semana">
                <Barras filas={porDia} />
              </Card>
              <Card title="Deportistas más constantes">
                <Table<TopDeportistaAsistencia>
                  data={reporte.top_deportistas}
                  keyExtractor={(t) => t.deportista_id}
                  emptyMessage="Sin datos en el periodo"
                  columns={[
                    {
                      header: 'Deportista',
                      render: (t) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.documento}</div>
                        </div>
                      ),
                    },
                    { header: 'Ingresos', align: 'right', render: (t) => <strong>{t.total_asistencias}</strong> },
                    { header: 'Último', render: (t) => formatFechaHora(t.ultima_asistencia) },
                  ]}
                />
              </Card>
            </div>
          )}
        </>
      ) : null}

      {/* Sin asistencia N días */}
      <Card
        title="Deportistas sin asistencia"
        action={
          <ExportarReporte
            parametros={{ tipo_reporte: 'deportistas_inactivos', dias_sin_asistencia: dias }}
            disabled={cargandoInactivos || !!errorInactivos}
          />
        }
      >
        <p style={{ color: 'var(--text-secondary)', marginTop: 0, fontSize: '0.9rem' }}>
          Deportistas con membresía vigente que no han hecho check-in en los últimos días. No cambia su estado: sirve
          para contactarlos antes de que se vayan.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!diasValidos) return;
            setDias(Number(diasBorrador));
            setPagina(1);
          }}
          style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}
        >
          <div style={{ width: 220 }}>
            <Input
              label="Días sin venir"
              type="number"
              min={1}
              max={365}
              value={diasBorrador}
              onChange={(e) => setDiasBorrador(e.target.value)}
              error={diasValidos ? undefined : 'Entre 1 y 365 días.'}
            />
          </div>
          <div className="form-group">
            <Button type="submit" variant="primary" disabled={!diasValidos || cargandoInactivos}>
              Consultar
            </Button>
          </div>
        </form>

        {cargandoInactivos && !inactivos ? (
          <Cargando filas={4} />
        ) : errorInactivos ? (
          <ErrorCarga error={errorInactivos} onReintentar={cargarInactivos} />
        ) : inactivos && inactivos.total === 0 ? (
          <VacioInicial
            titulo="Todos han venido"
            descripcion={`Ningún deportista con membresía vigente lleva ${inactivos.dias_sin_asistencia_umbral} días o más sin venir.`}
          />
        ) : inactivos ? (
          <Table<DeportistaInactivoItem>
            data={inactivos.items}
            isLoading={cargandoInactivos}
            keyExtractor={(d) => d.deportista_id}
            pagination={{ currentPage: pagina, totalPages: Math.max(1, inactivos.total_paginas), onPageChange: setPagina }}
            columns={[
              {
                header: 'Deportista',
                render: (d) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{d.nombre}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.documento}</div>
                  </div>
                ),
              },
              {
                header: 'Contacto',
                render: (d) => (
                  <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {d.telefono && (
                      <a href={`tel:${d.telefono}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Phone size={13} /> {d.telefono}
                      </a>
                    )}
                    {d.correo && (
                      <a href={`mailto:${d.correo}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Mail size={13} /> {d.correo}
                      </a>
                    )}
                    {!d.telefono && !d.correo && <span style={{ color: 'var(--text-muted)' }}>Sin contacto</span>}
                  </div>
                ),
              },
              { header: 'Plan', render: (d) => `${d.plan_nombre} · vence ${formatFechaNegocio(d.fecha_vencimiento)}` },
              {
                header: 'Último ingreso',
                render: (d) => (d.ultimo_checkin_utc ? formatFechaHora(d.ultimo_checkin_utc) : 'Nunca'),
              },
              { header: 'Días sin venir', align: 'right', render: (d) => <strong>{d.dias_sin_asistir}</strong> },
            ]}
          />
        ) : null}
      </Card>
    </div>
  );
};
