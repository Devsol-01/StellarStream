"use client"

import React, { useRef, useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/hooks/useReducedMotion"

type AnimationType =
    | "fade-in"
    | "fade-in-up"
    | "fade-in-down"
    | "fade-in-left"
    | "fade-in-right"
    | "scale-in"
    | "slide-up"
    | "slide-down"

interface AnimatedContainerProps {
    children: React.ReactNode
    /** Animation type to apply */
    animation?: AnimationType
    /** Delay in ms before animation starts */
    delay?: number
    /** Animation duration in ms */
    duration?: number
    /** Threshold for IntersectionObserver (0-1) */
    threshold?: number
    /** Additional CSS classes */
    className?: string
    /** Whether to animate only once (default: true) */
    once?: boolean
    /** Tag to render as container */
    as?: keyof JSX.IntrinsicElements
    /** Force animation regardless of reduced motion */
    force?: boolean
}

const animationClasses: Record<AnimationType, string> = {
    "fade-in": "animate-fade-in",
    "fade-in-up": "animate-fade-in-up",
    "fade-in-down": "animate-fade-in-down",
    "fade-in-left": "animate-fade-in-left",
    "fade-in-right": "animate-fade-in-right",
    "scale-in": "animate-scale-in",
    "slide-up": "animate-slide-up",
    "slide-down": "animate-slide-down",
}

/**
 * AnimatedContainer - Wraps children with IntersectionObserver-based
 * entrance animations. Respects user's reduced motion preference.
 */
export function AnimatedContainer({
    children,
    animation = "fade-in-up",
    delay = 0,
    duration = 400,
    threshold = 0.1,
    className,
    once = true,
    as: Tag = "div",
    force = false,
}: AnimatedContainerProps) {
    const ref = useRef<HTMLDivElement>(null)
    const [isVisible, setIsVisible] = useState(false)
    const prefersReducedMotion = useReducedMotion()

    const shouldAnimate = force || !prefersReducedMotion

    const handleIntersection = useCallback(
        (entries: IntersectionObserverEntry[]) => {
            const [entry] = entries
            if (entry.isIntersecting) {
                setIsVisible(true)
                if (once && ref.current) {
                    const observer = new IntersectionObserver(() => { })
                    observer.unobserve(ref.current)
                    observer.disconnect()
                }
            } else if (!once) {
                setIsVisible(false)
            }
        },
        [once]
    )

    useEffect(() => {
        const node = ref.current
        if (!node || !shouldAnimate) {
            setIsVisible(true)
            return
        }

        const observer = new IntersectionObserver(handleIntersection, {
            threshold,
        })

        observer.observe(node)

        return () => {
            observer.disconnect()
        }
    }, [handleIntersection, threshold, shouldAnimate])

    const style: React.CSSProperties = {
        ...(shouldAnimate && delay > 0 ? { animationDelay: `${delay}ms` } : {}),
        ...(shouldAnimate && duration !== 400 ? { animationDuration: `${duration}ms` } : {}),
    }

        const TagComponent = Tag as any

    return (
        <TagComponent
            ref={ref}
            className={cn(
                shouldAnimate && isVisible && animationClasses[animation],
                shouldAnimate && !isVisible && "opacity-0",
                className
            )}
            style={style}
        >
            {children}
        </TagComponent>
    )
}

