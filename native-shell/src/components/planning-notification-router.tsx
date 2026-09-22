import { useEffect, useRef } from "react";
import { useRouter, type Href } from "expo-router";
import { Platform } from 'react-native';
import { readNotification } from '@/src/services/notifications';
import * as Notifications from "expo-notifications";
import { useAuth } from "@/src/providers/auth-provider";
import { supabase } from "@/src/services/supabase";
import { planningNotificationPath } from "@/src/services/planning-notifications";

export function PlanningNotificationRouter() {
  const router = useRouter(),
    { user, ready, profile } = useAuth();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || !ready || !user || !profile?.completedAt) return;
    let mounted = true;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!mounted) return;
      const data = response?.notification.request.content.data;
      if (data?.userId !== user.id) return;
      const path = planningNotificationPath(data?.path);
      const id = response?.notification.request.identifier;
      if (path && id && opened.current !== id) {
        opened.current = id;
        router.dismissTo(path as Href);
        if (typeof data?.eventId === 'string') void readNotification(data.eventId).catch(() => {});
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
        if (typeof data?.notificationId === "string")
          void supabase
            .rpc("record_planning_notification_open", {
              p_id: data.notificationId,
            })
            .then(
              () => {},
              () => {},
            );
      }
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => {});
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [ready, user?.id, profile?.completedAt, router]);
  return null;
}
