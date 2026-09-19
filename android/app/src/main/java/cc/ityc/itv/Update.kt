package cc.ityc.itv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ApkRelease(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
)

object Update {
    const val REPO = "tyrantcwj/iTV"
    const val TAG = "android-latest"

    fun check(token: String): ApkRelease {
        val key = token.trim()
        if (key.isEmpty()) throw IllegalArgumentException("请先填写 GitHub 令牌")
        val release = getJson(
            "https://api.github.com/repos/$REPO/releases/tags/$TAG",
            key,
        )
        val assets = release.optJSONArray("assets") ?: throw IllegalStateException("发布里没有安装包")
        var apkUrl = ""
        var versionUrl = ""
        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            when (asset.optString("name")) {
                "itv-android7.apk" -> apkUrl = asset.optString("browser_download_url")
                "version.json" -> versionUrl = asset.optString("browser_download_url")
            }
        }
        if (apkUrl.isBlank()) throw IllegalStateException("发布里没有 itv-android7.apk")
        val fromBody = parseBody(release.optString("body"))
        val remote = when {
            fromBody != null -> fromBody
            versionUrl.isNotBlank() -> {
                val ver = getJson(versionUrl, key, "application/json")
                Pair(ver.optInt("versionCode", 0), ver.optString("versionName", "未知"))
            }
            else -> null
        } ?: throw IllegalStateException("发布里没有版本号，请重新跑一次 Android APK workflow")
        return ApkRelease(remote.first, remote.second, apkUrl)
    }

    private fun parseBody(body: String): Pair<Int, String>? {
        val code = Regex("""versionCode\s*[:=]\s*(\d+)""").find(body)?.groupValues?.get(1)?.toIntOrNull()
        val name = Regex("""versionName\s*[:=]\s*([0-9A-Za-z._-]+)""").find(body)?.groupValues?.get(1)
        if (code == null || code <= 0) return null
        return Pair(code, name ?: code.toString())
    }

    private fun getJson(url: String, token: String, accept: String = "application/vnd.github+json"): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 20000
            instanceFollowRedirects = true
            requestMethod = "GET"
            setRequestProperty("Accept", accept)
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "iTV-Android/${BuildConfig.VERSION_NAME}")
        }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() }
            .orEmpty()
        if (code == 401 || code == 403) {
            throw IllegalStateException("GitHub 令牌无效或权限不足")
        }
        if (code !in 200..299) {
            throw IllegalStateException("检查更新失败（$code）")
        }
        return JSONObject(text)
    }
}
