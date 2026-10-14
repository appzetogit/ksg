import React from 'react'
import { Link } from 'react-router-dom'
import ksgLogo from '../assets/ksg-logo.jpg'
import { COMPANY, SERVICES } from '../constants/brand'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative bg-[#071A47] text-blue-100/80">
      <div className="ksg-tricolor-bar h-1.5 w-full" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <img src={ksgLogo} alt="KSG logo" className="h-14 w-14 rounded-full object-cover ring-2 ring-white/20" />
            <div>
              <p className="text-lg font-extrabold text-white">{COMPANY.name}</p>
              <p className="text-sm text-[#FBBF24]">{COMPANY.hindiTitle} · {COMPANY.tagline}</p>
            </div>
          </div>
          <p className="mt-5 max-w-sm text-sm leading-relaxed">{COMPANY.hindiSub}. One trusted app for every daily need of your family.</p>
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-widest text-white">Services</h4>
          <ul className="mt-4 space-y-2 text-sm">
            {SERVICES.map((s) => (
              <li key={s.key}>
                {s.href ? (
                  <Link to={s.href} className="transition-colors hover:text-[#FF7A00]">{s.title}</Link>
                ) : (
                  <span>{s.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-widest text-white">Company</h4>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link to="/partner" className="transition-colors hover:text-[#FF7A00]">Partner with us</Link></li>
            <li><Link to="/support" className="transition-colors hover:text-[#FF7A00]">Help &amp; support</Link></li>
            <li><Link to="/terms?tab=terms" className="transition-colors hover:text-[#FF7A00]">Terms &amp; conditions</Link></li>
            <li><Link to="/terms?tab=privacy" className="transition-colors hover:text-[#FF7A00]">Privacy policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-6 text-center text-xs sm:px-8">
          © {year} {COMPANY.name}. All rights reserved. Made with ❤️ in India.
        </p>
      </div>
    </footer>
  )
}
