package cc.ityc.itv

import android.content.Context
import org.videolan.libvlc.MediaPlayer

/**
 * 播放音量，0 到 150，每档 10。
 *
 * 用 libVLC 自己的音量而不是系统的 STREAM_MUSIC：系统音量最高就是 100%，
 * 而且档位由 ROM 定（这台盒子是 15 档，一档 6.7%，对不齐整十）。
 * libVLC 的 setVolume 支持到 200，超过 100 的部分是软件增益——
 * 片源音轨偏小的时候正是要靠它。
 *
 * 全屏和小窗共用一份，存在 SharedPreferences 里，重启、切窗口都不丢。
 */
object Volume {
    const val STEP = 10
    const val MAX = 150
    private const val KEY = "volume_pct"
    private const val DEFAULT = 100

    fun get(ctx: Context): Int =
        ctx.getSharedPreferences("itv", Context.MODE_PRIVATE).getInt(KEY, DEFAULT).coerceIn(0, MAX)

    fun set(ctx: Context, pct: Int): Int {
        val v = snap(pct)
        ctx.getSharedPreferences("itv", Context.MODE_PRIVATE).edit().putInt(KEY, v).apply()
        return v
    }

    /** 往上/往下挪一档。不是在当前值上加减，而是先对齐到整十再挪，免得手动设过奇怪的值之后一直错位 */
    fun nudge(ctx: Context, up: Boolean): Int {
        val cur = snap(get(ctx))
        return set(ctx, if (up) cur + STEP else cur - STEP)
    }

    private fun snap(pct: Int): Int {
        val rounded = (pct + STEP / 2) / STEP * STEP
        return rounded.coerceIn(0, MAX)
    }

    /** 把当前档位应用到播放器上 */
    fun apply(ctx: Context, player: MediaPlayer?) {
        player ?: return
        runCatching { player.volume = get(ctx) }
    }
}
