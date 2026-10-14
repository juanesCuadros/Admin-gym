import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ContentSection } from '@/components/layout/ContentSection';
import { Stepper, StepItem } from '@/components/forms/Stepper';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { Button } from '@/components/actions/Button';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { CredentialsModal } from '@/components/business/CredentialsModal';
import { gymService } from '@/services/gymService';
import { planService } from '@/services/planService';
import { useToast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';
import { parseApiError } from '@/services/api/errorHandler';
import {
  GymCreateStepByStep,
  CredentialsIssuanceResponse,
  SubdomainCheckResponse,
  TipoInicio,
} from '@/types/gym.types';
import { Plan } from '@/types/plan.types';
import { formatCOP } from '@/utils/format';
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
  ClipboardList,
} from 'lucide-react';

const steps: StepItem[] = [
  { id: 1, label: 'Identidad', description: 'Nombre y subdominio' },
  { id: 2, label: 'Imagen pública', description: 'Redes y presentación' },
  { id: 3, label: 'Cuenta del Jefe', description: 'Dueño del gimnasio' },
  { id: 4, label: 'Suscripción', description: 'Plan y tipo de inicio' },
  { id: 5, label: 'Resumen', description: 'Revisar y confirmar' },
];

const PALABRAS_RESERVADAS = ['admin', 'www', 'api', 'app', 'mail'];
const RE_SUBDOMINIO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Validación local del subdominio (SA-RF-05 CA2, CA3). El servidor vuelve a validar. */
function errorSubdominio(valor: string): string | null {
  if (!valor) return 'El subdominio es obligatorio.';
  if (valor.length < 3 || valor.length > 63) return 'El subdominio debe tener entre 3 y 63 caracteres.';
  if (!RE_SUBDOMINIO.test(valor))
    return 'Solo letras minúsculas, números y guiones; no puede empezar ni terminar en guion.';
  if (PALABRAS_RESERVADAS.includes(valor)) return `"${valor}" es una palabra reservada.`;
  return null;
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** El tipo de plan que corresponde a cada tipo de inicio (SA-RF-33). */
const TIPO_PLAN_POR_INICIO: Record<TipoInicio, Plan['tipo']> = {
  prueba: 'prueba',
  cliente_activo: 'pago',
};

export const GymCreateWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const { success } = useToast();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const enviandoRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [issuedCreds, setIssuedCreds] = useState<CredentialsIssuanceResponse | null>(null);
  const [createdGymId, setCreatedGymId] = useState<string | null>(null);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  // Paso 1: Identidad
  const [nombre, setNombre] = useState('');
  const [subdominio, setSubdominio] = useState('');
  const [subdominioEditado, setSubdominioEditado] = useState(false);
  const [nit, setNit] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');

  const debouncedSubdomain = useDebounce(subdominio, 350);
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheckResponse | null>(null);
  const [isCheckingSubdomain, setIsCheckingSubdomain] = useState(false);

  // Paso 2: Imagen pública
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  // Paso 3: Cuenta del Jefe
  const [jefeNombre, setJefeNombre] = useState('');
  const [jefeCorreo, setJefeCorreo] = useState('');
  const [jefeTelefono, setJefeTelefono] = useState('');

  // Paso 4: Suscripción
  const [tipoInicio, setTipoInicio] = useState<TipoInicio>('prueba');
  const [planId, setPlanId] = useState<string>('');
  const [valorMensual, setValorMensual] = useState<string>('');

  // Planes (GET /admin/plans, solo activos)
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [planesCargando, setPlanesCargando] = useState(true);
  const [planesError, setPlanesError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const cargarPlanes = useCallback(async () => {
    setPlanesCargando(true);
    setPlanesError(null);
    try {
      const data = await planService.listPlans();
      setPlanes(data.filter((p) => p.activo).sort((a, b) => a.orden - b.orden));
    } catch (err) {
      setPlanesError(parseApiError(err).message);
    } finally {
      setPlanesCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarPlanes();
  }, [cargarPlanes]);

  const planesDelTipo = useMemo(
    () => planes.filter((p) => p.tipo === TIPO_PLAN_POR_INICIO[tipoInicio]),
    [planes, tipoInicio]
  );
  const planElegido = planes.find((p) => p.id === planId) || null;

  // Si cambia el tipo de inicio y el plan ya no corresponde, se limpia.
  useEffect(() => {
    if (planId && !planesDelTipo.some((p) => p.id === planId)) {
      setPlanId('');
    }
  }, [planesDelTipo, planId]);

  // Con un solo plan disponible se preselecciona.
  useEffect(() => {
    if (!planId && planesDelTipo.length === 1) {
      elegirPlan(planesDelTipo[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planesDelTipo]);

  const elegirPlan = (id: string) => {
    setPlanId(id);
    const plan = planes.find((p) => p.id === id);
    if (plan) setValorMensual(String(plan.precio));
  };

  const hayCambios =
    !issuedCreds &&
    [nombre, nit, direccion, ciudad, telefono, correo, logoUrl, bannerUrl, descripcion, instagram, facebook, whatsapp, jefeNombre, jefeCorreo, jefeTelefono].some(
      (v) => v.trim() !== ''
    );

  // SA-RF-04 CA4: aviso al cerrar o recargar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hayCambios]);

  // Autogenera el subdominio desde el nombre mientras no se haya editado a mano (SA-RF-05 CA1).
  const handleNombreChange = (val: string) => {
    setNombre(val);
    if (!subdominioEditado) {
      const slug = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63)
        .replace(/-+$/g, '');
      setSubdominio(slug);
    }
  };

  // Validación del subdominio en vivo.
  useEffect(() => {
    if (!debouncedSubdomain || errorSubdominio(debouncedSubdomain)) {
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

  const validarPaso = (paso: number): Record<string, string> => {
    const errs: Record<string, string> = {};

    if (paso === 1) {
      if (nombre.trim().length < 2) {
        errs.nombre = 'El nombre del gimnasio debe tener al menos 2 caracteres.';
      } else if (nombre.trim().length > 150) {
        errs.nombre = 'El nombre no puede superar 150 caracteres.';
      }
      const errSub = errorSubdominio(subdominio.trim());
      if (errSub) {
        errs.subdominio = errSub;
      } else if (subdomainCheck && subdomainCheck.subdominio === subdominio && (!subdomainCheck.valido || !subdomainCheck.disponible)) {
        errs.subdominio = subdomainCheck.mensaje || 'El subdominio no está disponible.';
      }
      if (correo.trim() && !RE_CORREO.test(correo.trim())) {
        errs.correo = 'Ingresa un correo válido.';
      }
    } else if (paso === 2) {
      if (descripcion.length > 300) {
        errs.descripcion = 'La descripción admite máximo 300 caracteres.';
      }
    } else if (paso === 3) {
      if (jefeNombre.trim().length < 2) {
        errs.jefeNombre = 'El nombre del Jefe es obligatorio (mínimo 2 caracteres).';
      }
      if (!RE_CORREO.test(jefeCorreo.trim())) {
        errs.jefeCorreo = 'Ingresa un correo válido para la cuenta del Jefe.';
      }
    } else if (paso === 4) {
      if (!planId) {
        errs.plan = 'Selecciona el plan de suscripción.';
      }
      const valor = Number(valorMensual);
      if (valorMensual.trim() === '' || !Number.isInteger(valor) || valor < 0) {
        errs.valorMensual = 'Ingresa el valor mensual en pesos, sin decimales (puede ser 0).';
      }
    }
    return errs;
  };

  const validateCurrentStep = (): boolean => {
    const errs = validarPaso(currentStep);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(prev + 1, 5));
    }
  };

  const handlePrev = () => {
    setErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  /** Ubica el error del servidor en el paso que corresponde. */
  const mostrarErrorServidor = (codigo: string | undefined, mensaje: string, fieldErrors?: Record<string, string>) => {
    setSubmitError(mensaje);
    if (codigo && codigo.startsWith('SUBDOMINIO_')) {
      setErrors({ subdominio: mensaje });
      setCurrentStep(1);
      return;
    }
    if (codigo === 'PLAN_INCOHERENTE' || codigo === 'PLAN_NO_DISPONIBLE') {
      setErrors({ plan: mensaje });
      setCurrentStep(4);
      cargarPlanes();
      return;
    }
    if (codigo === 'CONFLICTO' && mensaje.toLowerCase().includes('correo del jefe')) {
      setErrors({ jefeCorreo: mensaje });
      setCurrentStep(3);
      return;
    }
    if (fieldErrors) {
      const errs: Record<string, string> = {};
      if (fieldErrors.nombre) errs.nombre = fieldErrors.nombre;
      if (fieldErrors.subdominio) errs.subdominio = fieldErrors.subdominio;
      if (fieldErrors.descripcion) errs.descripcion = fieldErrors.descripcion;
      if (fieldErrors.plan_id) errs.plan = fieldErrors.plan_id;
      if (fieldErrors.valor_mensual) errs.valorMensual = fieldErrors.valor_mensual;
      setErrors(errs);
    }
  };

  const handleSubmit = async () => {
    if (enviandoRef.current) return; // SA-RF-04 CA3: doble clic = un solo envío.

    // Se revalidan todos los pasos antes de enviar.
    for (const paso of [1, 2, 3, 4]) {
      const errs = validarPaso(paso);
      if (Object.keys(errs).length) {
        setErrors(errs);
        setCurrentStep(paso);
        return;
      }
    }

    enviandoRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
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
          valor_mensual: Number(valorMensual),
          tipo_inicio: tipoInicio,
          plan_id: planId,
        },
      };

      const result = await gymService.createGym(payload);
      success(`Gimnasio "${result.gimnasio.nombre}" creado.`);
      setCreatedGymId(result.gimnasio.id);
      setIssuedCreds(result.credenciales);
    } catch (err) {
      // SA-RF-04 CA2: los datos del formulario se conservan para reintentar.
      const parsed = parseApiError(err);
      mostrarErrorServidor(parsed.codigo, parsed.message, parsed.fieldErrors);
    } finally {
      enviandoRef.current = false;
      setIsSubmitting(false);
    }
  };

  const salir = () => {
    if (hayCambios) {
      setConfirmarSalida(true);
    } else {
      navigate('/gyms');
    }
  };

  const etiquetaPlan = (p: Plan) => {
    if (p.tipo === 'prueba') {
      return `${p.nombre} · prueba de ${p.dias_prueba ?? '—'} días`;
    }
    const meses = p.duracion_meses ?? 1;
    return `${p.nombre} · ${formatCOP(p.precio)}/mes · ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  };

  const filaResumen = (etiqueta: string, valor: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>{etiqueta}</span>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>{valor || '—'}</span>
    </div>
  );

  const tituloResumen = (texto: string, paso: number) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '18px', marginBottom: '6px' }}>
      <strong style={{ fontSize: 'var(--font-size-sm)' }}>{texto}</strong>
      <Button variant="ghost" size="sm" onClick={() => setCurrentStep(paso)} disabled={isSubmitting}>
        Editar
      </Button>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Crear gimnasio"
        subtitle="Alta asistida en 4 pasos: identidad, imagen pública, cuenta del Jefe y suscripción (SA-RF-04)."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Gimnasios', href: '/gyms' },
              { label: 'Crear gimnasio' },
            ]}
          />
        }
      />

      <Stepper
        steps={steps}
        currentStep={currentStep}
        onStepClick={(id) => {
          // Solo se puede volver a pasos anteriores; para avanzar hay que validar.
          if (id < currentStep && !isSubmitting) {
            setErrors({});
            setCurrentStep(id);
          }
        }}
      />

      <ContentSection style={{ maxWidth: '780px', margin: '0 auto' }}>
        {submitError && (
          <Alert type="error" title="No se pudo crear el gimnasio" message={submitError} onClose={() => setSubmitError(null)} />
        )}

        {/* Paso 1: Identidad */}
        {currentStep === 1 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>Paso 1: Identidad y subdominio</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Nombre del gimnasio y dirección web en GymOS. El subdominio no se puede cambiar después.
            </p>

            <FormField label="Nombre del gimnasio" required error={errors.nombre}>
              <TextInput
                value={nombre}
                onChange={(e) => handleNombreChange(e.target.value)}
                placeholder="ej. Power Gym Élite"
                hasError={!!errors.nombre}
                maxLength={150}
                leftElement={<Building2 size={16} />}
              />
            </FormField>

            <FormField
              label="Subdominio (no se puede cambiar después)"
              required
              error={errors.subdominio}
              helperText={
                subdomainCheck && subdomainCheck.subdominio === subdominio
                  ? subdomainCheck.mensaje
                  : 'Se genera desde el nombre. Solo minúsculas, números y guiones (3 a 63 caracteres).'
              }
            >
              <TextInput
                value={subdominio}
                onChange={(e) => {
                  setSubdominioEditado(true);
                  setSubdominio(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
                placeholder="power-gym-elite"
                maxLength={63}
                hasError={!!errors.subdominio || (subdomainCheck && subdomainCheck.subdominio === subdominio ? !subdomainCheck.disponible || !subdomainCheck.valido : false)}
                leftElement={<Globe size={16} />}
                rightElement={
                  isCheckingSubdomain ? (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Validando…</span>
                  ) : subdomainCheck && subdomainCheck.subdominio === subdominio ? (
                    subdomainCheck.disponible && subdomainCheck.valido ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-success)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                        <CheckCircle2 size={15} />
                        <span>Disponible</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-error)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                        <XCircle size={15} />
                        <span>No disponible</span>
                      </div>
                    )
                  ) : null
                }
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <FormField label="NIT" optional helperText="Puede repetirse: un dueño puede tener varias sedes.">
                <TextInput value={nit} onChange={(e) => setNit(e.target.value)} placeholder="ej. 900123456-1" maxLength={50} leftElement={<FileText size={16} />} />
              </FormField>

              <FormField label="Ciudad" optional>
                <TextInput value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="ej. Bogotá" maxLength={100} leftElement={<MapPin size={16} />} />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <FormField label="Teléfono del gimnasio" optional>
                <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="ej. +573001234567" maxLength={50} leftElement={<Phone size={16} />} />
              </FormField>

              <FormField label="Correo del gimnasio" optional error={errors.correo}>
                <TextInput type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="contacto@gimnasio.com" hasError={!!errors.correo} leftElement={<Mail size={16} />} />
              </FormField>
            </div>

            <FormField label="Dirección" optional>
              <TextInput value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="ej. Cra. 15 # 85-30, Chapinero" maxLength={255} leftElement={<MapPin size={16} />} />
            </FormField>
          </div>
        )}

        {/* Paso 2: Imagen pública */}
        {currentStep === 2 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>Paso 2: Imagen pública y redes</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Lo que verán los visitantes en la página pública del gimnasio. Todo es opcional.
            </p>

            <FormField label="URL del logo" optional>
              <TextInput value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
            </FormField>

            <FormField label="URL del banner" optional>
              <TextInput value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://…/banner.jpg" />
            </FormField>

            <FormField label="Descripción" optional error={errors.descripcion} helperText={`${descripcion.length}/300 caracteres`}>
              <TextInput value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={300} hasError={!!errors.descripcion} placeholder="ej. Entrenamiento funcional y fuerza en Chapinero." />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <FormField label="Instagram" optional>
                <TextInput value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@gimnasio" />
              </FormField>
              <FormField label="WhatsApp" optional>
                <TextInput value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+573001234567" />
              </FormField>
              <FormField label="Facebook" optional>
                <TextInput value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="facebook.com/gimnasio" />
              </FormField>
            </div>
          </div>
        )}

        {/* Paso 3: Cuenta del Jefe */}
        {currentStep === 3 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>Paso 3: Cuenta del Jefe</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Se crea la cuenta del dueño con una contraseña temporal que vence en 72 horas.
            </p>

            <FormField label="Nombre completo del Jefe" required error={errors.jefeNombre}>
              <TextInput value={jefeNombre} onChange={(e) => setJefeNombre(e.target.value)} placeholder="ej. Carlos Mendoza" maxLength={150} leftElement={<User size={16} />} hasError={!!errors.jefeNombre} />
            </FormField>

            <FormField label="Correo del Jefe (será su usuario)" required error={errors.jefeCorreo}>
              <TextInput type="email" value={jefeCorreo} onChange={(e) => setJefeCorreo(e.target.value)} placeholder="carlos@gimnasio.com" leftElement={<Mail size={16} />} hasError={!!errors.jefeCorreo} />
            </FormField>

            <FormField label="Celular del Jefe" optional>
              <TextInput value={jefeTelefono} onChange={(e) => setJefeTelefono(e.target.value)} placeholder="+573009876543" maxLength={50} leftElement={<Phone size={16} />} />
            </FormField>
          </div>
        )}

        {/* Paso 4: Suscripción */}
        {currentStep === 4 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>Paso 4: Suscripción</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Una prueba usa el plan de prueba; un cliente activo usa un plan de pago.
            </p>

            <FormField label="Tipo de inicio" required>
              <Select
                value={tipoInicio}
                onChange={(e) => {
                  setTipoInicio(e.target.value as TipoInicio);
                  setErrors({});
                }}
                options={[
                  { value: 'prueba', label: 'Prueba' },
                  { value: 'cliente_activo', label: 'Cliente activo' },
                ]}
              />
            </FormField>

            <FormField label="Plan" required error={errors.plan}>
              {planesCargando ? (
                <Skeleton height="42px" />
              ) : planesError ? (
                <Alert
                  type="error"
                  message={
                    <span>
                      No se pudieron cargar los planes: {planesError}{' '}
                      <Button variant="ghost" size="sm" onClick={cargarPlanes}>
                        Reintentar
                      </Button>
                    </span>
                  }
                  style={{ marginBottom: 0 }}
                />
              ) : planesDelTipo.length === 0 ? (
                <Alert
                  type="warning"
                  message={
                    <span>
                      No hay planes activos de tipo {tipoInicio === 'prueba' ? 'prueba' : 'pago'}.{' '}
                      <Link to="/plans" style={{ color: 'var(--color-action)' }}>
                        Crear o activar un plan
                      </Link>
                    </span>
                  }
                  style={{ marginBottom: 0 }}
                />
              ) : (
                <Select
                  value={planId}
                  onChange={(e) => elegirPlan(e.target.value)}
                  placeholder="Selecciona un plan"
                  hasError={!!errors.plan}
                  options={planesDelTipo.map((p) => ({ value: p.id, label: etiquetaPlan(p) }))}
                />
              )}
            </FormField>

            {planElegido?.descripcion && (
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '-8px', marginBottom: '16px' }}>
                {planElegido.descripcion}
              </p>
            )}

            <FormField
              label="Valor mensual acordado (COP)"
              required
              error={errors.valorMensual}
              helperText={
                planElegido
                  ? `Precio del plan: ${formatCOP(planElegido.precio)}. Puedes acordar otro valor.`
                  : 'Se llena con el precio del plan al elegirlo.'
              }
            >
              <TextInput
                type="number"
                inputMode="numeric"
                value={valorMensual}
                onChange={(e) => setValorMensual(e.target.value)}
                min={0}
                step={1000}
                leftElement={<DollarSign size={16} />}
                hasError={!!errors.valorMensual}
              />
            </FormField>

            {tipoInicio === 'cliente_activo' && (
              <Alert
                type="info"
                message="El gimnasio queda activo sin fecha de corte. Registra el primer pago desde su ficha para fijar la fecha de corte."
              />
            )}
          </div>
        )}

        {/* Paso 5: Resumen (SA-RF-04 CA7) */}
        {currentStep === 5 && (
          <div>
            <h3 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ClipboardList size={20} /> Resumen
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              Revisa los datos antes de crear el gimnasio.
            </p>

            {tituloResumen('Identidad', 1)}
            {filaResumen('Nombre', nombre.trim())}
            {filaResumen('Subdominio', subdominio.trim())}
            {filaResumen('NIT', nit.trim())}
            {filaResumen('Ciudad', ciudad.trim())}
            {filaResumen('Dirección', direccion.trim())}
            {filaResumen('Teléfono', telefono.trim())}
            {filaResumen('Correo', correo.trim())}

            {tituloResumen('Imagen pública', 2)}
            {filaResumen('Logo', logoUrl.trim())}
            {filaResumen('Banner', bannerUrl.trim())}
            {filaResumen('Descripción', descripcion.trim())}
            {filaResumen('Instagram', instagram.trim())}
            {filaResumen('WhatsApp', whatsapp.trim())}
            {filaResumen('Facebook', facebook.trim())}

            {tituloResumen('Cuenta del Jefe', 3)}
            {filaResumen('Nombre', jefeNombre.trim())}
            {filaResumen('Correo (usuario)', jefeCorreo.trim())}
            {filaResumen('Celular', jefeTelefono.trim())}

            {tituloResumen('Suscripción', 4)}
            {filaResumen('Tipo de inicio', tipoInicio === 'prueba' ? 'Prueba' : 'Cliente activo')}
            {filaResumen('Plan', planElegido ? etiquetaPlan(planElegido) : '')}
            {filaResumen('Valor mensual', valorMensual !== '' ? formatCOP(Number(valorMensual)) : '')}
          </div>
        )}

        {/* Controles */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '32px',
            paddingTop: '20px',
            borderTop: '1px solid var(--color-border-subtle)',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="cancel" onClick={salir} disabled={isSubmitting}>
              Salir
            </Button>
            {currentStep > 1 && (
              <Button variant="secondary" onClick={handlePrev} disabled={isSubmitting} leftIcon={<ArrowLeft size={16} />}>
                Anterior
              </Button>
            )}
          </div>

          {currentStep < 4 ? (
            <Button variant="primary" onClick={handleNext} rightIcon={<ArrowRight size={16} />}>
              Siguiente
            </Button>
          ) : currentStep === 4 ? (
            <Button variant="primary" onClick={handleNext} rightIcon={<ArrowRight size={16} />} disabled={planesCargando}>
              Revisar resumen
            </Button>
          ) : (
            <Button variant="primary" onClick={handleSubmit} isLoading={isSubmitting} leftIcon={<Sparkles size={16} />}>
              Crear gimnasio
            </Button>
          )}
        </div>
      </ContentSection>

      <ConfirmationDialog
        isOpen={confirmarSalida}
        onClose={() => setConfirmarSalida(false)}
        onConfirm={() => navigate('/gyms')}
        title="Salir sin guardar"
        message="Hay datos sin guardar en el formulario. Si sales, se pierden."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        isDestructive
      />

      {/* Credenciales mostradas una sola vez (SA-RF-11) */}
      <CredentialsModal
        isOpen={!!issuedCreds}
        credentials={issuedCreds}
        onClose={() => {
          setIssuedCreds(null);
          navigate(createdGymId ? `/gyms/${createdGymId}` : '/gyms', { replace: true });
        }}
      />
    </PageContainer>
  );
};
