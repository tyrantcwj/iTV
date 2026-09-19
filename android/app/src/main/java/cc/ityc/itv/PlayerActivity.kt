package cc.ityc.itv

import android.graphics.BitmapFactory
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
    private lateinit var osd: View

    private var libVlc: LibVLC? = null
    private var player: MediaPlayer? = null
    private var mediaKey = ""
    private var remaining = 0.0
    private var introAt = 0.0
    private var introSec = 0.0
    private var outroSec = 0.0
    private var durationSec = 0.0
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
            skipMarksIfNeeded()
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
        osd = findViewById(R.id.osd)
        clockView.text = beijingClock()
        titleView.text = intent.getStringExtra(EXTRA_CHANNEL_NAME)
        logoView.setOnClickListener { toggleImmersive() }
        findViewById<View>(R.id.root).setOnClickListener { showOsd() }
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
        logoView.bringToFront()
        clockView.bringToFront()
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
        introAt = now.introAt
        introSec = now.introSec
        outroSec = now.outroSec
        durationSec = now.durationSec
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
        showOsd()
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
        logoView.bringToFront()
        clockView.bringToFront()
        osd.bringToFront()
    }

    private fun skipMarksIfNeeded() {
        val t = (player?.time ?: -1) / 1000.0
        if (t < 0) return
        val introEnd = introAt + introSec
        if (introSec > 0 && t >= introAt && t < introEnd - 0.3) {
            player?.time = (introEnd * 1000).toLong()
            return
        }
        if (outroSec > 0 && durationSec > 0 && t >= durationSec - outroSec - 0.3) {
            refresh(true)
        }
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
        showOsd()
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

    private fun showOsd() {
        osd.visibility = View.VISIBLE
        handler.removeCallbacks(hideOsd)
        handler.postDelayed(hideOsd, 4000)
    }

    private val hideOsd = Runnable { osd.visibility = View.GONE }

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
