import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bike, Store, Wrench, ArrowRight } from 'lucide-react'
import SectionHeading from './SectionHeading'

const PARTNERS = [
  {
    icon: Bike,
    title: 'Drive with KSG',
    desc: 'Cab, bike or auto: earn on your own schedule with weekly payouts.',
    cta: 'Register as captain',
    to: '/taxi/signup',
    from: '#2563EB', to2: '#1E3A8A',
  },
  {
    icon: Store,
    title: 'Sell with KSG',
    desc: 'Restaurants, grocery stores and medical stores: reach more customers nearby.',
    cta: 'Become a partner',
    to: '/partner',
    from: '#FF7A00', to2: '#E85D04',
  },
  {
    icon: Wrench,
    title: 'Work with KSG',
    desc: 'Electricians, plumbers and skilled professionals: get jobs near you.',
    cta: 'Join via the app',
    from: '#16A34A', to2: '#0F7A36',
  },
]

export default function Partners() {
  return (
    <section id="partners" className="relative scroll-mt-20 bg-gradient-to-b from-slate-50 to-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <SectionHeading
          eyebrow="Partner with us"
          title={<>Grow with <span className="ksg-shimmer-text">KSG</span></>}
          sub="Build your livelihood on one trusted platform, with steady work and fair earnings."
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {PARTNERS.map(({ icon: Icon, title, desc, cta, to, from, to2 }, i) => {
            const Btn = to ? Link : 'a'
            const btnProps = to
              ? { to }
              : { href: '#download', onClick: (e) => { e.preventDefault(); document.querySelector('#download')?.scrollIntoView({ behavior: 'smooth' }) } }
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 50, rotate: i === 1 ? 0 : i === 0 ? -3 : 3 }}
                whileInView={{ opacity: 1, y: 0, rotate: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.15, type: 'spring', stiffness: 70, damping: 14 }}
                whileHover={{ y: -10 }}
                className="relative overflow-hidden rounded-3xl p-8 text-white shadow-2xl"
                style={{ background: `linear-gradient(145deg, ${from}, ${to2})`, boxShadow: `0 25px 60px ${from}40` }}
              >
                <Icon className="absolute -bottom-6 -right-6 h-40 w-40 opacity-10" />
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur">
                  <Icon className="h-7 w-7" />
                </span>
                <h3 className="mt-6 text-2xl font-extrabold">{title}</h3>
                <p className="mt-2 text-white/85">{desc}</p>
                <Btn
                  {...btnProps}
                  className="group mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold shadow-lg transition-transform hover:scale-105"
                  style={{ color: to2 }}
                >
                  {cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Btn>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
