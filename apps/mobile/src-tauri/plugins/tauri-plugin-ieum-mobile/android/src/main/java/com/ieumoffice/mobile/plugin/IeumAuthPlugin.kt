package com.ieumoffice.mobile.plugin

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class LaunchAuthArgs {
    var authUrl: String = ""
    var callbackScheme: String = "ieumoffice"
}

@InvokeArg
class SealArgs {
    var plaintextBase64: String = ""
}

@InvokeArg
class UnsealArgs {
    var ciphertextBase64: String = ""
}

/**
 * Android Keystore AES-256-GCM sealing and Chrome Custom Tabs OAuth browser launcher.
 */
@TauriPlugin
class IeumAuthPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "com.ieumoffice.mobile.vault.master"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val IV_BYTES = 12
        private const val PREFS_NAME = "com.ieumoffice.mobile.vault"
        private const val PREF_WRAPPED_MASTER = "wrapped_master_v1"
    }

    @Command
    fun getOrCreateMasterKey(invoke: Invoke) {
        try {
            val prefs = activity.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existing = prefs.getString(PREF_WRAPPED_MASTER, null)
            val masterBytes: ByteArray = if (existing != null) {
                unsealRaw(Base64.decode(existing, Base64.DEFAULT))
            } else {
                val fresh = ByteArray(32).also { SecureRandom().nextBytes(it) }
                val wrapped = sealRaw(fresh)
                prefs.edit().putString(PREF_WRAPPED_MASTER, Base64.encodeToString(wrapped, Base64.NO_WRAP)).apply()
                fresh
            }
            invoke.resolve(JSObject().apply {
                put("keyBase64", Base64.encodeToString(masterBytes, Base64.NO_WRAP))
            })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    @Command
    fun launchAuthBrowser(invoke: Invoke) {
        val args = invoke.parseArgs(LaunchAuthArgs::class.java)
        val uri = Uri.parse(args.authUrl)
        if (uri.scheme != "https") {
            invoke.reject("INVALID_ARGUMENT: auth URL must use https")
            return
        }
        try {
            val customTabs = CustomTabsIntent.Builder().build()
            customTabs.launchUrl(activity, uri)
            invoke.resolve(JSObject().apply { put("ok", true) })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    @Command
    fun sealSecret(invoke: Invoke) {
        val args = invoke.parseArgs(SealArgs::class.java)
        try {
            val plaintext = Base64.decode(args.plaintextBase64, Base64.DEFAULT)
            val combined = sealRaw(plaintext)
            invoke.resolve(JSObject().apply {
                put("ciphertextBase64", Base64.encodeToString(combined, Base64.NO_WRAP))
            })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    @Command
    fun unsealSecret(invoke: Invoke) {
        val args = invoke.parseArgs(UnsealArgs::class.java)
        try {
            val combined = Base64.decode(args.ciphertextBase64, Base64.DEFAULT)
            val plaintext = unsealRaw(combined)
            invoke.resolve(JSObject().apply {
                put("plaintextBase64", Base64.encodeToString(plaintext, Base64.NO_WRAP))
            })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    private fun sealRaw(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plaintext)
        val combined = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encrypted, 0, combined, iv.size, encrypted.size)
        return combined
    }

    private fun unsealRaw(combined: ByteArray): ByteArray {
        if (combined.size <= IV_BYTES) {
            throw IllegalArgumentException("malformed ciphertext")
        }
        val iv = combined.copyOfRange(0, IV_BYTES)
        val payload = combined.copyOfRange(IV_BYTES, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(payload)
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGen.init(spec)
        return keyGen.generateKey()
    }
}
