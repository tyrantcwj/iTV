package cc.ityc.itv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 悬浮小窗播放。
 *
 * 安卓 7.1.2 没有系统画中画——那要 API 26，这台盒子是 25，
 * pm list features 里也没有 picture-in-picture。
 * 所以用 SYSTEM_ALERT_WINDOW 自己挂一个窗口：能拖、能缩放、能点回全屏。
 *
 * 播放器是这个服务自己的一份，不是从 PlayerActivity 搬过来的。
 * LibVLC 的实例跟着 Activity 生命周期走，跨组件传递很容易泄漏 surface；
 * 反正节目单在服务端，重新问一次 now 就能接着放，代价只有一次缓冲。
 */
class PipService : Service() {

    companion object {
        const val EXTRA_CHANNEL_ID = "channelId"
        const val EXTRA_CHANNEL_NAME = "channelName"
        private const val CHANNEL = "itv_pip"
        private const val NOTE_ID = 42

        /** 有没有挂窗口的权限。没有的话调用方该去引导用户开 */
        fun canDraw(ctx: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

        fun start(ctx: Context, channelId: String, channelName: String) {
            val i = Intent(ctx, PipService::class.java)
                .putExtra(EXTRA_CHANNEL_ID, channelId)
                .putExtra(EXTRA_CHANNEL_NAME, channelName)
            ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, PipService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private var root: View? = null
    private lateinit var lp: WindowManager.LayoutParams

    private var libVlc: LibVLC? = null
    private var player: MediaPlayer? = null

    private var channelId = ""
    private var channelName = ""
    private var mediaKey = ""
    private var remaining = 0.0
    private var fetchedAt = 0L

    /** 小窗宽度档位，按屏幕宽度的比例来，换设备也不会变得太大或太小 */
    private val widthSteps = listOf(0.22f, 0.3f, 0.4f, 0.52f)
    private var stepIndex = 1

    private val tick = object : Runnable {
        override fun run() {
            val left = max(0.0, remaining - (System.currentTimeMillis() - fetchedAt) / 1000.0)
            if (left <= 0.4) refresh(true)
            handler.postDelayed(this, 1000)
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            refresh(false)
            handler.postDelayed(this, 20000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        goForeground()
        buildWindow()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_CHANNEL_ID).orEmpty()
        if (id.isNotEmpty() && id != channelId) {
            channelId = id
            channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty()
            mediaKey = ""
            root?.findViewById<TextView>(R.id.pip_title)?.text = channelName
            refresh(true)
            handler.removeCallbacks(tick)
            handler.removeCallbacks(poll)
            handler.post(tick)
            handler.postDelayed(poll, 20000)
        }
        return START_STICKY
    }

    /*
     * 挂前台通知。7.1 上不挂也能跑，但 targetSdk 34 的后台服务限制很严，
     * 同一个 APK 装到新设备上不挂就会被直接掐掉。
     */
    private fun goForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "小窗播放", NotificationManager.IMPORTANCE_LOW),
                )
            }
        }
        val tapBack = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            },
        )
        val n = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setContentTitle("iTV 小窗播放中")
            .setContentText(channelName.ifEmpty { "轮播" })
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(tapBack)
            .setOngoing(true)
            .build()
        startForeground(NOTE_ID, n)
    }

    private fun buildWindow() {
        val v = LayoutInflater.from(this).inflate(R.layout.pip_window, null)
        root = v

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        lp = WindowManager.LayoutParams(
            0,
            0,
            type,
            // 不抢焦点，否则底下的大屏就点不动了
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        applySize()
        // 默认落在右下角，跟网页那个小窗一个位置
        val m = screen()
        lp.x = m.first - lp.width - dp(16)
        lp.y = m.second - lp.height - dp(16)

        val bar = v.findViewById<View>(R.id.pip_bar)
        v.findViewById<TextView>(R.id.pip_title).text = channelName
        v.findViewById<View>(R.id.pip_expand).setOnClickListener { backToFullscreen() }
        v.findViewById<View>(R.id.pip_close).setOnClickListener { stopSelf() }
        v.findViewById<View>(R.id.pip_smaller).setOnClickListener { resize(-1) }
        v.findViewById<View>(R.id.pip_bigger).setOnClickListener { resize(1) }

        attachDrag(v, bar)
        wm.addView(v, lp)

        val videoLayout = v.findViewById<VLCVideoLayout>(R.id.pip_video)
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
        // 不设这个的话 4K 画面按 1:1 铺在小窗上，看到的是左上角那一小块。
        // 全屏播的时候窗口跟片源差不多大，所以那边看不出来。
        player?.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT
        player?.setEventListener { e ->
            if (e.type == MediaPlayer.Event.EndReached) handler.post { refresh(true) }
        }
    }

    /**
     * 拖动。
     *
     * 按下到抬起之间移动没超过阈值就算「点一下」，用来开关控制条；
     * 超过了才算拖，否则想点按钮的时候窗口会跟着手指飘。
     */
    private fun attachDrag(v: View, bar: View) {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        val slop = dp(8)

        v.setOnTouchListener { _, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX
                    downY = ev.rawY
                    startX = lp.x
                    startY = lp.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = ev.rawX - downX
                    val dy = ev.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
                    if (dragging) {
                        lp.x = startX + dx.roundToInt()
                        lp.y = startY + dy.roundToInt()
                        clampIntoScreen()
                        wm.updateViewLayout(v, lp)
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (!dragging) {
                        bar.visibility = if (bar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun resize(delta: Int) {
        val next = (stepIndex + delta).coerceIn(0, widthSteps.size - 1)
        if (next == stepIndex) return
        stepIndex = next
        applySize()
        clampIntoScreen()
        root?.let { wm.updateViewLayout(it, lp) }
        // 窗口尺寸变了，重新按新 surface 算一次缩放
        handler.post { player?.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT }
    }

    private fun applySize() {
        val w = (screen().first * widthSteps[stepIndex]).toInt()
        lp.width = w
        // 16:9，电视轮播的片源都是这个比例
        lp.height = (w * 9 / 16f).toInt()
    }

    private fun clampIntoScreen() {
        val (sw, sh) = screen()
        lp.x = lp.x.coerceIn(0, max(0, sw - lp.width))
        lp.y = lp.y.coerceIn(0, max(0, sh - lp.height))
    }

    private fun screen(): Pair<Int, Int> {
        val dm = resources.displayMetrics
        return dm.widthPixels to dm.heightPixels
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).roundToInt()

    private fun backToFullscreen() {
        val i = Intent(this, PlayerActivity::class.java)
            .putExtra(PlayerActivity.EXTRA_CHANNEL_ID, channelId)
            .putExtra(PlayerActivity.EXTRA_CHANNEL_NAME, channelName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        startActivity(i)
        stopSelf()
    }

    private fun refresh(forceSwitch: Boolean) {
        if (channelId.isEmpty()) return
        thread {
            try {
                val now = Api.now(channelId)
                handler.post { applyNow(now, forceSwitch) }
            } catch (_: Exception) {
                // 小窗上没地方显示错误，下一轮轮询会再试
            }
        }
    }

    private fun applyNow(now: NowPlaying, forceSwitch: Boolean) {
        fetchedAt = System.currentTimeMillis()
        remaining = now.remaining
        if (now.empty) return
        root?.findViewById<TextView>(R.id.pip_title)?.text = "$channelName · ${now.title}"
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
        // 换片会重挂 surface，缩放方式得再设一次
        player?.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(tick)
        handler.removeCallbacks(poll)
        player?.stop()
        player?.detachViews()
        player?.release()
        libVlc?.release()
        player = null
        libVlc = null
        root?.let { runCatching { wm.removeView(it) } }
        root = null
    }
}
