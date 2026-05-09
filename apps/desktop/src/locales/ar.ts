import type { LocaleKeys } from "./en";

export const ar: Record<LocaleKeys, string> = {
  "nav.today": "اليوم",
  "nav.history": "السجل",
  "nav.agents": "الوكلاء",
  "nav.settings": "الإعدادات",
  "nav.onboarding": "الإعداد",
  "nav.dictionary": "القاموس",
  "nav.home": "الرئيسية",
  "nav.snippets": "المقتطفات",
  "nav.transforms": "التحويلات",
  "nav.reader": "القارئ",
  "nav.team": "الفريق",
  "nav.meeting": "الاجتماع",

  "sidebar.recordNow": "سجّل الآن",
  "sidebar.lastDictations": "آخر الإملاءات",
  "sidebar.loadingHistory": "جارٍ تحميل السجل…",

  "topbar.eyebrow": "واجهة سطح مكتب متقدمة",
  "topbar.headline": "التقاط صوتي → نص → إجراءات",
  "topbar.searchCommand": "ابحث عن أمر",
  "topbar.localFirst": "محلي أولاً",
  "topbar.cloudAssisted": "بمساعدة السحابة",
  "topbar.apiReady": "API جاهزة",
  "topbar.offline": "غير متصل",

  "home.welcome": "مرحباً بعودتك",
  "home.banner": "مساحة عملك الصوتية جاهزة.",
  "home.noTranscripts": "لا توجد نصوص مفرّغة بعد. اضغط على تسجيل للبدء.",
  "home.backToTimeline": "→ رجوع",

  "stats.title": "إحصاءات",
  "stats.totalWords": "إجمالي الكلمات",
  "stats.wpm": "كلمة/د",
  "stats.dayStreak": "أيام متتالية",

  "editor.eyebrow": "تفريغ قابل للتحرير",
  "editor.fallbackTitle": "ملخص صوتي مُثرى",
  "editor.modeSummary": "ملخص",
  "editor.modeEmail": "بريد إلكتروني",
  "editor.modeTicket": "تذكرة",
  "editor.voiceCanvas": "لوحة صوتية فورية",
  "editor.voiceCanvasSubtitle": "التقاط، تفريغ محلي وتحويل ذكي.",
  "editor.wordCount": "كلمات",
  "editor.language": "اللغة: العربية",
  "editor.transformCta": "حوّل باستخدام Sonolect",
  "editor.textareaLabel": "محرر التفريغ",
  "editor.draftRestored":
    "تمت استعادة المسودة المحلية غير المحفوظة بعد إعادة التشغيل.",
  "editor.historyControls": "أدوات التحكم بسجل تعديلات التفريغ",
  "editor.undo": "تراجع",
  "editor.redo": "إعادة",

  "segments.ariaLabel": "محرر مقاطع التفريغ",
  "segments.title": "المقاطع",
  "segments.count": "مقاطع",
  "segments.merge": "دمج المحدد",
  "segments.split": "تقسيم المحدد",
  "segments.empty": "اكتب نص التفريغ لإنشاء مقاطع قابلة للتحرير.",
  "segments.segment": "مقطع",
  "segments.speaker": "المتحدث",
  "segments.speakerPlaceholder": "تسمية المتحدث",
  "segments.textLabel": "نص المقطع",

  "privacy.title": "الخصوصية",
  "privacy.heading": "التحكم بالصوت",
  "privacy.description": "اختر مكان معالجة التسجيلات الصوتية ومسودات التفريغ.",
  "privacy.local": "محلي",
  "privacy.cloud": "سحابي",
  "privacy.autoDelete": "حذف تلقائي بعد 24 ساعة",
  "privacy.maskNames": "إخفاء الأسماء الحساسة",
  "privacy.exportTextOnly": "تصدير نصي فقط عند الطلب",
  "privacy.ariaLabel": "وضع الخصوصية",
  "settings.localApi.title": "API محلية",
  "settings.localApi.description":
    "يمكن لـ Sonolect إرسال التسجيلات إلى API HTTP محلية، أو البقاء غير متصل عند عدم تهيئة عنوان URL.",
  "settings.localApi.url": "عنوان URL المُهيّأ",
  "settings.localApi.configured":
    "تم تفعيل الرفع عبر API المحلية للتسجيلات الجديدة.",
  "settings.localApi.offline":
    "لم يتم تهيئة عنوان URL لـ API؛ تبقى التسجيلات محلية/غير متصلة.",
  "settings.whisper.title": "إعداد Whisper المحلي",
  "settings.whisper.description":
    "استخدم whisper.cpp أو OpenAI Whisper أو faster-whisper الخاص بك. يحفظ Sonolect إعدادات الأوامر فقط؛ لا يتضمن نماذج كبيرة.",
  "settings.whisper.install":
    "ثبّت ملفاً تنفيذياً متوافقاً مع Whisper أو غلاف Python على هذا الحاسوب.",
  "settings.whisper.download":
    "حمّل ملف النموذج بنفسك واحتفظ به في مجلد محلي تتحكم فيه.",
  "settings.whisper.env":
    "شغّل تطبيق سطح المكتب مع تعيين متغير البيئة هذا إلى JSON argv أدناه",
  "settings.whisper.modelPath": "مسار النموذج أو معرّفه",
  "settings.whisper.modelName": "تسمية النموذج",
  "settings.whisper.commandArgs": "JSON وسائط الأمر",
  "settings.whisper.saveCommand": "حفظ الأمر",
  "settings.whisper.validate": "التحقق من الإعداد",
  "settings.whisper.status": "الحالة",
  "settings.whisper.preview": "معاينة",
  "settings.whisper.envValue": "قيمة متغير البيئة",
  "settings.whisper.catalog": "موارد محلية موصى بها",
  "settings.whisper.recommendedModel": "نموذج للتحميل",
  "settings.whisper.defaultBinary": "مسار الملف التنفيذي الافتراضي",
  "settings.whisper.defaultModel": "مسار النموذج الافتراضي",
  "settings.whisper.downloadUrl": "تحميل النموذج",
  "settings.whisper.usePlan": "استخدم قالب الأمر الموصى به",
  "settings.whisper.planApplied":
    "تم تطبيق قالب أمر Whisper الموصى به. أضف مسار النموذج الفعلي قبل الاختبار.",
  "settings.whisper.commandJsonInvalid":
    "يجب أن تكون وسائط الأمر مصفوفة JSON صالحة من السلاسل النصية.",
  "settings.whisper.commandSaved": "تم حفظ أمر Whisper محلياً.",

  "agents.title": "إجراءات ذكية",
  "agents.preview": "معاينة",
  "agents.notion.title": "إنشاء ملاحظة في Notion",
  "agents.notion.description":
    "انشر الملخص المنظم مع القرارات والمخاطر والخطوات التالية.",
  "agents.linear.title": "فتح 3 تذاكر في Linear",
  "agents.linear.description":
    "قسّم التفريغ إلى مشكلات مع أولويات وتسميات ومسؤولين مقترحين.",
  "agents.mail.title": "صياغة بريد إلكتروني احترافي",
  "agents.mail.description":
    "حوّل المسودة الصوتية إلى رسالة واضحة ودافئة جاهزة للإرسال.",

  "recorder.ariaLabel": "مسجل Sonolect الصوتي",
  "recorder.close": "إغلاق",
  "recorder.stopCapture": "إيقاف التسجيل",
  "recorder.newCapture": "تسجيل جديد",
  "recorder.listenDownload": "استماع / تحميل",
  "recorder.kb": "ك.ب",

  "voice.permission.eyebrow": "إذن الميكروفون",
  "voice.permission.title": "اسمح بالوصول إلى الميكروفون",
  "voice.permission.detail":
    "يطلب Sonolect navigator.mediaDevices.getUserMedia({ audio: true }).",
  "voice.recording.eyebrow": "استماع نشط",
  "voice.recording.title": "تحدّث، Sonolect يلتقط صوتك",
  "voice.recording.detail":
    "يجمع MediaRecorder أجزاء الصوت محلياً حتى الإيقاف.",
  "voice.uploading.eyebrow": "إرسال التفريغ",
  "voice.uploading.title": "جارٍ تحضير مهمة الخادم…",
  "voice.uploading.detailConfigured":
    "اكتمل التسجيل: جارٍ الإرسال إلى نقطة النهاية المُهيّأة عبر VITE_SONOLECT_API_URL.",
  "voice.uploading.detailOffline":
    "لم يتم تهيئة خادم: التبديل إلى الوضع المحلي/غير المتصل.",
  "voice.completed.eyebrowOffline": "مكتمل · غير متصل",
  "voice.completed.eyebrow": "مكتمل",
  "voice.completed.titleOffline": "التسجيل المحلي جاهز",
  "voice.completed.title": "تم إرسال التسجيل",
  "voice.completed.detailFallback":
    "تم إنشاء كائن الصوت والمدة ونوع MIME وعنوان URL المحلي.",
  "voice.error.eyebrow": "خطأ في التسجيل",
  "voice.error.title": "تعذر إنهاء التسجيل",
  "voice.error.detailFallback": "حدث خطأ غير معروف.",
  "voice.default.eyebrow": "جاهز",
  "voice.default.title": "التقاط صوتي",
  "voice.default.detail": "انقر للبدء.",

  "palette.prompt": "ماذا تريد أن تفعل بصوتك؟",
  "palette.ariaLabel": "لوحة الأوامر",
  "palette.newCapture": "تسجيل صوتي جديد",
  "palette.newCaptureHint": "بدء واجهة الميكروفون",
  "palette.openHistory": "فتح السجل",
  "palette.openHistoryHint": "البحث عن تفريغ",
  "palette.agentCenter": "مركز الوكلاء",
  "palette.agentCenterHint": "عرض الإجراءات المتصلة",
  "palette.privacySettings": "إعدادات الخصوصية",
  "palette.privacySettingsHint": "محلي أولاً، سحابي، الاحتفاظ",

  "error.micUnavailable": "التقاط الميكروفون غير متاح في هذه البيئة.",
  "error.mediaRecorderUnsupported":
    "MediaRecorder غير مدعوم في بيئة سطح المكتب هذه.",
  "error.recordingError": "خطأ أثناء التسجيل الصوتي.",
  "error.sendFailed": "تعذر إرسال التسجيل إلى الخادم.",
  "error.micPermissionDenied": "تم رفض إذن الميكروفون أو أنه غير متاح.",
  "error.historyLoadFailed": "تعذر تحميل سجل التفريغات.",
  "error.detailLoadFailed": "تعذر فتح تفاصيل التفريغ.",

  "fallback.localCapture":
    "[تسجيل صوتي محلي] {duration} · {mimeType} · {size} ك.ب. الخادم غير مُهيّأ (VITE_SONOLECT_API_URL).",
  "fallback.sentCapture": "[تسجيل صوتي مُرسل] مهمة {jobId} · {duration}.",

  initialTranscript:
    "الهدف: تحضير عرض توضيحي لـ Sonolect desktop المتقدم.\n\nالتركيز على تجربة صوتية أولاً: اختصار عام، واجهة ميكروفون فورية، تفريغ قابل للتحرير، ثم إجراءات ذكية.\n\nالنبرة المطلوبة: عربية فصحى احترافية، مباشرة، أنيقة. الإجراء التالي: إنشاء ملخص للمستثمرين وثلاث تذاكر في Linear.",

  "workspace.ariaLabel": "مساحة عمل Sonolect",

  "history.unknownDuration": "مدة غير معروفة",
  "history.unknownDate": "تاريخ غير معروف",
  "history.pendingContent": "تفريغ في انتظار المحتوى.",
  "history.offlineMessage":
    "VITE_SONOLECT_API_URL مفقود: سجل العرض التوضيحي محفوظ محلياً.",

  "voiceApi.offlineNoUrl":
    "VITE_SONOLECT_API_URL مفقود: التسجيل محفوظ محلياً بدون رفع إلى الخادم.",
  "voiceApi.backendUnavailable": "الخادم المحلي غير متاح: التسجيل محفوظ محلياً",

  "toast.transformComplete": "تم تحويل التفريغ بنجاح",
  "toast.copySuccess": "تم نسخ التفريغ إلى الحافظة",
  "toast.insertionReady": "الإملاء المنقّح جاهز للصق",

  "editor.transforming": "جارٍ التحويل…",

  "editor.copy": "نسخ",
  "editor.download": "تحميل",

  "palette.searchPlaceholder": "ابحث عن أوامر…",
  "palette.noResults": "لا توجد نتائج",

  "pill.permitting": "الوصول إلى الميكروفون…",
  "pill.processing": "جارٍ المعالجة…",
  "pill.done": "تم",
  "pill.error": "خطأ",
  "pill.stop": "إيقاف",
  "pill.again": "إعادة",

  "audio.recentCapture": "تسجيل حديث",
  "audio.playPause": "تشغيل أو إيقاف الصوت",
  "audio.waveform": "شكل الموجة الصوتية",
};
