plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cc.ityc.itv"
    compileSdk = 34

    defaultConfig {
        applicationId = "cc.ityc.itv"
        minSdk = 24
        targetSdk = 34
        versionCode = 6
        versionName = "1.1.0"
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
    }

    /*
     * 固定一把发布密钥。
     *
     * 原来是 assembleDebug，而 runner 上没有 ~/.android/debug.keystore，
     * AGP 每次现生成一把——于是每版 APK 签名都不一样，装到设备上更新时
     * 报 INSTALL_FAILED_UPDATE_INCOMPATIBLE，App 里那个「检查更新」
     * 从发布起就是死的，只能卸载重装。
     *
     * 本地没配这几个环境变量就退回 debug 签名，自己 assembleDebug 照常能用。
     */
    signingConfigs {
        create("release") {
            val store = System.getenv("ANDROID_KEYSTORE_FILE")
            if (store != null) {
                storeFile = file(store)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (System.getenv("ANDROID_KEYSTORE_FILE") != null) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.videolan.android:libvlc-all:3.6.0")
}
