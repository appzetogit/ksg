import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { ArrowRight, ShieldCheck, Clock, MapPin, Sparkles } from 'lucide-react'
import ksgLogo from '../assets/ksg-logo.jpg'
import { COMPANY, SERVICES } from '../constants/brand'

// Fixed (not random) so server and client renders agree and the layout is stable.
const PARTICLES = [
  { left: '6%', size: 6, dur: 14, delay: 0, color: '#FF7A00' },
  { left: '14%', size: 4, dur: 18, delay: 3, color: '#16A34A' },
  { left: '27%', size: 5, dur: 16, delay: 6, color: '#0B2A6F' },
  { left: '41%', size: 3, dur: 20, delay: 2, color: '#FF7A00' },
  { left: '55%', size: 6, dur: 15, delay: 8, color: '#16A34A' },
  { left: '68%', size: 4, dur: 19, delay: 4, color: '#FF7A00' },
  { left: '79%', size: 5, dur: 17, delay: 10, color: '#0B2A6F' },
  { left: '91%', size: 4, dur: 21, delay: 1, color: '#16A34A' },
]

function OrbitLogo() {
  // Gentle 3D tilt that follows the pointer.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 120, damping: 15 })
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), { stiffness: 120, damping: 15 })

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onLeave = () => { mx.set(0); my.set(0) }

  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, rotate: -30 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 60, damping: 14, delay: 0.2 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ perspective: 1000 }}
      className="relative mx-auto aspect-square w-[min(88vw,330px)] sm:w-[440px] lg:w-[500px]"
    >
      {/* Glow */}
      <div className="absolute inset-[12%] rounded-full bg-gradient-to-br from-[#FF7A00]/40 via-white/0 to-[#16A34A]/40 blur-3xl" />

      {/* Decorative rings */}
      <svg className="ksg-ring-dash absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="48.5" fill="none" stroke="#0B2A6F" strokeOpacity="0.18" strokeWidth="0.4" strokeDasharray="1.5 2.5" />
      </svg>
      <svg className="ksg-ring-dash-rev absolute inset-[7%] h-[86%] w-[86%]" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="49" fill="none" stroke="url(#ksgRing)" strokeWidth="0.8" strokeDasharray="30 8 12 8" strokeLinecap="round" />
        <defs>
          <linearGradient id="ksgRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF7A00" />
            <stop offset="0.5" stopColor="#0B2A6F" />
            <stop offset="1" stopColor="#16A34A" />
          </linearGradient>
        </defs>
      </svg>

      {/* Centre logo with tilt */}
      <motion.div style={{ rotateX: rx, rotateY: ry }} className="absolute inset-[19%]">
        <div className="ksg-float relative h-full w-full">
          <div className="ksg-pulse absolute inset-0 rounded-full text-[#FF7A00]/60" />
          <img
            src={ksgLogo}
            alt={`${COMPANY.name} — ${COMPANY.tagline}`}
            className="relative h-full w-full rounded-full object-cover shadow-[0_30px_80px_rgba(11,42,111,0.35)] ring-4 ring-white"
          />
        </div>
      </motion.div>

      {/* Orbiting service badges */}
      <div className="ksg-orbit absolute inset-0">
        {SERVICES.map((s, i) => {
          const angle = (i / SERVICES.length) * Math.PI * 2 - Math.PI / 2
          const left = 50 + 46 * Math.cos(angle)
          const top = 50 + 46 * Math.sin(angle)
          const Icon = s.icon
          return (
            <div
              key={s.key}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <div className="ksg-orbit-item">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.8 + i * 0.12, type: 'spring', stiffness: 200, damping: 12 }}
                  whileHover={{ scale: 1.2 }}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className="grid h-11 w-11 sm:h-14 sm:w-14 place-items-center rounded-2xl text-white shadow-xl ring-4 ring-white"
                    style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
                  >
                    <Icon className="h-5 w-5 sm:h-7 sm:w-7" strokeWidth={2.2} />
                  </span>
                  <span className="hidden sm:block whitespace-nowrap rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-bold text-slate-800 shadow">
                    {s.short}
                  </span>
                </motion.div>
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

export default function Hero() {
  const [wordIdx, setWordIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setWordIdx((i) => (i + 1) % SERVICES.length), 2200)
    return () => clearInterval(t)
  }, [])

  const current = SERVICES[wordIdx]

  const fadeUp = {
    hidden: { y: 30, opacity: 0 },
    show: (i = 0) => ({ y: 0, opacity: 1, transition: { delay: 0.15 + i * 0.12, type: 'spring', stiffness: 70, damping: 16 } }),
  }

  const scrollTo = (id) => document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <section
      id="top"
      className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-[#F0FDF4] pt-28 pb-20 sm:pt-32 lg:min-h-screen lg:pb-24"
    >
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="ksg-blob absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-[#FF7A00]/20 blur-[100px]" />
        <div className="ksg-blob absolute top-1/3 -right-32 h-[460px] w-[460px] rounded-full bg-[#16A34A]/20 blur-[110px]" style={{ animationDelay: '-6s' }} />
        <div className="ksg-blob absolute -bottom-40 left-1/3 h-[380px] w-[380px] rounded-full bg-[#0B2A6F]/15 blur-[100px]" style={{ animationDelay: '-12s' }} />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: 'radial-gradient(rgba(11,42,111,0.12) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          }}
        />
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="ksg-particle absolute bottom-0 rounded-full"
            style={{ left: p.left, width: p.size, height: p.size, background: p.color, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
        {/* Copy */}
        <motion.div initial="hidden" animate="show" className="text-center lg:text-left">
          <motion.span
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[#E85D04] shadow-sm backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" /> {COMPANY.tagline}
          </motion.span>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="mt-6 text-[2.6rem] font-extrabold leading-[1.08] tracking-tight text-[#071A47] sm:text-6xl lg:text-[4.1rem]"
          >
            <span className="ksg-shimmer-text">{COMPANY.hindiTitle}</span>
            <br />
            for every{' '}
            {/* Own fixed-height line so swapping words never reflows the hero. */}
            <span className="relative block h-[1.3em] overflow-hidden whitespace-nowrap">
              <AnimatePresence mode="wait">
                <motion.span
                  key={current.key}
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '-100%', opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-x-0 top-0 bg-clip-text leading-[1.25] text-transparent"
                  style={{ backgroundImage: `linear-gradient(90deg, ${current.from}, ${current.to})` }}
                >
                  {current.word}.
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="mt-4 text-xl font-bold text-[#E85D04] sm:text-2xl">
            {COMPANY.hindiSub}
          </motion.p>

          <motion.p variants={fadeUp} custom={3} className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0">
            Rides, hotels, groceries, food &amp; tiffin, medicines and trusted home services,
            all from one app by <span className="font-semibold text-[#0B2A6F]">{COMPANY.name}</span>.
          </motion.p>

          <motion.div variants={fadeUp} custom={4} className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <button
              onClick={() => scrollTo('#services')}
              className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-[#FF7A00] to-[#E85D04] px-8 py-4 text-base font-bold text-white shadow-xl shadow-orange-500/30 transition-transform hover:scale-[1.03] active:scale-95 sm:w-auto"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              Explore services
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </button>
            <button
              onClick={() => scrollTo('#download')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[#0B2A6F] bg-white px-8 py-[14px] text-base font-bold text-[#0B2A6F] transition-colors hover:bg-[#0B2A6F] hover:text-white sm:w-auto"
            >
              Download the app
            </button>
          </motion.div>

          <motion.ul variants={fadeUp} custom={5} className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-semibold text-slate-600 lg:justify-start">
            {[
              { icon: ShieldCheck, text: 'Verified partners', color: '#16A34A' },
              { icon: MapPin, text: 'Live tracking', color: '#FF7A00' },
              { icon: Clock, text: '24×7 support', color: '#0B2A6F' },
            ].map(({ icon: Icon, text, color }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon className="h-5 w-5" style={{ color }} /> {text}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Visual */}
        <OrbitLogo />
      </div>

      {/* Wave into next section */}
      <svg className="absolute -bottom-px left-0 h-14 w-full sm:h-20" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden>
        <path d="M0,48 C320,90 720,0 1080,40 C1260,60 1380,52 1440,44 L1440,80 L0,80 Z" fill="#0B2A6F" />
      </svg>
    </section>
  )
}
