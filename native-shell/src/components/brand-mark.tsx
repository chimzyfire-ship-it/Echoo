import { Image, View, type StyleProp, type ViewStyle } from 'react-native';

export function BrandMark({ style, size = 'default' }: { style?: StyleProp<ViewStyle>; size?: 'default' | 'large' | 'small' }) {
  const width = size === 'large' ? 64 : size === 'small' ? 40 : 48;
  return <View style={style} accessible accessibilityRole="image" accessibilityLabel="Echoo">
    <Image source={require('@/assets/echoo-brand-symbol.png')} resizeMode="contain"
      style={{ width, height: width * 620 / 746 }} accessible={false} />
  </View>;
}
