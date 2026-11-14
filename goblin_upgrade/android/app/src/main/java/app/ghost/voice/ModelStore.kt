package app.ghost.voice

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/** The offline voice model (Vosk small English) travels inside the app and is unpacked once. */
object ModelStore {
    fun path(ctx: Context): File? =
        ctx.filesDir.listFiles()?.firstOrNull { it.isDirectory && it.name.startsWith("vosk-model") && File(it, ".done").exists() }

    fun ready(ctx: Context): Boolean = path(ctx) != null

    fun install(ctx: Context, progress: (String) -> Unit) {
        val target = ctx.filesDir
        val root = target.canonicalPath + File.separator
        var count = 0
        ZipInputStream(ctx.assets.open("model.zip").buffered()).use { zin ->
            var e = zin.nextEntry
            while (e != null) {
                val out = File(target, e.name)
                if (!out.canonicalPath.startsWith(root)) throw RuntimeException("The voice model file is not safe.")
                if (e.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { zin.copyTo(it) }
                    count++
                    if (count % 15 == 0) progress("Unpacking the voice model... ($count files)")
                }
                zin.closeEntry()
                e = zin.nextEntry
            }
        }
        val dir = target.listFiles()?.firstOrNull { it.isDirectory && it.name.startsWith("vosk-model") }
            ?: throw RuntimeException("The voice model did not unpack.")
        File(dir, ".done").writeText("ok")
    }
}
