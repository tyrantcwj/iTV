package cc.ityc.itv

import android.content.Intent
import android.os.Bundle
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
        binding.server.setOnClickListener { editServer() }
        binding.server.text = Api.baseUrl
        load()
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
                    getSharedPreferences("itv", MODE_PRIVATE).edit().putString("baseUrl", url).apply()
                    binding.server.text = url
                    load()
                }
            }
            .setNegativeButton("取消", null)
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
