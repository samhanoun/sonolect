package expo.modules.sonolectvoicekeyboard

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.speech.SpeechRecognizer
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS bridge: lets the app check, enable and configure the voice keyboard. */
class SonolectVoiceKeyboardModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not ready" }

  override fun definition() = ModuleDefinition {
    Name("SonolectVoiceKeyboard")

    Function("getStatus") {
      val ctx = context
      val imm = ctx.getSystemService(InputMethodManager::class.java)
      val self = ComponentName(ctx, SonolectVoiceIme::class.java)
      val enabled = imm?.enabledInputMethodList?.any { it.component == self } ?: false
      val current = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
      val selected = current?.let { ComponentName.unflattenFromString(it) } == self
      mapOf(
        "enabled" to enabled,
        "selected" to selected,
        "onDeviceRecognition" to onDeviceAvailable(ctx),
        "recognitionAvailable" to SpeechRecognizer.isRecognitionAvailable(ctx),
      )
    }

    Function("openKeyboardSettings") {
      val intent = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("showKeyboardPicker") { promise: Promise ->
      val imm = context.getSystemService(InputMethodManager::class.java)
      imm?.showInputMethodPicker()
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    Function("setPreferences") { allowSystemService: Boolean, language: String ->
      val prefs = VoiceKeyboardPrefs(context)
      prefs.allowSystemService = allowSystemService
      prefs.language = language
    }
  }

  private fun onDeviceAvailable(ctx: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
}
