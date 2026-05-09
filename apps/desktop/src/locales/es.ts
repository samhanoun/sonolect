import type { LocaleKeys } from "./en";

export const es: Record<LocaleKeys, string> = {
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
};
