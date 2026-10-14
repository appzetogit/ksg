import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, Download } from 'lucide-react'
import ksgLogo from '../assets/ksg-logo.jpg'
import { COMPANY } from '../constants/brand'

const navLinks = [
  { name: 'Services', href: '#services' },
  { name: 'How it works', href: '#how' },
  { name: 'Why KSG', href: '#why' },
  { name: 'Partner with us', href: '#partners' },
  { name: 'FAQs', href: '#faq' },
]

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 30)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (e, target) => {
    e.preventDefault()
    setOpen(false)
    document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const Brand = () => (
    <a href="#top" onClick={(e) => go(e, '#top')} className="flex items-center gap-3 group">
      <motion.img
        src={ksgLogo}
        alt="KSG logo"
        className="h-11 w-11 rounded-full object-cover ring-2 ring-white shadow-md"
        whileHover={{ rotate: 360 }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      />
      <span className="leading-tight">
        <span className="block font-extrabold text-lg tracking-tight text-[#0B2A6F]">
          <span className="text-[#FF7A00]">K</span>S<span className="text-[#16A34A]">G</span>
          <span className="ml-1 text-slate-800 font-bold">Sons</span>
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {COMPANY.tagline}
        </span>
      </span>
    </a>
  )

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 inset-x-0 z-[100] transition-all duration-300 ${
          isScrolled
            ? 'bg-white/85 backdrop-blur-xl shadow-[0_6px_30px_rgba(11,42,111,0.08)]'
            : 'bg-transparent'
        }`}
      >
        <div className="ksg-tricolor-bar h-1 w-full" />
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex h-[72px] items-center justify-between">
            <Brand />

            <nav className="hidden lg:flex items-center gap-8">
              {navLinks.map((l) => (
                <a
                  key={l.name}
                  href={l.href}
                  onClick={(e) => go(e, l.href)}
                  className="relative text-sm font-semibold text-slate-700 hover:text-[#0B2A6F] transition-colors group"
                >
                  {l.name}
                  <span className="absolute -bottom-1.5 left-0 h-0.5 w-0 rounded-full bg-gradient-to-r from-[#FF7A00] to-[#16A34A] transition-all duration-300 group-hover:w-full" />
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <a
                href="#download"
                onClick={(e) => go(e, '#download')}
                className="hidden sm:inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FF7A00] to-[#E85D04] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-transform hover:scale-105 active:scale-95"
              >
                <Download className="h-4 w-4" /> Get the App
              </a>
              <button
                onClick={() => setOpen(true)}
                aria-label="Open menu"
                className="lg:hidden rounded-xl p-2 text-slate-800 hover:bg-slate-100"
              >
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[101] bg-[#071A47]/40 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 z-[102] flex w-[85%] max-w-xs flex-col bg-white p-6 shadow-2xl lg:hidden"
            >
              <div className="mb-10 flex items-center justify-between">
                <Brand />
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-xl p-2 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {navLinks.map((l, i) => (
                  <motion.a
                    key={l.name}
                    href={l.href}
                    onClick={(e) => go(e, l.href)}
                    initial={{ x: 30, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.05 * i + 0.1 }}
                    className="rounded-xl px-3 py-3 text-lg font-bold text-slate-800 hover:bg-orange-50 hover:text-[#E85D04]"
                  >
                    {l.name}
                  </motion.a>
                ))}
              </div>
              <a
                href="#download"
                onClick={(e) => go(e, '#download')}
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#FF7A00] to-[#E85D04] px-5 py-3 font-bold text-white"
              >
                <Download className="h-4 w-4" /> Get the App
              </a>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
