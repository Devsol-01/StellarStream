"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { useState, useEffect } from "react"
import { Breadcrumbs } from "./Breadcrumbs"
import { NavSearch } from "./NavSearch"
import { QuickActions } from "./QuickActions"
import { RecentItems } from "./RecentItems"
import { useRecentItems } from "@/hooks/useRecentItems"

const navLinks = [
  { href: "/", label: "Payments" },
  { href: "/escrow", label: "Escrow" },
  { href: "/dashboard", label: "Dashboard" },
]

const routeMeta: Record<
  string,
  { label: string; type: "payment" | "escrow" | "dashboard" }
> = {
  "/": { label: "Payments", type: "payment" },
  "/escrow": { label: "Escrow", type: "escrow" },
  "/dashboard": { label: "Dashboard", type: "dashboard" },
}

export function MainNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { addItem } = useRecentItems()

  // Track recent page visits automatically
  useEffect(() => {
    const meta = routeMeta[pathname]
    if (meta) {
      addItem({
        id: pathname,
        label: meta.label,
        href: pathname,
        type: meta.type,
      })
    }
  }, [pathname, addItem])

  return (
    <header className="bg-white border-b border-gray-200">
      <nav
        aria-label="Main navigation"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
      >
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-bold text-primary-600"
            >
              <span className="w-8 h-8 bg-primary-600 text-white rounded-lg flex items-center justify-center text-sm font-bold">
                SS
              </span>
              <span className="hidden sm:inline">StellarStream</span>
            </Link>

            {/* Desktop Nav */}
            <ul
              className="hidden md:flex items-center gap-1"
              role="menubar"
            >
              {navLinks.map((link) => {
                const isActive =
                  pathname === link.href || pathname.startsWith(`${link.href}/`)
                return (
                  <li key={link.href} role="none">
                    <Link
                      href={link.href}
                      role="menuitem"
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? "text-primary-700 bg-primary-50"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Right side actions */}
          <div className="hidden md:flex items-center gap-3">
            <NavSearch />
            <QuickActions />
            <RecentItems />
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 py-3">
            <ul className="space-y-1" role="menu">
              {navLinks.map((link) => {
                const isActive = pathname === link.href
                return (
                  <li key={link.href} role="none">
                    <Link
                      href={link.href}
                      role="menuitem"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block px-3 py-2 rounded-md text-sm font-medium ${
                        isActive
                          ? "text-primary-700 bg-primary-50"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2">
              <div className="px-3">
                <NavSearch />
              </div>
              <div className="flex gap-2 px-3">
                <QuickActions />
                <RecentItems />
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Breadcrumbs />
      </div>
    </header>
  )
}