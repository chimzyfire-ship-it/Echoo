import { Text, View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { QuickPlan } from "@/src/models";
import { Colors, Fonts } from "@/src/theme/tokens";

export function PlanMapView({ plan }: { plan: QuickPlan }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        gap: 16,
        backgroundColor: Colors.cardSolid,
      }}
    >
      <MapPin size={36} color={Colors.gold} />
      <Text
        style={{ fontFamily: Fonts.display, color: Colors.ink, fontSize: 26 }}
      >
        {plan.city}
      </Text>
      <Text
        style={{
          fontFamily: Fonts.ui,
          color: Colors.textSecondary,
          fontSize: 15,
          textAlign: "center",
        }}
      >
        Open directions below to explore these stops on an interactive map.
      </Text>
    </View>
  );
}
