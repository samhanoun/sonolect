import type { LocaleKeys } from "./en";

export const fr: Record<LocaleKeys, string> = {
  // Navigation
  "nav.today": "Aujourd'hui",
  "nav.history": "Historique",
  "nav.agents": "Agents",
  "nav.settings": "Réglages",
  "nav.onboarding": "Configuration",
  "nav.dictionary": "Dictionnaire",
  "nav.home": "Accueil",
  "nav.snippets": "Extraits",
  "nav.transforms": "Transformations",
  "nav.reader": "Lecteur",
  "nav.team": "Équipe",
  "nav.meeting": "Réunion",

  // Sidebar
  "sidebar.recordNow": "Parler maintenant",
  "sidebar.lastDictations": "Dernières dictées",
  "sidebar.loadingHistory": "Chargement de l'historique…",

  // TopBar
  "topbar.eyebrow": "Shell desktop premium",
  "topbar.headline": "Capture vocale → texte → actions",
  "topbar.searchCommand": "Rechercher une commande",
  "topbar.localFirst": "Local uniquement",
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
  "settings.whisper.catalog": "Ressources locales recommandées",
  "settings.whisper.recommendedModel": "Modèle à télécharger",
  "settings.whisper.defaultBinary": "Chemin binaire par défaut",
  "settings.whisper.defaultModel": "Chemin modèle par défaut",
  "settings.whisper.downloadUrl": "Téléchargement du modèle",
  "settings.whisper.usePlan": "Utiliser le modèle de commande recommandé",
  "settings.whisper.planApplied":
    "Modèle de commande Whisper recommandé appliqué. Ajoutez votre vrai chemin de modèle avant le test.",
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
  "palette.privacySettingsHint": "Local uniquement, cloud, rétention",

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
  "toast.insertionReady": "Dictée polie prête à coller",

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

  // Studio shell
  "studio.nav.home": "Vue d'ensemble",
  "studio.nav.transcribe": "Transcrire",
  "studio.nav.speech": "Synthèse vocale",
  "studio.nav.library": "Bibliothèque",
  "studio.nav.dictionary": "Dictionnaire",
  "studio.nav.snippets": "Extraits",
  "studio.nav.models": "Modèles et voix",
  "studio.nav.settings": "Réglages",
  "studio.group.workspace": "Espace de travail",
  "studio.group.personalize": "Personnaliser",
  "studio.brand.tagline": "Espace de travail vocal",
  "studio.version": "Espace de travail Windows",
  "studio.quickNav.label": "Navigation rapide",
  "studio.quickNav.find": "Trouver une page",
  "studio.quickNav.placeholder": "Où souhaitez-vous aller\u202f?",
  "studio.quickNav.close": "Fermer la navigation",
  "studio.quickNav.empty": "Aucune page ne correspond à «\u00a0{query}\u00a0».",
  "studio.topbar.search": "Rechercher une page",
  "studio.dock.listening": "Écoute en cours…",
  "studio.dock.processing": "Traitement en cours…",
  "studio.dock.error": "L'enregistrement demande votre attention",
  "studio.dock.ready": "Votre texte est prêt",
  "studio.dock.stop": "Arrêter",
  "studio.dock.dismiss": "Fermer",
  "studio.dictation.new": "Nouvelle dictée",
  "studio.dictation.start": "Commencer à dicter",
  "studio.dictation.stop": "Arrêter la dictée",
  "studio.mode.label": "Mode de traitement",
  "studio.mode.local": "Local uniquement",
  "studio.mode.cloud": "Cloud activé",
  "studio.mode.localProcessing": "Traitement local",
  "studio.mode.localHint":
    "Vos enregistrements restent sur cet appareil, sauf si vous choisissez le traitement en ligne.",
  "studio.mode.cloudHint":
    "Les requêtes en ligne utilisent le fournisseur et la clé API que vous avez choisis.",
  "studio.common.copy": "Copier",
  "studio.common.delete": "Supprimer",
  "studio.common.refresh": "Actualiser",
  "studio.common.undo": "Annuler",
  "studio.common.redo": "Rétablir",
  "studio.common.language": "Langue",
  "studio.common.working": "En cours…",
  "studio.common.saving": "Enregistrement…",
  "studio.common.secondsShort": "{count} s",

  // Studio overview
  "studio.signal.listening": "Écoute",
  "studio.signal.ready": "Prêt",
  "studio.signal.meta": "16 kHz · mono · sur l'appareil",
  "studio.overview.eyebrow": "Un peu moins de saisie",
  "studio.overview.title": "Faites de la place à vos idées",
  "studio.overview.subtitle":
    "Parlez naturellement. Transformez votre voix en quelque chose d'utile.",
  "studio.overview.chip": "Votre espace personnel",
  "studio.overview.heroEyebrow": "Commencez par votre voix",
  "studio.overview.heroTitle1": "Dites-le.",
  "studio.overview.heroTitle2": "Laissez filer vos idées.",
  "studio.overview.heroBody":
    "Notez une idée, rédigez un message ou lancez un premier jet. La reconnaissance locale est prête quand vous l'êtes.",
  "studio.overview.statRecordings": "Enregistrements",
  "studio.overview.statRecordingsHint": "Enregistrés sur cet appareil",
  "studio.overview.statWords": "Mots dictés",
  "studio.overview.statWordsHint": "Dans vos transcriptions enregistrées",
  "studio.overview.statRetry": "À reprendre",
  "studio.overview.statRetryHint": "Enregistrements à relancer",
  "studio.overview.ttsTitle": "Donnez une voix à votre texte",
  "studio.overview.ttsBody":
    "Choisissez un modèle vocal et écoutez vos écrits.",
  "studio.overview.ttsLink": "Ouvrir la synthèse vocale →",
  "studio.overview.modelsTitle": "Un modèle pour chaque tâche",
  "studio.overview.modelsBody":
    "Connectez OpenRouter ou OpenCode Zen. La reconnaissance locale reste à un clic.",
  "studio.overview.modelsLink": "Explorer les modèles et les voix →",
  "studio.overview.recent": "Enregistrements récents",
  "studio.overview.viewLibrary": "Voir la bibliothèque →",
  "studio.overview.empty": "Votre premier enregistrement apparaîtra ici.",

  // Studio transcribe
  "studio.transcribe.eyebrow": "De l'idée au texte",
  "studio.transcribe.title": "Trouvez votre rythme",
  "studio.transcribe.subtitle":
    "Enregistrez votre voix, importez un fichier audio ou travaillez votre prochain brouillon.",
  "studio.transcribe.import": "Importer un audio",
  "studio.transcribe.yourTranscript": "Votre transcription",
  "studio.transcribe.editorLabel": "Éditeur de transcription",
  "studio.transcribe.placeholder":
    "Vos mots apparaîtront ici. Vous pouvez aussi commencer à écrire…",
  "studio.transcribe.words.one": "{count} mot",
  "studio.transcribe.words.other": "{count} mots",
  "studio.transcribe.stopRecording": "Arrêter l'enregistrement",
  "studio.transcribe.record": "Enregistrer pour ajouter du texte",
  "studio.transcribe.copied": "Transcription copiée.",
  "studio.transcribe.copyBlocked":
    "La copie a été bloquée. Sélectionnez le texte pour le copier manuellement.",
  "studio.transcribe.exportFormat": "Format d'export",
  "studio.transcribe.export": "Exporter la transcription",
  "studio.transcribe.exportTitle": "Transcription Sonolect",
  "studio.export.txt": "Texte brut (.txt)",
  "studio.export.md": "Markdown (.md)",
  "studio.export.srt": "Sous-titres (.srt)",
  "studio.export.vtt": "Sous-titres web (.vtt)",
  "studio.export.json": "JSON avec minutage (.json)",
  "studio.transcribe.fileTooLarge":
    "Choisissez un fichier audio de moins de 25 Mo et de trois minutes.",
  "studio.transcribe.notReady": "La transcription n'est pas prête.",
  "studio.transcribe.saved": "Audio transcrit et enregistré.",
  "studio.transcribe.noSpeech": "Aucune parole n'a été détectée.",
  "studio.transcribe.recognition": "Reconnaissance",
  "studio.transcribe.polishTitle": "Une touche de finition",
  "studio.transcribe.polishBody":
    "Applique votre dictionnaire et une mise en forme locale prudente.",
  "studio.transcribe.cleanLocal": "Nettoyer en local",
  "studio.transcribe.refineOnline": "Affiner avec un modèle en ligne",
  "studio.transcribe.instruction": "Consigne de réécriture",
  "studio.transcribe.defaultInstruction":
    "Rends ce texte clair et concis sans en changer le sens.",
  "studio.transcribe.previewEdit": "Aperçu de la réécriture en ligne",
  "studio.transcribe.chooseModel": "Choisir le modèle de réécriture →",
  "studio.transcribe.reviewTitle": "Vérifiez la modification proposée",
  "studio.transcribe.apply": "Appliquer la modification",
  "studio.transcribe.keep": "Garder l'original",

  // Studio text to speech
  "studio.speech.eyebrow": "Des mots à écouter",
  "studio.speech.title": "Donnez une voix à vos écrits",
  "studio.speech.subtitle":
    "Choisissez un modèle, trouvez une voix et écoutez avant de partager.",
  "studio.speech.question": "Que souhaitez-vous écouter\u202f?",
  "studio.speech.inputLabel": "Texte à lire",
  "studio.speech.placeholder":
    "Collez un script, un message ou un passage à écouter…",
  "studio.speech.characters": "{count} / {max} caractères",
  "studio.speech.generate": "Générer l'audio",
  "studio.speech.generating": "Génération de l'audio…",
  "studio.speech.download": "Télécharger en {format}",
  "studio.speech.localNotice":
    "Le mode Local uniquement est sélectionné. Passez le mode de traitement sur Cloud activé avant de générer de l'audio en ligne.",
  "studio.speech.modelVoice": "Modèle et voix",
  "studio.speech.format": "Format audio",
  "studio.speech.pcmOption": "PCM → WAV lisible",
  "studio.speech.sampleRate": "Fréquence d'échantillonnage PCM",
  "studio.speech.sampleRateHint":
    "16 bits mono. Utilisez la fréquence de sortie du modèle choisi.",
  "studio.speech.formatHint":
    "Les modèles vocaux Gemini et HeyGen exigent le PCM. D'autres modèles peuvent exiger le MP3.",
  "studio.speech.voice": "Voix",
  "studio.speech.voiceDefault": "Voix par défaut du fournisseur, si disponible",
  "studio.speech.voicePlaceholder":
    "Identifiant de voix, ou laissez vide pour la voix par défaut",
  "studio.speech.voiceHint":
    "Les voix disponibles dépendent du modèle. Si un modèle n'a pas de voix par défaut, saisissez l'un de ses identifiants de voix.",
  "studio.speech.localCallout":
    "La reconnaissance vocale locale reste disponible. La génération d'audio en ligne utilise votre compte OpenRouter.",

  // Studio library
  "studio.library.eyebrow": "Une place pour chaque idée",
  "studio.library.title": "Votre bibliothèque vocale",
  "studio.library.subtitle":
    "Vos enregistrements, prêts à être repris. L'audio reste ici jusqu'à ce que vous le supprimiez.",
  "studio.library.searchLabel": "Rechercher dans les enregistrements",
  "studio.library.searchPlaceholder": "Rechercher dans vos enregistrements…",
  "studio.library.noMatch": "Aucun enregistrement correspondant",
  "studio.library.emptyTitle": "Tout commence ici.",
  "studio.library.tryOther": "Essayez un autre mot.",
  "studio.library.emptyBody":
    "Vos enregistrements apparaîtront ici après une dictée ou un import audio dans l'application Windows.",
  "studio.library.createFirst": "Créer votre premier enregistrement",
  "studio.library.retryNeeded": "À relancer",
  "studio.library.savedOnDevice": "Enregistré sur l'appareil",
  "studio.library.noTranscript": "Pas encore de transcription.",
  "studio.library.openEditor": "Ouvrir l'éditeur →",
  "studio.library.copyBlocked": "La copie a été bloquée.",
  "studio.library.transcribing": "Transcription…",
  "studio.library.retryLocal": "Relancer en local",
  "studio.library.retried": "Enregistrement transcrit en local.",
  "studio.library.confirmDelete":
    "Supprimer cet enregistrement et sa transcription de cet appareil\u202f?",

  // Studio dictionary and snippets
  "studio.vocab.eyebrow": "À votre image",
  "studio.vocab.count.one": "{count} entrée · stockée en local",
  "studio.vocab.count.other": "{count} entrées · stockées en local",
  "studio.vocab.deleteLabel": "Supprimer {name}",
  "studio.vocab.empty":
    "Aucune entrée pour l'instant. Ajoutez-en une ci-dessus pour personnaliser vos brouillons.",
  "studio.dictionary.title": "Vos mots, bien orthographiés",
  "studio.dictionary.subtitle":
    "Apprenez à la mise en forme locale les noms, les termes et les orthographes que vous utilisez.",
  "studio.dictionary.spokenLabel": "Forme prononcée ou reconnue",
  "studio.dictionary.spokenPlaceholder": "Un mot à corriger",
  "studio.dictionary.replacementLabel": "Orthographe souhaitée",
  "studio.dictionary.replacementPlaceholder": "Comment il doit s'écrire",
  "studio.dictionary.add": "Ajouter le mot",
  "studio.dictionary.listTitle": "Dictionnaire personnel",
  "studio.snippets.title": "Dites-en moins, écrivez-en plus",
  "studio.snippets.subtitle":
    "Enregistrez des blocs de texte réutilisables, développés en local dans vos brouillons.",
  "studio.snippets.triggerLabel": "Raccourci",
  "studio.snippets.triggerPlaceholder": "/signature",
  "studio.snippets.bodyLabel": "Texte à insérer",
  "studio.snippets.bodyPlaceholder": "Votre texte réutilisable",
  "studio.snippets.add": "Ajouter l'extrait",
  "studio.snippets.listTitle": "Vos extraits",

  // Studio settings and privacy
  "studio.settings.eyebrow": "Votre espace, vos règles",
  "studio.settings.title": "Faites comme chez vous",
  "studio.settings.subtitle":
    "Modèles locaux, langue et confidentialité au même endroit.",
  "studio.settings.whisperTitle": "Whisper local",
  "studio.settings.whisperMeta": "Base multilingue · CPU · 148 Mo",
  "studio.settings.modelReady":
    "Un modèle local est disponible sur cet ordinateur.",
  "studio.settings.modelMissing":
    "Installez un modèle une fois, puis dictez sans connexion Internet.",
  "studio.settings.downloading": "Téléchargement {progress}\u00a0%",
  "studio.settings.reinstall": "Réinstaller le modèle vérifié",
  "studio.settings.install": "Installer le modèle local",
  "studio.settings.modelDownloaded":
    "Modèle téléchargé et somme de contrôle vérifiée. Vous pouvez l'utiliser hors ligne.",
  "studio.settings.existingModel": "Utiliser un modèle existant",
  "studio.settings.modelPath": "Chemin du fichier Whisper .bin",
  "studio.settings.languageTitle": "Langue et traitement",
  "studio.settings.interfaceLanguage": "Langue de l'interface",
  "studio.settings.dictationLanguage": "Langue de dictée",
  "studio.settings.languageAuto": "Détection automatique",
  "studio.settings.modeHint":
    "Le mode Local uniquement bloque tout traitement en ligne de l'audio et du texte. La consultation du catalogue et le téléchargement de modèles sont des actions distinctes.",
  "studio.settings.shortcutsTitle": "Raccourcis et stockage",
  "studio.settings.shortcutToggle": "Démarrer ou arrêter l'enregistrement",
  "studio.settings.shortcutHold": "Maintenir pour parler",
  "studio.settings.shortcutNav": "Navigation rapide",
  "studio.settings.shortcutCancel": "Annuler la dictée",
  "studio.settings.bubbleTitle": "Bulle de dictée",
  "studio.settings.bubbleHint":
    "Appuyez sur {toggle} (ou maintenez {hold}) dans n'importe quelle application. Une bulle flottante indique que Sonolect écoute, puis vos mots sont collés à l'emplacement du curseur. Cliquez sur la bulle pour démarrer ou arrêter, {cancel} pour annuler, clic droit pour ouvrir Sonolect.",
  "studio.settings.bubbleShow": "Afficher la bulle",
  "studio.settings.bubbleAlways": "Toujours (petite pastille au repos)",
  "studio.settings.bubbleDictating": "Seulement pendant la dictée",
  "studio.settings.bubbleOff": "Jamais",
  "studio.settings.storageHint":
    "Les enregistrements peuvent durer jusqu'à quatre heures et sont conservés sur cet appareil pendant la durée choisie ci-dessus. Les clés API utilisent le Gestionnaire d'identification Windows.",
  "studio.settings.previewNotice":
    "Ceci est l'aperçu dans le navigateur. L'installation des modèles et la reconnaissance locale fonctionnent dans l'application Windows.",
  "studio.privacy.title": "Confidentialité et conservation",
  "studio.privacy.subtitle":
    "En mode Local uniquement, les enregistrements et les transcriptions ne quittent jamais cet appareil.",
  "studio.privacy.keep": "Conserver les enregistrements",
  "studio.privacy.deleteAll": "Supprimer toutes mes données",
  "studio.privacy.deleting": "Suppression…",
  "studio.privacy.deleteAllHint":
    "Supprime les enregistrements, les transcriptions, votre dictionnaire et vos extraits, les clés API enregistrées et les réglages. Les modèles vocaux téléchargés sont conservés.",
  "studio.privacy.confirmDeleteAll":
    "Supprimer de cet appareil tous vos enregistrements, transcriptions, dictionnaire, extraits, clés API enregistrées et réglages\u202f? Cette action est irréversible.",
  "studio.privacy.partialFailure":
    "Certaines données n'ont pas pu être supprimées\u00a0: {problems}",
  "studio.privacy.keptForever":
    "Les enregistrements sont conservés jusqu'à ce que vous les supprimiez.",
  "studio.privacy.savedPreview":
    "Enregistré. Le réglage s'applique dans l'application Windows.",
  "studio.privacy.savedDeleted.one":
    "Enregistré. {count} enregistrement de plus de {period} a été supprimé.",
  "studio.privacy.savedDeleted.other":
    "Enregistré. {count} enregistrements de plus de {period} ont été supprimés.",
  "studio.privacy.savedAuto":
    "Enregistré. Les enregistrements de plus de {period} sont supprimés automatiquement.",
  "studio.retention.forever": "Jusqu'à ce que je les supprime",
  "studio.retention.days.one": "{count} jour",
  "studio.retention.days.other": "{count} jours",

  // Note sync between devices
  "studio.sync.title": "Synchronisation entre appareils",
  "studio.sync.subtitle":
    "Vos notes sur tous vos appareils, chiffrées de bout en bout : le serveur de synchronisation les conserve mais ne peut pas les lire.",
  "studio.sync.server": "Serveur de synchronisation : {server}",
  "studio.sync.audioStays":
    "Les enregistrements restent sur l'appareil qui les a faits. Seules les notes se synchronisent.",
  "studio.sync.offState": "La synchronisation est désactivée.",
  "studio.sync.onState": "La synchronisation est activée.",
  "studio.sync.turnOn": "Activer la synchronisation",
  "studio.sync.turningOn": "Activation…",
  "studio.sync.join": "Rejoindre avec un code",
  "studio.sync.joinLabel":
    "Code ou lien de synchronisation de votre autre appareil",
  "studio.sync.joinSubmit": "Rejoindre",
  "studio.sync.joining": "Connexion…",
  "studio.sync.cancel": "Annuler",
  "studio.sync.warning":
    "Rejoindre partage chaque note avec quiconque détient ce code.",
  "studio.sync.lastSync": "Dernière synchronisation : {time}.",
  "studio.sync.neverSynced": "Pas encore synchronisé.",
  "studio.sync.syncing": "Synchronisation…",
  "studio.sync.syncNow": "Synchroniser maintenant",
  "studio.sync.showCode": "Afficher le code",
  "studio.sync.hideCode": "Masquer le code",
  "studio.sync.codeHint":
    "Sur votre autre appareil, choisissez de rejoindre la synchronisation, puis scannez ce code QR ou saisissez le code.",
  "studio.sync.codeLabel": "Code de synchronisation",
  "studio.sync.qrLabel": "Code QR pour rejoindre cette synchronisation",
  "studio.sync.turnOff": "Désactiver la synchronisation",
  "studio.sync.turnOffQuestion":
    "Désactiver la synchronisation sur cet appareil ?",
  "studio.sync.keepServer": "Garder la copie du serveur",
  "studio.sync.keepServerHint":
    "Vos autres appareils continuent de se synchroniser. Celui-ci pourra la rejoindre de nouveau avec le code.",
  "studio.sync.deleteServer": "Supprimer la copie du serveur",
  "studio.sync.deleteServerHint":
    "Vos autres appareils voient « Cette synchronisation a été supprimée » et désactivent la synchronisation. Chaque appareil garde ses notes.",
  "studio.sync.turningOff": "Désactivation…",
  "studio.sync.notesKept": "Vos notes restent sur cet appareil.",
  "studio.sync.error.unauthorized":
    "Le serveur n'accepte pas cette clé de synchronisation.",
  "studio.sync.error.deleted": "Cette synchronisation a été supprimée.",
  "studio.sync.error.tooLarge":
    "Une note est trop volumineuse pour être synchronisée.",
  "studio.sync.error.server":
    "La synchronisation est indisponible pour le moment.",
  "studio.sync.error.offline":
    "Hors ligne. Les notes se synchroniseront à votre retour en ligne.",
  "studio.sync.notice.quota":
    "L'espace de synchronisation est plein. Supprimez des notes pour synchroniser les nouvelles.",
  "studio.sync.notice.newerSchema":
    "Mettez Sonolect à jour pour synchroniser toutes les notes.",
  "studio.sync.pairing.invalid":
    "Ce n'est pas un code de synchronisation Sonolect.",
  "studio.sync.pairing.version":
    "Mettez Sonolect à jour pour utiliser ce code.",
  "studio.sync.pairing.length": "Vérifiez le code : il compte 56 caractères.",
  "studio.sync.pairing.typo": "Un caractère est erroné.",
  "studio.sync.preview":
    "La synchronisation fonctionne dans l'application installée.",
  "studio.sync.deleteAllHint":
    "La synchronisation est aussi désactivée sur cet appareil.",
  "studio.sync.deleteAllServer":
    "La synchronisation est activée. Supprimer aussi la copie de vos notes sur le serveur ? OK la supprime : vos autres appareils désactivent la synchronisation et gardent leurs notes. Annuler la conserve pour eux.",

  // Studio models and providers
  "studio.task.stt": "Reconnaissance vocale",
  "studio.task.tts": "Synthèse vocale",
  "studio.task.text": "Réécriture de texte",
  "studio.models.eyebrow": "À votre façon",
  "studio.models.title": "Vos modèles, votre choix",
  "studio.models.subtitle":
    "Choisissez comment Sonolect écoute, parle et affine vos mots.",
  "studio.models.chip": "Vos clés restent sur votre appareil",
  "studio.models.tabProviders": "Fournisseurs",
  "studio.models.provider": "Fournisseur",
  "studio.models.providerFor": "Fournisseur\u00a0: {task}",
  "studio.models.model": "Modèle",
  "studio.models.modelFor": "Modèle\u00a0: {task}",
  "studio.models.localHint":
    "Votre modèle Whisper installé fonctionne sur cet ordinateur.",
  "studio.models.choose": "Choisir un modèle",
  "studio.models.savedSelection": "{model} · sélection enregistrée",
  "studio.models.loading": "Chargement des modèles…",
  "studio.models.loadCatalog": "Charger le catalogue en ligne",
  "studio.models.catalogHint.stt":
    "Chargez le catalogue en ligne pour voir les modèles compatibles avec la reconnaissance vocale. Aucun audio ni texte n'est envoyé lors du chargement des modèles.",
  "studio.models.catalogHint.tts":
    "Chargez le catalogue en ligne pour voir les modèles compatibles avec la synthèse vocale. Aucun audio ni texte n'est envoyé lors du chargement des modèles.",
  "studio.models.catalogHint.text":
    "Chargez le catalogue en ligne pour voir les modèles compatibles avec la réécriture de texte. Aucun audio ni texte n'est envoyé lors du chargement des modèles.",
  "studio.models.routerTagline": "Une clé, de nombreux modèles vocaux",
  "studio.models.zenTagline": "Des modèles pour une réécriture soignée",
  "studio.models.keySaved": "Clé enregistrée",
  "studio.models.noKey": "Aucune clé enregistrée",
  "studio.models.noSpeech": "Pas de modèle vocal dédié",
  "studio.models.apiKey": "Clé API",
  "studio.models.replaceKey":
    "Collez une nouvelle clé pour remplacer la clé enregistrée",
  "studio.models.pasteKey": "Collez votre clé {provider}",
  "studio.models.saveKey": "Enregistrer la clé",
  "studio.models.keyNote":
    "Stockée dans le Gestionnaire d'identification Windows. Jamais dans les préférences du navigateur.",
  "studio.models.browse": "Parcourir les modèles",
  "studio.models.removeKey": "Supprimer la clé enregistrée",
  "studio.models.previewNotice":
    "Aperçu dans le navigateur. Ouvrez l'application Windows pour enregistrer des clés et utiliser la reconnaissance native.",
  "studio.models.localTitle": "Vous préférez rester en local\u202f?",
  "studio.models.localBody":
    "Whisper fonctionne sur votre ordinateur. Sans clé API. Sans compte. Sans envoi d'audio.",
  "studio.models.manageLocal": "Gérer le modèle local",
  "studio.models.workflowTitle": "Configurez votre flux vocal",
  "studio.models.workflowBody":
    "Chaque tâche peut utiliser un modèle différent.",
  "studio.models.chooseModel": "Choisir un modèle →",
  "studio.models.controlTitle": "Toujours sous votre contrôle",
  "studio.models.controlBody":
    "Ajouter une clé ne change pas votre mode de traitement. L'audio et le texte ne partent en ligne que si vous choisissez le traitement cloud.",
  "studio.models.privateDefault": "Privé par défaut",
  "studio.models.filtered":
    "Les modèles sont filtrés selon les capacités publiées par le fournisseur.",
  "studio.models.zenNotice":
    "OpenCode Zen est disponible pour la réécriture de texte. Son API publique ne propose pas actuellement de modèles vocaux dédiés.",
  "provider.name.local": "Whisper local",
  "provider.previewOnly":
    "Ouvrez l'application Windows pour utiliser les clés sécurisées et la reconnaissance native. Cette fenêtre est un aperçu dans le navigateur.",
  "provider.cloudRequired":
    "Activez le traitement cloud avant d'envoyer de l'audio ou du texte en ligne.",
  "provider.cloudCancelled": "Le traitement cloud a été annulé.",
  "provider.selectStt":
    "Sélectionnez un modèle de reconnaissance vocale OpenRouter dans Modèles et voix.",
  "provider.selectTts":
    "Sélectionnez d'abord un modèle de synthèse vocale OpenRouter.",
  "provider.selectText":
    "Sélectionnez un modèle de réécriture dans Modèles et voix.",
  "provider.modelsLoaded.one":
    "{count} modèle compatible chargé depuis {provider}.",
  "provider.modelsLoaded.other":
    "{count} modèles compatibles chargés depuis {provider}.",
  "provider.keySaved":
    "Clé {provider} enregistrée dans le Gestionnaire d'identification Windows. Elle n'a été ni facturée ni utilisée pour une requête de test.",
  "provider.keyRemoved": "Clé enregistrée supprimée.",

  // Capture and transcription status
  "voice.localOnly":
    "Local uniquement\u00a0: le traitement cloud est désactivé.",
  "voice.localWhisper": "Transcrit sur cet appareil avec Whisper local.",
  "voice.onlineModel": "Transcrit avec le modèle en ligne sélectionné.",
  "voice.sentForTranscription":
    "Enregistrement envoyé à Sonolect pour transcription.",
  "voice.cloudPolish": "Reconnaissance cloud et finition Gemini.",
  "voice.jobFailed": "La tâche audio du serveur a échoué ({status})",
  "voice.transcribeFailed": "La transcription cloud a échoué ({status})",
  "voice.polishFailed": "La finition cloud a échoué ({status})",
  "voice.uploadFailed": "L'envoi de l'audio au serveur a échoué ({status})",
  "audio.invalidFormat": "Format audio non valide.",
  "audio.tooLong": "Les enregistrements sont limités à trois minutes.",
  "audio.invalidSamples": "L'audio contient des échantillons non valides.",
  "voice.localUnavailableApp":
    "Transcription locale indisponible. Vérifiez le modèle installé dans Réglages. Aucun audio n'a été envoyé.",
  "voice.localUnavailablePreview":
    "La transcription locale fonctionne dans l'application Windows. Cet aperçu dans le navigateur n'a envoyé aucun audio.",
  "voice.notConfigured":
    "La transcription en ligne n'est pas configurée. Votre enregistrement est resté sur cet appareil.",
  "voice.unreachable":
    "Sonolect est injoignable, votre enregistrement est donc resté sur cet appareil.",
  "voice.unreachableBecause":
    "Sonolect est injoignable, votre enregistrement est donc resté sur cet appareil ({reason}).",
  "studio.keys.shift": "Maj",
  "studio.keys.esc": "Échap",
  // Bulle de dictée (la pastille flottante, dans sa propre fenêtre)
  "bubble.start": "Démarrer la dictée ({hotkey})",
  "bubble.idleTitle":
    "Cliquez ou appuyez sur {hotkey} pour dicter. Clic droit pour ouvrir Sonolect.",
  "bubble.dictate": "Dicter",
  "bubble.cancel": "Annuler la dictée",
  "bubble.dismiss": "Fermer",
  "bubble.cancelTitle": "Annuler ({key})",
  "bubble.stop": "Arrêter et insérer",
  "bubble.phase.idle": "Prêt",
  "bubble.phase.listening": "Écoute",
  "bubble.phase.transcribing": "Transcription",
  "bubble.phase.inserted": "Inséré",
  "bubble.phase.copied": "Copié",
  "bubble.phase.error": "Dictée impossible",
  "bubble.copiedDetail": "Copié. Appuyez sur Ctrl+V pour coller.",
  "bubble.pasteFailed":
    "Collage impossible. Vos mots sont enregistrés dans Sonolect.",
  "bubble.error.generic": "Une erreur s'est produite.",
  "bubble.error.micUnavailable": "Aucun micro détecté.",
  "bubble.error.micPermissionDenied": "L'accès au micro a été refusé.",
  "bubble.error.mediaRecorderUnsupported":
    "L'enregistrement n'est pas pris en charge ici.",
  "bubble.error.recordingError":
    "L'enregistrement s'est arrêté de façon inattendue.",
  "bubble.error.sendFailed": "La transcription a échoué.",
  "bubble.status.inserted": "Dictée insérée dans l'application active.",
  "bubble.status.copied": "Dictée copiée dans le presse-papiers. {status}",
  "studio.privacy.problemRecordings": "Enregistrements\u00a0: {reason}",
  "studio.privacy.problemSettings": "Réglages\u00a0: {reason}",
  "studio.privacy.problemSync": "Synchronisation\u00a0: {reason}",
  "native.downloadRunning": "Un téléchargement de modèle est déjà en cours.",
  "native.cannotLoadModel":
    "Impossible de charger le modèle vocal\u00a0: {reason}",
  "native.cannotSaveRecording":
    "Impossible d'enregistrer l'audio\u00a0: {reason}",
  "native.chooseFormat": "Choisissez une sortie MP3 ou PCM.",
  "native.chooseModel": "Choisissez un modèle valide dans le catalogue.",
  "native.keyDeleteFailed": "Impossible de supprimer la clé enregistrée.",
  "native.deleteFailed": "Impossible de supprimer {name}\u00a0: {reason}",
  "native.providerInit":
    "Impossible d'initialiser la connexion au fournisseur.",
  "native.modelsLoadFailed":
    "Impossible de charger les modèles. Vérifiez votre connexion Internet.",
  "native.credentialRead":
    "Impossible de lire le Gestionnaire d'identification Windows.",
  "native.credentialSave":
    "Impossible d'enregistrer la clé dans le Gestionnaire d'identification Windows.",
  "native.credentialUnavailable":
    "Le Gestionnaire d'identification Windows est indisponible.",
  "native.invalidKey":
    "Saisissez une clé API valide, sans espace ni retour à la ligne.",
  "native.ttsLength": "Saisissez entre 1 et 12 000 caractères à synthétiser.",
  "native.ttsLengthVoice":
    "Saisissez entre 1 et 12 000 caractères et une voix valide.",
  "native.rewriteLength":
    "Saisissez jusqu'à 12 000 caractères et une courte consigne de réécriture.",
  "native.installModel":
    "Installez d'abord le modèle vocal local dans Réglages.",
  "native.invalidPcm":
    "Audio PCM 16 bits mono ou fréquence d'échantillonnage non valide.",
  "native.invalidWav": "Audio WAV non valide\u00a0: {reason}",
  "native.invalidCatalog": "Catalogue de modèles non valide.",
  "native.invalidModelPath": "Chemin de modèle non valide",
  "native.invalidRecordingId": "Identifiant d'enregistrement non valide.",
  "native.invalidRecordingSize": "Taille d'enregistrement non valide.",
  "native.invalidTextResponse": "Réponse texte non valide.",
  "native.invalidTranscription": "Réponse de transcription non valide.",
  "native.localPcm":
    "La reconnaissance locale exige un audio PCM mono à 16 kHz.",
  "native.checksum":
    "La vérification du modèle a échoué. Relancez le téléchargement.",
  "native.discoveryInterrupted": "La recherche de modèles a été interrompue.",
  "native.downloadFailed":
    "Le téléchargement du modèle a échoué\u00a0: {reason}",
  "native.modelTooLarge": "Le modèle dépasse la taille attendue.",
  "native.noAudio": "Aucun audio n'a été enregistré.",
  "native.transcriptionInterrupted":
    "La transcription en ligne a été interrompue.",
  "native.zenNoSpeech":
    "OpenCode Zen ne propose pas d'API vocale dédiée. Utilisez OpenRouter pour la voix en ligne, ou Whisper local pour la transcription.",
  "native.processingInterrupted":
    "Le traitement a été interrompu. Relancez cet enregistrement.",
  "native.tooLong": "L'enregistrement dépasse la limite de trois minutes.",
  "native.saveKeyFirst":
    "Enregistrez d'abord la clé API de ce fournisseur dans Modèles et voix.",
  "native.keysWindowsOnly":
    "Le stockage sécurisé des clés API n'est actuellement disponible que sous Windows.",
  "native.keyStorageWindows":
    "Le stockage sécurisé des clés nécessite Windows.",
  "native.speechInterrupted": "La génération de l'audio a été interrompue.",
  "native.editInterrupted": "La réécriture a été interrompue.",
  "native.noEditableText": "Le modèle n'a renvoyé aucun texte exploitable.",
  "native.connectionFailed":
    "La connexion au fournisseur a échoué ou a expiré.",
  "native.responseTooLarge":
    "La réponse du fournisseur dépasse la taille autorisée.",
  "native.responseInterrupted": "La réponse du fournisseur a été interrompue.",
  "native.providerCatalog":
    "Le fournisseur a renvoyé un catalogue de modèles non valide.",
  "native.unexpectedAudio":
    "Le fournisseur a renvoyé un format audio inattendu. Vérifiez les réglages de format du modèle.",
  "native.emptyAudio": "Le fournisseur a renvoyé un audio vide.",
  "native.noTranscriptField":
    "Le fournisseur n'a renvoyé aucune transcription.",
  "native.notWhisperModel":
    "Le fichier sélectionné n'est pas un modèle Whisper (.bin au format GGML).",
  "native.unknownProvider": "Fournisseur de modèles inconnu.",
  "native.unsupportedRate":
    "Fréquence d'échantillonnage PCM non prise en charge.",
  "native.engineUnavailable": "Moteur vocal indisponible",
  "native.modelPathRequired": "Indiquez le chemin d'un modèle Whisper",
  "native.keyRejected":
    "Le fournisseur a refusé cette clé API ou l'accès à ce modèle.",
  "native.needsCredits": "Le compte du fournisseur n'a plus de crédits.",
  "native.rateLimited":
    "Le fournisseur limite le nombre de requêtes. Réessayez plus tard.",
  "native.modelUnavailable":
    "Le modèle ou la voix est indisponible, ou ne prend pas en charge ces options. Actualisez le catalogue et vérifiez la sélection.",
  "native.requestFailed":
    "La requête au fournisseur a échoué. Vérifiez la connexion et réessayez.",
  "studio.segments.viewLabel": "Vue de l'éditeur",
  "studio.segments.viewText": "Texte",
  "studio.segments.viewSegments": "Segments",
  "studio.segments.listLabel": "Segments de la transcription",
  "studio.segments.empty":
    "Enregistrez ou saisissez du texte pour le voir en segments.",
  "studio.segments.hint":
    "Cochez des segments pour les fusionner, les scinder ou leur attribuer un intervenant.",
  "studio.segments.hintPlay":
    "Cochez des segments pour les fusionner, les scinder ou leur attribuer un intervenant. Cliquez sur un horodatage pour écouter à partir de là.",
  "studio.segments.merge": "Fusionner",
  "studio.segments.split": "Scinder",
  "studio.segments.splitTitle":
    "Scinde à l'emplacement du curseur, ou au milieu. Ctrl + Entrée scinde aussi pendant la saisie.",
  "studio.segments.selected.one": "{count} segment sélectionné",
  "studio.segments.selected.other": "{count} segments sélectionnés",
  "studio.segments.clearSelection": "Tout désélectionner",
  "studio.segments.speakerForSelection": "Intervenant de la sélection",
  "studio.segments.applySpeaker": "Appliquer",
  "studio.segments.speakerPlaceholder": "Intervenant",
  "studio.segments.select": "Sélectionner le segment {number}",
  "studio.segments.speakerOf": "Intervenant du segment {number}",
  "studio.segments.textOf": "Texte du segment {number}",
  "studio.segments.moveUp": "Monter le segment {number}",
  "studio.segments.moveDown": "Descendre le segment {number}",
  "studio.segments.playFrom": "Écouter à partir de {time}",
  "studio.segments.pauseAt": "Mettre en pause à {time}",
  "studio.segments.approx": "Horodatage estimé",
  "studio.segments.saveToLibrary": "Enregistrer dans la bibliothèque",
  "studio.segments.saved": "Enregistré dans votre bibliothèque.",
  "studio.segments.savedWithCopy":
    "Enregistré. Cet enregistrement avait changé sur un autre appareil entre-temps\u00a0: cette version est conservée comme copie de conflit dans votre bibliothèque.",
  "studio.library.listen": "Écouter",
  "studio.library.pause": "Pause",
  "studio.library.synced": "Synchronisé",
  "studio.library.noAudio":
    "L'enregistrement reste sur l'appareil qui l'a fait.",
  "studio.library.conflictOf": "Copie de conflit de la note du {date}",
  "studio.library.conflictCopy": "Copie de conflit",
  "native.audioGone":
    "L'audio de cet enregistrement n'est plus sur cet appareil.",
  "native.recordingGone":
    "Cet enregistrement n'est plus dans votre bibliothèque.",
  "native.editTooLarge":
    "La transcription modifiée est trop volumineuse pour être enregistrée.",
  "native.segmentOrder": "Un segment se termine avant de commencer.",
  "native.speakerTooLong":
    "Les noms d'intervenants peuvent contenir jusqu'à 80 caractères.",
  "capture.recorderBehind":
    "L'enregistreur ne suit plus le microphone. L'enregistrement a été arrêté et sauvegardé.",
  "native.fourHourLimit":
    "L'enregistrement a atteint la limite de quatre heures.",
  "native.notInProgress": "Cet enregistrement n'est plus en cours.",
  "native.cannotReadRecording":
    "Impossible de lire l'enregistrement\u00a0: {reason}",
  "studio.transcribe.fileTooLargeApp":
    "Choisissez un fichier audio de moins de 100 Mo.",
  "studio.transcribe.reading": "Lecture du fichier audio…",
  "studio.transcribe.progress": "Transcription en cours… {done} sur {total}",
  "studio.mic.title": "Microphone",
  "studio.mic.meta": "L'entrée qui enregistre votre voix",
  "studio.mic.choose": "Enregistrer avec",
  "studio.mic.systemDefault": "Micro par défaut du système",
  "studio.mic.numbered": "Microphone {position}",
  "studio.mic.notConnected": "Micro choisi (non connecté)",
  "studio.mic.notConnectedHint":
    "Le micro choisi n'est pas connecté. En attendant, les enregistrements utilisent le micro par défaut du système.",
  "studio.mic.namesHint":
    "Les noms des micros apparaissent une fois l'accès autorisé. Lancez un test pour l'autoriser.",
  "studio.mic.test": "Tester le micro",
  "studio.mic.stopTest": "Arrêter le test",
  "studio.mic.testHint":
    "Parlez normalement\u00a0: la barre doit suivre votre voix. Rien n'est enregistré.",
  "studio.mic.level": "Niveau du micro",
  "studio.mic.fellBack":
    "Le micro choisi n'est pas connecté\u00a0: le micro par défaut du système est utilisé.",
  "toast.micFellBack":
    "Micro choisi introuvable. Enregistrement avec le micro par défaut du système.",
  "studio.storage.format": "Format des enregistrements",
  "studio.storage.wav": "Qualité d'origine (WAV)",
  "studio.storage.opus": "Compressé (Opus, 10× plus léger)",
  "studio.storage.compressNow": "Compresser les enregistrements",
  "studio.storage.compressing": "Compression…",
  "studio.storage.compressed.one":
    "{count} enregistrement compressé, {size} libérés.",
  "studio.storage.compressed.other":
    "{count} enregistrements compressés, {size} libérés.",
  "studio.storage.nothingToCompress":
    "Tous les enregistrements sont déjà compressés.",
  "studio.storage.failed.one":
    "{count} enregistrement n'a pas pu être compressé et reste tel quel.",
  "studio.storage.failed.other":
    "{count} enregistrements n'ont pas pu être compressés et restent tels quels.",
  "studio.storage.savedOpus":
    "Les nouveaux enregistrements sont compressés une fois transcrits. Vous pouvez toujours les écouter et les transcrire à nouveau.",
  "studio.storage.savedWav":
    "Les nouveaux enregistrements sont conservés en qualité d'origine. Ceux déjà compressés le restent.",
  "studio.transcribe.liveLabel": "Entendu jusqu'ici",
  "capture.keptForRetry":
    "{error} L'enregistrement est dans votre Bibliothèque, où vous pouvez le transcrire à nouveau.",
  "native.invalidCompressed": "Audio compressé invalide.",
  "native.cannotCompress":
    "Impossible d'écrire l'audio compressé\u00a0: {reason}",
  "native.opusError": "Erreur Opus\u00a0: {reason}",
  "toast.shortcutsUnavailable":
    "Les raccourcis de dictée n'ont pas pu être activés. Une autre application les utilise peut-être déjà.",
  "error.importInProgress":
    "Un fichier audio est en cours de transcription. Réessayez une fois qu'elle est terminée.",
  "studio.source.label": "Enregistrer depuis",
  "studio.source.microphone": "Le microphone",
  "studio.source.system": "Le son de cet ordinateur",
  "studio.source.systemHint":
    "Le bouton d'enregistrement capte ce qui est joué sur cet ordinateur, une réunion ou une vidéo par exemple. La dictée avec les raccourcis ou la bulle utilise toujours le microphone.",
  "studio.dock.recordingSystem": "Enregistrement du son de l'ordinateur…",
  "native.noPlaybackDevice": "Aucun périphérique de lecture à enregistrer.",
  "native.playbackFormat":
    "Impossible de lire le format de lecture\u00a0: {reason}",
  "native.playbackNoFormat":
    "Le périphérique de lecture n'indique aucun format audio.",
  "native.playbackUnsupported":
    "Format de lecture non pris en charge\u00a0: {format}.",
  "native.systemAudioCannotStart":
    "Impossible de démarrer l'enregistrement du son de l'ordinateur\u00a0: {reason}",
  "native.systemAudioCannotRecord":
    "Impossible d'enregistrer le son de l'ordinateur\u00a0: {reason}",
  "native.systemAudioStoppedReason":
    "Le son de l'ordinateur n'est plus enregistré\u00a0: {reason}",
  "native.systemAudioStopped": "Le son de l'ordinateur n'est plus enregistré.",
  "native.systemAudioStoppedUnexpectedly":
    "L'enregistrement du son de l'ordinateur s'est arrêté de façon inattendue.",
  "native.systemAudioDidNotStart":
    "L'enregistrement du son de l'ordinateur n'a pas démarré.",
  "native.systemAudioUnavailable":
    "La capture du son de l'ordinateur n'est pas disponible sur cette plateforme.",
  "native.systemRecorderCannotStart":
    "Impossible de démarrer l'enregistreur du son de l'ordinateur\u00a0: {reason}",
  "native.systemRecorderCannotRead":
    "Impossible de lire l'enregistreur du son de l'ordinateur.",
  "native.noMonitorSource": "Aucune source de contrôle PulseAudio trouvée.",
  "native.pactlFailed": "Échec de pactl\u00a0: {reason}",
  "native.systemAudioBusy": "Le son de l'ordinateur n'est pas disponible.",
  "native.ffmpegNeeded":
    "ffmpeg est nécessaire pour enregistrer le son de l'ordinateur.",
  "native.syncNotAvailable":
    "La synchronisation n'est pas disponible dans cette version de Sonolect.",
  "native.syncKeychainLinux":
    "La synchronisation est indisponible sur ce système : elle garde sa clé dans un trousseau (Secret Service, comme GNOME Keyring ou KWallet), et aucun n'est lancé.",
  "native.syncKeychainUnavailable":
    "La synchronisation est indisponible sur ce système : le trousseau n'a pas pu être ouvert.",
  "native.syncKeychainFailed":
    "La clé de synchronisation n'a pas pu être lue ou enregistrée dans le trousseau.",
  "native.syncInvalidKey": "Ce n'est pas une clé de synchronisation valide.",
  "native.syncKeyExists":
    "La synchronisation est déjà activée avec une autre clé. Désactivez-la d'abord.",
  "native.syncStateFailed":
    "L'état de la synchronisation n'a pas pu être enregistré.",
  "native.syncInterrupted": "La synchronisation a été interrompue.",
  "native.syncInvalidNote": "Note synchronisée non valide.",
};
