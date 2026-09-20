import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    vue(),
    /*
     * 给老 WebView 另出一份 nomodule 包。
     *
     * 起因：把这个控制台嵌进 iTyc-Panel 的挂墙大屏时整个是空白的。
     * 那台 RK3399 盒子是安卓 7.1.2，WebView 停在 Chrome 56，
     * 而 Vite 默认只产出 <script type="module">——Chrome 61 以下根本不认这个
     * 标签，会把它整个忽略。结果不是「功能不全」，是一行 JS 都不跑、
     * 页面一片黑，而且控制台里一句报错都没有，看上去像服务挂了。
     *
     * 加上这个插件之后：新浏览器照旧走 module，老的走 nomodule，两边都能跑。
     * 代价是多产出两个包（主包 + polyfill），但它们带 nomodule 属性，
     * 新浏览器看都不会看一眼，不影响正常访问的加载量。
     *
     * 目标定在 chrome 53 / android 7：再往下就没有实际设备了。
     */
    legacy({
      targets: ["chrome >= 53", "android >= 7"],
      renderLegacyChunks: true,
      modernPolyfills: false,
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/live": "http://127.0.0.1:8787",
    },
  },
});
