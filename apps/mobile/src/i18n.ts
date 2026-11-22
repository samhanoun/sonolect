import type {
  DictationLanguage,
  RefinementMode,
  RetentionDays,
  UiLanguage,
} from "./domain";
import type { ExportFormat } from "./library";

const en = {
  tabs: {
    capture: "Capture",
    library: "Library",
    reader: "Reader",
    settings: "Settings",
    /** What VoiceOver reads for a tab: its name and its place in the bar. */
    a11yLabel: (name: string, position: number, total: number) =>
      `${name}, tab, ${position} of ${total}`,
  },
  brandTag: "VOICE OS · MOBILE",
  mode: {
    onDevice: "On device",
    deviceService: "System service",
    appleService: "Apple speech service",
    api: "Sonolect API",
  },
  capture: {
    idle: "READY",
    listening: "LISTENING",
    processing: "PROCESSING",
    ready: "CAPTURED",
    error: "ATTENTION",
    tapToSpeak: "Tap to speak",
    speak: "Speak",
    done: "Done",
    cancel: "Cancel",
    discardTitle: "Discard this dictation?",
    discard: "Discard",
    keepDictating: "Keep dictating",
    a11yStarted: "Dictation started",
    a11yStopped: "Dictation stopped",
    a11yResult: "Transcript ready.",
    liveTranscript: "Live transcript",
    hint: "Tap the mic and talk. Sonolect transcribes and cleans it up.",
    noSpeech: "No speech was detected. Try again a little closer to the mic.",
    unavailable:
      "Speech recognition isn't available here. Type your text below instead.",
    permissionDenied:
      "Microphone access is off. Turn it on in your phone's settings to dictate.",
    typeInstead: "Type instead",
    typePlaceholder: "Type or paste text to refine",
    saveTyped: "Save text",
    afterCapture: "REFINE LATEST",
    noCaptureYet: "Your latest capture appears here.",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Couldn't copy the text.",
    share: "Share",
    shareFailed: "Couldn't open the share sheet.",
    download: "Download",
    downloadFailed: "Couldn't save the note.",
    ephemeralNote: "Ephemeral mode: nothing is saved.",
    systemServiceNote:
      "Transcribed by your phone's speech service, which may send audio online (for example to Google).",
    appleServiceNote:
      "Transcribed by Apple's speech service, which may send audio to Apple.",
    needsModel:
      "Connect the Sonolect API in Settings for a full rewrite. Cleaned up locally for now.",
    refining: "Refining…",
    downloading: "Downloading…",
    notices: {
      modelMissing: (language: string) =>
        `On-device dictation in ${language} needs a language pack. Download it, or use the system speech service this time (it may send audio online).`,
      needsConsent: (language: string) =>
        `This phone can't dictate in ${language} on the device. The system speech service can, but it may send your audio online.`,
      modelInstalled: (language: string) =>
        `Language pack installed (${language}). Tap the mic to dictate.`,
      modelDialogOpened:
        "Follow the system prompt to download the language pack, then tap the mic again.",
      modelScheduled:
        "The language pack will download soon, possibly when you're on Wi-Fi. Tap the mic again once it's ready.",
      modelNotSupported:
        "This phone can't download that language pack. Use the speech service or type instead.",
      modelFailed:
        "The language pack couldn't be downloaded. Check your connection and try again.",
      micDenied: "Microphone access was not allowed. Tap the mic to try again.",
      speechDenied:
        "Speech Recognition is off for Sonolect. Turn it on in Settings to use the speech service.",
      speechRestricted:
        "Speech recognition is restricted on this iPhone (Screen Time or a device profile). You can still type.",
      network:
        "The speech service couldn't be reached. Check your connection and try again.",
      languageNotSupported: (language: string) =>
        `The speech service doesn't support ${language} on this phone. Pick another dictation language in Settings.`,
      busy: "The speech service is busy. Wait a moment and try again.",
      audioCapture:
        "The microphone couldn't be used. Close other apps that record audio and try again.",
      interrupted:
        "Dictation stopped because another app took over the audio. Your text so far was kept.",
      serviceNotAllowed:
        "The speech service refused the request. Check that dictation is enabled in your phone's settings, then try again.",
      startFailed: "Sonolect couldn't start listening. Try again.",
      generic: "Speech recognition stopped unexpectedly. Try again.",
      backgrounded:
        "Dictation stopped when Sonolect left the screen. Your text so far was kept.",
      maxDuration:
        "Dictation stopped after 10 minutes. Tap the mic to continue.",
      refineFailed:
        "Sonolect couldn't refine this note. It was kept as it was.",
      storageReadError:
        "Sonolect couldn't read your saved notes. Nothing was deleted. Restart the app to try again.",
      storageWriteError:
        "Your latest change couldn't be saved on this phone. Free up some storage and try again.",
    },
    actions: {
      downloadModel: "Download language",
      useServiceOnce: "Use speech service this time",
      alwaysAllow: "Always allow",
      openSettings: "Open Settings",
      dismiss: "Dismiss",
    },
  },
  /** Quick dictation (sonolect://dictate): listen, then copy for pasting. */
  dictate: {
    title: "Quick dictation",
    listening: "Listening…",
    polishing: "Polishing…",
    copied: "Copied",
    ready: "Ready to copy",
    failed: "Couldn't dictate",
    speakHint: "Speak naturally. Tap the orb when you're done.",
    tapToStart: "Tap the orb to start.",
    tapToFinish: "Tap to finish",
    a11yFinish: "Finish dictation",
    a11yStart: "Start dictation",
    pasteIos: "Go back to your app (top-left corner) and paste.",
    paste: "Switch back to your app and paste.",
    close: "Close",
  },
  modes: {
    dictate: "Clean up",
    rewrite: "Rewrite",
    summarize: "Summarize",
    reply: "Reply",
    task_creation: "Tasks",
  } satisfies Record<RefinementMode, string>,
  modeTag: {
    dictate: "CLEAN UP",
    rewrite: "REWRITE",
    summarize: "SUMMARY",
    reply: "REPLY",
    task_creation: "TASKS",
    translate: "TRANSLATE",
    command: "COMMAND",
    code: "CODE",
    meeting_notes: "MEETING",
  } as Record<string, string>,
  library: {
    title: "Library",
    search: "Search transcripts",
    filters: {
      all: "All",
      pinned: "Pinned",
      summaries: "Summaries",
      tasks: "Tasks",
    },
    empty: "Nothing here yet. Your captures will appear in this list.",
    historyOff:
      "History is off, so captures aren't kept. Turn it on in Settings.",
    noMatch: "No transcripts match your search.",
    items: (n: number) => `${n} ${n === 1 ? "ITEM" : "ITEMS"}`,
    pin: "Pin",
    unpin: "Unpin",
    listen: "Listen",
    delete: "Delete",
    deleteConfirm: "Delete this transcript?",
    exportAll: "Export",
    exportFailed: "Couldn't export your notes.",
    exportTitle: "Export notes",
    exportAs: "Export as",
    exportFormats: {
      markdown: "Markdown",
      text: "Plain text",
      json: "JSON",
    } satisfies Record<ExportFormat, string>,
    sync: { local: "LOCAL", queued: "QUEUED", synced: "SYNCED" },
    original: "Original",
    typed: "TYPED",
    /** A note sync kept when two devices changed it at once. */
    conflictCopy: "CONFLICT COPY",
    conflictCopyOf: (date: string) =>
      `Conflict copy of the note from ${date}: it was changed on two devices, and both versions are kept.`,
    conflictCopyOfGone:
      "Conflict copy of a note changed on two devices: both versions were kept.",
    expandHint: "Shows the whole transcript",
    collapseHint: "Shows less",
  },
  reader: {
    title: "Reader",
    subtitle: "Paste text and listen with your device voices.",
    text: "TEXT",
    placeholder: "Paste or type something to read aloud",
    speed: "SPEED",
    play: "Play",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    voice: "Voice",
    systemVoice: "System default",
    qualityEnhanced: "Enhanced",
    qualityStandard: "Standard",
    empty: "Add some text to listen to.",
    useLatest: "Use latest capture",
  },
  settings: {
    title: "Settings",
    privacy: "PRIVACY",
    privacyLevels: {
      standard: "Standard",
      local_first: "Local first",
      ephemeral: "Ephemeral",
    },
    privacyHelp: {
      standard:
        "Saves notes on this phone. Dictation uses the system speech service, which may send audio to Google or Apple.",
      local_first:
        "Saves notes on this phone and dictates on the device when it can. Sonolect asks before using an online speech service, unless you allowed it.",
      ephemeral:
        "Nothing is saved: captures disappear when Sonolect closes. Dictation stays on the device unless you allow the speech service.",
    },
    allowSystemService:
      "Use the system speech service when on-device dictation isn't available",
    allowSystemServiceHelp:
      "Your audio may then be sent to Google or Apple. Off: Sonolect asks each time.",
    saveHistory: "Save history",
    retention: "KEEP NOTES FOR",
    retentionChoices: {
      0: "Forever",
      1: "1 day",
      7: "7 days",
      30: "30 days",
      90: "90 days",
    } satisfies Record<RetentionDays, string>,
    retentionHelp: (days: RetentionDays) =>
      days === 0
        ? "Notes stay on this phone until you delete them."
        : `Notes older than ${days === 1 ? "1 day" : `${days} days`} are deleted automatically. Pinned notes are kept.`,
    retentionTitle: "Delete older notes?",
    retentionMessage: (n: number, days: RetentionDays) =>
      `This deletes ${n} ${n === 1 ? "note" : "notes"} older than ${days === 1 ? "1 day" : `${days} days`} now. Pinned notes are kept.`,
    haptics: "Haptics",
    sync: "Sync with Sonolect API",
    dictation: "DICTATION LANGUAGE",
    interface: "APP LANGUAGE",
    api: "SONOLECT API",
    apiUrl: "API URL",
    apiToken: "Access token (optional)",
    apiNotSet: "Not set. Everything stays on this device.",
    apiInvalid: "Use https://, or http:// on your local network.",
    apiSaved: "Saved.",
    test: "Test connection",
    testing: "Testing…",
    testOk: "Connected.",
    testFail: "Couldn't reach the API.",
    save: "Save",
    dictionary: "DICTIONARY",
    dictionaryHelp: "Fix words the recognizer gets wrong.",
    spoken: "When I say",
    written: "Write",
    snippets: "SNIPPETS",
    snippetsHelp: "Say a trigger phrase to insert longer text.",
    trigger: "Trigger",
    body: "Text",
    add: "Add",
    remove: "Remove",
    data: "DATA",
    clearHistory: "Clear history",
    clearHistoryTitle: "Clear history?",
    clearButton: "Delete",
    historyOffTitle: "Turn off saved history?",
    ephemeralTitle: "Switch to Ephemeral?",
    deleteNotesMessage: (n: number) =>
      `This deletes ${n} ${n === 1 ? "note" : "notes"} saved on this phone.`,
    deleteNotes: "Delete notes",
    eraseAll: "Erase all data",
    eraseTitle: "Erase all data?",
    eraseMessage:
      "All Sonolect data on this phone will be erased. This can't be undone.",
    eraseButton: "Erase",
    about: "Sonolect mobile · your notes stay on this phone",
    privacyPolicy: "Privacy policy",
    /** The "Dictate in any app" card. */
    voiceKeyboard: {
      title: "Dictate in any app",
      enable:
        "Turn on “Sonolect voice” in your keyboard settings, then come back.",
      select:
        "Switch to the Sonolect voice keyboard in any text field, or here.",
      ready:
        "Sonolect voice is your keyboard. Tap its mic in any app and speak.",
      onDevice: "Speech is recognized on this phone.",
      systemService:
        "This phone has no on-device recognizer, so the keyboard uses the system speech service, which may send audio online.",
      needsService:
        "This phone has no on-device recognizer. To dictate with the keyboard, allow the system speech service under Privacy.",
      openKeyboardSettings: "Open keyboard settings",
      changeKeyboard: "Change keyboard",
      switchKeyboard: "Switch keyboard",
      quickIos:
        "iPhone keyboards can't use the microphone, so Sonolect uses Quick dictation: it opens straight into listening, then copies your words so you can paste them where you were.",
      quick:
        "Quick dictation opens straight into listening, then copies your words so you can paste them anywhere.",
      shortcutTip:
        "Tip: in Shortcuts, add “Open URLs” with sonolect://dictate and assign it to the Action button or Back Tap.",
      tryQuick: "Try Quick dictation",
    },
  },
  /** Sync (Settings and the join link); only builds with a sync server show it. */
  sync: {
    title: "SYNC",
    intro:
      "Sync your notes with your other devices, end-to-end encrypted. Recordings don't sync.",
    shareWarning: "Joining shares every note with whoever holds the code.",
    turnOn: "Turn on sync",
    join: "Join with a code",
    codeLabel: "Sync code",
    codePlaceholder: "Paste or type the 56-character code",
    codeNext: "Next",
    showCode: "Show sync code",
    hideCode: "Hide sync code",
    codeHelp:
      "Scan this QR code with your other phone, or type the code there.",
    qrLabel: "QR code to join this sync",
    turnOff: "Turn off sync",
    turnOffTitle: "Turn off sync?",
    turnOffMessage:
      "Your notes stay on this phone. Keep the server copy for your other devices, or delete it: they then stop syncing and keep their notes.",
    keepServerCopy: "Keep server copy",
    deleteServerCopy: "Delete server copy",
    deleteFailed:
      "The server copy could not be deleted. Check your connection and try again.",
    syncing: "Syncing…",
    never: "Not synced yet.",
    lastSync: (time: string) => `Last synced ${time}.`,
    paused: {
      historyOff: "Paused while Save history is off.",
      storage: "Paused: some notes on this phone could not be read.",
    },
    problems: {
      unauthorized: "This sync key is not accepted by the server.",
      deleted: "This sync was deleted.",
      tooLarge: "A note is too large to sync.",
      server: "Sync is unavailable right now.",
      network: "Offline. Notes will sync when you're back online.",
      quotaExceeded: "Sync storage is full. Delete notes to sync new ones.",
      newerSchema: "Update Sonolect to sync every note.",
    },
    pairingErrors: {
      invalid: "This is not a Sonolect sync code.",
      version: "Update Sonolect to use this code.",
      length: "Check the code: it has 56 characters.",
      typo: "A character is wrong.",
    },
    joinScreenTitle: "Join sync",
    joinTitle: "Join this sync?",
    joinNotes: (n: number) =>
      n === 0
        ? "This phone has no notes to copy yet."
        : `This phone's ${n === 1 ? "note" : `${n} notes`} will be copied into this sync.`,
    joinInvalidTitle: "This link can't be used",
    joinConfirm: "Join",
    alreadyJoined: "This phone already uses this sync.",
    otherVaultOn: "Sync is already on. Turn it off to join another sync.",
    openSettings: "Open Settings",
    eraseMessage:
      "All Sonolect data on this phone will be erased. This can't be undone. Delete the server copy too, and your other devices stop syncing.",
    eraseDeleteServerCopy: "Erase and delete server copy",
    eraseThisPhone: "Erase this phone only",
    clearEverywhere: "They are deleted on your other devices too.",
    about: "Sonolect mobile · your notes sync end-to-end encrypted",
  },
  onboarding: {
    title: "Speak. Refine. Act.",
    body: "Sonolect turns your voice into clean text. Your notes stay on this phone. When on-device dictation isn't available, Sonolect asks before using the system speech service, which may send audio to Google or Apple.",
    allow: "Allow microphone",
    continue: "Continue",
    skip: "Not now",
  },
  common: { cancel: "Cancel", confirm: "Confirm" },
  errorBoundary: {
    title: "Something went wrong",
    body: "Sonolect hit an unexpected problem. Your notes are still on this phone.",
    tryAgain: "Try again",
    deleteNotes: "Delete saved notes",
    deleteNotesTitle: "Delete all saved notes?",
    deleteNotesMessage:
      "Every note saved on this phone will be deleted. This can't be undone.",
  },
  /** Language names used inside sentences. */
  languageNames: {
    "en-US": "English",
    "fr-FR": "French",
    "es-ES": "Spanish",
    "de-DE": "German",
    "ar-SA": "Arabic",
  } satisfies Record<DictationLanguage, string>,
};

type Strings = typeof en;

const fr: Strings = {
  tabs: {
    capture: "Capture",
    library: "Bibliothèque",
    reader: "Lecture",
    settings: "Réglages",
    a11yLabel: (name: string, position: number, total: number) =>
      `${name}, onglet, ${position} sur ${total}`,
  },
  brandTag: "VOICE OS · MOBILE",
  mode: {
    onDevice: "Sur l'appareil",
    deviceService: "Service système",
    appleService: "Service vocal d'Apple",
    api: "API Sonolect",
  },
  capture: {
    idle: "PRÊT",
    listening: "ÉCOUTE",
    processing: "TRAITEMENT",
    ready: "CAPTURÉ",
    error: "ATTENTION",
    tapToSpeak: "Touchez pour parler",
    speak: "Parler",
    done: "Terminer",
    cancel: "Annuler",
    discardTitle: "Supprimer cette dictée ?",
    discard: "Supprimer",
    keepDictating: "Continuer la dictée",
    a11yStarted: "Dictée démarrée",
    a11yStopped: "Dictée arrêtée",
    a11yResult: "Transcription prête.",
    liveTranscript: "Transcription en direct",
    hint: "Touchez le micro et parlez. Sonolect transcrit et nettoie le texte.",
    noSpeech: "Aucune parole détectée. Réessayez plus près du micro.",
    unavailable:
      "La reconnaissance vocale n'est pas disponible ici. Saisissez votre texte ci-dessous.",
    permissionDenied:
      "L'accès au micro est désactivé. Activez-le dans les réglages du téléphone.",
    typeInstead: "Saisir du texte",
    typePlaceholder: "Saisissez ou collez un texte à raffiner",
    saveTyped: "Enregistrer",
    afterCapture: "RAFFINER LA DERNIÈRE",
    noCaptureYet: "Votre dernière capture s'affiche ici.",
    copy: "Copier",
    copied: "Copié",
    copyFailed: "Impossible de copier le texte.",
    share: "Partager",
    shareFailed: "Impossible d'ouvrir le partage.",
    download: "Télécharger",
    downloadFailed: "Impossible d'enregistrer la note.",
    ephemeralNote: "Mode éphémère : rien n'est enregistré.",
    systemServiceNote:
      "Transcription par le service vocal du téléphone, qui peut envoyer l'audio en ligne (par exemple à Google).",
    appleServiceNote:
      "Transcription par le service vocal d'Apple, qui peut envoyer l'audio à Apple.",
    needsModel:
      "Connectez l'API Sonolect dans Réglages pour une vraie réécriture. Nettoyé localement pour l'instant.",
    refining: "Raffinage…",
    downloading: "Téléchargement…",
    notices: {
      modelMissing: (language: string) =>
        `La dictée sur l'appareil en ${language} nécessite un pack de langue. Téléchargez-le, ou utilisez cette fois le service vocal du système (il peut envoyer l'audio en ligne).`,
      needsConsent: (language: string) =>
        `Ce téléphone ne peut pas dicter en ${language} sur l'appareil. Le service vocal du système le peut, mais il peut envoyer votre audio en ligne.`,
      modelInstalled: (language: string) =>
        `Pack de langue installé (${language}). Touchez le micro pour dicter.`,
      modelDialogOpened:
        "Suivez l'invite du système pour télécharger le pack de langue, puis touchez de nouveau le micro.",
      modelScheduled:
        "Le pack de langue sera bientôt téléchargé, peut-être une fois connecté au Wi-Fi. Touchez de nouveau le micro quand il sera prêt.",
      modelNotSupported:
        "Ce téléphone ne peut pas télécharger ce pack de langue. Utilisez le service vocal ou saisissez votre texte.",
      modelFailed:
        "Le pack de langue n'a pas pu être téléchargé. Vérifiez votre connexion et réessayez.",
      micDenied:
        "L'accès au micro n'a pas été autorisé. Touchez le micro pour réessayer.",
      speechDenied:
        "La reconnaissance vocale est désactivée pour Sonolect. Activez-la dans Réglages pour utiliser le service vocal.",
      speechRestricted:
        "La reconnaissance vocale est limitée sur cet iPhone (Temps d'écran ou profil de l'appareil). Vous pouvez toujours saisir votre texte.",
      network:
        "Le service vocal est injoignable. Vérifiez votre connexion et réessayez.",
      languageNotSupported: (language: string) =>
        `Le service vocal de ce téléphone ne prend pas en charge cette langue (${language}). Choisissez une autre langue de dictée dans Réglages.`,
      busy: "Le service vocal est occupé. Patientez un instant et réessayez.",
      audioCapture:
        "Le micro n'a pas pu être utilisé. Fermez les autres applications qui enregistrent du son et réessayez.",
      interrupted:
        "La dictée s'est arrêtée car une autre application a pris le contrôle de l'audio. Le texte déjà dicté a été conservé.",
      serviceNotAllowed:
        "Le service vocal a refusé la demande. Vérifiez que la dictée est activée dans les réglages du téléphone, puis réessayez.",
      startFailed: "Sonolect n'a pas pu démarrer l'écoute. Réessayez.",
      generic:
        "La reconnaissance vocale s'est arrêtée de façon inattendue. Réessayez.",
      backgrounded:
        "La dictée s'est arrêtée quand Sonolect a quitté l'écran. Le texte déjà dicté a été conservé.",
      maxDuration:
        "La dictée s'est arrêtée après 10 minutes. Touchez le micro pour continuer.",
      refineFailed:
        "Sonolect n'a pas pu raffiner cette note. Elle est restée inchangée.",
      storageReadError:
        "Sonolect n'a pas pu lire vos notes enregistrées. Rien n'a été supprimé. Redémarrez l'app pour réessayer.",
      storageWriteError:
        "Votre dernière modification n'a pas pu être enregistrée sur ce téléphone. Libérez de l'espace et réessayez.",
    },
    actions: {
      downloadModel: "Télécharger la langue",
      useServiceOnce: "Utiliser le service vocal cette fois",
      alwaysAllow: "Toujours autoriser",
      openSettings: "Ouvrir les réglages",
      dismiss: "Fermer",
    },
  },
  dictate: {
    title: "Dictée rapide",
    listening: "Écoute…",
    polishing: "Mise en forme…",
    copied: "Copié",
    ready: "Prêt à copier",
    failed: "Dictée impossible",
    speakHint: "Parlez naturellement. Touchez l'orbe quand vous avez terminé.",
    tapToStart: "Touchez l'orbe pour commencer.",
    tapToFinish: "Touchez pour terminer",
    a11yFinish: "Terminer la dictée",
    a11yStart: "Démarrer la dictée",
    pasteIos: "Revenez à votre app (en haut à gauche) et collez.",
    paste: "Revenez à votre app et collez.",
    close: "Fermer",
  },
  modes: {
    dictate: "Nettoyer",
    rewrite: "Réécrire",
    summarize: "Résumer",
    reply: "Répondre",
    task_creation: "Tâches",
  },
  modeTag: {
    dictate: "NETTOYÉ",
    rewrite: "RÉÉCRIT",
    summarize: "RÉSUMÉ",
    reply: "RÉPONSE",
    task_creation: "TÂCHES",
    translate: "TRADUCTION",
    command: "COMMANDE",
    code: "CODE",
    meeting_notes: "RÉUNION",
  },
  library: {
    title: "Bibliothèque",
    search: "Rechercher",
    filters: {
      all: "Tout",
      pinned: "Épinglés",
      summaries: "Résumés",
      tasks: "Tâches",
    },
    empty: "Rien pour l'instant. Vos captures apparaîtront ici.",
    historyOff:
      "L'historique est désactivé : les captures ne sont pas conservées. Activez-le dans Réglages.",
    noMatch: "Aucune transcription ne correspond.",
    items: (n: number) => `${n} ÉLÉMENT${n > 1 ? "S" : ""}`,
    pin: "Épingler",
    unpin: "Désépingler",
    listen: "Écouter",
    delete: "Supprimer",
    deleteConfirm: "Supprimer cette transcription ?",
    exportAll: "Exporter",
    exportFailed: "Impossible d'exporter vos notes.",
    exportTitle: "Exporter les notes",
    exportAs: "Exporter en",
    exportFormats: {
      markdown: "Markdown",
      text: "Texte brut",
      json: "JSON",
    },
    sync: { local: "LOCAL", queued: "EN ATTENTE", synced: "SYNCHRONISÉ" },
    original: "Original",
    typed: "SAISI",
    conflictCopy: "COPIE EN CONFLIT",
    conflictCopyOf: (date: string) =>
      `Copie en conflit de la note du ${date} : elle a été modifiée sur deux appareils, et les deux versions sont conservées.`,
    conflictCopyOfGone:
      "Copie en conflit d'une note modifiée sur deux appareils : les deux versions ont été conservées.",
    expandHint: "Affiche toute la transcription",
    collapseHint: "Affiche moins",
  },
  reader: {
    title: "Lecture",
    subtitle: "Collez un texte et écoutez-le avec les voix de l'appareil.",
    text: "TEXTE",
    placeholder: "Collez ou saisissez un texte à lire",
    speed: "VITESSE",
    play: "Lire",
    pause: "Pause",
    resume: "Reprendre",
    stop: "Arrêter",
    voice: "Voix",
    systemVoice: "Voix par défaut",
    qualityEnhanced: "Améliorée",
    qualityStandard: "Standard",
    empty: "Ajoutez un texte à écouter.",
    useLatest: "Utiliser la dernière capture",
  },
  settings: {
    title: "Réglages",
    privacy: "CONFIDENTIALITÉ",
    privacyLevels: {
      standard: "Standard",
      local_first: "Local d'abord",
      ephemeral: "Éphémère",
    },
    privacyHelp: {
      standard:
        "Enregistre les notes sur ce téléphone. La dictée utilise le service vocal du système, qui peut envoyer l'audio à Google ou Apple.",
      local_first:
        "Enregistre les notes sur ce téléphone et dicte sur l'appareil quand c'est possible. Sonolect demande avant d'utiliser un service vocal en ligne, sauf si vous l'avez autorisé.",
      ephemeral:
        "Rien n'est enregistré : les captures disparaissent à la fermeture de Sonolect. La dictée reste sur l'appareil sauf si vous autorisez le service vocal.",
    },
    allowSystemService:
      "Utiliser le service vocal du système si la dictée sur l'appareil n'est pas disponible",
    allowSystemServiceHelp:
      "L'audio peut alors être envoyé à Google ou Apple. Désactivé : Sonolect demande à chaque fois.",
    saveHistory: "Conserver l'historique",
    retention: "CONSERVER LES NOTES",
    retentionChoices: {
      0: "Toujours",
      1: "1 jour",
      7: "7 jours",
      30: "30 jours",
      90: "90 jours",
    },
    retentionHelp: (days: RetentionDays) =>
      days === 0
        ? "Les notes restent sur ce téléphone jusqu'à ce que vous les supprimiez."
        : `Les notes de plus de ${days === 1 ? "1 jour" : `${days} jours`} sont supprimées automatiquement. Les notes épinglées sont conservées.`,
    retentionTitle: "Supprimer les anciennes notes ?",
    retentionMessage: (n: number, days: RetentionDays) =>
      `Cela supprime maintenant ${n} ${n === 1 ? "note" : "notes"} de plus de ${days === 1 ? "1 jour" : `${days} jours`}. Les notes épinglées sont conservées.`,
    haptics: "Retour haptique",
    sync: "Synchroniser avec l'API Sonolect",
    dictation: "LANGUE DE DICTÉE",
    interface: "LANGUE DE L'APP",
    api: "API SONOLECT",
    apiUrl: "URL de l'API",
    apiToken: "Jeton d'accès (facultatif)",
    apiNotSet: "Non configurée. Tout reste sur cet appareil.",
    apiInvalid: "Utilisez https://, ou http:// sur votre réseau local.",
    apiSaved: "Enregistré.",
    test: "Tester la connexion",
    testing: "Test…",
    testOk: "Connecté.",
    testFail: "API injoignable.",
    save: "Enregistrer",
    dictionary: "DICTIONNAIRE",
    dictionaryHelp: "Corrigez les mots mal reconnus.",
    spoken: "Quand je dis",
    written: "Écrire",
    snippets: "EXTRAITS",
    snippetsHelp: "Dites un déclencheur pour insérer un texte plus long.",
    trigger: "Déclencheur",
    body: "Texte",
    add: "Ajouter",
    remove: "Retirer",
    data: "DONNÉES",
    clearHistory: "Effacer l'historique",
    clearHistoryTitle: "Effacer l'historique ?",
    clearButton: "Supprimer",
    historyOffTitle: "Désactiver l'historique ?",
    ephemeralTitle: "Passer en mode éphémère ?",
    deleteNotesMessage: (n: number) =>
      `Cela supprime ${n} note${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""} sur ce téléphone.`,
    deleteNotes: "Supprimer les notes",
    eraseAll: "Effacer toutes les données",
    eraseTitle: "Effacer toutes les données ?",
    eraseMessage:
      "Toutes les données Sonolect de ce téléphone seront effacées. Cette action est irréversible.",
    eraseButton: "Effacer",
    about: "Sonolect mobile · vos notes restent sur ce téléphone",
    privacyPolicy: "Politique de confidentialité",
    voiceKeyboard: {
      title: "Dicter dans toutes les apps",
      enable:
        "Activez « Sonolect voice » dans les réglages du clavier, puis revenez.",
      select:
        "Choisissez le clavier Sonolect voice dans n'importe quel champ de texte, ou ici.",
      ready:
        "Sonolect voice est votre clavier. Touchez son micro dans n'importe quelle app et parlez.",
      onDevice: "La parole est reconnue sur ce téléphone.",
      systemService:
        "Ce téléphone n'a pas de reconnaissance vocale sur l'appareil : le clavier utilise donc le service vocal du système, qui peut envoyer l'audio en ligne.",
      needsService:
        "Ce téléphone n'a pas de reconnaissance vocale sur l'appareil. Pour dicter avec le clavier, autorisez le service vocal du système dans Confidentialité.",
      openKeyboardSettings: "Ouvrir les réglages du clavier",
      changeKeyboard: "Changer de clavier",
      switchKeyboard: "Choisir le clavier",
      quickIos:
        "Les claviers de l'iPhone ne peuvent pas utiliser le micro : Sonolect propose donc la dictée rapide. Elle écoute dès l'ouverture, puis copie vos mots pour que vous les colliez là où vous étiez.",
      quick:
        "La dictée rapide écoute dès l'ouverture, puis copie vos mots pour que vous les colliez où vous voulez.",
      shortcutTip:
        "Astuce : dans Raccourcis, ajoutez « Ouvrir les URL » avec sonolect://dictate et associez-le au bouton Action ou à « Toucher le dos de l'appareil ».",
      tryQuick: "Essayer la dictée rapide",
    },
  },
  sync: {
    title: "SYNCHRONISATION",
    intro:
      "Synchronisez vos notes avec vos autres appareils, chiffrées de bout en bout. Les enregistrements ne sont pas synchronisés.",
    shareWarning:
      "Rejoindre partage toutes les notes avec quiconque détient le code.",
    turnOn: "Activer la synchronisation",
    join: "Rejoindre avec un code",
    codeLabel: "Code de synchronisation",
    codePlaceholder: "Collez ou saisissez le code de 56 caractères",
    codeNext: "Suivant",
    showCode: "Afficher le code",
    hideCode: "Masquer le code",
    codeHelp:
      "Scannez ce QR code avec votre autre téléphone, ou saisissez-y le code.",
    qrLabel: "QR code pour rejoindre cette synchronisation",
    turnOff: "Désactiver la synchronisation",
    turnOffTitle: "Désactiver la synchronisation ?",
    turnOffMessage:
      "Vos notes restent sur ce téléphone. Gardez la copie du serveur pour vos autres appareils, ou supprimez-la : ils arrêtent alors de synchroniser et gardent leurs notes.",
    keepServerCopy: "Garder la copie du serveur",
    deleteServerCopy: "Supprimer la copie du serveur",
    deleteFailed:
      "La copie du serveur n'a pas pu être supprimée. Vérifiez votre connexion et réessayez.",
    syncing: "Synchronisation…",
    never: "Pas encore synchronisé.",
    lastSync: (time: string) => `Dernière synchronisation : ${time}.`,
    paused: {
      historyOff: "En pause tant que l'historique est désactivé.",
      storage:
        "En pause : certaines notes de ce téléphone n'ont pas pu être lues.",
    },
    problems: {
      unauthorized: "Le serveur n'accepte pas cette clé de synchronisation.",
      deleted: "Cette synchronisation a été supprimée.",
      tooLarge: "Une note est trop volumineuse pour être synchronisée.",
      server: "La synchronisation est indisponible pour le moment.",
      network:
        "Hors ligne. Les notes se synchroniseront dès votre retour en ligne.",
      quotaExceeded:
        "L'espace de synchronisation est plein. Supprimez des notes pour en synchroniser de nouvelles.",
      newerSchema: "Mettez Sonolect à jour pour synchroniser toutes les notes.",
    },
    pairingErrors: {
      invalid: "Ce n'est pas un code de synchronisation Sonolect.",
      version: "Mettez Sonolect à jour pour utiliser ce code.",
      length: "Vérifiez le code : il compte 56 caractères.",
      typo: "Un caractère est erroné.",
    },
    joinScreenTitle: "Rejoindre la synchronisation",
    joinTitle: "Rejoindre cette synchronisation ?",
    joinNotes: (n: number) =>
      n === 0
        ? "Ce téléphone n'a pas encore de notes à copier."
        : n === 1
          ? "La note de ce téléphone sera copiée dans cette synchronisation."
          : `Les ${n} notes de ce téléphone seront copiées dans cette synchronisation.`,
    joinInvalidTitle: "Ce lien ne peut pas être utilisé",
    joinConfirm: "Rejoindre",
    alreadyJoined: "Ce téléphone utilise déjà cette synchronisation.",
    otherVaultOn:
      "La synchronisation est déjà activée. Désactivez-la pour en rejoindre une autre.",
    openSettings: "Ouvrir les réglages",
    eraseMessage:
      "Toutes les données Sonolect de ce téléphone seront effacées. C'est irréversible. Supprimez aussi la copie du serveur, et vos autres appareils arrêtent de synchroniser.",
    eraseDeleteServerCopy: "Effacer et supprimer la copie du serveur",
    eraseThisPhone: "Effacer ce téléphone seulement",
    clearEverywhere: "Elles sont aussi supprimées sur vos autres appareils.",
    about:
      "Sonolect mobile · vos notes se synchronisent chiffrées de bout en bout",
  },
  onboarding: {
    title: "Parlez. Raffinez. Agissez.",
    body: "Sonolect transforme votre voix en texte propre. Vos notes restent sur ce téléphone. Si la dictée sur l'appareil n'est pas disponible, Sonolect vous demande avant d'utiliser le service vocal du système, qui peut envoyer l'audio à Google ou Apple.",
    allow: "Autoriser le micro",
    continue: "Continuer",
    skip: "Plus tard",
  },
  common: { cancel: "Annuler", confirm: "Confirmer" },
  errorBoundary: {
    title: "Une erreur s'est produite",
    body: "Sonolect a rencontré un problème inattendu. Vos notes sont toujours sur ce téléphone.",
    tryAgain: "Réessayer",
    deleteNotes: "Supprimer les notes enregistrées",
    deleteNotesTitle: "Supprimer toutes les notes ?",
    deleteNotesMessage:
      "Toutes les notes enregistrées sur ce téléphone seront supprimées. Cette action est irréversible.",
  },
  languageNames: {
    "en-US": "anglais",
    "fr-FR": "français",
    "es-ES": "espagnol",
    "de-DE": "allemand",
    "ar-SA": "arabe",
  },
};

export const STRINGS: Record<UiLanguage, Strings> = { en, fr };
export type { Strings };

export function strings(language: UiLanguage): Strings {
  return STRINGS[language] ?? en;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English",
  "fr-FR": "Français",
  "es-ES": "Español",
  "de-DE": "Deutsch",
  "ar-SA": "العربية",
};
