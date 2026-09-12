import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Eye,
  Activity,
  Fingerprint,
  Calendar,
  AlertCircle,
  Trash2,
  Scale,
} from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import {
  DeportistaResumenResponse,
  FichaDeportistaResponse,
  CrearDeportistaRequest,
  RegistrarMedicionRequest,
} from '../../types/deportistas.types';

export const DeportistasPage: React.FC = () => {
  const { showToast } = useToast();

  const [deportistas, setDeportistas] = useState<DeportistaResumenResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // New Athlete Modal
  const [showCrearModal, setShowCrearModal] = useState(false);
  const [formData, setFormData] = useState<CrearDeportistaRequest>({
    documento: '',
    nombre: '',
    correo: '',
    telefono: '',
    sexo: 'M',
    fecha_nacimiento: '',
    altura_cm: 175,
    consentimiento_1581: false,
    acudiente_nombre: '',
  });

  // Ficha 360 Modal
  const [selectedDeportistaId, setSelectedDeportistaId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaDeportistaResponse | null>(null);
  const [isLoadingFicha, setIsLoadingFicha] = useState(false);

  // Measurement Modal
  const [showMedicionModal, setShowMedicionModal] = useState(false);
  const [medicionData, setMedicionData] = useState<RegistrarMedicionRequest>({
    peso: 72.5,
    grasa_pct: 18.2,
    masa_muscular: 36.4,
    cintura: 82,
    cadera: 98,
    brazo: 34,
    pierna: 55,
    pecho: 102,
  });

  const [isProcessing, setIsProcessing] = useState(false);

  const loadDeportistas = useCallback(async () => {
    setIsLoading(true);
    try {
      if (searchQuery.trim().length >= 2) {
        const items = await deportistasService.buscar(searchQuery.trim());
        setDeportistas(items);
        setTotal(items.length);
      } else {
        const res = await deportistasService.getDeportistas({
          skip: (page - 1) * limit,
          limit,
          estado_membresia: estadoFilter || undefined,
        });
        setDeportistas(res.items);
        setTotal(res.total);
      }
    } catch (e) {
      console.error('Error loading deportistas', e);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, searchQuery, estadoFilter]);

  useEffect(() => {
    loadDeportistas();
  }, [loadDeportistas]);

  const handleCrearSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.consentimiento_1581) {
      showToast('warning', 'Consentimiento Ley 1581', 'El deportista debe autorizar el tratamiento de datos personales.');
      return;
    }

    setIsProcessing(true);
    try {
      await deportistasService.crear(formData);
      showToast('success', 'Deportista Registrado', 'Ficha creada con consentimiento de Habeas Data');
      setShowCrearModal(false);
      setFormData({
        documento: '',
        nombre: '',
        correo: '',
        telefono: '',
        sexo: 'M',
        fecha_nacimiento: '',
        altura_cm: 175,
        consentimiento_1581: false,
        acudiente_nombre: '',
      });
      loadDeportistas();
    } catch (err) {
      showToast('error', 'Error al crear deportista', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenFicha = async (id: string) => {
    setSelectedDeportistaId(id);
    setIsLoadingFicha(true);
    try {
      const data = await deportistasService.getFicha(id);
      setFicha(data);
    } catch (err) {
      showToast('error', 'Error al cargar ficha 360°', parseApiError(err));
    } finally {
      setIsLoadingFicha(false);
    }
  };

  const handleRegistrarMedicion = async () => {
    if (!selectedDeportistaId) return;
    setIsProcessing(true);
    try {
      await deportistasService.registrarMedicion(selectedDeportistaId, medicionData);
      showToast('success', 'Medición Guardada', 'Progreso corporal registrado en la ficha');
      setShowMedicionModal(false);
      handleOpenFicha(selectedDeportistaId);
    } catch (err) {
      showToast('error', 'Error al guardar medición', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEnrolarHuella = async () => {
    if (!selectedDeportistaId) return;
    setIsProcessing(true);
    try {
      await deportistasService.enrolarHuella(selectedDeportistaId, {
        dedo: 'indice_derecho',
        template_base64: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=',
      });
      showToast('success', 'Huella Enrolada', 'Plantilla biométrica cifrada con éxito');
      handleOpenFicha(selectedDeportistaId);
    } catch (err) {
      showToast('error', 'Error al enrolar huella', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusBadge = (estado: string) => {
    switch (estado) {
      case 'al_dia':
        return <Badge variant="success">Al Día</Badge>;
      case 'por_vencer':
        return <Badge variant="warning">Por Vencer</Badge>;
      case 'en_mora':
        return <Badge variant="danger">En Mora</Badge>;
      case 'vencido':
        return <Badge variant="danger">Vencido</Badge>;
      case 'congelado':
        return <Badge variant="info">Congelado</Badge>;
      default:
        return <Badge variant="neutral">Sin Membresía</Badge>;
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestión de Deportistas y Biometría</h1>
          <p className="page-subtitle">
            Padrón de afiliados, ficha 360°, consentimiento Ley 1581, mediciones y enrolamiento
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<UserPlus size={16} />}
          onClick={() => setShowCrearModal(true)}
        >
          Nuevo Deportista
        </Button>
      </div>

      {/* Filters & Search Toolbar */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <SearchInput
            placeholder="Buscar por nombre o documento..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div style={{ width: 220 }}>
            <Select
              options={[
                { value: '', label: 'Todos los estados' },
                { value: 'al_dia', label: 'Al Día' },
                { value: 'por_vencer', label: 'Por Vencer' },
                { value: 'en_mora', label: 'En Mora' },
                { value: 'vencido', label: 'Vencido' },
                { value: 'congelado', label: 'Congelado' },
                { value: 'sin_membresia', label: 'Sin Membresía' },
              ]}
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* Athletes Table */}
      <Table<DeportistaResumenResponse>
        columns={[
          {
            header: 'Documento',
            accessor: 'documento',
            width: '120px',
          },
          {
            header: 'Nombre del Deportista',
            render: (d) => (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{d.nombre}</div>
                {d.correo && <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>{d.correo}</div>}
              </div>
            ),
          },
          {
            header: 'Teléfono',
            accessor: (d) => d.telefono || '-',
            width: '130px',
          },
          {
            header: 'Plan Actual',
            accessor: (d) => d.plan_nombre || 'Ninguno',
          },
          {
            header: 'Estado Membresía',
            render: (d) => getStatusBadge(d.estado_membresia),
            width: '140px',
          },
          {
            header: 'Vencimiento',
            accessor: (d) => d.fecha_vencimiento || '-',
            width: '130px',
          },
          {
            header: 'Acciones',
            align: 'right',
            width: '100px',
            render: (d) => (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Eye size={14} />}
                onClick={() => handleOpenFicha(d.id)}
              >
                Ficha 360°
              </Button>
            ),
          },
        ]}
        data={deportistas}
        isLoading={isLoading}
        keyExtractor={(d) => d.id}
        pagination={{
          currentPage: page,
          totalPages: Math.ceil(total / limit) || 1,
          onPageChange: (p) => setPage(p),
        }}
        emptyMessage="No se encontraron deportistas registrados"
      />

      {/* Modal: Crear Deportista */}
      <Modal
        isOpen={showCrearModal}
        onClose={() => setShowCrearModal(false)}
        title="Inscribir Nuevo Deportista"
        maxWidth="620px"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCrearModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearSubmit} isLoading={isProcessing}>
              Registrar Afiliado
            </Button>
          </>
        }
      >
        <form onSubmit={handleCrearSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Documento de Identidad *"
              value={formData.documento}
              onChange={(e) => setFormData({ ...formData, documento: e.target.value })}
              required
            />
            <Input
              label="Nombre Completo *"
              value={formData.nombre}
              onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Correo Electrónico"
              type="email"
              value={formData.correo || ''}
              onChange={(e) => setFormData({ ...formData, correo: e.target.value })}
            />
            <Input
              label="Teléfono / Celular"
              value={formData.telefono || ''}
              onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Select
              label="Sexo"
              options={[
                { value: 'M', label: 'Masculino' },
                { value: 'F', label: 'Femenino' },
                { value: 'otro', label: 'Otro' },
              ]}
              value={formData.sexo}
              onChange={(e) => setFormData({ ...formData, sexo: e.target.value as any })}
            />
            <Input
              label="Fecha de Nacimiento"
              type="date"
              value={formData.fecha_nacimiento || ''}
              onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })}
            />
            <Input
              label="Estatura (cm)"
              type="number"
              value={formData.altura_cm || ''}
              onChange={(e) => setFormData({ ...formData, altura_cm: Number(e.target.value) })}
            />
          </div>

          <Input
            label="Nombre del Acudiente (Si es menor de edad)"
            placeholder="Obligatorio para menores de 18 años"
            value={formData.acudiente_nombre || ''}
            onChange={(e) => setFormData({ ...formData, acudiente_nombre: e.target.value })}
          />

          {/* Habeas Data 1581 Checkbox */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-color)',
              marginTop: 10,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <input
              type="checkbox"
              id="consentimiento_1581"
              checked={formData.consentimiento_1581}
              onChange={(e) => setFormData({ ...formData, consentimiento_1581: e.target.checked })}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <label htmlFor="consentimiento_1581" style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <strong>Consentimiento de Tratamiento de Datos (Ley 1581 de 2012):</strong> Autorizo de manera previa, expresa e informada el tratamiento de mis datos personales y biométricos para fines de control de acceso y gestión del gimnasio.
            </label>
          </div>
        </form>
      </Modal>

      {/* Modal: Ficha 360° */}
      <Modal
        isOpen={!!selectedDeportistaId}
        onClose={() => setSelectedDeportistaId(null)}
        title="Ficha 360° del Deportista"
        maxWidth="740px"
      >
        {ficha ? (
          <div>
            {/* Header info */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 16,
                borderBottom: '1px solid var(--border-color)',
                marginBottom: 16,
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>{ficha.deportista.nombre}</h3>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Documento: {ficha.deportista.documento} · Correo: {ficha.deportista.correo || 'No registrado'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Fingerprint size={14} />}
                  onClick={handleEnrolarHuella}
                >
                  Enrolar Huella
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Scale size={14} />}
                  onClick={() => setShowMedicionModal(true)}
                >
                  Medición
                </Button>
              </div>
            </div>

            {/* Active Membership Block */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8 }}>Membresía</h4>
              {ficha.membresia_actual ? (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{ficha.membresia_actual.plan_nombre}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Vence el {ficha.membresia_actual.fecha_vencimiento} ({ficha.membresia_actual.dias_restantes} días restantes)
                    </div>
                  </div>
                  <Badge variant={ficha.membresia_actual.congelado ? 'info' : 'success'}>
                    {ficha.membresia_actual.congelado ? 'Congelada' : 'Activa'}
                  </Badge>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  El deportista no tiene una membresía activa en este momento.
                </div>
              )}
            </div>

            {/* Measurements Block */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8 }}>
                Historial de Mediciones Corporales
              </h4>
              {ficha.mediciones_recientes.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  Aún no se han registrado mediciones antropométricas.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ficha.mediciones_recientes.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        fontSize: '0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Fecha: {m.fecha}</span>
                      <span>Peso: {m.peso ? `${m.peso} kg` : '-'}</span>
                      <span>Grasa: {m.grasa_pct ? `${m.grasa_pct}%` : '-'}</span>
                      <span>Músculo: {m.masa_muscular ? `${m.masa_muscular} kg` : '-'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 30 }}>Cargando ficha...</div>
        )}
      </Modal>

      {/* Modal: Registrar Medición */}
      <Modal
        isOpen={showMedicionModal}
        onClose={() => setShowMedicionModal(false)}
        title="Registrar Medición Corporal"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowMedicionModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleRegistrarMedicion} isLoading={isProcessing}>
              Guardar Medición
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Input
            label="Peso (kg)"
            type="number"
            value={medicionData.peso || ''}
            onChange={(e) => setMedicionData({ ...medicionData, peso: Number(e.target.value) })}
          />
          <Input
            label="% Grasa"
            type="number"
            value={medicionData.grasa_pct || ''}
            onChange={(e) => setMedicionData({ ...medicionData, grasa_pct: Number(e.target.value) })}
          />
          <Input
            label="Músculo (kg)"
            type="number"
            value={medicionData.masa_muscular || ''}
            onChange={(e) => setMedicionData({ ...medicionData, masa_muscular: Number(e.target.value) })}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Input
            label="Cintura (cm)"
            type="number"
            value={medicionData.cintura || ''}
            onChange={(e) => setMedicionData({ ...medicionData, cintura: Number(e.target.value) })}
          />
          <Input
            label="Cadera (cm)"
            type="number"
            value={medicionData.cadera || ''}
            onChange={(e) => setMedicionData({ ...medicionData, cadera: Number(e.target.value) })}
          />
          <Input
            label="Brazo (cm)"
            type="number"
            value={medicionData.brazo || ''}
            onChange={(e) => setMedicionData({ ...medicionData, brazo: Number(e.target.value) })}
          />
        </div>
      </Modal>
    </div>
  );
};
