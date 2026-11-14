package app.ghost.voice

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class Pairing(val url: String, val key: String)

/** What the screen shows and what the service is doing right now. */
object Status {
    @Volatile var line: String = "Stopped"
    @Volatile var running: Boolean = false
    @Volatile var muted: Boolean = false
    @Volatile var online: Boolean = false
}

object GhostApi {
    private val keyShape = Regex("^[A-Za-z0-9]{20,100}$")

    /** The pairing code from Ghost looks like GHOST|https://your-address|secretkey */
    fun parse(code: String): Pairing? {
        val p = code.trim().split("|")
        if (p.size != 3 || p[0] != "GHOST") return null
        val url = p[1].trim().trimEnd('/')
        val key = p[2].trim()
        if (!url.startsWith("https://") || url.length > 200 || !keyShape.matches(key)) return null
        return Pairing(url, key)
    }

    fun load(ctx: Context): Pairing? {
        val sp = ctx.getSharedPreferences("ghost", Context.MODE_PRIVATE)
        val u = sp.getString("url", null) ?: return null
        val k = sp.getString("key", null) ?: return null
        return Pairing(u, k)
    }

    fun save(ctx: Context, p: Pairing) {
        ctx.getSharedPreferences("ghost", Context.MODE_PRIVATE).edit().putString("url", p.url).putString("key", p.key).apply()
    }

    fun forget(ctx: Context) {
        ctx.getSharedPreferences("ghost", Context.MODE_PRIVATE).edit().clear().apply()
    }

    /** Sends one request to Ghost with the phone's own key. Throws with a readable message when it fails. */
    fun post(p: Pairing, body: JSONObject): JSONObject {
        val c = URL(p.url + "/api/device").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15000
            c.readTimeout = 60000
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer " + p.key)
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw RuntimeException(json.optString("error", "Ghost answered with error $code"))
            return json
        } finally {
            c.disconnect()
        }
    }
}
