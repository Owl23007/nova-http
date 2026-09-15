<script setup lang="ts">
defineProps<{
  label: string;
  app: string;
  server: string;
  core: string;
  protocol: string;
  message: string;
  caption: string;
}>();
</script>

<template>
  <figure class="layer-diagram" :aria-label="label">
    <div class="layer-row">
      <code>app</code><span>{{ app }}</span>
    </div>
    <div class="layer-row">
      <code>server</code><span>{{ server }}</span>
    </div>
    <div class="layer-pair">
      <div>
        <code>core</code><span>{{ core }}</span>
      </div>
      <div>
        <code>protocol/http1</code><span>{{ protocol }}</span>
      </div>
    </div>
    <div class="layer-row">
      <code>message</code><span>{{ message }}</span>
    </div>
    <figcaption>{{ caption }}</figcaption>
  </figure>
</template>
