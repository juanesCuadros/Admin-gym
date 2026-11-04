import React, { useCallback, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatMinutos, turnosTrabajoService } from '../../api/turnosTrabajo.service';
import { parseApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, KpiCard } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import { ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { formatFechaHora } from '../../utils/formato';
import { hoyBogota, inicioMesBogota } from '../../utils/fechasBogota';
import type { ListadoTurnosTrabajo, TurnoTrabajo } from '../../types/turnosTrabajo.types';

const POR_PAGINA = 20;

/** Personal · Turnos de trabajo: quién trabajó, cuándo y cuántas horas. Aparte de la caja. */
export const TurnosTrabajoPage: React.FC = () => {
  const { isJefe } = useAuth();
  const { showToast } = useToast();
  const [desde, setDesde] = useState(inicioMesBogota());
  const [hasta, setHasta] = useState(hoyBogota());
  const [persona, setPersona] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<ListadoTurnosTrabajo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [aCerrar, setACerrar] = useState<TurnoTrabajo | null>(null);
  const [salida, setSalida] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorCerrar, setErrorCerrar] = useState<string | null>(null);

  const rangoValido = !!desde && !!hasta && hasta >= desde;

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return;
    setCargando(true);
    try {
      setDatos(
        await turnosTrabajoService.listar({
          desde,
          hasta,
          staff_id: persona || undefined,
          limit: POR_PAGINA,
          offset: (pagina - 1) * POR_PAGINA,
        })
      );
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, persona, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    setPagina(1);
  }, [desde, hasta, persona]);

  const cerrar = async () => {
    if (!aCerrar) return;
    if (!salida) return setErrorCerrar('Escribe la hora real de salida.');
    if (motivo.trim().length < 4) return setErrorCerrar('Escribe el motivo (mínimo 4 caracteres).');
    setEnviando(true);
    setErrorCerrar(null);
    try {
      // La hora se escribe en la de Bogotá, que no tiene cambio de horario.
      await turnosTrabajoService.cerrarAjeno(aCerrar.id, { salida_en: `${salida}:00-05:00`, motivo: motivo.trim() });
      showToast('success', 'Turno cerrado', aCerrar.staff_nombre);
      setACerrar(null);
      cargar();
    } catch (e) {
      setErrorCerrar(parseApiError(e));
    } finally {
      setEnviando(false);
    }
  };

  // El selector se arma con quienes aparecen sin filtrar, para no pedir un permiso adicional.
  const [personas, setPersonas] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!persona && datos) setPersonas(datos.resumen.map((p) => ({ value: p.staff_id, label: p.staff_nombre })));
  }, [datos, persona]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Turnos de trabajo</h1>
          <p className="page-subtitle">Quién trabajó, cuándo y cuántas horas. Cada persona marca su entrada y su salida en la barra de módulos.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input label="Desde" type="date" value={desde} max={hoyBogota()} onChange={(e) => setDesde(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} max={hoyBogota()} onChange={(e) => setHasta(e.target.value)} />
        <Select
          label="Persona"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          options={[{ value: '', label: 'Todas' }, ...personas]}
        />
      </div>

      {!rangoValido ? (
        <MensajeFijo tono="advertencia">Elige un rango válido: la fecha inicial no puede ser posterior a la final.</MensajeFijo>
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : (
        <>
          {datos && datos.resumen.length > 0 && (
            <div className="kpi-grid">
              {datos.resumen.map((p) => (
                <KpiCard
                  key={p.staff_id}
                  label={p.staff_nombre}
                  value={formatMinutos(p.minutos)}
                  subtext={`${p.turnos} turno(s)${p.abiertos > 0 ? ` · ${p.abiertos} abierto` : ''}`}
                  icon={<Clock size={20} />}
                />
              ))}
            </div>
          )}
          <Card>
            <Table<TurnoTrabajo>
              columns={[
                { header: 'Persona', accessor: (t) => t.staff_nombre },
                { header: 'Entrada', accessor: (t) => formatFechaHora(t.entrada_en) },
                {
                  header: 'Salida',
                  render: (t) =>
                    t.salida_en ? (
                      <div>
                        <div>{formatFechaHora(t.salida_en)}</div>
                        {t.cerrado_por_nombre && (
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                            La puso {t.cerrado_por_nombre}: {t.motivo_cierre}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Badge variant="success">En turno</Badge>
                    ),
                },
                { header: 'Horas', align: 'right', accessor: (t) => formatMinutos(t.minutos) },
                {
                  header: '',
                  align: 'right',
                  render: (t) =>
                    isJefe && !t.salida_en ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setACerrar(t);
                          setSalida('');
                          setMotivo('');
                          setErrorCerrar(null);
                        }}
                      >
                        Poner salida
                      </Button>
                    ) : null,
                },
              ]}
              data={datos?.items ?? []}
              isLoading={cargando}
              keyExtractor={(t) => t.id}
              emptyMessage="No hay turnos de trabajo en estas fechas."
              pagination={{
                currentPage: pagina,
                totalPages: Math.max(1, Math.ceil((datos?.total ?? 0) / POR_PAGINA)),
                onPageChange: setPagina,
              }}
            />
          </Card>
        </>
      )}

      <Modal
        isOpen={!!aCerrar}
        onClose={() => !enviando && setACerrar(null)}
        title={`Poner salida a ${aCerrar?.staff_nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setACerrar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={cerrar} isLoading={enviando}>
              Cerrar turno
            </Button>
          </>
        }
      >
        {aCerrar && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 0 }}>
            Entró el {formatFechaHora(aCerrar.entrada_en)}. Usa esto si olvidó marcar su salida; queda registrado quién lo hizo.
          </p>
        )}
        <Input label="Hora real de salida *" type="datetime-local" value={salida} onChange={(e) => setSalida(e.target.value)} />
        <Input label="Motivo *" value={motivo} maxLength={255} placeholder="Ej. Olvidó marcar la salida" onChange={(e) => setMotivo(e.target.value)} />
        {errorCerrar && <MensajeFijo tono="error">{errorCerrar}</MensajeFijo>}
      </Modal>
    </div>
  );
};
