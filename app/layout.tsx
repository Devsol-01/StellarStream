import "./globals.css"
import type { Metadata } from "next"
import { Navigation } from "@/components/navigation"

export const metadata: Metadata = {
  title: "StellarStream - Bulk Payment Processing",
  description:
    "Advanced bulk payment processing with recipient grid and bulk-edit tools",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Navigation />
        <main className="animate-fade-in">{children}</main>
      </body>
    </html>
  )
}