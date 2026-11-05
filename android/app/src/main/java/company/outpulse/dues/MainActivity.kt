package company.outpulse.dues

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
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
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat

/**
 * Dues for Android: a native shell around the live Dues web app, so the design is the web app's own and updates need no new APK.
 * Native parts: links to WhatsApp, UPI apps, the dialer and email open in those apps; the file picker for CSV import;
 * the back button closes sheets first; an offline screen; the status and navigation bars follow the app's light/dark theme.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var offline: LinearLayout
    private lateinit var host: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var failed = false
    private var lastBg = 0
    private val handler = Handler(Looper.getMainLooper())

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        host = Uri.parse(BuildConfig.START_URL).host ?: ""

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
            userAgentString = "$userAgentString DuesApp/1.0"
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.webViewClient = object : WebViewClient() {
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
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        @Suppress("DEPRECATION")
        if (cm.activeNetworkInfo?.isConnected != true) {
            offline.visibility = View.VISIBLE
            offline.bringToFront()
            return
        }
        web.loadUrl(BuildConfig.START_URL)
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
    }
}
