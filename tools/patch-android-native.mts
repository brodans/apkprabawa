import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main');
const put = (file, content) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
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
let g = readFileSync(gradle, 'utf8');
g = g.replace('jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")\n', 'jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")\n');
writeFileSync(gradle, g);
