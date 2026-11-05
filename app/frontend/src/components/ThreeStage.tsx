import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ThreeStageProps = {
  children: ReactNode
  fallback: ReactNode
  className?: string
  rootMargin?: string
}

/**
 * Defers loading a Three.js scene until it is close to the viewport. The
 * fallback keeps the layout stable, so the canvas never causes a shift.
 */
export function ThreeStage({
  children,
  fallback,
  className,
  rootMargin = '240px',
}: ThreeStageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [rootMargin])

  return (
    <div className={className} ref={ref}>
      {visible ? <Suspense fallback={fallback}>{children}</Suspense> : fallback}
    </div>
  )
}
