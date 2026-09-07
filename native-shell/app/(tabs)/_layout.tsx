import { Tabs } from 'expo-router';
import { Compass, House, Radio, UserRound } from 'lucide-react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { Colors, Fonts } from '@/src/theme/tokens';

export default function TabLayout() {
  return (
    <Tabs
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
          height: 68,
          paddingTop: 7,
          paddingBottom: 8,
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
          tabBarIcon: ({ color }) => <House size={21} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          headerShown: false,
          tabBarIcon: ({ color }) => <Compass size={21} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="link-up"
        options={{
          title: 'Link Up',
          tabBarIcon: ({ color }) => <Radio size={21} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <UserRound size={21} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
