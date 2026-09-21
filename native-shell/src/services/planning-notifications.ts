import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "@/src/services/supabase";
import { notificationPath } from './notification-policy';
import { clearLocalReminders } from './notifications';

const TOKEN_KEY = "echoo:planning-push-token:v1";
export function planningNotificationPath(value: unknown): string | null {
  return notificationPath(value);
}
export async function enablePlanningNotifications(requestPermission = true) {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (
    !Device.isDevice ||
    Platform.OS === "web" ||
    !projectId ||
    Constants.appOwnership === "expo"
  )
    throw new Error(
      "Push notifications need the installed Echoo app. They aren’t available in Expo Go.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("planning", {
      name: "Planning reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (requestPermission && permission.status !== "granted")
    permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notifications are off. You can enable them in your device settings.",
    );
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc("register_planning_device", {
    p_token: token,
  });
  if (error) throw new Error("Could not enable reminders. Please try again.");
  await AsyncStorage.setItem(TOKEN_KEY, token);
}
export async function disablePlanningNotifications() {
  await clearLocalReminders();
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    const { error } = await supabase.rpc("unregister_planning_device", {
      p_token: token,
    });
    if (error)
      throw new Error(
        "Could not disconnect reminders. Try again while online.",
      );
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
  if (Platform.OS !== 'web') await Notifications.dismissAllNotificationsAsync();
}
