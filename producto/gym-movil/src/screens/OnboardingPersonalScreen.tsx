import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export const OnboardingPersonalScreen: React.FC = () => {
  const { perfil, confirmarDatosPersonales, isLoading, errorMessage, clearError } = useAuth();
  const { colors, theme } = useTheme();

  const [nombre, setNombre] = useState(perfil?.nombre || '');
  const [telefono, setTelefono] = useState(perfil?.telefono || '');
  const [sexo, setSexo] = useState<'M' | 'F' | 'otro' | null>(
    (perfil?.sexo as 'M' | 'F' | 'otro') || null
  );
  const [fechaNacimiento, setFechaNacimiento] = useState(perfil?.fecha_nacimiento || '');
  const [alturaCm, setAlturaCm] = useState(
    perfil?.altura_cm ? String(perfil.altura_cm) : ''
  );
  const [acudiente, setAcudiente] = useState(perfil?.acudiente_nombre || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const formatBirthDate = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };

  const handleConfirm = async () => {
    setLocalError(null);
    if (errorMessage) clearError();

    if (nombre.trim().length < 2) {
      setLocalError('Ingresa tu nombre completo.');
      return;
    }

    let parsedAltura: number | null = null;
    if (alturaCm.trim()) {
      const val = Number(alturaCm.replace(',', '.'));
      if (Number.isNaN(val) || val < 80 || val > 250) {
        setLocalError('La estatura debe estar entre 80 y 250 cm (ej. 172).');
        return;
      }
      parsedAltura = val;
    }

    let fechaFinal: string | null = null;
    if (fechaNacimiento.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento.trim())) {
        setLocalError('Ingresa la fecha de nacimiento en formato AAAA-MM-DD (ej. 1998-05-20).');
        return;
      }
      fechaFinal = fechaNacimiento.trim();
    }

    await confirmarDatosPersonales({
      nombre: nombre.trim(),
      telefono: telefono.trim() || null,
      sexo,
      fecha_nacimiento: fechaFinal,
      altura_cm: parsedAltura,
      acudiente_nombre: acudiente.trim() || null,
    });
  };

  const activeError = localError || errorMessage;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.stepTag, { color: colors.accent }]}>REGISTRO · PASO 2 DE 3</Text>
            <Text style={[styles.title, { color: colors.text }]}>Confirma tus datos</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Revisa y completa la información registrada por {theme.gym_name}.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {activeError && (
              <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>{activeError}</Text>
              </View>
            )}

            {/* Documento en solo lectura */}
            <View style={[styles.readonlyBadge, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <Ionicons name="id-card-outline" size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.readonlyLabel, { color: colors.textMuted }]}>Documento registrado</Text>
                <Text style={[styles.readonlyValue, { color: colors.text }]}>{perfil?.documento || '—'}</Text>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Nombre completo *</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Tu nombre y apellido"
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
              <View style={styles.sexSelector}>
                {(
                  [
                    { key: 'M', label: 'Masculino' },
                    { key: 'F', label: 'Femenino' },
                    { key: 'otro', label: 'Otro' },
                  ] as const
                ).map((opt) => {
                  const selected = sexo === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setSexo(opt.key)}
                      style={[
                        styles.sexOption,
                        {
                          backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.sexOptionText, { color: selected ? '#FFFFFF' : colors.textSecondary }]}>
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

            <View style={[styles.fieldGroup, { marginTop: 14 }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Contacto de emergencia (opcional)</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={acudiente}
                onChangeText={setAcudiente}
                placeholder="Nombre de acudiente o familiar"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleConfirm}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Confirmar y seguir a medidas</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 22, paddingBottom: 36 },
  header: { marginBottom: 18 },
  stepTag: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  card: { borderRadius: 18, borderWidth: 1, padding: 20 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  readonlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  readonlyLabel: { fontSize: 11, textTransform: 'uppercase', fontWeight: '600' },
  readonlyValue: { fontSize: 14, fontWeight: '700', marginTop: 1 },
  fieldGroup: { marginBottom: 14 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  sexSelector: { flexDirection: 'row', gap: 8 },
  sexOption: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sexOptionText: { fontSize: 13, fontWeight: '700' },
  row2: { flexDirection: 'row', gap: 12 },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
