import type { ReactNode } from 'react'
import type { HolderTierKey } from '../lib/holders'

/**
 * Holder-tier marks drawn in-house on a 160-unit grid, then normalised so every
 * creature fits the same 24-unit box with an identical optical stroke weight at
 * 16 px. Body silhouettes carry a soft `currentColor` wash so the marks stay
 * legible at 15 px without losing the outline style. The artwork lives in
 * `public/brand/*.svg`; only its path data is embedded here so the icons can
 * inherit `currentColor` and scale with the text.
 */
type TierMark = {
  transform: string
  strokeWidth: number
  content: ReactNode
}

/**
 * Optical stroke weight in the 24-unit viewBox. The source SVGs are drawn on a
 * 160-unit grid, so each mark divides this by its normalisation scale. Lower
 * this number for thinner lines at a given font size.
 */
const OPTICAL_STROKE = 1.5

const TIER_MARKS: Record<HolderTierKey, TierMark> = {
  whale: {
    transform: 'translate(12 12) scale(0.1778) translate(-81.055 -79.115)',
    strokeWidth: OPTICAL_STROKE / 0.1778,
    content: (
      <>
        <path
          d="M58 65C37 63 22 76 22 96C22 116 44 127 72 125C96 124 115 111 124 90C135 87 141 76 140 65C131 64 122 69 119 77C115 67 106 63 97 65C99 77 106 85 114 88C106 93 100 91 94 82C86 70 74 65 58 65Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M63 102C64 111 72 117 82 114C79 109 77 105 76 101" />
        <path
          d="M45 88C45 88.7956 44.6839 89.5587 44.1213 90.1213C43.5587 90.6839 42.7956 91 42 91C41.2044 91 40.4413 90.6839 39.8787 90.1213C39.3161 89.5587 39 88.7956 39 88C39 87.2044 39.3161 86.4413 39.8787 85.8787C40.4413 85.3161 41.2044 85 42 85C42.7956 85 43.5587 85.3161 44.1213 85.8787C44.6839 86.4413 45 87.2044 45 88Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M55 54V44M55 44C55 37 50 33 44 33M55 44C55 37 60 33 66 33" />
      </>
    ),
  },
  shark: {
    transform: 'translate(12 12) scale(0.166008) translate(-76.75 -78)',
    strokeWidth: OPTICAL_STROKE / 0.166008,
    content: (
      <>
        <path
          d="M13.5 82.5C24.5 67.5 48 61 65 62L81 32L89 64C99 67 107 73 114 76L140 42L130 83L140 109L115 92C105 100 94 104 81 104V124L63 103C44 102 23.5 94.5 13.5 82.5Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M81 104L85 92" />
        <path d="M37 79V79.1" />
        <path d="M52 80L50 89M62 80L60 90" />
      </>
    ),
  },
  dolphin: {
    transform: 'translate(12 12) scale(0.171849) translate(-79.9 -80.125)',
    strokeWidth: OPTICAL_STROKE / 0.171849,
    content: (
      <>
        <path
          d="M78 88C92 92 104.997 104 115.997 111C111.33 115 107.997 120.333 105.997 127C115.33 128.333 121.833 124.333 126.5 117C135.167 113.667 140.33 108.667 140.997 100C135.664 103.333 129.997 104.667 123.997 104C114.997 81 103.997 62 86.9969 53C82.9969 48.3333 81.3302 41.6667 81.9969 33C79.3302 35.6667 76.6635 39 73.9969 43C70.9969 47 67.9969 48 62.9969 48C46.9969 47 33.9969 56 32.9969 71L24.9969 75C21.6635 76.3333 19.6635 77.6667 18.9969 79C18.3302 81.6667 19.3302 83 21.9969 83L37.9969 82C42.9969 82 50 84.5 59 85.5"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M63.9969 77C61.3302 85 60.3302 94.6667 60.9969 106C68.9969 103.333 74.6635 97.3333 77.9969 88" />
        <path d="M45 67H45.1" />
      </>
    ),
  },
  fish: {
    transform: 'translate(12 12) scale(0.183679) translate(-80.165 -79.975)',
    strokeWidth: OPTICAL_STROKE / 0.183679,
    content: (
      <>
        <path d="M58.0833 52.9515C63.378 45.3525 70.7572 40.9313 80.2211 39.688C80.4569 45.0577 83.0185 50.6149 87.9059 56.3597" />
        <path d="M66.1192 109.447C71.6483 116.877 78.4251 120.478 86.4496 120.249L87.8708 106.002" />
        <path d="M109 73.5L136 52.0008C137.333 51.3341 137.667 52.3341 137 55.0008L127 81.0008L137 107.001C137.667 109.667 137 110.334 135 109.001L109 88.0008" />
        <path
          d="M23 81C32 63 48 53 68 53C89 53 104 64 113 81C104 98 89 109 68 109C48 109 32 99 23 81Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M58 67C64.6667 76.3333 64.6667 85.6667 58 95" />
        <path d="M78 81L90 89C86 92.3333 81.6667 93.3333 77 92" />
        <path
          d="M46 74C46 74.7956 45.6839 75.5587 45.1213 76.1213C44.5587 76.6839 43.7956 77 43 77C42.2044 77 41.4413 76.6839 40.8787 76.1213C40.3161 75.5587 40 74.7956 40 74C40 73.2044 40.3161 72.4413 40.8787 71.8787C41.4413 71.3161 42.2044 71 43 71C43.7956 71 44.5587 71.3161 45.1213 71.8787C45.6839 72.4413 46 73.2044 46 74Z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
  crab: {
    transform: 'translate(12 12) scale(0.164242) translate(-80 -82.5)',
    strokeWidth: OPTICAL_STROKE / 0.164242,
    content: (
      <>
        <path d="M48.5 89L29 84L18 93M48 100.5L28 104L19 115M55 111.5L38 121L32 133" />
        <path d="M112 89L131 84L142 93M112 100.5L132 104L141 115M105.5 111.5L122 121L128 133" />
        <path d="M52.5 81C40.5 80.3333 34 75.3333 32 66M107.5 81C119.5 80.3333 126 75.3333 128 66" />
        <path
          d="M18.0018 33C14.0018 44 16.0018 60 26.0018 65C37.0018 69 46.0018 58 43.0018 46L39.0018 32L31.0018 47L18.0018 33Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path
          d="M141.998 33C145.998 44 143.998 60 133.998 65C122.998 69 113.998 58 116.998 46L120.998 32L128.998 47L141.998 33Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M67 73L64 60M93 73L96 60" />
        <path
          d="M68 58C68 59.0609 67.5786 60.0783 66.8284 60.8284C66.0783 61.5786 65.0609 62 64 62C62.9391 62 61.9217 61.5786 61.1716 60.8284C60.4214 60.0783 60 59.0609 60 58C60 56.9391 60.4214 55.9217 61.1716 55.1716C61.9217 54.4214 62.9391 54 64 54C65.0609 54 66.0783 54.4214 66.8284 55.1716C67.5786 55.9217 68 56.9391 68 58ZM100 58C100 59.0609 99.5786 60.0783 98.8284 60.8284C98.0783 61.5786 97.0609 62 96 62C94.9391 62 93.9217 61.5786 93.1716 60.8284C92.4214 60.0783 92 59.0609 92 58C92 56.9391 92.4214 55.9217 93.1716 55.1716C93.9217 54.4214 94.9391 54 96 54C97.0609 54 98.0783 54.4214 98.8284 55.1716C99.5786 55.9217 100 56.9391 100 58Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M80 72C101 72 112 80 112 96C112 110 99 119 80 119C61 119 48 110 48 96C48 80 59 72 80 72Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
      </>
    ),
  },
  shrimp: {
    transform: 'translate(12 12) scale(0.173396) translate(-76.375 -77)',
    strokeWidth: OPTICAL_STROKE / 0.173396,
    content: (
      <>
        <path d="M56 57C47 37 34 23 20 23" />
        <path d="M53.6363 68.943C37.4819 61.7294 23.9581 63.1807 15.8216 72.1137" />
        <path d="M71 80L64 92L58 95" />
        <path d="M83 81L77 96L71 99" />
        <path d="M95 81L92 96L86 102" />
        <path
          d="M49 64.9995L39 54.9995L65 57.9995C92 39.9995 127 57.9995 135 84.9995C144 112.999 120 137.999 96 125.999L90 112.999C110 118.999 121 98.9995 108 84.9995C98 74.9995 82 83.9995 64 77.9995L49 64.9995Z"
          fill="currentColor"
          fillOpacity={0.22}
        />
        <path d="M114.5 59C111.833 66.3333 106.833 75.6667 101.5 81" />
        <path d="M133 80C125.667 80 118.667 83.3333 112 90" />
        <path d="M135 107.5C128.333 104.833 119.5 102.167 113.5 101.5" />
        <path d="M90 113L75 105C71 109 70 113.667 72 119C72.6667 124.333 75.6667 128.333 81 131L96 126" />
        <path d="M73 118L92 120" />
        <path
          d="M70 66C70 66.7956 69.6839 67.5587 69.1213 68.1213C68.5587 68.6839 67.7956 69 67 69C66.2044 69 65.4413 68.6839 64.8787 68.1213C64.3161 67.5587 64 66.7956 64 66C64 65.2044 64.3161 64.4413 64.8787 63.8787C65.4413 63.3161 66.2044 63 67 63C67.7956 63 68.5587 63.3161 69.1213 63.8787C69.6839 64.4413 70 65.2044 70 66Z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
}

type TierIconProps = {
  tier: HolderTierKey
  size?: number
  className?: string
}

export function TierIcon({ tier, size = 16, className }: TierIconProps) {
  const mark = TIER_MARKS[tier]

  return (
    <svg
      className={className}
      data-tier={tier}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={mark.transform} strokeWidth={mark.strokeWidth}>
        {mark.content}
      </g>
    </svg>
  )
}
