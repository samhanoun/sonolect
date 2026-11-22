import type { LocaleKeys } from "./en";

export const ar: Partial<Record<LocaleKeys, string>> = {
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
  "voice.recording.detail": "يجمع MediaRecorder أجزاء الصوت محلياً حتى الإيقاف.",
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

  // Note sync between devices
  "studio.sync.title": "المزامنة بين الأجهزة",
  "studio.sync.subtitle":
    "ملاحظاتك على كل أجهزتك، مشفّرة من طرف إلى طرف: يحتفظ بها خادم المزامنة لكنه لا يستطيع قراءتها.",
  "studio.sync.server": "خادم المزامنة: {server}",
  "studio.sync.audioStays":
    "تبقى التسجيلات على الجهاز الذي سجّلها. تُزامَن الملاحظات فقط.",
  "studio.sync.offState": "المزامنة متوقفة.",
  "studio.sync.onState": "المزامنة مفعّلة.",
  "studio.sync.turnOn": "تفعيل المزامنة",
  "studio.sync.turningOn": "جارٍ التفعيل…",
  "studio.sync.join": "الانضمام برمز",
  "studio.sync.joinLabel": "رمز المزامنة أو رابطها من جهازك الآخر",
  "studio.sync.joinSubmit": "انضمام",
  "studio.sync.joining": "جارٍ الانضمام…",
  "studio.sync.cancel": "إلغاء",
  "studio.sync.warning": "الانضمام يشارك كل ملاحظة مع كل من يملك هذا الرمز.",
  "studio.sync.lastSync": "آخر مزامنة: {time}.",
  "studio.sync.neverSynced": "لم تتم المزامنة بعد.",
  "studio.sync.syncing": "جارٍ المزامنة…",
  "studio.sync.syncNow": "زامِن الآن",
  "studio.sync.showCode": "إظهار الرمز",
  "studio.sync.hideCode": "إخفاء الرمز",
  "studio.sync.codeHint":
    "على جهازك الآخر، اختر الانضمام إلى المزامنة، ثم امسح رمز QR هذا أو اكتب الرمز.",
  "studio.sync.codeLabel": "رمز المزامنة",
  "studio.sync.qrLabel": "رمز QR للانضمام إلى هذه المزامنة",
  "studio.sync.turnOff": "إيقاف المزامنة",
  "studio.sync.turnOffQuestion": "هل تريد إيقاف المزامنة على هذا الجهاز؟",
  "studio.sync.keepServer": "الاحتفاظ بنسخة الخادم",
  "studio.sync.keepServerHint":
    "تواصل أجهزتك الأخرى المزامنة. ويمكن لهذا الجهاز الانضمام مجددًا بالرمز.",
  "studio.sync.deleteServer": "حذف نسخة الخادم",
  "studio.sync.deleteServerHint":
    "سترى أجهزتك الأخرى «تم حذف هذه المزامنة» وستوقف المزامنة. يحتفظ كل جهاز بملاحظاته.",
  "studio.sync.turningOff": "جارٍ الإيقاف…",
  "studio.sync.notesKept": "تبقى ملاحظاتك على هذا الجهاز.",
  "studio.sync.error.unauthorized": "لا يقبل الخادم مفتاح المزامنة هذا.",
  "studio.sync.error.deleted": "تم حذف هذه المزامنة.",
  "studio.sync.error.tooLarge": "إحدى الملاحظات أكبر من أن تُزامَن.",
  "studio.sync.error.server": "المزامنة غير متاحة حاليًا.",
  "studio.sync.error.offline":
    "غير متصل. ستُزامَن الملاحظات عند عودتك إلى الاتصال.",
  "studio.sync.notice.quota":
    "مساحة المزامنة ممتلئة. احذف بعض الملاحظات لمزامنة الجديدة.",
  "studio.sync.notice.newerSchema": "حدّث Sonolect لمزامنة كل الملاحظات.",
  "studio.sync.pairing.invalid": "هذا ليس رمز مزامنة من Sonolect.",
  "studio.sync.pairing.version": "حدّث Sonolect لاستخدام هذا الرمز.",
  "studio.sync.pairing.length": "تحقّق من الرمز: يتكوّن من 56 حرفًا.",
  "studio.sync.pairing.typo": "أحد الأحرف خاطئ.",
  "studio.sync.preview": "تعمل المزامنة في التطبيق المثبّت.",
  "studio.sync.deleteAllHint": "تتوقف المزامنة على هذا الجهاز أيضًا.",
  "studio.sync.deleteAllServer":
    "المزامنة مفعّلة. هل تريد أيضًا حذف نسخة ملاحظاتك على الخادم؟ «موافق» يحذفها: ستوقف أجهزتك الأخرى المزامنة وتحتفظ بملاحظاتها. «إلغاء» يُبقيها لها.",
  "studio.privacy.problemSync": "المزامنة: {reason}",
  "studio.library.synced": "متزامنة",
  "studio.library.noAudio": "يبقى التسجيل على الجهاز الذي سجّله.",
  "studio.library.conflictOf": "نسخة تعارض من ملاحظة {date}",
  "studio.library.conflictCopy": "نسخة تعارض",
  "native.syncNotAvailable": "المزامنة غير متاحة في هذا الإصدار من Sonolect.",
  "native.syncKeychainLinux":
    "المزامنة غير متاحة على هذا النظام: فهي تحفظ مفتاحها في سلسلة مفاتيح (Secret Service، مثل GNOME Keyring أو KWallet)، ولا تعمل أي واحدة منها.",
  "native.syncKeychainUnavailable":
    "المزامنة غير متاحة على هذا النظام: تعذّر فتح سلسلة المفاتيح.",
  "native.syncKeychainFailed":
    "تعذّرت قراءة مفتاح المزامنة أو حفظه في سلسلة المفاتيح.",
  "native.syncInvalidKey": "هذا ليس مفتاح مزامنة صالحًا.",
  "native.syncKeyExists": "المزامنة مفعّلة بالفعل بمفتاح آخر. أوقفها أولًا.",
  "native.syncStateFailed": "تعذّر حفظ حالة المزامنة.",
  "native.syncInterrupted": "انقطعت المزامنة.",
  "native.syncInvalidNote": "ملاحظة متزامنة غير صالحة.",
  // Speaker detection
  "studio.speakers.detect": "اكتشاف المتحدثين",
  "studio.speakers.count": "المتحدثون",
  "studio.speakers.auto": "تلقائي",
  "studio.speakers.label": "المتحدث {number}",
  "studio.speakers.consent":
    "هل تريد تنزيل نموذج المتحدثين بحجم {size}؟ يبقى صوتك على هذا الجهاز.",
  "studio.speakers.download": "تنزيل",
  "studio.speakers.notNow": "ليس الآن",
  "studio.speakers.downloading": "جارٍ تنزيل نموذج المتحدثين… {progress}%",
  "studio.speakers.keepOrReplace":
    "بعض المقاطع لها أسماء بالفعل. هل تريد الاحتفاظ بها أم استبدالها؟",
  "studio.speakers.keep": "الاحتفاظ بالأسماء",
  "studio.speakers.replace": "استبدال الأسماء",
  "studio.speakers.cancel": "إلغاء",
  "studio.speakers.detecting": "جارٍ اكتشاف المتحدثين… {progress}%",
  "studio.speakers.found.one": "تم العثور على متحدث واحد.",
  "studio.speakers.found.other":
    "عدد المتحدثين الذين تم العثور عليهم: {count}.",
  "studio.speakers.noSpeech": "لم يُعثر على كلام في هذا التسجيل.",
  "studio.speakers.stale": "فُتح تفريغ آخر، لذلك لم يتغير أي اسم.",
  "studio.speakers.legend": "المتحدثون في هذا التفريغ",
  "studio.speakers.rename": "إعادة تسمية {name} في كل مكان",
  "studio.speakers.segments.one": "مقطع واحد",
  "studio.speakers.segments.other": "عدد المقاطع: {count}",
  "studio.settings.speakerModelTitle": "نموذج المتحدثين",
  "studio.settings.speakerModelMeta": "اكتشاف المتحدثين · المعالج",
  "studio.settings.speakerModelReady":
    "نموذج المتحدثين موجود على هذا الكمبيوتر.",
  "studio.settings.speakerModelMissing":
    "نزّله مرة واحدة لمعرفة من يتحدث في التسجيل. يبقى صوتك على هذا الجهاز.",
  "studio.settings.speakerModelInstall": "تنزيل نموذج المتحدثين",
  "studio.settings.speakerModelReinstall": "إعادة تثبيت نموذج المتحدثين",
  "studio.settings.speakerModelDownloaded":
    "تم تنزيل نموذج المتحدثين والتحقق من المجموع الاختباري.",
  "native.speakersCancelled": "أُلغي اكتشاف المتحدثين.",
  "native.speakersBusy": "اكتشاف المتحدثين قيد التشغيل بالفعل.",
  "native.speakerCount": "اختر عددًا من المتحدثين بين 2 و8.",
  "native.speakerModelMissing": "نزّل نموذج المتحدثين أولًا.",
  "native.speakerModelDamaged":
    "كان نموذج المتحدثين تالفًا وتمت إزالته. نزّله مرة أخرى.",
  "native.speakersStillRecording": "أنهِ التسجيل قبل اكتشاف المتحدثين.",
  "native.speakerModelUnreadable": "تعذّرت قراءة نموذج المتحدثين: {reason}",
  "native.speakerModelLoad": "تعذّر تحميل نموذج المتحدثين: {reason}",
  "native.speakerModelFailed": "فشل نموذج المتحدثين: {reason}",
  // High-quality recording
  "studio.storage.format": "حفظ التسجيلات بصيغة",
  "studio.storage.wav": "جودة الكلام (WAV، 16 كيلوهرتز أحادي)",
  "studio.storage.opus": "جودة الكلام، مضغوط (Opus، أصغر بعشر مرات)",
  "studio.storage.hq":
    "جودة عالية (Opus، 48 كيلوهرتز، ستيريو إذا كان المصدر ستيريو)",
  "studio.storage.savedWav":
    "تُحفظ التسجيلات الجديدة بصيغة WAV بجودة الكلام. وتبقى التسجيلات المضغوطة مضغوطة.",
  "studio.storage.savedHq":
    "تُحفظ التسجيلات الجديدة بتردد 48 كيلوهرتز، وبالستيريو إذا كان المصدر ستيريو. وتُضغط الملفات المستوردة والتسجيلات الأقدم بجودة الكلام.",
  "studio.signal.meta": "16 كيلوهرتز · أحادي · على الجهاز",
  "studio.signal.metaHigh": "48 كيلوهرتز · ستيريو عند توفره · على الجهاز",
  "studio.library.saveAudio": "حفظ الصوت",
  "studio.source.systemHint":
    "يسجّل زر التسجيل ما يُشغَّل على هذا الكمبيوتر، مثل اجتماع أو فيديو. وكذلك اختصار الإملاء إذا ضُغط وSonolect في المقدمة. أما الإملاء في التطبيقات الأخرى والفقاعة فيستخدمان الميكروفون دائمًا.",
  "native.invalidPcmFormat": "معدل العينات أو عدد القنوات غير صالح.",
  "native.invalidPcmFrames": "صوت PCM بدقة 16 بت أو حجم إطار غير صالح.",
  "native.pcmFormatChanged": "تغيّر تنسيق الصوت أثناء التسجيل.",
  "native.invalidQuality": "جودة التسجيل غير صالحة.",
  "native.cannotConvert": "تعذّر تحويل الصوت: {reason}",
};
