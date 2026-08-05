"use client"

import type { ReactNode } from "react"

/**
 * A labelled band grouping panels that belong together.
 *
 * The page was a flat stack of panels at identical visual weight, so nothing said which
 * controls acted on which data, or in what order to read them. These bands impose the
 * market's own narrative: what became public, what stayed sealed, how the desks negotiated
 * before committing, and the rules they all played under.
 */
export function Section({
  label,
  aside,
  children,
}: {
  label: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="panel-label whitespace-nowrap">{label}</h2>
        <span className="h-px min-w-6 flex-1 bg-[var(--line)]" aria-hidden />
        {aside}
      </div>
      {children}
    </section>
  )
}
