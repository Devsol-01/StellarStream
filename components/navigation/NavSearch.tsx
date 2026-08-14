"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Search, X, FileText, LayoutDashboard, Shield } from "lucide-react"

interface SearchResult {
  label: string
  href: string
  icon: React.ReactNode
  description: string
}

const searchData: SearchResult[] = [
  {
    label: "Payments",
    href: "/",
    icon: <FileText className="w-4 h-4" />,
    description: "Bulk payment processing",
  },
  {
    label: "Escrow",
    href: "/escrow",
    icon: <Shield className="w-4 h-4" />,
    description: "Manage escrow contracts",
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard className="w-4 h-4" />,
    description: "Analytics and overview",
  },
]

export function NavSearch() {
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const results = searchData.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
      if (e.key === "Escape") {
        setIsOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleSelect = (href: string) => {
    router.push(href)
    setQuery("")
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          className="w-56 lg:w-64 pl-9 pr-16 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          aria-label="Search navigation"
          aria-expanded={isOpen}
          aria-controls="search-results"
          role="combobox"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
            className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 border border-gray-200 rounded px-1 py-0.5 font-sans">
          Ctrl K
        </kbd>
      </div>

      {isOpen && (
        <div
          id="search-results"
          className="absolute top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50"
          role="listbox"
        >
          {results.length > 0 ? (
            <ul className="py-2">
              {results.map((result) => (
                <li key={result.href}>
                  <button
                    onClick={() => handleSelect(result.href)}
                    className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left"
                    role="option"
                    aria-selected="false"
                  >
                    <span className="mt-0.5 text-gray-500">{result.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {result.label}
                      </div>
                      <div className="text-xs text-gray-500">
                        {result.description}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}