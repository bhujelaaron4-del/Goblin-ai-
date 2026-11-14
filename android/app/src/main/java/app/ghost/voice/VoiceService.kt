package app.ghost.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Listens for "Hey Ghost" with an offline model that runs on this phone. No audio is sent anywhere.
 * After the wake phrase it turns your command into text on the phone and sends only that text to Ghost.
 */
class VoiceService : Service() {
    companion object {
        const val ACTION_STOP = "app.ghost.voice.STOP"
        const val ACTION_MUTE = "app.ghost.voice.MUTE"
        const val ACTION_YES = "app.ghost.voice.YES"
        const val ACTION_NO = "app.ghost.voice.NO"
        private const val CH_LISTEN = "listening"
        private const val CH_ASK = "asking"
        private const val SAMPLE_RATE = 16000
        private val urlOk = Regex("^(https://[^\\s\"'<>]{1,300}|tel:\\+?[0-9]{5,15}|sms:\\+?[0-9]{5,15}(\\?body=[A-Za-z0-9%._~-]{0,900})?|intent:#Intent;[A-Za-z0-9_.=;]{1,300}end)$")
        private val intentActions = setOf(
            "android.intent.action.SET_ALARM", "android.intent.action.SET_TIMER", "android.intent.action.SHOW_ALARMS",
            "android.media.action.STILL_IMAGE_CAMERA", "android.settings.SETTINGS"
        )
    }

    @Volatile private var running = false
    private var worker: Thread? = null
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false
    private val history = ArrayList<JSONObject>()
    private var receiver: BroadcastReceiver? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LISTEN, "Ghost is listening", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_ASK, "Ghost asks you", NotificationManager.IMPORTANCE_HIGH))
        tts = TextToSpeech(this) { st ->
            ttsReady = st == TextToSpeech.SUCCESS
            if (ttsReady) {
                val r = tts?.setLanguage(Locale.getDefault())
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts?.setLanguage(Locale.US)
            }
        }
        receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) {
                val pid = i?.getStringExtra("pid") ?: return
                val yes = i?.action == ACTION_YES
                getSystemService(NotificationManager::class.java).cancel(2)
                Thread { answerConfirm(pid, yes) }.start()
            }
        }
        val f = IntentFilter().apply { addAction(ACTION_YES); addAction(ACTION_NO) }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, f)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopEverything(); return START_NOT_STICKY }
            ACTION_MUTE -> { Status.muted = !Status.muted; notifyListening(); return START_NOT_STICKY }
        }
        if (running) return START_NOT_STICKY
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Status.line = "The microphone permission is off."
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            val n = buildListening()
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(1, n)
        } catch (e: Exception) {
            Status.line = "Android did not let Ghost listen: " + (e.message ?: "unknown reason")
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        Status.running = true
        Status.muted = false
        worker = Thread { loop() }.also { it.start() }
        return START_NOT_STICKY
    }

    // ---------------------------------------------------------------- notification
    private fun pending(action: String, code: Int): PendingIntent =
        PendingIntent.getService(this, code, Intent(this, VoiceService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    @Suppress("DEPRECATION")
    private fun buildListening(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CH_LISTEN)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(if (Status.muted) "Ghost is muted" else "Ghost is listening for \"Hey Ghost\"")
            .setContentText("The microphone is " + (if (Status.muted) "off." else "on. Your voice stays on this phone."))
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, if (Status.muted) "Unmute" else "Mute", pending(ACTION_MUTE, 1))
            .addAction(android.R.drawable.ic_delete, "Stop listening", pending(ACTION_STOP, 2))
            .build()
    }

    private fun notifyListening() {
        getSystemService(NotificationManager::class.java).notify(1, buildListening())
    }

    // ---------------------------------------------------------------- speaking
    @Synchronized
    private fun speak(text: String) {
        val t = tts ?: return
        if (!ttsReady || text.isBlank()) return
        val latch = CountDownLatch(1)
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { latch.countDown() }
            @Deprecated("Deprecated in Java")
            override fun onError(id: String?) { latch.countDown() }
        })
        t.speak(text.take(400), TextToSpeech.QUEUE_FLUSH, null, "u" + System.nanoTime())
        latch.await(25, TimeUnit.SECONDS)
    }

    // ---------------------------------------------------------------- the listening loop
    private fun loop() {
        var model: Model? = null
        var wake: Recognizer? = null
        var ar: AudioRecord? = null
        try {
            val dir = ModelStore.path(this) ?: throw RuntimeException("The voice model is missing. Open the app and press Start.")
            Status.line = "Loading the voice model..."
            model = Model(dir.absolutePath)
            wake = Recognizer(model, SAMPLE_RATE.toFloat(), "[\"hey ghost\", \"[unk]\"]")
            val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val buf = ByteArray(maxOf(min, 4096))
            ar = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buf.size * 2)
            if (ar.state != AudioRecord.STATE_INITIALIZED) throw RuntimeException("The microphone could not start. Another app may be using it.")
            var recording = false
            var lastPing = 0L
            while (running) {
                if (Status.muted) {
                    if (recording) { ar.stop(); recording = false }
                    Status.line = "Muted. The microphone is off."
                    Thread.sleep(300)
                    continue
                }
                if (!recording) { ar.startRecording(); recording = true; wake.reset() }
                if (System.currentTimeMillis() - lastPing > 300000) {
                    lastPing = System.currentTimeMillis()
                    pingGhost()
                }
                Status.line = "Listening for \"Hey Ghost\""
                val n = ar.read(buf, 0, buf.size)
                if (n <= 0) { Thread.sleep(40); continue }
                val text = if (wake.acceptWaveForm(buf, n)) JSONObject(wake.result).optString("text") else JSONObject(wake.partialResult).optString("partial")
                if (text.contains("hey ghost")) {
                    wake.reset()
                    converse(model, ar, buf)
                    wake.reset()
                }
            }
        } catch (e: Exception) {
            Status.line = "Stopped: " + (e.message ?: "unknown problem")
        } finally {
            try { ar?.stop() } catch (e: Exception) {}
            ar?.release()
            wake?.close()
            model?.close()
            running = false
            Status.running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun pingGhost() {
        val p = GhostApi.load(this) ?: return
        Thread {
            try { GhostApi.post(p, JSONObject().put("action", "ping")); Status.online = true } catch (e: Exception) { Status.online = false }
        }.start()
    }

    private fun flush(ar: AudioRecord) {
        try { ar.stop(); ar.startRecording() } catch (e: Exception) {}
    }

    /** One full conversation after "Hey Ghost": several commands in a row until silence or "thank you". */
    private fun converse(model: Model, ar: AudioRecord, buf: ByteArray) {
        val p = GhostApi.load(this)
        if (p == null) {
            speak("This phone is not paired with Ghost yet. Open the Ghost Voice app and paste the pairing code.")
            flush(ar)
            return
        }
        history.clear()
        speak("I'm here. What can I do for you?")
        flush(ar)
        var turn = 0
        while (running && !Status.muted) {
            val cmd = listenCommand(model, ar, buf, if (turn == 0) 8000L else 6000L)
            if (cmd == null) {
                if (turn == 0) speak("I did not hear anything.")
                break
            }
            turn++
            val low = cmd.lowercase(Locale.ROOT).trim()
            Status.line = "You said: $cmd"
            if (Regex("^(stop listening|turn off voice|disable wake word)$").matches(low)) {
                speak("Okay. Wake-word detection is disabled.")
                stopEverything()
                return
            }
            if (Regex("^(emergency stop|stop everything)$").matches(low)) {
                try { GhostApi.post(p, JSONObject().put("action", "stop")) } catch (e: Exception) {}
                speak("Emergency stop. Everything is blocked.")
                stopEverything()
                return
            }
            if (Regex("^(never mind|that is all|thank you|thanks|goodbye|bye)$").matches(low)) {
                speak("Okay.")
                break
            }
            try {
                val body = JSONObject().put("action", "voice").put("text", cmd).put("tz", TimeZone.getDefault().id).put("history", JSONArray(history))
                val a = GhostApi.post(p, body)
                Status.online = true
                var said = a.optString("reply")
                val ev = a.optJSONArray("events") ?: JSONArray()
                var asked = false
                for (i in 0 until ev.length()) {
                    val e = ev.getJSONObject(i)
                    when (e.optString("type")) {
                        "open" -> openOnPhone(e.optString("url"), e.optString("text"))
                        "confirm" -> {
                            asked = true
                            askConfirm(e.optString("pid"), e.optString("text"))
                            said = "Please confirm on your phone screen: " + e.optString("text")
                        }
                    }
                }
                if (said.isBlank()) said = "Done."
                Status.line = "Ghost: $said"
                speak(said)
                flush(ar)
                history.add(JSONObject().put("role", "user").put("content", cmd))
                history.add(JSONObject().put("role", "assistant").put("content", said))
                while (history.size > 8) history.removeAt(0)
                if (asked) break
            } catch (e: Exception) {
                Status.online = false
                Status.line = "Could not reach Ghost: " + (e.message ?: "")
                speak("Sorry, I could not reach Ghost.")
                break
            }
        }
        Status.line = "Listening for \"Hey Ghost\""
    }

    /** Turns speech into text, on this phone. Returns null when nothing was said. */
    private fun listenCommand(model: Model, ar: AudioRecord, buf: ByteArray, firstWaitMs: Long): String? {
        val rec = Recognizer(model, SAMPLE_RATE.toFloat())
        try {
            val start = System.currentTimeMillis()
            var spoke = false
            Status.line = "Listening for your command..."
            while (running && !Status.muted) {
                val waited = System.currentTimeMillis() - start
                if (!spoke && waited > firstWaitMs) return null
                if (waited > 20000) break
                val n = ar.read(buf, 0, buf.size)
                if (n <= 0) continue
                if (rec.acceptWaveForm(buf, n)) {
                    val t = JSONObject(rec.result).optString("text").trim()
                    if (t.isNotEmpty()) return t
                } else if (JSONObject(rec.partialResult).optString("partial").isNotEmpty()) {
                    spoke = true
                }
            }
            val t = JSONObject(rec.finalResult).optString("text").trim()
            return if (t.isEmpty()) null else t
        } finally {
            rec.close()
        }
    }

    // ---------------------------------------------------------------- things Ghost asks the phone to do
    private fun makeIntent(url: String): Intent? {
        if (!urlOk.matches(url)) return null
        val i: Intent = when {
            url.startsWith("intent:") -> {
                val x = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                val act = x.action ?: return null
                if (act !in intentActions) return null
                x.component = null
                x.selector = null
                x
            }
            url.startsWith("tel:") -> Intent(Intent.ACTION_DIAL, Uri.parse(url)) // opens the dialer, you press Call
            else -> Intent(Intent.ACTION_VIEW, Uri.parse(url))
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return i
    }

    /** Android only lets an app open other apps from the background if "display over other apps" is allowed. Otherwise: a notification to tap. */
    private fun openOnPhone(url: String, label: String) {
        val i = (try { makeIntent(url) } catch (e: Exception) { null }) ?: return
        if (Settings.canDrawOverlays(this)) {
            try { startActivity(i); return } catch (e: Exception) { /* fall back to the notification */ }
        }
        val pi = PendingIntent.getActivity(this, (System.nanoTime() % 100000).toInt(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CH_ASK)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Tap to continue")
            .setContentText(label.ifBlank { "Open" })
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(3, n)
    }

    @Suppress("DEPRECATION")
    private fun askConfirm(pid: String, what: String) {
        fun act(action: String, code: Int): PendingIntent =
            PendingIntent.getBroadcast(this, code, Intent(action).setPackage(packageName).putExtra("pid", pid), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CH_ASK)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Ghost needs your OK")
            .setContentText(what)
            .setStyle(Notification.BigTextStyle().bigText(what))
            .addAction(android.R.drawable.ic_input_add, "Yes, do it", act(ACTION_YES, 10))
            .addAction(android.R.drawable.ic_delete, "No", act(ACTION_NO, 11))
            .setOngoing(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(2, n)
    }

    private fun answerConfirm(pid: String, yes: Boolean) {
        val p = GhostApi.load(this) ?: return
        try {
            if (!yes) {
                GhostApi.post(p, JSONObject().put("action", "decline").put("pid", pid))
                speak("Okay, cancelled.")
                return
            }
            val r = GhostApi.post(p, JSONObject().put("action", "confirm").put("pid", pid))
            val msg = r.optString("message", "")
            speak(if (r.optString("status") == "done") msg.ifBlank { "Done." } else "That did not work. $msg")
        } catch (e: Exception) {
            speak("Sorry, I could not reach Ghost.")
        }
    }

    private fun stopEverything() {
        running = false
        Status.line = "Stopped"
        Status.running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        Status.running = false
        if (Status.line.startsWith("Listening") || Status.line.startsWith("Muted")) Status.line = "Stopped"
        try { receiver?.let { unregisterReceiver(it) } } catch (e: Exception) {}
        tts?.shutdown()
        super.onDestroy()
    }
}
