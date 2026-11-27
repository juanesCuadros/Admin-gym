import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  authApi,
  extractApiError,
  MedicionesPortalResponse,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { BottomTabBar, MainTabKey } from '../components/BottomTabBar';
import { calcularMusculoPct, ProgressChart } from '../components/ProgressChart';

interface MeasurementsScreenProps {
  onSelectTab: (tab: MainTabKey) => void;
}

export const MeasurementsScreen: React.FC<MeasurementsScreenProps> = ({ onSelectTab }) => {
  const { perfil, recargarPerfil } = useAuth();
  const { colors } = useTheme();

  const [data, setData] = useState<MedicionesPortalResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de nueva medición
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [peso, setPeso] = useState('');
  const [alturaCm, setAlturaCm] = useState('');
  const [sexo, setSexo] = useState<'M' | 'F'>('M');
  const [cintura, setCintura] = useState('');
  const [cadera, setCadera] = useState('');
  const [pecho, setPecho] = useState('');
  const [brazo, setBrazo] = useState('');
  const [pierna, setPierna] = useState('');

  const cargarMediciones = useCallback(async () => {
    setError(null);
    try {
      const res = await authApi.obtenerMediciones();
      setData(res);
    } catch (err: any) {
      setError(extractApiError(err, 'No se pudo cargar tu progreso corporal.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarMediciones();
  }, [cargarMediciones]);

  const abrirModal = () => {
    const altInicial = data?.resumen?.altura_cm ?? perfil?.altura_cm;
    const sexoInicial = data?.resumen?.sexo ?? perfil?.sexo;
    setPeso('');
    setAlturaCm(altInicial ? String(altInicial) : '');
    setSexo(sexoInicial === 'F' ? 'F' : 'M');
    setCintura('');
    setCadera('');
    setPecho('');
    setBrazo('');
    setPierna('');
    setModalError(null);
    setModalOpen(true);
  };

  const toNumber = (val: string): number | undefined => {
    const clean = val.trim().replace(',', '.');
    if (!clean) return undefined;
    const n = Number(clean);
    return Number.isNaN(n) ? undefined : n;
  };

  const handleGuardarMedida = async () => {
    setModalError(null);
    const pesoNum = toNumber(peso);
    if (!pesoNum || pesoNum < 20 || pesoNum > 350) {
      setModalError('Ingresa un peso válido entre 20 y 350 kg.');
      return;
    }

    const alturaNum = toNumber(alturaCm);
    if (!alturaNum || alturaNum < 80 || alturaNum > 250) {
      setModalError('Ingresa tu estatura entre 80 y 250 cm para calcular IMC, % grasa y % músculo.');
      return;
    }

    setSaving(true);
    try {
      await authApi.registrarMedicion({
        peso: pesoNum,
        altura_cm: alturaNum,
        sexo,
        cintura: toNumber(cintura),
        cadera: toNumber(cadera),
        pecho: toNumber(pecho),
        brazo: toNumber(brazo),
        pierna: toNumber(pierna),
      });
      setModalOpen(false);
      await Promise.all([cargarMediciones(), recargarPerfil()]);
    } catch (err: any) {
      setModalError(extractApiError(err, 'No se pudo guardar la medición. Verifica los datos.'));
    } finally {
      setSaving(false);
    }
  };

  const historial = data?.historial || [];
  const ultima = historial[0] || null;
  const imcActual = ultima?.imc != null ? Number(ultima.imc).toFixed(1) : '—';
  const grasaActual = ultima?.grasa_pct != null ? `${Number(ultima.grasa_pct).toFixed(1)}%` : '—';
  const musculoPctVal = ultima ? calcularMusculoPct(ultima) : null;
  const musculoActual = musculoPctVal !== null ? `${musculoPctVal.toFixed(1)}%` : '—';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Encabezado + Acción de Registrar */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={[styles.headerKicker, { color: colors.accent }]}>MI EVOLUCIÓN</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Mediciones y Progreso</Text>
          </View>

          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={abrirModal}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.addBtnText}>Nueva medida</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : error ? (
          <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        ) : (
          <>
            {/* Resumen actual de las 3 métricas clave */}
            <View style={styles.metricsSummaryRow}>
              <View style={[styles.metricMiniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.metricMiniLabel, { color: colors.textSecondary }]}>IMC</Text>
                <Text style={[styles.metricMiniVal, { color: colors.text }]}>{imcActual}</Text>
              </View>

              <View style={[styles.metricMiniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.metricMiniLabel, { color: colors.textSecondary }]}>% Grasa</Text>
                <Text style={[styles.metricMiniVal, { color: colors.primary }]}>{grasaActual}</Text>
              </View>

              <View style={[styles.metricMiniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.metricMiniLabel, { color: colors.textSecondary }]}>% Músculo</Text>
                <Text style={[styles.metricMiniVal, { color: colors.accent }]}>{musculoActual}</Text>
              </View>
            </View>

            {/* Gráfico interactivo de progreso (IMC | % Grasa | % Músculo) */}
            <ProgressChart historial={historial} />

            {/* Historial de tomas */}
            <View style={styles.historyHeader}>
              <Text style={[styles.sectionHeading, { color: colors.text }]}>Historial de mediciones</Text>
              <Text style={[styles.countLabel, { color: colors.textMuted }]}>
                {historial.length} {historial.length === 1 ? 'registro' : 'registros'}
              </Text>
            </View>

            {historial.length === 0 ? (
              <View style={[styles.emptyHistoryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="scale-outline" size={30} color={colors.textMuted} />
                <Text style={[styles.emptyHistoryTitle, { color: colors.text }]}>
                  Aún no tienes mediciones
                </Text>
                <Text style={[styles.emptyHistorySub, { color: colors.textSecondary }]}>
                  Toca «Nueva medida» arriba para registrar tu peso y empezar a ver tus gráficas de IMC, % grasa y % músculo.
                </Text>
              </View>
            ) : (
              historial.map((item) => {
                const mPct = calcularMusculoPct(item);
                const perimetros = [
                  item.cintura != null ? `Cintura ${Number(item.cintura).toFixed(0)} cm` : null,
                  item.pecho != null ? `Pecho ${Number(item.pecho).toFixed(0)} cm` : null,
                  item.brazo != null ? `Brazo ${Number(item.brazo).toFixed(0)} cm` : null,
                  item.pierna != null ? `Pierna ${Number(item.pierna).toFixed(0)} cm` : null,
                ].filter(Boolean);

                return (
                  <View
                    key={item.id}
                    style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <View style={styles.historyCardTop}>
                      <View style={styles.historyDateRow}>
                        <Ionicons name="calendar-outline" size={15} color={colors.accent} />
                        <Text style={[styles.historyDate, { color: colors.text }]}>{item.fecha}</Text>
                      </View>
                      <View style={[styles.originBadge, { backgroundColor: colors.surfaceSubtle }]}>
                        <Text style={[styles.originText, { color: colors.textSecondary }]}>
                          {item.origen === 'staff' ? 'Tomada en sede' : 'Registrada por ti'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.historyMetricsGrid}>
                      <View style={styles.historyMetricCol}>
                        <Text style={[styles.hmLabel, { color: colors.textMuted }]}>Peso</Text>
                        <Text style={[styles.hmValue, { color: colors.text }]}>
                          {item.peso != null ? `${Number(item.peso).toFixed(1)} kg` : '—'}
                        </Text>
                      </View>
                      <View style={styles.historyMetricCol}>
                        <Text style={[styles.hmLabel, { color: colors.textMuted }]}>IMC</Text>
                        <Text style={[styles.hmValue, { color: colors.text }]}>
                          {item.imc != null ? Number(item.imc).toFixed(1) : '—'}
                        </Text>
                      </View>
                      <View style={styles.historyMetricCol}>
                        <Text style={[styles.hmLabel, { color: colors.textMuted }]}>% Grasa</Text>
                        <Text style={[styles.hmValue, { color: colors.primary }]}>
                          {item.grasa_pct != null ? `${Number(item.grasa_pct).toFixed(1)}%` : '—'}
                        </Text>
                      </View>
                      <View style={styles.historyMetricCol}>
                        <Text style={[styles.hmLabel, { color: colors.textMuted }]}>% Músculo</Text>
                        <Text style={[styles.hmValue, { color: colors.accent }]}>
                          {mPct !== null ? `${mPct.toFixed(1)}%` : '—'}
                        </Text>
                      </View>
                    </View>

                    {perimetros.length > 0 && (
                      <Text style={[styles.perimetrosLine, { color: colors.textSecondary }]}>
                        {perimetros.join(' · ')}
                      </Text>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* Barra de navegación inferior */}
      <BottomTabBar activeTab="mediciones" onSelectTab={onSelectTab} />

      {/* Modal para registrar nueva medición */}
      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Registrar nueva medición</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {modalError && (
                <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)', marginBottom: 12 }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{modalError}</Text>
                </View>
              )}

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Peso (kg) *</Text>
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.primary, backgroundColor: colors.surfaceSubtle }]}
                    value={peso}
                    onChangeText={setPeso}
                    keyboardType="decimal-pad"
                    placeholder="Ej. 73.2"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Estatura (cm) *</Text>
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

              <View style={{ marginTop: 12 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Sexo biológico (para cálculo de % grasa y % músculo)
                </Text>
                <View style={styles.row2}>
                  {(
                    [
                      { key: 'M', label: 'Masculino' },
                      { key: 'F', label: 'Femenino' },
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

              <Text style={[styles.subHeading, { color: colors.textSecondary }]}>
                Perímetros opcionales en cm (mejoran precisión de % grasa)
              </Text>

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Cintura</Text>
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
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Cadera</Text>
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

              <View style={[styles.row2, { marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Pecho</Text>
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
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Brazo</Text>
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

              <View style={{ marginTop: 10, marginBottom: 18 }}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Pierna</Text>
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
                  styles.saveButton,
                  { backgroundColor: colors.primary, opacity: saving || !peso.trim() ? 0.65 : 1 },
                ]}
                onPress={handleGuardarMedida}
                disabled={saving || !peso.trim()}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.saveButtonText}>Guardar medición</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 28 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  headerKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  headerTitle: { fontSize: 23, fontWeight: '800', marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 12,
    gap: 5,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  centerBox: { paddingVertical: 60, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  metricsSummaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  metricMiniCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  metricMiniLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  metricMiniVal: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: { fontSize: 16, fontWeight: '700' },
  countLabel: { fontSize: 12, fontWeight: '600' },
  emptyHistoryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyHistoryTitle: { fontSize: 15, fontWeight: '700' },
  emptyHistorySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  historyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  historyDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyDate: { fontSize: 14, fontWeight: '700' },
  originBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  originText: { fontSize: 11, fontWeight: '600' },
  historyMetricsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  historyMetricCol: { flex: 1 },
  hmLabel: { fontSize: 11, fontWeight: '600' },
  hmValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  perimetrosLine: {
    fontSize: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    padding: 22,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  closeBtn: { padding: 4 },
  row2: { flexDirection: 'row', gap: 10 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  sexBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sexBtnText: { fontSize: 13, fontWeight: '700' },
  subHeading: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  saveButton: {
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
