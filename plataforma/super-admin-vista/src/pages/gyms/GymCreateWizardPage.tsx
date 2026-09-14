import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ContentSection } from '@/components/layout/ContentSection';
import { Stepper, StepItem } from '@/components/forms/Stepper';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { Button } from '@/components/actions/Button';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { CredentialsModal } from '@/components/business/CredentialsModal';
import { gymService } from '@/services/gymService';
import { useToast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';
import { parseApiError } from '@/services/api/errorHandler';
import {
  GymCreateStepByStep,
  CredentialsIssuanceResponse,
  SubdomainCheckResponse,
} from '@/types/gym.types';
import {
  Building2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  FileText,
  User,
  DollarSign,
  Globe,
} from 'lucide-react';

const steps: StepItem[] = [
  { id: 1, label: 'Identidad', description: 'Nombre y subdominio' },
  { id: 2, label: 'Marca Pública', description: 'Redes y presentación' },
  { id: 3, label: 'Cuenta del Jefe', description: 'Dueño del gimnasio' },
  { id: 4, label: 'Suscripción', description: 'Tarifa y condición' },
];

export const GymCreateWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [issuedCreds, setIssuedCreds] = useState<CredentialsIssuanceResponse | null>(null);

  // Form State
  // Step 1: Identidad
  const [nombre, setNombre] = useState('');
  const [subdominio, setSubdominio] = useState('');
  const [nit, setNit] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('Bogotá');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');

  // Subdomain live validation state
  const debouncedSubdomain = useDebounce(subdominio, 350);
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheckResponse | null>(null);
  const [isCheckingSubdomain, setIsCheckingSubdomain] = useState(false);

  // Step 2: Imagen Pública
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  // Step 3: Cuenta del Jefe
  const [jefeNombre, setJefeNombre] = useState('');
  const [jefeCorreo, setJefeCorreo] = useState('');
  const [jefeTelefono, setJefeTelefono] = useState('');

  // Step 4: Suscripción
  const [valorMensual, setValorMensual] = useState<number>(150000);
  const [tipoInicio, setTipoInicio] = useState<'prueba' | 'cliente_activo'>('prueba');

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Autogenerate subdomain when name changes (RF-05)
  const handleNombreChange = (val: string) => {
    setNombre(val);
    const slug = val
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSubdominio(slug);
  };

  // Live subdomain check
  useEffect(() => {
    if (!debouncedSubdomain || debouncedSubdomain.length < 2) {
      setSubdomainCheck(null);
      return;
    }

    let isMounted = true;
    setIsCheckingSubdomain(true);

    gymService
      .checkSubdomain(debouncedSubdomain)
      .then((res) => {
        if (isMounted) setSubdomainCheck(res);
      })
      .catch(() => {
        if (isMounted) setSubdomainCheck(null);
      })
      .finally(() => {
        if (isMounted) setIsCheckingSubdomain(false);
      });

    return () => {
      isMounted = false;
    };
  }, [debouncedSubdomain]);

  // Step validation
  const validateCurrentStep = (): boolean => {
    const errs: Record<string, string> = {};

    if (currentStep === 1) {
      if (!nombre.trim() || nombre.trim().length < 2) {
        errs.nombre = 'El nombre del gimnasio debe tener al menos 2 caracteres.';
      }
      if (!subdominio.trim() || subdominio.trim().length < 2) {
        errs.subdominio = 'El subdominio es obligatorio.';
      } else if (subdomainCheck && (!subdomainCheck.valido || !subdomainCheck.disponible)) {
        errs.subdominio = subdomainCheck.mensaje || 'El subdominio no está disponible.';
      }
    } else if (currentStep === 3) {
      if (!jefeNombre.trim() || jefeNombre.trim().length < 2) {
        errs.jefeNombre = 'El nombre del Jefe es obligatorio.';
      }
      if (!jefeCorreo.trim() || !jefeCorreo.includes('@')) {
        errs.jefeCorreo = 'Ingresa un correo electrónico válido para la cuenta del Jefe.';
      }
    } else if (currentStep === 4) {
      if (valorMensual < 0) {
        errs.valorMensual = 'El valor de la suscripción no puede ser negativo.';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(prev + 1, 4));
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateCurrentStep()) return;

    setIsSubmitting(true);
    try {
      const payload: GymCreateStepByStep = {
        nombre: nombre.trim(),
        subdominio: subdominio.trim() || undefined,
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
        jefe: {
          nombre: jefeNombre.trim(),
          correo: jefeCorreo.trim(),
          telefono: jefeTelefono.trim() || undefined,
        },
        suscripcion: {
          valor_mensual: valorMensual,
          tipo_inicio: tipoInicio,
        },
      };

      const result = await gymService.createGym(payload);
      success(`Gimnasio "${result.gimnasio.nombre}" aprovisionado exitosamente.`);
      setIssuedCreds(result.credenciales);
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.fieldErrors) setErrors(parsed.fieldErrors);
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Alta Asistida de Gimnasio"
        subtitle="Aprovisionamiento en 4 pasos: tenant, subdominio, cuenta de Jefe y suscripción (RF-04/RF-06)."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Gimnasios', href: '/gyms' },
              { label: 'Alta Asistida' },
            ]}
          />
        }
      />

      {/* Progress Stepper */}
      <Stepper
        steps={steps}
        currentStep={currentStep}
        onStepClick={(id) => setCurrentStep(id)}
      />

      <ContentSection style={{ maxWidth: '780px', margin: '0 auto' }}>
        {/* Step 1: Identidad */}
        {currentStep === 1 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>
              Paso 1: Identidad y Subdominio
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Define el nombre oficial y la dirección web privada asignada en la red GymOS.
            </p>

            <FormField label="Nombre Comercial del Gimnasio" required error={errors.nombre}>
              <TextInput
                value={nombre}
                onChange={(e) => handleNombreChange(e.target.value)}
                placeholder="ej. Power Gym Élite"
                hasError={!!errors.nombre}
                leftElement={<Building2 size={16} />}
              />
            </FormField>

            <FormField
              label="Subdominio en la Red (Inmutable tras creación)"
              required
              error={errors.subdominio}
              helperText={
                subdomainCheck
                  ? subdomainCheck.mensaje
                  : 'Se deriva automáticamente del nombre. Solo letras minúsculas, números y guiones.'
              }
            >
              <TextInput
                value={subdominio}
                onChange={(e) => setSubdominio(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="power-gym-elite"
                hasError={!!errors.subdominio || (subdomainCheck ? !subdomainCheck.disponible : false)}
                leftElement={<Globe size={16} />}
                rightElement={
                  isCheckingSubdomain ? (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                      Validando…
                    </span>
                  ) : subdomainCheck ? (
                    subdomainCheck.disponible ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-success)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                        <CheckCircle2 size={15} />
                        <span>Disponible</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-error)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                        <XCircle size={15} />
                        <span>Ocupado</span>
                      </div>
                    )
                  ) : null
                }
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <FormField label="NIT / Identificación Tributaria" optional>
                <TextInput
                  value={nit}
                  onChange={(e) => setNit(e.target.value)}
                  placeholder="ej. 900123456-1"
                  leftElement={<FileText size={16} />}
                />
              </FormField>

              <FormField label="Ciudad">
                <TextInput
                  value={ciudad}
                  onChange={(e) => setCiudad(e.target.value)}
                  placeholder="ej. Bogotá, Medellín, Cali"
                  leftElement={<MapPin size={16} />}
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <FormField label="Teléfono de la Sede" optional>
                <TextInput
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="ej. +573001234567"
                  leftElement={<Phone size={16} />}
                />
              </FormField>

              <FormField label="Correo Institucional" optional>
                <TextInput
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="contacto@powergym.com"
                  leftElement={<Mail size={16} />}
                />
              </FormField>
            </div>

            <FormField label="Dirección Física" optional>
              <TextInput
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="ej. Cra. 15 # 85-30, Chapinero"
                leftElement={<MapPin size={16} />}
              />
            </FormField>
          </div>
        )}

        {/* Step 2: Marca Pública */}
        {currentStep === 2 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>
              Paso 2: Imagen Pública y Redes
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Configura los recursos visuales y canales sociales que verán los usuarios en la landing del gimnasio.
            </p>

            <FormField label="URL del Logo (Formato PNG o SVG con fondo transparente)" optional>
              <TextInput
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.gymos.io/logos/powergym.png"
              />
            </FormField>

            <FormField label="URL del Banner / Portada Principal" optional>
              <TextInput
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://cdn.gymos.io/banners/powergym.jpg"
              />
            </FormField>

            <FormField label="Descripción o Eslogan de la Sede" optional>
              <TextInput
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="ej. Centro de alto rendimiento especializado en acondicionamiento funcional y fuerza."
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <FormField label="Instagram (@usuario)" optional>
                <TextInput
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  placeholder="@powergymelite"
                />
              </FormField>

              <FormField label="WhatsApp Comercial" optional>
                <TextInput
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="+573001234567"
                />
              </FormField>

              <FormField label="Facebook" optional>
                <TextInput
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                  placeholder="fb.com/powergym"
                />
              </FormField>
            </div>
          </div>
        )}

        {/* Step 3: Cuenta del Jefe */}
        {currentStep === 3 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>
              Paso 3: Cuenta del Jefe / Dueño
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Se creará la cuenta principal de administración del tenant con contraseña temporal (Argon2id).
            </p>

            <FormField label="Nombre Completo del Jefe" required error={errors.jefeNombre}>
              <TextInput
                value={jefeNombre}
                onChange={(e) => setJefeNombre(e.target.value)}
                placeholder="ej. Carlos Mendoza"
                leftElement={<User size={16} />}
                hasError={!!errors.jefeNombre}
              />
            </FormField>

            <FormField
              label="Correo Electrónico (Será el usuario de acceso al tenant)"
              required
              error={errors.jefeCorreo}
              helperText="A este correo se le asociarán las credenciales de administración."
            >
              <TextInput
                type="email"
                value={jefeCorreo}
                onChange={(e) => setJefeCorreo(e.target.value)}
                placeholder="carlos@powergym.com"
                leftElement={<Mail size={16} />}
                hasError={!!errors.jefeCorreo}
              />
            </FormField>

            <FormField label="Teléfono / Celular del Jefe (Para envío por WhatsApp)" optional>
              <TextInput
                value={jefeTelefono}
                onChange={(e) => setJefeTelefono(e.target.value)}
                placeholder="+573009876543"
                leftElement={<Phone size={16} />}
              />
            </FormField>

            <div
              style={{
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                padding: '14px 16px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-primary)',
                lineHeight: 1.45,
                marginTop: '12px',
              }}
            >
              💡 <strong>Aprovisionamiento Automático:</strong> El backend creará la cuenta del Jefe en el esquema de la plataforma (`platform.staff`) con rol de <em>jefe</em>, generando una clave temporal aleatoria de 12 caracteres.
            </div>
          </div>
        )}

        {/* Step 4: Suscripción */}
        {currentStep === 4 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>
              Paso 4: Suscripción y Modelo Comercial
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Define el valor mensual recurrente convenido y el tipo de inicio en la plataforma (RF-15).
            </p>

            <FormField
              label="Tarifa Mensual Acordada (COP)"
              required
              error={errors.valorMensual}
              helperText="Valor de la mensualidad en el SaaS. Se preservará en el histórico no destructivo."
            >
              <TextInput
                type="number"
                value={valorMensual}
                onChange={(e) => setValorMensual(Number(e.target.value))}
                min={0}
                step="1000"
                leftElement={<DollarSign size={16} />}
                hasError={!!errors.valorMensual}
              />
            </FormField>

            <FormField label="Condición de Inicio" required>
              <Select
                value={tipoInicio}
                onChange={(e) => setTipoInicio(e.target.value as any)}
                options={[
                  {
                    value: 'prueba',
                    label: 'Periodo de Prueba (5 días de gracia automáticos)',
                  },
                  {
                    value: 'cliente_activo',
                    label: 'Cliente Activo (A la espera del primer recaudo)',
                  },
                ]}
              />
            </FormField>

            <div
              style={{
                backgroundColor: 'var(--color-bg-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginTop: '20px',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)', marginBottom: '6px' }}>
                Resumen de Alta:
              </div>
              <ul style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                <li>Gimnasio: <strong>{nombre || 'Sin nombre'}</strong></li>
                <li>Subdominio: <strong>https://{subdominio || '...'}.gymos.io</strong></li>
                <li>Jefe Responsable: <strong>{jefeNombre || '—'} ({jefeCorreo || '—'})</strong></li>
                <li>Tarifa: <strong>${valorMensual.toLocaleString('es-CO')} COP/mes</strong> ({tipoInicio === 'prueba' ? '5 días de cortesía' : 'Activo'})</li>
              </ul>
            </div>
          </div>
        )}

        {/* Wizard Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '32px',
            paddingTop: '20px',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          {currentStep > 1 ? (
            <Button
              variant="secondary"
              onClick={handlePrev}
              disabled={isSubmitting}
              leftIcon={<ArrowLeft size={16} />}
            >
              Anterior
            </Button>
          ) : (
            <div />
          )}

          {currentStep < 4 ? (
            <Button
              variant="primary"
              onClick={handleNext}
              rightIcon={<ArrowRight size={16} />}
            >
              Siguiente Paso
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              leftIcon={<Sparkles size={16} />}
            >
              Completar y Aprovisionar Gimnasio
            </Button>
          )}
        </div>
      </ContentSection>

      {/* Credentials Single-View Modal (RF-11) */}
      <CredentialsModal
        isOpen={!!issuedCreds}
        credentials={issuedCreds}
        onClose={() => {
          setIssuedCreds(null);
          navigate('/gyms');
        }}
      />
    </PageContainer>
  );
};
