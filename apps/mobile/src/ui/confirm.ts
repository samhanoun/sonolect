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

export interface ChooseOptions<T extends string> {
  title: string;
  message?: string | undefined;
  /** One or two actions (Android shows three buttons at most, Cancel included). */
  choices: readonly {
    value: T;
    label: string;
    /** Shown as destructive (red on iOS). */
    destructive?: boolean | undefined;
  }[];
  cancelLabel: string;
}

/**
 * Asks the user to pick one action. Resolves its value, or null for
 * Cancel, Android's back button or a tap outside the dialog. On web, each
 * action is asked in turn with the browser's confirm.
 */
export function choose<T extends string>({
  title,
  message,
  choices,
  cancelLabel,
}: ChooseOptions<T>): Promise<T | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return Promise.resolve(null);
    }
    const intro = message ? `${title}\n\n${message}` : title;
    for (const choice of choices) {
      if (window.confirm(`${intro}\n\n${choice.label}?`)) {
        return Promise.resolve(choice.value);
      }
    }
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(null) },
        ...choices.map((choice) => ({
          text: choice.label,
          style: choice.destructive
            ? ("destructive" as const)
            : ("default" as const),
          onPress: () => resolve(choice.value),
        })),
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
