"use client"

import { useState, useRef, useEffect } from "react"
import { Plus, Download, Shield, ChevronDown, Zap } from "lucide-react"
import Link from "next/link"

interface QuickAction {
  label: string
  href: string
  icon: React.ReactNode
  description: string
}

const actions: QuickAction[] = [
  {
    label: "New Payment",
    href: "/",
    icon: <Plus className="w-4 h-4" />,
    description: "Start a bulk payment",
  },
  {
    label: "Create Escrow",
    href: "/escrow",
    icon: <Shield className="w-4 h-4" />,
    description: "Set up a new escrow",
  },
  {
    label: "Export CSV",
    href: "/dashboard",
    icon: <Download className="w-4 h-4" />,
    description: "Download reports",
  },
]

export function QuickActions() {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false)
    }
    if (isOpen) {
      window.addEventListener("keydown", handleEscape)
      return () => window.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Zap className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">Quick Actions</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Actions
          </div>
          <ul role="menu">
            {actions.map((action) => (
              <li key={action.label} role="none">
                <Link
                  href={action.href}
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <span className="mt-0.5 text-gray-500">{action.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {action.label}
                    </div>
                    <div className="text-xs text-gray-500">
                      {action.description}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}