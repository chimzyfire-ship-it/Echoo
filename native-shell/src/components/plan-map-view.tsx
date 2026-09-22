import MapView, { Marker, Polyline } from "react-native-maps";
import Constants from "expo-constants";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { QuickPlan } from "@/src/models";
import { Colors, Fonts } from "@/src/theme/tokens";

export function PlanMapView({ plan }: { plan: QuickPlan }) {
  if (
    Platform.OS === "android" &&
    Constants.appOwnership !== "expo" &&
    !Constants.expoConfig?.extra?.androidMapsConfigured
  ) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 12,
        }}
      >
        <Text
          style={{ fontFamily: Fonts.display, color: Colors.ink, fontSize: 24 }}
        >
          Your stops are ready.
        </Text>
        <Text
          style={{
            fontFamily: Fonts.ui,
            color: Colors.textSecondary,
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          Open directions below to see the route in Maps.
        </Text>
      </View>
    );
  }
  const latitude =
    plan.stops.reduce((sum, s) => sum + s.latitude, 0) / plan.stops.length;
  const longitude =
    plan.stops.reduce((sum, s) => sum + s.longitude, 0) / plan.stops.length;
  const latitudeDelta = Math.max(
    0.012,
    ...plan.stops.map((s) => Math.abs(s.latitude - latitude) * 3),
  );
  const longitudeDelta = Math.max(
    0.012,
    ...plan.stops.map((s) => Math.abs(s.longitude - longitude) * 3),
  );
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      userInterfaceStyle="dark"
      initialRegion={{ latitude, longitude, latitudeDelta, longitudeDelta }}
      accessibilityLabel={`Map showing ${plan.stops.length} stops in ${plan.city}`}
    >
      {plan.stops.length > 1 ? (
        <Polyline
          coordinates={plan.stops.map((stop) => ({
            latitude: stop.latitude,
            longitude: stop.longitude,
          }))}
          strokeColor={Colors.gold}
          strokeWidth={3}
          lineDashPattern={[6, 6]}
        />
      ) : null}
      {plan.stops.map((stop, index) => (
        <Marker
          key={stop.id}
          coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
          title={stop.name}
          description={stop.address}
        >
          <View style={styles.marker}>
            <Text style={styles.label}>{index + 1}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}
const styles = StyleSheet.create({
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.gold,
    borderWidth: 3,
    borderColor: Colors.inkDark,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: Fonts.uiBold, color: Colors.inkDark, fontSize: 15 },
});
