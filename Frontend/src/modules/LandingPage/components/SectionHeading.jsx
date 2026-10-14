import React from 'react'
import { motion } from 'framer-motion'

export default function SectionHeading({ eyebrow, title, sub, dark = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-2xl text-center"
    >
      <span className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] ${dark ? 'text-[#FBBF24]' : 'text-[#E85D04]'}`}>
        <span className="h-px w-6 bg-current" /> {eyebrow} <span className="h-px w-6 bg-current" />
      </span>
      <h2 className={`mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl ${dark ? 'text-white' : 'text-[#071A47]'}`}>
        {title}
      </h2>
      {sub && (
        <p className={`mt-4 text-base sm:text-lg ${dark ? 'text-blue-100/80' : 'text-slate-600'}`}>{sub}</p>
      )}
    </motion.div>
  )
}
