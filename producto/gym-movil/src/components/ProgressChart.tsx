import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Line,
  Circle,
  Text as SvgText,
  Rect,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { MedicionPortalItem } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

export type ChartMetricKey = 'imc' | 'grasa_pct' | 'musculo_pct';

interface MetricConfig {
  key: ChartMetricKey;
  label: string;
  unit: string;
  emptyHint: string;
}

const METRICS: MetricConfig[] = [
  {
    key: 'imc',
    label: 'IMC',
    unit: '',
    emptyHint: 'Requiere peso y estatura registrada para calcular el IMC.',
  },
  {
    key: 'grasa_pct',
    label: '% Grasa',
    unit: '%',
    emptyHint: 'Requiere peso, estatura y sexo (M/F) para estimar el % de grasa.',
  },
  {
    key: 'musculo_pct',
    label: '% Músculo',
    unit: '%',
    emptyHint: 'Requiere peso, estatura y sexo (M/F) para estimar el % de músculo.',
  },
];

export const calcularMusculoPct = (item: MedicionPortalItem): number | null => {
  if (
    item.masa_muscular === null ||
    item.masa_muscular === undefined ||
    item.peso === null ||
    item.peso === undefined
  ) {
    return null;
  }
  const muscKg = Number(item.masa_muscular);
  const pesoKg = Number(item.peso);
  if (!Number.isFinite(muscKg) || !Number.isFinite(pesoKg) || pesoKg <= 0) {
    return null;
  }
  return Number(((muscKg / pesoKg) * 100).toFixed(1));
};

const formatShortDate = (isoDate: string): string => {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mIdx = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
  return `${parts[2]} ${months[mIdx]}`;
};

const clasificarImc = (imc: number): { label: string; color: string } => {
  if (imc < 18.5) return { label: 'Bajo peso', color: '#38BDF8' };
  if (imc < 25) return { label: 'Normal', color: '#10B981' };
  if (imc < 30) return { label: 'Sobrepeso', color: '#F59E0B' };
  return { label: 'Obesidad', color: '#EF4444' };
};

interface ProgressChartProps {
  historial: MedicionPortalItem[];
}

export const ProgressChart: React.FC<ProgressChartProps> = ({ historial }) => {
  const { colors } = useTheme();
  const [selectedMetric, setSelectedMetric] = useState<ChartMetricKey>('imc');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(300);

  const activeConfig = METRICS.find((m) => m.key === selectedMetric) || METRICS[0];

  const points = useMemo(() => {
    const ordered = [...historial].reverse();
    return ordered
      .map((item) => {
        let rawVal: number | null = null;
        if (selectedMetric === 'imc') {
          rawVal = item.imc !== null && item.imc !== undefined ? Number(item.imc) : null;
        } else if (selectedMetric === 'grasa_pct') {
          rawVal = item.grasa_pct !== null && item.grasa_pct !== undefined ? Number(item.grasa_pct) : null;
        } else {
          rawVal = calcularMusculoPct(item);
        }
        if (rawVal === null || !Number.isFinite(rawVal)) return null;
        return {
          id: item.id,
          fecha: item.fecha,
          shortDate: formatShortDate(item.fecha),
          value: Number(rawVal.toFixed(1)),
        };
      })
      .filter((p): p is { id: string; fecha: string; shortDate: string; value: number } => p !== null);
  }, [historial, selectedMetric]);

  const effectiveIdx =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < points.length
      ? selectedIdx
      : points.length - 1;

  const activePoint = effectiveIdx >= 0 ? points[effectiveIdx] : null;
  const firstPoint = points.length > 0 ? points[0] : null;
  const deltaFromStart =
    activePoint && firstPoint && points.length > 1
      ? Number((activePoint.value - firstPoint.value).toFixed(1))
      : null;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 100) setChartWidth(w);
  };

  const chartHeight = 185;
  const padLeft = 38;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 30;
  const plotW = Math.max(60, chartWidth - padLeft - padRight);
  const plotH = chartHeight - padTop - padBottom;

  const { minVal, maxVal, coords, linePath, areaPath } = useMemo(() => {
    if (points.length === 0) {
      return { minVal: 0, maxVal: 0, coords: [], linePath: '', areaPath: '' };
    }
    const vals = points.map((p) => p.value);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const spread = rawMax - rawMin;
    const pad = spread < 1 ? 2 : spread * 0.22;
    const cMin = Math.max(0, Number((rawMin - pad).toFixed(1)));
    const cMax = Number((rawMax + pad).toFixed(1));
    const range = Math.max(0.1, cMax - cMin);

    const mapped = points.map((p, idx) => {
      const x =
        points.length === 1
          ? padLeft + plotW / 2
          : padLeft + (idx / (points.length - 1)) * plotW;
      const y = padTop + plotH - ((p.value - cMin) / range) * plotH;
      return { ...p, x, y, idx };
    });

    if (mapped.length < 2) {
      return { minVal: cMin, maxVal: cMax, coords: mapped, linePath: '', areaPath: '' };
    }

    const dLine = mapped
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
    const baselineY = (padTop + plotH).toFixed(1);
    const dArea = `${dLine} L ${mapped[mapped.length - 1].x.toFixed(1)} ${baselineY} L ${mapped[0].x.toFixed(1)} ${baselineY} Z`;

    return { minVal: cMin, maxVal: cMax, coords: mapped, linePath: dLine, areaPath: dArea };
  }, [points, plotW, plotH]);

  const midVal = Number(((minVal + maxVal) / 2).toFixed(1));
  const imcBadge = selectedMetric === 'imc' && activePoint ? clasificarImc(activePoint.value) : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Selector de Métrica: IMC | % Grasa | % Músculo */}
      <View style={[styles.tabsRow, { backgroundColor: colors.surfaceSubtle }]}>
        {METRICS.map((m) => {
          const isSelected = m.key === selectedMetric;
          return (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.tabBtn,
                isSelected && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                setSelectedMetric(m.key);
                setSelectedIdx(null);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: isSelected ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Cabecera del punto seleccionado */}
      {activePoint ? (
        <View style={styles.readoutRow}>
          <View>
            <Text style={[styles.readoutLabel, { color: colors.textSecondary }]}>
              {activeConfig.label} · {activePoint.shortDate}
            </Text>
            <View style={styles.readoutValueRow}>
              <Text style={[styles.readoutValue, { color: colors.text }]}>
                {activePoint.value.toFixed(1)}
                {activeConfig.unit}
              </Text>
              {imcBadge && (
                <View style={[styles.imcPill, { backgroundColor: `${imcBadge.color}22` }]}>
                  <Text style={[styles.imcPillText, { color: imcBadge.color }]}>{imcBadge.label}</Text>
                </View>
              )}
            </View>
          </View>

          {deltaFromStart !== null ? (
            <View style={[styles.deltaBadge, { backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons
                name={deltaFromStart >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
                size={15}
                color={colors.accent}
              />
              <Text style={[styles.deltaText, { color: colors.text }]}>
                {deltaFromStart > 0 ? `+${deltaFromStart}` : deltaFromStart}
                {activeConfig.unit} vs inicio
              </Text>
            </View>
          ) : (
            <View style={[styles.deltaBadge, { backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[styles.deltaText, { color: colors.textSecondary }]}>Punto base</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Lienzo SVG */}
      <View onLayout={handleLayout} style={styles.chartContainer}>
        {points.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="analytics-outline" size={28} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Sin datos para {activeConfig.label}</Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>{activeConfig.emptyHint}</Text>
          </View>
        ) : (
          <Svg width={chartWidth} height={chartHeight}>
            <Defs>
              <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.38" />
                <Stop offset="100%" stopColor={colors.primary} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>

            {/* Líneas guía horizontales */}
            {[
              { y: padTop, val: maxVal },
              { y: padTop + plotH / 2, val: midVal },
              { y: padTop + plotH, val: minVal },
            ].map((g, i) => (
              <React.Fragment key={i}>
                <Line
                  x1={padLeft}
                  y1={g.y}
                  x2={padLeft + plotW}
                  y2={g.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4,4"
                  strokeWidth="1"
                />
                <SvgText
                  x={padLeft - 6}
                  y={g.y + 4}
                  fontSize="10"
                  fill={colors.textMuted}
                  textAnchor="end"
                >
                  {g.val.toFixed(1)}
                </SvgText>
              </React.Fragment>
            ))}

            {/* Si solo hay 1 medición, dibujar línea base punteada en su nivel */}
            {coords.length === 1 && (
              <Line
                x1={padLeft}
                y1={coords[0].y}
                x2={padLeft + plotW}
                y2={coords[0].y}
                stroke={colors.primary}
                strokeDasharray="5,5"
                strokeOpacity="0.55"
                strokeWidth="1.5"
              />
            )}

            {/* Área y línea de evolución cuando hay 2+ registros */}
            {areaPath ? <Path d={areaPath} fill="url(#areaGrad)" /> : null}
            {linePath ? (
              <Path
                d={linePath}
                fill="none"
                stroke={colors.primary}
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {/* Etiquetas de fechas en eje X (inicio, medio opcional, fin) */}
            {coords.map((pt, idx) => {
              const showLabel =
                coords.length <= 5 ||
                idx === 0 ||
                idx === coords.length - 1 ||
                idx === Math.floor(coords.length / 2);
              if (!showLabel) return null;
              return (
                <SvgText
                  key={`lbl-${pt.id}`}
                  x={pt.x}
                  y={chartHeight - 8}
                  fontSize="10"
                  fill={idx === effectiveIdx ? colors.text : colors.textMuted}
                  fontWeight={idx === effectiveIdx ? '700' : '400'}
                  textAnchor="middle"
                >
                  {pt.shortDate}
                </SvgText>
              );
            })}

            {/* Puntos interactivos */}
            {coords.map((pt) => {
              const isSelected = pt.idx === effectiveIdx;
              return (
                <React.Fragment key={pt.id}>
                  {isSelected && (
                    <Circle
                      cx={pt.x}
                      cy={pt.y}
                      r="9"
                      fill={colors.primary}
                      fillOpacity="0.25"
                    />
                  )}
                  <Circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? '5.5' : '4'}
                    fill={isSelected ? colors.accent : colors.surface}
                    stroke={colors.primary}
                    strokeWidth="2.5"
                  />
                  {/* Zona táctil amplia para seleccionar punto en iPhone/Android */}
                  <Rect
                    x={pt.x - 18}
                    y={padTop}
                    width={36}
                    height={plotH}
                    fill="transparent"
                    onPress={() => setSelectedIdx(pt.idx)}
                  />
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>

      {points.length === 1 && (
        <Text style={[styles.singlePointHint, { color: colors.textMuted }]}>
          Registra una nueva medición para trazar tu curva de evolución en el gimnasio.
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 18,
  },
  tabsRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  readoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  readoutLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  readoutValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  readoutValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  imcPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  imcPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  deltaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  deltaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chartContainer: {
    width: '100%',
    minHeight: 185,
    justifyContent: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyHint: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  singlePointHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
});
