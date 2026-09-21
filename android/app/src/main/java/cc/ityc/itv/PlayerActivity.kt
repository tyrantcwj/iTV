package cc.ityc.itv

import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import java.net.URL
import kotlin.concurrent.thread
import kotlin.math.max

class PlayerActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_CHANNEL_ID = "channelId"
        const val EXTRA_CHANNEL_NAME = "channelName"
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var channelId: String
    private lateinit var videoLayout: VLCVideoLayout
    private lateinit var logoView: ImageView
    private lateinit var liveView: TextView
    private lateinit var titleView: TextView
    private lateinit var nextView: TextView
    private lateinit var clockView: TextView
    private lateinit var volumeHint: TextView
    private lateinit var osd: View
    private lateinit var audio: AudioManager

    private var libVlc: LibVLC? = null
    private var player: MediaPlayer? = null
    private var mediaKey = ""
    private var remaining = 0.0
    private var fetchedAt = 0L
    private var immersive = true

    private val tick = object : Runnable {
        override fun run() {
            val left = max(0.0, remaining - (System.currentTimeMillis() - fetchedAt) / 1000.0)
            nextView.text = if (left > 0) {
                "剩余 ${formatTime(left)}"
            } else {
                "即将切换"
            }
            if (left <= 0.4) refresh(true)
            clockView.text = beijingClock()
            handler.postDelayed(this, 1000)
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            refresh(false)
            handler.postDelayed(this, 20000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_player)
        channelId = intent.getStringExtra(EXTRA_CHANNEL_ID).orEmpty()
        videoLayout = findViewById(R.id.video)
        logoView = findViewById(R.id.logo)
        liveView = findViewById(R.id.live)
        titleView = findViewById(R.id.title)
        nextView = findViewById(R.id.next)
        clockView = findViewById(R.id.clock)
        volumeHint = findViewById(R.id.volume_hint)
        osd = findViewById(R.id.osd)
        audio = getSystemService(AUDIO_SERVICE) as AudioManager
        clockView.text = beijingClock()
        titleView.text = intent.getStringExtra(EXTRA_CHANNEL_NAME)
        logoView.setOnClickListener { toggleImmersive() }
        clockView.setOnClickListener { toggleOsd() }
        findViewById<View>(R.id.to_pip).setOnClickListener { enterPip() }
        // 从小窗点「全屏」回来的话，得先把小窗那份播放器停掉，不然两份一起放
        PipService.stop(this)
        findViewById<View>(R.id.vol_up).setOnClickListener { nudgeVolume(true) }
        findViewById<View>(R.id.vol_down).setOnClickListener { nudgeVolume(false) }
        applyImmersive()
        libVlc = LibVLC(
            this,
            arrayListOf(
                "--network-caching=4000",
                "--http-reconnect",
                "--avcodec-hw=any",
                "--no-drop-late-frames",
                "--no-skip-frames",
            ),
        )
        player = MediaPlayer(libVlc)
        player?.attachViews(videoLayout, null, false, false)
        findViewById<View>(R.id.vol_rail).bringToFront()
        logoView.bringToFront()
        clockView.bringToFront()
        volumeHint.bringToFront()
        osd.bringToFront()
        player?.setEventListener { event ->
            if (event.type == MediaPlayer.Event.EndReached) {
                handler.post { refresh(true) }
            }
        }
        refresh(true)
        handler.post(tick)
        handler.postDelayed(poll, 20000)
    }

    private fun refresh(forceSwitch: Boolean) {
        thread {
            try {
                val now = Api.now(channelId)
                runOnUiThread { applyNow(now, forceSwitch) }
            } catch (err: Exception) {
                runOnUiThread {
                    Toast.makeText(this, err.message ?: "同步失败", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun applyNow(now: NowPlaying, forceSwitch: Boolean) {
        fetchedAt = System.currentTimeMillis()
        remaining = now.remaining
        if (now.empty) {
            titleView.text = "这个频道还没有节目"
            nextView.text = ""
            return
        }
        titleView.text = now.title
        nextView.text = "下一节目 ${now.nextTitle} · 剩余 ${formatTime(now.remaining)}"
        liveView.visibility = View.VISIBLE
        placeLogo(now)
        if (forceSwitch || now.mediaId != mediaKey) {
            mediaKey = now.mediaId
            play(now.streamUrl, now.playhead)
        }
    }

    private fun play(url: String, startSec: Double) {
        val vlc = libVlc ?: return
        val media = Media(vlc, android.net.Uri.parse(url))
        media.addOption(":start-time=${max(0.0, startSec).toInt()}")
        media.addOption(":http-user-agent=iTV-Android/1.0")
        media.addOption(":http-referrer=")
        media.addOption(":network-caching=4000")
        player?.media = media
        media.release()
        player?.play()
        findViewById<View>(R.id.vol_rail).bringToFront()
        logoView.bringToFront()
        clockView.bringToFront()
        volumeHint.bringToFront()
        osd.bringToFront()
    }

    /**
     * 缩小到悬浮小窗。
     *
     * 安卓 7.1 没有系统画中画（要 API 26，这台是 25），所以是自己挂的窗口，
     * 需要「显示在其他应用上层」这个权限。没给的话直接跳到系统设置那一页，
     * 光弹个 Toast 说没权限，人是找不到该去哪儿开的。
     */
    private fun enterPip() {
        if (!PipService.canDraw(this)) {
            Toast.makeText(this, "需要「显示在其他应用上层」权限", Toast.LENGTH_LONG).show()
            runCatching {
                startActivity(
                    android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:$packageName"),
                    ),
                )
            }
            return
        }
        PipService.start(this, channelId, intent.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty())
        finish()
    }

    private fun beijingClock(): String {
        val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Shanghai"))
        return "%02d:%02d:%02d".format(
            cal.get(java.util.Calendar.HOUR_OF_DAY),
            cal.get(java.util.Calendar.MINUTE),
            cal.get(java.util.Calendar.SECOND),
        )
    }

    private fun placeLogo(now: NowPlaying) {
        val density = resources.displayMetrics.density
        val lp = logoView.layoutParams as FrameLayout.LayoutParams
        lp.width = (now.logoWidth * density).toInt().coerceAtLeast((96 * density).toInt())
        lp.leftMargin = (now.logoX * density).toInt()
        lp.topMargin = (now.logoY * density).toInt()
        logoView.layoutParams = lp
        val clockLp = clockView.layoutParams as FrameLayout.LayoutParams
        clockLp.topMargin = (now.logoY * density).toInt()
        clockLp.marginEnd = (now.logoX * density).toInt()
        clockView.layoutParams = clockLp
        clockView.visibility = View.VISIBLE
        clockView.bringToFront()
        logoView.bringToFront()
        logoView.visibility = if (now.logoUrl.isBlank()) View.GONE else View.VISIBLE
        if (now.logoUrl.isBlank()) return
        thread {
            try {
                URL(now.logoUrl).openStream().use { stream ->
                    val bmp = BitmapFactory.decodeStream(stream)
                    runOnUiThread { logoView.setImageBitmap(bmp) }
                }
            } catch (_: Exception) {
                runOnUiThread { logoView.visibility = View.GONE }
            }
        }
    }

    private fun toggleImmersive() {
        immersive = !immersive
        applyImmersive()
    }

    private fun toggleOsd() {
        val show = osd.visibility != View.VISIBLE
        osd.visibility = if (show) View.VISIBLE else View.GONE
        findViewById<View>(R.id.to_pip).visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun nudgeVolume(up: Boolean) {
        audio.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            if (up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
            0,
        )
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val now = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        volumeHint.text = "音量 ${now * 100 / max}%"
        volumeHint.visibility = View.VISIBLE
        handler.removeCallbacks(hideVolume)
        handler.postDelayed(hideVolume, 1400)
    }

    private fun applyImmersive() {
        val flags = if (immersive) {
            (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        } else {
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
        window.decorView.systemUiVisibility = flags
    }

    private val hideVolume = Runnable { volumeHint.visibility = View.GONE }

    private fun formatTime(sec: Double): String {
        val s = max(0, sec.toInt())
        val m = s / 60
        val r = s % 60
        return "%d:%02d".format(m, r)
    }

    override fun onStop() {
        player?.pause()
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        player?.play()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.setEventListener(null)
        player?.detachViews()
        player?.release()
        libVlc?.release()
        player = null
        libVlc = null
        super.onDestroy()
    }
}
