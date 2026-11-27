import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { extractApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

interface ProfileEditModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({ visible, onClose }) => {
  const {
    perfil,
    avatarDataUrl,
    actualizarDatosPerfil,
    subirFotoPerfil,
    eliminarFotoPerfil,
  } = useAuth();
  const { colors } = useTheme();

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [sexo, setSexo] = useState<'M' | 'F' | 'otro' | null>(null);
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [alturaCm, setAlturaCm] = useState('');
  const [acudiente, setAcudiente] = useState('');

  const [savingData, setSavingData] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photoBadge, setPhotoBadge] = useState<string | null>(null);

  useEffect(() => {
    if (visible && perfil) {
      setNombre(perfil.nombre || '');
      setTelefono(perfil.telefono || '');
      setSexo((perfil.sexo as 'M' | 'F' | 'otro') || null);
      setFechaNacimiento(perfil.fecha_nacimiento || '');
      setAlturaCm(perfil.altura_cm ? String(perfil.altura_cm) : '');
      setAcudiente(perfil.acudiente_nombre || '');
      setErrorMsg(null);
      setPhotoBadge(null);
    }
  }, [visible, perfil]);

  const formatBirthDate = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };

  const handlePickImage = async (source: 'library' | 'camera') => {
    setErrorMsg(null);
    setPhotoBadge(null);

    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setErrorMsg('Permite el acceso a la cámara en los ajustes de tu teléfono para tomar tu foto.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setErrorMsg('Permite el acceso a tus fotos para elegir una imagen de perfil.');
          return;
        }
      }

      const pickerFn =
        source === 'camera'
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;

      const result = await pickerFn({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      const asset = result.assets?.[0];
      if (result.canceled || !asset?.uri) {
        return;
      }

      setUploadingPhoto(true);
      // Redimensionar y convertir a JPEG liviano en el teléfono (resuelve HEIC / 48MP en galería iOS)
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 400 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );

      if (!manipulated.base64) {
        setErrorMsg('No se pudo procesar la imagen seleccionada. Intenta con otra foto.');
        return;
      }

      const saved = await subirFotoPerfil(manipulated.base64);
      const kb = (saved.bytes_size / 1024).toFixed(1);
      setPhotoBadge(`Foto optimizada y guardada (${kb} KB WebP)`);
    } catch (err: any) {
      setErrorMsg(extractApiError(err, 'No se pudo subir la foto de perfil.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    setErrorMsg(null);
    setPhotoBadge(null);
    setUploadingPhoto(true);
    try {
      await eliminarFotoPerfil();
      setPhotoBadge('Foto eliminada');
    } catch (err: any) {
      setErrorMsg(extractApiError(err, 'No se pudo eliminar la foto.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async () => {
    setErrorMsg(null);
    if (nombre.trim().length < 2) {
      setErrorMsg('Ingresa tu nombre completo.');
      return;
    }

    let parsedAltura: number | null = null;
    if (alturaCm.trim()) {
      const val = Number(alturaCm.replace(',', '.'));
      if (Number.isNaN(val) || val < 80 || val > 250) {
        setErrorMsg('La estatura debe estar entre 80 y 250 cm.');
        return;
      }
      parsedAltura = val;
    }

    let fechaFinal: string | null = null;
    if (fechaNacimiento.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento.trim())) {
        setErrorMsg('Usa el formato AAAA-MM-DD en tu fecha de nacimiento.');
        return;
      }
      fechaFinal = fechaNacimiento.trim();
    }

    setSavingData(true);
    try {
      await actualizarDatosPerfil({
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        sexo,
        fecha_nacimiento: fechaFinal,
        altura_cm: parsedAltura,
        acudiente_nombre: acudiente.trim() || null,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(extractApiError(err, 'No se pudieron actualizar tus datos personales.'));
    } finally {
      setSavingData(false);
    }
  };

  const initial = (perfil?.nombre || 'A').charAt(0).toUpperCase();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Editar mi perfil</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Sección de Foto de Perfil */}
            <View style={[styles.photoSection, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <View style={styles.avatarContainer}>
                {avatarDataUrl ? (
                  <Image source={{ uri: avatarDataUrl }} style={styles.avatarImg} />
                ) : (
                  <View style={[styles.avatarFallback, { backgroundColor: colors.primary }]}>
                    <Text style={styles.avatarInitial}>{initial}</Text>
                  </View>
                )}
                {uploadingPhoto && (
                  <View style={styles.avatarLoadingOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.photoTitle, { color: colors.text }]}>Foto de perfil</Text>
                <Text style={[styles.photoSub, { color: colors.textSecondary }]}>
                  Se comprime automáticamente a formato liviano WebP.
                </Text>

                <View style={styles.photoActionsRow}>
                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handlePickImage('library')}
                    style={[styles.photoBtn, { backgroundColor: colors.primary }]}
                  >
                    <Ionicons name="images-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.photoBtnText}>Galería</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handlePickImage('camera')}
                    style={[styles.photoBtnOutline, { borderColor: colors.borderLight }]}
                  >
                    <Ionicons name="camera-outline" size={14} color={colors.text} />
                    <Text style={[styles.photoBtnOutlineText, { color: colors.text }]}>Cámara</Text>
                  </TouchableOpacity>

                  {avatarDataUrl && (
                    <TouchableOpacity
                      disabled={uploadingPhoto}
                      onPress={handleRemovePhoto}
                      style={styles.removePhotoBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>

                {photoBadge && (
                  <Text style={[styles.photoBadgeText, { color: colors.accent }]}>{photoBadge}</Text>
                )}
              </View>
            </View>

            {errorMsg && (
              <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>{errorMsg}</Text>
              </View>
            )}

            {/* Datos de identificación (solo lectura) */}
            <View style={styles.readonlyRow}>
              <View style={[styles.readonlyChip, { backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[styles.readonlyLabel, { color: colors.textMuted }]}>Documento</Text>
                <Text style={[styles.readonlyVal, { color: colors.textSecondary }]}>
                  {perfil?.documento || '—'}
                </Text>
              </View>
              <View style={[styles.readonlyChip, { flex: 1.5, backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[styles.readonlyLabel, { color: colors.textMuted }]}>Correo</Text>
                <Text style={[styles.readonlyVal, { color: colors.textSecondary }]} numberOfLines={1}>
                  {perfil?.correo || '—'}
                </Text>
              </View>
            </View>

            {/* Campos editables */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Nombre completo *</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Tu nombre completo"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Teléfono celular</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={telefono}
                onChangeText={setTelefono}
                keyboardType="phone-pad"
                placeholder="Ej. 3001234567"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Sexo</Text>
              <View style={styles.sexRow}>
                {(
                  [
                    { key: 'M', label: 'Masculino' },
                    { key: 'F', label: 'Femenino' },
                    { key: 'otro', label: 'Otro' },
                  ] as const
                ).map((opt) => {
                  const active = sexo === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setSexo(opt.key)}
                      style={[
                        styles.sexBtn,
                        {
                          backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.sexBtnText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Nacimiento</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={fechaNacimiento}
                  onChangeText={(t) => setFechaNacimiento(formatBirthDate(t))}
                  keyboardType="number-pad"
                  maxLength={10}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Estatura (cm)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={alturaCm}
                  onChangeText={setAlturaCm}
                  keyboardType="decimal-pad"
                  placeholder="Ej. 172"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>

            <View style={[styles.fieldGroup, { marginTop: 12, marginBottom: 18 }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Contacto de emergencia</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={acudiente}
                onChangeText={setAcudiente}
                placeholder="Nombre de acudiente o familiar"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: savingData ? 0.7 : 1 }]}
              onPress={handleSaveProfile}
              disabled={savingData}
            >
              {savingData ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.saveBtnText}>Guardar cambios</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 19, fontWeight: '800' },
  closeBtn: { padding: 4 },
  photoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    position: 'relative',
  },
  avatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  avatarLoadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoTitle: { fontSize: 14, fontWeight: '700' },
  photoSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  photoActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 8,
  },
  photoBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  photoBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  photoBtnOutlineText: { fontSize: 12, fontWeight: '600' },
  removePhotoBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoBadgeText: { fontSize: 11, fontWeight: '700', marginTop: 6 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  readonlyRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  readonlyChip: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  readonlyLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  readonlyVal: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  fieldGroup: { marginBottom: 12 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  sexRow: { flexDirection: 'row', gap: 8 },
  sexBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sexBtnText: { fontSize: 12, fontWeight: '700' },
  row2: { flexDirection: 'row', gap: 10 },
  saveBtn: {
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
