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
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <HomeFooter v-if="frontmatter.layout === 'home'" :content="theme.homeFooter" />
    </template>
  </DefaultTheme.Layout>
  <ImagePreview :image="image" :labels="theme.imagePreview" @open="open" @close="close" />
</template>
