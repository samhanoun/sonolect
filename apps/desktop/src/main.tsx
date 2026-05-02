import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return <main className="app-shell">Sonolect Desktop — Speak. Refine. Act.</main>;
}

createRoot(document.getElementById("root")!).render(<App />);
