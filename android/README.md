# iTV 收看 App（安卓 7+）

网页浏览器解不了 4K HEVC，这个 App 用 VLC 原生解码，直接播网盘原片，不走服务器转码。

## 安装

GitHub Actions 在 `android/` 变更后自动打包，也可在仓库里手动跑 **Android APK** workflow。

- 发布页：https://github.com/tyrantcwj/iTV/releases/tag/android-latest
- 直链：https://github.com/tyrantcwj/iTV/releases/download/android-latest/itv-android7.apk

拷到平板，允许未知来源后覆盖安装。

默认服务器是 `https://itv.ityc.cc`，可在首页点击地址修改。

首页可填写 GitHub 令牌（需要能读 `tyrantcwj/iTV` 发布的权限），然后点「检查更新」。有新版本会提示打开 `android-latest` 的 APK 下载。

## 自己编译

需要 JDK 17 和 Android SDK（platform 34）。

```bat
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
gradlew.bat assembleDebug
```
