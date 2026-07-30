"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"
import { useMemo } from "react"

const routeLabels: Record<string, string> = {
  "/": "Home",
  "/escrow": "Escrow",
  "/dashboard": "Dashboard",
}

export function Breadcrumbs() {
  const pathname = usePathname()

  const crumbs = useMemo(() => {
    if (pathname === "/") return [{ label: "Home", href: "/" }]

    const segments = pathname.split("/").filter(Boolean)
    const items = [{ label: "Home", href: "/" }]

    let currentPath = ""
    segments.forEach((segment) => {
      currentPath += `/${segment}`
      const label =
        routeLabels[currentPath] ||
        segment.charAt(0).toUpperCase() + segment.slice(1)
      items.push({ label, href: currentPath })
    })

    return items
  }, [pathname])

  return (
    <nav aria-label="Breadcrumb" className="py-3">
      <ol className="flex items-center gap-2 text-sm text-gray-500">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li key={crumb.href} className="flex items-center gap-2">
              {index > 0 && (
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              )}
              {isLast ? (
                <span
                  className="font-medium text-gray-900 flex items-center gap-1"
                  aria-current="page"
                >
                  {index === 0 ? <Home className="w-4 h-4" /> : crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-gray-900 transition-colors flex items-center gap-1"
                >
                  {index === 0 ? <Home className="w-4 h-4" /> : crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}