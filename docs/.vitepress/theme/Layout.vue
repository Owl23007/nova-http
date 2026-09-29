<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import HomeFooter from "./components/HomeFooter.vue";
import type { NovaThemeConfig } from "./types";
import { onBeforeUnmount, watch } from "vue";
import { useRoute } from "vitepress";
import ImagePreview from "./components/ImagePreview.vue";
import { provideImagePreview } from "./image-preview";

const { frontmatter, theme } = useData<NovaThemeConfig>();
const { image, open, close } = provideImagePreview();
const route = useRoute();
watch(() => route.path, close);
onBeforeUnmount(close);
const previewLabels = {
  title: "图片预览",
  close: "关闭预览",
  zoomIn: "放大",
  zoomOut: "缩小",
  reset: "适应窗口",
  hint: "拖动平移 · 滚轮缩放 · Esc 关闭",
  error: "图片加载失败，请关闭后重试。",
};
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <HomeFooter v-if="frontmatter.layout === 'home'" :content="theme.homeFooter" />
    </template>
  </DefaultTheme.Layout>
  <ImagePreview :image="image" :labels="previewLabels" @open="open" @close="close" />
</template>
