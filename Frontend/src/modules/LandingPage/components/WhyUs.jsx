import React, { useEffect, useRef } from 'react'
import { motion, useInView, animate } from 'framer-motion'
import { ShieldCheck, IndianRupee, MapPinned, Headphones, BadgeCheck, Zap } from 'lucide-react'
import SectionHeading from './SectionHeading'

const REASONS = [
  { icon: ShieldCheck, title: 'Trusted & verified', desc: 'Every captain, store and professional is verified before they join.' },
  { icon: IndianRupee, title: 'Honest pricing', desc: 'Clear prices up front. No hidden charges, ever.' },
  { icon: MapPinned, title: 'Live tracking', desc: 'Follow your ride, order or professional in real time.' },
  { icon: Zap, title: 'Fast service', desc: 'Quick pickups and quick deliveries across your city.' },
  { icon: Headphones, title: 'Always here', desc: 'Real people ready to help you around the clock.' },
  { icon: BadgeCheck, title: 'Made for Bharat', desc: 'Built in India, for every Indian household.' },
]

function Counter({ to, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })

  useEffect(() => {
    if (!inView || !ref.current) return
    const controls = animate(0, to, {
      duration: 1.6,
      ease: 'easeOut',
      onUpdate: (v) => { if (ref.current) ref.current.textContent = `${Math.round(v)}${suffix}` },
    })
    return () => controls.stop()
  }, [inView, to, suffix])

  return <span ref={ref}>0{suffix}</span>
}

const STATS = [
  { value: 6, suffix: '+', label: 'Services' },
  { value: 1, suffix: '', label: 'App for everything' },
  { value: 24, suffix: '×7', label: 'Support' },
]

export default function WhyUs() {
  return (
    <section id="why" className="relative scroll-mt-20 overflow-hidden bg-[#071A47] py-20 text-white sm:py-28">
      {/* Slow-turning chakra watermark */}
      <svg className="ksg-ring-dash pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] opacity-[0.07]" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="white" strokeWidth="2" />
        <circle cx="50" cy="50" r="6" fill="white" />
        {Array.from({ length: 24 }).map((_, i) => (
          <line key={i} x1="50" y1="50" x2="50" y2="6" stroke="white" strokeWidth="0.9" transform={`rotate(${i * 15} 50 50)`} />
        ))}
      </svg>
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-[#FF7A00]/25 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-[#16A34A]/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-8">
        <SectionHeading dark eyebrow="Why KSG" title={<>Built on <span className="text-[#FBBF24]">trust</span>. Driven by service.</>} />

        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15, type: 'spring', stiffness: 120 }}
              className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center backdrop-blur sm:p-6"
            >
              <div className="text-3xl font-black text-[#FBBF24] sm:text-5xl">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-1 text-xs font-semibold text-blue-100/80 sm:text-sm">{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: i % 2 ? 40 : -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: (i % 3) * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -6 }}
              className="group flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-colors hover:border-[#FF7A00]/50 hover:bg-white/[0.08]"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E85D04] shadow-lg shadow-orange-500/20 transition-transform group-hover:rotate-6 group-hover:scale-110">
                <Icon className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-blue-100/75">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
