<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  command: string;
  copyLabel: string;
  copiedLabel: string;
}>();
const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCommand() {
  await navigator.clipboard.writeText(props.command);
  copied.value = true;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copied.value = false;
  }, 1600);
}
</script>

<template>
  <button
    class="home-command"
    :class="{ copied }"
    type="button"
    :aria-label="copied ? copiedLabel : `${copyLabel}: ${command}`"
    @click="copyCommand"
  >
    <span class="home-command-prompt" aria-hidden="true">›_</span>
    <code>{{ command }}</code>
    <span class="home-command-copy" aria-hidden="true"></span>
    <span class="visually-hidden" aria-live="polite">{{ copied ? copiedLabel : "" }}</span>
  </button>
</template>
