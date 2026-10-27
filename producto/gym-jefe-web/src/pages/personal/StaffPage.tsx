import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Pencil, Power, Trash2, KeyRound, Copy, Crown, Check } from 'lucide-react';
import { personalService } from '../../api/personal.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { Table } from '../../components/ui/Table';
import { ConfirmarConMotivo } from '../../components/ui/ConfirmarConMotivo';
import { Cargando, ErrorCarga, MensajeFijo, VacioFiltro, VacioInicial, Conflicto } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFechaHora } from '../../utils/formato';
import { copiarAlPortapapeles } from '../../utils/navegador';
import type { CredencialTemporal, RolStaff, StaffResponse } from '../../types/personal.types';

const ETIQUETA_ROL: Record<string, string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

const OPCIONES_ROL: Array<{ value: RolStaff; label: string }> = [
  { value: 'recepcionista', label: 'Recepcionista' },
  { value: 'entrenador', label: 'Entrenador' },
];

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormStaff {
  nombre: string;
  correo: string;
  rol: RolStaff;
}

function validarStaff(f: FormStaff): Partial<Record<keyof FormStaff, string>> {
  const e: Partial<Record<keyof FormStaff, string>> = {};
  const nombre = f.nombre.trim();
  if (nombre.length < 2) e.nombre = 'El nombre debe tener al menos 2 caracteres.';
  else if (nombre.length > 100) e.nombre = 'Máximo 100 caracteres.';
  if (!CORREO_RE.test(f.correo.trim())) e.correo = 'Escribe un correo válido.';
  return e;
}

/* -------------------------------------------------------------------------- */
/* Credencial temporal: se muestra una sola vez (contrato 2.7, GW-RF-39 CA1).  */
/* -------------------------------------------------------------------------- */

const ModalCredencial: React.FC<{
  datos: { nombre: string; correo: string; credencial: CredencialTemporal } | null;
  onClose: () => void;
}> = ({ datos, onClose }) => {
  const { showToast } = useToast();
  const [copiado, setCopiado] = useState(false);

  useEffect(() => setCopiado(false), [datos]);

  if (!datos) return null;

  const copiar = async () => {
    const ok = await copiarAlPortapapeles(datos.credencial.password_temporal);
    if (ok) {
      setCopiado(true);
      showToast('success', 'Contraseña copiada');
    } else {
      showToast('error', 'No se pudo copiar', 'Selecciona la contraseña y cópiala a mano.');
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => undefined}
      title="Credencial temporal"
      maxWidth="480px"
      footer={
        <Button variant="primary" onClick={onClose}>
          Ya la entregué, cerrar
        </Button>
      }
    >
      <MensajeFijo tono="advertencia" titulo="Se muestra una sola vez" style={{ marginBottom: 16 }}>
        Cópiala y entrégala a {datos.nombre}. Al cerrar esta ventana no se puede volver a ver; si se pierde, genera
        una nueva.
      </MensajeFijo>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Usuario</div>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>{datos.correo}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Contraseña temporal</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code
          style={{
            flex: 1,
            padding: '10px 12px',
            background: 'var(--bg-surface-hover)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: '1.05rem',
            userSelect: 'all',
            wordBreak: 'break-all',
          }}
        >
          {datos.credencial.password_temporal}
        </code>
        <Button variant="outline" leftIcon={copiado ? <Check size={16} /> : <Copy size={16} />} onClick={copiar}>
          {copiado ? 'Copiada' : 'Copiar'}
        </Button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 12, marginBottom: 0 }}>
        Vence el {formatFechaHora(datos.credencial.expira_en)}. En el primer ingreso el sistema pedirá cambiarla.
      </p>
    </Modal>
  );
};

/* -------------------------------------------------------------------------- */
/* Página                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Personal · Staff (GW-RF-39, GW-RF-40).
 * Crear y regenerar credencial siguen el contrato 2.7 (pendiente de backend: hoy `POST /personal`
 * todavía exige `password` y `regenerar-credencial` no existe).
 */
export const StaffPage: React.FC = () => {
  const { hasPermission, isJefe, user, refrescarUsuario } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const puedeCrear = hasPermission('personal', 'crear');
  const puedeEditar = hasPermission('personal', 'editar');
  const puedeEliminar = hasPermission('personal', 'eliminar');

  // Listado
  const [buscar, setBuscar] = useState('');
  const [buscarAplicado, setBuscarAplicado] = useState('');
  const [rol, setRol] = useState('');
  const [estado, setEstado] = useState<'' | 'activo' | 'inactivo'>('');
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<StaffResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const hayFiltros = !!buscarAplicado || !!rol || !!estado;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscarAplicado(buscar.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await personalService.listar({
        buscar: buscarAplicado || undefined,
        rol: rol || undefined,
        activo: estado === '' ? undefined : estado === 'activo',
        pagina,
        limite: FILAS_POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPaginas(Math.max(1, res.total_paginas));
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, [buscarAplicado, rol, estado, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const limpiarFiltros = () => {
    setBuscar('');
    setBuscarAplicado('');
    setRol('');
    setEstado('');
    setPagina(1);
  };

  // Crear / editar
  const [formAbierto, setFormAbierto] = useState<'crear' | StaffResponse | null>(null);
  const [form, setForm] = useState<FormStaff>({ nombre: '', correo: '', rol: 'recepcionista' });
  const [tocados, setTocados] = useState<Partial<Record<keyof FormStaff, boolean>>>({});
  const [errorForm, setErrorForm] = useState<ApiError | null>(null);
  const [guardando, setGuardando] = useState(false);

  const erroresForm = validarStaff(form);
  const errorCampo = (c: keyof FormStaff) =>
    (tocados[c] && erroresForm[c]) || (errorForm?.campos[c] ?? undefined);

  const abrirCrear = () => {
    setForm({ nombre: '', correo: '', rol: 'recepcionista' });
    setTocados({});
    setErrorForm(null);
    setFormAbierto('crear');
  };

  const abrirEditar = (s: StaffResponse) => {
    setForm({ nombre: s.nombre, correo: s.correo, rol: (s.rol === 'entrenador' ? 'entrenador' : 'recepcionista') });
    setTocados({});
    setErrorForm(null);
    setFormAbierto(s);
  };

  const [credencial, setCredencial] = useState<{ nombre: string; correo: string; credencial: CredencialTemporal } | null>(
    null
  );

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTocados({ nombre: true, correo: true, rol: true });
    if (Object.keys(erroresForm).length > 0 || guardando || !formAbierto) return;
    setGuardando(true);
    setErrorForm(null);
    const datos = { nombre: form.nombre.trim(), correo: form.correo.trim(), rol: form.rol };
    try {
      if (formAbierto === 'crear') {
        const creado = await personalService.crear(datos);
        setFormAbierto(null);
        showToast('success', 'Miembro creado', creado.nombre);
        if (creado.password_temporal && creado.expira_en) {
          setCredencial({
            nombre: creado.nombre,
            correo: creado.correo,
            credencial: { password_temporal: creado.password_temporal, expira_en: creado.expira_en },
          });
        }
      } else {
        await personalService.actualizar(formAbierto.id, { ...datos, version: formAbierto.version });
        setFormAbierto(null);
        showToast('success', 'Cambios guardados', datos.nombre);
      }
      cargar();
    } catch (err) {
      // Lo escrito se conserva: el formulario sigue abierto con el error (§A6).
      setErrorForm(toApiError(err));
    } finally {
      setGuardando(false);
    }
  };

  // Activar / desactivar / eliminar / regenerar
  const [aDesactivar, setADesactivar] = useState<StaffResponse | null>(null);
  const [aEliminar, setAEliminar] = useState<StaffResponse | null>(null);
  const [aRegenerar, setARegenerar] = useState<StaffResponse | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cambiarEstado = async (s: StaffResponse, activo: boolean, motivo?: string) => {
    setProcesando(true);
    setErrorAccion(null);
    try {
      const res = await personalService.cambiarEstado(s.id, { activo, motivo: motivo || undefined });
      setADesactivar(null);
      showToast('success', activo ? 'Miembro activado' : 'Miembro desactivado', res.mensaje);
      cargar();
    } catch (err) {
      const e = toApiError(err);
      if (activo) showToast('error', 'No se pudo activar', e.message);
      else setErrorAccion(e.message);
    } finally {
      setProcesando(false);
    }
  };

  const eliminar = async () => {
    if (!aEliminar) return;
    setProcesando(true);
    try {
      await personalService.eliminar(aEliminar.id);
      showToast('success', 'Miembro eliminado', aEliminar.nombre);
      setAEliminar(null);
      cargar();
    } catch (err) {
      setErrorAccion(toApiError(err).message);
    } finally {
      setProcesando(false);
    }
  };

  const regenerar = async () => {
    if (!aRegenerar) return;
    setProcesando(true);
    try {
      const cred = await personalService.regenerarCredencial(aRegenerar.id);
      setCredencial({ nombre: aRegenerar.nombre, correo: aRegenerar.correo, credencial: cred });
      setARegenerar(null);
    } catch (err) {
      setErrorAccion(toApiError(err).message);
    } finally {
      setProcesando(false);
    }
  };

  // Transferir Jefe (GW-RF-40)
  const [transferirAbierto, setTransferirAbierto] = useState(false);
  const [candidatos, setCandidatos] = useState<StaffResponse[]>([]);
  const [cargandoCandidatos, setCargandoCandidatos] = useState(false);
  const [transferencia, setTransferencia] = useState<{ nuevo: string; rol: RolStaff; password: string }>({
    nuevo: '',
    rol: 'recepcionista',
    password: '',
  });
  const [errorTransferir, setErrorTransferir] = useState<string | null>(null);
  const [confirmarTransferencia, setConfirmarTransferencia] = useState(false);

  const abrirTransferir = async () => {
    setTransferirAbierto(true);
    setErrorTransferir(null);
    setTransferencia({ nuevo: '', rol: 'recepcionista', password: '' });
    setCargandoCandidatos(true);
    try {
      const res = await personalService.listar({ activo: true, pagina: 1, limite: 100 });
      setCandidatos(res.items.filter((s) => s.rol !== 'jefe'));
    } catch (err) {
      setErrorTransferir(toApiError(err).message);
    } finally {
      setCargandoCandidatos(false);
    }
  };

  const transferir = async () => {
    setProcesando(true);
    setErrorTransferir(null);
    try {
      const res = await personalService.transferirJefe({
        nuevo_jefe_id: transferencia.nuevo,
        nuevo_rol_antiguo_jefe: transferencia.rol,
        password_confirmacion: transferencia.password,
      });
      setConfirmarTransferencia(false);
      setTransferirAbierto(false);
      showToast('success', 'Rol de Jefe transferido', res.mensaje);
      await refrescarUsuario();
      navigate('/', { replace: true });
    } catch (err) {
      setConfirmarTransferencia(false);
      setErrorTransferir(toApiError(err).message);
    } finally {
      setProcesando(false);
    }
  };

  const nuevoJefe = candidatos.find((c) => c.id === transferencia.nuevo);

  // ---- Render ----
  const esEditable = (s: StaffResponse) => s.rol !== 'jefe' && s.id !== user?.id;

  let contenido: React.ReactNode;
  if (cargando && items.length === 0) {
    contenido = <Cargando />;
  } else if (errorCarga) {
    contenido = <ErrorCarga error={errorCarga} onReintentar={cargar} />;
  } else if (total === 0 && !hayFiltros) {
    contenido = (
      <VacioInicial
        titulo="Aún no hay personal"
        descripcion="Crea las cuentas de recepcionistas y entrenadores. Cada cuenta recibe una contraseña temporal de 72 horas."
        textoAccion={puedeCrear ? 'Crear miembro' : undefined}
        onAccion={puedeCrear ? abrirCrear : undefined}
      />
    );
  } else if (total === 0) {
    contenido = <VacioFiltro onLimpiar={limpiarFiltros} />;
  } else {
    contenido = (
      <Card>
        <Table<StaffResponse>
          data={items}
          isLoading={cargando}
          keyExtractor={(s) => s.id}
          pagination={{ currentPage: pagina, totalPages: totalPaginas, onPageChange: setPagina }}
          columns={[
            {
              header: 'Nombre',
              render: (s) => (
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {s.nombre}
                    {s.id === user?.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (tú)</span>}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.correo}</div>
                </div>
              ),
            },
            {
              header: 'Rol',
              render: (s) => (
                <Badge variant={s.rol === 'jefe' ? 'primary' : 'neutral'}>{ETIQUETA_ROL[s.rol] ?? s.rol}</Badge>
              ),
            },
            {
              header: 'Estado',
              render: (s) => <Badge variant={s.activo ? 'success' : 'neutral'}>{s.activo ? 'Activo' : 'Desactivado'}</Badge>,
            },
            { header: 'Último ingreso', render: (s) => (s.ultimo_ingreso ? formatFechaHora(s.ultimo_ingreso) : 'Nunca') },
            {
              header: '',
              align: 'right',
              width: '140px',
              render: (s) =>
                esEditable(s) ? (
                  <div className="acciones-fila">
                    {puedeEditar && (
                      <Button variant="secondary" size="sm" leftIcon={<Pencil size={14} />} onClick={() => abrirEditar(s)}>
                        Editar
                      </Button>
                    )}
                    <MenuAcciones
                      etiqueta={`Acciones de ${s.nombre}`}
                      acciones={[
                        {
                          etiqueta: 'Nueva credencial',
                          icono: <KeyRound size={15} />,
                          oculto: !(puedeEditar && s.activo),
                          onClick: () => {
                            setErrorAccion(null);
                            setARegenerar(s);
                          },
                        },
                        {
                          etiqueta: 'Activar',
                          icono: <Power size={15} />,
                          oculto: !(puedeEditar && !s.activo),
                          disabled: procesando,
                          onClick: () => cambiarEstado(s, true),
                        },
                        {
                          etiqueta: 'Desactivar',
                          icono: <Power size={15} />,
                          peligro: true,
                          oculto: !(puedeEditar && s.activo),
                          onClick: () => {
                            setErrorAccion(null);
                            setADesactivar(s);
                          },
                        },
                        {
                          etiqueta: 'Eliminar',
                          icono: <Trash2 size={15} />,
                          peligro: true,
                          oculto: !puedeEliminar,
                          onClick: () => {
                            setErrorAccion(null);
                            setAEliminar(s);
                          },
                        },
                      ]}
                    />
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
    );
  }

  const enEdicion = formAbierto && formAbierto !== 'crear' ? formAbierto : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipo</h1>
          <p className="page-subtitle">Recepcionistas y entrenadores con acceso al sistema</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isJefe && (
            <Button variant="outline" leftIcon={<Crown size={16} />} onClick={abrirTransferir}>
              Transferir rol de Jefe
            </Button>
          )}
          {puedeCrear && (
            <Button variant="primary" leftIcon={<UserPlus size={16} />} onClick={abrirCrear}>
              Crear miembro
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Buscar por nombre o correo"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar personal"
        />
        <select
          className="form-select"
          style={{ maxWidth: 200 }}
          value={rol}
          onChange={(e) => {
            setRol(e.target.value);
            setPagina(1);
          }}
          aria-label="Filtrar por rol"
        >
          <option value="">Todos los roles</option>
          <option value="jefe">Jefe</option>
          <option value="recepcionista">Recepcionista</option>
          <option value="entrenador">Entrenador</option>
        </select>
        <select
          className="form-select"
          style={{ maxWidth: 200 }}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value as '' | 'activo' | 'inactivo');
            setPagina(1);
          }}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Desactivados</option>
        </select>
        {hayFiltros && (
          <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {contenido}

      {/* Crear / editar */}
      <Drawer
        isOpen={formAbierto !== null}
        onClose={() => !guardando && setFormAbierto(null)}
        title={enEdicion ? `Editar a ${enEdicion.nombre}` : 'Nuevo miembro del equipo'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormAbierto(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="form-staff" isLoading={guardando}>
              {enEdicion ? 'Guardar cambios' : 'Crear y generar credencial'}
            </Button>
          </>
        }
      >
        <form id="form-staff" onSubmit={guardar} noValidate>
          {errorForm?.tipo === 'conflicto' && errorForm.codigo !== 'LIMITE_PLAN_STAFF' && enEdicion ? (
            <div style={{ marginBottom: 12 }}>
              <Conflicto
                onRecargar={() => {
                  setFormAbierto(null);
                  cargar();
                }}
              />
            </div>
          ) : (
            errorForm && (
              <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
                {errorForm.codigo === 'LIMITE_PLAN_STAFF'
                  ? `${errorForm.message} Revisa el plan en Configuración · Mi suscripción.`
                  : errorForm.message}
              </MensajeFijo>
            )
          )}
          <Input
            label="Nombre completo"
            value={form.nombre}
            maxLength={100}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            onBlur={() => setTocados({ ...tocados, nombre: true })}
            error={errorCampo('nombre')}
            disabled={guardando}
          />
          <Input
            label="Correo"
            type="email"
            value={form.correo}
            onChange={(e) => setForm({ ...form, correo: e.target.value })}
            onBlur={() => setTocados({ ...tocados, correo: true })}
            error={errorCampo('correo')}
            disabled={guardando}
          />
          <Select
            label="Rol"
            value={form.rol}
            onChange={(e) => setForm({ ...form, rol: e.target.value as RolStaff })}
            options={OPCIONES_ROL}
            error={errorForm?.campos.rol}
            disabled={guardando}
          />
          {!enEdicion && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              El sistema genera una contraseña temporal válida por 72 horas. Se muestra una sola vez al crear la cuenta
              y se pide cambiarla en el primer ingreso.
            </p>
          )}
        </form>
      </Drawer>

      <ModalCredencial datos={credencial} onClose={() => setCredencial(null)} />

      {/* Desactivar (destructiva, motivo opcional en el backend) */}
      <ConfirmarConMotivo
        isOpen={aDesactivar !== null}
        onClose={() => setADesactivar(null)}
        onConfirm={(motivo) => aDesactivar && cambiarEstado(aDesactivar, false, motivo)}
        title="Desactivar miembro"
        message={
          <>
            <strong>{aDesactivar?.nombre}</strong> no podrá iniciar sesión y sus sesiones abiertas se cierran de
            inmediato. Si tiene un turno de caja abierto, el turno queda abierto hasta que otra persona lo cierre.
          </>
        }
        confirmText="Desactivar"
        motivoObligatorio={false}
        isLoading={procesando}
        error={errorAccion}
      />

      <ConfirmDialog
        isOpen={aEliminar !== null}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        title="Eliminar miembro"
        message={`Se eliminará la cuenta de ${aEliminar?.nombre ?? ''} y se cerrarán sus sesiones. Su historial queda en la auditoría.${errorAccion ? ` · Error: ${errorAccion}` : ''}`}
        confirmText="Eliminar"
        isDestructive
        isLoading={procesando}
      />

      <ConfirmDialog
        isOpen={aRegenerar !== null}
        onClose={() => setARegenerar(null)}
        onConfirm={regenerar}
        title="Generar nueva credencial"
        message={`Se generará una contraseña temporal nueva para ${aRegenerar?.nombre ?? ''} y se cerrarán todas sus sesiones. La anterior deja de servir.${errorAccion ? ` · Error: ${errorAccion}` : ''}`}
        confirmText="Generar"
        isDestructive
        isLoading={procesando}
      />

      {/* Transferir Jefe (GW-RF-40) */}
      <Modal
        isOpen={transferirAbierto}
        onClose={() => !procesando && setTransferirAbierto(false)}
        title="Transferir el rol de Jefe"
        footer={
          <>
            <Button variant="outline" onClick={() => setTransferirAbierto(false)} disabled={procesando}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={!transferencia.nuevo || !transferencia.password || procesando}
              onClick={() => setConfirmarTransferencia(true)}
            >
              Transferir
            </Button>
          </>
        }
      >
        <MensajeFijo tono="advertencia" style={{ marginBottom: 14 }}>
          Solo hay un Jefe por gimnasio. Al transferir, pierdes el acceso a personal, permisos, configuración y
          auditoría, y pasas al rol que elijas.
        </MensajeFijo>
        {errorTransferir && (
          <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
            {errorTransferir}
          </MensajeFijo>
        )}
        {cargandoCandidatos ? (
          <Cargando filas={3} alto={36} />
        ) : candidatos.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No hay personal activo al que transferir el rol.</p>
        ) : (
          <>
            <Select
              label="Nuevo jefe"
              value={transferencia.nuevo}
              onChange={(e) => setTransferencia({ ...transferencia, nuevo: e.target.value })}
              options={[
                { value: '', label: 'Selecciona una persona' },
                ...candidatos.map((c) => ({ value: c.id, label: `${c.nombre} · ${ETIQUETA_ROL[c.rol] ?? c.rol}` })),
              ]}
            />
            <Select
              label="Tu nuevo rol"
              value={transferencia.rol}
              onChange={(e) => setTransferencia({ ...transferencia, rol: e.target.value as RolStaff })}
              options={OPCIONES_ROL}
            />
            <Input
              label="Tu contraseña actual"
              type="password"
              autoComplete="current-password"
              value={transferencia.password}
              onChange={(e) => setTransferencia({ ...transferencia, password: e.target.value })}
            />
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmarTransferencia}
        onClose={() => setConfirmarTransferencia(false)}
        onConfirm={transferir}
        title="Confirmar transferencia"
        message={`${nuevoJefe?.nombre ?? 'La persona elegida'} será el nuevo Jefe y tú pasarás a ${ETIQUETA_ROL[transferencia.rol]}. Esta acción no se puede deshacer desde tu cuenta.`}
        confirmText="Sí, transferir"
        isDestructive
        isLoading={procesando}
      />
    </div>
  );
};
