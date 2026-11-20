import { Alert, Platform } from "react-native";

export interface ConfirmOptions {
  title: string;
  message?: string | undefined;
  confirmLabel: string;
  cancelLabel: string;
  /** Shows the confirm button as destructive (red on iOS). */
  destructive?: boolean | undefined;
}

/**
 * Asks the user to confirm an action. Resolves true only when the confirm
 * button is pressed: Cancel, Android's back button or a tap outside the
 * dialog resolve false.
 */
export function confirm({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return Promise.resolve(false);
    }
    return Promise.resolve(
      window.confirm(message ? `${title}\n\n${message}` : title),
    );
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
