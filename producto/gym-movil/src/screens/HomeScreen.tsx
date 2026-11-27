import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { BottomTabBar, MainTabKey } from '../components/BottomTabBar';
import { ProfileEditModal } from '../components/ProfileEditModal';

interface HomeScreenProps {
  onSelectTab: (tab: MainTabKey) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectTab }) => {
  const { user, perfil, avatarDataUrl, cerrarSesion } = useAuth();
  const { colors, theme } = useTheme();
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const membresia = perfil?.membresia_actual;
  const estadoMemb = membresia?.estado || perfil?.estado_general || 'sin_membresia';

  const badgeEstado = (() => {
    switch (estadoMemb) {
      case 'activo':
        return { label: 'Al día', color: colors.success, bg: 'rgba(16, 185, 129, 0.2)' };
      case 'por_vencer':
        return { label: 'Por vencer', color: colors.warning, bg: 'rgba(245, 158, 11, 0.2)' };
      case 'congelado':
        return { label: 'Congelada', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.2)' };
      case 'en_gracia':
      case 'vencido':
        return { label: 'Vencida', color: colors.error, bg: 'rgba(239, 68, 68, 0.2)' };
      default:
        return { label: 'Sin plan activo', color: colors.textSecondary, bg: 'rgba(148, 163, 184, 0.15)' };
    }
  })();

  const pesoStr = perfil?.ultimo_peso_kg ? `${Number(perfil.ultimo_peso_kg).toFixed(1)} kg` : 'Sin registro';
  const alturaStr = perfil?.altura_cm ? `${Number(perfil.altura_cm).toFixed(0)} cm` : '—';
  const displayName = perfil?.nombre || user?.nombre || 'Atleta';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <View style={styles.topBarLeft}>
            {theme.logo_url ? (
              <Image source={{ uri: theme.logo_url }} style={styles.topLogo} resizeMode="contain" />
            ) : (
              <View style={[styles.topBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.topBadgeText}>
                  {(perfil?.gimnasio_nombre || theme.gym_name || 'G').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.topGymName, { color: colors.text }]} numberOfLines={1}>
                {perfil?.gimnasio_nombre || theme.gym_name}
              </Text>
              <Text style={[styles.topSubdomain, { color: colors.textSecondary }]}>
                {perfil?.subdominio || theme.subdominio}.gymdeskcolombia.com
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.logoutBtn, { backgroundColor: colors.surfaceSubtle }]}
            onPress={cerrarSesion}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Cabecera del Deportista con Avatar y Edición de Perfil */}
        <View style={styles.profileRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setEditProfileOpen(true)}
            style={styles.avatarWrapper}
          >
            {avatarDataUrl ? (
              <Image source={{ uri: avatarDataUrl }} style={styles.userAvatar} />
            ) : (
              <View style={[styles.userAvatarFallback, { backgroundColor: colors.surfaceSubtle, borderColor: colors.primary }]}>
                <Text style={[styles.userAvatarInitial, { color: colors.text }]}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={[styles.cameraMiniBadge, { backgroundColor: colors.primary }]}>
              <Ionicons name="camera" size={11} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={[styles.welcomeSub, { color: colors.accent }]}>HOLA DEPORTISTA</Text>
            <Text style={[styles.welcomeTitle, { color: colors.text }]} numberOfLines={2}>
              {displayName}
            </Text>
            <View style={styles.docAndEditRow}>
              <Text style={[styles.documentText, { color: colors.textMuted }]}>
                Doc: {perfil?.documento || user?.documento || '—'}
              </Text>
              <TouchableOpacity
                onPress={() => setEditProfileOpen(true)}
                style={[styles.editProfilePill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
              >
                <Ionicons name="create-outline" size={13} color={colors.primary} />
                <Text style={[styles.editProfileText, { color: colors.text }]}>Editar perfil</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.membershipCard,
            { backgroundColor: colors.surface, borderColor: colors.primary },
          ]}
        >
          <View style={styles.membershipHeader}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.membershipKicker, { color: colors.textSecondary }]}>
                MEMBRESÍA ACTUAL
              </Text>
              <Text style={[styles.membershipPlan, { color: colors.text }]}>
                {membresia?.plan_nombre || 'Sin membresía asignada'}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: badgeEstado.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: badgeEstado.color }]} />
              <Text style={[styles.statusText, { color: badgeEstado.color }]}>{badgeEstado.label}</Text>
            </View>
          </View>

          <View style={[styles.membershipDivider, { backgroundColor: colors.border }]} />

          <View style={styles.membershipDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                {membresia
                  ? `Vence: ${membresia.fecha_vencimiento} (${membresia.dias_restantes} días)`
                  : 'Acércate a recepción para activar tu plan'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onSelectTab('mediciones')}
            style={[styles.kpiBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Peso actual</Text>
            <Text style={[styles.kpiValue, { color: colors.text }]}>{pesoStr}</Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>Estatura: {alturaStr}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onSelectTab('asistencias')}
            style={[styles.kpiBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Entrenamientos</Text>
            <Text style={[styles.kpiValue, { color: colors.accent }]}>
              {perfil?.total_asistencias_mes ?? 0} este mes
            </Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
              Histórico: {perfil?.total_asistencias_historico ?? 0}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BottomTabBar activeTab="inicio" onSelectTab={onSelectTab} />

      <ProfileEditModal
        visible={editProfileOpen}
        onClose={() => setEditProfileOpen(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 24 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 20,
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  topLogo: { width: 100, height: 38, marginRight: 10 },
  topBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  topBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 18 },
  topGymName: { fontSize: 15, fontWeight: '700' },
  topSubdomain: { fontSize: 12 },
  logoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 22,
  },
  avatarWrapper: {
    width: 64,
    height: 64,
    position: 'relative',
  },
  userAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  userAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarInitial: { fontSize: 24, fontWeight: '800' },
  cameraMiniBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeSub: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  welcomeTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  docAndEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 5,
  },
  documentText: { fontSize: 12 },
  editProfilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  editProfileText: { fontSize: 11, fontWeight: '700' },
  membershipCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 20,
    marginBottom: 16,
  },
  membershipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  membershipKicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  membershipPlan: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  membershipDivider: { height: 1, marginVertical: 14 },
  membershipDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { fontSize: 13, fontWeight: '500' },
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  kpiLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  kpiSub: { fontSize: 12, marginTop: 3 },
});
