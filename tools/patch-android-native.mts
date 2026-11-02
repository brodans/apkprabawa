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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH: AndroidManifest — permissions lengkap + ForegroundService + BootReceiver
// ─────────────────────────────────────────────────────────────────────────────
const manifestPath = join(root, 'AndroidManifest.xml');
if (!existsSync(manifestPath)) {
  throw new Error(`Generated Android manifest not found: ${manifestPath}`);
}
console.log('\n🔐 Menambahkan permissions ke AndroidManifest…');

let manifest = readFileSync(manifestPath, 'utf8');

// Set tema
manifest = manifest.replace(/android:theme="@style\/[^"]+"/g, 'android:theme="@style/Theme.app"');
if (!/android:theme=/.test(manifest)) {
  manifest = manifest.replace(/<application\b/, '<application android:theme="@style/Theme.app"');
}

// Tambahkan permissions jika belum ada
const requiredPermissions = [
  '<uses-permission android:name="android.permission.INTERNET"/>',
  '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>',
  '<uses-permission android:name="android.permission.WAKE_LOCK"/>',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>',
  '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>',
  '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>',
];

const manifestOpenTag = manifest.match(/<manifest[^>]*>/)?.[0];
if (manifestOpenTag) {
  const toAdd = requiredPermissions
    .filter(p => !manifest.includes(p.match(/android:name="([^"]+)"/)?.[1] ?? '__never__'))
    .join('\n    ');
  if (toAdd) {
    manifest = manifest.replace(manifestOpenTag, `${manifestOpenTag}\n    ${toAdd}`);
  }
}

// Daftarkan ForegroundService + BootReceiver di <application>
const serviceReceiverBlock = `
        <service
            android:name="id.go.jatim.prabawa.PrabawaForegroundService"
            android:foregroundServiceType="specialUse"
            android:enabled="true"
            android:exported="false">
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
        </receiver>`;

if (!manifest.includes('PrabawaForegroundService')) {
  manifest = manifest.replace('</application>', `${serviceReceiverBlock}\n    </application>`);
}

writeFileSync(manifestPath, manifest);
console.log('  ✅ Permissions, ForegroundService & BootReceiver ditambahkan ke AndroidManifest');

// ─────────────────────────────────────────────────────────────────────────────
// build.gradle.kts — tambah WorkManager dependency
// ─────────────────────────────────────────────────────────────────────────────
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
  '    // WorkManager — jaminan eksekusi periodik meski app di-clear dari recents',
  '    implementation("androidx.work:work-runtime-ktx:2.9.0")',
  '    testImplementation("junit:junit:4.13.2")',
  '    androidTestImplementation("androidx.test.ext:junit:1.1.4")',
  '    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")',
  '}',
  '',
  'apply(from = file("tauri.build.gradle.kts"))',
].join('\n');
writeFileSync(gradle, isiGradle);
console.log('✅ build.gradle.kts diperbarui (+ WorkManager dependency)');

// ─────────────────────────────────────────────────────────────────────────────
// MainActivity.kt — PrabawaBridge (tema) + PrabawaAutomasiBridge (automasi)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🤖 Menulis MainActivity.kt dengan PrabawaAutomasiBridge…');

const activity = join(root, 'java/id/go/jatim/prabawa/MainActivity.kt');
put(activity, `package id.go.jatim.prabawa

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import id.go.jatim.prabawa.TauriActivity

internal object AutomationWebView {
  @Volatile var instance: java.lang.ref.WeakReference<WebView>? = null

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

  // ── Bridge tema (dark/light mode & overlay) ────────────────────────────────
  inner class PrabawaBridge {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      runOnUiThread { appThemeIsDark = dark; applySystemBarTheme() }
    }

    @JavascriptInterface
    fun setOverlayMode(active: Boolean) {
      runOnUiThread { overlayDarkMode = active; applySystemBarTheme() }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
      requestNotificationPermissionIfNeeded()
    }
  }

  // ── Bridge automasi presensi terjadwal ─────────────────────────────────────
  inner class PrabawaAutomasiBridge {

    @JavascriptInterface
    fun startForegroundService(title: String, content: String) {
      val intent = Intent(this@MainActivity, PrabawaForegroundService::class.java).apply {
        action = PrabawaForegroundService.ACTION_START
        putExtra(PrabawaForegroundService.EXTRA_TITLE, title)
        putExtra(PrabawaForegroundService.EXTRA_CONTENT, content)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
        else startService(intent)
        // Simpan state ke SharedPreferences agar BootReceiver & WorkManager tahu
        getSharedPreferences("prabawa_automasi", android.content.Context.MODE_PRIVATE).edit().apply {
          putBoolean("penjadwal_aktif", true)
          apply()
        }
        // Enqueue WorkManager sebagai lapisan ketahanan tambahan
        PrabawaKeepaliveWorker.enqueue(this@MainActivity)
      } catch (e: Exception) {
        Log.e("PrabawaAutomasi", "startForegroundService error: \${e.message}")
      }
    }

    @JavascriptInterface
    fun stopForegroundService() {
      try {
        val intent = Intent(this@MainActivity, PrabawaForegroundService::class.java).apply {
          action = PrabawaForegroundService.ACTION_STOP
        }
        startService(intent)
        getSharedPreferences("prabawa_automasi", android.content.Context.MODE_PRIVATE).edit().apply {
          putBoolean("penjadwal_aktif", false)
          apply()
        }
        PrabawaKeepaliveWorker.cancel(this@MainActivity)
      } catch (e: Exception) {
        Log.e("PrabawaAutomasi", "stopForegroundService error: \${e.message}")
      }
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String): Boolean {
      return try {
        PrabawaNotificationHelper.showNotification(this@MainActivity, title, message)
        true
      } catch (e: Exception) {
        Log.e("PrabawaAutomasi", "showNotification error: \${e.message}")
        false
      }
    }

    @JavascriptInterface
    fun requestBatteryOptimizationExemption() {
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = android.net.Uri.parse("package:\${packageName}")
        }
        startActivity(intent)
      } catch (e: Exception) {
        Log.e("PrabawaAutomasi", "requestBatteryOptimizationExemption error: \${e.message}")
      }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean = try {
      val pm = getSystemService(POWER_SERVICE) as? PowerManager
      pm?.isIgnoringBatteryOptimizations(packageName) ?: true
    } catch (_: Exception) { true }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var appThemeIsDark = false
  private var overlayDarkMode = false
  private var bridgeInjected = false
  private var checkAttempts = 0
  private val maxCheckAttempts = 30 // Coba selama 6 detik (30 x 200ms)
  private var cachedInsets: WindowInsetsCompat? = null
  private var insetSyncAttempts = 0
  private var pendingInsetsSync: Runnable? = null

  // Launcher untuk request POST_NOTIFICATIONS (Android 13+)
  private val notifPermLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { granted ->
    Log.d("Prabawa", "POST_NOTIFICATIONS granted: \$granted")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // True Edge-to-edge persis seperti Mesen.Ae-Capacitor:
    // Layout mengisi layar penuh secara seamless tanpa padding/scrim/kotak putih
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    window.decorView.setPadding(0, 0, 0, 0)

    // Matikan pemaksaan kontras bawaan Android
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // Terapkan tema awal dari setting sistem Android
    val systemIsDark = (resources.configuration.uiMode and
                        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    appThemeIsDark = systemIsDark
    applySystemBarTheme()

    // Tangkap insets dan teruskan ke CSS variables di WebView
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      cachedInsets = insets
      window.decorView.setPadding(0, 0, 0, 0)
      findWebView(window.decorView)?.let { sendInsetsToWeb(insets, it) }
      insets
    }
    ViewCompat.requestApplyInsets(window.decorView)

    // Pasang listener agar WebView langsung tertangkap begitu ditambahkan ke view hierarchy
    window.decorView.viewTreeObserver.addOnGlobalLayoutListener(
      object : ViewTreeObserver.OnGlobalLayoutListener {
        override fun onGlobalLayout() {
          if (!bridgeInjected) findWebView(window.decorView)?.let { injectBridge(it) }
        }
      })

    startBridgeInjectionLoop()

    // Minta izin notifikasi di Android 13+
    requestNotificationPermissionIfNeeded()
  }

  override fun onResume() {
    super.onResume()
    val wv = findWebView(window.decorView)
    if (wv != null) {
      if (!bridgeInjected) injectBridge(wv)
      else {
        syncThemeFromWeb(wv)
        val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
        if (insets != null) sendInsetsToWeb(insets, wv)
      }
    } else {
      startBridgeInjectionLoop()
    }
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }

  private fun startBridgeInjectionLoop() {
    if (bridgeInjected) return
    val wv = findWebView(window.decorView)
    if (wv != null) { injectBridge(wv); return }
    checkAttempts++
    if (checkAttempts < maxCheckAttempts) mainHandler.postDelayed({ startBridgeInjectionLoop() }, 200)
  }

  private fun injectBridge(wv: WebView) {
    if (bridgeInjected) return
    bridgeInjected = true

    AutomationWebView.instance = java.lang.ref.WeakReference(wv)
    wv.addJavascriptInterface(PrabawaBridge(), "AndroidPrabawa")
    wv.addJavascriptInterface(PrabawaAutomasiBridge(), "AndroidPrabawaAutomasi")

    // Pengaturan penting untuk Midtrans Snap di WebView Android
    wv.settings.domStorageEnabled = true
    wv.settings.databaseEnabled = true
    wv.settings.javaScriptCanOpenWindowsAutomatically = true
    val cookieManager = android.webkit.CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)
    cookieManager.setAcceptThirdPartyCookies(wv, true)

    val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) sendInsetsToWeb(insets, wv)
    syncThemeFromWeb(wv)
  }

  private fun sendInsetsToWeb(insets: WindowInsetsCompat, targetWv: WebView? = null) {
    val wv = targetWv ?: findWebView(window.decorView) ?: return
    val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
    val navBars    = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val density    = resources.displayMetrics.density
    val topDp    = (statusBars.top    / density).toInt()
    val bottomDp = (navBars.bottom   / density).toInt()
    val leftDp   = (statusBars.left  / density).toInt()
    val rightDp  = (statusBars.right / density).toInt()

    val script = """
      (function() {
        try {
          if (document.readyState !== 'complete' || !document.body || !document.getElementById('root')) return false;
          var top   = '\${topDp}px';   var bot   = '\${bottomDp}px';
          var left  = '\${leftDp}px';  var right = '\${rightDp}px';
          document.documentElement.style.setProperty('--sat',  top);
          document.documentElement.style.setProperty('--sab',  bot);
          document.documentElement.style.setProperty('--safe-area-inset-top',    top);
          document.documentElement.style.setProperty('--safe-area-inset-bottom', bot);
          document.documentElement.style.setProperty('--safe-area-inset-left',   left);
          document.documentElement.style.setProperty('--safe-area-inset-right',  right);
          document.documentElement.style.setProperty('--poni-atas',   top);
          document.documentElement.style.setProperty('--poni-bawah',  bot);
          document.documentElement.style.setProperty('--poni-kiri',   left);
          document.documentElement.style.setProperty('--poni-kanan',  right);
          document.body.classList.add('is-native');
          document.documentElement.classList.add('is-native');
          window.__PRABAWA_SAFE_AREA_READY__ = true;
          window.dispatchEvent(new Event('prabawa-safe-area-ready'));
          return true;
        } catch(e) {}
        return false;
      })();
    """.trimIndent()
    wv.evaluateJavascript(script) { result ->
      if (result == "true") {
        insetSyncAttempts = 0
        pendingInsetsSync?.let { mainHandler.removeCallbacks(it) }
        pendingInsetsSync = null
      } else if (insetSyncAttempts < 100) {
        insetSyncAttempts++
        pendingInsetsSync?.let { mainHandler.removeCallbacks(it) }
        val retry = Runnable { sendInsetsToWeb(insets, wv) }
        pendingInsetsSync = retry
        mainHandler.postDelayed(retry, 100)
      } else {
        Log.e("Prabawa", "Android safe-area sync did not complete after 100 retries")
      }
    }
  }

  private fun syncThemeFromWeb(wv: WebView?) {
    if (wv == null) return
    wv.evaluateJavascript("""
      (function(){try{
        var d=document.documentElement.classList.contains('dark')||
              (document.body&&document.body.dataset&&document.body.dataset.theme==='dark')||
              localStorage.getItem('theme')==='dark';
        return d?'dark':'light';
      }catch(e){return '';}}())
    """.trimIndent()) { result ->
      if      (result?.contains("dark")  == true) { appThemeIsDark = true;  applySystemBarTheme() }
      else if (result?.contains("light") == true) { appThemeIsDark = false; applySystemBarTheme() }
    }
  }

  /** Cari WebView di view hierarchy secara rekursif. */
  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) { findWebView(view.getChildAt(i))?.let { return it } }
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
   * Status bar & navigation bar transparan penuh edge-to-edge.
   * Ikon bar ikut tema aktif (light/dark).
   */
  private fun applySystemBarTheme() {
    runOnUiThread {
      val isDark = appThemeIsDark || overlayDarkMode
      val workspaceColor = if (isDark) Color.parseColor("#0B1120") else Color.parseColor("#F8FAFC")

      window.statusBarColor     = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setPadding(0, 0, 0, 0)

      window.setBackgroundDrawable(ColorDrawable(workspaceColor))
      window.decorView.setBackgroundColor(workspaceColor)
      findWebView(window.decorView)?.setBackgroundColor(workspaceColor)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isStatusBarContrastEnforced    = false
        window.isNavigationBarContrastEnforced = false
      }

      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior              = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
      controller.isAppearanceLightStatusBars     = !isDark
      controller.isAppearanceLightNavigationBars = !isDark
    }
  }
}
`);
console.log('  ✅ MainActivity.kt diperbarui (PrabawaBridge + PrabawaAutomasiBridge)');

// ─────────────────────────────────────────────────────────────────────────────
// PrabawaForegroundService.kt — START_STICKY + 24h PARTIAL_WAKE_LOCK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n⚙️  Menulis PrabawaForegroundService.kt…');

const fgService = join(root, 'java/id/go/jatim/prabawa/PrabawaForegroundService.kt');
put(fgService, `package id.go.jatim.prabawa

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class PrabawaForegroundService : Service() {

    companion object {
        const val ACTION_START  = "id.go.jatim.prabawa.AUTOMASI_START"
        const val ACTION_STOP   = "id.go.jatim.prabawa.AUTOMASI_STOP"
        const val EXTRA_TITLE   = "notif_title"
        const val EXTRA_CONTENT = "notif_content"
        private const val CHANNEL_ID      = "prabawa_automasi_channel"
        private const val NOTIFICATION_ID = 9912
        private const val WAKE_LOCK_TAG   = "Prabawa:AutomasiWakeLock"
        private val TAG = "PrabawaFGService"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_STOP -> {
                Log.d(TAG, "STOP received")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
                START_NOT_STICKY
            }
            else -> {
                val title   = intent?.getStringExtra(EXTRA_TITLE)   ?: "PRABAWA Presensi"
                val content = intent?.getStringExtra(EXTRA_CONTENT) ?: "Penjadwal presensi otomatis aktif di latar belakang"
                startForeground(NOTIFICATION_ID, buildNotification(title, content))
                Log.d(TAG, "Foreground service started")
                START_STICKY
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        releaseWakeLock()
        Log.d(TAG, "Destroyed")
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Layanan Presensi Latar Belakang",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Menjaga penjadwal presensi otomatis tetap berjalan di latar belakang"
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(title: String, content: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        notif.flags = notif.flags or Notification.FLAG_NO_CLEAR
        return notif
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            // PARTIAL_WAKE_LOCK: mencegah CPU masuk Deep Sleep (Doze Mode) saat layar mati
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                acquire(24L * 60 * 60 * 1000) // maksimal 24 jam
            }
        } catch (e: Exception) { Log.e(TAG, "acquireWakeLock: \${e.message}") }
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() }
        catch (e: Exception) { Log.e(TAG, "releaseWakeLock: \${e.message}") }
    }
}
`);
console.log('  ✅ PrabawaForegroundService.kt ditulis');

// ─────────────────────────────────────────────────────────────────────────────
// PrabawaNotificationHelper.kt — IMPORTANCE_HIGH + BigTextStyle
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔔 Menulis PrabawaNotificationHelper.kt…');

const notifHelper = join(root, 'java/id/go/jatim/prabawa/PrabawaNotificationHelper.kt');
put(notifHelper, `package id.go.jatim.prabawa

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object PrabawaNotificationHelper {

    private const val CHANNEL_ID   = "prabawa_attendance_alerts"
    private const val CHANNEL_NAME = "Notifikasi Presensi PRABAWA"

    fun showNotification(context: Context, title: String, message: String) {
        createChannel(context)

        val pi = PendingIntent.getActivity(
            context, 0,
            context.packageManager.getLaunchIntentForPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        val notifId = (System.currentTimeMillis() % 100_000L).toInt()
        try {
            NotificationManagerCompat.from(context).notify(notifId, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS belum diberikan — log saja, jangan crash
            android.util.Log.w("PrabawaNotif", "POST_NOTIFICATIONS not granted: \${e.message}")
        }
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Status eksekusi presensi otomatis terjadwal"
                enableVibration(true)
                enableLights(true)
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }
}
`);
console.log('  ✅ PrabawaNotificationHelper.kt ditulis');

// ─────────────────────────────────────────────────────────────────────────────
// PrabawaBootReceiver.kt — BOOT_COMPLETED + MY_PACKAGE_REPLACED + LOCKED_BOOT
// Langsung start ForegroundService + enqueue WorkManager tanpa buka Activity.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔁 Menulis PrabawaBootReceiver.kt…');

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

/**
 * BroadcastReceiver untuk BOOT_COMPLETED & MY_PACKAGE_REPLACED.
 *
 * Otomatis menyalakan service di background tanpa perlu user membuka
 * aplikasi secara manual setelah HP restart atau update APK.
 */
class PrabawaBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED
            && action != Intent.ACTION_MY_PACKAGE_REPLACED
            && action != "android.intent.action.ACTION_LOCKED_BOOT_COMPLETED") return

        Log.d("PrabawaBoot", "Received: \$action")

        val prefs = context.getSharedPreferences("prabawa_automasi", Context.MODE_PRIVATE)
        val penjadwalAktif = prefs.getBoolean("penjadwal_aktif", false)

        if (!penjadwalAktif) {
            Log.d("PrabawaBoot", "Tidak ada fitur aktif, skip restart")
            return
        }

        // 1. Start ForegroundService langsung — tidak perlu Activity
        val serviceIntent = Intent(context, PrabawaForegroundService::class.java).apply {
            action = PrabawaForegroundService.ACTION_START
            putExtra(PrabawaForegroundService.EXTRA_TITLE, "PRABAWA Presensi Otomatis")
            putExtra(PrabawaForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.d("PrabawaBoot", "ForegroundService started")
        } catch (e: Exception) {
            Log.e("PrabawaBoot", "startForegroundService gagal: \${e.message}")
        }

        // 2. Enqueue WorkManager sebagai lapisan fallback periodik
        try {
            val workRequest = PeriodicWorkRequestBuilder<PrabawaKeepaliveWorker>(
                15, TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PrabawaKeepaliveWorker.WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            )
            Log.d("PrabawaBoot", "WorkManager keepalive enqueued")
        } catch (e: Exception) {
            Log.e("PrabawaBoot", "WorkManager enqueue gagal: \${e.message}")
        }
    }
}
`);
console.log('  ✅ PrabawaBootReceiver.kt ditulis');

// ─────────────────────────────────────────────────────────────────────────────
// PrabawaKeepaliveWorker.kt — WorkManager periodik 15 menit
// Menjamin tugas otomatisasi tetap antre dan dieksekusi oleh sistem meskipun
// aplikasi telah di-clear dari Recent Apps.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n⚙️  Menulis PrabawaKeepaliveWorker.kt…');

const keepaliveWorker = join(root, 'java/id/go/jatim/prabawa/PrabawaKeepaliveWorker.kt');
put(keepaliveWorker, `package id.go.jatim.prabawa

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * WorkManager periodik 15 menit.
 *
 * Menjamin PrabawaForegroundService tetap berjalan meski app di-clear dari recents.
 * Android OS WAJIB menjalankan WorkManager bahkan setelah app di-kill.
 * Ini adalah lapisan ketiga setelah ForegroundService (START_STICKY) dan BootReceiver.
 */
class PrabawaKeepaliveWorker(
    private val ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    companion object {
        const val WORK_NAME = "prabawa_keepalive"

        /** Panggil saat fitur automasi diaktifkan. */
        fun enqueue(context: Context) {
            val req = PeriodicWorkRequestBuilder<PrabawaKeepaliveWorker>(
                15, TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
            )
            Log.d("PrabawaWorker", "Keepalive work enqueued")
        }

        /** Panggil saat semua fitur automasi dinonaktifkan. */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d("PrabawaWorker", "Keepalive work cancelled")
        }
    }

    override suspend fun doWork(): Result {
        Log.d("PrabawaWorker", "doWork() called")

        val prefs = ctx.getSharedPreferences("prabawa_automasi", Context.MODE_PRIVATE)
        val penjadwalAktif = prefs.getBoolean("penjadwal_aktif", false)

        if (!penjadwalAktif) {
            Log.d("PrabawaWorker", "Tidak ada fitur aktif, skip")
            return Result.success()
        }

        // Pastikan ForegroundService masih berjalan
        val serviceIntent = Intent(ctx, PrabawaForegroundService::class.java).apply {
            action = PrabawaForegroundService.ACTION_START
            putExtra(PrabawaForegroundService.EXTRA_TITLE, "PRABAWA Presensi Otomatis")
            putExtra(PrabawaForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
        }

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(serviceIntent)
            } else {
                ctx.startService(serviceIntent)
            }
            Log.d("PrabawaWorker", "ForegroundService (re)started")
            Result.success()
        } catch (e: Exception) {
            Log.e("PrabawaWorker", "Gagal start service: \${e.message}")
            Result.retry()
        }
    }
}
`);
console.log('  ✅ PrabawaKeepaliveWorker.kt ditulis');

// ─────────────────────────────────────────────────────────────────────────────
// Resources: colors.xml + themes.xml
// ─────────────────────────────────────────────────────────────────────────────
put(join(root, 'res/values/colors.xml'), `<resources>
  <color name="splash_background">#0B1120</color>
  <color name="splash_icon_background">#0B1120</color>
</resources>
`);

put(join(root, 'res/values/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.app" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">false</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:background">@color/splash_background</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:colorBackground">@color/splash_background</item>
    <item name="android:windowActionModeOverlay">true</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
  <style name="Theme.prabawa" parent="Theme.app" />
</resources>
`);

put(join(root, 'res/values-night/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.app" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">false</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:background">@color/splash_background</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:colorBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
  <style name="Theme.prabawa" parent="Theme.app" />
</resources>
`);

console.log('\n✅ Semua patch Android selesai!');
console.log('   ├── AndroidManifest: 8 permissions + ForegroundService (specialUse, directBootAware) + BootReceiver (priority 999)');
console.log('   ├── build.gradle.kts: + androidx.work:work-runtime-ktx:2.9.0');
console.log('   ├── MainActivity.kt: PrabawaBridge + PrabawaAutomasiBridge + runtime POST_NOTIFICATIONS + AutomationWebView');
console.log('   ├── PrabawaForegroundService.kt: START_STICKY + IMPORTANCE_LOW + 24h PARTIAL_WAKE_LOCK + FLAG_NO_CLEAR');
console.log('   ├── PrabawaNotificationHelper.kt: IMPORTANCE_HIGH + BigTextStyle + NotificationManagerCompat');
console.log('   ├── PrabawaBootReceiver.kt: start ForegroundService langsung + enqueue WorkManager (tanpa buka Activity)');
console.log('   └── PrabawaKeepaliveWorker.kt: WorkManager periodik 15 menit — tetap hidup meski app di-clear recents');
