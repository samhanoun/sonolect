package expo.modules.sonolectvoicekeyboard

import android.content.Context

/**
 * Settings the Sonolect app hands to the voice keyboard. The keyboard runs in
 * the app's process but outside React Native, so they live in a small
 * SharedPreferences file instead of AsyncStorage.
 */
internal class VoiceKeyboardPrefs(context: Context) {
  private val prefs =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  /** Standard privacy: the system speech service may be used when no on-device recogniser exists. */
  var allowSystemService: Boolean
    get() = prefs.getBoolean(KEY_ALLOW_SYSTEM, false)
    set(value) = prefs.edit().putBoolean(KEY_ALLOW_SYSTEM, value).apply()

  /** BCP-47 tag such as "en-US"; empty means the device default. */
  var language: String
    get() = prefs.getString(KEY_LANGUAGE, "") ?: ""
    set(value) = prefs.edit().putString(KEY_LANGUAGE, value).apply()

  companion object {
    private const val FILE = "sonolect_voice_keyboard"
    private const val KEY_ALLOW_SYSTEM = "allow_system_service"
    private const val KEY_LANGUAGE = "language"
  }
}
