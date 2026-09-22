import { Redirect } from "expo-router";
export default function WeekendScreen() {
  return (
    <Redirect
      href={{ pathname: "/(tabs)/discover", params: { intent: "events" } }}
    />
  );
}
