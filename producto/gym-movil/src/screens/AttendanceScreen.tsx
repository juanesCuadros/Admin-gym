import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  AsistenciaPortalItem,
  AsistenciasPortalResponse,
  authApi,
  extractApiError,
} from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { BottomTabBar, MainTabKey } from '../components/BottomTabBar';

interface AttendanceScreenProps {
  onSelectTab: (tab: MainTabKey) => void;
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const getLocalTodayIso = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const AttendanceScreen: React.FC<AttendanceScreenProps> = ({ onSelectTab }) => {
  const { colors } = useTheme();

  const todayIso = useMemo(() => getLocalTodayIso(), []);
  const [viewYear, setViewYear] = useState<number>(() => Number(todayIso.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState<number>(() => Number(todayIso.slice(5, 7))); // 1..12
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [data, setData] = useState<AsistenciasPortalResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cargarAsistencias = useCallback(async () => {
    setError(null);
    try {
      const res = await authApi.obtenerAsistencias();
      setData(res);
    } catch (err: any) {
      setError(extractApiError(err, 'No se pudo cargar tu calendario de asistencias.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarAsistencias();
  }, [cargarAsistencias]);

  // Conjunto de días con ingreso válido (resultado 'abrio' o 'alerta_mora', más dias_asistidos_mes)
  const { attendedMap, attendedDatesSet } = useMemo(() => {
    const map = new Map<string, AsistenciaPortalItem[]>();
    const set = new Set<string>();

    if (data?.historial) {
      for (const item of data.historial) {
        if (item.resultado === 'abrio' || item.resultado === 'alerta_mora') {
          set.add(item.fecha_local);
          const prev = map.get(item.fecha_local) || [];
          prev.push(item);
          map.set(item.fecha_local, prev);
        }
      }
    }
    if (data?.dias_asistidos_mes && (!data.historial || data.historial.length === 0)) {
      for (const d of data.dias_asistidos_mes) {
        set.add(d);
      }
    }
    return { attendedMap: map, attendedDatesSet: set };
  }, [data]);

  // Construcción de celdas del mes visible (Lunes = col 0 .. Domingo = col 6)
  const calendarCells = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const firstDayJs = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=Dom .. 6=Sáb
    const offsetMonday = (firstDayJs + 6) % 7;

    const cells: Array<
      | { type: 'empty'; key: string }
      | {
          type: 'day';
          key: string;
          day: number;
          iso: string;
          attended: boolean;
          isToday: boolean;
          isFuture: boolean;
        }
    > = [];

    for (let i = 0; i < offsetMonday; i++) {
      cells.push({ type: 'empty', key: `empty-start-${i}` });
    }

    const monthStr = String(viewMonth).padStart(2, '0');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${monthStr}-${String(d).padStart(2, '0')}`;
      cells.push({
        type: 'day',
        key: iso,
        day: d,
        iso,
        attended: attendedDatesSet.has(iso),
        isToday: iso === todayIso,
        isFuture: iso > todayIso,
      });
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
      const padEnd = 7 - remainder;
      for (let i = 0; i < padEnd; i++) {
        cells.push({ type: 'empty', key: `empty-end-${i}` });
      }
    }

    return cells;
  }, [viewYear, viewMonth, attendedDatesSet, todayIso]);

  const rows = useMemo(() => {
    const r: Array<typeof calendarCells> = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      r.push(calendarCells.slice(i, i + 7));
    }
    return r;
  }, [calendarCells]);

  const monthAttendedCount = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}-`;
    let count = 0;
    attendedDatesSet.forEach((d) => {
      if (d.startsWith(prefix)) count += 1;
    });
    return count;
  }, [attendedDatesSet, viewYear, viewMonth]);

  const goPrevMonth = () => {
    setSelectedDate(null);
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    const currY = Number(todayIso.slice(0, 4));
    const currM = Number(todayIso.slice(5, 7));
    if (viewYear > currY || (viewYear === currY && viewMonth >= currM)) return;
    setSelectedDate(null);
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const isCurrentOrFutureMonth =
    viewYear > Number(todayIso.slice(0, 4)) ||
    (viewYear === Number(todayIso.slice(0, 4)) && viewMonth >= Number(todayIso.slice(5, 7)));

  const selectedDayLogs = selectedDate ? attendedMap.get(selectedDate) || [] : [];

  const validHistory = useMemo(
    () =>
      (data?.historial || []).filter(
        (h) => h.resultado === 'abrio' || h.resultado === 'alerta_mora'
      ),
    [data]
  );

  const formatMetodo = (m: string) => {
    if (m === 'huella') return 'Huella dactilar';
    if (m === 'documento' || m === 'manual') return 'Recepción';
    return m;
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.headerKicker, { color: colors.accent }]}>CONSTANCIA</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Mis Asistencias</Text>
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
            {/* Resumen superior */}
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Este mes</Text>
                <Text style={[styles.kpiValue, { color: colors.primary }]}>
                  {data?.asistencias_mes_actual ?? 0}{' '}
                  <Text style={styles.kpiUnit}>
                    {data?.asistencias_mes_actual === 1 ? 'día' : 'días'}
                  </Text>
                </Text>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Total histórico</Text>
                <Text style={[styles.kpiValue, { color: colors.accent }]}>
                  {data?.asistencias_totales ?? 0}{' '}
                  <Text style={styles.kpiUnit}>visitas</Text>
                </Text>
              </View>
            </View>

            {/* Calendario Mensual con marca de asistencia */}
            <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {/* Selector de mes */}
              <View style={styles.monthHeader}>
                <TouchableOpacity
                  onPress={goPrevMonth}
                  style={[styles.monthNavBtn, { backgroundColor: colors.surfaceSubtle }]}
                >
                  <Ionicons name="chevron-back" size={18} color={colors.text} />
                </TouchableOpacity>

                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.monthTitle, { color: colors.text }]}>
                    {MONTH_NAMES[viewMonth - 1]} {viewYear}
                  </Text>
                  <Text style={[styles.monthSub, { color: colors.textSecondary }]}>
                    {monthAttendedCount}{' '}
                    {monthAttendedCount === 1 ? 'día asistido' : 'días asistidos'}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={goNextMonth}
                  disabled={isCurrentOrFutureMonth}
                  style={[
                    styles.monthNavBtn,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      opacity: isCurrentOrFutureMonth ? 0.35 : 1,
                    },
                  ]}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Cabecera L M M J V S D */}
              <View style={styles.weekdaysRow}>
                {WEEKDAYS.map((wd, idx) => (
                  <View key={idx} style={styles.weekdayCell}>
                    <Text style={[styles.weekdayText, { color: colors.textMuted }]}>{wd}</Text>
                  </View>
                ))}
              </View>

              {/* Filas de días */}
              {rows.map((row, rIdx) => (
                <View key={`row-${rIdx}`} style={styles.weekRow}>
                  {row.map((cell) => {
                    if (cell.type === 'empty') {
                      return <View key={cell.key} style={styles.dayCell} />;
                    }

                    const isSelected = selectedDate === cell.iso;

                    return (
                      <TouchableOpacity
                        key={cell.key}
                        activeOpacity={0.75}
                        disabled={cell.isFuture}
                        onPress={() =>
                          setSelectedDate((prev) => (prev === cell.iso ? null : cell.iso))
                        }
                        style={[
                          styles.dayCell,
                          cell.attended && {
                            backgroundColor: `${colors.primary}22`,
                            borderColor: `${colors.primary}66`,
                            borderWidth: 1,
                          },
                          cell.isToday &&
                            !cell.attended && {
                              borderColor: colors.borderLight,
                              borderWidth: 1,
                            },
                          isSelected && {
                            borderColor: colors.accent,
                            borderWidth: 1.5,
                          },
                          cell.isFuture && { opacity: 0.3 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            {
                              color: cell.attended
                                ? colors.text
                                : cell.isToday
                                ? colors.primary
                                : colors.textSecondary,
                              fontWeight: cell.attended || cell.isToday ? '800' : '500',
                            },
                          ]}
                        >
                          {cell.day}
                        </Text>

                        {/* Pequeña marca indicando que asistió al gimnasio */}
                        <View style={styles.markSlot}>
                          {cell.attended ? (
                            <View style={[styles.attendedDot, { backgroundColor: colors.accent }]} />
                          ) : cell.isToday ? (
                            <View style={[styles.todayDot, { borderColor: colors.primary }]} />
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              {/* Leyenda */}
              <View style={[styles.legendRow, { borderTopColor: colors.border }]}>
                <View style={styles.legendItem}>
                  <View style={[styles.attendedDot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                    Asistió al gimnasio
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.todayDot, { borderColor: colors.primary }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>Hoy</Text>
                </View>
              </View>

              {/* Detalle al tocar un día */}
              {selectedDate && (
                <View style={[styles.dayDetailBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Ionicons
                    name={selectedDayLogs.length > 0 ? 'checkmark-circle' : 'calendar-clear-outline'}
                    size={18}
                    color={selectedDayLogs.length > 0 ? colors.accent : colors.textMuted}
                  />
                  <Text style={[styles.dayDetailText, { color: colors.text }]}>
                    {selectedDayLogs.length > 0
                      ? `${selectedDate} · Ingreso registrado a las ${selectedDayLogs[0].hora_local} (${formatMetodo(selectedDayLogs[0].metodo)})`
                      : `${selectedDate} · Sin registro de asistencia este día`}
                  </Text>
                </View>
              )}
            </View>

            {/* Últimos ingresos */}
            <Text style={[styles.sectionHeading, { color: colors.text }]}>Ingresos recientes</Text>
            {validHistory.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="footsteps-outline" size={26} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  Aún no hay ingresos registrados
                </Text>
                <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                  Cada vez que ingreses a tu gimnasio, el día quedará marcado automáticamente en tu calendario.
                </Text>
              </View>
            ) : (
              validHistory.slice(0, 15).map((item) => (
                <View
                  key={item.id}
                  style={[styles.logItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.logIcon, { backgroundColor: `${colors.accent}20` }]}>
                    <Ionicons name="checkmark" size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.logDate, { color: colors.text }]}>{item.fecha_local}</Text>
                    <Text style={[styles.logMeta, { color: colors.textSecondary }]}>
                      Vía {formatMetodo(item.metodo)}
                    </Text>
                  </View>
                  <Text style={[styles.logTime, { color: colors.accent }]}>{item.hora_local}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      <BottomTabBar activeTab="asistencias" onSelectTab={onSelectTab} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 28 },
  header: { marginBottom: 18 },
  headerKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  headerTitle: { fontSize: 23, fontWeight: '800', marginTop: 2 },
  centerBox: { paddingVertical: 60, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  kpiLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  kpiUnit: { fontSize: 13, fontWeight: '600' },
  calendarCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 22,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthTitle: { fontSize: 16, fontWeight: '800' },
  monthSub: { fontSize: 12, marginTop: 2 },
  weekdaysRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayText: { fontSize: 11, fontWeight: '700' },
  weekRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 5,
  },
  dayCell: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumber: { fontSize: 13 },
  markSlot: {
    height: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  attendedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 10,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12 },
  dayDetailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
  },
  dayDetailText: { fontSize: 12, flex: 1, fontWeight: '500' },
  sectionHeading: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptySub: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  logIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logDate: { fontSize: 14, fontWeight: '700' },
  logMeta: { fontSize: 12, marginTop: 1 },
  logTime: { fontSize: 13, fontWeight: '800' },
});

