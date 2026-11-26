import React, { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../contexts/ToastContext';
import { toApiError } from '../../../api/client';
import { portalService, PORTAL_STORAGE, leerSesionPortal } from '../../../api/portal.service';
import type { PerfilDeportistaResponse } from '../../../types/portal.types';

interface ModalEditarPerfilProps {
  isOpen: boolean;
  onClose: () => void;
  perfil: PerfilDeportistaResponse;
  onPerfilActualizado: (nuevo: PerfilDeportistaResponse) => void;
}

export const ModalEditarPerfil: React.FC<ModalEditarPerfilProps> = ({
  isOpen,
  onClose,
  perfil,
  onPerfilActualizado,
}) => {
  const { showToast } = useToast();

  const [formNombre, setFormNombre] = useState('');
  const [formTelefono, setFormTelefono] = useState('');
  const [formSexo, setFormSexo] = useState<'M' | 'F' | 'otro'>('M');
  const [formAltura, setFormAltura] = useState('');
  const [formFechaNac, setFormFechaNac] = useState('');
  const [formAcudiente, setFormAcudiente] = useState('');

  const [errorNombre, setErrorNombre] = useState<string | undefined>(undefined);
  const [errorTelefono, setErrorTelefono] = useState<string | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (isOpen && perfil) {
      setFormNombre(perfil.nombre || '');
      setFormTelefono(perfil.telefono || '');
      setFormSexo((perfil.sexo as 'M' | 'F' | 'otro') || 'M');
      setFormAltura(perfil.altura_cm ? String(perfil.altura_cm) : '');
      setFormFechaNac(perfil.fecha_nacimiento || '');
      setFormAcudiente(perfil.acudiente_nombre || '');
      setErrorNombre(undefined);
      setErrorTelefono(undefined);
    }
  }, [isOpen, perfil]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombreLimpio = formNombre.trim().replace(/\s+/g, ' ');
    if (nombreLimpio.length < 2 || !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]{2,}/.test(nombreLimpio)) {
      setErrorNombre('Ingresa un nombre válido de al menos 2 letras.');
      return;
    }
    const telLimpio = formTelefono.trim();
    if (telLimpio) {
      const digitos = telLimpio.replace(/\D/g, '');
      if (digitos.length < 7 || digitos.length > 15) {
        setErrorTelefono('Ingresa un teléfono válido de entre 7 y 15 dígitos.');
        return;
      }
    }

    setGuardando(true);
    try {
      const actualizado = await portalService.actualizarPerfil({
        nombre: nombreLimpio,
        telefono: telLimpio || null,
        sexo: formSexo,
        altura_cm: formAltura ? Number(formAltura) : null,
        fecha_nacimiento: formFechaNac || null,
        acudiente_nombre: formAcudiente.trim() || null,
      });

      // Actualizar localStorage si coincide
      const userActual = leerSesionPortal();
      if (userActual) {
        const nuevoUser = { ...userActual, nombre: actualizado.nombre, telefono: actualizado.telefono };
        localStorage.setItem(PORTAL_STORAGE.user, JSON.stringify(nuevoUser));
      }

      onPerfilActualizado(actualizado);
      onClose();
      showToast('success', 'Tus datos personales han sido actualizados');
    } catch (err) {
      showToast('error', toApiError(err).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Editar mis datos personales"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <div style={{ gridColumn: '1 / -1' }}>
          <Input
            label="Nombre Completo *"
            placeholder="Ej. Juan Esteban Cuadros"
            value={formNombre}
            onChange={(e) => {
              setFormNombre(e.target.value);
              if (errorNombre) setErrorNombre(undefined);
            }}
            error={errorNombre}
            autoFocus
          />
        </div>

        <div>
          <Input
            label="Teléfono / Celular"
            placeholder="Ej. 300 123 4567"
            value={formTelefono}
            onChange={(e) => {
              setFormTelefono(e.target.value);
              if (errorTelefono) setErrorTelefono(undefined);
            }}
            error={errorTelefono}
          />
        </div>

        <div>
          <Select
            label="Género"
            value={formSexo}
            onChange={(e) => setFormSexo(e.target.value as 'M' | 'F' | 'otro')}
            options={[
              { value: 'M', label: 'Masculino' },
              { value: 'F', label: 'Femenino' },
              { value: 'otro', label: 'Otro' },
            ]}
          />
        </div>

        <div>
          <Input
            label="Estatura (cm)"
            type="number"
            min={80}
            max={250}
            step="0.5"
            placeholder="Ej. 172"
            value={formAltura}
            onChange={(e) => setFormAltura(e.target.value)}
          />
        </div>

        <div>
          <Input
            label="Fecha de Nacimiento"
            type="date"
            value={formFechaNac}
            onChange={(e) => setFormFechaNac(e.target.value)}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <Input
            label="Contacto de Emergencia / Acudiente"
            placeholder="Nombre y teléfono de contacto"
            value={formAcudiente}
            onChange={(e) => setFormAcudiente(e.target.value)}
          />
        </div>

        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
          }}
        >
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" isLoading={guardando}>
            Guardar Cambios
          </Button>
        </div>
      </form>
    </Modal>
  );
};

