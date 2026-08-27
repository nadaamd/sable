/**
 * Three sealed fields and one cleared.
 *
 * The same glyph as the favicon, so a tab, the landing page and the terminal all identify each
 * other. Shared rather than duplicated because it now appears in two places.
 */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="4" y="5" width="15" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="4" y="13.75" width="21" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="4" y="22.5" width="10" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="16" y="22.5" width="8" height="4.5" rx="1" fill="var(--accent)" />
    </svg>
  )
}
