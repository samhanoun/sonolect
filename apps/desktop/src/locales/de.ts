import type { LocaleKeys } from "./en";

export const de: Partial<Record<LocaleKeys, string>> = {
  "nav.today": "Heute",
  "nav.history": "Verlauf",
  "nav.agents": "Agenten",
  "nav.settings": "Einstellungen",
  "nav.onboarding": "Einrichtung",
  "nav.dictionary": "Wörterbuch",
  "nav.home": "Startseite",
  "nav.snippets": "Schnipsel",
  "nav.transforms": "Transformationen",
  "nav.reader": "Leser",
  "nav.team": "Team",
  "nav.meeting": "Besprechung",

  "sidebar.recordNow": "Jetzt aufnehmen",
  "sidebar.lastDictations": "Letzte Diktate",
  "sidebar.loadingHistory": "Verlauf wird geladen…",

  "topbar.eyebrow": "Premium-Desktop-Shell",
  "topbar.headline": "Sprachaufnahme → Text → Aktionen",
  "topbar.searchCommand": "Befehl suchen",
  "topbar.localFirst": "Local-first",
  "topbar.cloudAssisted": "Cloud-unterstützt",
  "topbar.apiReady": "API bereit",
  "topbar.offline": "Offline",

  "home.welcome": "Willkommen zurück",
  "home.banner": "Ihr sprachgesteuerter Arbeitsbereich ist bereit.",
  "home.noTranscripts":
    "Noch keine Transkriptionen. Drücken Sie Aufnehmen, um zu beginnen.",
  "home.backToTimeline": "← Zurück",

  "stats.title": "Statistiken",
  "stats.totalWords": "Wörter gesamt",
  "stats.wpm": "WPM",
  "stats.dayStreak": "Tage in Folge",

  "editor.eyebrow": "Bearbeitbare Transkription",
  "editor.fallbackTitle": "Angereichertes Sprach-Briefing",
  "editor.modeSummary": "Zusammenfassung",
  "editor.modeEmail": "E-Mail",
  "editor.modeTicket": "Ticket",
  "editor.voiceCanvas": "Echtzeit-Sprach-Canvas",
  "editor.voiceCanvasSubtitle":
    "Aufnahme, lokale Transkription und intelligente Transformation.",
  "editor.wordCount": "Wörter",
  "editor.language": "Sprache: Deutsch",
  "editor.transformCta": "Mit Sonolect transformieren",
  "editor.textareaLabel": "Transkriptions-Editor",
  "editor.draftRestored":
    "Ihr nicht gespeicherter lokaler Entwurf wurde nach dem Neustart wiederhergestellt.",
  "editor.historyControls":
    "Steuerelemente für den Bearbeitungsverlauf der Transkription",
  "editor.undo": "Rückgängig",
  "editor.redo": "Wiederherstellen",

  "segments.ariaLabel": "Transkriptionssegment-Editor",
  "segments.title": "Segmente",
  "segments.count": "Segmente",
  "segments.merge": "Auswahl zusammenführen",
  "segments.split": "Auswahl aufteilen",
  "segments.empty":
    "Geben Sie Transkriptionstext ein, um bearbeitbare Segmente zu erstellen.",
  "segments.segment": "Segment",
  "segments.speaker": "Sprecher",
  "segments.speakerPlaceholder": "Sprecherbezeichnung",
  "segments.textLabel": "Segmenttext",

  "privacy.title": "Datenschutz",
  "privacy.heading": "Sprachsteuerung",
  "privacy.description":
    "Wählen Sie, wo Audioaufnahmen und Transkriptionsentwürfe verarbeitet werden.",
  "privacy.local": "Lokal",
  "privacy.cloud": "Cloud",
  "privacy.autoDelete": "Automatische Löschung nach 24 Stunden",
  "privacy.maskNames": "Maskierung sensibler Eigennamen",
  "privacy.exportTextOnly": "Nur-Text-Export auf Anfrage",
  "privacy.ariaLabel": "Datenschutzmodus",
  "settings.localApi.title": "Lokale API",
  "settings.localApi.description":
    "Sonolect kann Aufnahmen an eine lokale HTTP-API senden oder offline bleiben, wenn keine URL konfiguriert ist.",
  "settings.localApi.url": "Konfigurierte URL",
  "settings.localApi.configured":
    "Der Upload über die lokale API ist für neue Aufnahmen aktiviert.",
  "settings.localApi.offline":
    "Keine API-URL konfiguriert; Aufnahmen bleiben lokal/offline.",
  "settings.whisper.title": "Lokale Whisper-Einrichtung",
  "settings.whisper.description":
    "Verwenden Sie Ihren eigenen whisper.cpp-, OpenAI Whisper- oder faster-whisper-Wrapper. Sonolect speichert nur Befehlseinstellungen; kein großes Modell ist enthalten.",
  "settings.whisper.install":
    "Installieren Sie eine Whisper-kompatible Binärdatei oder einen Python-Wrapper auf diesem Computer.",
  "settings.whisper.download":
    "Laden Sie eine Modelldatei selbst herunter und bewahren Sie sie in einem lokalen Ordner auf, den Sie kontrollieren.",
  "settings.whisper.env":
    "Starten Sie die Desktop-App mit dieser Umgebungsvariable, die auf das untenstehende argv-JSON gesetzt ist",
  "settings.whisper.modelPath": "Modellpfad oder Modell-ID",
  "settings.whisper.modelName": "Modellbezeichnung",
  "settings.whisper.commandArgs": "Befehlsargumente JSON",
  "settings.whisper.saveCommand": "Befehl speichern",
  "settings.whisper.validate": "Einrichtung validieren",
  "settings.whisper.status": "Status",
  "settings.whisper.preview": "Vorschau",
  "settings.whisper.envValue": "Umgebungsvariablenwert",
  "settings.whisper.catalog": "Empfohlene lokale Ressourcen",
  "settings.whisper.recommendedModel": "Herunterzuladendes Modell",
  "settings.whisper.defaultBinary": "Standard-Binärpfad",
  "settings.whisper.defaultModel": "Standard-Modellpfad",
  "settings.whisper.downloadUrl": "Modell-Download",
  "settings.whisper.usePlan": "Empfohlene Befehlsvorlage verwenden",
  "settings.whisper.planApplied":
    "Empfohlene Whisper-Befehlsvorlage angewendet. Fügen Sie Ihren echten Modellpfad vor dem Testen hinzu.",
  "settings.whisper.commandJsonInvalid":
    "Befehlsargumente müssen ein gültiges JSON-String-Array sein.",
  "settings.whisper.commandSaved": "Whisper-Befehl lokal gespeichert.",

  "agents.title": "Intelligente Aktionen",
  "agents.preview": "Vorschau",
  "agents.notion.title": "Notion-Notiz erstellen",
  "agents.notion.description":
    "Veröffentlicht die strukturierte Zusammenfassung mit Entscheidungen, Risiken und nächsten Schritten.",
  "agents.linear.title": "3 Linear-Tickets öffnen",
  "agents.linear.description":
    "Teilt die Transkription in Issues mit vorgeschlagenen Prioritäten, Labels und Verantwortlichen auf.",
  "agents.mail.title": "Premium-E-Mail verfassen",
  "agents.mail.description":
    "Wandelt den Sprachentwurf in eine klare, freundliche und versandfertige Nachricht um.",

  "recorder.ariaLabel": "Sonolect Sprachrekorder",
  "recorder.close": "Schließen",
  "recorder.stopCapture": "Aufnahme beenden",
  "recorder.newCapture": "Neue Aufnahme",
  "recorder.listenDownload": "Anhören / herunterladen",
  "recorder.kb": "KB",

  "voice.permission.eyebrow": "Mikrofonberechtigung",
  "voice.permission.title": "Mikrofonzugriff erlauben",
  "voice.permission.detail":
    "Sonolect fordert navigator.mediaDevices.getUserMedia({ audio: true }) an.",
  "voice.recording.eyebrow": "Aktives Zuhören",
  "voice.recording.title": "Sprechen Sie, Sonolect nimmt Ihre Stimme auf",
  "voice.recording.detail":
    "MediaRecorder sammelt Audiofragmente lokal bis zum Stopp.",
  "voice.uploading.eyebrow": "Transkription wird gesendet",
  "voice.uploading.title": "Backend-Aufgabe wird vorbereitet…",
  "voice.uploading.detailConfigured":
    "Aufnahme abgeschlossen: Senden an den über VITE_SONOLECT_API_URL konfigurierten Endpunkt.",
  "voice.uploading.detailOffline":
    "Kein Backend konfiguriert: Wechsel in den expliziten Lokal-/Offline-Modus.",
  "voice.completed.eyebrowOffline": "Abgeschlossen · offline",
  "voice.completed.eyebrow": "Abgeschlossen",
  "voice.completed.titleOffline": "Lokale Aufnahme bereit",
  "voice.completed.title": "Aufnahme gesendet",
  "voice.completed.detailFallback":
    "Audio-Blob, Dauer, MIME-Typ und lokale URL wurden erstellt.",
  "voice.error.eyebrow": "Aufnahmefehler",
  "voice.error.title": "Die Aufnahme konnte nicht abgeschlossen werden",
  "voice.error.detailFallback": "Ein unbekannter Fehler ist aufgetreten.",
  "voice.default.eyebrow": "Bereit",
  "voice.default.title": "Sprachaufnahme",
  "voice.default.detail": "Klicken Sie, um zu starten.",

  "palette.prompt": "Was möchten Sie mit Ihrer Stimme tun?",
  "palette.ariaLabel": "Befehlspalette",
  "palette.newCapture": "Neue Sprachaufnahme",
  "palette.newCaptureHint": "Mikrofon-Overlay starten",
  "palette.openHistory": "Verlauf öffnen",
  "palette.openHistoryHint": "Eine Transkription finden",
  "palette.agentCenter": "Agentenzentrale",
  "palette.agentCenterHint": "Verbundene Aktionen anzeigen",
  "palette.privacySettings": "Datenschutzeinstellungen",
  "palette.privacySettingsHint": "Local-first, Cloud, Aufbewahrung",

  "error.micUnavailable":
    "Mikrofonaufnahme ist in dieser Umgebung nicht verfügbar.",
  "error.mediaRecorderUnsupported":
    "MediaRecorder wird von dieser Desktop-Laufzeitumgebung nicht unterstützt.",
  "error.recordingError": "Fehler bei der Audioaufnahme.",
  "error.sendFailed":
    "Die Aufnahme konnte nicht an das Backend gesendet werden.",
  "error.micPermissionDenied":
    "Mikrofonberechtigung verweigert oder nicht verfügbar.",
  "error.historyLoadFailed":
    "Der Transkriptionsverlauf konnte nicht geladen werden.",
  "error.detailLoadFailed":
    "Transkriptionsdetails konnten nicht geöffnet werden.",

  "fallback.localCapture":
    "[Lokale Sprachaufnahme] {duration} · {mimeType} · {size} KB. Backend nicht konfiguriert (VITE_SONOLECT_API_URL).",
  "fallback.sentCapture":
    "[Gesendete Sprachaufnahme] Aufgabe {jobId} · {duration}.",

  initialTranscript:
    "Ziel: eine Premium-Demo von Sonolect Desktop vorbereiten.\n\nFokus auf ein Voice-first-Erlebnis: globaler Shortcut, sofortiges Mikrofon-Overlay, bearbeitbare Transkription, dann intelligente Aktionen.\n\nGewünschter Ton: professionelles Deutsch, direkt, elegant. Nächste Aktion: ein Investoren-Briefing und drei Linear-Tickets erstellen.",

  "workspace.ariaLabel": "Sonolect-Arbeitsbereich",

  "history.unknownDuration": "Unbekannte Dauer",
  "history.unknownDate": "Unbekanntes Datum",
  "history.pendingContent": "Transkription wartet auf Inhalt.",
  "history.offlineMessage":
    "VITE_SONOLECT_API_URL fehlt: Demo-Verlauf lokal gespeichert.",

  "voiceApi.offlineNoUrl":
    "VITE_SONOLECT_API_URL fehlt: Aufnahme lokal gespeichert ohne Backend-Upload.",
  "voiceApi.backendUnavailable":
    "Lokales Backend nicht verfügbar: Aufnahme lokal gespeichert",

  "toast.transformComplete": "Transkription erfolgreich transformiert",
  "toast.copySuccess": "Transkription in die Zwischenablage kopiert",
  "toast.insertionReady": "Aufbereitetes Diktat zum Einfügen bereit",

  "editor.transforming": "Wird transformiert…",

  "editor.copy": "Kopieren",
  "editor.download": "Herunterladen",

  "palette.searchPlaceholder": "Befehle suchen…",
  "palette.noResults": "Keine Ergebnisse",

  "pill.permitting": "Mikrofonzugriff…",
  "pill.processing": "Verarbeitung…",
  "pill.done": "Fertig",
  "pill.error": "Fehler",
  "pill.stop": "Stopp",
  "pill.again": "Erneut",

  "audio.recentCapture": "Aktuelle Aufnahme",
  "audio.playPause": "Audio abspielen oder pausieren",
  "audio.waveform": "Audio-Wellenform",

  // Note sync between devices
  "studio.sync.title": "Synchronisierung zwischen Geräten",
  "studio.sync.subtitle":
    "Ihre Notizen auf all Ihren Geräten, Ende-zu-Ende-verschlüsselt: Der Synchronisierungsserver speichert sie, kann sie aber nicht lesen.",
  "studio.sync.server": "Synchronisierungsserver: {server}",
  "studio.sync.audioStays":
    "Aufnahmen bleiben auf dem Gerät, das sie gemacht hat. Nur die Notizen werden synchronisiert.",
  "studio.sync.offState": "Die Synchronisierung ist aus.",
  "studio.sync.onState": "Die Synchronisierung ist an.",
  "studio.sync.turnOn": "Synchronisierung einschalten",
  "studio.sync.turningOn": "Wird eingeschaltet…",
  "studio.sync.join": "Mit einem Code beitreten",
  "studio.sync.joinLabel":
    "Synchronisierungscode oder -link von Ihrem anderen Gerät",
  "studio.sync.joinSubmit": "Beitreten",
  "studio.sync.joining": "Wird beigetreten…",
  "studio.sync.cancel": "Abbrechen",
  "studio.sync.warning":
    "Beitreten teilt jede Notiz mit allen, die diesen Code haben.",
  "studio.sync.lastSync": "Zuletzt synchronisiert: {time}.",
  "studio.sync.neverSynced": "Noch nicht synchronisiert.",
  "studio.sync.syncing": "Wird synchronisiert…",
  "studio.sync.syncNow": "Jetzt synchronisieren",
  "studio.sync.showCode": "Code anzeigen",
  "studio.sync.hideCode": "Code ausblenden",
  "studio.sync.codeHint":
    "Wählen Sie auf Ihrem anderen Gerät, der Synchronisierung beizutreten, und scannen Sie dann diesen QR-Code oder geben Sie den Code ein.",
  "studio.sync.codeLabel": "Synchronisierungscode",
  "studio.sync.qrLabel": "QR-Code zum Beitreten dieser Synchronisierung",
  "studio.sync.turnOff": "Synchronisierung ausschalten",
  "studio.sync.turnOffQuestion":
    "Synchronisierung auf diesem Gerät ausschalten?",
  "studio.sync.keepServer": "Serverkopie behalten",
  "studio.sync.keepServerHint":
    "Ihre anderen Geräte synchronisieren weiter. Dieses Gerät kann mit dem Code wieder beitreten.",
  "studio.sync.deleteServer": "Serverkopie löschen",
  "studio.sync.deleteServerHint":
    "Ihre anderen Geräte sehen „Diese Synchronisierung wurde gelöscht“ und schalten die Synchronisierung aus. Jedes Gerät behält seine Notizen.",
  "studio.sync.turningOff": "Wird ausgeschaltet…",
  "studio.sync.notesKept": "Ihre Notizen bleiben auf diesem Gerät.",
  "studio.sync.error.unauthorized":
    "Der Server akzeptiert diesen Synchronisierungsschlüssel nicht.",
  "studio.sync.error.deleted": "Diese Synchronisierung wurde gelöscht.",
  "studio.sync.error.tooLarge": "Eine Notiz ist zu groß zum Synchronisieren.",
  "studio.sync.error.server":
    "Die Synchronisierung ist gerade nicht verfügbar.",
  "studio.sync.error.offline":
    "Offline. Notizen werden synchronisiert, sobald Sie wieder online sind.",
  "studio.sync.notice.quota":
    "Der Synchronisierungsspeicher ist voll. Löschen Sie Notizen, um neue zu synchronisieren.",
  "studio.sync.notice.newerSchema":
    "Aktualisieren Sie Sonolect, um alle Notizen zu synchronisieren.",
  "studio.sync.pairing.invalid": "Das ist kein Sonolect-Synchronisierungscode.",
  "studio.sync.pairing.version":
    "Aktualisieren Sie Sonolect, um diesen Code zu verwenden.",
  "studio.sync.pairing.length": "Prüfen Sie den Code: Er hat 56 Zeichen.",
  "studio.sync.pairing.typo": "Ein Zeichen ist falsch.",
  "studio.sync.preview":
    "Die Synchronisierung funktioniert in der installierten App.",
  "studio.sync.deleteAllHint":
    "Die Synchronisierung wird auf diesem Gerät ebenfalls ausgeschaltet.",
  "studio.sync.deleteAllServer":
    "Die Synchronisierung ist an. Auch die Serverkopie Ihrer Notizen löschen? OK löscht sie: Ihre anderen Geräte schalten die Synchronisierung aus und behalten ihre Notizen. Abbrechen behält sie für diese Geräte.",
  "studio.privacy.problemSync": "Synchronisierung: {reason}",
  "studio.library.synced": "Synchronisiert",
  "studio.library.noAudio":
    "Die Aufnahme bleibt auf dem Gerät, das sie gemacht hat.",
  "studio.library.conflictOf": "Konfliktkopie der Notiz vom {date}",
  "studio.library.conflictCopy": "Konfliktkopie",
  "native.syncNotAvailable":
    "Die Synchronisierung ist in dieser Version von Sonolect nicht verfügbar.",
  "native.syncKeychainLinux":
    "Die Synchronisierung ist auf diesem System nicht verfügbar: Sie bewahrt ihren Schlüssel in einem Schlüsselbund auf (Secret Service, etwa GNOME Keyring oder KWallet), und es läuft keiner.",
  "native.syncKeychainUnavailable":
    "Die Synchronisierung ist auf diesem System nicht verfügbar: Der Schlüsselbund konnte nicht geöffnet werden.",
  "native.syncKeychainFailed":
    "Der Synchronisierungsschlüssel konnte im Schlüsselbund nicht gelesen oder gespeichert werden.",
  "native.syncInvalidKey": "Das ist kein gültiger Synchronisierungsschlüssel.",
  "native.syncKeyExists":
    "Die Synchronisierung ist bereits mit einem anderen Schlüssel an. Schalten Sie sie zuerst aus.",
  "native.syncStateFailed":
    "Der Synchronisierungsstatus konnte nicht gespeichert werden.",
  "native.syncInterrupted": "Die Synchronisierung wurde unterbrochen.",
  "native.syncInvalidNote": "Ungültige synchronisierte Notiz.",
};
