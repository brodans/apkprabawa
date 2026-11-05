import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── Regenerate Android mipmap icons dari icon Prabawa ──────────────────────
// `tauri android init` selalu membuat icon Tauri default. Kita generate ulang
// dari src-tauri/icons/icon.png (icon resmi Prabawa) dan salin ke gen/android.
// Gunakan tmpdir agar tidak ada masalah write permission pada src-tauri/icons/.

const iconSrc = join(process.cwd(), 'src-tauri', 'icons', 'icon.png');
const iconOut = join(tmpdir(), 'tauri-icons-' + randomBytes(4).toString('hex'));
const resDir = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

console.log('🎨 Generating Android icons dari icon Prabawa...');
mkdirSync(iconOut, { recursive: true });
execFileSync('npx', ['@tauri-apps/cli', 'icon', iconSrc, '-o', iconOut], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

// Salin mipmap-* ke gen/android res
const mipmaps = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
for (const mipmap of mipmaps) {
  const src = join(iconOut, 'android', mipmap);
  const dst = join(resDir, mipmap);
  try {
    cpSync(src, dst, { recursive: true });
    console.log(`  ✅ ${mipmap} disalin`);
  } catch {
    console.warn(`  ⚠️  ${mipmap} tidak ditemukan, skip`);
  }
}

// Salin mipmap-anydpi-v26 (adaptive icon XML)
const anydpiSrc = join(iconOut, 'android', 'mipmap-anydpi-v26');
const anydpiDst = join(resDir, 'mipmap-anydpi-v26');
try {
  cpSync(anydpiSrc, anydpiDst, { recursive: true });
  console.log('  ✅ mipmap-anydpi-v26 disalin');
} catch {
  console.warn('  ⚠️  mipmap-anydpi-v26 tidak ditemukan, skip');
}

// Salin background warna untuk adaptive icon
const bgXmlSrc = join(iconOut, 'android', 'values', 'ic_launcher_background.xml');
const bgXmlDst = join(resDir, 'values', 'ic_launcher_background.xml');
try {
  mkdirSync(dirname(bgXmlDst), { recursive: true });
  cpSync(bgXmlSrc, bgXmlDst);
  console.log('  ✅ ic_launcher_background.xml disalin');
} catch {
  console.warn('  ⚠️  ic_launcher_background.xml tidak ditemukan, skip');
}
console.log('🎨 Icon Prabawa berhasil diterapkan ke Android!\n');

const root = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main');
const put = (file: string, content: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
const splashIcon = join(root, 'res/drawable-nodpi/splash_icon.png');
mkdirSync(dirname(splashIcon), { recursive: true });
cpSync(join(iconOut, '128x128@2x.png'), splashIcon);
put(join(root, 'res/drawable/splash_screen.xml'), `<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/splash_background"/><item><bitmap android:gravity="center" android:src="@drawable/splash_icon" /></item></layer-list>
`);

const manifestPath = join(root, 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace(/android:theme="@style\/[^\"]+"/g, 'android:theme="@style/Theme.app"');
  if (!/android:theme=/.test(manifest)) {
    manifest = manifest.replace(/<application\b/, '<application android:theme="@style/Theme.app"');
  }

  // Tambahkan permissions latar belakang & notifikasi jika belum ada
  const permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
  ];
  for (const perm of permissions) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(/<application\b/, `<uses-permission android:name="${perm}" />\n    <application`);
    }
  }

  // Daftarkan Foreground Service di dalam <application> jika belum ada
  if (!manifest.includes('PrabawaForegroundService')) {
    const serviceTag = `
        <service
            android:name="id.go.jatim.prabawa.PrabawaForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Maintains user-enabled scheduled attendance automation while the app is in the background" />
        </service>

        <receiver
            android:name="id.go.jatim.prabawa.PrabawaBootReceiver"
            android:exported="true"
            android:directBootAware="true">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.ACTION_LOCKED_BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>`;
    manifest = manifest.replace(/<\/application>/, serviceTag);
  }

  writeFileSync(manifestPath, manifest);
}

const activity = join(root, 'java/id/go/jatim/prabawa/MainActivity.kt');
put(activity, `package id.go.jatim.prabawa

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.lang.ref.WeakReference
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import id.go.jatim.prabawa.TauriActivity

internal object AutomationWebView {
  @Volatile var instance: WeakReference<WebView>? = null

  fun requestCheck() {
    instance?.get()?.post {
      try {
        instance?.get()?.evaluateJavascript(
          "window.dispatchEvent(new Event('prabawa-background-tick'))",
          null
        )
      } catch (_: Exception) {}
    }
  }
}

class MainActivity : TauriActivity() {

  /** Dipanggil dari JS saat Prabawa mengganti tema (dark/light) dan kontrol background presensi. */
  inner class PrabawaBridge {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      mainHandler.post {
        appThemeIsDark = dark
        // JANGAN paksa AppCompatDelegate night mode — popup bawaan Android
        // (text selection, context menu dsb.) harus ikut tema bawaan device
        // masing-masing, bukan tema yang dipaksa lewat proses ini.
        applySystemBarTheme()
      }
    }

    @JavascriptInterface
    fun setOverlayMode(active: Boolean) {
      mainHandler.post {
        overlayDarkMode = active
        applySystemBarTheme()
      }
    }

    @JavascriptInterface
    fun startForegroundService(title: String?, content: String?) {
      mainHandler.post {
        try {
          val intent = android.content.Intent(this@MainActivity, PrabawaForegroundService::class.java).apply {
            action = PrabawaForegroundService.ACTION_START
            putExtra(PrabawaForegroundService.EXTRA_TITLE, title ?: "PRABAWA Presensi")
            putExtra(PrabawaForegroundService.EXTRA_CONTENT, content ?: "Penjadwal otomatisasi presensi aktif di latar belakang")
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
          } else {
            startService(intent)
          }
          getSharedPreferences("prabawa_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("penjadwal_aktif", true).apply()
          PrabawaKeepaliveWorker.enqueue(this@MainActivity)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        mainHandler.post {
          requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9913)
        }
      }
    }

    @JavascriptInterface
    fun stopForegroundService() {
      mainHandler.post {
        try {
          val intent = android.content.Intent(this@MainActivity, PrabawaForegroundService::class.java).apply {
            action = PrabawaForegroundService.ACTION_STOP
          }
          stopService(intent)
          getSharedPreferences("prabawa_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("penjadwal_aktif", false).apply()
          PrabawaKeepaliveWorker.cancel(this@MainActivity)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String): Boolean {
      mainHandler.post {
        try {
          PrabawaNotificationHelper.showNotification(this@MainActivity, title, message)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
      return true
    }

    @JavascriptInterface
    fun requestBatteryOptimizationExemption() {
      mainHandler.post {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
              val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:$packageName")
              }
              startActivity(intent)
            }
          }
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
      val pm = getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
      return pm?.isIgnoringBatteryOptimizations(packageName) == true
    }

    @JavascriptInterface
    fun syncSession(json: String) {
      try {
        getSharedPreferences("prabawa_session", android.content.Context.MODE_PRIVATE)
          .edit().putString("session_json", json).apply()
      } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun syncPresets(json: String) {
      try {
        getSharedPreferences("prabawa_presets", android.content.Context.MODE_PRIVATE)
          .edit().putString("presets_json", json).apply()
      } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun readWorkerLog(): String {
      return try {
        getSharedPreferences("prabawa_worker_log", android.content.Context.MODE_PRIVATE)
          .getString("log_json", "[]") ?: "[]"
      } catch (_: Exception) { "[]" }
    }

    @JavascriptInterface
    fun clearWorkerLog() {
      try {
        getSharedPreferences("prabawa_worker_log", android.content.Context.MODE_PRIVATE)
          .edit().putString("log_json", "[]").apply()
      } catch (_: Exception) {}
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var appThemeIsDark = false
  private var overlayDarkMode = false
  private var bridgeInjected = false
  private var checkAttempts = 0
  private val maxCheckAttempts = 30 // Coba selama 6 detik (30 x 200ms)
  private var cachedInsets: WindowInsetsCompat? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // True Edge-to-edge persis seperti Mesen.Ae-Capacitor:
    // Layout mengisi layar penuh secara seamless tanpa padding/scrim/kotak putih
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    window.decorView.setPadding(0, 0, 0, 0)

    // Matikan pemaksaan kontras bawaan Android (scrim abu/putih di status bar & nav bar)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // Terapkan tema awal dari setting sistem Android
    val systemIsDark = (resources.configuration.uiMode and
                        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    appThemeIsDark = systemIsDark
    applySystemBarTheme()

    // Tangkap insets dan teruskan ukuran status bar & nav bar ke CSS variables di WebView
    // persis seperti SystemBars di Mesen.Ae-Capacitor
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      cachedInsets = insets
      window.decorView.setPadding(0, 0, 0, 0)
      val wv = findWebView(window.decorView)
      if (wv != null) {
        sendInsetsToWeb(insets, wv)
      }
      insets
    }

    // Pasang listener agar WebView langsung tertangkap begitu ditambahkan ke view hierarchy
    window.decorView.viewTreeObserver.addOnGlobalLayoutListener(object : ViewTreeObserver.OnGlobalLayoutListener {
      override fun onGlobalLayout() {
        if (!bridgeInjected) {
          val wv = findWebView(window.decorView)
          if (wv != null) {
            injectBridge(wv)
          }
        }
      }
    })

    // Mulai polling fallback jika OnGlobalLayoutListener terlewati
    startBridgeInjectionLoop()
  }

  override fun onResume() {
    super.onResume()
    val wv = findWebView(window.decorView)
    if (wv != null) {
      if (!bridgeInjected) {
        injectBridge(wv)
      } else {
        syncThemeFromWeb(wv)
        val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
        if (insets != null) sendInsetsToWeb(insets, wv)
      }
    } else {
      startBridgeInjectionLoop()
    }
  }

  private fun startBridgeInjectionLoop() {
    if (bridgeInjected) return
    val wv = findWebView(window.decorView)
    if (wv != null) {
      injectBridge(wv)
      return
    }
    checkAttempts++
    if (checkAttempts < maxCheckAttempts) {
      mainHandler.postDelayed({ startBridgeInjectionLoop() }, 200)
    }
  }

  private fun injectBridge(wv: WebView) {
    if (bridgeInjected) return
    bridgeInjected = true

    AutomationWebView.instance = WeakReference(wv)
    wv.addJavascriptInterface(PrabawaBridge(), "AndroidPrabawa")

    // Pengaturan penting untuk Midtrans Snap di WebView Android:
    // 1. domStorageEnabled & databaseEnabled agar iframe Snap dapat menyimpan token & state
    // 2. third-party cookies diizinkan agar cookie sesi iframe Midtrans tidak diblokir
    // 3. javaScriptCanOpenWindowsAutomatically untuk popup pembayaran/3DS
    wv.settings.domStorageEnabled = true
    wv.settings.databaseEnabled = true
    wv.settings.javaScriptCanOpenWindowsAutomatically = true
    val cookieManager = android.webkit.CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)
    cookieManager.setAcceptThirdPartyCookies(wv, true)

    // Kirim insets awal dan sinkronkan tema dari web
    val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) sendInsetsToWeb(insets, wv)
    syncThemeFromWeb(wv)
  }

  private fun sendInsetsToWeb(insets: WindowInsetsCompat, targetWv: WebView? = null) {
    val wv = targetWv ?: findWebView(window.decorView) ?: return
    val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
    val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val density = resources.displayMetrics.density
    val topDp = (statusBars.top / density).toInt()
    val bottomDp = (navBars.bottom / density).toInt()
    val leftDp = (statusBars.left / density).toInt()
    val rightDp = (statusBars.right / density).toInt()

    val script = """
      (function() {
        try {
          var top = '\${topDp}px';
          var bot = '\${bottomDp}px';
          var left = '\${leftDp}px';
          var right = '\${rightDp}px';
          document.documentElement.style.setProperty('--sat', top);
          document.documentElement.style.setProperty('--sab', bot);
          document.documentElement.style.setProperty('--safe-area-inset-top', top);
          document.documentElement.style.setProperty('--safe-area-inset-bottom', bot);
          document.documentElement.style.setProperty('--safe-area-inset-left', left);
          document.documentElement.style.setProperty('--safe-area-inset-right', right);
          document.documentElement.style.setProperty('--poni-atas', top);
          document.documentElement.style.setProperty('--poni-bawah', bot);
          document.documentElement.style.setProperty('--poni-kiri', left);
          document.documentElement.style.setProperty('--poni-kanan', right);
          document.body.classList.add('is-native');
          document.documentElement.classList.add('is-native');
        } catch(e) {}
      })();
    """.trimIndent()
    wv.evaluateJavascript(script, null)
  }

  private fun syncThemeFromWeb(wv: WebView?) {
    if (wv == null) return
    val checkScript = """
      (function() {
        try {
          var isDark = document.documentElement.classList.contains('dark') ||
                       (document.body && document.body.dataset && document.body.dataset.theme === 'dark') ||
                       localStorage.getItem('theme') === 'dark';
          return isDark ? 'dark' : 'light';
        } catch(e) {
          return '';
        }
      })()
    """.trimIndent()

    wv.evaluateJavascript(checkScript) { result ->
      if (result?.contains("dark") == true) {
        appThemeIsDark = true
        applySystemBarTheme()
      } else if (result?.contains("light") == true) {
        appThemeIsDark = false
        applySystemBarTheme()
      }
    }
  }

  /** Cari WebView di view hierarchy secara rekursif. */
  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val wv = findWebView(window.decorView)
    if (wv != null) {
      syncThemeFromWeb(wv)
      val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
      if (insets != null) sendInsetsToWeb(insets, wv)
    } else {
      appThemeIsDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
      applySystemBarTheme()
    }
  }

  /**
   * Status bar selalu transparan; navigation bar transparan saat login dan
   * memakai warna shell saat workspace aktif.
   *
   * Light mode:
   *   isAppearanceLightStatusBars = true  → ikon jam/baterai HITAM
   *   isAppearanceLightNavigationBars = true → tombol navigasi HITAM
   *
   * Dark mode:
   *   isAppearanceLightStatusBars = false → ikon jam/baterai PUTIH
   *   isAppearanceLightNavigationBars = false → tombol navigasi PUTIH
   *
  * Warna ikon kedua bar tetap mengikuti tema aktif untuk light maupun dark mode.
   */
  private fun applySystemBarTheme() {
    runOnUiThread {
      val isDark = appThemeIsDark || overlayDarkMode
      val workspaceColor = if (isDark) Color.parseColor("#0B1120") else Color.parseColor("#F8FAFC")

      // Kedua system bar transparan; safe-area CSS menjaga konten di atasnya.
      window.statusBarColor = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setPadding(0, 0, 0, 0)

      // Fallback di bawah system bars sama persis dengan latar workspace.
      window.setBackgroundDrawable(ColorDrawable(workspaceColor))
      window.decorView.setBackgroundColor(workspaceColor)

      // Pastikan WebView tidak memakai background putih bawaan
      findWebView(window.decorView)?.setBackgroundColor(workspaceColor)

      // 3. Tanpa enforcement kontras bawaan Android (scrim putih/abu di status &
      //    navigation bar) → ikon selalu dihitung dari tema aktif.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isStatusBarContrastEnforced = false
        window.isNavigationBarContrastEnforced = false
      }

      // 4. Ikon status bar & navigation bar ikut tema (dipakai light & dark mode).
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
      controller.isAppearanceLightStatusBars = !isDark
      controller.isAppearanceLightNavigationBars = !isDark
    }
  }
}
`);

const fgService = join(root, 'java/id/go/jatim/prabawa/PrabawaForegroundService.kt');
put(fgService, `package id.go.jatim.prabawa

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class PrabawaForegroundService : Service() {

  companion object {
    const val CHANNEL_ID = "prabawa_automation_channel"
    const val NOTIFICATION_ID = 9912
    const val ACTION_START = "id.go.jatim.prabawa.START_FOREGROUND"
    const val ACTION_STOP = "id.go.jatim.prabawa.STOP_FOREGROUND"
    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_CONTENT = "extra_content"
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var notificationTitle = "PRABAWA Presensi"
  private var notificationContent = "Penjadwal presensi otomatis aktif di latar belakang"
  private val handler = Handler(Looper.getMainLooper())
  private val automationTick = object : Runnable {
    override fun run() {
      AutomationWebView.requestCheck()
      refreshOngoingNotification()
      handler.postDelayed(this, 30_000L)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    handler.postDelayed(automationTick, 30_000L)
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
      wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Prabawa:AutomationWakeLock")
      wakeLock?.acquire()
    } catch (_: Exception) {}
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      stopSelf()
      return START_NOT_STICKY
    }

    notificationTitle = intent?.getStringExtra(EXTRA_TITLE) ?: notificationTitle
    notificationContent = intent?.getStringExtra(EXTRA_CONTENT) ?: notificationContent

    startForeground(NOTIFICATION_ID, buildNotification())
    return START_STICKY
  }

  private fun buildNotification(): android.app.Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = if (launchIntent != null) {
      PendingIntent.getActivity(
        this, 0, launchIntent,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
      )
    } else null

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(notificationTitle)
      .setContentText(notificationContent)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(pendingIntent)
      .build()
    notification.flags = notification.flags or android.app.Notification.FLAG_NO_CLEAR
    return notification
  }

  private fun refreshOngoingNotification() {
    try {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      manager?.notify(NOTIFICATION_ID, buildNotification())
    } catch (_: SecurityException) {}
  }

  override fun onDestroy() {
    handler.removeCallbacks(automationTick)
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } catch (_: Exception) {}
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Layanan Presensi Latar Belakang",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Menjaga penjadwal presensi otomatis tetap berjalan di latar belakang"
        setShowBadge(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      nm?.createNotificationChannel(channel)
    }
  }
}
`);

const notifHelper = join(root, 'java/id/go/jatim/prabawa/PrabawaNotificationHelper.kt');
put(notifHelper, `package id.go.jatim.prabawa

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object PrabawaNotificationHelper {
  const val CHANNEL_ID = "prabawa_attendance_alerts"

  fun showNotification(context: Context, title: String, message: String) {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Notifikasi Presensi PRABAWA",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Status eksekusi presensi otomatis terjadwal"
        enableVibration(true)
      }
      nm.createNotificationChannel(channel)
    }

    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val pendingIntent = if (launchIntent != null) {
      PendingIntent.getActivity(
        context,
        (System.currentTimeMillis() % 10000).toInt(),
        launchIntent,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
      )
    } else null

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build()

    nm.notify((System.currentTimeMillis() % 100000).toInt(), notification)
  }
}
`);

put(join(root, 'res/values/colors.xml'), `<resources>
  <color name="splash_background">#F8FAFC</color>
  <color name="splash_icon_background">#F8FAFC</color>
</resources>\n`);

put(join(root, 'res/values-night/colors.xml'), `<resources>
  <color name="splash_background">#0B1120</color>
  <color name="splash_icon_background">#0B1120</color>
</resources>\n`);

// Popup bawaan Android (text selection, context menu, dll) harus memakai
// tema asli Material3 device masing-masing — tanpa override colorSurface /
// textColorHighlight supaya tidak gelap-gelap-an / tidak kebaca.
// Light theme — hanya splash & status bar, sisanya default Material3.
const themeXmlDay = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.app" parent="Theme.Material3.Light.NoActionBar">
    <item name="android:windowLightStatusBar">true</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">true</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
  <style name="Theme.prabawa" parent="Theme.app" />
</resources>\n`;

// Dark theme — sama, hanya splash & status bar, sisanya default Material3.
const themeXmlNight = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.app" parent="Theme.Material3.Dark.NoActionBar">
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">false</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
  <style name="Theme.prabawa" parent="Theme.app" />
</resources>\n`;

put(join(root, 'res/values/themes.xml'), themeXmlDay);
put(join(root, 'res/values-night/themes.xml'), themeXmlNight);

const gradle = join(process.cwd(), 'src-tauri/gen/android/app/build.gradle.kts');
const isiGradle = [
  'import java.util.Properties',
  'import org.jetbrains.kotlin.gradle.dsl.JvmTarget',
  '',
  'plugins {',
  '    id("com.android.application")',
  '    id("org.jetbrains.kotlin.android")',
  '    id("rust")',
  '}',
  '',
  'val tauriProperties = Properties().apply {',
  '    val propFile = file("tauri.properties")',
  '    if (propFile.exists()) {',
  '        propFile.inputStream().use { load(it) }',
  '    }',
  '}',
  '',
  'android {',
  '    compileSdk = 37',
  '    namespace = "id.go.jatim.prabawa"',
  '    defaultConfig {',
  '        manifestPlaceholders["usesCleartextTraffic"] = "false"',
  '        applicationId = "id.go.jatim.prabawa"',
  '        minSdk = 24',
  '        targetSdk = 37',
  '        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()',
  '        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")',
  '    }',
  '    signingConfigs {',
  '        create("release") {',
  '            storeFile = File(System.getenv("ANDROID_KEYSTORE_PATH") ?: "/tmp/prabawa-release.jks")',
  '            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""',
  '            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""',
  '            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""',
  '        }',
  '    }',
  '    buildTypes {',
  '        getByName("debug") {',
  '            manifestPlaceholders["usesCleartextTraffic"] = "true"',
  '            isDebuggable = true',
  '            isJniDebuggable = true',
  '            isMinifyEnabled = false',
  '            packaging {',
  '                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/x86/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")',
  '            }',
  '        }',
  '        getByName("release") {',
  '            isMinifyEnabled = true',
  '            signingConfig = signingConfigs.getByName("release")',
  '            optimization {',
  '               enable = true',
  '            }',
  '            proguardFiles(',
  '                *fileTree(".") {',
  '                  include("**/*.pro")',
  '                  exclude("build/**")',
  '                }.files.toTypedArray()',
  '            )',
  '        }',
  '    }',
  '    compileOptions {',
  '        sourceCompatibility = JavaVersion.VERSION_1_8',
  '        targetCompatibility = JavaVersion.VERSION_1_8',
  '    }',
  '    buildFeatures {',
  '        buildConfig = true',
  '    }',
  '}',
  '',
  'kotlin {',
  '    compilerOptions {',
  '        jvmTarget = JvmTarget.JVM_1_8',
  '    }',
  '}',
  '',
  'rust {',
  '    rootDirRel = "../../../"',
  '}',
  '',
  'dependencies {',
  '    implementation("androidx.core:core-ktx:1.12.0")',
  '    implementation("androidx.webkit:webkit:1.14.0")',
  '    implementation("androidx.appcompat:appcompat:1.7.1")',
  '    implementation("androidx.activity:activity-ktx:1.10.1")',
  '    implementation("com.google.android.material:material:1.12.0")',
  '    implementation("androidx.lifecycle:lifecycle-process:2.10.0")',
  '    implementation("androidx.work:work-runtime-ktx:2.9.0")',
  '    testImplementation("junit:junit:4.13.2")',
  '    androidTestImplementation("androidx.test.ext:junit:1.1.4")',
  '    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")',
  '}',
  '',
  'apply(from = file("tauri.build.gradle.kts"))',
].join('\n');
writeFileSync(gradle, isiGradle);

const bootReceiver = join(root, 'java/id/go/jatim/prabawa/PrabawaBootReceiver.kt');
put(bootReceiver, `package id.go.jatim.prabawa

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class PrabawaBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val act = intent.action ?: return
        if (act != Intent.ACTION_BOOT_COMPLETED
            && act != Intent.ACTION_MY_PACKAGE_REPLACED
            && act != "android.intent.action.ACTION_LOCKED_BOOT_COMPLETED") return

        val prefs = context.getSharedPreferences("prabawa_automasi", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("penjadwal_aktif", false)) return

        try {
            val serviceIntent = android.content.Intent(context, PrabawaForegroundService::class.java).apply {
                action = PrabawaForegroundService.ACTION_START
                putExtra(PrabawaForegroundService.EXTRA_TITLE, "PRABAWA Presensi Otomatis")
                putExtra(PrabawaForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.d("PrabawaBoot", "ForegroundService started after: \$act")
        } catch (e: Exception) {
            Log.e("PrabawaBoot", "Gagal: \${e.message}")
        }

        try {
            val req = PeriodicWorkRequestBuilder<PrabawaKeepaliveWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PrabawaKeepaliveWorker.WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
            )
        } catch (e: Exception) {
            Log.e("PrabawaBoot", "WorkManager gagal: \${e.message}")
        }
    }
}
`);

// ProGuard rules untuk WorkManager — wajib ada agar Room/WorkDatabase tidak
// di-strip oleh R8 saat isMinifyEnabled = true di release build.
const proguardPath = join(process.cwd(), 'src-tauri/gen/android/app/proguard-rules.pro');
const proguardRules = `
# WorkManager — keep Room database dan scheduler classes dari R8 stripping
-keep class androidx.work.** { *; }
-keep class androidx.work.impl.** { *; }
-keep class androidx.room.** { *; }
-keep class androidx.room.RoomDatabase { *; }
-keepclassmembers class * extends androidx.room.RoomDatabase { *; }
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keepnames class androidx.work.impl.WorkDatabase
-keepnames class androidx.work.impl.WorkDatabase_Impl
`;
// Append ke file yang sudah ada, atau buat baru jika belum ada
if (existsSync(proguardPath)) {
  const existing = readFileSync(proguardPath, 'utf8');
  if (!existing.includes('WorkManager')) {
    writeFileSync(proguardPath, existing + proguardRules);
    console.log('✅ ProGuard rules WorkManager ditambahkan ke proguard-rules.pro');
  }
} else {
  writeFileSync(proguardPath, proguardRules);
  console.log('✅ proguard-rules.pro dibuat dengan WorkManager rules');
}

// PrabawaKeepaliveWorker.kt — Worker biasa (bukan CoroutineWorker)
const keepaliveWorker = join(root, 'java/id/go/jatim/prabawa/PrabawaKeepaliveWorker.kt');
put(keepaliveWorker, `package id.go.jatim.prabawa

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

class PrabawaKeepaliveWorker(
    private val ctx: Context,
    params: WorkerParameters,
) : Worker(ctx, params) {

    companion object {
        const val WORK_NAME = "prabawa_keepalive"

        fun enqueue(context: Context) {
            try {
                val req = PeriodicWorkRequestBuilder<PrabawaKeepaliveWorker>(
                    15, TimeUnit.MINUTES
                ).build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req
                )
                Log.d("PrabawaWorker", "Keepalive enqueued")
            } catch (e: Exception) {
                Log.e("PrabawaWorker", "enqueue gagal: \${e.message}")
            }
        }

        fun cancel(context: Context) {
            try {
                WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
                Log.d("PrabawaWorker", "Keepalive cancelled")
            } catch (e: Exception) {
                Log.e("PrabawaWorker", "cancel gagal: \${e.message}")
            }
        }
    }

    override fun doWork(): Result {
        val automasi = ctx.getSharedPreferences("prabawa_automasi", Context.MODE_PRIVATE)
        if (!automasi.getBoolean("penjadwal_aktif", false)) return Result.success()

        // Pastikan ForegroundService tetap hidup
        restartForegroundService()

        // Eksekusi presensi dari Kotlin native
        try {
            eksekusiPreset()
        } catch (e: Exception) {
            Log.e("PrabawaWorker", "eksekusi error: \${e.message}")
        }

        return Result.success()
    }

    private fun restartForegroundService() {
        try {
            val intent = android.content.Intent(ctx, PrabawaForegroundService::class.java).apply {
                action = PrabawaForegroundService.ACTION_START
                putExtra(PrabawaForegroundService.EXTRA_TITLE, "PRABAWA Presensi Otomatis")
                putExtra(PrabawaForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        } catch (e: Exception) {
            Log.e("PrabawaWorker", "restart service gagal: \${e.message}")
        }
    }

    private fun eksekusiPreset() {
        // Baca session
        val sessionPrefs = ctx.getSharedPreferences("prabawa_session", Context.MODE_PRIVATE)
        val sessionJson = sessionPrefs.getString("session_json", null) ?: return
        val session = JSONObject(sessionJson)
        val apiKey = session.optString("apiKey").ifBlank { return }
        val imei = session.optString("imei")
        val baseLatLong = session.optString("lastLatLong")
        val baseUrl = session.optString("baseUrl").ifBlank { "https://presensi.bkd.jatimprov.go.id/service" }

        // Baca presets
        val presetsPrefs = ctx.getSharedPreferences("prabawa_presets", Context.MODE_PRIVATE)
        val presetsJson = presetsPrefs.getString("presets_json", null) ?: return
        val presets = JSONArray(presetsJson)

        val wib = TimeZone.getTimeZone("Asia/Jakarta")
        val now = Calendar.getInstance(wib)
        val hariIni = now.get(Calendar.DAY_OF_WEEK) - 1  // 0=Min..6=Sab
        val jamSekarang = String.format("%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE))
        val tanggal = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = wib }.format(now.time)

        for (i in 0 until presets.length()) {
            val preset = presets.getJSONObject(i)
            if (!preset.optBoolean("aktif", false)) continue

            // Cek hari aktif
            val hariAktif = preset.optJSONArray("hariAktif") ?: continue
            val hariList = (0 until hariAktif.length()).map { hariAktif.getInt(it) }
            if (hariIni !in hariList) continue

            // Cek rentang waktu
            if (!dalamRentangWaktu(preset.optString("jamMulai"), preset.optString("jamSelesai"), jamSekarang)) continue

            // Cek sudah dieksekusi hari ini
            if (sudahEksekusiHariIni(preset.optString("id"), tanggal)) continue

            // Pilih lokasi acak
            val lokasiArr = preset.optJSONArray("lokasi") ?: continue
            if (lokasiArr.length() == 0) continue
            val lokasi = lokasiArr.getJSONObject((Math.random() * lokasiArr.length()).toInt())
            val lat = lokasi.optDouble("latitude", 0.0)
            val lng = lokasi.optDouble("longitude", 0.0)
            val latLong = if (lat != 0.0 && lng != 0.0) "\${lat},\${lng}" else baseLatLong

            // Tentukan checktype dari tipe preset
            val checktype = when (preset.optString("tipe")) {
                "datang" -> 1
                "pulang" -> 2
                else -> 5
            }

            // Eksekusi absen via HTTP
            val (berhasil, pesan) = kirimAbsen(
                baseUrl = baseUrl,
                apiKey = apiKey,
                imei = imei,
                lastLatLong = latLong,
                checktype = checktype,
                workCode = preset.optString("workcodeId"),
            )

            // Simpan log
            tulisLog(
                presetId = preset.optString("id"),
                presetNama = preset.optString("nama"),
                tanggal = tanggal,
                berhasil = berhasil,
                pesan = pesan,
            )

            // Kirim notifikasi
            val notifTitle = if (berhasil) "✅ Presensi Berhasil" else "⚠️ Presensi Gagal"
            PrabawaNotificationHelper.showNotification(ctx, notifTitle, "\${preset.optString("nama")} — \$pesan")

            Log.d("PrabawaWorker", "Preset '\${preset.optString("nama")}': berhasil=\$berhasil, pesan=\$pesan")
        }
    }

    private fun kirimAbsen(
        baseUrl: String,
        apiKey: String,
        imei: String,
        lastLatLong: String,
        checktype: Int,
        workCode: String,
    ): Pair<Boolean, String> {
        return try {
            val body = JSONObject().apply {
                put("jsonrpc", 2)
                put("method", "POST")
                put("version", 89)
                put("object", "absen")
                put("param", JSONObject().apply {
                    put("checktype", checktype)
                    put("work_code", workCode)
                    put("iswfh", 0)
                    put("ijin", 0)
                    put("keterangan", "")
                    put("type_ijin", 0)
                    put("mock", 0)
                    put("api_key", apiKey)
                    put("last_latlong", lastLatLong)
                    put("imei", imei)
                })
            }.toString()

            val url = URL(baseUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000

            OutputStreamWriter(conn.outputStream).use { it.write(body) }

            val responseCode = conn.responseCode
            val responseBody = try {
                conn.inputStream.bufferedReader().readText()
            } catch (_: Exception) {
                conn.errorStream?.bufferedReader()?.readText() ?: ""
            }
            conn.disconnect()

            if (responseCode != 200) {
                return Pair(false, "HTTP \$responseCode")
            }

            val resp = JSONObject(responseBody)
            val result = resp.optJSONObject("result")
            if (result != null) {
                val absen = result.optBoolean("absen", false)
                val message = result.optString("message", "")
                Pair(absen, message.ifBlank { if (absen) "Berhasil" else "Ditolak server" })
            } else {
                val error = resp.optString("error", "")
                Pair(false, error.ifBlank { "Respons tidak valid" })
            }
        } catch (e: Exception) {
            Pair(false, e.message ?: "Koneksi gagal")
        }
    }

    private fun dalamRentangWaktu(mulai: String, selesai: String, sekarang: String): Boolean {
        fun toMenit(hhmm: String): Int {
            val parts = hhmm.split(":")
            if (parts.size < 2) return -1
            val h = parts[0].toIntOrNull() ?: return -1
            val m = parts[1].toIntOrNull() ?: return -1
            return h * 60 + m
        }
        val m = toMenit(mulai); val s = toMenit(selesai); val n = toMenit(sekarang)
        if (m < 0 || s < 0 || n < 0) return false
        return if (m <= s) n in m..s else n >= m || n <= s
    }

    private fun sudahEksekusiHariIni(presetId: String, tanggal: String): Boolean {
        val logPrefs = ctx.getSharedPreferences("prabawa_worker_log", Context.MODE_PRIVATE)
        val raw = logPrefs.getString("log_json", "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val e = arr.getJSONObject(i)
                if (e.optString("presetId") == presetId &&
                    e.optString("tanggal") == tanggal &&
                    e.optBoolean("berhasil", false)) return true
            }
            false
        } catch (_: Exception) { false }
    }

    private fun tulisLog(presetId: String, presetNama: String, tanggal: String, berhasil: Boolean, pesan: String) {
        val logPrefs = ctx.getSharedPreferences("prabawa_worker_log", Context.MODE_PRIVATE)
        val raw = logPrefs.getString("log_json", "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        // Hapus log lama untuk preset+tanggal yang sama
        val baru = JSONArray()
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            if (e.optString("presetId") == presetId && e.optString("tanggal") == tanggal) continue
            baru.put(e)
        }
        baru.put(JSONObject().apply {
            put("presetId", presetId)
            put("presetNama", presetNama)
            put("tanggal", tanggal)
            put("eksekusiPada", System.currentTimeMillis())
            put("berhasil", berhasil)
            put("pesan", pesan)
        })
        logPrefs.edit().putString("log_json", baru.toString()).apply()
    }
}
`);
console.log('✅ PrabawaKeepaliveWorker.kt ditulis');
