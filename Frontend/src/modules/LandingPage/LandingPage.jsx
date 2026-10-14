import React, { useEffect, useState, lazy, Suspense } from 'react'
import Lenis from 'lenis'
import { MotionConfig, motion, useScroll, useSpring } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import ServiceMarquee from './components/ServiceMarquee'
import api from '../Taxi/shared/api/axiosInstance'
import { COMPANY } from './constants/brand'
import './landing.css'

const Services = lazy(() => import('./components/Services'))
const HowItWorks = lazy(() => import('./components/HowItWorks'))
const WhyUs = lazy(() => import('./components/WhyUs'))
const Partners = lazy(() => import('./components/Partners'))
const FAQ = lazy(() => import('./components/FAQ'))
const AppDownload = lazy(() => import('./components/AppDownload'))
const Footer = lazy(() => import('./components/Footer'))

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 25 })
  return (
    <motion.div
      style={{ scaleX }}
      className="fixed left-0 right-0 top-0 z-[110] h-1 origin-left bg-gradient-to-r from-[#FF7A00] via-[#0B2A6F] to-[#16A34A]"
    />
  )
}

export default function LandingPage() {
  const [landingSettings, setLandingSettings] = useState(null)

  useEffect(() => {
    document.title = `KSG - ${COMPANY.tagline} | ${COMPANY.hindiTitle}`

    let metaDesc = document.querySelector('meta[name="description"]')
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    metaDesc.setAttribute(
      'content',
      `${COMPANY.name}: one app for cab, bike & auto rides, hotel booking, grocery, food & tiffin delivery, medicines, and electricians, plumbers and home services.`
    )

    // Admin-editable FAQs.
    api.get('/common/landing-page/settings')
      .then((res) => { if (res?.success && res?.data) setLandingSettings(res.data) })
      .catch((err) => console.error('Error loading landing page settings:', err))

    // Smooth scrolling on desktop only; it is heavy on low-end phones.
    let lenis = null
    let rafId = null
    if (window.innerWidth >= 768) {
      lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      })
      const raf = (time) => {
        lenis?.raf(time)
        rafId = requestAnimationFrame(raf)
      }
      rafId = requestAnimationFrame(raf)
    }

    return () => {
      if (lenis) lenis.destroy()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="min-h-screen overflow-x-clip bg-white text-slate-900 antialiased"
        style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}
      >
        <ScrollProgress />
        <Navbar />
        <main>
          <Hero />
          <ServiceMarquee />
          <Suspense fallback={null}>
            <Services />
            <HowItWorks />
            <WhyUs />
            <Partners />
            <FAQ settings={landingSettings} />
            <AppDownload />
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </div>
    </MotionConfig>
  )
}
