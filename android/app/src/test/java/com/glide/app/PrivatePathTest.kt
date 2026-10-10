package com.glide.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.file.Files

class PrivatePathTest {

    @get:Rule val tmp = TemporaryFolder()

    private val data by lazy { tmp.newFolder("data", "com.glide.app") }
    private val shared by lazy { tmp.newFolder("storage") }

    @Test fun insideIsPrivate() {
        assertTrue(PrivatePath.isInside(File(data, "shared_prefs/x.xml").path, listOf(data)))
        assertTrue(PrivatePath.isInside(data.path, listOf(data)))
    }

    @Test fun dotDotCannotEscapeIntoIt() {
        assertTrue(PrivatePath.isInside("${shared.path}/../data/com.glide.app/db", listOf(data)))
    }

    @Test fun siblingWithSamePrefixIsNot() {
        val sibling = tmp.newFolder("data", "com.glide.app.evil")
        assertFalse(PrivatePath.isInside(File(sibling, "a.mp4").path, listOf(data)))
        assertFalse(PrivatePath.isInside(File(shared, "a.mp4").path, listOf(data)))
    }

    @Test fun symlinkIntoItIsPrivate() {
        val link = File(shared, "link").toPath()
        try {
            Files.createSymbolicLink(link, data.toPath())
        } catch (e: Exception) {
            assumeTrue("symlinks unavailable here", false)
        }
        assertTrue(PrivatePath.isInside("$link/files/x", listOf(data)))
    }
}
