/**
 * Accessibility utilities for WCAG 2.1 AA compliance.
 *
 * Provides ARIA constants, screen reader announcements, focus trapping,
 * keyboard navigation helpers, and reduced-motion detection.
 */

// ── ARIA role constants ──────────────────────────────────────────
export const ARIA_ROLES = {
  dialog: "dialog",
  search: "search",
  list: "list",
  listitem: "listitem",
  status: "status",
  alert: "alert",
  progressbar: "progressbar",
} as const;

export type AriaRole = (typeof ARIA_ROLES)[keyof typeof ARIA_ROLES];

// ── Screen reader announcement ───────────────────────────────────
/**
 * Creates a visually-hidden live region and announces a message to
 * assistive technology. The element is removed after the announcement
 * has had time to be read.
 */
export function announce(
  message: string,
  politeness: "polite" | "assertive" = "polite",
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", politeness);
  el.setAttribute("aria-atomic", "true");
  // Visually hidden but available to screen readers
  Object.assign(el.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: "0",
  });
  document.body.appendChild(el);
  // Slight delay so the live region registers before content is set
  requestAnimationFrame(() => {
    el.textContent = message;
  });
  // Clean up after screen readers have had time to read
  setTimeout(() => {
    el.remove();
  }, 5000);
  return el;
}

// ── Focus trap utility ───────────────────────────────────────────
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps keyboard focus within a container element (e.g. modals/dialogs).
 * Returns a cleanup function that removes the event listener.
 */
export function trapFocus(container: HTMLElement): () => void {
  function handler(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}

// ── Skip-to-content link helper ──────────────────────────────────
/**
 * Creates a visually-hidden "Skip to content" link as the first child
 * of the body. Becomes visible on focus for keyboard users.
 */
export function createSkipLink(targetId: string, label = "Skip to content"): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `#${targetId}`;
  link.textContent = label;
  link.className = "skip-to-content";
  Object.assign(link.style, {
    position: "absolute",
    left: "-9999px",
    top: "0",
    zIndex: "9999",
    padding: "0.5rem 1rem",
    background: "#000",
    color: "#fff",
    textDecoration: "none",
    fontSize: "0.875rem",
  });
  link.addEventListener("focus", () => {
    link.style.left = "0";
  });
  link.addEventListener("blur", () => {
    link.style.left = "-9999px";
  });
  return link;
}

// ── Keyboard navigation helpers ──────────────────────────────────
/**
 * Handles arrow-key navigation within a list container.
 * Moves focus between items matching the given selector.
 * Supports ArrowUp, ArrowDown, Home, and End keys.
 *
 * Returns the index of the newly focused item, or -1 if the key
 * was not handled.
 */
export function handleListKeyDown(
  event: KeyboardEvent,
  container: HTMLElement,
  itemSelector = '[role="listitem"], [role="option"], button, a',
): number {
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(itemSelector),
  );
  if (items.length === 0) return -1;

  const currentIndex = items.findIndex(
    (item) => item === document.activeElement,
  );

  let nextIndex = -1;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      break;
    case "ArrowUp":
      event.preventDefault();
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      break;
    case "Home":
      event.preventDefault();
      nextIndex = 0;
      break;
    case "End":
      event.preventDefault();
      nextIndex = items.length - 1;
      break;
    default:
      return -1;
  }

  items[nextIndex]?.focus();
  return nextIndex;
}

// ── Reduced motion detection ─────────────────────────────────────
/**
 * Returns true if the user prefers reduced motion (OS-level setting).
 * Falls back to false if matchMedia is unavailable.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
