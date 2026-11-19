package expo.modules.sonolectvoicekeyboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Sonolect voice keyboard: an input method with one big mic. It types what
 * you say into whatever text field has focus, in any app. Speech recognition
 * runs on the device when Android has an on-device recogniser; the system
 * speech service is only used when the app's privacy setting allows it.
 */
class SonolectVoiceIme : InputMethodService(), RecognitionListener {
  private var recognizer: SpeechRecognizer? = null
  private var usingOnDevice = false
  private var listening = false
  /** A space to put before the dictation when the cursor follows a word. */
  private var prefix = ""

  private var statusView: TextView? = null
  private var orbView: VoiceOrbView? = null
  private var waveView: VoiceWaveView? = null

  // ── View ─────────────────────────────────────────────────────────

  override fun onCreateInputView(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(12), dp(16), dp(14))
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(Color.parseColor("#1A2A21"), Color.parseColor("#0B120E")),
      ).apply {
        val r = dp(22).toFloat()
        cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        setStroke(dp(1), Color.parseColor("#33DDF39A"))
      }
    }

    val header = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val status = TextView(this).apply {
      setTextColor(INK)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      maxLines = 2
    }
    statusView = status
    header.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    header.addView(pill("ABC", "Switch keyboard") { switchKeyboard() })
    root.addView(header)

    val wave = VoiceWaveView(this)
    waveView = wave
    root.addView(wave, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)).apply {
      topMargin = dp(10)
    })

    val orbFrame = FrameLayout(this)
    val orb = VoiceOrbView(this).apply {
      contentDescription = "Dictate"
      isClickable = true
      setOnClickListener {
        it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        if (listening) stopListening() else startListening()
      }
    }
    orbView = orb
    orbFrame.addView(orb, FrameLayout.LayoutParams(dp(96), dp(96), Gravity.CENTER))
    root.addView(orbFrame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(104)))

    val keys = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    keys.addView(pill("⌫", "Delete") { deleteBackward() }, keyParams())
    keys.addView(pill("space", "Space") { currentInputConnection?.commitText(" ", 1) }, keyParams(2.4f))
    keys.addView(pill("⏎", "Enter") { pressEnter() }, keyParams())
    root.addView(keys, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
      topMargin = dp(8)
    })

    showIdle()
    return root
  }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    if (!listening) showIdle()
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    cancelListening()
    super.onFinishInputView(finishingInput)
  }

  override fun onDestroy() {
    recognizer?.destroy()
    recognizer = null
    super.onDestroy()
  }

  // ── Dictation ────────────────────────────────────────────────────

  private fun hasMicPermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun onDeviceAvailable(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(this)

  private fun createRecognizer(preferOnDevice: Boolean): SpeechRecognizer? {
    recognizer?.destroy()
    recognizer = null
    val prefs = VoiceKeyboardPrefs(this)
    val created = when {
      preferOnDevice && onDeviceAvailable() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
        usingOnDevice = true
        SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
      }
      prefs.allowSystemService && SpeechRecognizer.isRecognitionAvailable(this) -> {
        usingOnDevice = false
        SpeechRecognizer.createSpeechRecognizer(this)
      }
      else -> null
    }
    created?.setRecognitionListener(this)
    recognizer = created
    return created
  }

  private fun startListening(preferOnDevice: Boolean = true) {
    if (!hasMicPermission()) {
      showMessage("Open Sonolect once and allow the microphone.", offerOpen = true)
      return
    }
    val rec = createRecognizer(preferOnDevice)
    if (rec == null) {
      showMessage(
        "No on-device speech recogniser. In Sonolect, set Privacy to Standard to use the system speech service.",
        offerOpen = true,
      )
      return
    }
    val before = currentInputConnection?.getTextBeforeCursor(1, 0)
    prefix = if (before.isNullOrEmpty() || before.last().isWhitespace()) "" else " "

    val language = VoiceKeyboardPrefs(this).language
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
      if (language.isNotBlank()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      if (!VoiceKeyboardPrefs(this@SonolectVoiceIme).allowSystemService) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }
    }
    listening = true
    orbView?.setActive(true)
    statusView?.text = "Listening…"
    try {
      rec.startListening(intent)
    } catch (error: RuntimeException) {
      listening = false
      orbView?.setActive(false)
      showMessage("Couldn't start listening.")
    }
  }

  private fun stopListening() {
    recognizer?.stopListening()
    statusView?.text = "Finishing…"
  }

  private fun cancelListening() {
    if (listening) recognizer?.cancel()
    listening = false
    currentInputConnection?.finishComposingText()
    orbView?.setActive(false)
    waveView?.reset()
  }

  override fun onReadyForSpeech(params: Bundle?) {
    statusView?.text = "Listening…"
  }

  override fun onBeginningOfSpeech() = Unit

  override fun onRmsChanged(rmsdB: Float) {
    // SpeechRecognizer reports roughly -2 dB (silence) to 10 dB (loud speech).
    val level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
    waveView?.push(level)
    orbView?.setLevel(level)
  }

  override fun onBufferReceived(buffer: ByteArray?) = Unit

  override fun onEndOfSpeech() {
    statusView?.text = "Finishing…"
  }

  override fun onPartialResults(partialResults: Bundle?) {
    val text = firstResult(partialResults) ?: return
    if (text.isNotBlank()) currentInputConnection?.setComposingText(prefix + text, 1)
  }

  override fun onResults(results: Bundle?) {
    listening = false
    orbView?.setActive(false)
    waveView?.reset()
    val text = firstResult(results)?.trim().orEmpty()
    val ic = currentInputConnection
    if (text.isEmpty()) {
      ic?.setComposingText("", 1)
      ic?.finishComposingText()
      showMessage("Didn't catch that. Tap to try again.")
      return
    }
    ic?.commitText(prefix + text, 1)
    statusView?.text = "Tap to keep talking"
  }

  override fun onError(error: Int) {
    val wasOnDevice = usingOnDevice
    listening = false
    orbView?.setActive(false)
    waveView?.reset()
    currentInputConnection?.finishComposingText()
    val languageMissing = error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
      error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
    if (wasOnDevice && languageMissing && VoiceKeyboardPrefs(this).allowSystemService) {
      startListening(preferOnDevice = false)
      return
    }
    showMessage(
      when (error) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
          "Didn't catch that. Tap to try again."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
          "Open Sonolect once and allow the microphone."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
          "The speech service is offline. Try again."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The recogniser is busy. Try again."
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
          "Download this language for offline speech in Android settings."
        else -> "Couldn't dictate (error $error). Tap to try again."
      },
      offerOpen = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
    )
  }

  override fun onEvent(eventType: Int, params: Bundle?) = Unit

  private fun firstResult(bundle: Bundle?): String? =
    bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  // ── Keys ─────────────────────────────────────────────────────────

  private fun deleteBackward() {
    val ic = currentInputConnection ?: return
    val selected = ic.getSelectedText(0)
    if (!selected.isNullOrEmpty()) ic.commitText("", 1) else ic.deleteSurroundingTextInCodePoints(1, 0)
  }

  private fun pressEnter() {
    val ic = currentInputConnection ?: return
    val info = currentInputEditorInfo
    val action = (info?.imeOptions ?: 0) and EditorInfo.IME_MASK_ACTION
    val noEnterAction = ((info?.imeOptions ?: 0) and EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0
    if (!noEnterAction && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
      ic.performEditorAction(action)
    } else {
      ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
      ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    }
  }

  private fun switchKeyboard() {
    cancelListening()
    val switched = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) switchToPreviousInputMethod() else false
    if (!switched) {
      getSystemService(android.view.inputmethod.InputMethodManager::class.java)?.showInputMethodPicker()
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────

  private fun showIdle() {
    statusView?.text = when {
      !hasMicPermission() -> "Open Sonolect once and allow the microphone."
      else -> "Tap the mic and speak"
    }
    statusView?.setOnClickListener(if (!hasMicPermission()) View.OnClickListener { openApp() } else null)
  }

  private fun showMessage(message: String, offerOpen: Boolean = false) {
    statusView?.text = if (offerOpen) "$message  Open ›" else message
    statusView?.setOnClickListener(if (offerOpen) View.OnClickListener { openApp() } else null)
  }

  private fun openApp() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(launch)
  }

  private fun pill(label: String, description: String, onClick: () -> Unit): TextView =
    TextView(this).apply {
      text = label
      contentDescription = description
      gravity = Gravity.CENTER
      setTextColor(INK)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setPadding(dp(14), dp(8), dp(14), dp(8))
      background = GradientDrawable().apply {
        cornerRadius = dp(999).toFloat()
        setColor(Color.parseColor("#14FFFFFF"))
        setStroke(dp(1), Color.parseColor("#22DDF39A"))
      }
      isClickable = true
      setOnClickListener {
        it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        onClick()
      }
    }

  private fun keyParams(weight: Float = 1f) =
    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight).apply {
      marginStart = dp(4)
      marginEnd = dp(4)
    }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    internal val INK = Color.parseColor("#EEF2EA")
    internal val LIME = Color.parseColor("#DDF39A")
  }
}
