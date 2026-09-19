# iTV 收看 App（安卓 7+）

网页浏览器解不了 4K HEVC，这个 App 用 VLC 原生解码，直接播网盘原片，不走服务器转码。

## 安装

安装包在仓库里：`android/itv-android7.apk`。拷到平板，允许未知来源后安装。自己编译则生成 `app/build/outputs/apk/debug/app-debug.apk`。

默认服务器是 `https://itv.ityc.cc`，可在首页点击地址修改。

## 自己编译

需要 JDK 17 和 Android SDK（platform 34）。

```bat
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
gradlew.bat assembleDebug
```
