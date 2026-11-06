plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "company.outpulse.dues"
    compileSdk = 34

    defaultConfig {
        applicationId = "company.outpulse.dues"
        minSdk = 24
        targetSdk = 34
        versionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("APP_VERSION_CODE") ?: "1")
        // The Dues web app is built into the APK (public/ → assets) and served from a private https address, so it works with no website and offline.
        buildConfigField("String", "START_URL", "\"https://appassets.androidplatform.net/assets/app.html\"")
    }

    sourceSets {
        getByName("main") {
            assets.srcDirs("../../public")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("sideload") {
            storeFile = file("../dues-sideload.jks")
            storePassword = "dues-sideload"
            keyAlias = "dues"
            keyPassword = "dues-sideload"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("androidx.biometric:biometric:1.1.0")
}
