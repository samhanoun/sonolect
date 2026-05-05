import type { LocaleKeys } from "./en";

export const fr: Record<LocaleKeys, string> = {
  // Navigation
  "nav.today": "Aujourd'hui",
  "nav.history": "Historique",
  "nav.agents": "Agents",
  "nav.settings": "Réglages",
  "nav.home": "Accueil",
  "nav.snippets": "Extraits",
  "nav.transforms": "Transformations",

  // Sidebar
  "sidebar.recordNow": "Parler maintenant",
  "sidebar.lastDictations": "Dernières dictées",
  "sidebar.loadingHistory": "Chargement de l'historique…",

  // TopBar
  "topbar.eyebrow": "Shell desktop premium",
  "topbar.headline": "Capture vocale → texte → actions",
  "topbar.searchCommand": "Rechercher une commande",
  "topbar.localFirst": "Local-first",
  "topbar.cloudAssisted": "Cloud assisté",
  "topbar.apiReady": "API prête",
  "topbar.offline": "Offline",

  // Welcome / Home
  "home.welcome": "Bon retour",
  "home.banner": "Votre espace voix-first est prêt.",
  "home.noTranscripts":
    "Aucune transcription pour le moment. Appuyez sur Enregistrer pour commencer.",
  "home.backToTimeline": "← Retour",

  // Stats
  "stats.title": "Aperçu",
  "stats.totalWords": "Mots au total",
  "stats.wpm": "MPM",
  "stats.dayStreak": "Jours consécutifs",

  // Editor
  "editor.eyebrow": "Transcription éditable",
  "editor.fallbackTitle": "Brief vocal enrichi",
  "editor.modeSummary": "Résumé",
  "editor.modeEmail": "Email",
  "editor.modeTicket": "Ticket",
  "editor.voiceCanvas": "Realtime voice canvas",
  "editor.voiceCanvasSubtitle":
    "Capture, transcription locale et transformation agentique.",
  "editor.wordCount": "mots",
  "editor.language": "Langue : Français",
  "editor.transformCta": "Transformer avec Sonolect",
  "editor.textareaLabel": "Éditeur de transcription",
  "editor.draftRestored":
    "Brouillon local non sauvegardé restauré après redémarrage.",
  "editor.historyControls": "Contrôles d'historique d'édition de transcription",
  "editor.undo": "Annuler",
  "editor.redo": "Rétablir",

  // Segment editor
  "segments.ariaLabel": "Éditeur de segments de transcription",
  "segments.title": "Segments",
  "segments.count": "segments",
  "segments.merge": "Fusionner la sélection",
  "segments.split": "Diviser la sélection",
  "segments.empty":
    "Saisissez une transcription pour créer des segments éditables.",
  "segments.segment": "Segment",
  "segments.speaker": "Intervenant",
  "segments.speakerPlaceholder": "Libellé intervenant",
  "segments.textLabel": "Texte du segment",

  // Privacy / Settings
  "privacy.title": "Confidentialité",
  "privacy.heading": "Contrôle de la voix",
  "privacy.description":
    "Choisissez où les captures audio et brouillons de transcription sont traités.",
  "privacy.local": "Local",
  "privacy.cloud": "Cloud",
  "privacy.autoDelete": "Suppression automatique après 24h",
  "privacy.maskNames": "Masquage des noms propres sensibles",
  "privacy.exportTextOnly": "Export texte uniquement sur demande",
  "privacy.ariaLabel": "Mode de confidentialité",
  "settings.localApi.title": "API locale",
  "settings.localApi.description":
    "Sonolect peut envoyer les captures vers une API HTTP locale, ou rester hors ligne quand aucune URL n'est configurée.",
  "settings.localApi.url": "URL configurée",
  "settings.localApi.configured":
    "L'envoi vers l'API locale est activé pour les nouvelles captures.",
  "settings.localApi.offline":
    "Aucune URL d'API n'est configurée ; les captures restent locales/offline.",
  "settings.whisper.title": "Configuration Whisper locale",
  "settings.whisper.description":
    "Utilisez votre propre wrapper whisper.cpp, OpenAI Whisper ou faster-whisper. Sonolect stocke uniquement les réglages de commande ; aucun gros modèle n'est inclus.",
  "settings.whisper.install":
    "Installez un binaire Whisper-compatible ou un wrapper Python sur cet ordinateur.",
  "settings.whisper.download":
    "Téléchargez vous-même un fichier modèle et gardez-le dans un dossier local que vous contrôlez.",
  "settings.whisper.env":
    "Démarrez l'app desktop avec cette variable d'environnement définie sur le JSON argv ci-dessous",
  "settings.whisper.modelPath": "Chemin du modèle ou identifiant",
  "settings.whisper.modelName": "Libellé du modèle",
  "settings.whisper.commandArgs": "JSON des arguments de commande",
  "settings.whisper.saveCommand": "Enregistrer la commande",
  "settings.whisper.validate": "Valider la configuration",
  "settings.whisper.status": "Statut",
  "settings.whisper.preview": "Aperçu",
  "settings.whisper.envValue": "Valeur env",
  "settings.whisper.commandJsonInvalid":
    "Les arguments doivent être un tableau JSON de chaînes valide.",
  "settings.whisper.commandSaved": "Commande Whisper enregistrée localement.",

  // Agent Actions
  "agents.title": "Actions agentiques",
  "agents.preview": "Prévisualiser",
  "agents.notion.title": "Créer une note Notion",
  "agents.notion.description":
    "Publie le compte-rendu structuré avec décisions, risques et prochaines étapes.",
  "agents.linear.title": "Ouvrir 3 tickets Linear",
  "agents.linear.description":
    "Découpe la transcription en issues avec priorités, labels et responsables proposés.",
  "agents.mail.title": "Rédiger un email premium",
  "agents.mail.description":
    "Convertit le brouillon vocal en message clair, chaleureux et prêt à envoyer.",

  // Voice Recorder Overlay
  "recorder.ariaLabel": "Enregistreur vocal Sonolect",
  "recorder.close": "Fermer",
  "recorder.stopCapture": "Terminer la capture",
  "recorder.newCapture": "Nouvelle capture",
  "recorder.listenDownload": "Écouter / télécharger",
  "recorder.kb": "Ko",

  // Voice state copy
  "voice.permission.eyebrow": "Permission micro",
  "voice.permission.title": "Autorisez l'accès au microphone",
  "voice.permission.detail":
    "Sonolect demande navigator.mediaDevices.getUserMedia({ audio: true }).",
  "voice.recording.eyebrow": "Écoute active",
  "voice.recording.title": "Parlez, Sonolect capture votre voix",
  "voice.recording.detail":
    "MediaRecorder collecte les fragments audio localement jusqu'à l'arrêt.",
  "voice.uploading.eyebrow": "Envoi transcription",
  "voice.uploading.title": "Préparation du job backend…",
  "voice.uploading.detailConfigured":
    "Capture terminée : envoi au endpoint configuré par VITE_SONOLECT_API_URL.",
  "voice.uploading.detailOffline":
    "Aucun backend configuré : bascule vers le mode local/offline explicite.",
  "voice.completed.eyebrowOffline": "Terminé · offline",
  "voice.completed.eyebrow": "Terminé",
  "voice.completed.titleOffline": "Capture locale prête",
  "voice.completed.title": "Capture envoyée",
  "voice.completed.detailFallback":
    "Blob audio, durée, type MIME et URL locale ont été créés.",
  "voice.error.eyebrow": "Erreur capture",
  "voice.error.title": "Impossible de finaliser l'enregistrement",
  "voice.error.detailFallback": "Une erreur inconnue est survenue.",
  "voice.default.eyebrow": "Prêt",
  "voice.default.title": "Capture vocale",
  "voice.default.detail": "Click pour commencer.",

  // Command Palette
  "palette.prompt": "Que voulez-vous faire avec votre voix ?",
  "palette.ariaLabel": "Palette de commandes",
  "palette.newCapture": "Nouvelle capture vocale",
  "palette.newCaptureHint": "Démarrer l'overlay micro",
  "palette.openHistory": "Ouvrir historique",
  "palette.openHistoryHint": "Retrouver une transcription",
  "palette.agentCenter": "Centre agents",
  "palette.agentCenterHint": "Voir les actions connectées",
  "palette.privacySettings": "Réglages confidentialité",
  "palette.privacySettingsHint": "Local-first, cloud, rétention",

  // Errors
  "error.micUnavailable":
    "La capture micro n'est pas disponible dans cet environnement.",
  "error.mediaRecorderUnsupported":
    "MediaRecorder n'est pas supporté par ce runtime desktop.",
  "error.recordingError": "Erreur pendant l'enregistrement audio.",
  "error.sendFailed": "Impossible d'envoyer la capture au backend.",
  "error.micPermissionDenied": "Permission micro refusée ou indisponible.",
  "error.historyLoadFailed":
    "Impossible de charger l'historique des transcriptions.",
  "error.detailLoadFailed": "Impossible d'ouvrir le détail de transcription.",

  // Fallback transcript
  "fallback.localCapture":
    "[Capture vocale locale] {duration} · {mimeType} · {size} Ko. Backend non configuré (VITE_SONOLECT_API_URL).",
  "fallback.sentCapture": "[Capture vocale envoyée] Job {jobId} · {duration}.",

  // Initial transcript
  initialTranscript:
    "Objectif : préparer une démonstration Sonolect desktop premium.\n\nMettre l'accent sur une expérience voix-first : raccourci global, overlay micro immédiat, transcription éditable, puis actions agentiques.\n\nTon souhaité : français professionnel, direct, élégant. Prochaine action : générer un brief investisseur et trois tickets Linear.",

  // Workspace aria
  "workspace.ariaLabel": "Espace de travail Sonolect",

  // transcriptHistory
  "history.unknownDuration": "Durée inconnue",
  "history.unknownDate": "Date inconnue",
  "history.pendingContent": "Transcription en attente de contenu.",
  "history.offlineMessage":
    "VITE_SONOLECT_API_URL absent : historique de démonstration conservé localement.",

  // voiceApi
  "voiceApi.offlineNoUrl":
    "VITE_SONOLECT_API_URL absent : capture conservée localement sans envoi backend.",
  "voiceApi.backendUnavailable":
    "Backend local indisponible : capture conservée localement",

  // Toast
  "toast.transformComplete": "Transcription transformée avec succès",
  "toast.copySuccess": "Transcription copiée dans le presse-papiers",

  // Transform
  "editor.transforming": "Transformation…",

  // Export
  "editor.copy": "Copier",
  "editor.download": "Télécharger",

  // Command palette search
  "palette.searchPlaceholder": "Rechercher des commandes…",
  "palette.noResults": "Aucun résultat",

  // Recording pill
  "pill.permitting": "Accès micro…",
  "pill.processing": "Traitement…",
  "pill.done": "Terminé",
  "pill.error": "Erreur",
  "pill.stop": "Stop",
  "pill.again": "Relancer",

  // Audio playback
  "audio.recentCapture": "Capture récente",
  "audio.playPause": "Lire ou mettre en pause l'audio",
  "audio.waveform": "Forme d'onde audio",
};
