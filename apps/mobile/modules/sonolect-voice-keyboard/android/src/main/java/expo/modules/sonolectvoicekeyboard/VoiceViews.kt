package expo.modules.sonolectvoicekeyboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.LinearInterpolator

/**
 * The big lime mic button; its glow breathes with the voice level. It draws
 * every frame while listening, so onDraw allocates nothing: the shaders are
 * made when the size changes, and the glow is scaled to the ring.
 */
internal class VoiceOrbView(context: Context) : View(context) {
  private val density = resources.displayMetrics.density
  private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
  private val body = Paint(Paint.ANTI_ALIAS_FLAG)
  private val icon = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.parseColor("#0B120E")
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeWidth = 2.4f * density
  }
  private val iconFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#0B120E") }
  private val square = RectF()
  private val capsule = RectF()
  private val arc = RectF()
  private var active = false
  private var level = 0f
  private var pulse = 0f
  private val pulseAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
    duration = 1400
    repeatCount = ValueAnimator.INFINITE
    interpolator = LinearInterpolator()
    addUpdateListener {
      pulse = it.animatedValue as Float
      invalidate()
    }
  }

  fun setActive(value: Boolean) {
    active = value
    if (value) pulseAnimator.start() else {
      pulseAnimator.cancel()
      level = 0f
    }
    invalidate()
  }

  fun setLevel(value: Float) {
    level = level * 0.6f + value * 0.4f
    invalidate()
  }

  override fun onDetachedFromWindow() {
    pulseAnimator.cancel()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    val cx = w / 2f
    val cy = h / 2f
    val base = minOf(w, h) / 2f * 0.66f
    if (base <= 0f) {
      glow.shader = null
      body.shader = null
      return
    }
    // The glow at the body's radius; onDraw scales it out to the ring.
    glow.shader = RadialGradient(
      cx, cy, base,
      intArrayOf(Color.argb(140, 221, 243, 154), Color.argb(0, 221, 243, 154)),
      floatArrayOf(0.55f, 1f),
      Shader.TileMode.CLAMP,
    )
    body.shader = RadialGradient(
      cx - base * 0.3f, cy - base * 0.35f, base * 1.4f,
      intArrayOf(Color.parseColor("#F4FBD9"), SonolectVoiceIme.LIME),
      floatArrayOf(0f, 0.6f),
      Shader.TileMode.CLAMP,
    )
  }

  override fun onDraw(canvas: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val base = minOf(width, height) / 2f * 0.66f
    if (base <= 0f) return
    if (active) {
      val scale = 1.12f + 0.32f * level + 0.06f * pulse
      val saved = canvas.save()
      canvas.scale(scale, scale, cx, cy)
      canvas.drawCircle(cx, cy, base, glow)
      canvas.restoreToCount(saved)
    }
    canvas.drawCircle(cx, cy, base, body)

    // Mic glyph (or a stop square while listening).
    val s = base * 0.42f
    if (active) {
      val half = s * 0.55f
      square.set(cx - half, cy - half, cx + half, cy + half)
      canvas.drawRoundRect(square, 4f * density, 4f * density, iconFill)
      return
    }
    capsule.set(cx - s * 0.38f, cy - s, cx + s * 0.38f, cy + s * 0.2f)
    canvas.drawRoundRect(capsule, s * 0.38f, s * 0.38f, iconFill)
    arc.set(cx - s * 0.7f, cy - s * 0.55f, cx + s * 0.7f, cy + s * 0.62f)
    canvas.drawArc(arc, 20f, 140f, false, icon)
    canvas.drawLine(cx, cy + s * 0.62f, cx, cy + s * 0.95f, icon)
  }
}

/** A row of bars that scrolls with the recent voice levels. */
internal class VoiceWaveView(context: Context) : View(context) {
  private val density = resources.displayMetrics.density
  private val levels = FloatArray(BARS)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SonolectVoiceIme.LIME }
  private val rect = RectF()

  fun push(level: Float) {
    System.arraycopy(levels, 1, levels, 0, BARS - 1)
    levels[BARS - 1] = level
    invalidate()
  }

  fun reset() {
    levels.fill(0f)
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val barWidth = 3f * density
    val gap = 4f * density
    val total = BARS * barWidth + (BARS - 1) * gap
    var x = (width - total) / 2f
    val cy = height / 2f
    for (level in levels) {
      val h = maxOf(3f * density, height * (0.12f + 0.88f * level))
      paint.alpha = (110 + 145 * level).toInt().coerceIn(0, 255)
      rect.set(x, cy - h / 2f, x + barWidth, cy + h / 2f)
      canvas.drawRoundRect(rect, barWidth, barWidth, paint)
      x += barWidth + gap
    }
  }

  companion object {
    private const val BARS = 28
  }
}
