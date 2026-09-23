import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { Colors } from '@/src/theme/tokens';

const TRACK_WIDTH = 44;
const THUMB_WIDTH = 16;
const MAX_TRANSLATE = TRACK_WIDTH - THUMB_WIDTH;

export interface AppleScrollRailProps extends ScrollViewProps {
  bleedMargin?: number;
  containerStyle?: StyleProp<ViewStyle>;
  indicatorBottomMargin?: number;
}

export function AppleScrollRail({
  children,
  style,
  contentContainerStyle,
  bleedMargin = 22,
  containerStyle,
  indicatorBottomMargin = 0,
  ...scrollViewProps
}: AppleScrollRailProps) {
  const thumbTranslate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const canScroll = contentWidth > containerWidth + 8;
  const maxScroll = Math.max(1, contentWidth - containerWidth);

  const showIndicator = () => {
    if (!canScroll) return;

    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();

    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }).start();
    }, 850);
  };

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, []);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const progress = maxScroll > 0 ? Math.min(Math.max(0, offsetX / maxScroll), 1) : 0;
    thumbTranslate.setValue(progress * MAX_TRANSLATE);
    showIndicator();
    scrollViewProps.onScroll?.(event);
  };

  return (
    <View style={[styles.wrapper, { marginHorizontal: -bleedMargin }, containerStyle]}>
      <ScrollView
        {...scrollViewProps}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onScrollBeginDrag={(e) => {
          showIndicator();
          scrollViewProps.onScrollBeginDrag?.(e);
        }}
        onMomentumScrollEnd={(e) => {
          showIndicator();
          scrollViewProps.onMomentumScrollEnd?.(e);
        }}
        onLayout={(e) => {
          setContainerWidth(e.nativeEvent.layout.width);
          scrollViewProps.onLayout?.(e);
        }}
        onContentSizeChange={(w, h) => {
          setContentWidth(w);
          scrollViewProps.onContentSizeChange?.(w, h);
        }}
        contentContainerStyle={[{ paddingHorizontal: bleedMargin }, contentContainerStyle]}
        style={style}
      >
        {children}
      </ScrollView>

      {canScroll ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.indicatorTrackWrapper,
            { opacity, marginBottom: indicatorBottomMargin },
          ]}
        >
          <View style={styles.indicatorTrack}>
            <Animated.View
              style={[
                styles.indicatorThumb,
                {
                  transform: [{ translateX: thumbTranslate }],
                },
              ]}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'visible',
  },
  indicatorTrackWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    height: 6,
  },
  indicatorTrack: {
    width: TRACK_WIDTH,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(248, 245, 239, 0.12)',
    overflow: 'hidden',
  },
  indicatorThumb: {
    width: THUMB_WIDTH,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.peach,
  },
});
