import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import React from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFallbackLogo(name: string): string {
  const cleanName = name.replace(/University|Institute|School|of|and|for/gi, '').trim();
  const words = cleanName.split(/\s+/).filter(w => w.length > 0);
  let initials = '';
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1 && words[0].length >= 2) {
    initials = words[0].substring(0, 2).toUpperCase();
  } else {
    initials = name.substring(0, 2).toUpperCase();
  }

  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = initials.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    ['#4f46e5', '#6366f1'], // indigo
    ['#7c3aed', '#a855f7'], // violet
    ['#2563eb', '#3b82f6'], // blue
    ['#059669', '#10b981'], // emerald
    ['#db2777', '#f43f5e'], // pink/rose
    ['#ea580c', '#f97316'], // orange
    ['#0d9488', '#14b8a6'], // teal
    ['#b45309', '#d97706'], // amber
  ];
  const colorPair = colors[Math.abs(hash) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="grad-${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colorPair[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colorPair[1]};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="24" fill="url(#grad-${hash})" />
    <text x="50" y="55" fill="#161209" font-family="'Inter', system-ui, sans-serif" font-weight="800" font-size="38" text-anchor="middle" dominant-baseline="middle" letter-spacing="-1">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getSafeLogo(name: string, logo: string | null | undefined): string {
  return !logo || logo.includes('logo.clearbit.com') ? getFallbackLogo(name) : logo;
}

export function handleLogoError(e: React.SyntheticEvent<HTMLImageElement, Event> | any, name: string): void {
  const img = e.currentTarget;
  if (img) {
    img.onerror = null;
    img.src = getFallbackLogo(name);
  }
}

export function getUniversityIdentity(university: {
  id?: number;
  name: string;
  website?: string | null;
}): string {
  if (typeof university.id === 'number' && Number.isFinite(university.id)) {
    return `id:${university.id}`;
  }

  const website = university.website?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (website) return `website:${website}`;

  return `name:${university.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function deduplicateUniversities<T extends { id?: number; name: string; website?: string | null }>(
  universities: T[],
): T[] {
  const seen = new Set<string>();
  return universities.filter((university) => {
    const website = university.website?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const name = university.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const keys = [
      getUniversityIdentity(university),
      website && `website:${website}`,
      `name:${name}`,
    ].filter(Boolean) as string[];
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}