"use client"

import { useState, useRef, useEffect } from "react"
import { Clock, FileText, Shield, LayoutDashboard, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRecentItems } from "@/hooks/useRecentItems"

const typeIcons = {
  payment: <FileText className="w-4 h-4" />,
  escrow: <Shield className="w-4 h-4" />,
  dashboard: <LayoutDashboard className="w-4 h-4" />,
}

export function RecentItems() {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { items, clearItems } = useRecentItems()

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
        <Clock className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">Recent</span>
        {items.length > 0 && (
          <span className="ml-1 text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Recent Items
            </span>
            {items.length > 0 && (
              <button
                onClick={clearItems}
                className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                aria-label="Clear recent items"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          {items.length > 0 ? (
            <ul role="menu" className="py-1">
              {items.map((item) => (
                <li key={item.id} role="none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-gray-500">
                      {typeIcons[item.type]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {item.label}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(item.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center">
              <Clock
                className="w-8 h-8 text-gray-300 mx-auto mb-2"
                aria-hidden="true"
              />
              <p className="text-sm text-gray-500">No recent items yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Items you visit will appear here
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}