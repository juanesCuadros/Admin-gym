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

export const SetPasswordScreen: React.FC = () => {
  const { crearPassword, esPrimerIngreso, isLoading, errorMessage, clearError } = useAuth();
  const { colors, theme } = useTheme();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const rules = {
    len: password.length >= 8,
    upper: /[A-ZÁÉÍÓÚÑ]/.test(password),
    lower: /[a-záéíóúñ]/.test(password),
    num: /\d/.test(password),
    spec: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password),
    match: password.length > 0 && password === confirmPassword,
  };

  const allValid = rules.len && rules.upper && rules.lower && rules.num && rules.spec && rules.match;

  const handleSave = async () => {
    if (!allValid) return;
    await crearPassword(password, confirmPassword);
  };

  const RuleItem = ({ ok, label }: { ok: boolean; label: string }) => (
    <View style={styles.ruleRow}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={15}
        color={ok ? colors.success : colors.textMuted}
      />
      <Text style={[styles.ruleText, { color: ok ? colors.text : colors.textSecondary }]}>{label}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.stepTag, { color: colors.accent }]}>
            {esPrimerIngreso ? 'REGISTRO · PASO 1 DE 3' : 'NUEVA CONTRASEÑA'}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>Crea tu contraseña</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Con esta clave entrarás directamente a {theme.gym_name} la próxima vez sin pedir código.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {errorMessage && (
            <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Nueva contraseña</Text>
            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="lock-closed-outline" size={19} color={colors.textMuted} style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Mínimo 8 caracteres"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPass}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (errorMessage) clearError();
                }}
                editable={!isLoading}
              />
              <TouchableOpacity onPress={() => setShowPass(!showPass)} style={{ padding: 6 }}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Confirmar contraseña</Text>
            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="shield-checkmark-outline" size={19} color={colors.textMuted} style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Repite tu contraseña"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPass}
                value={confirmPassword}
                onChangeText={(v) => {
                  setConfirmPassword(v);
                  if (errorMessage) clearError();
                }}
                editable={!isLoading}
              />
            </View>
          </View>

          <View style={[styles.rulesBox, { backgroundColor: colors.surfaceSubtle }]}>
            <RuleItem ok={rules.len} label="Mínimo 8 caracteres" />
            <RuleItem ok={rules.upper && rules.lower} label="Mayúscula y minúscula" />
            <RuleItem ok={rules.num} label="Al menos un número" />
            <RuleItem ok={rules.spec} label="Un carácter especial (@, #, $, !, %, *)" />
            <RuleItem ok={rules.match} label="Ambas contraseñas coinciden" />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: isLoading || !allValid ? 0.6 : 1 },
            ]}
            onPress={handleSave}
            disabled={isLoading || !allValid}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>
                  {esPrimerIngreso ? 'Continuar a datos personales' : 'Guardar e ingresar'}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { marginBottom: 20 },
  stepTag: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  card: { borderRadius: 18, borderWidth: 1, padding: 22 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  fieldGroup: { marginBottom: 16 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  input: { flex: 1, fontSize: 15 },
  rulesBox: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginBottom: 18,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleText: { fontSize: 12 },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
