import { createRouter, createWebHistory } from "vue-router";
import AdminLayout from "./views/AdminLayout.vue";
import Home from "./views/Home.vue";
import Settings from "./views/Settings.vue";
import Library from "./views/Library.vue";
import Channels from "./views/Channels.vue";
import ChannelEdit from "./views/ChannelEdit.vue";
import TvPlayer from "./views/TvPlayer.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/tv/:id", component: TvPlayer },
    {
      path: "/",
      component: AdminLayout,
      children: [
        { path: "", component: Home },
        { path: "settings", component: Settings },
        { path: "library", component: Library },
        { path: "channels", component: Channels },
        { path: "channels/:id", component: ChannelEdit },
      ],
    },
  ],
});
