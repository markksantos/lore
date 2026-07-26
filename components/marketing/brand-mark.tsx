/**
 * The Lore mark: three stacked, progressively-offset leaves — pages in a book,
 * layers in a vault, entries in an index. Drawn in currentColor so it inherits
 * whatever surface it sits on and needs no light/dark variant.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 6.5C4 5.4 4.9 4.5 6 4.5h5.2c.5 0 .8.4.8.8v3.4H6c-1.1 0-2-.9-2-2Z"
        fill="currentColor"
        opacity="0.35"
      />
      <path
        d="M4 12c0-1.1.9-2 2-2h8.2c.5 0 .8.4.8.8v3.4H6c-1.1 0-2-.9-2-2Z"
        fill="currentColor"
        opacity="0.65"
      />
      <path
        d="M4 17.5c0-1.1.9-2 2-2h11.2c.5 0 .8.4.8.8v3.4H6c-1.1 0-2-.9-2-2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="inline-flex items-center gap-2">
        <BrandMark size={20} />
        <span className="text-[17px] font-semibold tracking-[-0.03em]">Lore</span>
      </span>
    </span>
  );
}
