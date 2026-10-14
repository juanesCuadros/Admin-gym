import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import type { InfoGymResponse } from '../../types/myGym.types';

const MAX_LARGO = 50;

/**
 * Configuración · Métodos de pago (GW-RF-47). `PUT /my-gym/metodos-pago` con `version`.
 * Quitar un método no altera los pagos ya registrados (el método se guarda como texto en cada pago).
 */
export const ConfigMetodosPagoPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeEditar = hasPermission('configuracion', 'editar');

  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const [nuevo, setNuevo] = useState('');
  const [tocadoNuevo, setTocadoNuevo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);
  const [aQuitar, setAQuitar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setInfo(await myGymService.getInfo());
      setErrorCarga(null);
      setErrorGuardar(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const metodos = info?.metodos_pago ?? [];
  const nuevoLimpio = nuevo.trim();
  const errorNuevo = !nuevoLimpio
    ? 'Escribe el nombre del método.'
    : nuevoLimpio.length > MAX_LARGO
      ? `Máximo ${MAX_LARGO} caracteres.`
      : metodos.some((m) => m.toLowerCase() === nuevoLimpio.toLowerCase())
        ? 'Ese método ya está en la lista.'
        : null;

  const guardarLista = async (lista: string[], exito: string): Promise<boolean> => {
    if (!info || guardando) return false;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const actualizado = await myGymService.actualizarMetodosPago({ version: info.version, metodos_pago: lista });
      setInfo(actualizado);
      showToast('success', exito);
      return true;
    } catch (e) {
      setErrorGuardar(toApiError(e));
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const agregar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTocadoNuevo(true);
    if (errorNuevo) return;
    const ok = await guardarLista([...metodos, nuevoLimpio], `Método "${nuevoLimpio}" agregado`);
    if (ok) {
      setNuevo('');
      setTocadoNuevo(false);
    }
  };

  const quitar = async () => {
    if (!aQuitar) return;
    const ok = await guardarLista(
      metodos.filter((m) => m !== aQuitar),
      `Método "${aQuitar}" quitado`
    );
    if (ok) setAQuitar(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Métodos de pago</h1>
          <p className="page-subtitle">Medios que caja ofrece al cobrar ventas y membresías</p>
        </div>
      </div>

      {cargando && !info ? (
        <Cargando filas={4} />
      ) : errorCarga || !info ? (
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      ) : (
        <Card style={{ maxWidth: 640 }}>
          {!puedeEditar && (
            <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
              Puedes ver los métodos de pago, pero no tienes permiso para cambiarlos.
            </MensajeFijo>
          )}

          {errorGuardar &&
            (errorGuardar.tipo === 'conflicto' ? (
              <div style={{ marginBottom: 16 }}>
                <Conflicto onRecargar={cargar} />
              </div>
            ) : (
              <MensajeFijo tono="error" titulo="No se guardó el cambio" style={{ marginBottom: 16 }}>
                {errorGuardar.campos.metodos_pago ?? errorGuardar.message}
              </MensajeFijo>
            ))}

          {metodos.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>No hay métodos de pago configurados.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {metodos.map((m) => (
                <li
                  key={m}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <Wallet size={16} color="var(--text-muted)" />
                  <span style={{ flex: 1, fontWeight: 600 }}>{m}</span>
                  {m.toLowerCase() === 'efectivo' && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cuenta en el arqueo de caja</span>
                  )}
                  {puedeEditar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={14} color="var(--danger)" />}
                      disabled={guardando || metodos.length <= 1}
                      title={metodos.length <= 1 ? 'Debe quedar al menos un método' : undefined}
                      onClick={() => setAQuitar(m)}
                    >
                      Quitar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {puedeEditar && (
            <form onSubmit={agregar} noValidate style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Nuevo método"
                  placeholder="p. ej. Nequi, Daviplata, Datáfono"
                  value={nuevo}
                  maxLength={MAX_LARGO}
                  onChange={(e) => setNuevo(e.target.value)}
                  onBlur={() => nuevo && setTocadoNuevo(true)}
                  error={tocadoNuevo && errorNuevo ? errorNuevo : undefined}
                  disabled={guardando}
                />
              </div>
              <Button type="submit" variant="primary" leftIcon={<Plus size={16} />} isLoading={guardando} style={{ marginTop: 26 }}>
                Agregar
              </Button>
            </form>
          )}
        </Card>
      )}

      <ConfirmDialog
        isOpen={aQuitar !== null}
        onClose={() => setAQuitar(null)}
        onConfirm={quitar}
        title="Quitar método de pago"
        message={`Caja dejará de ofrecer "${aQuitar ?? ''}". Los pagos ya registrados con este método no cambian.`}
        confirmText="Quitar"
        isDestructive
        isLoading={guardando}
      />
    </div>
  );
};
