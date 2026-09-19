package cc.ityc.itv

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import cc.ityc.itv.databinding.ActivityMainBinding
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val items = mutableListOf<ChannelItem>()
    private val adapter = ChannelAdapter(items) { openChannel(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        Api.baseUrl = getSharedPreferences("itv", MODE_PRIVATE)
            .getString("baseUrl", Api.baseUrl) ?: Api.baseUrl

        binding.list.layoutManager = LinearLayoutManager(this)
        binding.list.adapter = adapter
        binding.refresh.setOnClickListener { load() }
        binding.checkUpdate.setOnClickListener { checkUpdate(false) }
        binding.server.setOnClickListener { editServer() }
        binding.github.setOnClickListener { editGithubToken() }
        binding.server.text = Api.baseUrl
        refreshGithubLabel()
        load()
        if (githubToken().isNotBlank()) checkUpdate(true)
    }

    private fun prefs() = getSharedPreferences("itv", MODE_PRIVATE)

    private fun githubToken(): String = prefs().getString("githubToken", "").orEmpty()

    private fun refreshGithubLabel() {
        binding.github.text = if (githubToken().isBlank()) {
            "GitHub 令牌：未填写（点此填入后可检查更新）"
        } else {
            "GitHub 令牌：已保存（点此修改） · 当前 ${BuildConfig.VERSION_NAME}"
        }
    }

    private fun editServer() {
        val input = EditText(this).apply {
            setText(Api.baseUrl)
            setHint("https://itv.ityc.cc")
        }
        AlertDialog.Builder(this)
            .setTitle("服务器地址")
            .setView(input)
            .setPositiveButton("保存") { _, _ ->
                val url = input.text.toString().trim().trimEnd('/')
                if (url.startsWith("http")) {
                    Api.baseUrl = url
                    prefs().edit().putString("baseUrl", url).apply()
                    binding.server.text = url
                    load()
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun editGithubToken() {
        val input = EditText(this).apply {
            setText(githubToken())
            hint = "ghp_ 开头的令牌"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle("GitHub 令牌")
            .setMessage("用于读取 tyrantcwj/iTV 的 android-latest 发布。需要 repo 或 public_repo 权限。")
            .setView(input)
            .setPositiveButton("保存") { _, _ ->
                prefs().edit().putString("githubToken", input.text.toString().trim()).apply()
                refreshGithubLabel()
                if (githubToken().isNotBlank()) checkUpdate(true)
            }
            .setNegativeButton("取消", null)
            .setNeutralButton("清除") { _, _ ->
                prefs().edit().remove("githubToken").apply()
                refreshGithubLabel()
            }
            .show()
    }

    private fun checkUpdate(silent: Boolean) {
        val token = githubToken()
        if (token.isBlank()) {
            if (!silent) Toast.makeText(this, "请先填写 GitHub 令牌", Toast.LENGTH_SHORT).show()
            return
        }
        if (!silent) binding.status.text = "正在检查更新…"
        thread {
            try {
                val remote = Update.check(token)
                runOnUiThread { showUpdateResult(remote, silent) }
            } catch (err: Exception) {
                runOnUiThread {
                    if (!silent) {
                        binding.status.text = "检查更新失败：${err.message}"
                        Toast.makeText(this, err.message, Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun showUpdateResult(remote: ApkRelease, silent: Boolean) {
        val local = BuildConfig.VERSION_CODE
        if (remote.versionCode <= local) {
            if (!silent) {
                binding.status.text = "已是最新 ${BuildConfig.VERSION_NAME}"
                Toast.makeText(this, "已是最新 ${BuildConfig.VERSION_NAME}", Toast.LENGTH_SHORT).show()
            }
            return
        }
        AlertDialog.Builder(this)
            .setTitle("发现新版本")
            .setMessage("当前 ${BuildConfig.VERSION_NAME}（$local）\n最新 ${remote.versionName}（${remote.versionCode}）\n\n打开下载页覆盖安装？")
            .setPositiveButton("下载") { _, _ ->
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(remote.downloadUrl)))
            }
            .setNegativeButton("稍后", null)
            .show()
    }

    private fun load() {
        binding.status.text = "正在加载频道…"
        thread {
            try {
                val data = Api.channels()
                runOnUiThread {
                    items.clear()
                    items.addAll(data)
                    adapter.notifyDataSetChanged()
                    binding.status.text = if (data.isEmpty()) "还没有频道" else "点选频道开始收看"
                }
            } catch (err: Exception) {
                runOnUiThread {
                    binding.status.text = "加载失败：${err.message}"
                    Toast.makeText(this, err.message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun openChannel(item: ChannelItem) {
        startActivity(
            Intent(this, PlayerActivity::class.java)
                .putExtra(PlayerActivity.EXTRA_CHANNEL_ID, item.id)
                .putExtra(PlayerActivity.EXTRA_CHANNEL_NAME, item.name),
        )
    }
}

class ChannelAdapter(
    private val items: List<ChannelItem>,
    private val onClick: (ChannelItem) -> Unit,
) : RecyclerView.Adapter<ChannelAdapter.Holder>() {
    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val name: TextView = view.findViewById(R.id.name)
        val now: TextView = view.findViewById(R.id.now)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false)
        return Holder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.name.text = item.name
        holder.now.text = item.nowTitle.ifBlank { "暂无节目" }
        holder.itemView.setOnClickListener { onClick(item) }
    }
}
