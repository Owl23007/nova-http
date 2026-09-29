import type { DefaultTheme } from "vitepress";

export interface HomeFooterContent {
  label: string;
  homeLabel: string;
  homeHref: string;
  logoSrc: string;
  brand: string;
  description: string;
  copyright: string;
  license: { text: string; href: string };
}

export interface ImagePreviewLabels {
  title: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  reset: string;
  error: string;
}

export interface NovaThemeConfig extends DefaultTheme.Config {
  homeFooter: HomeFooterContent;
  imagePreview: ImagePreviewLabels;
}
