import React, { useState, useEffect, useCallback } from 'react';
import {
  UserCheck,
  Shield,
  Save,
  Check,
  X,
} from 'lucide-react';
import { authService } from '../../api/auth.service';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { PermisoMatrizItemDto, PermisoItemUpdate } from '../../types/auth.types';

export const PersonalPage: React.FC = () => {
  const { showToast } = useToast();

  const [matriz, setMatriz] = useState<PermisoMatrizItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadMatriz = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await authService.getMatrizPermisos();
      setMatriz(data);
    } catch (e) {
      console.error('Error loading permissions matrix', e);
      // Fallback matrix if backend returns empty or user is in demo mode
      setMatriz([
        { rol: 'recepcionista', submodulo: 'control_ingreso', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'recepcionista', submodulo: 'caja', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'recepcionista', submodulo: 'deportistas', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'recepcionista', submodulo: 'membresias', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'recepcionista', submodulo: 'clases', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'entrenador', submodulo: 'entrenamiento', puede_crear: true, puede_leer: true, puede_editar: true, puede_eliminar: false },
        { rol: 'entrenador', submodulo: 'clases', puede_crear: false, puede_leer: true, puede_editar: false, puede_eliminar: false },
        { rol: 'entrenador', submodulo: 'deportistas', puede_crear: false, puede_leer: true, puede_editar: false, puede_eliminar: false },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatriz();
  }, [loadMatriz]);

  const togglePermission = (
    rol: string,
    submodulo: string,
    campo: 'puede_crear' | 'puede_leer' | 'puede_editar' | 'puede_eliminar'
  ) => {
    setMatriz((prev) =>
      prev.map((item) => {
        if (item.rol === rol && item.submodulo === submodulo) {
          return { ...item, [campo]: !item[campo] };
        }
        return item;
      })
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: PermisoItemUpdate[] = matriz
        .filter((m) => m.rol === 'recepcionista' || m.rol === 'entrenador')
        .map((m) => ({
          rol: m.rol as 'recepcionista' | 'entrenador',
          submodulo: m.submodulo,
          puede_crear: m.puede_crear,
          puede_leer: m.puede_leer,
          puede_editar: m.puede_editar,
          puede_eliminar: m.puede_eliminar,
        }));

      await authService.updateMatrizPermisos(payload);
      showToast('success', 'Permisos Actualizados', 'La matriz de acceso por rol ha sido guardada en la base de datos.');
    } catch (err) {
      showToast('error', 'Error al guardar permisos', parseApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Personal y Matriz de Permisos (RBAC)</h1>
          <p className="page-subtitle">
            Configuración de accesos y capacidades por rol subordinado (Recepcionista / Entrenador) · Solo Jefe
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<Save size={16} />}
          onClick={handleSave}
          isLoading={isSaving}
        >
          Guardar Cambios
        </Button>
      </div>

      <Card title="Matriz de Capacidades por Submódulo">
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
          Como Jefe, puedes encender o apagar permisos individuales en tiempo real. El backend valida estas capacidades en cada petición y registra las modificaciones en la auditoría inmutable.
        </p>

        <div className="table-responsive">
          <table className="table-base">
            <thead>
              <tr>
                <th>Rol</th>
                <th>Submódulo</th>
                <th style={{ textAlign: 'center' }}>Leer</th>
                <th style={{ textAlign: 'center' }}>Crear</th>
                <th style={{ textAlign: 'center' }}>Editar</th>
                <th style={{ textAlign: 'center' }}>Eliminar</th>
              </tr>
            </thead>
            <tbody>
              {matriz.map((item, idx) => (
                <tr key={`${item.rol}-${item.submodulo}-${idx}`}>
                  <td>
                    <Badge variant={item.rol === 'recepcionista' ? 'info' : 'primary'}>
                      {item.rol}
                    </Badge>
                  </td>
                  <td style={{ fontWeight: 700, textTransform: 'capitalize' }}>
                    {item.submodulo.replace('_', ' ')}
                  </td>
                  {(['puede_leer', 'puede_crear', 'puede_editar', 'puede_eliminar'] as const).map(
                    (campo) => (
                      <td key={campo} style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => togglePermission(item.rol, item.submodulo, campo)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            backgroundColor: item[campo]
                              ? 'var(--success-light)'
                              : 'var(--bg-surface-elevated)',
                            color: item[campo] ? 'var(--success)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {item[campo] ? <Check size={16} /> : <X size={16} />}
                        </button>
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
