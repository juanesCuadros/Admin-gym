import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export type MainTabKey = 'inicio' | 'rutinas' | 'mediciones' | 'clases' | 'asistencias';

interface BottomNavItem {
  key: MainTabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  enabled: boolean;
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { key: 'inicio', label: 'Inicio', icon: 'home-outline', activeIcon: 'home', enabled: true },
  { key: 'rutinas', label: 'Rutinas', icon: 'barbell-outline', activeIcon: 'barbell', enabled: false },
  { key: 'mediciones', label: 'Mediciones', icon: 'scale-outline', activeIcon: 'scale', enabled: true },
  { key: 'clases', label: 'Clases', icon: 'calendar-outline', activeIcon: 'calendar', enabled: false },
  {
    key: 'asistencias',
    label: 'Asistencias',
    icon: 'checkmark-done-circle-outline',
    activeIcon: 'checkmark-done-circle',
    enabled: true,
  },
];

interface BottomTabBarProps {
  activeTab: MainTabKey;
  onSelectTab: (tab: MainTabKey) => void;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab, onSelectTab }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bottomBar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.key;
        const tintColor = isActive ? colors.primary : colors.textSecondary;

        if (!item.enabled) {
          return (
            <View key={item.key} style={styles.navItem}>
              <Ionicons name={item.icon} size={22} color={tintColor} />
              <Text style={[styles.navLabel, { color: tintColor }]} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={item.key}
            style={styles.navItem}
            activeOpacity={0.75}
            onPress={() => onSelectTab(item.key)}
          >
            {isActive && <View style={[styles.activeIndicator, { backgroundColor: colors.primary }]} />}
            <Ionicons name={isActive ? item.activeIcon : item.icon} size={22} color={tintColor} />
            <Text
              style={[
                styles.navLabel,
                { color: tintColor, fontWeight: isActive ? '700' : '500' },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: -10,
    width: 26,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  navLabel: {
    fontSize: 11,
  },
});
