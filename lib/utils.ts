import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const SWITZERLAND_BOUNDS = {
  north: 47.8085,  // Bargen (SH)
  south: 45.8180,  // Pedrinate (TI)
  east: 10.4920,   // Val Müstair (GR)
  west: 5.9559,    // Chancy (GE)
}

export const lensOptions = [
  { value: "water", label: "Water" },
  { value: "vegetation", label: "Vegetation" },
  { value: "topography", label: "Topography" },
  { value: "roads", label: "Road Network" },
]

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
  cividis: (value: number) => {
    const r = Math.round(255 * value)
    const g = Math.round(255 * value)
    const b = Math.round(255 * (1 - value))
    return `rgba(${r}, ${g}, ${b})`
  },
  summer_r: (value: number) => {
    let r, g, b

    if (value <= 0.33) {
      // Orange → Yellow
      const t = value / 0.33
      r = 255
      g = Math.round(165 + t * (255 - 165))
      b = 0
    } else if (value <= 0.85) {
      // Yellow → Bright Green
      const t = (value - 0.33) / 0.58
      r = Math.round(255 * (1 - t))
      g = 255
      b = 0
    } else {
      // Bright Green → Dark Green
      const t = (value - 0.85) / 0.15
      r = 0
      g = Math.round(255 - t * (255 - 100))
      b = 0
    }

    return `rgba(${r}, ${g}, ${b})`
  },
  plasma: (value: number) => {
    let r, g, b

    if (value <= 0.33) {
      // Orange to Pink
      const t = value / 0.33
      r = 255
      g = Math.round(165 + t * (105 - 165))
      b = Math.round(0 + t * (180 - 0))
    } else if (value <= 0.66) {
      // Pink to Purple
      const t = (value - 0.33) / 0.33
      r = Math.round(255 - t * (255 - 220))
      g = Math.round(105 - t * 55)
      b = Math.round(180 - t * (180 - 200))
    } else {
      // Purple to Blue
      const t = (value - 0.66) / 0.34
      r = Math.round(220 - t * 220)
      g = Math.round(50 - t * 50)
      b = Math.round(200 + t * (255 - 200))
    }

    return `rgba(${r}, ${g}, ${b})`
  },
  seismic: (value: number) => {
    const r = Math.round(255 * (1 - value))
    const g = 0
    const b = Math.round(255 * value)
    return `rgb(${r}, ${g}, ${b})`
  },
  viridis: (value: number) => {
    let r, g, b

    if (value <= 0.25) {
      // Yellow (255, 255, 0) → Green (0, 255, 0)
      const t = value / 0.25
      r = Math.round(255 * (1 - t))
      g = 255
      b = 0
    } else if (value <= 0.5) {
      // Green (0, 255, 0) → Blue (0, 0, 255)
      const t = (value - 0.25) / 0.25
      r = 0
      g = Math.round(255 * (1 - t))
      b = Math.round(255 * t)
    } else if (value <= 0.75) {
      // Blue (0, 0, 255) → Indigo (75, 0, 130)
      const t = (value - 0.5) / 0.25
      r = Math.round(75 * t)
      g = 0
      b = Math.round(255 - t * (255 - 130))
    } else {
      // Indigo (75, 0, 130) → Purple (128, 0, 128)
      const t = (value - 0.75) / 0.25
      r = Math.round(75 + t * (128 - 75))
      g = 0
      b = Math.round(130 + t * (128 - 130))
    }

    return `rgba(${r}, ${g}, ${b})`
  }
}
