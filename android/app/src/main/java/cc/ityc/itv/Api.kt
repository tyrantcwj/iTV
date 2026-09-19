package cc.ityc.itv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ChannelItem(
    val id: String,
    val name: String,
    val logoUrl: String,
    val nowTitle: String,
)

data class NowPlaying(
    val empty: Boolean,
    val channelName: String,
    val logoUrl: String,
    val logoWidth: Int,
    val logoX: Int,
    val logoY: Int,
    val mediaId: String,
    val title: String,
    val nextTitle: String,
    val playhead: Double,
    val remaining: Double,
    val streamUrl: String,
)

object Api {
    var baseUrl: String = "https://itv.ityc.cc"

    fun abs(path: String): String {
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return baseUrl.trimEnd('/') + (if (path.startsWith("/")) path else "/$path")
    }

    fun channels(): List<ChannelItem> {
        val json = get("/api/channels")
        val items = json.getJSONArray("items")
        return buildList {
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                val now = o.optJSONObject("now")
                add(
                    ChannelItem(
                        id = o.getString("id"),
                        name = o.optString("name"),
                        logoUrl = abs(o.optString("logoUrl")),
                        nowTitle = now?.optString("title").orEmpty(),
                    ),
                )
            }
        }
    }

    fun now(channelId: String): NowPlaying {
        val json = get("/api/channels/$channelId/now")
        val channel = json.optJSONObject("channel") ?: JSONObject()
        val current = json.optJSONObject("current")
        val next = json.optJSONObject("next")
        return NowPlaying(
            empty = json.optBoolean("empty") || current == null,
            channelName = channel.optString("name"),
            logoUrl = abs(channel.optString("logoUrl")),
            logoWidth = channel.optInt("logoWidth", 200),
            logoX = channel.optInt("logoX", 24),
            logoY = channel.optInt("logoY", 24),
            mediaId = current?.optString("mediaId").orEmpty(),
            title = current?.optString("title").orEmpty(),
            nextTitle = next?.optString("title").orEmpty(),
            playhead = current?.optDouble("playhead", 0.0) ?: 0.0,
            remaining = current?.optDouble("remaining", 0.0) ?: 0.0,
            streamUrl = abs(current?.optString("streamUrl").orEmpty()),
        )
    }

    private fun get(path: String): JSONObject {
        val conn = (URL(abs(path)).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 20000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "iTV-Android/1.0")
        }
        conn.inputStream.bufferedReader().use { reader ->
            return JSONObject(reader.readText())
        }
    }
}
