import { type NextRequest, NextResponse } from "next/server"
import { tableFromIPC } from "apache-arrow"
import fs from "fs/promises"
import path from "path"

interface GridCell {
  lat: number
  lon: number
  sim: number
}

interface GridCellData {
  coordinates: { lat: number; lon: number }[]
  similarities: number[]
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

async function readArrowFileWithBBox(
  filename: string,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  binSize = 0.01
): Promise<Map<string, GridCell>> {
  const filePath = path.join(process.cwd(), "app/api/gridcell", filename)
  const buffer = await fs.readFile(filePath)
  const table = tableFromIPC(buffer)

  const lat = table.getChild("lat")!.toArray()
  const lon = table.getChild("lon")!.toArray()
  const sim = table.getChild("similarity")!.toArray()

  const binMap = new Map<string, GridCell>()

  for (let i = 0; i < lat.length; i++) {
    const la = lat[i]
    const lo = lon[i]
    const s = sim[i]

    if (la >= bounds.minLat && la <= bounds.maxLat && lo >= bounds.minLon && lo <= bounds.maxLon) {
      const binKey = `${Math.floor(la / binSize)}_${Math.floor(lo / binSize)}`
      if (!binMap.has(binKey)) {
        binMap.set(binKey, { lat: la, lon: lo, sim: s })
      } else {
        const prev = binMap.get(binKey)!
        binMap.set(binKey, {
          lat: (prev.lat + la) / 2,
          lon: (prev.lon + lo) / 2,
          sim: (prev.sim + s) / 2,
        })
      }
    }
  }

  return binMap
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lenses = searchParams.getAll("lens")

    const minLat = parseFloat(searchParams.get("minLat") ?? "45.8")
    const maxLat = parseFloat(searchParams.get("maxLat") ?? "47.8")
    const minLon = parseFloat(searchParams.get("minLon") ?? "5.9")
    const maxLon = parseFloat(searchParams.get("maxLon") ?? "10.5")

    const bounds = { minLat, maxLat, minLon, maxLon }

    const fileMap: Record<string, string | null> = {
      topography: "topography.arrow",
      water: "water.arrow",
      roads: null,
      vegetation: "vegetation.arrow",
    }

    const validFilenames = lenses
      .map((l) => fileMap[l.toLowerCase()] ?? null)
      .filter((f): f is string => f !== null)

    if (validFilenames.length === 0) {
      return NextResponse.json({ error: "No valid lenses" }, { status: 400 })
    }

    const combinedMap = new Map<string, GridCell>()
    for (const filename of validFilenames) {
      const map = await readArrowFileWithBBox(filename, bounds)
      for (const [key, cell] of map.entries()) {
        if (!combinedMap.has(key)) {
          combinedMap.set(key, cell)
        } else {
          const prev = combinedMap.get(key)!
          combinedMap.set(key, {
            lat: (prev.lat + cell.lat) / 2,
            lon: (prev.lon + cell.lon) / 2,
            sim: (prev.sim + cell.sim) / 2,
          })
        }
      }
    }

    const coordinates: { lat: number; lon: number }[] = []
    const similarities: number[] = []

    Array.from(combinedMap.values()).forEach(({ lat, lon, sim }) => {
      coordinates.push({ lat, lon })
      similarities.push(sim)
    })

    // Normalize similarities with clipping
    const sorted = [...similarities].sort((a, b) => a - b)
    const lowerBound = percentile(sorted, 1)
    const upperBound = percentile(sorted, 99)

    const normalizedSimilarities = similarities.map((s) => {
      const clipped = Math.min(Math.max(s, lowerBound), upperBound)
      return (clipped - lowerBound) / (upperBound - lowerBound)
    })

    return NextResponse.json({ coordinates, similarities: normalizedSimilarities })
  } catch (error) {
    console.error("gridcell API error:", error)
    return NextResponse.json({ error: "Failed to load gridcell data" }, { status: 500 })
  }
}
