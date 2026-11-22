import type { LocaleKeys } from "./en";

export const es: Partial<Record<LocaleKeys, string>> = {
  "nav.today": "Hoy",
  "nav.history": "Historial",
  "nav.agents": "Agentes",
  "nav.settings": "Configuración",
  "nav.onboarding": "Configuración inicial",
  "nav.dictionary": "Diccionario",
  "nav.home": "Inicio",
  "nav.snippets": "Fragmentos",
  "nav.transforms": "Transformaciones",
  "nav.reader": "Lector",
  "nav.team": "Equipo",
  "nav.meeting": "Reunión",

  "sidebar.recordNow": "Grabar ahora",
  "sidebar.lastDictations": "Últimos dictados",
  "sidebar.loadingHistory": "Cargando historial…",

  "topbar.eyebrow": "Shell de escritorio premium",
  "topbar.headline": "Captura de voz → texto → acciones",
  "topbar.searchCommand": "Buscar un comando",
  "topbar.localFirst": "Local-first",
  "topbar.cloudAssisted": "Asistido por la nube",
  "topbar.apiReady": "API lista",
  "topbar.offline": "Sin conexión",

  "home.welcome": "Bienvenido de vuelta",
  "home.banner": "Tu espacio de trabajo por voz está listo.",
  "home.noTranscripts":
    "Aún no hay transcripciones. Presiona Grabar para comenzar.",
  "home.backToTimeline": "← Volver",

  "stats.title": "Estadísticas",
  "stats.totalWords": "palabras totales",
  "stats.wpm": "PPM",
  "stats.dayStreak": "días consecutivos",

  "editor.eyebrow": "Transcripción editable",
  "editor.fallbackTitle": "Resumen vocal enriquecido",
  "editor.modeSummary": "Resumen",
  "editor.modeEmail": "Correo",
  "editor.modeTicket": "Ticket",
  "editor.voiceCanvas": "Lienzo de voz en tiempo real",
  "editor.voiceCanvasSubtitle":
    "Captura, transcripción local y transformación inteligente.",
  "editor.wordCount": "palabras",
  "editor.language": "Idioma: Español",
  "editor.transformCta": "Transformar con Sonolect",
  "editor.textareaLabel": "Editor de transcripción",
  "editor.draftRestored":
    "Se recuperó tu borrador local no guardado después del reinicio.",
  "editor.historyControls":
    "Controles del historial de edición de transcripción",
  "editor.undo": "Deshacer",
  "editor.redo": "Rehacer",

  "segments.ariaLabel": "Editor de segmentos de transcripción",
  "segments.title": "Segmentos",
  "segments.count": "segmentos",
  "segments.merge": "Fusionar selección",
  "segments.split": "Dividir selección",
  "segments.empty":
    "Escribe texto de transcripción para crear segmentos editables.",
  "segments.segment": "Segmento",
  "segments.speaker": "Hablante",
  "segments.speakerPlaceholder": "Etiqueta del hablante",
  "segments.textLabel": "Texto del segmento",

  "privacy.title": "Privacidad",
  "privacy.heading": "Control de voz",
  "privacy.description":
    "Elige dónde se procesan las capturas de audio y los borradores de transcripción.",
  "privacy.local": "Local",
  "privacy.cloud": "Nube",
  "privacy.autoDelete": "Eliminación automática después de 24h",
  "privacy.maskNames": "Enmascaramiento de nombres propios sensibles",
  "privacy.exportTextOnly": "Exportación solo texto bajo demanda",
  "privacy.ariaLabel": "Modo de privacidad",
  "settings.localApi.title": "API local",
  "settings.localApi.description":
    "Sonolect puede enviar capturas a una API HTTP local, o permanecer sin conexión cuando no hay una URL configurada.",
  "settings.localApi.url": "URL configurada",
  "settings.localApi.configured":
    "La carga a la API local está habilitada para nuevas capturas.",
  "settings.localApi.offline":
    "No hay URL de API configurada; las capturas permanecen locales/sin conexión.",
  "settings.whisper.title": "Configuración local de Whisper",
  "settings.whisper.description":
    "Usa tu propio whisper.cpp, OpenAI Whisper o faster-whisper. Sonolect solo almacena la configuración de comandos; no incluye modelos grandes.",
  "settings.whisper.install":
    "Instala un binario compatible con Whisper o un wrapper de Python en esta computadora.",
  "settings.whisper.download":
    "Descarga un archivo de modelo por tu cuenta y guárdalo en una carpeta local que tú controles.",
  "settings.whisper.env":
    "Inicia la aplicación de escritorio con esta variable de entorno configurada con el JSON argv de abajo",
  "settings.whisper.modelPath": "Ruta del modelo o identificador",
  "settings.whisper.modelName": "Etiqueta del modelo",
  "settings.whisper.commandArgs": "JSON de argumentos del comando",
  "settings.whisper.saveCommand": "Guardar comando",
  "settings.whisper.validate": "Validar configuración",
  "settings.whisper.status": "Estado",
  "settings.whisper.preview": "Vista previa",
  "settings.whisper.envValue": "Valor de la variable de entorno",
  "settings.whisper.catalog": "Recursos locales recomendados",
  "settings.whisper.recommendedModel": "Modelo para descargar",
  "settings.whisper.defaultBinary": "Ruta del binario predeterminado",
  "settings.whisper.defaultModel": "Ruta del modelo predeterminado",
  "settings.whisper.downloadUrl": "Descarga del modelo",
  "settings.whisper.usePlan": "Usar plantilla de comando recomendada",
  "settings.whisper.planApplied":
    "Se aplicó la plantilla de comando de Whisper recomendada. Agrega la ruta real del modelo antes de probar.",
  "settings.whisper.commandJsonInvalid":
    "Los argumentos del comando deben ser un arreglo JSON válido de cadenas de texto.",
  "settings.whisper.commandSaved": "Comando de Whisper guardado localmente.",

  "agents.title": "Acciones inteligentes",
  "agents.preview": "Vista previa",
  "agents.notion.title": "Crear una nota en Notion",
  "agents.notion.description":
    "Publica el resumen estructurado con decisiones, riesgos y próximos pasos.",
  "agents.linear.title": "Abrir 3 tickets en Linear",
  "agents.linear.description":
    "Divide la transcripción en issues con prioridades, etiquetas y responsables sugeridos.",
  "agents.mail.title": "Redactar un correo premium",
  "agents.mail.description":
    "Convierte el borrador de voz en un mensaje claro y cálido listo para enviar.",

  "recorder.ariaLabel": "Grabadora de voz Sonolect",
  "recorder.close": "Cerrar",
  "recorder.stopCapture": "Detener captura",
  "recorder.newCapture": "Nueva captura",
  "recorder.listenDownload": "Escuchar / descargar",
  "recorder.kb": "KB",

  "voice.permission.eyebrow": "Permiso de micrófono",
  "voice.permission.title": "Permite el acceso al micrófono",
  "voice.permission.detail":
    "Sonolect solicita navigator.mediaDevices.getUserMedia({ audio: true }).",
  "voice.recording.eyebrow": "Escucha activa",
  "voice.recording.title": "Habla, Sonolect está capturando tu voz",
  "voice.recording.detail":
    "MediaRecorder recopila fragmentos de audio localmente hasta que se detenga.",
  "voice.uploading.eyebrow": "Enviando transcripción",
  "voice.uploading.title": "Preparando tarea del servidor…",
  "voice.uploading.detailConfigured":
    "Captura completada: enviando al endpoint configurado por VITE_SONOLECT_API_URL.",
  "voice.uploading.detailOffline":
    "No hay servidor configurado: cambiando al modo local/sin conexión.",
  "voice.completed.eyebrowOffline": "Completado · sin conexión",
  "voice.completed.eyebrow": "Completado",
  "voice.completed.titleOffline": "Captura local lista",
  "voice.completed.title": "Captura enviada",
  "voice.completed.detailFallback":
    "Se crearon el blob de audio, la duración, el tipo MIME y la URL local.",
  "voice.error.eyebrow": "Error de captura",
  "voice.error.title": "No se pudo finalizar la grabación",
  "voice.error.detailFallback": "Ocurrió un error desconocido.",
  "voice.default.eyebrow": "Listo",
  "voice.default.title": "Captura de voz",
  "voice.default.detail": "Haz clic para comenzar.",

  "palette.prompt": "¿Qué quieres hacer con tu voz?",
  "palette.ariaLabel": "Paleta de comandos",
  "palette.newCapture": "Nueva captura de voz",
  "palette.newCaptureHint": "Iniciar la interfaz del micrófono",
  "palette.openHistory": "Abrir historial",
  "palette.openHistoryHint": "Buscar una transcripción",
  "palette.agentCenter": "Centro de agentes",
  "palette.agentCenterHint": "Ver acciones conectadas",
  "palette.privacySettings": "Configuración de privacidad",
  "palette.privacySettingsHint": "Local-first, nube, retención",

  "error.micUnavailable":
    "La captura de micrófono no está disponible en este entorno.",
  "error.mediaRecorderUnsupported":
    "MediaRecorder no es compatible con este entorno de escritorio.",
  "error.recordingError": "Error durante la grabación de audio.",
  "error.sendFailed": "No se pudo enviar la captura al servidor.",
  "error.micPermissionDenied": "Permiso de micrófono denegado o no disponible.",
  "error.historyLoadFailed":
    "No se pudo cargar el historial de transcripciones.",
  "error.detailLoadFailed": "No se pudo abrir el detalle de la transcripción.",

  "fallback.localCapture":
    "[Captura de voz local] {duration} · {mimeType} · {size} KB. Servidor no configurado (VITE_SONOLECT_API_URL).",
  "fallback.sentCapture":
    "[Captura de voz enviada] Tarea {jobId} · {duration}.",

  initialTranscript:
    "Objetivo: preparar una demostración premium de Sonolect desktop.\n\nEnfoque en una experiencia voz-first: atajo global, interfaz de micrófono inmediata, transcripción editable y luego acciones inteligentes.\n\nTono deseado: español profesional, directo, elegante. Próxima acción: generar un resumen para inversionistas y tres tickets de Linear.",

  "workspace.ariaLabel": "Espacio de trabajo Sonolect",

  "history.unknownDuration": "Duración desconocida",
  "history.unknownDate": "Fecha desconocida",
  "history.pendingContent": "Transcripción pendiente de contenido.",
  "history.offlineMessage":
    "VITE_SONOLECT_API_URL ausente: historial de demostración guardado localmente.",

  "voiceApi.offlineNoUrl":
    "VITE_SONOLECT_API_URL ausente: captura guardada localmente sin envío al servidor.",
  "voiceApi.backendUnavailable":
    "Servidor local no disponible: captura guardada localmente",

  "toast.transformComplete": "Transcripción transformada exitosamente",
  "toast.copySuccess": "Transcripción copiada al portapapeles",
  "toast.insertionReady": "Dictado pulido listo para pegar",

  "editor.transforming": "Transformando…",

  "editor.copy": "Copiar",
  "editor.download": "Descargar",

  "palette.searchPlaceholder": "Buscar comandos…",
  "palette.noResults": "Sin resultados",

  "pill.permitting": "Acceso al micrófono…",
  "pill.processing": "Procesando…",
  "pill.done": "Listo",
  "pill.error": "Error",
  "pill.stop": "Detener",
  "pill.again": "Repetir",

  "audio.recentCapture": "Captura reciente",
  "audio.playPause": "Reproducir o pausar audio",
  "audio.waveform": "Forma de onda de audio",

  // Note sync between devices
  "studio.sync.title": "Sincronización entre dispositivos",
  "studio.sync.subtitle":
    "Tus notas en todos tus dispositivos, cifradas de extremo a extremo: el servidor de sincronización las guarda, pero no puede leerlas.",
  "studio.sync.server": "Servidor de sincronización: {server}",
  "studio.sync.audioStays":
    "Las grabaciones se quedan en el dispositivo que las hizo. Solo se sincronizan las notas.",
  "studio.sync.offState": "La sincronización está desactivada.",
  "studio.sync.onState": "La sincronización está activada.",
  "studio.sync.turnOn": "Activar la sincronización",
  "studio.sync.turningOn": "Activando…",
  "studio.sync.join": "Unirse con un código",
  "studio.sync.joinLabel": "Código de sincronización de tu otro dispositivo",
  "studio.sync.joinSubmit": "Unirse",
  "studio.sync.joining": "Uniéndose…",
  "studio.sync.cancel": "Cancelar",
  "studio.sync.warning":
    "Unirse comparte cada nota con quien tenga este código.",
  "studio.sync.lastSync": "Última sincronización: {time}.",
  "studio.sync.neverSynced": "Aún no se ha sincronizado.",
  "studio.sync.syncing": "Sincronizando…",
  "studio.sync.syncNow": "Sincronizar ahora",
  "studio.sync.showCode": "Mostrar el código",
  "studio.sync.hideCode": "Ocultar el código",
  "studio.sync.codeHint":
    "En tu teléfono, escanea este código QR con Sonolect (Settings, Sync, Scan code), no con la app de cámara. En otro ordenador, elige «Unirse con un código» y escribe el código.",
  "studio.sync.codeLabel": "Código de sincronización",
  "studio.sync.qrLabel": "Código QR para unirse a esta sincronización",
  "studio.sync.turnOff": "Desactivar la sincronización",
  "studio.sync.turnOffQuestion":
    "¿Desactivar la sincronización en este dispositivo?",
  "studio.sync.keepServer": "Conservar la copia del servidor",
  "studio.sync.keepServerHint":
    "Tus otros dispositivos siguen sincronizándose. Este podrá volver a unirse con el código.",
  "studio.sync.deleteServer": "Eliminar la copia del servidor",
  "studio.sync.deleteServerHint":
    "Tus otros dispositivos verán «Esta sincronización se eliminó» y desactivarán la sincronización. Cada dispositivo conserva sus notas.",
  "studio.sync.turningOff": "Desactivando…",
  "studio.sync.notesKept": "Tus notas se quedan en este dispositivo.",
  "studio.sync.error.unauthorized":
    "El servidor no acepta esta clave de sincronización.",
  "studio.sync.error.deleted": "Esta sincronización se eliminó.",
  "studio.sync.error.tooLarge":
    "Una nota es demasiado grande para sincronizarse.",
  "studio.sync.error.server":
    "La sincronización no está disponible en este momento.",
  "studio.sync.error.offline":
    "Sin conexión. Las notas se sincronizarán cuando vuelvas a estar en línea.",
  "studio.sync.notice.quota":
    "El almacenamiento de sincronización está lleno. Elimina notas para sincronizar las nuevas.",
  "studio.sync.notice.newerSchema":
    "Actualiza Sonolect para sincronizar todas las notas.",
  "studio.sync.pairing.invalid":
    "Este no es un código de sincronización de Sonolect.",
  "studio.sync.pairing.version": "Actualiza Sonolect para usar este código.",
  "studio.sync.pairing.length": "Revisa el código: tiene 56 caracteres.",
  "studio.sync.pairing.typo": "Un carácter es incorrecto.",
  "studio.sync.preview":
    "La sincronización funciona en la aplicación instalada.",
  "studio.sync.deleteAllHint":
    "La sincronización también se desactiva en este dispositivo.",
  "studio.sync.deleteAllServer":
    "La sincronización está activada. ¿Eliminar también la copia de tus notas en el servidor? Aceptar la elimina: tus otros dispositivos desactivan la sincronización y conservan sus notas. Cancelar la conserva para ellos.",
  "studio.privacy.problemSync": "Sincronización: {reason}",
  "studio.library.synced": "Sincronizada",
  "studio.library.noAudio":
    "La grabación se queda en el dispositivo que la hizo.",
  "studio.library.conflictOf": "Copia en conflicto de la nota del {date}",
  "studio.library.conflictCopy": "Copia en conflicto",
  "native.syncNotAvailable":
    "La sincronización no está disponible en esta versión de Sonolect.",
  "native.syncKeychainLinux":
    "La sincronización no está disponible en este sistema: guarda su clave en un llavero (Secret Service, como GNOME Keyring o KWallet) y no hay ninguno en ejecución.",
  "native.syncKeychainUnavailable":
    "La sincronización no está disponible en este sistema: no se pudo abrir el llavero.",
  "native.syncKeychainFailed":
    "No se pudo leer ni guardar la clave de sincronización en el llavero.",
  "native.syncInvalidKey": "Esta no es una clave de sincronización válida.",
  "native.syncKeyExists":
    "La sincronización ya está activada con otra clave. Desactívala primero.",
  "native.syncStateFailed":
    "No se pudo guardar el estado de la sincronización.",
  "native.syncInterrupted": "La sincronización se interrumpió.",
  "native.syncInvalidNote": "Nota sincronizada no válida.",
  // Speaker detection
  "studio.speakers.detect": "Detectar hablantes",
  "studio.speakers.count": "Hablantes",
  "studio.speakers.auto": "Automático",
  "studio.speakers.label": "Hablante {number}",
  "studio.speakers.consent":
    "¿Descargar el modelo de hablantes de {size}? Tu audio se queda en este dispositivo.",
  "studio.speakers.download": "Descargar",
  "studio.speakers.notNow": "Ahora no",
  "studio.speakers.downloading":
    "Descargando el modelo de hablantes… {progress}\u00a0%",
  "studio.speakers.keepOrReplace":
    "Algunos segmentos ya tienen nombre. ¿Conservarlos o reemplazarlos?",
  "studio.speakers.keep": "Conservar nombres",
  "studio.speakers.replace": "Reemplazar nombres",
  "studio.speakers.cancel": "Cancelar",
  "studio.speakers.detecting": "Detectando hablantes… {progress}\u00a0%",
  "studio.speakers.found.one": "Se encontró {count} hablante.",
  "studio.speakers.found.other": "Se encontraron {count} hablantes.",
  "studio.speakers.noSpeech": "No se encontró voz en esta grabación.",
  "studio.speakers.stale":
    "Se abrió otra transcripción, así que no se cambió ningún nombre.",
  "studio.speakers.legend": "Hablantes de esta transcripción",
  "studio.speakers.rename": "Renombrar {name} en todas partes",
  "studio.speakers.segments.one": "{count} segmento",
  "studio.speakers.segments.other": "{count} segmentos",
  "studio.settings.speakerModelTitle": "Modelo de hablantes",
  "studio.settings.speakerModelMeta": "Detección de hablantes · CPU",
  "studio.settings.speakerModelReady":
    "El modelo de hablantes está en este equipo.",
  "studio.settings.speakerModelMissing":
    "Descárgalo una vez para detectar quién habla en una grabación. Tu audio se queda en este dispositivo.",
  "studio.settings.speakerModelInstall": "Descargar el modelo de hablantes",
  "studio.settings.speakerModelReinstall": "Reinstalar el modelo de hablantes",
  "studio.settings.speakerModelDownloaded":
    "Modelo de hablantes descargado y suma de verificación comprobada.",
  "native.speakersCancelled": "Se canceló la detección de hablantes.",
  "native.speakersBusy": "La detección de hablantes ya está en curso.",
  "native.speakerCount": "Elige entre 2 y 8 hablantes.",
  "native.speakerModelMissing": "Descarga primero el modelo de hablantes.",
  "native.speakerModelDamaged":
    "El modelo de hablantes estaba dañado y se eliminó. Descárgalo de nuevo.",
  "native.speakersStillRecording":
    "Termina la grabación antes de detectar hablantes.",
  "native.speakerModelUnreadable":
    "No se puede leer el modelo de hablantes: {reason}",
  "native.speakerModelLoad":
    "No se puede cargar el modelo de hablantes: {reason}",
  "native.speakerModelFailed": "El modelo de hablantes falló: {reason}",
  // High-quality recording
  "studio.storage.format": "Guardar grabaciones como",
  "studio.storage.wav": "Calidad de voz (WAV, 16 kHz mono)",
  "studio.storage.opus": "Calidad de voz, comprimido (Opus, 10× más pequeño)",
  "studio.storage.hq":
    "Alta calidad (Opus, 48 kHz, estéreo si la fuente lo es)",
  "studio.storage.savedWav":
    "Las grabaciones nuevas se guardan en WAV, con calidad de voz. Las que ya están comprimidas siguen comprimidas.",
  "studio.storage.savedHq":
    "Las grabaciones nuevas se guardan a 48 kHz, en estéreo si la fuente lo es. Los archivos importados y las grabaciones anteriores se comprimen con calidad de voz.",
  "studio.signal.meta": "16 kHz · mono · en el dispositivo",
  "studio.signal.metaHigh":
    "48 kHz · estéreo si está disponible · en el dispositivo",
  "studio.library.saveAudio": "Guardar audio",
  "studio.source.systemHint":
    "El botón de grabar graba lo que suena en este ordenador, como una reunión o un vídeo. También lo hace un atajo de dictado pulsado mientras Sonolect está en primer plano. El dictado en otras apps y la burbuja siempre usan el micrófono.",
  "native.invalidPcmFormat":
    "Frecuencia de muestreo o número de canales no válidos.",
  "native.invalidPcmFrames":
    "Audio PCM de 16 bits o tamaño de trama no válido.",
  "native.pcmFormatChanged": "El formato de audio cambió durante la grabación.",
  "native.invalidQuality": "Calidad de grabación no válida.",
  "native.cannotConvert": "No se puede convertir el audio: {reason}",
};
