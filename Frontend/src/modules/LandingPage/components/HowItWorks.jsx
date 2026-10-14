import React from 'react'
import { motion } from 'framer-motion'
import { Smartphone, LayoutGrid, PartyPopper } from 'lucide-react'
import SectionHeading from './SectionHeading'

const STEPS = [
  { icon: Smartphone, title: 'Download the app', desc: 'Install KSG and sign in with your mobile number in seconds.', color: '#FF7A00' },
  { icon: LayoutGrid, title: 'Pick a service', desc: 'Ride, hotel, grocery, food, medicine or a home professional.', color: '#0B2A6F' },
  { icon: PartyPopper, title: 'Relax, we deliver', desc: 'Track it live and pay the way you like. Done.', color: '#16A34A' },
]

export default function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-20 overflow-hidden bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <SectionHeading eyebrow="How it works" title="Three taps. That's it." />

        <div className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          {/* Connecting line that draws itself in */}
          <svg className="absolute left-[16%] right-[16%] top-10 hidden h-4 w-[68%] md:block" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden>
            <motion.path
              d="M0 2 H100"
              stroke="url(#ksgStepLine)"
              strokeWidth="0.6"
              strokeDasharray="2 1.5"
              fill="none"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.6, ease: 'easeInOut', delay: 0.3 }}
            />
            <defs>
              <linearGradient id="ksgStepLine" x1="0" x2="1">
                <stop offset="0" stopColor="#FF7A00" />
                <stop offset="0.5" stopColor="#0B2A6F" />
                <stop offset="1" stopColor="#16A34A" />
              </linearGradient>
            </defs>
          </svg>

          {STEPS.map(({ icon: Icon, title, desc, color }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: 0.2 + i * 0.35, type: 'spring', stiffness: 80, damping: 15 }}
              className="relative text-center"
            >
              <div className="relative mx-auto h-20 w-20">
                <span className="ksg-pulse absolute inset-0 rounded-full" style={{ color: `${color}66` }} />
                <span
                  className="relative grid h-20 w-20 place-items-center rounded-full text-white shadow-xl"
                  style={{ background: color, boxShadow: `0 15px 35px ${color}55` }}
                >
                  <Icon className="h-9 w-9" />
                </span>
                <span className="absolute -right-1 -top-1 grid h-8 w-8 place-items-center rounded-full bg-white text-sm font-black shadow-md" style={{ color }}>
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-6 text-xl font-extrabold text-[#071A47]">{title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-slate-600">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
