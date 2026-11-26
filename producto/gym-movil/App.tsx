import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { PreLoginScreen } from './src/screens/PreLoginScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ServiceNotAvailableScreen } from './src/screens/ServiceNotAvailableScreen';
import { HomeScreen } from './src/screens/HomeScreen';

const RootNavigator: React.FC = () => {
  const { flowState, isLoading } = useAuth();
  const { colors, isLoadingTheme } = useTheme();

  if (isLoading || isLoadingTheme) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />
      {flowState === 'prelogin' && <PreLoginScreen />}
      {flowState === 'login' && <LoginScreen />}
      {flowState === 'service_unavailable' && <ServiceNotAvailableScreen />}
      {flowState === 'authenticated' && <HomeScreen />}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
