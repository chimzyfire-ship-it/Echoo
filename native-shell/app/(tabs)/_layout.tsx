import { FirstUseWalkthrough, TourTarget } from '@/src/components/first-use/walkthrough';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { Compass, House, Radio, UserRound } from 'lucide-react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { Colors, Fonts } from '@/src/theme/tokens';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <FirstUseWalkthrough><Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerShadowVisible: false,
        headerTitle: '',
        headerLeft: () => <BrandMark style={{ marginLeft: 4 }} />,
        headerLeftContainerStyle: { paddingLeft: 16 },
        sceneStyle: { backgroundColor: Colors.background },
        tabBarStyle: {
          backgroundColor: '#0C0B0A',
          borderTopColor: 'rgba(248, 245, 239, 0.08)',
          height: 60 + Math.max(insets.bottom, 8),
          paddingTop: 7,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarActiveTintColor: '#F8F5EF',
        tabBarInactiveTintColor: 'rgba(248, 245, 239, 0.45)',
        tabBarLabelStyle: {
          fontFamily: Fonts.uiSemiBold,
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: -0.1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color }) => <TourTarget name="home"><House size={21} color={color} strokeWidth={2} /></TourTarget>,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          headerShown: false,
          tabBarIcon: ({ color }) => <TourTarget name="discover"><Compass size={21} color={color} strokeWidth={2} /></TourTarget>,
        }}
      />
      <Tabs.Screen
        name="link-up"
        options={{
          title: 'Link Up',
          tabBarIcon: ({ color }) => <TourTarget name="link-up"><Radio size={21} color={color} strokeWidth={2} /></TourTarget>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TourTarget name="profile"><UserRound size={21} color={color} strokeWidth={2} /></TourTarget>,
        }}
      />
    </Tabs></FirstUseWalkthrough>
  );
}
