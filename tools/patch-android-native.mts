import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
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
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import id.go.jatim.prabawa.TauriActivity

class MainActivity : TauriActivity() {

  /** Dipanggil dari JS saat Prabawa mengganti tema (dark/light). */
  inner class PrabawaBridge {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      applySystemBarTheme(dark)
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var bridgeInjected = false
  private var checkAttempts = 0
  private val maxCheckAttempts = 30 // Coba selama 6 detik (30 x 200ms)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // True Edge-to-edge: konten web mengisi 100% layar tanpa padding/kotak putih
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.decorView.setPadding(0, 0, 0, 0)

    // Matikan pemaksaan kontras bawaan Android (scrim abu/putih di status bar & nav bar)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // Terapkan tema awal dari setting sistem Android
    val systemIsDark = (resources.configuration.uiMode and
                        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    applySystemBarTheme(systemIsDark)

    // Tangkap insets dan teruskan ukuran status bar & nav bar ke CSS variables di WebView
    // JANGAN pernah beri padding pada decorView agar aplikasi tidak menyempit / ada kotak putih
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      window.decorView.setPadding(0, 0, 0, 0)
      sendInsetsToWeb(insets)
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
    if (!bridgeInjected) {
      startBridgeInjectionLoop()
    } else {
      val wv = findWebView(window.decorView)
      syncThemeFromWeb(wv)
      val insets = ViewCompat.getRootWindowInsets(window.decorView)
      if (insets != null) sendInsetsToWeb(insets)
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
    val insets = ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) sendInsetsToWeb(insets)
    syncThemeFromWeb(wv)
  }

  private fun sendInsetsToWeb(insets: WindowInsetsCompat) {
    val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
    val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val density = resources.displayMetrics.density
    val topDp = (statusBars.top / density).toInt()
    val bottomDp = (navBars.bottom / density).toInt()

    val wv = findWebView(window.decorView) ?: return
    wv.evaluateJavascript(
      """
      (function() {
        try {
          document.documentElement.style.setProperty('--poni-atas', '${topDp}px');
          document.documentElement.style.setProperty('--poni-bawah', '${bottomDp}px');
        } catch(e) {}
      })();
      """.trimIndent(), null
    )
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
        applySystemBarTheme(true)
      } else if (result?.contains("light") == true) {
        applySystemBarTheme(false)
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
    } else {
      val isDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
      applySystemBarTheme(isDark)
    }
  }

  /**
   * Terapkan warna transparan edge-to-edge murni dan kontras ikon status bar & nav bar:
   *
   * Light mode:
   *   isAppearanceLightStatusBars = true  → icon GELAP / HITAM (kontras tinggi di header terang)
   *   isAppearanceLightNavigationBars = true
   *
   * Dark mode:
   *   isAppearanceLightStatusBars = false → icon TERANG / PUTIH (kontras tinggi di header navy gelap)
   *   isAppearanceLightNavigationBars = false
   *
   * Bebas dari kotak putih / scrim / padding decorView!
   */
  private fun applySystemBarTheme(isDark: Boolean) {
    runOnUiThread {
      // 1. AndroidX true transparent edge-to-edge tanpa scrim
      enableEdgeToEdge(
        statusBarStyle = if (isDark) {
          SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
          SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        },
        navigationBarStyle = if (isDark) {
          SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
          SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
      )

      // 2. Bar transparan penuh & hilangkan padding decorView
      window.statusBarColor = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setPadding(0, 0, 0, 0)

      val barColor = if (isDark) Color.parseColor("#0F172A") else Color.parseColor("#FFFFFF")
      window.setBackgroundDrawable(ColorDrawable(barColor))
      window.decorView.setBackgroundColor(barColor)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isStatusBarContrastEnforced = false
        window.isNavigationBarContrastEnforced = false
      }

      // 3. Atur icon status bar & navigation bar
      val controller = WindowInsetsControllerCompat(window, window.decorView)
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
      controller.isAppearanceLightStatusBars = !isDark
      controller.isAppearanceLightNavigationBars = !isDark
    }
  }
}
`);

put(join(root, 'res/values/colors.xml'), `<resources><color name="splash_background">#0F172A</color><color name="splash_icon_background">#0F172A</color></resources>
`);

put(join(root, 'res/values/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">true</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">true</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item><item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item><item name="android:windowBackground">@color/splash_background</item><item name="android:colorBackground">@color/splash_background</item><item name="android:windowActionModeOverlay">true</item><item name="android:windowNoTitle">true</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>
`);

put(join(root, 'res/values-night/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">false</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">false</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item><item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item><item name="android:windowBackground">@color/splash_background</item><item name="android:colorBackground">@color/splash_background</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>
`);

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
  '    testImplementation("junit:junit:4.13.2")',
  '    androidTestImplementation("androidx.test.ext:junit:1.1.4")',
  '    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")',
  '}',
  '',
  'apply(from = file("tauri.build.gradle.kts"))',
].join('\n');
writeFileSync(gradle, isiGradle);
