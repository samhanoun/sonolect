export const en = {
  // Navigation
  "nav.today": "Today",
  "nav.history": "History",
  "nav.agents": "Agents",
  "nav.settings": "Settings",
  "nav.onboarding": "Setup",
  "nav.dictionary": "Dictionary",
  "nav.home": "Home",
  "nav.snippets": "Snippets",
  "nav.transforms": "Transforms",
  "nav.team": "Team",
  "nav.meeting": "Meeting",

  // Sidebar
  "sidebar.recordNow": "Record now",
  "sidebar.lastDictations": "Latest dictations",
  "sidebar.loadingHistory": "Loading history…",

  // TopBar
  "topbar.eyebrow": "Premium desktop shell",
  "topbar.headline": "Voice capture → text → actions",
  "topbar.searchCommand": "Search a command",
  "topbar.localFirst": "Local-first",
  "topbar.cloudAssisted": "Cloud-assisted",
  "topbar.apiReady": "API ready",
  "topbar.offline": "Offline",

  // Welcome / Home
  "home.welcome": "Welcome back",
  "home.banner": "Your voice-first workspace is ready.",
  "home.noTranscripts": "No transcriptions yet. Press Record to get started.",
  "home.backToTimeline": "← Back",

  // Stats
  "stats.title": "Insights",
  "stats.totalWords": "total words",
  "stats.wpm": "WPM",
  "stats.dayStreak": "day streak",

  // Editor
  "editor.eyebrow": "Editable transcription",
  "editor.fallbackTitle": "Enriched voice brief",
  "editor.modeSummary": "Summary",
  "editor.modeEmail": "Email",
  "editor.modeTicket": "Ticket",
  "editor.voiceCanvas": "Realtime voice canvas",
  "editor.voiceCanvasSubtitle":
    "Capture, local transcription and agentic transformation.",
  "editor.wordCount": "words",
  "editor.language": "Language: French",
  "editor.transformCta": "Transform with Sonolect",
  "editor.textareaLabel": "Transcription editor",
  "editor.draftRestored": "Recovered your unsaved local draft after restart.",
  "editor.historyControls": "Transcript edit history controls",
  "editor.undo": "Undo",
  "editor.redo": "Redo",

  // Segment editor
  "segments.ariaLabel": "Transcript segment editor",
  "segments.title": "Segments",
  "segments.count": "segments",
  "segments.merge": "Merge selected",
  "segments.split": "Split selected",
  "segments.empty": "Type transcript text to create editable segments.",
  "segments.segment": "Segment",
  "segments.speaker": "Speaker",
  "segments.speakerPlaceholder": "Speaker label",
  "segments.textLabel": "Segment text",

  // Privacy / Settings
  "privacy.title": "Privacy",
  "privacy.heading": "Voice control",
  "privacy.description":
    "Choose where audio captures and transcription drafts are processed.",
  "privacy.local": "Local",
  "privacy.cloud": "Cloud",
  "privacy.autoDelete": "Automatic deletion after 24h",
  "privacy.maskNames": "Masking of sensitive proper nouns",
  "privacy.exportTextOnly": "Text-only export on demand",
  "privacy.ariaLabel": "Privacy mode",
  "settings.localApi.title": "Local API",
  "settings.localApi.description":
    "Sonolect can send captures to a local HTTP API, or stay offline when no URL is configured.",
  "settings.localApi.url": "Configured URL",
  "settings.localApi.configured":
    "Local API upload is enabled for new captures.",
  "settings.localApi.offline":
    "No API URL is configured; captures remain local/offline.",
  "settings.whisper.title": "Local Whisper setup",
  "settings.whisper.description":
    "Use your own whisper.cpp, OpenAI Whisper, or faster-whisper wrapper. Sonolect stores only command settings; no large model is bundled.",
  "settings.whisper.install":
    "Install a Whisper-compatible binary or Python wrapper on this computer.",
  "settings.whisper.download":
    "Download a model file yourself and keep it in a local folder you control.",
  "settings.whisper.env":
    "Start the desktop app with this environment variable set to the argv JSON below",
  "settings.whisper.modelPath": "Model path or model id",
  "settings.whisper.modelName": "Model label",
  "settings.whisper.commandArgs": "Command args JSON",
  "settings.whisper.saveCommand": "Save command",
  "settings.whisper.validate": "Validate setup",
  "settings.whisper.status": "Status",
  "settings.whisper.preview": "Preview",
  "settings.whisper.envValue": "Env value",
  "settings.whisper.catalog": "Recommended local assets",
  "settings.whisper.recommendedModel": "Model to download",
  "settings.whisper.defaultBinary": "Default binary path",
  "settings.whisper.defaultModel": "Default model path",
  "settings.whisper.downloadUrl": "Model download",
  "settings.whisper.usePlan": "Use recommended command template",
  "settings.whisper.planApplied":
    "Recommended Whisper command template applied. Add your real model path before testing.",
  "settings.whisper.commandJsonInvalid":
    "Command args must be valid JSON string array.",
  "settings.whisper.commandSaved": "Whisper command saved locally.",

  // Agent Actions
  "agents.title": "Agentic actions",
  "agents.preview": "Preview",
  "agents.notion.title": "Create a Notion note",
  "agents.notion.description":
    "Publish the structured summary with decisions, risks and next steps.",
  "agents.linear.title": "Open 3 Linear tickets",
  "agents.linear.description":
    "Split the transcription into issues with suggested priorities, labels and owners.",
  "agents.mail.title": "Draft a premium email",
  "agents.mail.description":
    "Convert the voice draft into a clear, warm message ready to send.",

  // Voice Recorder Overlay
  "recorder.ariaLabel": "Sonolect voice recorder",
  "recorder.close": "Close",
  "recorder.stopCapture": "Stop capture",
  "recorder.newCapture": "New capture",
  "recorder.listenDownload": "Listen / download",
  "recorder.kb": "KB",

  // Voice state copy
  "voice.permission.eyebrow": "Microphone permission",
  "voice.permission.title": "Allow microphone access",
  "voice.permission.detail":
    "Sonolect requests navigator.mediaDevices.getUserMedia({ audio: true }).",
  "voice.recording.eyebrow": "Active listening",
  "voice.recording.title": "Speak, Sonolect is capturing your voice",
  "voice.recording.detail":
    "MediaRecorder collects audio fragments locally until stopped.",
  "voice.uploading.eyebrow": "Sending transcription",
  "voice.uploading.title": "Preparing backend job…",
  "voice.uploading.detailConfigured":
    "Capture completed: sending to the endpoint configured by VITE_SONOLECT_API_URL.",
  "voice.uploading.detailOffline":
    "No backend configured: switching to explicit local/offline mode.",
  "voice.completed.eyebrowOffline": "Completed · offline",
  "voice.completed.eyebrow": "Completed",
  "voice.completed.titleOffline": "Local capture ready",
  "voice.completed.title": "Capture sent",
  "voice.completed.detailFallback":
    "Audio blob, duration, MIME type and local URL have been created.",
  "voice.error.eyebrow": "Capture error",
  "voice.error.title": "Unable to finalize the recording",
  "voice.error.detailFallback": "An unknown error occurred.",
  "voice.default.eyebrow": "Ready",
  "voice.default.title": "Voice capture",
  "voice.default.detail": "Click to start.",

  // Command Palette
  "palette.prompt": "What do you want to do with your voice?",
  "palette.ariaLabel": "Command palette",
  "palette.newCapture": "New voice capture",
  "palette.newCaptureHint": "Start the mic overlay",
  "palette.openHistory": "Open history",
  "palette.openHistoryHint": "Find a transcription",
  "palette.agentCenter": "Agent center",
  "palette.agentCenterHint": "View connected actions",
  "palette.privacySettings": "Privacy settings",
  "palette.privacySettingsHint": "Local-first, cloud, retention",

  // Errors
  "error.micUnavailable":
    "Microphone capture is not available in this environment.",
  "error.mediaRecorderUnsupported":
    "MediaRecorder is not supported by this desktop runtime.",
  "error.recordingError": "Error during audio recording.",
  "error.sendFailed": "Unable to send the capture to the backend.",
  "error.micPermissionDenied": "Microphone permission denied or unavailable.",
  "error.historyLoadFailed": "Unable to load transcription history.",
  "error.detailLoadFailed": "Unable to open transcription detail.",

  // Fallback transcript
  "fallback.localCapture":
    "[Local voice capture] {duration} · {mimeType} · {size} KB. Backend not configured (VITE_SONOLECT_API_URL).",
  "fallback.sentCapture": "[Sent voice capture] Job {jobId} · {duration}.",

  // Initial transcript
  initialTranscript:
    "Objective: prepare a Sonolect desktop premium demonstration.\n\nFocus on a voice-first experience: global shortcut, immediate mic overlay, editable transcription, then agentic actions.\n\nDesired tone: professional French, direct, elegant. Next action: generate an investor brief and three Linear tickets.",

  // Workspace aria
  "workspace.ariaLabel": "Sonolect workspace",

  // transcriptHistory
  "history.unknownDuration": "Unknown duration",
  "history.unknownDate": "Unknown date",
  "history.pendingContent": "Transcription pending content.",
  "history.offlineMessage":
    "VITE_SONOLECT_API_URL missing: demo history kept locally.",

  // voiceApi
  "voiceApi.offlineNoUrl":
    "VITE_SONOLECT_API_URL missing: capture kept locally without backend upload.",
  "voiceApi.backendUnavailable":
    "Local backend unavailable: capture kept locally",

  // Toast
  "toast.transformComplete": "Transcript transformed successfully",
  "toast.copySuccess": "Transcript copied to clipboard",
  "toast.insertionReady": "Polished dictation ready to paste",

  // Transform
  "editor.transforming": "Transforming…",

  // Export
  "editor.copy": "Copy",
  "editor.download": "Download",

  // Command palette search
  "palette.searchPlaceholder": "Search commands…",
  "palette.noResults": "No results",

  // Recording pill
  "pill.permitting": "Mic access…",
  "pill.processing": "Processing…",
  "pill.done": "Done",
  "pill.error": "Error",
  "pill.stop": "Stop",
  "pill.again": "Again",

  // Audio playback
  "audio.recentCapture": "Recent capture",
  "audio.playPause": "Play or pause audio",
  "audio.waveform": "Audio waveform",
} as const;

export type LocaleKeys = keyof typeof en;
