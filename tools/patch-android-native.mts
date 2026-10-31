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
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
      runOnUiThread { applySystemBarTheme(dark) }
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var bridgeInjected = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Edge-to-edge: konten web boleh menempel ke area sistem bar.
    enableEdgeToEdge()
    WindowCompat.setDecorFitsSystemWindows(window, false)

    // Status bar & navigation bar SELALU transparan.
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    // Padding otomatis agar konten web tidak tertutup system bar.
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      window.decorView.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }

    // Terapkan tema awal dari system dark-mode setting.
    val systemIsDark = (resources.configuration.uiMode and
                        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    applySystemBarTheme(systemIsDark)
  }

  override fun onResume() {
    super.onResume()
    // Injeksi JS bridge ke WebView Tauri. Tauri membuat WebView secara async
    // di thread Rust/JNI, sehingga kita tunggu sebentar sebelum mencarinya.
    if (!bridgeInjected) {
      mainHandler.postDelayed({ injectBridge() }, 600)
    }
  }

  private fun injectBridge() {
    val wv = findWebView(window.decorView) ?: return
    wv.addJavascriptInterface(PrabawaBridge(), "AndroidPrabawa")
    bridgeInjected = true
    // Baca tema tersimpan Prabawa dari localStorage dan sinkronkan status bar.
    wv.evaluateJavascript(
      "(function(){ try { return localStorage.getItem('theme') || ''; } catch(e){ return ''; } })()"
    ) { result ->
      val tema = result?.trim('"') ?: ""
      runOnUiThread {
        // Jika localStorage belum ada / kosong, pakai system dark mode.
        val systemIsDark = (resources.configuration.uiMode and
                            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        applySystemBarTheme(if (tema == "dark") true else if (tema == "light") false else systemIsDark)
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
    val isDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    applySystemBarTheme(isDark)
  }

  /**
   * Terapkan warna ikon status bar & nav bar sesuai tema.
   *
   * Light mode: isAppearanceLightStatusBars = true  → ikon gelap (hitam), terlihat di bg terang
   * Dark mode:  isAppearanceLightStatusBars = false → ikon terang (putih), terlihat di bg gelap
   *
   * BEHAVIOR_DEFAULT: sistem bar SELALU tampil, tidak pernah auto-hide.
   */
  private fun applySystemBarTheme(isDark: Boolean) {
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
    controller.isAppearanceLightStatusBars = !isDark
    controller.isAppearanceLightNavigationBars = !isDark
  }
}
`);

put(join(root, 'res/values/colors.xml'), `<resources><color name="splash_background">#0F172A</color><color name="splash_icon_background">#0F172A</color></resources>
`);

put(join(root, 'res/values/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">true</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">true</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:windowActionModeOverlay">true</item><item name="android:windowNoTitle">true</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>
`);

put(join(root, 'res/values-night/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">false</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">false</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>
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
