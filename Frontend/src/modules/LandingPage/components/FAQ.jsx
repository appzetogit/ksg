import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'
import SectionHeading from './SectionHeading'

const defaultFaqs = [
  {
    question: 'What can I do with the KSG app?',
    answer: 'Book a cab, bike or auto, reserve hotels, order groceries, food and tiffin, get medicines delivered, and book electricians, plumbers and other professionals, all from one app.',
  },
  {
    question: 'Which cities is KSG available in?',
    answer: 'We are expanding city by city. Open the app and enter your location to see which services are live near you.',
  },
  {
    question: 'How do I become a driver or delivery partner?',
    answer: 'Tap "Register as captain" in the Partner section above, upload your licence and vehicle documents, and our team will verify and activate your account.',
  },
  {
    question: 'I own a restaurant, grocery or medical store. How do I join?',
    answer: 'Tap "Become a partner", choose your business type and submit your details. Once approved you can manage orders from your partner dashboard.',
  },
  {
    question: 'Are payments safe?',
    answer: 'Yes. Online payments go through a secure payment gateway with UPI, cards and wallets, and cash is supported where available.',
  },
]

export default function FAQ({ settings }) {
  const [openIdx, setOpenIdx] = useState(0)
  const faqs = settings?.faqs?.length ? settings.faqs : defaultFaqs

  return (
    <section id="faq" className="relative scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-8">
        <SectionHeading eyebrow="FAQs" title="Questions? Answered." />
        <div className="mt-12 space-y-4">
          {faqs.map((f, i) => {
            const open = openIdx === i
            return (
              <motion.div
                key={f.question}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className={`overflow-hidden rounded-2xl border transition-colors ${open ? 'border-orange-200 bg-orange-50/50 shadow-lg shadow-orange-500/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <button
                  onClick={() => setOpenIdx(open ? null : i)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="font-bold text-[#071A47] sm:text-lg">{f.question}</span>
                  <motion.span
                    animate={{ rotate: open ? 45 : 0 }}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${open ? 'bg-[#FF7A00] text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    <Plus className="h-4 w-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="px-6 pb-6 leading-relaxed text-slate-600">{f.answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
