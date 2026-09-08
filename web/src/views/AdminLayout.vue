<template>
  <div class="layout">
    <aside class="side">
      <div class="brand">
        <div class="brand-mark">TV</div>
        <div>
          <h1>虚拟电视台</h1>
          <p>轮播控制台</p>
        </div>
      </div>
      <nav class="nav">
        <router-link to="/">总览</router-link>
        <router-link to="/library">片库</router-link>
        <router-link to="/channels">频道</router-link>
        <router-link to="/settings">设置</router-link>
      </nav>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>
