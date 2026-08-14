import { render, screen, fireEvent } from "@testing-library/react"
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs"
import { NavSearch } from "@/components/navigation/NavSearch"
import { QuickActions } from "@/components/navigation/QuickActions"

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}))

import { usePathname } from "next/navigation"

describe("Navigation Components", () => {
  describe("Breadcrumbs", () => {
    it("renders home crumb on root path", () => {
      ;(usePathname as jest.Mock).mockReturnValue("/")
      render(<Breadcrumbs />)
      expect(screen.getByText("Home")).toBeInTheDocument()
    })

    it("renders nested crumbs for escrow path", () => {
      ;(usePathname as jest.Mock).mockReturnValue("/escrow")
      render(<Breadcrumbs />)
      expect(screen.getByText("Home")).toBeInTheDocument()
      expect(screen.getByText("Escrow")).toBeInTheDocument()
    })
  })

  describe("NavSearch", () => {
    it("renders search input", () => {
      render(<NavSearch />)
      expect(screen.getByLabelText("Search navigation")).toBeInTheDocument()
    })

    it("shows results when typing", () => {
      render(<NavSearch />)
      const input = screen.getByLabelText("Search navigation")
      fireEvent.change(input, { target: { value: "pay" } })
      expect(screen.getByText("Payments")).toBeInTheDocument()
    })
  })

  describe("QuickActions", () => {
    it("renders quick actions button", () => {
      render(<QuickActions />)
      expect(screen.getByText("Quick Actions")).toBeInTheDocument()
    })

    it("opens dropdown on click", () => {
      render(<QuickActions />)
      fireEvent.click(screen.getByText("Quick Actions"))
      expect(screen.getByText("New Payment")).toBeInTheDocument()
      expect(screen.getByText("Create Escrow")).toBeInTheDocument()
    })
  })
})