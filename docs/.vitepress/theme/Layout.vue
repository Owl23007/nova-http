<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import HomeFooter from "./components/HomeFooter.vue";
import type { NovaThemeConfig } from "./types";

const { frontmatter, theme } = useData<NovaThemeConfig>();
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <HomeFooter v-if="frontmatter.layout === 'home'" :content="theme.homeFooter" />
    </template>
  </DefaultTheme.Layout>
</template>
