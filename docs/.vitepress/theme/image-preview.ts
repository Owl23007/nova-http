import { inject, provide, shallowRef, type InjectionKey } from "vue";

type PreviewSource = { src: string; alt: string } | { svg: string; alt: string };
const previewKey: InjectionKey<(source: PreviewSource) => void> = Symbol("image-preview");

export function provideImagePreview() {
  const image = shallowRef<{ src: string; alt: string } | null>(null);
  let objectUrl: string | undefined;
  function close() {
    image.value = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  }
  function open(source: PreviewSource) {
    close();
    if ("svg" in source) {
      // SVG images need intrinsic dimensions to preserve a large diagram's natural size.
      const document = new DOMParser().parseFromString(source.svg, "image/svg+xml");
      const svg = document.documentElement;
      const bounds = svg
        .getAttribute("viewBox")
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      if (bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
        svg.setAttribute("width", String(bounds[2]));
        svg.setAttribute("height", String(bounds[3]));
      }
      objectUrl = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
      );
      image.value = { src: objectUrl, alt: source.alt };
    } else {
      image.value = source;
    }
  }
  provide(previewKey, open);
  return { image, open, close };
}

export function useImagePreview() {
  const open = inject(previewKey);
  if (!open) throw new Error("Image preview provider is missing");
  return open;
}
