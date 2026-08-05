"use client"

import type { ReactNode } from "react"

/**
 * A labelled band grouping panels that belong together.
 *
 * The page was a flat stack of panels at identical visual weight, so nothing said which
 * controls acted on which data, or in what order to read them. These bands impose the
 * market's own narrative: what stayed sealed, how the desks negotiated before committing,
 * and the rules they all played under.
 *
 * The heading is set at a readable size in sentence case rather than as a tiny tracked
 * uppercase kicker. A section title is a heading and should look like one.
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
        <h2 className="whitespace-nowrap text-[15px] text-[var(--ink)]">{label}</h2>
        <span className="h-px min-w-6 flex-1 bg-[var(--line)]" aria-hidden />
        {aside}
      </div>
      {children}
    </section>
  )
}
