import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/**
 * The APK we ship is debug-signed on purpose (see scripts/build/index.ts), and a
 * debug build is normally signed with ~/.android/debug.keystore — which the
 * Android plugin generates per *machine*. A CI runner is a fresh machine every
 * run, so each release came out under a different certificate and Android
 * refused the next one as an upgrade: "App not installed", no reason given.
 *
 * So when a keystore is handed to us in the environment, sign with that instead
 * and every release shares one identity. Absent it — any local build — nothing
 * changes and the usual debug key is used.
 */
val ciKeystore: String? = System.getenv("ANDROID_KEYSTORE_PATH")
    ?.takeIf { it.isNotBlank() && file(it).exists() }

android {
    compileSdk = 36
    namespace = "com.ventic.app"
    signingConfigs {
        // Bound to a local first: a script-level `val` is a property of the
        // script class, which Kotlin will not smart-cast inside this lambda.
        val keystore = ciKeystore
        if (keystore != null) {
            create("ci") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // Which copy may install an APK. Play's permitted uses for
        // REQUEST_INSTALL_PACKAGES are a fixed list — browser, assistant,
        // messaging, file manager, MDM — and self-updating is on none of them;
        // Play forbids a copy it distributes from updating by any other route,
        // which is why canInstallApk() already says no there. So the bundle
        // must not even ask, or the upload is rejected before review. Naming
        // INTERNET a second time is how a manifest un-asks: a repeated
        // permission is legal and this one is already granted, so the bundle
        // asks for nothing it did not ask for before.
        // Set through the environment by scripts/build/index.ts, because the
        // tauri CLI passes nothing of its own down to Gradle.
        manifestPlaceholders["installPermission"] =
            if (project.hasProperty("venticPlay")) "android.permission.INTERNET"
            else "android.permission.REQUEST_INSTALL_PACKAGES"
        applicationId = "com.ventic.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            if (ciKeystore != null) {
                signingConfig = signingConfigs.getByName("ci")
            }
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Without this the bundler emits app-universal-release-unsigned.apk and
            // Android refuses to install it — which is the whole reason releases used
            // to go out as debug builds.
            if (ciKeystore != null) {
                signingConfig = signingConfigs.getByName("ci")
            }
            // The torrent engine is plain http on 127.0.0.1, inside this very
            // process, and every stream, poll and playback request goes through
            // it. A release APK blocks cleartext by default, which would leave
            // the app unable to reach its own engine with nothing in the log to
            // explain it — same reason the debug build sets it.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    // Playback, because the system webview's <video> refuses Dolby and DTS
    // whatever the device can actually decode. See Player.kt.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    // Live TV is HLS. DefaultMediaSourceFactory only recognises an .m3u8 when
    // this module is on the classpath — without it every channel fails as an
    // unreadable progressive stream.
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    // Software audio decoding, for when the device's own decoder says yes and
    // then dies — see `retryInSoftware` in Player.kt for why that is not
    // hypothetical. Google does not publish this module to Maven (it links
    // FFmpeg, which is licensed separately), so it is built from the media3
    // source with scripts/build/android/ffmpeg.ts and checked in as an .aar.
    // A file dependency carries no POM, so its own api dependency is named here.
    implementation(files("libs/media3-decoder-ffmpeg-1.8.0.aar"))
    implementation("androidx.media3:media3-decoder:1.8.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")