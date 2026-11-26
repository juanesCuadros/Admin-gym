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
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export const LoginScreen: React.FC = () => {
  const { savedEmail, resolvedTenant, iniciarSesion, volverAPreLogin, isLoading, errorMessage, clearError } = useAuth();
  const { colors, theme } = useTheme();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) return;
    await iniciarSesion(password);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cabecera Dynamic White-Labeling (Sección 4.3) */}
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
          <View style={[styles.tenantPill, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
            <Ionicons name="location-outline" size={12} color={colors.accent} />
            <Text style={[styles.tenantPillText, { color: colors.textSecondary }]}>
              {resolvedTenant?.subdominio}.gymdeskcolombia.com
            </Text>
          </View>
        </View>

        {/* Tarjeta de Inicio de Sesión */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Ingresa tu contraseña</Text>

          {/* Email badge con opción de cambiar */}
          <View style={[styles.emailBadge, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.emailLabel, { color: colors.textMuted }]}>Cuenta identificada</Text>
              <Text style={[styles.emailValue, { color: colors.text }]} numberOfLines={1}>
                {savedEmail}
              </Text>
            </View>
            <TouchableOpacity onPress={volverAPreLogin} style={styles.changeEmailBtn}>
              <Text style={[styles.changeEmailText, { color: colors.primary }]}>Cambiar</Text>
            </TouchableOpacity>
          </View>

          {errorMessage && (
            <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          )}

          {/* Campo Contraseña */}
          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Contraseña</Text>
            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Ingresa tu contraseña"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (errorMessage) clearError();
                }}
                editable={!isLoading}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Botón Iniciar Sesión con Primary Color del Gimnasio */}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: isLoading || !password.trim() ? 0.7 : 1 },
            ]}
            onPress={handleLogin}
            disabled={isLoading || !password.trim()}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Iniciar Sesión</Text>
            )}
          </TouchableOpacity>

          {/* Botón Volver */}
          <TouchableOpacity onPress={volverAPreLogin} style={styles.backButton}>
            <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>
              ¿No es tu gimnasio? Volver al inicio
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
    marginBottom: 28,
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
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
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
  tenantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 8,
    gap: 4,
  },
  tenantPillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  emailLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  emailValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  changeEmailBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeEmailText: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 6,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
