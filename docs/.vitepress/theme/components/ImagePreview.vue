<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  image: { src: string; alt: string } | null;
  labels: {
    title: string;
    close: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
    error: string;
  };
}>();
const emit = defineEmits<{
  close: [];
  open: [image: { src: string; alt: string }];
}>();
const dialog = ref<HTMLDialogElement>();
const stage = ref<HTMLDivElement>();
const size = ref({ width: 0, height: 0 });
const scale = ref(1);
const x = ref(0);
const y = ref(0);
const dragging = ref(false);
const failed = ref(false);
let pointer: { id: number; x: number; y: number } | undefined;
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
let locked = false;
let observer: MutationObserver | undefined;
const decorated = new Map<HTMLImageElement, { tabindex: string | null; role: string | null }>();
const transform = computed(() => ({
  width: `${size.value.width}px`,
  height: `${size.value.height}px`,
  transform: `translate(-50%, -50%) translate(${x.value}px, ${y.value}px) scale(${scale.value})`,
}));

function reset() {
  const bounds = stage.value?.getBoundingClientRect();
  if (!bounds || !size.value.width) return;
  scale.value = Math.min(
    1,
    (bounds.width - 48) / size.value.width,
    (bounds.height - 48) / size.value.height,
  );
  x.value = y.value = 0;
}
function loaded(event: Event) {
  const image = event.target as HTMLImageElement;
  size.value = { width: image.naturalWidth, height: image.naturalHeight };
  reset();
}
function zoom(factor: number, px = 0, py = 0) {
  const next = Math.min(8, Math.max(0.02, scale.value * factor));
  const ratio = next / scale.value;
  x.value = px - (px - x.value) * ratio;
  y.value = py - (py - y.value) * ratio;
  scale.value = next;
}
function wheel(event: WheelEvent) {
  const bounds = stage.value!.getBoundingClientRect();
  const delta =
    event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
  zoom(
    Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.005),
    event.clientX - bounds.left - bounds.width / 2,
    event.clientY - bounds.top - bounds.height / 2,
  );
}
function start(event: PointerEvent) {
  if (event.button !== 0 || pointer) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  dragging.value = true;
  stage.value!.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (pointer?.id !== event.pointerId) return;
  x.value += event.clientX - pointer.x;
  y.value += event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}
function end() {
  pointer = undefined;
  dragging.value = false;
}
function restore() {
  end();
  if (!locked) return;
  document.body.style.overflow = previousOverflow;
  locked = false;
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
}
watch(
  () => props.image,
  async (image) => {
    if (!image) {
      dialog.value?.close();
      restore();
      return;
    }
    failed.value = false;
    size.value = { width: 0, height: 0 };
    x.value = y.value = 0;
    scale.value = 1;
    await nextTick();
    if (props.image !== image) return;
    if (!locked) {
      previousFocus = document.activeElement as HTMLElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      locked = true;
    }
    dialog.value?.showModal();
  },
);

function eligible(target: EventTarget | null): target is HTMLImageElement {
  return (
    target instanceof HTMLImageElement &&
    !!target.closest(".vp-doc") &&
    !target.closest("a, button, [data-no-preview]")
  );
}
function openDocumentImage(event: MouseEvent | KeyboardEvent) {
  if (!eligible(event.target)) return;
  if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("open", { src: event.target.currentSrc || event.target.src, alt: event.target.alt });
}
function decorateImages() {
  for (const image of decorated.keys()) {
    if (!image.isConnected) decorated.delete(image);
  }
  document.querySelectorAll<HTMLImageElement>(".vp-doc img").forEach((image) => {
    if (!eligible(image) || decorated.has(image)) return;
    decorated.set(image, {
      tabindex: image.getAttribute("tabindex"),
      role: image.getAttribute("role"),
    });
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.classList.add("image-preview-trigger");
  });
}
onMounted(() => {
  document.addEventListener("click", openDocumentImage);
  document.addEventListener("keydown", openDocumentImage);
  window.addEventListener("resize", reset);
  observer = new MutationObserver(decorateImages);
  observer.observe(document.body, { childList: true, subtree: true });
  decorateImages();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener("click", openDocumentImage);
  document.removeEventListener("keydown", openDocumentImage);
  window.removeEventListener("resize", reset);
  for (const [image, attributes] of decorated) {
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null) image.removeAttribute(name);
      else image.setAttribute(name, value);
    }
    image.classList.remove("image-preview-trigger");
  }
  dialog.value?.close();
  restore();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="image-preview"
    :aria-label="image?.alt || labels.title"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <div class="image-preview-toolbar">
      <span class="image-preview-title">{{ image?.alt || labels.title }}</span>
      <div class="image-preview-controls">
        <button
          type="button"
          :aria-label="labels.zoomOut"
          :title="labels.zoomOut"
          @click="zoom(1 / 1.25)"
        >
          −
        </button>
        <span class="image-preview-scale">{{ Math.round(scale * 100) }}%</span>
        <button
          type="button"
          :aria-label="labels.zoomIn"
          :title="labels.zoomIn"
          @click="zoom(1.25)"
        >
          +
        </button>
        <button type="button" :aria-label="labels.reset" :title="labels.reset" @click="reset">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="image-preview-close"
        autofocus
        :aria-label="labels.close"
        :title="labels.close"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
    <div
      ref="stage"
      class="image-preview-stage"
      :class="{ 'is-dragging': dragging }"
      @wheel.prevent="wheel"
      @pointerdown.prevent="start"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
      @lostpointercapture="end"
    >
      <img
        v-if="image && !failed"
        :key="image.src"
        :src="image.src"
        :alt="image.alt"
        :style="transform"
        draggable="false"
        @load="loaded"
        @error="failed = true"
      />
      <p v-if="failed" role="status">{{ labels.error }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.image-preview {
  position: fixed;
  inset: 0;
  width: 70vw;
  height: calc(100dvh - 48px);
  max-width: none;
  max-height: none;
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  box-shadow: 0 24px 80px #0006;
}
.image-preview[open] {
  display: flex;
  flex-direction: column;
}
.image-preview::backdrop {
  background: #080d16b8;
  backdrop-filter: blur(5px);
}
.image-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.image-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.image-preview-toolbar button {
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.image-preview-controls {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
}
.image-preview-controls button {
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  border-radius: 0;
}
.image-preview-controls button + button,
.image-preview-controls .image-preview-scale + button {
  border-left: 1px solid var(--vp-c-divider);
}
.image-preview-controls svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.image-preview-close {
  margin-left: 4px;
}
.image-preview-toolbar button:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}
.image-preview-toolbar button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.image-preview-scale {
  width: 50px;
  text-align: center;
  font-size: 12px;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.image-preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}
.image-preview-stage.is-dragging {
  cursor: grabbing;
}
.image-preview-stage img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform-origin: center;
  user-select: none;
  pointer-events: none;
}
.image-preview-stage p {
  padding: 24px;
  text-align: center;
}
@media (max-width: 640px) {
  .image-preview {
    width: calc(100vw - 16px);
    height: calc(100dvh - 16px);
  }
  .image-preview-toolbar {
    gap: 2px;
    padding: 8px;
  }
}
</style>

<style>
.vp-doc img.image-preview-trigger {
  cursor: zoom-in;
}
.vp-doc img.image-preview-trigger:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}
</style>
