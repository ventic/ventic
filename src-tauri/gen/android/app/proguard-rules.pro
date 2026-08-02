# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# The frontend calls these by name off `window.VenticScreen` / `window.VenticPlayer`
# (see app/utils/platform.ts and MpvPlayer.vue), so the method names are load-bearing
# in a way nothing in the Kotlin references — R8 sees no caller and is free to rename
# them. It renames them to something short, the bridge silently answers `undefined`,
# and Android loses ExoPlayer playback and TV/metered detection with nothing in the
# log. The classes themselves may still be renamed: the names JS knows are the string
# literals handed to addJavascriptInterface, not the class names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Referenced only from AndroidManifest.xml as ".DownloadService" — the foreground
# service that keeps the in-process torrent engine alive when the app is backgrounded.
-keep class com.ventic.app.DownloadService { *; }

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile