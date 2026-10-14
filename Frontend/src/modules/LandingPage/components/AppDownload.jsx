import React from 'react'
import { motion } from 'framer-motion'
import ksgLogo from '../assets/ksg-logo.jpg'
import { COMPANY, PLAY_STORE_URL, APP_STORE_URL } from '../constants/brand'

function StoreBadge({ href, img, alt }) {
  const badge = <img src={img} alt={alt} className="h-12 w-auto" />
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-105">
        {badge}
      </a>
    )
  }
  return (
    <span className="relative inline-block opacity-90" title="Coming soon">
      {badge}
      <span className="absolute -right-2 -top-2 rounded-full bg-[#FBBF24] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#071A47] shadow">
        Soon
      </span>
    </span>
  )
}

export default function AppDownload() {
  return (
    <section id="download" className="relative scroll-mt-20 overflow-hidden bg-white px-4 py-16 sm:px-8 sm:py-24">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 40 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-auto grid max-w-6xl items-center gap-10 overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#FF7A00] via-[#E85D04] to-[#C2410C] p-8 text-white shadow-[0_40px_100px_rgba(232,93,4,0.35)] sm:p-14 lg:grid-cols-[1.3fr_1fr]"
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-[#16A34A]/30 blur-3xl" />

        <div className="relative text-center lg:text-left">
          <p className="text-3xl font-extrabold sm:text-5xl">{COMPANY.hindiTitle}</p>
          <p className="mt-2 text-lg font-semibold text-white/90 sm:text-2xl">{COMPANY.hindiSub}</p>
          <p className="mx-auto mt-5 max-w-lg text-white/85 lg:mx-0">
            Download the KSG app and get rides, food, groceries, medicines, hotels and home services in a few taps.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4 lg:justify-start">
            <StoreBadge
              href={PLAY_STORE_URL}
              img="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
              alt="Get it on Google Play"
            />
            <StoreBadge
              href={APP_STORE_URL}
              img="https://upload.wikimedia.org/wikipedia/commons/3/3c/Download_on_the_App_Store_Badge.svg"
              alt="Download on the App Store"
            />
          </div>
        </div>

        <div className="relative mx-auto">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
            className="absolute -inset-4 rounded-full border-2 border-dashed border-white/40"
          />
          <motion.img
            src={ksgLogo}
            alt="KSG app"
            className="ksg-float relative h-56 w-56 rounded-full object-cover shadow-2xl ring-8 ring-white/30 sm:h-72 sm:w-72"
            whileHover={{ scale: 1.05, rotate: -4 }}
          />
        </div>
      </motion.div>
    </section>
  )
}
