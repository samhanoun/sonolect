/// <reference types="vite/client" />

/**
 * True when the build has a sync server (SONOLECT_SYNC_URL, checked as the
 * native side checks it). Set by vite.config.ts; the installed app still asks
 * the native side (`sync_config`) before it shows anything.
 */
declare const __SONOLECT_SYNC__: boolean;
