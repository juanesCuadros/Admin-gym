import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { MainTabKey } from './src/components/BottomTabBar';
import { PreLoginScreen } from './src/screens/PreLoginScreen';
import { PinScreen } from './src/screens/PinScreen';
import { SetPasswordScreen } from './src/screens/SetPasswordScreen';
import { OnboardingPersonalScreen } from './src/screens/OnboardingPersonalScreen';
import { OnboardingMeasurementsScreen } from './src/screens/OnboardingMeasurementsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ServiceNotAvailableScreen } from './src/screens/ServiceNotAvailableScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { MeasurementsScreen } from './src/screens/MeasurementsScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';

const RootNavigator: React.FC = () => {
  const { flowState, isBooting } = useAuth();
  const { colors, isLoadingTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<MainTabKey>('inicio');

  useEffect(() => {
    if (flowState !== 'authenticated') {
      setActiveTab('inicio');
    }
  }, [flowState]);

  if (isBooting || isLoadingTheme) {
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
      {flowState === 'pin' && <PinScreen />}
      {flowState === 'set_password' && <SetPasswordScreen />}
      {flowState === 'onboarding_personal' && <OnboardingPersonalScreen />}
      {flowState === 'onboarding_measurements' && <OnboardingMeasurementsScreen />}
      {flowState === 'login' && <LoginScreen />}
      {flowState === 'service_unavailable' && <ServiceNotAvailableScreen />}
      {flowState === 'authenticated' && activeTab === 'inicio' && (
        <HomeScreen onSelectTab={setActiveTab} />
      )}
      {flowState === 'authenticated' && activeTab === 'mediciones' && (
        <MeasurementsScreen onSelectTab={setActiveTab} />
      )}
      {flowState === 'authenticated' && activeTab === 'asistencias' && (
        <AttendanceScreen onSelectTab={setActiveTab} />
      )}
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
