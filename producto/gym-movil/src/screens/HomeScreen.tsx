import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export const HomeScreen: React.FC = () => {
  const { user, cerrarSesion } = useAuth();
  const { colors, theme } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Barra superior con identidad del gimnasio (White-Labeling dinámico) */}
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <View style={styles.topBarLeft}>
            {theme.logo_url ? (
              <Image source={{ uri: theme.logo_url }} style={styles.topLogo} resizeMode="contain" />
            ) : (
              <View style={[styles.topBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.topBadgeText}>
                  {theme.gym_name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              <Text style={[styles.topGymName, { color: colors.text }]} numberOfLines={1}>
                {theme.gym_name}
              </Text>
              <Text style={[styles.topSubdomain, { color: colors.textSecondary }]}>
                {theme.subdominio}.gymdeskcolombia.com
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

        {/* Saludo al Deportista */}
        <View style={styles.welcomeSection}>
          <Text style={[styles.welcomeSub, { color: colors.accent }]}>BIENVENIDO DE VUELTA</Text>
          <Text style={[styles.welcomeTitle, { color: colors.text }]}>
            {user?.nombre || 'Atleta'}
          </Text>
          <Text style={[styles.documentText, { color: colors.textMuted }]}>
            Doc: {user?.documento || '—'}
          </Text>
        </View>

        {/* Tarjeta de Membresía y Estado Activo */}
        <View
          style={[
            styles.membershipCard,
            { backgroundColor: colors.surface, borderColor: colors.primary },
          ]}
        >
          <View style={styles.membershipHeader}>
            <View>
              <Text style={[styles.membershipKicker, { color: colors.textSecondary }]}>
                ESTADO DE MEMBRESÍA
              </Text>
              <Text style={[styles.membershipPlan, { color: colors.text }]}>
                Plan Mensual Libre
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.statusText, { color: colors.success }]}>Al día</Text>
            </View>
          </View>

          <View style={[styles.membershipDivider, { backgroundColor: colors.border }]} />

          <View style={styles.membershipDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                Vigente hasta fin de mes
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
              <Text style={[styles.detailText, { color: colors.accent }]}>
                Acceso Total Habilitado
              </Text>
            </View>
          </View>
        </View>

        {/* Acciones Rápidas del Deportista */}
        <Text style={[styles.sectionHeading, { color: colors.text }]}>Módulos y Entrenamiento</Text>
        <View style={styles.actionsGrid}>
          {/* Tarjeta 1: Rutinas */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.actionIconBox, { backgroundColor: 'rgba(255, 87, 34, 0.15)' }]}>
              <Ionicons name="fitness-outline" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>Mis Rutinas</Text>
            <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
              Ejercicios y series de hoy
            </Text>
          </TouchableOpacity>

          {/* Tarjeta 2: Mediciones Corporales */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.actionIconBox, { backgroundColor: 'rgba(0, 230, 118, 0.15)' }]}>
              <Ionicons name="body-outline" size={24} color={colors.accent} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>Mediciones</Text>
            <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
              Peso, grasa y circunferencias
            </Text>
          </TouchableOpacity>

          {/* Tarjeta 3: Clases Grupales */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.actionIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <Ionicons name="people-outline" size={24} color="#3B82F6" />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>Clases</Text>
            <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
              Horarios y reservas
            </Text>
          </TouchableOpacity>

          {/* Tarjeta 4: Asistencias */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.actionIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="trophy-outline" size={24} color={colors.warning} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>Progreso</Text>
            <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
              Rachas e ingresos
            </Text>
          </TouchableOpacity>
        </View>

        {/* Auditoría y Contexto Multi-Tenant (Sección 4.2) */}
        <View style={[styles.tenantInfoBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
          <View style={styles.tenantInfoHeader}>
            <Ionicons name="server-outline" size={16} color={colors.accent} />
            <Text style={[styles.tenantInfoTitle, { color: colors.text }]}>Aislamiento RLS Verificado</Text>
          </View>
          <Text style={[styles.tenantInfoBody, { color: colors.textSecondary }]}>
            Sesión conectada con contexto parametrizado en PostgreSQL:
          </Text>
          <Text style={[styles.tenantCode, { color: colors.accent }]}>
            SET LOCAL app.current_tenant_id = '{user?.gimnasio_id}';
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 20,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  topLogo: {
    width: 100,
    height: 38,
    marginRight: 10,
  },
  topBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  topBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
  },
  topGymName: {
    fontSize: 15,
    fontWeight: '700',
  },
  topSubdomain: {
    fontSize: 12,
  },
  logoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeSection: {
    marginBottom: 20,
  },
  welcomeSub: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  documentText: {
    fontSize: 13,
    marginTop: 2,
  },
  membershipCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 20,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  membershipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  membershipKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  membershipPlan: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  membershipDivider: {
    height: 1,
    marginVertical: 14,
  },
  membershipDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    fontWeight: '500',
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  actionCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  actionCardSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  tenantInfoBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  tenantInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  tenantInfoTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  tenantInfoBody: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6,
  },
  tenantCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '600',
  },
});
