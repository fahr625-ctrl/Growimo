import type { ImageProvider } from './types';

const configured = false;

/** Returns the configured image provider when one is connected. */
export function getImageProvider(): ImageProvider | null {
  return null;
}

export function isImageProviderConfigured(): boolean {
  return configured;
}

const FORMAT_INFO: Record<string, { width: number; height: number; icon: string; label: string }> = {
  '2:3': { width: 800, height: 1200, icon: '📌', label: 'Pinterest Pin' },
  '4:3': { width: 1200, height: 900, icon: '🛍️', label: 'Etsy Product Mockup' },
  '1:1': { width: 1000, height: 1000, icon: '📱', label: 'Instagram Post' },
  '16:9': { width: 1600, height: 900, icon: '🖼️', label: 'Blog Hero Image' },
};

/** Creates a branded SVG data URL while the image provider is not configured. */
export function generatePlaceholderImage(aspectRatio: '2:3' | '1:1' | '4:3' | '16:9'): string {
  const info = FORMAT_INFO[aspectRatio];
  const escapedLabel = `${info.label} (${aspectRatio})`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${info.width} ${info.height}" role="img" aria-label="${escapedLabel}">
  <defs><linearGradient id="growimo-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#9333ea"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#growimo-gradient)"/>
  <rect x="6%" y="6%" width="88%" height="88%" rx="32" fill="white" fill-opacity=".1" stroke="white" stroke-opacity=".3" stroke-width="4"/>
  <text x="50%" y="46%" text-anchor="middle" font-size="${Math.round(info.width / 6)}">${info.icon}</text>
  <text x="50%" y="59%" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="${Math.round(info.width / 20)}" font-weight="600">${escapedLabel}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
