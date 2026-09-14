import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ContentSection } from '@/components/layout/ContentSection';
import { Tabs, TabItem } from '@/components/navigation/Tabs';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { StatusBadge } from '@/components/data/StatusBadge';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { RegisterPaymentModal } from '@/components/business/RegisterPaymentModal';
import { VoidPaymentModal } from '@/components/business/VoidPaymentModal';
import { ChangeStatusModal } from '@/components/business/ChangeStatusModal';
import { CancelGymModal } from '@/components/business/CancelGymModal';
import { UpdatePriceModal } from '@/components/business/UpdatePriceModal';
import { CredentialsModal } from '@/components/business/CredentialsModal';
import { useGymDetail } from '@/hooks/useGymDetail';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { Payment } from '@/types/payment.types';
import { SubscriptionResponse, CredentialsIssuanceResponse } from '@/types/gym.types';
import { AuditLog } from '@/types/audit.types';
import {
  Building2,
  DollarSign,
  KeyRound,
  Shield,
  History,
  TrendingUp,
  AlertCircle,
  Clock,
  Send,
  Ban,
  CheckCircle2,
  ExternalLink,
  Phone,
  Mail,
  MapPin,
  FileText,
  Share2,
  Globe,
} from 'lucide-react';

export const GymDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { gym, isLoading, error, refetch, updateGym, regenerateCredentials, resendCredentials } =
    useGymDetail(id);
  const { success, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<string>('general');

  // Modals state
  const [isRegisterPaymentOpen, setIsRegisterPaymentOpen] = useState<boolean>(false);
  const [selectedVoidPayment, setSelectedVoidPayment] = useState<Payment | null>(null);
  const [isChangeStatusOpen, setIsChangeStatusOpen] = useState<boolean>(false);
  const [isCancelGymOpen, setIsCancelGymOpen] = useState<boolean>(false);
  const [isUpdatePriceOpen, setIsUpdatePriceOpen] = useState<boolean>(false);
  const [issuedCreds, setIssuedCreds] = useState<CredentialsIssuanceResponse | null>(null);

  // General tab editable form state
  const [isEditingGeneral, setIsEditingGeneral] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nit, setNit] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);

  // Initialize editable fields when gym loads
  React.useEffect(() => {
    if (gym) {
      setNombre(gym.nombre);
      setNit(gym.nit || '');
      setDireccion(gym.direccion || '');
      setCiudad(gym.ciudad || '');
      setTelefono(gym.telefono || '');
      setCorreo(gym.correo || '');
      setLogoUrl(gym.logo_url || '');
      setBannerUrl(gym.banner_url || '');
      setDescripcion(gym.descripcion || '');
      setInstagram(gym.instagram || '');
      setFacebook(gym.facebook || '');
      setWhatsapp(gym.whatsapp || '');
    }
  }, [gym]);

  if (isLoading) {
    return (
      <PageContainer>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Skeleton height="40px" width="300px" />
          <Skeleton height="160px" />
          <Skeleton height="350px" />
        </div>
      </PageContainer>
    );
  }

  if (error || !gym) {
    return (
      <PageContainer>
        <ErrorState
          title="No pudimos encontrar este gimnasio"
          message={error || 'El gimnasio solicitado no existe o fue retirado.'}
          onRetry={refetch}
        />
      </PageContainer>
    );
  }

  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGeneral(true);
    try {
      await updateGym({
        nombre: nombre.trim(),
        nit: nit.trim() || undefined,
        direccion: direccion.trim() || undefined,
        ciudad: ciudad.trim() || undefined,
        telefono: telefono.trim() || undefined,
        correo: correo.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        banner_url: bannerUrl.trim() || undefined,
        descripcion: descripcion.trim() || undefined,
        instagram: instagram.trim() || undefined,
        facebook: facebook.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
      });
      success('Datos del gimnasio actualizados exitosamente.');
      setIsEditingGeneral(false);
      refetch();
    } catch (err) {
      const parsed = parseApiError(err);
      toastError(parsed.message);
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const handleRegenerateCredentials = async () => {
    try {
      const creds = await regenerateCredentials();
      setIssuedCreds(creds);
      success('Nuevas credenciales emitidas con 72 horas de vigencia.');
    } catch (err) {
      const parsed = parseApiError(err);
      toastError(parsed.message);
    }
  };

  const handleResendCredentials = async () => {
    try {
      const creds = await resendCredentials();
      setIssuedCreds(creds);
      success('Credenciales vigentes preparadas para envío.');
    } catch (err) {
      const parsed = parseApiError(err);
      toastError(parsed.message);
    }
  };

  const tabs: TabItem[] = [
    { id: 'general', label: 'Ficha General', icon: <Building2 size={16} /> },
    { id: 'jefe', label: 'Dueño y Accesos', icon: <KeyRound size={16} /> },
    {
      id: 'pagos',
      label: 'Suscripción y Pagos',
      icon: <DollarSign size={16} />,
      badge: gym.historial_pagos.length,
    },
    {
      id: 'actividad',
      label: 'Actividad Reciente',
      icon: <History size={16} />,
      badge: gym.actividad_reciente.length,
    },
  ];

  // Payment Table Columns
  const paymentColumns: ColumnDef<Payment>[] = [
    {
      id: 'fecha',
      header: 'Fecha de Pago',
      render: (p) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)', fontFamily: 'var(--font-mono)' }}>
            {p.fecha_pago}
          </div>
          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)' }}>
            {new Date(p.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ),
    },
    {
      id: 'monto',
      header: 'Monto',
      render: (p) => (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-semibold)',
            color: p.anulado ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
            textDecoration: p.anulado ? 'line-through' : 'none',
          }}
        >
          {formatCOP(p.monto)}
        </span>
      ),
    },
    {
      id: 'meses',
      header: 'Meses',
      render: (p) => <span>{p.meses} {p.meses === 1 ? 'mes' : 'meses'}</span>,
    },
    {
      id: 'metodo',
      header: 'Método / Comprobante',
      render: (p) => (
        <div>
          <div style={{ fontSize: 'var(--font-size-sm)' }}>{p.metodo}</div>
          {p.nota && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              {p.nota}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (p) => (
        <div>
          <StatusBadge status={p.anulado ? 'anulado' : 'vigente'} />
          {p.anulado && p.motivo_anulacion && (
            <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-error)', marginTop: '2px' }}>
              Motivo: {p.motivo_anulacion}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'idempotency',
      header: 'Idempotency Key',
      render: (p) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)' }}>
          {p.idempotency_key.substring(0, 14)}…
        </span>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (p) =>
        !p.anulado && (
          <Button
            variant="ghost"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            onClick={() => setSelectedVoidPayment(p)}
          >
            Anular
          </Button>
        ),
    },
  ];

  // Price History Columns
  const subscriptionHistoryColumns: ColumnDef<SubscriptionResponse>[] = [
    {
      id: 'valor',
      header: 'Tarifa Mensual',
      render: (s) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-semibold)' }}>
          {formatCOP(s.valor_mensual)} COP
        </span>
      ),
    },
    {
      id: 'vigente_desde',
      header: 'Vigente Desde',
      accessorKey: 'vigente_desde',
    },
    {
      id: 'vigente_hasta',
      header: 'Vigente Hasta',
      render: (s) => <span>{s.vigente_hasta || 'Actual (Vigente)'}</span>,
    },
    {
      id: 'tipo',
      header: 'Tipo Inicio',
      render: (s) => <StatusBadge status={s.tipo_inicio} />,
    },
  ];

  // Audit Columns
  const auditColumns: ColumnDef<AuditLog>[] = [
    {
      id: 'fecha',
      header: 'Fecha y Hora',
      render: (a) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {new Date(a.created_at).toLocaleString('es-CO')}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      render: (a) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)', fontSize: 'var(--font-size-sm)' }}>
            {a.actor_nombre}
          </div>
          {a.impersonando && (
            <span style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-warning)' }}>
              (Impersonando)
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'accion',
      header: 'Acción',
      render: (a) => (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-xs)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-xs)',
            backgroundColor: 'var(--color-bg-subtle)',
          }}
        >
          {a.accion}
        </span>
      ),
    },
    {
      id: 'detalle',
      header: 'Detalle',
      render: (a) => (
        <div style={{ fontSize: 'var(--font-size-xs)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a.detalle || '—'}
        </div>
      ),
    },
    {
      id: 'hash',
      header: 'Hash SHA-256',
      render: (a) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)' }}>
          {a.hash_actual.substring(0, 10)}…{a.hash_actual.substring(a.hash_actual.length - 6)}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <Breadcrumbs
        items={[
          { label: 'Gimnasios', href: '/gyms' },
          { label: gym.nombre },
        ]}
        style={{ marginBottom: '16px' }}
      />

      {/* Main Header Banner */}
      <div
        style={{
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          padding: '24px 28px',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: '24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-bold)',
              color: 'var(--color-action)',
              boxShadow: 'var(--shadow-xs)',
              overflow: 'hidden',
            }}
          >
            {gym.logo_url ? (
              <img
                src={gym.logo_url}
                alt={gym.nombre}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              gym.nombre.substring(0, 2).toUpperCase()
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', margin: 0 }}>
                {gym.nombre}
              </h1>
              <StatusBadge status={gym.estado} />
              {gym.dias_restantes !== null && gym.dias_restantes !== undefined && (
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor:
                      gym.dias_restantes < 0
                        ? 'var(--color-error-light)'
                        : gym.dias_restantes <= 5
                        ? 'var(--color-warning-light)'
                        : 'var(--color-bg-subtle)',
                    color:
                      gym.dias_restantes < 0
                        ? 'var(--color-error)'
                        : gym.dias_restantes <= 5
                        ? 'var(--color-warning)'
                        : 'var(--color-text-secondary)',
                    fontWeight: 'var(--font-weight-medium)',
                  }}
                >
                  {gym.dias_restantes < 0
                    ? `Corte vencido hace ${Math.abs(gym.dias_restantes)} días`
                    : `Corte en ${gym.dias_restantes} días (${gym.fecha_corte})`}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '6px' }}>
              <a
                href={gym.url_acceso}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-action)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: 'var(--font-weight-medium)',
                }}
              >
                <span>{gym.subdominio}.gymos.io</span>
                <ExternalLink size={13} />
              </a>
              <span style={{ color: 'var(--color-text-quaternary)' }}>•</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                {gym.ciudad || 'Colombia'}
              </span>
              {gym.nit && (
                <>
                  <span style={{ color: 'var(--color-text-quaternary)' }}>•</span>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                    NIT: {gym.nit}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            onClick={() => setIsRegisterPaymentOpen(true)}
            leftIcon={<DollarSign size={16} />}
          >
            Registrar Pago
          </Button>

          <Button
            variant="secondary"
            onClick={() => setIsChangeStatusOpen(true)}
          >
            Cambiar Estado
          </Button>

          {gym.estado !== 'cancelado' && (
            <Button
              variant="destructive"
              onClick={() => setIsCancelGymOpen(true)}
              leftIcon={<Ban size={15} />}
            >
              Baja Formal
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        variant="underline"
      />

      {/* Tab 1: Ficha General */}
      {activeTab === 'general' && (
        <ContentSection
          title="Datos de la Organización"
          subtitle="Información institucional, ubicación física y presencia digital del tenant."
          actions={
            !isEditingGeneral ? (
              <Button variant="secondary" size="sm" onClick={() => setIsEditingGeneral(true)}>
                Editar Información
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="cancel" size="sm" onClick={() => setIsEditingGeneral(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" onClick={handleSaveGeneral} isLoading={isSavingGeneral}>
                  Guardar Cambios
                </Button>
              </div>
            )
          }
        >
          <form onSubmit={handleSaveGeneral}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              <FormField label="Nombre Comercial">
                <TextInput
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={!isEditingGeneral}
                  leftElement={<Building2 size={16} />}
                />
              </FormField>

              <FormField
                label="Subdominio en la Red"
                helperText="El subdominio es estrictamente inmutable tras la creación por seguridad multi-tenant (RF-08)."
              >
                <TextInput
                  value={gym.subdominio}
                  disabled
                  leftElement={<span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'bold' }}>https://</span>}
                  rightElement={<span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>.gymos.io</span>}
                />
              </FormField>

              <FormField label="NIT / RUT">
                <TextInput
                  value={nit}
                  onChange={(e) => setNit(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="ej. 900123456-1"
                  leftElement={<FileText size={16} />}
                />
              </FormField>

              <FormField label="Ciudad">
                <TextInput
                  value={ciudad}
                  onChange={(e) => setCiudad(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="ej. Bogotá"
                  leftElement={<MapPin size={16} />}
                />
              </FormField>

              <FormField label="Dirección de la Sede">
                <TextInput
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="ej. Carrera 15 # 85-30"
                  leftElement={<MapPin size={16} />}
                />
              </FormField>

              <FormField label="Teléfono de Contacto">
                <TextInput
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="ej. +573001234567"
                  leftElement={<Phone size={16} />}
                />
              </FormField>

              <FormField label="Correo Institucional">
                <TextInput
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="contacto@gimnasio.com"
                  leftElement={<Mail size={16} />}
                />
              </FormField>

              <FormField label="WhatsApp Comercial">
                <TextInput
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="+573001234567"
                />
              </FormField>
            </div>

            {/* Social and presentation */}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '20px',
                borderTop: '1px solid var(--color-border-subtle)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '20px',
              }}
            >
              <FormField label="URL del Logo">
                <TextInput
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="https://cdn.gymos.io/logo.png"
                />
              </FormField>

              <FormField label="URL del Banner">
                <TextInput
                  value={bannerUrl}
                  onChange={(e) => setBannerUrl(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="https://cdn.gymos.io/banner.jpg"
                />
              </FormField>

              <FormField label="Instagram">
                <TextInput
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="@gimnasio"
                  leftElement={<Share2 size={16} />}
                />
              </FormField>

              <FormField label="Facebook">
                <TextInput
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                  disabled={!isEditingGeneral}
                  placeholder="fb.com/gimnasio"
                  leftElement={<Globe size={16} />}
                />
              </FormField>
            </div>

            <FormField label="Descripción de la Marca" style={{ marginTop: '16px' }}>
              <TextInput
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                disabled={!isEditingGeneral}
                placeholder="Breve reseña sobre los servicios y especialidad del gimnasio"
              />
            </FormField>
          </form>
        </ContentSection>
      )}

      {/* Tab 2: Dueño y Credenciales */}
      {activeTab === 'jefe' && (
        <div>
          <ContentSection
            title="Cuenta del Dueño / Administrador Principal (Jefe)"
            subtitle="Responsable legal del tenant en la plataforma con privilegios de gestión completa."
            actions={
              <div style={{ display: 'flex', gap: '10px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleResendCredentials}
                  leftIcon={<Send size={15} />}
                >
                  Reenviar Credenciales (RF-13)
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleRegenerateCredentials}
                  leftIcon={<KeyRound size={15} />}
                >
                  Regenerar Clave Temporal (RF-12)
                </Button>
              </div>
            }
          >
            {gym.cuenta_jefe ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '20px',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                    Nombre del Dueño
                  </div>
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' }}>
                    {gym.cuenta_jefe.nombre}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                    Correo de Acceso (Usuario)
                  </div>
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-action)' }}>
                    {gym.cuenta_jefe.correo}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                    Teléfono Celular
                  </div>
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-medium)' }}>
                    {gym.cuenta_jefe.telefono || 'No registrado'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                    Estado de la Contraseña
                  </div>
                  <div>
                    {gym.cuenta_jefe.password_cambiada ? (
                      <span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={15} /> Clave personalizada establecida
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={15} /> Utilizando clave temporal inicial
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                No se encontró registro de cuenta de Jefe para este gimnasio.
              </div>
            )}
          </ContentSection>
        </div>
      )}

      {/* Tab 3: Suscripción y Pagos */}
      {activeTab === 'pagos' && (
        <div>
          {/* Active Subscription Banner */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              padding: '20px 24px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Tarifa de Suscripción Vigente (RF-14)
              </div>
              <div style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-text-primary)' }} className="font-mono">
                {gym.suscripcion_actual ? formatCOP(gym.suscripcion_actual.valor_mensual) : '—'} <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'normal', color: 'var(--color-text-secondary)' }}>COP / mes</span>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Vigente desde: {gym.suscripcion_actual?.vigente_desde || 'Fecha de alta'} • Fecha de corte actual: <strong>{gym.fecha_corte || 'Pendiente'}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsUpdatePriceOpen(true)}
                leftIcon={<TrendingUp size={15} />}
              >
                Ajustar Tarifa (RF-14)
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsRegisterPaymentOpen(true)}
                leftIcon={<DollarSign size={15} />}
              >
                Registrar Recaudo
              </Button>
            </div>
          </div>

          {/* Payments History Table (RF-07 / RF-16 / RF-17 / RF-18) */}
          <ContentSection
            title="Historial de Pagos y Recaudos (RF-07)"
            subtitle="La fecha de corte se recalcula estrictamente a partir de los pagos vigentes no anulados (RNF-04)."
            noPadding
          >
            <DataTable
              columns={paymentColumns}
              data={gym.historial_pagos}
              keyExtractor={(p) => p.id}
              emptyTitle="No hay pagos registrados"
              emptyDescription="Registra el primer recaudo de suscripción para habilitar o extender la vigencia del gimnasio."
              emptyAction={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsRegisterPaymentOpen(true)}
                  leftIcon={<DollarSign size={15} />}
                >
                  Registrar Pago Inicial
                </Button>
              }
            />
          </ContentSection>

          {/* Price History Table (RF-14) */}
          {gym.suscripciones_historial.length > 0 && (
            <ContentSection
              title="Histórico de Tarifas Acordadas (RF-14)"
              subtitle="Registro no destructivo de evolución de precios de suscripción."
              noPadding
            >
              <DataTable
                columns={subscriptionHistoryColumns}
                data={gym.suscripciones_historial}
                keyExtractor={(s) => s.id}
              />
            </ContentSection>
          )}
        </div>
      )}

      {/* Tab 4: Actividad y Auditoría */}
      {activeTab === 'actividad' && (
        <ContentSection
          title="Trazabilidad Criptográfica Específica (RF-07 / RF-25)"
          subtitle="Historial inmutable de operaciones de escritura sobre este tenant encadenadas en SHA-256."
          noPadding
        >
          <DataTable
            columns={auditColumns}
            data={gym.actividad_reciente}
            keyExtractor={(a) => a.id}
            emptyTitle="Sin actividad registrada aún"
            emptyDescription="Las operaciones sobre este gimnasio quedarán registradas automáticamente."
          />
        </ContentSection>
      )}

      {/* Modals */}
      <RegisterPaymentModal
        isOpen={isRegisterPaymentOpen}
        onClose={() => setIsRegisterPaymentOpen(false)}
        gymId={gym.id}
        gymNombre={gym.nombre}
        defaultMonto={gym.suscripcion_actual?.valor_mensual || 150000}
        onSuccess={refetch}
      />

      <VoidPaymentModal
        isOpen={!!selectedVoidPayment}
        onClose={() => setSelectedVoidPayment(null)}
        payment={selectedVoidPayment}
        onSuccess={refetch}
      />

      <ChangeStatusModal
        isOpen={isChangeStatusOpen}
        onClose={() => setIsChangeStatusOpen(false)}
        gym={gym}
        onSuccess={refetch}
      />

      <CancelGymModal
        isOpen={isCancelGymOpen}
        onClose={() => setIsCancelGymOpen(false)}
        gym={gym}
        onSuccess={refetch}
      />

      <UpdatePriceModal
        isOpen={isUpdatePriceOpen}
        onClose={() => setIsUpdatePriceOpen(false)}
        gymId={gym.id}
        gymNombre={gym.nombre}
        currentPrice={gym.suscripcion_actual?.valor_mensual || 150000}
        onSuccess={refetch}
      />

      <CredentialsModal
        isOpen={!!issuedCreds}
        credentials={issuedCreds}
        onClose={() => setIssuedCreds(null)}
      />
    </PageContainer>
  );
};
