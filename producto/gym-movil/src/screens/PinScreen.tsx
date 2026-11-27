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

export const PinScreen: React.FC = () => {
  const {
    savedEmail,
    infoMessage,
    validarPin,
    reenviarPin,
    volverAPreLogin,
    isLoading,
    errorMessage,
    clearError,
  } = useAuth();
  const { colors, theme } = useTheme();

  const [pin, setPin] = useState('');
  const [resentNotice, setResentNotice] = useState(false);

  const pinLimpio = pin.replace(/\D/g, '');

  const handleVerify = async () => {
    if (pinLimpio.length !== 6) return;
    await validarPin(pinLimpio);
  };

  const handleResend = async () => {
    setResentNotice(false);
    const ok = await reenviarPin();
    if (ok) {
      setPin('');
      setResentNotice(true);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.brandingHeader}>
          {theme.logo_url ? (
            <Image source={{ uri: theme.logo_url }} style={styles.gymLogo} resizeMode="contain" />
          ) : (
            <View style={[styles.gymBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.gymBadgeLetter}>{theme.gym_name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={[styles.gymName, { color: colors.text }]}>{theme.gym_name}</Text>
          <Text style={[styles.stepPill, { color: colors.accent }]}>VERIFICACIÓN DE CORREO</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Ingresa tu código de 6 dígitos</Text>
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
            {infoMessage || `Enviamos un código de verificación a ${savedEmail} para activar tu cuenta.`}
          </Text>

          {resentNotice && !errorMessage && (
            <View style={[styles.successBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={[styles.successText, { color: colors.success }]}>
                Nuevo código enviado a {savedEmail}
              </Text>
            </View>
          )}

          {errorMessage && (
            <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Código PIN</Text>
            <View style={[styles.pinWrapper, { borderColor: colors.primary, backgroundColor: colors.surfaceSubtle }]}>
              <TextInput
                style={[styles.pinInput, { color: colors.text }]}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={pinLimpio}
                onChangeText={(val) => {
                  setPin(val.replace(/\D/g, '').slice(0, 6));
                  if (errorMessage) clearError();
                }}
                editable={!isLoading}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: isLoading || pinLimpio.length !== 6 ? 0.65 : 1 },
            ]}
            onPress={handleVerify}
            disabled={isLoading || pinLimpio.length !== 6}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Verificar código</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>

          <View style={styles.secondaryActions}>
            <TouchableOpacity onPress={handleResend} disabled={isLoading} style={styles.linkBtn}>
              <Ionicons name="refresh-outline" size={15} color={colors.accent} />
              <Text style={[styles.linkText, { color: colors.accent }]}>Reenviar código</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={volverAPreLogin} disabled={isLoading} style={styles.linkBtn}>
              <Text style={[styles.linkText, { color: colors.textSecondary }]}>Cambiar correo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brandingHeader: { alignItems: 'center', marginBottom: 24 },
  gymLogo: { width: 130, height: 56, marginBottom: 10 },
  gymBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  gymBadgeLetter: { color: '#FFFFFF', fontSize: 26, fontWeight: '800' },
  gymName: { fontSize: 21, fontWeight: '800', textAlign: 'center' },
  stepPill: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  cardDescription: { fontSize: 13, lineHeight: 19, marginBottom: 18 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  successText: { fontSize: 13, flex: 1, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  inputContainer: { marginBottom: 20 },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pinWrapper: {
    borderWidth: 1.5,
    borderRadius: 14,
    height: 58,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pinInput: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
  },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
  linkText: { fontSize: 13, fontWeight: '600' },
});
