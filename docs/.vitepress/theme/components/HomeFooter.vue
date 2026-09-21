<script setup lang="ts">
import { withBase } from "vitepress";
import type { HomeFooterContent } from "../types";

defineProps<{ content: HomeFooterContent }>();
</script>

<template>
  <footer class="nova-footer" :aria-label="content.label">
    <div class="nova-footer-inner">
      <div class="nova-footer-brand">
        <a
          class="nova-footer-logo"
          :href="withBase(content.homeHref)"
          :aria-label="content.homeLabel"
        >
          <img :src="withBase(content.logoSrc)" alt="" width="32" height="32" />
          <span>{{ content.brand }}</span>
        </a>
        <p>{{ content.description }}</p>
      </div>
      <div class="nova-footer-bottom">
        <span>{{ content.copyright }}</span>
        <a :href="withBase(content.license.href)">{{ content.license.text }}</a>
      </div>
    </div>
  </footer>
</template>
