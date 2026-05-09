import React, { useState, useCallback } from "react";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithOAuth,
  type AuthState,
} from "./supabaseClient";

export interface AuthViewProps {
  onAuth: (state: AuthState) => void;
}

const COLORS = {
  bg: "#0d0d1a",
  card: "#1a1a2e",
  accent: "#6c5ce7",
  text: "#e0e0e0",
  muted: "#888",
  error: "#e74c3c",
  border: "#333",
};

export function AuthView({ onAuth }: AuthViewProps): React.ReactElement {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      const result =
        mode === "signin"
          ? await signInWithEmail(email, password)
          : await signUpWithEmail(email, password, displayName);
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        onAuth(result);
      }
    },
    [mode, email, password, displayName, onAuth],
  );

  const handleOAuth = useCallback(
    async (provider: "google" | "github" | "apple") => {
      setError(null);
      try {
        await signInWithOAuth(provider);
      } catch (err) {
        setError(err instanceof Error ? err.message : "OAuth failed");
      }
    },
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: COLORS.bg,
      }}
    >
      <div
        style={{
          width: 400,
          padding: 32,
          borderRadius: 16,
          background: COLORS.card,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: COLORS.accent,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
              color: "#fff",
              marginBottom: 12,
            }}
          >
            S
          </div>
          <h2 style={{ color: COLORS.text, margin: "0 0 4px", fontSize: 22 }}>
            {mode === "signin" ? "Welcome back" : "Create account"}
          </h2>
          <p style={{ color: COLORS.muted, margin: 0, fontSize: 14 }}>
            {mode === "signin"
              ? "Sign in to Sonolect"
              : "Get started with Sonolect"}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["google", "github", "apple"] as const).map((provider) => (
            <button
              key={provider}
              onClick={() => handleOAuth(provider)}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: "transparent",
                color: COLORS.text,
                cursor: "pointer",
                fontSize: 13,
                textTransform: "capitalize",
              }}
            >
              {provider}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
          <span style={{ color: COLORS.muted, fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              aria-label="Display name"
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.bg,
                color: COLORS.text,
                marginBottom: 12,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            required
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.bg,
              color: COLORS.text,
              marginBottom: 12,
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            required
            minLength={6}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.bg,
              color: COLORS.text,
              marginBottom: 16,
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />

          {error && (
            <p
              style={{
                color: COLORS.error,
                fontSize: 13,
                margin: "0 0 12px",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 8,
              border: "none",
              background: COLORS.accent,
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            color: COLORS.muted,
            fontSize: 13,
            marginTop: 16,
          }}
        >
          {mode === "signin"
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            style={{
              background: "none",
              border: "none",
              color: COLORS.accent,
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
