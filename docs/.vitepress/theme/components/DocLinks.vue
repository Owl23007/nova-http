<script setup lang="ts">
import { withBase } from "vitepress";
defineProps<{ items: { title: string; description: string; href: string }[] }>();
</script>

<template>
  <ul class="doc-links">
    <li v-for="item in items" :key="item.href">
      <a :href="withBase(item.href)">
        <span class="doc-link-title">{{ item.title }} <span aria-hidden="true">→</span></span>
        <span class="doc-link-description">{{ item.description }}</span>
      </a>
    </li>
  </ul>
</template>
