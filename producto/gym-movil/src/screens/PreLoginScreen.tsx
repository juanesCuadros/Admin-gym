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
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export const PreLoginScreen: React.FC = () => {
  const { resolverCorreo, isLoading, errorMessage, clearError } = useAuth();
  const { colors } = useTheme();

  const [email, setEmail] = useState('');

  const handleContinue = async () => {
    if (!email.trim()) return;
    await resolverCorreo(email.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.headerArea}>
          <View style={[styles.logoBadge, { backgroundColor: colors.primary }]}>
            <Ionicons name="barbell-outline" size={36} color="#FFFFFF" />
          </View>
          <Text style={[styles.brandTitle, { color: colors.text }]}>GymOS</Text>
          <Text style={[styles.brandSubtitle, { color: colors.textSecondary }]}>
            App exclusiva para deportistas inscritos
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Ingresa con tu correo</Text>
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
            Escribe el correo registrado en tu gimnasio. Si es tu primera vez, te enviaremos un código de 6 dígitos para confirmar tus datos y medidas.
          </Text>

          {errorMessage && (
            <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Correo del deportista</Text>
            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="tucorreo@ejemplo.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  if (errorMessage) clearError();
                }}
                editable={!isLoading}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: isLoading || !email.trim() ? 0.7 : 1 },
            ]}
            onPress={handleContinue}
            disabled={isLoading || !email.trim()}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Continuar</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footerNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            Debes estar inscrito como deportista activo en tu gimnasio
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  headerArea: { alignItems: 'center', marginBottom: 30 },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  brandSubtitle: { fontSize: 14, marginTop: 6, textAlign: 'center' },
  card: { borderRadius: 18, borderWidth: 1, padding: 24 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  cardDescription: { fontSize: 13, lineHeight: 19, marginBottom: 20 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
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
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15 },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    gap: 6,
  },
  footerText: { fontSize: 12, textAlign: 'center' },
});
