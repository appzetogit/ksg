import React from 'react'
import { SERVICES, COMPANY } from '../constants/brand'

export default function ServiceMarquee() {
  // Two identical halves so the -50% translate loops seamlessly.
  const items = [...SERVICES, ...SERVICES]

  return (
    <div className="ksg-marquee-wrap relative overflow-hidden bg-[#0B2A6F] py-5">
      <div className="ksg-marquee flex w-max items-center gap-10">
        {items.map((s, i) => {
          const Icon = s.icon
          return (
            <React.Fragment key={`${s.key}-${i}`}>
              <span className="flex items-center gap-3 whitespace-nowrap text-lg font-bold text-white sm:text-xl">
                <span
                  className="grid h-9 w-9 place-items-center rounded-xl"
                  style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {s.title}
              </span>
              <span className="whitespace-nowrap text-lg font-extrabold text-[#FBBF24]" aria-hidden>
                {i % 2 === 0 ? '✦' : COMPANY.hindiTitle}
              </span>
            </React.Fragment>
          )
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#0B2A6F] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#0B2A6F] to-transparent" />
    </div>
  )
}
