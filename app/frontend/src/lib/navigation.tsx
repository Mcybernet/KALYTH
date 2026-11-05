import { createContext, useContext, type ReactNode } from 'react'

export type NavigationValue = {
  active: string
  navigate: (id: string) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

type NavigationProviderProps = NavigationValue & {
  children: ReactNode
}

export function NavigationProvider({ active, navigate, children }: NavigationProviderProps) {
  return (
    <NavigationContext.Provider value={{ active, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext)
  if (!value) {
    throw new Error('useNavigation must be used inside NavigationProvider')
  }
  return value
}
