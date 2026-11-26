import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export const ServiceNotAvailableScreen: React.FC = () => {
  const { volverAPreLogin, resolvedTenant } = useAuth();
  const { colors, theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cabecera con la identidad del gimnasio detectado */}
        <View style={styles.brandingHeader}>
          {theme.logo_url ? (
            <Image source={{ uri: theme.logo_url }} style={styles.gymLogo} resizeMode="contain" />
          ) : (
            <View style={[styles.gymBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.gymBadgeLetter}>
                {theme.gym_name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.gymName, { color: colors.text }]}>{theme.gym_name}</Text>
        </View>

        {/* Tarjeta Informativa de Servicio Adicional No Contratado */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.alertIconWrapper, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
            <Ionicons name="phone-portrait-outline" size={32} color={colors.warning} />
          </View>

          <Text style={[styles.cardTitle, { color: colors.text }]}>Servicio Móvil No Activado</Text>
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
            Identificamos que eres miembro de <Text style={{ fontWeight: '700', color: colors.text }}>{theme.gym_name}</Text>, pero esta sede aún no ha contratado o activado el servicio de acceso a la <Text style={{ fontWeight: '700', color: colors.text }}>App Móvil</Text>.
          </Text>

          <View style={[styles.infoBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.accent} style={{ marginTop: 2 }} />
            <Text style={[styles.infoBoxText, { color: colors.textSecondary }]}>
              Puedes pedirle a la administración o recepción del gimnasio que active el módulo móvil para poder consultar tus rutinas, clases y mediciones en tiempo real.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={volverAPreLogin}
          >
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.actionButtonText}>Probar con otro correo</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  brandingHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  gymLogo: {
    width: 140,
    height: 60,
    marginBottom: 12,
  },
  gymBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  gymBadgeLetter: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  gymName: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 5,
  },
  alertIconWrapper: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  infoBox: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 24,
  },
  infoBoxText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  actionButton: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
