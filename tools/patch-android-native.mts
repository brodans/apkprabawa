import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main');
const put = (file: string, content: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
const activity = join(root, 'java/id/go/jatim/prabawa/MainActivity.kt');
put(activity, `package id.go.jatim.prabawa

import android.os.Bundle
import android.graphics.Color
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT)
    )
    super.onCreate(savedInstanceState)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or
      android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
      android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
      android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
  }
}
`);
put(join(root, 'res/values/colors.xml'), `<resources><color name="splash_background">#0F172A</color><color name="splash_icon_background">#0F172A</color></resources>\n`);
put(join(root, 'res/values/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">false</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">false</item><item name="android:windowActionModeOverlay">true</item><item name="android:windowNoTitle">true</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>\n`);
put(join(root, 'res/values-night/themes.xml'), `<resources xmlns:tools="http://schemas.android.com/tools"><style name="Theme.prabawa" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowLightStatusBar">false</item><item name="android:statusBarColor">@android:color/transparent</item><item name="android:navigationBarColor">@android:color/transparent</item><item name="android:windowLightNavigationBar">false</item><item name="android:windowSplashScreenBackground">@color/splash_background</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>\n`);
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
