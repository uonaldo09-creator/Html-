import React from 'react';

interface UniMarkProps {
  size?: number;
  className?: string;
}

/**
 * UniInfo seal — a private-press monogram: double hairline ring around an
 * italic serif U, set in the product's own display face. Inherits its colour
 * via currentColor, so it reads gold on obsidian and ink on paper.
 */
export const UniMark: React.FC<UniMarkProps> = ({ size = 34, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <circle cx="24" cy="24" r="22.6" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="24" cy="24" r="18.4" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
    <circle cx="24" cy="8.2" r="1.5" fill="currentColor" />
    <text
      x="24"
      y="34.2"
      textAnchor="middle"
      fontFamily="Newsreader, Georgia, serif"
      fontStyle="italic"
      fontSize="25"
      fill="currentColor"
    >
      U
    </text>
  </svg>
);