package com.glide.app

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.IOException

/**
 * Glide's own storage. Both Activities are exported, so any app can hand Glide a
 * `file://` URI, and one pointing in here would be opened with Glide's permissions and
 * then flow into history, Recents and Share. No sender has a legitimate reason to.
 */
object PrivatePath {

    fun isPrivate(context: Context, uri: Uri?): Boolean {
        if (uri?.scheme?.lowercase() != "file") return false
        val path = uri.path ?: return false
        return isInside(path, listOf(context.dataDir, context.createDeviceProtectedStorageContext().dataDir))
    }

    /** Canonical, so `..` and symlinks such as /proc/self/root or /data/data cannot dodge it. */
    fun isInside(path: String, roots: List<File>): Boolean {
        val target = try { File(path).canonicalPath } catch (e: IOException) { return true }
        return roots.any { root ->
            val dir = root.canonicalPath
            target == dir || target.startsWith(dir + File.separator)
        }
    }
}
