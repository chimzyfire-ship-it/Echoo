import { useAuth } from "@/src/providers/auth-provider";
import { PlanningMemoryScreen } from "@/src/components/planning-memory-screen";
export default function MemoryRoute() {
  const { user } = useAuth();
  return <PlanningMemoryScreen key={user?.id || "guest"} />;
}
