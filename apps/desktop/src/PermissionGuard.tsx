import React, { useCallback, useEffect, useState } from "react";
import type {
  PlatformPermission,
  PermissionCheckResult,
} from "./platformPermissions";
import {
  checkPermission,
  openAccessibilitySettings,
} from "./platformPermissions";

// ── Permission display metadata ───────────────────────────────────────

const PERMISSION_META: Record<
  PlatformPermission,
  { title: string; icon: string; explanation: string }
> = {
  accessibility: {
    title: "Accessibility Permission Required",
    icon: "🔑",
    explanation:
      "Sonolect needs accessibility permission to insert transcribed text directly into your active application. Without this, text will be copied to the clipboard instead.",
  },
  microphone: {
    title: "Microphone Permission Required",
    icon: "🎙",
    explanation:
      "Sonolect needs microphone access to capture your voice for transcription.",
  },
  "screen-recording": {
    title: "Screen Recording Permission Required",
    icon: "🖥",
    explanation:
      "Sonolect needs screen recording permission to identify the active application for contextual transcription.",
  },
  "system-audio": {
    title: "System Audio Capture",
    icon: "🔊",
    explanation:
      "Sonolect can capture system audio for meeting transcription. This requires a virtual audio device.",
  },
};

// ── Props ─────────────────────────────────────────────────────────────

export type PermissionGuardProps = {
  requiredPermission: PlatformPermission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

// ── Component ─────────────────────────────────────────────────────────

export function PermissionGuard({
  requiredPermission,
  children,
  fallback,
}: PermissionGuardProps) {
  const [result, setResult] = useState<PermissionCheckResult | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const checkResult = await checkPermission(requiredPermission);
      setResult(checkResult);
    } catch {
      // If the check fails, treat as not-determined
      setResult(null);
    } finally {
      setChecking(false);
    }
  }, [requiredPermission]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // While the initial check is in progress, show nothing (or fallback)
  if (result === null && !skipped) {
    return fallback ? <>{fallback}</> : null;
  }

  // Permission granted or user chose to skip
  if (
    skipped ||
    result?.status === "granted" ||
    result?.status === "unsupported"
  ) {
    return <>{children}</>;
  }

  // Permission denied or not-determined — show the request card
  const meta = PERMISSION_META[requiredPermission];

  return (
    <div
      className="permission-guard"
      role="dialog"
      aria-label={meta.title}
      style={{
        background: "rgba(15, 15, 30, 0.85)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(100, 220, 255, 0.15)",
        borderRadius: "16px",
        padding: "32px",
        maxWidth: "440px",
        margin: "24px auto",
        color: "#e0e8f0",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <div
        className="permission-guard__icon"
        style={{ fontSize: "48px", marginBottom: "16px" }}
        aria-hidden="true"
      >
        {meta.icon}
      </div>

      <h2
        className="permission-guard__title"
        style={{
          fontSize: "20px",
          fontWeight: 600,
          marginBottom: "12px",
          color: "#ffffff",
        }}
      >
        {meta.title}
      </h2>

      <p
        className="permission-guard__explanation"
        style={{
          fontSize: "14px",
          lineHeight: "1.6",
          marginBottom: "20px",
          color: "#a0b0c0",
        }}
      >
        {meta.explanation}
      </p>

      <div
        className="permission-guard__instructions"
        style={{
          background: "rgba(100, 220, 255, 0.08)",
          borderRadius: "8px",
          padding: "12px 16px",
          fontSize: "13px",
          marginBottom: "24px",
          color: "#80d0f0",
          textAlign: "left",
        }}
      >
        {result?.instructions ?? "Check your system settings."}
      </div>

      <div
        className="permission-guard__actions"
        style={{
          display: "flex",
          gap: "12px",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {requiredPermission === "accessibility" && (
          <button
            className="permission-guard__btn permission-guard__btn--open-settings"
            aria-label="Open Settings"
            onClick={() => void openAccessibilitySettings()}
            style={{
              background: "linear-gradient(135deg, #6366f1, #06b6d4)",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Open Settings
          </button>
        )}

        <button
          className="permission-guard__btn permission-guard__btn--check-again"
          aria-label="Check Again"
          onClick={() => void runCheck()}
          disabled={checking}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            color: "#e0e8f0",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: checking ? "wait" : "pointer",
            opacity: checking ? 0.6 : 1,
          }}
        >
          {checking ? "Checking…" : "Check Again"}
        </button>

        <button
          className="permission-guard__btn permission-guard__btn--skip"
          aria-label="Skip"
          onClick={() => setSkipped(true)}
          style={{
            background: "transparent",
            color: "#607080",
            border: "none",
            padding: "10px 20px",
            fontSize: "13px",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
