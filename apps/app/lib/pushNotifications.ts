/**
 * pushNotifications — native-guarded helpers around `expo-notifications`.
 *
 * Nothing here runs automatically: the app must call `registerForPushToken()`
 * (or the {@link usePushNotifications} hook's `register`) from an explicit
 * user-facing moment (e.g. after the reader opts into "relight reminders"),
 * never as a global side effect. On web every function is a no-op that
 * resolves to null so callers can share one code path.
 *
 * `expo-notifications` is required lazily so the web bundle/runtime never
 * loads it — keeping the web export self-contained.
 *
 * Scope note: this is the CLIENT half. The server-send path (a Convex action
 * that pushes to a stored token when the "candle re-lights") is a later slice;
 * `scheduleCandleRelight` here is the LOCAL-notification stub so the re-entry
 * nudge works on-device without a server round-trip.
 */
import { Platform } from "react-native";

const CANDLE_CHANNEL_ID = "candle-relights";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notifications(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("expo-notifications");
}

/**
 * Ensure the Android notification channel exists (Android requires a channel
 * before any notification renders). No-op on iOS/web. Best-effort.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const N = notifications();
    await N.setNotificationChannelAsync(CANDLE_CHANNEL_ID, {
      name: "Candle re-lights",
      importance: N.AndroidImportance?.DEFAULT ?? 3,
    });
  } catch {
    // ignore — channel setup is best-effort
  }
}

/**
 * Request notification permission if not already granted. Returns true when
 * granted. No-op → false on web.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const N = notifications();
    const current = await N.getPermissionsAsync();
    if (current.granted || current.status === "granted") return true;
    if (current.canAskAgain === false) return false;
    const requested = await N.requestPermissionsAsync();
    return Boolean(requested.granted) || requested.status === "granted";
  } catch {
    return false;
  }
}

/**
 * Request permission and register for a remote push token. Returns the Expo
 * push token string, or null on web / when permission is denied / on any
 * failure (e.g. no projectId configured in a bare build). Callers store the
 * token server-side later; this half only obtains it.
 */
export async function registerForPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await ensureAndroidChannel();
  try {
    const N = notifications();
    const token = await N.getExpoPushTokenAsync();
    return typeof token?.data === "string" ? token.data : null;
  } catch {
    // Missing EAS projectId, no network, or running in Expo Go without a
    // dev build — treat as "no token" rather than throwing.
    return null;
  }
}

/**
 * Schedule a LOCAL notification for the "candle re-lights" re-entry nudge.
 * `at` is when it should fire (Date or epoch ms). Returns the scheduled
 * notification id (for later cancellation) or null on web / failure.
 *
 * This is the local stub; the server-driven push (Convex action → stored
 * token) lands in a later slice.
 */
export async function scheduleCandleRelight(input: {
  at: Date | number;
  title?: string;
  body?: string;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await ensureAndroidChannel();
  try {
    const N = notifications();
    const when = input.at instanceof Date ? input.at : new Date(input.at);
    const id = await N.scheduleNotificationAsync({
      content: {
        title: input.title ?? "Your candle has re-lit",
        body: input.body ?? "The story is waiting where you left it.",
      },
      trigger: {
        // SchedulableTriggerInputTypes.DATE — fire once at a wall-clock time.
        type: N.SchedulableTriggerInputTypes?.DATE ?? "date",
        date: when,
        ...(Platform.OS === "android" ? { channelId: CANDLE_CHANNEL_ID } : {}),
      },
    });
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Cancel a previously scheduled local notification. No-op on web/failure. */
export async function cancelScheduledNotification(id: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await notifications().cancelScheduledNotificationAsync(id);
  } catch {
    // ignore
  }
}

/**
 * Convenience hook exposing the notification helpers as stable callbacks.
 * Does NOT auto-run anything — the app wires these to explicit user actions.
 */
export function usePushNotifications(): {
  register: () => Promise<string | null>;
  scheduleCandleRelight: (input: {
    at: Date | number;
    title?: string;
    body?: string;
  }) => Promise<string | null>;
  cancel: (id: string) => Promise<void>;
} {
  return {
    register: registerForPushToken,
    scheduleCandleRelight,
    cancel: cancelScheduledNotification,
  };
}
