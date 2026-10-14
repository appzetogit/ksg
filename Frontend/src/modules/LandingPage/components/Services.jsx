import React from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { ArrowUpRight, Smartphone } from 'lucide-react'
import { SERVICES } from '../constants/brand'
import SectionHeading from './SectionHeading'

function ServiceCard({ s, i }) {
  const Icon = s.icon
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 200, damping: 18 })
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 200, damping: 18 })

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => { mx.set(0); my.set(0) }

  const action = s.href ? (
    <Link
      to={s.href}
      className="inline-flex items-center gap-1.5 text-sm font-bold"
      style={{ color: s.to }}
    >
      {s.cta} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500">
      <Smartphone className="h-4 w-4" /> Available in the app
    </span>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: (i % 3) * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{ perspective: 900 }}
    >
      <motion.article
        onMouseMove={onMove}
        onMouseLeave={reset}
        style={{ rotateX: rx, rotateY: ry }}
        className="group relative h-full overflow-hidden rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_10px_40px_rgba(11,42,111,0.07)] transition-shadow duration-300 hover:shadow-[0_25px_60px_rgba(11,42,111,0.16)]"
      >
        {/* Colour wash that grows from the corner on hover */}
        <div
          className="absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-15 transition-transform duration-500 group-hover:scale-[3.2]"
          style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
        />
        <div className="relative">
          <motion.span
            whileHover={{ rotate: [0, -12, 12, -6, 0] }}
            transition={{ duration: 0.6 }}
            className="grid h-16 w-16 place-items-center rounded-2xl text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})`, boxShadow: `0 12px 30px ${s.from}55` }}
          >
            <Icon className="h-8 w-8" strokeWidth={2} />
          </motion.span>
          <span className="absolute right-0 top-0 text-5xl font-black text-slate-100 transition-colors group-hover:text-white/60">
            0{i + 1}
          </span>
          <h3 className="mt-6 text-xl font-extrabold text-[#071A47]">{s.title}</h3>
          <p className="mt-2 leading-relaxed text-slate-600">{s.desc}</p>
          <div className="mt-6">{action}</div>
        </div>
      </motion.article>
    </motion.div>
  )
}

export default function Services() {
  return (
    <section id="services" className="relative scroll-mt-20 bg-gradient-to-b from-white to-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <SectionHeading
          eyebrow="Our services"
          title={<>Everything you need, <span className="ksg-shimmer-text whitespace-nowrap">one app</span></>}
          sub="From your morning commute to dinner at home, KSG takes care of every daily need."
        />
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s, i) => <ServiceCard key={s.key} s={s} i={i} />)}
        </div>
      </div>
    </section>
  )
}
