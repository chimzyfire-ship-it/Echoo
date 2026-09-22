import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/providers/auth-provider";
import { OutingScreen } from "@/src/components/outing-screen";
import { CompanionScreen } from "@/src/components/companion-screen";

export default function PlannerScreen() {
  const params = useLocalSearchParams<{
    quickPlan?: string;
    prompt?: string;
  }>();
  const { user } = useAuth();
  if (params.quickPlan)
    return (
      <OutingScreen
        key={`${user?.id || "guest"}:${params.quickPlan}`}
        userId={user?.id}
        initial={params.quickPlan}
      />
    );
  return (
    <CompanionScreen key={user?.id || "guest"} initialPrompt={params.prompt} />
  );
}
