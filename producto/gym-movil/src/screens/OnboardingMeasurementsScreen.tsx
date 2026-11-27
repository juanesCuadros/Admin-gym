import React, { useMemo, useState } from 'react';
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

export const OnboardingMeasurementsScreen: React.FC = () => {
  const { perfil, guardarMedidasIniciales, omitirMedidas, isLoading, errorMessage, clearError } = useAuth();
  const { colors } = useTheme();

  const [peso, setPeso] = useState(perfil?.ultimo_peso_kg ? String(perfil.ultimo_peso_kg) : '');
  const [alturaCm, setAlturaCm] = useState(perfil?.altura_cm ? String(perfil.altura_cm) : '');
  const [cintura, setCintura] = useState('');
  const [cadera, setCadera] = useState('');
  const [pecho, setPecho] = useState('');
  const [brazo, setBrazo] = useState('');
  const [pierna, setPierna] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const toNumber = (val: string): number | undefined => {
    const clean = val.trim().replace(',', '.');
    if (!clean) return undefined;
    const n = Number(clean);
    return Number.isNaN(n) ? undefined : n;
  };

  const imcCalculado = useMemo(() => {
    const p = toNumber(peso);
    const a = toNumber(alturaCm);
    if (!p || !a || p <= 0 || a < 80) return null;
    const m = a / 100;
    return (p / (m * m)).toFixed(1);
  }, [peso, alturaCm]);

  const handleSave = async () => {
    setLocalError(null);
    if (errorMessage) clearError();

    const pesoNum = toNumber(peso);
    if (!pesoNum || pesoNum < 20 || pesoNum > 350) {
      setLocalError('Ingresa un peso válido entre 20 y 350 kg (ej. 70.5).');
      return;
    }

    const alturaNum = toNumber(alturaCm);
    if (alturaNum !== undefined && (alturaNum < 80 || alturaNum > 250)) {
      setLocalError('La estatura debe estar entre 80 y 250 cm.');
      return;
    }

    const sexoValido = perfil?.sexo === 'M' || perfil?.sexo === 'F' ? perfil.sexo : undefined;

    await guardarMedidasIniciales({
      peso: pesoNum,
      altura_cm: alturaNum,
      sexo: sexoValido,
      cintura: toNumber(cintura),
      cadera: toNumber(cadera),
      pecho: toNumber(pecho),
      brazo: toNumber(brazo),
      pierna: toNumber(pierna),
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
            <Text style={[styles.stepTag, { color: colors.accent }]}>REGISTRO · PASO 3 DE 3</Text>
            <Text style={[styles.title, { color: colors.text }]}>Tus medidas iniciales</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Registra tu punto de partida para seguir tu evolución física en el gimnasio.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {activeError && (
              <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>{activeError}</Text>
              </View>
            )}

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Peso actual (kg) *</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.primary, backgroundColor: colors.surfaceSubtle }]}
                  value={peso}
                  onChangeText={setPeso}
                  keyboardType="decimal-pad"
                  placeholder="Ej. 72.5"
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

            {imcCalculado && (
              <View style={[styles.imcBanner, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Ionicons name="analytics-outline" size={18} color={colors.accent} />
                <Text style={[styles.imcText, { color: colors.textSecondary }]}>
                  IMC estimado inicial:{' '}
                  <Text style={{ color: colors.accent, fontWeight: '800' }}>{imcCalculado}</Text>
                </Text>
              </View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Perímetros corporales en cm (opcionales)
            </Text>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Cintura</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={cintura}
                  onChangeText={setCintura}
                  keyboardType="decimal-pad"
                  placeholder="cm"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Cadera</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={cadera}
                  onChangeText={setCadera}
                  keyboardType="decimal-pad"
                  placeholder="cm"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>

            <View style={[styles.row2, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Pecho</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={pecho}
                  onChangeText={setPecho}
                  keyboardType="decimal-pad"
                  placeholder="cm"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Brazo</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                  value={brazo}
                  onChangeText={setBrazo}
                  keyboardType="decimal-pad"
                  placeholder="cm"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>

            <View style={{ marginTop: 12, marginBottom: 18 }}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Pierna</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                value={pierna}
                onChangeText={setPierna}
                keyboardType="decimal-pad"
                placeholder="cm"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: isLoading || !peso.trim() ? 0.65 : 1 },
              ]}
              onPress={handleSave}
              disabled={isLoading || !peso.trim()}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>Guardar medidas y finalizar</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={omitirMedidas} disabled={isLoading} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: colors.textSecondary }]}>
                Registrar medidas más tarde e ir al inicio
              </Text>
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
  row2: { flexDirection: 'row', gap: 12 },
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
  imcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
  },
  imcText: { fontSize: 13 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  skipBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 6 },
  skipText: { fontSize: 13, fontWeight: '600' },
});
