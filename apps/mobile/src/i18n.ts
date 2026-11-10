import type { DictationLanguage, RefinementMode, UiLanguage } from "./domain";

const en = {
  tabs: {
    capture: "Capture",
    library: "Library",
    reader: "Reader",
    settings: "Settings",
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
    share: "Share",
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
    },
    actions: {
      downloadModel: "Download language",
      useServiceOnce: "Use speech service this time",
      alwaysAllow: "Always allow",
      openSettings: "Open Settings",
      dismiss: "Dismiss",
    },
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
    noMatch: "No transcripts match your search.",
    items: (n: number) => `${n} ${n === 1 ? "ITEM" : "ITEMS"}`,
    pin: "Pin",
    unpin: "Unpin",
    listen: "Listen",
    delete: "Delete",
    deleteConfirm: "Delete this transcript?",
    exportAll: "Export",
    sync: { local: "LOCAL", queued: "QUEUED", synced: "SYNCED" },
    original: "Original",
    typed: "TYPED",
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
        "Saves history. Uses the best recognizer available, on device or not.",
      local_first:
        "Saves history on this phone and asks for on-device recognition.",
      ephemeral:
        "Nothing is saved. Captures disappear when you leave the screen.",
    },
    allowSystemService:
      "Use the system speech service when on-device dictation isn't available",
    allowSystemServiceHelp:
      "Your audio may then be sent to Google or Apple. Off: Sonolect asks each time.",
    saveHistory: "Save history",
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
    eraseAll: "Erase all data",
    eraseConfirm: "Erase all Sonolect data on this phone?",
    about: "Sonolect mobile · local-first voice capture",
  },
  onboarding: {
    title: "Speak. Refine. Act.",
    body: "Sonolect turns your voice into clean text. It runs on your phone first, and nothing leaves it unless you connect the Sonolect API.",
    allow: "Allow microphone",
    continue: "Continue",
    skip: "Not now",
  },
  common: { cancel: "Cancel", confirm: "Confirm" },
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
    share: "Partager",
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
    },
    actions: {
      downloadModel: "Télécharger la langue",
      useServiceOnce: "Utiliser le service vocal cette fois",
      alwaysAllow: "Toujours autoriser",
      openSettings: "Ouvrir les réglages",
      dismiss: "Fermer",
    },
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
    noMatch: "Aucune transcription ne correspond.",
    items: (n: number) => `${n} ÉLÉMENT${n > 1 ? "S" : ""}`,
    pin: "Épingler",
    unpin: "Désépingler",
    listen: "Écouter",
    delete: "Supprimer",
    deleteConfirm: "Supprimer cette transcription ?",
    exportAll: "Exporter",
    sync: { local: "LOCAL", queued: "EN ATTENTE", synced: "SYNCHRONISÉ" },
    original: "Original",
    typed: "SAISI",
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
      standard: "Conserve l'historique. Utilise le meilleur moteur disponible.",
      local_first:
        "Conserve l'historique sur ce téléphone et privilégie la reconnaissance locale.",
      ephemeral:
        "Rien n'est enregistré. Les captures disparaissent en quittant l'écran.",
    },
    allowSystemService:
      "Utiliser le service vocal du système si la dictée sur l'appareil n'est pas disponible",
    allowSystemServiceHelp:
      "L'audio peut alors être envoyé à Google ou Apple. Désactivé : Sonolect demande à chaque fois.",
    saveHistory: "Conserver l'historique",
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
    eraseAll: "Effacer toutes les données",
    eraseConfirm: "Effacer toutes les données Sonolect de ce téléphone ?",
    about: "Sonolect mobile · capture vocale locale d'abord",
  },
  onboarding: {
    title: "Parlez. Raffinez. Agissez.",
    body: "Sonolect transforme votre voix en texte propre. Tout se passe d'abord sur votre téléphone, et rien n'en sort sauf si vous connectez l'API Sonolect.",
    allow: "Autoriser le micro",
    continue: "Continuer",
    skip: "Plus tard",
  },
  common: { cancel: "Annuler", confirm: "Confirmer" },
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
