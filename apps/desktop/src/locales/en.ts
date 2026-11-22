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
  "nav.reader": "Reader",
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
  "topbar.localFirst": "Local only",
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
  "palette.privacySettingsHint": "Local only, cloud, retention",

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

  // Studio shell
  "studio.nav.home": "Overview",
  "studio.nav.transcribe": "Transcribe",
  "studio.nav.speech": "Text to speech",
  "studio.nav.library": "Library",
  "studio.nav.dictionary": "Dictionary",
  "studio.nav.snippets": "Snippets",
  "studio.nav.models": "Models & voices",
  "studio.nav.settings": "Settings",
  "studio.group.workspace": "Workspace",
  "studio.group.personalize": "Personalize",
  "studio.brand.tagline": "Voice workspace",
  "studio.version": "Windows workspace",
  "studio.quickNav.label": "Quick navigation",
  "studio.quickNav.find": "Find a page",
  "studio.quickNav.placeholder": "Where would you like to go?",
  "studio.quickNav.close": "Close navigation",
  "studio.quickNav.empty": "No page matches “{query}”.",
  "studio.topbar.search": "Search pages",
  "studio.dock.listening": "Listening…",
  "studio.dock.processing": "Processing…",
  "studio.dock.error": "Recording needs attention",
  "studio.dock.ready": "Your words are ready",
  "studio.dock.stop": "Stop",
  "studio.dock.dismiss": "Dismiss",
  "studio.dictation.new": "New dictation",
  "studio.dictation.start": "Start dictating",
  "studio.dictation.stop": "Stop dictation",
  "studio.mode.label": "Processing mode",
  "studio.mode.local": "Local only",
  "studio.mode.cloud": "Cloud enabled",
  "studio.mode.localProcessing": "Local processing",
  "studio.mode.localHint":
    "Your recordings stay on this device unless you choose online processing.",
  "studio.mode.cloudHint":
    "Online requests use your selected provider and API key.",
  "studio.common.copy": "Copy",
  "studio.common.delete": "Delete",
  "studio.common.refresh": "Refresh",
  "studio.common.undo": "Undo",
  "studio.common.redo": "Redo",
  "studio.common.language": "Language",
  "studio.common.working": "Working…",
  "studio.common.saving": "Saving…",
  "studio.common.secondsShort": "{count}s",

  // Studio overview
  "studio.signal.listening": "Listening",
  "studio.signal.ready": "Ready",
  "studio.signal.meta": "16 kHz · mono · on device",
  "studio.signal.metaHigh": "48 kHz · stereo when available · on device",
  "studio.overview.eyebrow": "A little less typing",
  "studio.overview.title": "Make room for your thoughts",
  "studio.overview.subtitle":
    "Speak naturally. Turn your voice into something useful.",
  "studio.overview.chip": "Your personal workspace",
  "studio.overview.heroEyebrow": "Start with your voice",
  "studio.overview.heroTitle1": "Say it.",
  "studio.overview.heroTitle2": "Let your ideas flow.",
  "studio.overview.heroBody":
    "Capture a thought, write a message, or get a first draft down. Local recognition is ready when you are.",
  "studio.overview.statRecordings": "Recordings",
  "studio.overview.statRecordingsHint": "Saved on this device",
  "studio.overview.statWords": "Words captured",
  "studio.overview.statWordsHint": "From your saved transcripts",
  "studio.overview.statRetry": "Ready for another pass",
  "studio.overview.statRetryHint": "Recordings you can retry",
  "studio.overview.ttsTitle": "Give your text a voice",
  "studio.overview.ttsBody":
    "Choose a speech model and listen to your writing.",
  "studio.overview.ttsLink": "Open text to speech →",
  "studio.overview.modelsTitle": "A model for every task",
  "studio.overview.modelsBody":
    "Connect OpenRouter or OpenCode Zen. Keep local speech one click away.",
  "studio.overview.modelsLink": "Explore models & voices →",
  "studio.overview.recent": "Recent recordings",
  "studio.overview.viewLibrary": "View library →",
  "studio.overview.empty": "Your first recording will appear here.",

  // Studio transcribe
  "studio.transcribe.eyebrow": "From thought to text",
  "studio.transcribe.title": "Find your flow",
  "studio.transcribe.subtitle":
    "Record your voice, import audio, or work on your next draft.",
  "studio.transcribe.import": "Import audio",
  "studio.transcribe.yourTranscript": "Your transcript",
  "studio.transcribe.editorLabel": "Transcript editor",
  "studio.transcribe.placeholder":
    "Your words will appear here. You can also start typing…",
  "studio.transcribe.words.one": "{count} word",
  "studio.transcribe.words.other": "{count} words",
  "studio.transcribe.stopRecording": "Stop recording",
  "studio.transcribe.record": "Record to add text",
  "studio.transcribe.copied": "Transcript copied.",
  "studio.transcribe.copyBlocked":
    "Copy was blocked. Select the text to copy it manually.",
  "studio.transcribe.exportFormat": "Export format",
  "studio.transcribe.export": "Export transcript",
  "studio.transcribe.exportTitle": "Sonolect transcript",
  "studio.transcribe.previewNotice":
    "Browser preview. You can type, edit and export text here. Recording and transcription need the Sonolect desktop app.",
  "studio.transcribe.previewImport":
    "The browser preview cannot transcribe audio files. Open this file in the Sonolect desktop app. Nothing was sent.",
  "studio.export.txt": "Plain text (.txt)",
  "studio.export.md": "Markdown (.md)",
  "studio.export.srt": "Subtitles (.srt)",
  "studio.export.vtt": "Web subtitles (.vtt)",
  "studio.export.json": "JSON with timings (.json)",
  "studio.transcribe.fileTooLarge":
    "Choose an audio file under 25 MB and three minutes.",
  "studio.transcribe.notReady": "Transcription is not ready.",
  "studio.transcribe.saved": "Audio transcribed and saved.",
  "studio.transcribe.noSpeech": "No speech was detected.",
  "studio.transcribe.recognition": "Recognition",
  "studio.transcribe.polishTitle": "A little polish",
  "studio.transcribe.polishBody":
    "Apply your dictionary and conservative local formatting.",
  "studio.transcribe.cleanLocal": "Clean up locally",
  "studio.transcribe.refineOnline": "Refine with an online model",
  "studio.transcribe.instruction": "Editing instruction",
  "studio.transcribe.defaultInstruction":
    "Make this clear and concise without changing its meaning.",
  "studio.transcribe.previewEdit": "Preview online edit",
  "studio.transcribe.chooseModel": "Choose editing model →",
  "studio.transcribe.reviewTitle": "Review the suggested edit",
  "studio.transcribe.apply": "Apply edit",
  "studio.transcribe.keep": "Keep original",

  // Studio text to speech
  "studio.speech.eyebrow": "Words worth hearing",
  "studio.speech.title": "Give your writing a voice",
  "studio.speech.subtitle":
    "Pick a model, find a voice, and listen before you share.",
  "studio.speech.question": "What would you like to hear?",
  "studio.speech.inputLabel": "Text to speak",
  "studio.speech.placeholder":
    "Paste a script, a message, or a passage you want to listen to…",
  "studio.speech.characters": "{count} / {max} characters",
  "studio.speech.generate": "Generate speech",
  "studio.speech.generating": "Generating speech…",
  "studio.speech.download": "Download {format}",
  "studio.speech.localNotice":
    "Local only is selected. Switch the processing control to Cloud enabled before generating online speech.",
  "studio.speech.modelVoice": "Model & voice",
  "studio.speech.format": "Audio format",
  "studio.speech.pcmOption": "PCM → playable WAV",
  "studio.speech.sampleRate": "PCM sample rate",
  "studio.speech.sampleRateHint":
    "16-bit mono. Match the selected model's output rate.",
  "studio.speech.formatHint":
    "Gemini and HeyGen speech models require PCM. Other models may require MP3.",
  "studio.speech.voice": "Voice",
  "studio.speech.voiceDefault": "Provider default, if supported",
  "studio.speech.voicePlaceholder":
    "Voice ID, or leave blank for a provider default",
  "studio.speech.voiceHint":
    "Available voices depend on the model. If a model has no default, enter one of its supported voice IDs.",
  "studio.speech.localCallout":
    "Local speech recognition remains available. Online speech generation uses your OpenRouter account.",

  // Studio library
  "studio.library.eyebrow": "A place for every thought",
  "studio.library.title": "Your voice library",
  "studio.library.subtitle":
    "Saved recordings, ready to revisit. Audio stays here until you delete it.",
  "studio.library.searchLabel": "Search saved recordings",
  "studio.library.searchPlaceholder": "Search your recordings…",
  "studio.library.noMatch": "No matching recordings",
  "studio.library.emptyTitle": "A fresh start.",
  "studio.library.tryOther": "Try a different word.",
  "studio.library.emptyBody":
    "Your recordings will appear here after you dictate or import audio in the desktop app.",
  "studio.library.createFirst": "Create your first recording",
  "studio.library.retryNeeded": "Retry needed",
  "studio.library.savedOnDevice": "Saved on device",
  "studio.library.noTranscript": "No transcript yet.",
  "studio.library.openEditor": "Open editor →",
  "studio.library.copyBlocked": "Copy was blocked.",
  "studio.library.transcribing": "Transcribing…",
  "studio.library.retryLocal": "Retry locally",
  "studio.library.retried": "Recording transcribed locally.",
  "studio.library.confirmDelete":
    "Delete this recording and its transcript from this device?",

  // Studio dictionary and snippets
  "studio.vocab.eyebrow": "Sounds like you",
  "studio.vocab.count.one": "{count} entry · stored locally",
  "studio.vocab.count.other": "{count} entries · stored locally",
  "studio.vocab.deleteLabel": "Delete {name}",
  "studio.vocab.empty":
    "No entries yet. Add one above to personalize your drafts.",
  "studio.dictionary.title": "Your words, spelled right",
  "studio.dictionary.subtitle":
    "Teach local formatting the names, terms, and spellings you use.",
  "studio.dictionary.spokenLabel": "Spoken or recognized spelling",
  "studio.dictionary.spokenPlaceholder": "A word that needs correcting",
  "studio.dictionary.replacementLabel": "Preferred spelling",
  "studio.dictionary.replacementPlaceholder": "How it should appear",
  "studio.dictionary.add": "Add word",
  "studio.dictionary.listTitle": "Personal dictionary",
  "studio.snippets.title": "Say less, write more",
  "studio.snippets.subtitle":
    "Save reusable text blocks for local expansion in your drafts.",
  "studio.snippets.triggerLabel": "Shortcut",
  "studio.snippets.triggerPlaceholder": "/signature",
  "studio.snippets.bodyLabel": "Text to insert",
  "studio.snippets.bodyPlaceholder": "Your reusable text",
  "studio.snippets.add": "Add snippet",
  "studio.snippets.listTitle": "Your snippets",

  // Studio settings and privacy
  "studio.settings.eyebrow": "Your space, your rules",
  "studio.settings.title": "Make yourself at home",
  "studio.settings.subtitle":
    "Local models, language, and privacy in one place.",
  "studio.settings.whisperTitle": "Local Whisper",
  "studio.settings.whisperMeta": "Multilingual Base · CPU · 148 MB",
  "studio.settings.modelReady": "A local model is available on this computer.",
  "studio.settings.modelMissing":
    "Install a model once, then dictate without an internet connection.",
  "studio.settings.downloading": "Downloading {progress}%",
  "studio.settings.reinstall": "Reinstall verified model",
  "studio.settings.install": "Install local model",
  "studio.settings.modelDownloaded":
    "Model downloaded and checksum verified. You can use it offline.",
  "studio.settings.existingModel": "Use an existing model",
  "studio.settings.modelPath": "Whisper .bin file path",
  "studio.settings.languageTitle": "Language & processing",
  "studio.settings.interfaceLanguage": "Interface language",
  "studio.settings.dictationLanguage": "Dictation language",
  "studio.settings.languageAuto": "Auto-detect",
  "studio.settings.modeHint":
    "Local only blocks online audio and text processing. Model catalog lookups and downloads are separate actions.",
  "studio.settings.shortcutsTitle": "Shortcuts & storage",
  "studio.settings.shortcutToggle": "Toggle recording",
  "studio.settings.shortcutHold": "Hold to talk",
  "studio.settings.shortcutNav": "Quick navigation",
  "studio.settings.shortcutCancel": "Cancel dictation",
  "studio.settings.bubbleTitle": "Dictation bubble",
  "studio.settings.bubbleHint":
    "Press {toggle} (or hold {hold}) in any app. A floating bubble shows Sonolect is listening, then your words are pasted where your cursor is. Click the bubble to start or stop, {cancel} to cancel, right-click it to open Sonolect.",
  "studio.settings.bubbleShow": "Show the bubble",
  "studio.settings.bubbleAlways": "Always (small pill when idle)",
  "studio.settings.bubbleDictating": "Only while dictating",
  "studio.settings.bubbleOff": "Off",
  "studio.settings.storageHint":
    "Recordings can run up to four hours and are saved on this device for as long as you choose above. API keys use Windows Credential Manager.",
  "studio.settings.previewNotice":
    "This is the browser preview. Model installation and local speech run in the Sonolect desktop app.",
  "studio.privacy.title": "Privacy & retention",
  "studio.privacy.subtitle":
    "Recordings and transcripts never leave this device in Local only.",
  "studio.privacy.keep": "Keep recordings",
  "studio.privacy.deleteAll": "Delete all my data",
  "studio.privacy.deleting": "Deleting…",
  "studio.privacy.deleteAllHint":
    "Deletes recordings, transcripts, your dictionary and snippets, saved API keys and settings. Downloaded speech models are kept.",
  "studio.privacy.confirmDeleteAll":
    "Delete all your recordings, transcripts, dictionary, snippets, saved API keys and settings from this device? This cannot be undone.",
  "studio.privacy.partialFailure": "Some data could not be deleted: {problems}",
  "studio.privacy.keptForever": "Recordings are kept until you delete them.",
  "studio.privacy.savedPreview": "Saved. It applies in the desktop app.",
  "studio.privacy.savedDeleted.one":
    "Saved. Deleted {count} recording older than {period}.",
  "studio.privacy.savedDeleted.other":
    "Saved. Deleted {count} recordings older than {period}.",
  "studio.privacy.savedAuto":
    "Saved. Recordings older than {period} are deleted automatically.",
  "studio.retention.forever": "Until I delete them",
  "studio.retention.days.one": "{count} day",
  "studio.retention.days.other": "{count} days",

  // Note sync between devices
  "studio.sync.title": "Sync between devices",
  "studio.sync.subtitle":
    "Your notes on all your devices, encrypted end to end: the sync server keeps them but cannot read them.",
  "studio.sync.server": "Sync server: {server}",
  "studio.sync.audioStays":
    "Recordings stay on the device that made them. Only the notes sync.",
  "studio.sync.offState": "Sync is off.",
  "studio.sync.onState": "Sync is on.",
  "studio.sync.turnOn": "Turn on sync",
  "studio.sync.turningOn": "Turning on…",
  "studio.sync.join": "Join with a code",
  "studio.sync.joinLabel": "Sync code or link from your other device",
  "studio.sync.joinSubmit": "Join",
  "studio.sync.joining": "Joining…",
  "studio.sync.cancel": "Cancel",
  "studio.sync.warning":
    "Joining shares every note with whoever holds this code.",
  "studio.sync.lastSync": "Last synced: {time}.",
  "studio.sync.neverSynced": "Not synced yet.",
  "studio.sync.syncing": "Syncing…",
  "studio.sync.syncNow": "Sync now",
  "studio.sync.showCode": "Show code",
  "studio.sync.hideCode": "Hide code",
  "studio.sync.codeHint":
    "On your other device, choose to join sync, then scan this QR code or type the code.",
  "studio.sync.codeLabel": "Sync code",
  "studio.sync.qrLabel": "QR code to join this sync",
  "studio.sync.turnOff": "Turn off sync",
  "studio.sync.turnOffQuestion": "Turn off sync on this device?",
  "studio.sync.keepServer": "Keep the server copy",
  "studio.sync.keepServerHint":
    "Your other devices keep syncing. This one can join again with the code.",
  "studio.sync.deleteServer": "Delete the server copy",
  "studio.sync.deleteServerHint":
    "Your other devices see “This sync was deleted” and turn sync off. Every device keeps its notes.",
  "studio.sync.turningOff": "Turning off…",
  "studio.sync.notesKept": "Your notes stay on this device.",
  "studio.sync.error.unauthorized":
    "This sync key is not accepted by the server.",
  "studio.sync.error.deleted": "This sync was deleted.",
  "studio.sync.error.tooLarge": "A note is too large to sync.",
  "studio.sync.error.server": "Sync is unavailable right now.",
  "studio.sync.error.offline":
    "Offline. Notes will sync when you're back online.",
  "studio.sync.notice.quota":
    "Sync storage is full. Delete notes to sync new ones.",
  "studio.sync.notice.newerSchema": "Update Sonolect to sync every note.",
  "studio.sync.pairing.invalid": "This is not a Sonolect sync code.",
  "studio.sync.pairing.version": "Update Sonolect to use this code.",
  "studio.sync.pairing.length": "Check the code: it has 56 characters.",
  "studio.sync.pairing.typo": "A character is wrong.",
  "studio.sync.preview": "Sync works in the installed app.",
  "studio.sync.deleteAllHint": "Sync is turned off on this device too.",
  "studio.sync.deleteAllServer":
    "Sync is on. Delete the server copy of your notes too? OK deletes it: your other devices turn sync off and keep their notes. Cancel keeps it for them.",

  // Studio models and providers
  "studio.task.stt": "Speech to text",
  "studio.task.tts": "Text to speech",
  "studio.task.text": "Text editing",
  "studio.models.eyebrow": "Make it yours",
  "studio.models.title": "Your models, your choice",
  "studio.models.subtitle":
    "Choose how Sonolect listens, speaks, and refines your words.",
  "studio.models.chip": "Keys stay on your device",
  "studio.models.tabProviders": "Providers",
  "studio.models.provider": "Provider",
  "studio.models.providerFor": "{task} provider",
  "studio.models.model": "Model",
  "studio.models.modelFor": "{task} model",
  "studio.models.localHint":
    "Your installed Whisper model runs on this computer.",
  "studio.models.choose": "Choose a compatible model",
  "studio.models.savedSelection": "{model} · saved selection",
  "studio.models.loading": "Loading models…",
  "studio.models.loadCatalog": "Load live catalog",
  "studio.models.catalogHint.stt":
    "Load the live catalog to see models that support speech to text. No audio or text is sent when loading models.",
  "studio.models.catalogHint.tts":
    "Load the live catalog to see models that support text to speech. No audio or text is sent when loading models.",
  "studio.models.catalogHint.text":
    "Load the live catalog to see models that support text editing. No audio or text is sent when loading models.",
  "studio.models.routerTagline": "One key, many speech models",
  "studio.models.zenTagline": "Models for thoughtful text editing",
  "studio.models.keySaved": "Key saved",
  "studio.models.noKey": "No key saved",
  "studio.models.noSpeech": "Dedicated speech not available",
  "studio.models.apiKey": "API key",
  "studio.models.replaceKey": "Paste a new key to replace the saved key",
  "studio.models.pasteKey": "Paste your {provider} key",
  "studio.models.saveKey": "Save key",
  "studio.models.keyNote":
    "Stored in Windows Credential Manager. Never in browser preferences.",
  "studio.models.browse": "Browse models",
  "studio.models.removeKey": "Remove saved key",
  "studio.models.previewNotice":
    "Browser preview. Local speech runs in the Sonolect desktop app. Saving API keys for online models works only in the Windows app for now.",
  "studio.models.localTitle": "Prefer to keep it local?",
  "studio.models.localBody":
    "Whisper runs on your computer. No API key. No account. No audio uploads.",
  "studio.models.manageLocal": "Manage local model",
  "studio.models.workflowTitle": "Set up your voice workflow",
  "studio.models.workflowBody": "Each task can use a different model.",
  "studio.models.chooseModel": "Choose model →",
  "studio.models.controlTitle": "Always in your control",
  "studio.models.controlBody":
    "Adding a key doesn’t change your processing mode. Audio and text only go online when you choose cloud processing.",
  "studio.models.privateDefault": "Private by default",
  "studio.models.filtered":
    "Models are filtered by the provider’s published capabilities.",
  "studio.models.zenNotice":
    "OpenCode Zen is available for text editing. Its public API does not currently advertise dedicated speech models.",
  "provider.name.local": "Local Whisper",
  "provider.previewOnly":
    "This window is a browser preview. Local speech runs in the Sonolect desktop app. Saved API keys work only in the Windows app for now.",
  "provider.cloudRequired":
    "Choose cloud processing before sending audio or text online.",
  "provider.cloudCancelled": "Cloud processing was cancelled.",
  "provider.selectStt":
    "Select an OpenRouter speech-to-text model in Models & voices.",
  "provider.selectTts": "Select an OpenRouter text-to-speech model first.",
  "provider.selectText": "Select a text editing model in Models & voices.",
  "provider.modelsLoaded.one":
    "{count} compatible model loaded from {provider}.",
  "provider.modelsLoaded.other":
    "{count} compatible models loaded from {provider}.",
  "provider.keySaved":
    "{provider} key saved in Windows Credential Manager. It has not been billed or used for a test request.",
  "provider.keyRemoved": "Saved key removed.",

  // Capture and transcription status
  "voice.localOnly": "Local only: cloud processing is disabled.",
  "voice.localWhisper": "Transcribed on this device with local Whisper.",
  "voice.onlineModel": "Transcribed with your selected online model.",
  "voice.sentForTranscription": "Recording sent to Sonolect for transcription.",
  "voice.cloudPolish": "Cloud STT + Gemini polish.",
  "voice.jobFailed": "Backend audio job failed ({status})",
  "voice.transcribeFailed": "Cloud transcribe failed ({status})",
  "voice.polishFailed": "Cloud polish failed ({status})",
  "voice.uploadFailed": "Backend audio upload failed ({status})",
  "audio.invalidFormat": "Invalid audio format.",
  "audio.tooLong": "Recordings are limited to three minutes.",
  "audio.invalidSamples": "Audio contains invalid samples.",
  "voice.localUnavailableApp":
    "Local transcription unavailable. Check your installed model in Settings. No audio was uploaded.",
  "voice.localUnavailablePreview":
    "The browser preview cannot transcribe speech. Use the Sonolect desktop app. This recording was not saved or sent.",
  "voice.previewCannotTranscribe":
    "The browser preview cannot transcribe speech. Use the Sonolect desktop app to record and transcribe. Nothing was recorded or sent.",
  "voice.notConfigured":
    "Online transcription is not configured. Your recording stayed on this device.",
  "voice.unreachable":
    "Sonolect could not be reached, so your recording stayed on this device.",
  "voice.unreachableBecause":
    "Sonolect could not be reached, so your recording stayed on this device ({reason}).",
  "studio.keys.shift": "Shift",
  "studio.keys.esc": "Esc",
  // Dictation bubble (the floating pill, in its own window)
  "bubble.start": "Start dictation ({hotkey})",
  "bubble.idleTitle":
    "Click or press {hotkey} to dictate. Right-click to open Sonolect.",
  "bubble.dictate": "Dictate",
  "bubble.cancel": "Cancel dictation",
  "bubble.dismiss": "Dismiss",
  "bubble.cancelTitle": "Cancel ({key})",
  "bubble.stop": "Stop and insert",
  "bubble.phase.idle": "Ready",
  "bubble.phase.listening": "Listening",
  "bubble.phase.transcribing": "Transcribing",
  "bubble.phase.inserted": "Inserted",
  "bubble.phase.copied": "Copied",
  "bubble.phase.error": "Couldn't dictate",
  "bubble.copiedDetail": "Copied. Press Ctrl+V to paste.",
  "bubble.pasteFailed": "Couldn't paste. Your words are saved in Sonolect.",
  "bubble.error.generic": "Something went wrong.",
  "bubble.error.micUnavailable": "No microphone found.",
  "bubble.error.micPermissionDenied": "Microphone access was denied.",
  "bubble.error.mediaRecorderUnsupported": "Recording is not supported here.",
  "bubble.error.recordingError": "Recording stopped unexpectedly.",
  "bubble.error.sendFailed": "Transcription failed.",
  "bubble.status.inserted": "Inserted dictation into the active app.",
  "bubble.status.copied": "Copied dictation to the clipboard. {status}",
  "studio.privacy.problemRecordings": "Recordings: {reason}",
  "studio.privacy.problemSettings": "Settings: {reason}",
  "studio.privacy.problemSync": "Sync: {reason}",
  "native.downloadRunning": "A model download is already running.",
  "native.cannotLoadModel": "Cannot load speech model: {reason}",
  "native.cannotSaveRecording": "Cannot save recording: {reason}",
  "native.chooseFormat": "Choose MP3 or PCM output.",
  "native.chooseModel": "Choose a valid model from the catalog.",
  "native.keyDeleteFailed": "Could not delete the saved key.",
  "native.deleteFailed": "Could not delete {name}: {reason}",
  "native.providerInit": "Could not initialize the provider connection.",
  "native.modelsLoadFailed":
    "Could not load models. Check your internet connection.",
  "native.credentialRead": "Could not read Windows Credential Manager.",
  "native.credentialSave":
    "Could not save the key to Windows Credential Manager.",
  "native.credentialUnavailable": "Windows Credential Manager is unavailable.",
  "native.invalidKey": "Enter a valid API key without spaces or line breaks.",
  "native.ttsLength": "Enter between 1 and 12,000 characters to synthesize.",
  "native.ttsLengthVoice":
    "Enter between 1 and 12,000 characters and a valid voice.",
  "native.rewriteLength":
    "Enter up to 12,000 characters and a short editing instruction.",
  "native.installModel": "Install the local speech model in Settings first.",
  "native.invalidPcm": "Invalid 16-bit mono PCM audio or sample rate.",
  "native.invalidWav": "Invalid WAV audio: {reason}",
  "native.invalidCatalog": "Invalid model catalog JSON.",
  "native.invalidModelPath": "Invalid model path",
  "native.invalidRecordingId": "Invalid recording ID.",
  "native.invalidRecordingSize": "Invalid recording size.",
  "native.invalidTextResponse": "Invalid text response.",
  "native.invalidTranscription": "Invalid transcription response.",
  "native.localPcm": "Local speech requires mono 16 kHz PCM audio.",
  "native.checksum": "Model checksum failed. Please retry the download.",
  "native.discoveryInterrupted": "Model discovery was interrupted.",
  "native.downloadFailed": "Model download failed: {reason}",
  "native.modelTooLarge": "Model exceeded its expected size.",
  "native.noAudio": "No audio was recorded.",
  "native.transcriptionInterrupted": "Online transcription was interrupted.",
  "native.zenNoSpeech":
    "OpenCode Zen does not advertise a dedicated speech API. Use OpenRouter for online speech, or local Whisper for transcription.",
  "native.processingInterrupted":
    "Processing was interrupted. Retry this recording.",
  "native.tooLong": "Recording exceeds the three-minute limit.",
  "native.saveKeyFirst":
    "Save this provider's API key in Models & voices first.",
  "native.keysWindowsOnly":
    "Secure API key storage is currently supported on Windows.",
  "native.keyStorageWindows": "Secure key storage requires Windows.",
  "native.speechInterrupted": "Speech generation was interrupted.",
  "native.editInterrupted": "Text editing was interrupted.",
  "native.noEditableText": "The model returned no editable text.",
  "native.connectionFailed": "The provider connection failed or timed out.",
  "native.responseTooLarge": "The provider response exceeded the size limit.",
  "native.responseInterrupted": "The provider response was interrupted.",
  "native.providerCatalog": "The provider returned an invalid model catalog.",
  "native.unexpectedAudio":
    "The provider returned an unexpected audio format. Check the model's format settings.",
  "native.emptyAudio": "The provider returned empty audio.",
  "native.noTranscriptField": "The provider returned no transcript field.",
  "native.notWhisperModel":
    "The selected file is not a Whisper model (.bin in GGML format).",
  "native.unknownProvider": "Unknown model provider.",
  "native.unsupportedRate": "Unsupported PCM sample rate.",
  "native.engineUnavailable": "Speech engine unavailable",
  "native.modelPathRequired": "Provide a Whisper model path",
  "native.keyRejected":
    "The provider rejected this API key or model permission.",
  "native.needsCredits": "The provider account needs credits.",
  "native.rateLimited":
    "The provider is rate-limiting requests. Try again later.",
  "native.modelUnavailable":
    "The model or voice is unavailable, or does not support these options. Refresh the catalog and check the selection.",
  "native.requestFailed":
    "The provider request failed. Check the connection and try again.",
  "studio.segments.viewLabel": "Editor view",
  "studio.segments.viewText": "Text",
  "studio.segments.viewSegments": "Segments",
  "studio.segments.listLabel": "Transcript segments",
  "studio.segments.empty": "Record or type something to see it as segments.",
  "studio.segments.hint": "Tick segments to merge, split or label them.",
  "studio.segments.hintPlay":
    "Tick segments to merge, split or label them. Click a time to listen from there.",
  "studio.segments.merge": "Merge",
  "studio.segments.split": "Split",
  "studio.segments.splitTitle":
    "Splits where the cursor is, or in the middle. Ctrl + Enter also splits while you type.",
  "studio.segments.selected.one": "{count} segment selected",
  "studio.segments.selected.other": "{count} segments selected",
  "studio.segments.clearSelection": "Clear selection",
  "studio.segments.speakerForSelection": "Speaker for the selection",
  "studio.segments.applySpeaker": "Apply",
  "studio.segments.speakerPlaceholder": "Speaker",
  "studio.segments.select": "Select segment {number}",
  "studio.segments.speakerOf": "Speaker of segment {number}",
  "studio.segments.textOf": "Text of segment {number}",
  "studio.segments.moveUp": "Move segment {number} up",
  "studio.segments.moveDown": "Move segment {number} down",
  "studio.segments.playFrom": "Play from {time}",
  "studio.segments.pauseAt": "Pause at {time}",
  "studio.segments.approx": "Estimated time",
  "studio.segments.saveToLibrary": "Save to library",
  "studio.segments.saved": "Saved to your library.",
  "studio.segments.savedWithCopy":
    "Saved. This recording had changed on another device meanwhile: that version is kept as a conflict copy in your library.",
  "studio.library.listen": "Listen",
  "studio.library.pause": "Pause",
  "studio.library.synced": "Synced",
  "studio.library.noAudio": "The recording stays on the device that made it.",
  "studio.library.conflictOf": "Conflict copy of the note from {date}",
  "studio.library.conflictCopy": "Conflict copy",
  "studio.library.saveAudio": "Save audio",
  "native.audioGone":
    "The audio of this recording is no longer on this device.",
  "native.recordingGone": "This recording is no longer in your library.",
  "native.editTooLarge": "The edited transcript is too large to save.",
  "native.segmentOrder": "A segment ends before it starts.",
  "native.speakerTooLong": "Speaker names can have up to 80 characters.",
  "capture.recorderBehind":
    "The recorder is not keeping up with the microphone. The recording was stopped and saved.",
  "native.fourHourLimit": "The recording reached the four-hour limit.",
  "native.notInProgress": "This recording is no longer in progress.",
  "native.cannotReadRecording": "Cannot read recording: {reason}",
  "studio.transcribe.fileTooLargeApp": "Choose an audio file under 100 MB.",
  "studio.transcribe.reading": "Reading the audio file…",
  "studio.transcribe.progress": "Transcribing… {done} of {total}",
  "studio.mic.title": "Microphone",
  "studio.mic.meta": "Which input records your voice",
  "studio.mic.choose": "Record with",
  "studio.mic.systemDefault": "System default",
  "studio.mic.numbered": "Microphone {position}",
  "studio.mic.notConnected": "Chosen microphone (not connected)",
  "studio.mic.notConnectedHint":
    "The microphone you chose is not connected. Until it is back, recordings use the system default.",
  "studio.mic.namesHint":
    "Microphone names appear once access is allowed. Run a test to allow it.",
  "studio.mic.test": "Test microphone",
  "studio.mic.stopTest": "Stop test",
  "studio.mic.testHint":
    "Speak normally: the bar should move with your voice. Nothing is recorded.",
  "studio.mic.level": "Microphone level",
  "studio.mic.fellBack":
    "The chosen microphone is not connected, so the system default is used.",
  "toast.micFellBack":
    "Chosen microphone not found. Recording with the system default.",
  "studio.storage.format": "Save recordings as",
  "studio.storage.wav": "Speech quality (WAV, 16 kHz mono)",
  "studio.storage.opus": "Speech quality, compressed (Opus, 10× smaller)",
  "studio.storage.hq":
    "High quality (Opus, 48 kHz, stereo when the source has it)",
  "studio.storage.compressNow": "Compress saved recordings",
  "studio.storage.compressing": "Compressing…",
  "studio.storage.compressed.one":
    "{count} recording compressed, {size} freed.",
  "studio.storage.compressed.other":
    "{count} recordings compressed, {size} freed.",
  "studio.storage.nothingToCompress":
    "Every saved recording is already compressed.",
  "studio.storage.failed.one":
    "{count} recording could not be compressed and stays as it is.",
  "studio.storage.failed.other":
    "{count} recordings could not be compressed and stay as they are.",
  "studio.storage.savedOpus":
    "New recordings are compressed once they are transcribed. You can still play them and transcribe them again.",
  "studio.storage.savedWav":
    "New recordings are kept as WAV, in speech quality. Recordings already compressed stay compressed.",
  "studio.storage.savedHq":
    "New recordings are kept at 48 kHz, in stereo when the source has it. Imported files and older recordings are compressed in speech quality.",
  "studio.transcribe.liveLabel": "Heard so far",
  "capture.keptForRetry":
    "{error} The recording is in your Library, where you can transcribe it again.",
  "native.invalidCompressed": "Invalid compressed audio.",
  "native.cannotCompress": "Cannot write compressed audio: {reason}",
  "native.opusError": "Opus error: {reason}",
  "toast.shortcutsUnavailable":
    "The dictation shortcuts could not be set up. Another app may already use them.",
  "error.importInProgress":
    "An audio file is being transcribed. Record again once it has finished.",
  "studio.source.label": "Record from",
  "studio.source.microphone": "The microphone",
  "studio.source.system": "This computer's sound",
  "studio.source.systemHint":
    "The record button records what is playing on this computer, such as a meeting or a video. So does a dictation shortcut pressed while Sonolect is in front. Dictation into other apps and the bubble always use the microphone.",
  "studio.dock.recordingSystem": "Recording computer sound…",
  "native.noPlaybackDevice": "There is no playback device to record.",
  "native.playbackFormat": "Cannot read the playback format: {reason}",
  "native.playbackNoFormat": "The playback device reports no audio format.",
  "native.playbackUnsupported": "Unsupported playback format: {format}.",
  "native.systemAudioCannotStart":
    "Cannot start recording system audio: {reason}",
  "native.systemAudioCannotRecord": "Cannot record system audio: {reason}",
  "native.systemAudioStoppedReason": "System audio stopped: {reason}",
  "native.systemAudioStopped": "System audio stopped.",
  "native.systemAudioStoppedUnexpectedly": "System audio stopped unexpectedly.",
  "native.systemAudioDidNotStart": "System audio did not start.",
  "native.systemAudioUnavailable":
    "System audio capture is not available on this platform.",
  "native.systemRecorderCannotStart":
    "Cannot start the system audio recorder: {reason}",
  "native.systemRecorderCannotRead": "Cannot read the system audio recorder.",
  "native.noMonitorSource": "No PulseAudio monitor source found.",
  "native.pactlFailed": "pactl failed: {reason}",
  "native.systemAudioBusy": "System audio is unavailable.",
  "native.ffmpegNeeded": "ffmpeg is needed to record system audio.",
  "native.invalidPcmFormat": "Invalid audio rate or channel count.",
  "native.invalidPcmFrames": "Invalid 16-bit PCM audio or frame size.",
  "native.pcmFormatChanged": "The audio format changed during the recording.",
  "native.invalidQuality": "Invalid recording quality.",
  "native.cannotConvert": "Cannot convert the audio: {reason}",
  "native.syncNotAvailable":
    "Sync is not available in this version of Sonolect.",
  "native.syncKeychainLinux":
    "Sync is unavailable on this system: it keeps its key in a keychain (Secret Service, such as GNOME Keyring or KWallet), and none is running.",
  "native.syncKeychainUnavailable":
    "Sync is unavailable on this system: the keychain could not be opened.",
  "native.syncKeychainFailed":
    "The sync key could not be read or saved in the keychain.",
  "native.syncInvalidKey": "This is not a valid sync key.",
  "native.syncKeyExists":
    "Sync is already on with another key. Turn it off first.",
  "native.syncStateFailed": "The sync state could not be saved.",
  "native.syncInterrupted": "Sync was interrupted.",
  "native.syncInvalidNote": "Invalid synced note.",
  // Speaker detection
  "studio.speakers.detect": "Detect speakers",
  "studio.speakers.count": "Speakers",
  "studio.speakers.auto": "Auto",
  "studio.speakers.label": "Speaker {number}",
  "studio.speakers.consent":
    "Download the {size} speaker model? Your audio stays on this device.",
  "studio.speakers.download": "Download",
  "studio.speakers.notNow": "Not now",
  "studio.speakers.downloading": "Downloading the speaker model… {progress}%",
  "studio.speakers.keepOrReplace":
    "Some segments already have names. Keep them or replace them?",
  "studio.speakers.keep": "Keep names",
  "studio.speakers.replace": "Replace names",
  "studio.speakers.cancel": "Cancel",
  "studio.speakers.detecting": "Detecting speakers… {progress}%",
  "studio.speakers.found.one": "{count} speaker found.",
  "studio.speakers.found.other": "{count} speakers found.",
  "studio.speakers.noSpeech": "No speech was found in this recording.",
  "studio.speakers.stale":
    "Another transcript was opened, so no names were changed.",
  "studio.speakers.legend": "Speakers in this transcript",
  "studio.speakers.rename": "Rename {name} everywhere",
  "studio.speakers.segments.one": "{count} segment",
  "studio.speakers.segments.other": "{count} segments",
  "studio.settings.speakerModelTitle": "Speaker model",
  "studio.settings.speakerModelMeta": "Speaker detection · CPU",
  "studio.settings.speakerModelReady": "The speaker model is on this computer.",
  "studio.settings.speakerModelMissing":
    "Download it once to detect who speaks in a recording. Your audio stays on this device.",
  "studio.settings.speakerModelInstall": "Download speaker model",
  "studio.settings.speakerModelReinstall": "Reinstall speaker model",
  "studio.settings.speakerModelDownloaded":
    "Speaker model downloaded and checksum verified.",
  "native.speakersCancelled": "Speaker detection was cancelled.",
  "native.speakersBusy": "Speaker detection is already running.",
  "native.speakerCount": "Choose between 2 and 8 speakers.",
  "native.speakerModelMissing": "Download the speaker model first.",
  "native.speakerModelDamaged":
    "The speaker model was damaged and has been removed. Download it again.",
  "native.speakersStillRecording":
    "Finish the recording before detecting speakers.",
  "native.speakerModelUnreadable": "Cannot read the speaker model: {reason}",
  "native.speakerModelLoad": "Cannot load the speaker model: {reason}",
  "native.speakerModelFailed": "The speaker model failed: {reason}",
} as const;

export type LocaleKeys = keyof typeof en;
