package company.outpulse.dues

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceResponse
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Dues for Android. The Dues web app (public/) is built into the APK and served from a private https address
 * (WebViewAssetLoader), so it works offline and needs no website; invoices are saved on the phone, encrypted with your PIN.
 * Native parts: WhatsApp, UPI apps, the dialer and email open in those apps; the file picker (CSV import, restore);
 * saving backups and CSV exports through Android's save dialog; the back button closes sheets first;
 * the status and navigation bars follow the app's light/dark theme.
 * Security: screenshots and the recent-apps preview are blocked (FLAG_SECURE); fingerprint unlock keeps the vault's data key
 * encrypted by a key in the Android Keystore that only opens after a successful fingerprint (BiometricPrompt + CryptoObject).
 */
class MainActivity : FragmentActivity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var offline: LinearLayout
    private lateinit var host: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var failed = false
    private var lastBg = 0
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var assets: WebViewAssetLoader
    private var pendingSave: String? = null

    private val savePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = pendingSave
        pendingSave = null
        val uri = result.data?.data
        var ok = false
        if (result.resultCode == RESULT_OK && uri != null && text != null) {
            ok = try {
                contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                true
            } catch (e: Exception) { false }
        }
        if (result.resultCode == RESULT_OK) web.evaluateJavascript("window.duesSaved && window.duesSaved($ok)", null)
    }

    /** Called from the page: Android asks where to save the backup or CSV. */
    inner class Bridge {
        @JavascriptInterface
        fun save(name: String, mime: String, text: String) {
            runOnUiThread {
                pendingSave = text
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name)
                try { savePicker.launch(i) } catch (e: ActivityNotFoundException) { Toast.makeText(this@MainActivity, "Can't save files on this phone", Toast.LENGTH_SHORT).show() }
            }
        }

        /** True when the phone has a strong fingerprint/face sensor with something enrolled (Android 9+). */
        @JavascriptInterface
        fun bioAvailable(): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                BiometricManager.from(this@MainActivity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

        /** Turn fingerprint unlock on: after a fingerprint, the vault's data key is encrypted with the Keystore key and kept. */
        @JavascriptInterface
        fun bioEnroll(keyB64: String) { runOnUiThread { bioRun(enroll = true, plain = keyB64) } }

        /** Fingerprint unlock: after a fingerprint, hand the data key back to the page. */
        @JavascriptInterface
        fun bioUnlock() { runOnUiThread { bioRun(enroll = false, plain = null) } }

        @JavascriptInterface
        fun bioClear() { bioForget() }
    }

    /* ───── fingerprint ───── */
    private val bioPrefs by lazy { getSharedPreferences("dues_bio", MODE_PRIVATE) }

    private fun bioKey(create: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(BIO_ALIAS, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val spec = KeyGenParameterSpec.Builder(BIO_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                else @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(-1)
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    private fun bioForget() {
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(BIO_ALIAS) } catch (e: Exception) { }
        bioPrefs.edit().clear().apply()
    }

    private fun bioReply(ok: Boolean, key: String? = null, error: String? = null) {
        val o = JSONObject().put("ok", ok)
        if (key != null) o.put("key", key)
        if (error != null) o.put("error", error)
        web.evaluateJavascript("window.duesBio && window.duesBio(" + JSONObject.quote(o.toString()) + ")", null)
    }

    private fun bioRun(enroll: Boolean, plain: String?) {
        val cipher: Cipher
        try {
            cipher = Cipher.getInstance("AES/GCM/NoPadding")
            if (enroll) {
                bioForget()
                cipher.init(Cipher.ENCRYPT_MODE, bioKey(create = true))
            } else {
                val iv = bioPrefs.getString("iv", null)
                val key = bioKey(create = false)
                if (iv == null || key == null) return bioReply(false, error = "Fingerprint unlock is off. Use your PIN.")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            bioForget()
            return bioReply(false, error = "Your fingerprints changed. Use your PIN, then turn fingerprint unlock on again in Settings.")
        } catch (e: Exception) {
            return bioReply(false, error = "Fingerprint is not available right now. Use your PIN.")
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(if (enroll) "Turn on fingerprint unlock" else "Unlock Dues")
            .setSubtitle(if (enroll) "Confirm it's you" else "Use your fingerprint")
            .setNegativeButtonText("Use PIN")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val c = result.cryptoObject?.cipher ?: return bioReply(false, error = "Fingerprint failed. Use your PIN.")
                try {
                    if (enroll) {
                        val ct = c.doFinal(Base64.decode(plain, Base64.NO_WRAP))
                        bioPrefs.edit().putString("iv", Base64.encodeToString(c.iv, Base64.NO_WRAP)).putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP)).apply()
                        bioReply(true)
                    } else {
                        val raw = c.doFinal(Base64.decode(bioPrefs.getString("ct", ""), Base64.NO_WRAP))
                        bioReply(true, key = Base64.encodeToString(raw, Base64.NO_WRAP))
                        java.util.Arrays.fill(raw, 0)
                    }
                } catch (e: Exception) {
                    if (enroll) bioForget()
                    bioReply(false, error = "Fingerprint failed. Use your PIN.")
                }
            }
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED
                if (enroll) bioForget()
                bioReply(false, error = if (cancelled) null else msg.toString())
            }
        })
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // no screenshots, screen recording or recent-apps preview of invoices and the PIN pad
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        host = Uri.parse(BuildConfig.START_URL).host ?: ""
        assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()

        web = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(BG_LIGHT)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        offline = buildOfflineView()
        root = FrameLayout(this).apply { addView(web); addView(offline) }
        setContentView(root)
        paint(BG_LIGHT)

        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString DuesApp/2.0"
            setSupportZoom(false)
            builtInZoomControls = false
        }
        // only the built-in Dues pages ever run in this WebView (every other link opens outside), so the bridge is safe to expose
        web.addJavascriptInterface(Bridge(), "DuesAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val s = u.scheme ?: ""
                if (s == "about" || s == "blob" || s == "data") return false
                if (s == "https" && u.host == host) return false
                // WhatsApp, UPI apps, tel:, mailto: and every other site open outside the app
                return openOutside(u)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    failed = true
                    offline.visibility = View.VISIBLE
                    offline.bringToFront()
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!failed) offline.visibility = View.GONE
                CookieManager.getInstance().flush()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (offline.visibility == View.VISIBLE) { finish(); return }
                // close an open sheet first (the web app's sheets close on Escape)
                web.evaluateJavascript("(function(){var s=document.getElementById('sheet');if(s){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return 1}return 0})()") { r ->
                    if (r == "1") return@evaluateJavascript
                    if (web.canGoBack()) web.goBack() else finish()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load()
    }

    private fun openOutside(u: Uri): Boolean {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            val msg = when (u.scheme) {
                "upi" -> "No UPI app found on this phone"
                "tel" -> "No phone app found"
                "mailto" -> "No email app found"
                else -> "No app can open this link"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }
        return true
    }

    private fun load() {
        failed = false
        offline.visibility = View.GONE
        web.loadUrl(BuildConfig.START_URL)   // built into the app: no internet needed
    }

    private fun buildOfflineView(): LinearLayout {
        val pad = (24 * resources.displayMetrics.density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(BG_LIGHT)
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            addView(TextView(context).apply {
                text = getString(R.string.offline_title)
                textSize = 26f
                setTextColor(Color.parseColor("#0D0D0D"))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = getString(R.string.offline_text)
                textSize = 16f
                setTextColor(Color.parseColor("#626262"))
                gravity = Gravity.CENTER
                setPadding(0, pad / 2, 0, pad)
            })
            addView(Button(context).apply {
                text = getString(R.string.retry)
                isAllCaps = false
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#0F3B1F"))
                setOnClickListener { load() }
            })
        }
    }

    /** Colours the status and navigation bars to match the page (light #e9e9e9, dark #0a0d0a). */
    private fun paint(bg: Int) {
        if (bg == lastBg) return
        lastBg = bg
        root.setBackgroundColor(bg)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val light = (0.299 * Color.red(bg) + 0.587 * Color.green(bg) + 0.114 * Color.blue(bg)) > 150
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = light
        c.isAppearanceLightNavigationBars = light
    }

    private val poll = object : Runnable {
        override fun run() {
            if (offline.visibility != View.VISIBLE) {
                web.evaluateJavascript("(function(){try{return getComputedStyle(document.body).backgroundColor}catch(e){return ''}})()") { raw -> parse(raw)?.let { paint(it) } }
            }
            handler.postDelayed(this, 700)
        }
    }

    private fun parse(raw: String?): Int? {
        val v = raw?.trim()?.trim('"')?.trim() ?: return null
        val m = Regex("""rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)""").find(v) ?: return null
        val (r, g, b) = m.destructured
        return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        handler.post(poll)
    }

    override fun onPause() {
        handler.removeCallbacks(poll)
        CookieManager.getInstance().flush()
        web.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private val BG_LIGHT = Color.parseColor("#E9E9E9")
        private const val BIO_ALIAS = "dues_bio_v1"
    }
}
