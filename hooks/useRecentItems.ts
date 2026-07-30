"use client"

import { useState, useEffect, useCallback } from "react"

export interface RecentItem {
  id: string
  label: string
  href: string
  type: "payment" | "escrow" | "dashboard"
  timestamp: number
}

const STORAGE_KEY = "stellarstream-recent-items"
const MAX_ITEMS = 5

export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setItems(JSON.parse(stored))
      }
    } catch {
      // Ignore localStorage errors (e.g. private mode)
    }
  }, [])

  const addItem = useCallback((item: Omit<RecentItem, "timestamp">) => {
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== item.id)
      const newItems = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newItems))
      } catch {
        // Ignore localStorage errors
      }
      return newItems
    })
  }, [])

  const clearItems = useCallback(() => {
    setItems([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore
    }
  }, [])

  return { items, addItem, clearItems }
}