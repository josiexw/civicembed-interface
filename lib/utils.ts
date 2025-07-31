import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// === Switzerland Constants ===
export const SWITZERLAND_BOUNDS = {
  north: 47.8084,
  south: 45.818,
  east: 10.4922,
  west: 5.9559,
}

// === Grid Helpers ===
export function metersToDegreesAtLat(meters: number, lat: number) {
  const latRadians = (lat * Math.PI) / 180
  const latDegrees = meters / 111_320
  const lngDegrees = meters / (111_320 * Math.cos(latRadians))
  return { latDegrees, lngDegrees }
}

export function deg2num(lat_deg: number, lon_deg: number, zoom: number) {
  const lat_rad = (lat_deg * Math.PI) / 180.0
  const n = Math.pow(2.0, zoom)
  const xtile = Math.floor(((lon_deg + 180.0) / 360.0) * n)
  const ytile = Math.floor(((1.0 - Math.asinh(Math.tan(lat_rad)) / Math.PI) / 2.0) * n)
  return { x: xtile, y: ytile }
}

export function num2deg(xtile: number, ytile: number, zoom: number) {
  const n = Math.pow(2.0, zoom)
  const lon_deg = (xtile / n) * 360.0 - 180.0
  const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ytile) / n)))
  const lat_deg = (lat_rad * 180.0) / Math.PI
  return { lat: lat_deg, lng: lon_deg }
}

export function getCellSizeMetersForZoom(zoom: number) {
  if (zoom >= 10) return 1000
  else if (zoom >= 9) return 2000
  return 3000
}

// === Coordinate Conversion ===
export function latLngToPixel(lat: number, lng: number, bounds: any, width: number, height: number) {
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * width
  const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * height
  return { x, y }
}

// === Colormaps ===
export const colormaps = {
  cividis_r: (value: number) => {
    const r = Math.round(255 * (1 - value * 0.7))
    const g = Math.round(255 * (1 - value * 0.3))
    const b = Math.round(255 * (0.4 + value * 0.6))
    return `rgba(${r}, ${g}, ${b}, 0.5)`
  },
  summer_r: (value: number) => {
    let r, g, b

    if (value <= 0.5) {
      // Orange (255, 165, 0) → Yellow (255, 255, 0)
      const t = value / 0.5
      r = 255
      g = Math.round(165 + t * (255 - 165))
      b = 0
    } else if (value <= 0.75) {
      // Yellow (255, 255, 0) → Green (0, 255, 0)
      const t = (value - 0.5) / 0.25
      r = Math.round(255 * (1 - t))
      g = 255
      b = 0
    } else {
      // Green (0, 255, 0) → Dark Green (0, 100, 0)
      const t = (value - 0.75) / 0.25
      r = 0
      g = Math.round(255 - t * (255 - 100))
      b = 0
    }

    return `rgba(${r}, ${g}, ${b}, 0.5)`
  },
  plasma: (value: number) => {
    const r = Math.round(255 * (0.2 + value * 0.8))
    const g = Math.round(255 * value * 0.7)
    const b = Math.round(255 * (0.8 - value * 0.3))
    return `rgba(${r}, ${g}, ${b}, 0.5)`
  },
  seismic: (value: number) => {
    if (value < 0.5) {
      const r = Math.round(255 * (1 - 2 * value))
      const g = Math.round(255 * (1 - 2 * value))
      const b = 255
      return `rgba(${r}, ${g}, ${b}, 0.5)`
    } else {
      const r = 255
      const g = Math.round(255 * (2 - 2 * value))
      const b = Math.round(255 * (2 - 2 * value))
      return `rgba(${r}, ${g}, ${b}, 0.5)`
    }
  },
}
