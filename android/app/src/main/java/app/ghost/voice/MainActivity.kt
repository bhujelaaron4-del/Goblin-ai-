package app.ghost.voice

import android.Manifest
import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject

/** One simple screen: pair with Ghost, start or stop listening, and the permissions Android asks for. */
class MainActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var pairView: TextView
    private lateinit var codeBox: EditText
    private val ui = Handler(Looper.getMainLooper())
    @Volatile private var installing = false

    private val tick = object : Runnable {
        override fun run() {
            refresh()
            ui.postDelayed(this, 1000)
        }
    }

    private fun button(label: String, onClick: () -> Unit): Button =
        Button(this).apply { text = label; isAllCaps = false; setOnClickListener { onClick() } }

    private fun text(s: String, size: Float = 14f): TextView =
        TextView(this).apply { text = s; textSize = size; setPadding(0, 12, 0, 4) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 40, 40, 60) }

        box.addView(text("Ghost Voice", 26f))
        statusView = text("", 18f)
        box.addView(statusView)
        pairView = text("")
        box.addView(pairView)

        box.addView(text("1. Pair with Ghost", 16f))
        box.addView(text("In Ghost, open the menu, then My Phone, then press Copy pairing code. Come back here and press the button below."))
        codeBox = EditText(this).apply { hint = "Pairing code"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE; maxLines = 2 }
        box.addView(codeBox)
        box.addView(button("Paste from clipboard and pair") { pair() })

        box.addView(text("2. Listen for \"Hey Ghost\"", 16f))
        box.addView(button("Start listening") { startListening() })
        box.addView(button("Mute / unmute microphone") { startService(Intent(this, VoiceService::class.java).setAction(VoiceService.ACTION_MUTE)) })
        box.addView(button("Stop listening") { startService(Intent(this, VoiceService::class.java).setAction(VoiceService.ACTION_STOP)) })
        box.addView(button("EMERGENCY STOP (block everything)") { emergency() })

        box.addView(text("3. Optional, for better results", 16f))
        box.addView(button("Allow opening apps while the screen is off") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        box.addView(button("Battery settings (let Ghost keep running)") {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        })
        box.addView(button("Forget this pairing") {
            startService(Intent(this, VoiceService::class.java).setAction(VoiceService.ACTION_STOP))
            GhostApi.forget(this)
            refresh()
        })

        box.addView(text(
            "How it works: the microphone is only used on this phone. A voice model inside the app waits for \"Hey Ghost\". " +
            "Nothing is recorded or sent until you say it, and then only the words you said are sent to Ghost as text. " +
            "A notification stays on screen while Ghost is listening, with Mute and Stop buttons.\n\n" +
            "Limits you should know: Android may stop the app to save battery (Samsung, Xiaomi, Oppo, Huawei and others are strict; use the battery button above and see dontkillmyapp.com). " +
            "If you Force stop the app, or restart the phone, it will not listen until you press Start again. " +
            "Apps open directly only if you allowed \"display over other apps\"; otherwise Ghost shows a notification to tap. " +
            "Ghost cannot read your notifications, calls or messages. Calls open the dialer and messages open the message app; you press Call or Send."
        , 13f))

        setContentView(ScrollView(this).apply { addView(box) })
    }

    override fun onResume() {
        super.onResume()
        ui.post(tick)
    }

    override fun onPause() {
        ui.removeCallbacks(tick)
        super.onPause()
    }

    private fun refresh() {
        val p = GhostApi.load(this)
        pairView.text = if (p == null) "Not paired with Ghost yet." else "Paired with " + p.url.removePrefix("https://")
        val model = if (ModelStore.ready(this)) "" else "\nThe voice model will unpack the first time you press Start."
        statusView.text = Status.line + model
        if (installing) return
    }

    private fun pair() {
        var raw = codeBox.text.toString()
        if (raw.isBlank()) {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            raw = cm.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
            codeBox.setText(raw)
        }
        val p = GhostApi.parse(raw)
        if (p == null) {
            toast("That is not a Ghost pairing code. Copy it again in Ghost (My Phone).")
            return
        }
        GhostApi.save(this, p)
        Thread {
            try {
                GhostApi.post(p, JSONObject().put("action", "ping"))
                runOnUiThread { toast("Paired. Ghost can see this phone."); codeBox.setText("") }
            } catch (e: Exception) {
                runOnUiThread { toast("Saved, but could not reach Ghost: " + (e.message ?: "")) }
            }
        }.start()
    }

    private fun startListening() {
        if (GhostApi.load(this) == null) { toast("Pair with Ghost first (step 1)."); return }
        val need = ArrayList<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS)
        if (need.isNotEmpty()) {
            requestPermissions(need.toTypedArray(), 1)
            return
        }
        if (!ModelStore.ready(this)) {
            if (installing) return
            installing = true
            Status.line = "Unpacking the voice model..."
            Thread {
                try {
                    ModelStore.install(this) { Status.line = it }
                    runOnUiThread { launch() }
                } catch (e: Exception) {
                    Status.line = "Could not unpack the voice model: " + (e.message ?: "")
                } finally {
                    installing = false
                }
            }.start()
            return
        }
        launch()
    }

    private fun launch() {
        Status.line = "Starting..."
        startForegroundService(Intent(this, VoiceService::class.java))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else Status.line = "Ghost cannot listen without the microphone permission."
    }

    private fun emergency() {
        val p = GhostApi.load(this)
        startService(Intent(this, VoiceService::class.java).setAction(VoiceService.ACTION_STOP))
        if (p == null) { toast("Stopped listening."); return }
        Thread {
            try {
                GhostApi.post(p, JSONObject().put("action", "stop"))
                runOnUiThread { toast("Emergency stop is on. Turn it back on in Ghost (My PC).") }
            } catch (e: Exception) {
                runOnUiThread { toast("Stopped listening, but could not tell Ghost: " + (e.message ?: "")) }
            }
        }.start()
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()
}
