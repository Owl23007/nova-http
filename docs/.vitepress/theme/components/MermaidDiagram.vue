<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useData } from "vitepress";
import { renderMermaid } from "../mermaid";
import { useImagePreview } from "../image-preview";

const props = defineProps<{
  source: string;
  errorLabel: string;
  previewLabel: string;
}>();
const { isDark } = useData();
const svg = ref("");
const failed = ref(false);
const openPreview = useImagePreview();
let revision = 0;
let stop: (() => void) | undefined;

onMounted(() => {
  stop = watch(
    [() => props.source, isDark],
    async ([source, dark]) => {
      const current = ++revision;
      failed.value = false;
      svg.value = "";
      try {
        const result = await renderMermaid(source, dark);
        if (current === revision) {
          svg.value = result.svg;
        }
      } catch {
        if (current === revision) failed.value = true;
      }
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  revision++;
  stop?.();
});
</script>

<template>
  <div class="mermaid-diagram">
    <template v-if="svg">
      <button
        class="mermaid-expand"
        type="button"
        :aria-label="previewLabel"
        :title="previewLabel"
        aria-haspopup="dialog"
        @click="openPreview({ svg, alt: 'Mermaid' })"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
      <div class="mermaid-scroll" tabindex="0" role="region" aria-label="Mermaid">
        <div class="mermaid-diagram-output" v-html="svg" />
      </div>
    </template>
    <div v-else class="mermaid-fallback">
      <div class="mermaid-fallback-header">
        <svg
          class="mermaid-fallback-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <rect x="8" y="3" width="8" height="5" rx="1" />
          <path d="M12 8v5M5 16v-3h14v3" />
          <rect x="2" y="16" width="6" height="5" rx="1" />
          <rect x="16" y="16" width="6" height="5" rx="1" />
        </svg>
        <span>Mermaid</span>
      </div>
      <p v-if="failed" class="mermaid-fallback-message" role="status">
        <span class="mermaid-fallback-indicator" aria-hidden="true">!</span>
        {{ errorLabel }}
      </p>
      <pre class="mermaid-fallback-source" tabindex="0"><code>{{ source }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.mermaid-diagram {
  position: relative;
  margin: 24px 0;
  min-width: 0;
}

.mermaid-scroll {
  padding: 40px 12px 16px;
  overflow-x: auto;
}

.mermaid-expand {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--nova-radius);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-3);
  cursor: pointer;
}

.mermaid-expand:hover {
  border-color: var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}

.mermaid-expand:focus-visible,
.mermaid-scroll:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.mermaid-diagram-output {
  display: flex;
  justify-content: center;
}

.mermaid-diagram-output :deep(svg) {
  height: auto;
}

.mermaid-fallback {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--nova-radius);
  background: var(--vp-code-block-bg);
}

.mermaid-fallback-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}

.mermaid-fallback-icon {
  flex-shrink: 0;
}

.mermaid-fallback .mermaid-fallback-message {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
  font-size: 13px;
  line-height: 1.7;
}

.mermaid-fallback-indicator {
  display: inline-flex;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  height: 16px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.mermaid-fallback .mermaid-fallback-source {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  background: transparent;
  white-space: pre;
  overflow-wrap: normal;
  tab-size: 2;
}

.mermaid-fallback-source code {
  display: block;
  padding: 0;
  background: transparent;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: var(--vp-code-font-size);
  line-height: 1.75;
}

.mermaid-fallback-source:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}
</style>
