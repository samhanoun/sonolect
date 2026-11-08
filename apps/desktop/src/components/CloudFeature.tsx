import type { ReactNode } from "react";
import { useDesktopStore } from "../store/appStore";

export default function CloudFeature({ children }: { children: ReactNode }) {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  return privacyLevel === "cloud" ? (
    children
  ) : (
    <p>
      This feature requires cloud mode. Local dictation works without an
      account.
    </p>
  );
}
