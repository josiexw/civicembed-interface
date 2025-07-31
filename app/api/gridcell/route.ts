import { type NextRequest, NextResponse } from "next/server"
import { tableFromIPC } from "apache-arrow"
import fs from "fs/promises"
import path from "path"

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
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<GridCellData> {
  const filePath = path.join(process.cwd(), "app/api/gridcell", filename)
  const buffer = await fs.readFile(filePath)
  const table = tableFromIPC(buffer)

  const lat = table.getChild("lat")!.toArray()
  const lon = table.getChild("lon")!.toArray()
  const sim = table.getChild("similarity")!.toArray()

  const binSize = 0.01 // ~1km in degrees

  const binMap = new Map<string, { lat: number; lon: number; sim: number }>()

  for (let i = 0; i < lat.length; i++) {
    const la = lat[i]
    const lo = lon[i]
    const s = sim[i]

    if (la >= bounds.minLat && la <= bounds.maxLat && lo >= bounds.minLon && lo <= bounds.maxLon) {
      const binKey = `${Math.floor(la / binSize)}_${Math.floor(lo / binSize)}`
      if (!binMap.has(binKey)) {
        binMap.set(binKey, { lat: la, lon: lo, sim: s })
      }
    }
  }

  const coordinates: { lat: number; lon: number }[] = []
  const similarities: number[] = []

  Array.from(binMap.values()).forEach(({ lat, lon, sim }) => {
    coordinates.push({ lat, lon })
    similarities.push(sim)
  })

  // Normalize similarities between 0 and 1 with outlier clipping
  const sorted = [...similarities].sort((a, b) => a - b)
  const lowerBound = percentile(sorted, 1)
  const upperBound = percentile(sorted, 99)

  const normalizedSimilarities = similarities.map((s) => {
    const clipped = Math.min(Math.max(s, lowerBound), upperBound)
    return (clipped - lowerBound) / (upperBound - lowerBound)
  })

  return { coordinates, similarities: normalizedSimilarities }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lens = searchParams.get("lens")

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

    const filename = fileMap[lens ?? ""] ?? null

    let data: GridCellData

    if (filename) {
      const gridcellPath = path.join(process.cwd(), "app/api/gridcell", filename)

      try {
        await fs.access(gridcellPath)
      } catch {
        return NextResponse.json({ error: "File not found" }, { status: 404 })
      }

      data = await readArrowFileWithBBox(filename, bounds)
    } else {
      data = {
        coordinates: Array.from({ length: 1000 }, () => ({
          lat: 45.8 + Math.random() * 2,
          lon: 5.9 + Math.random() * 4.5,
        })),
        similarities: Array.from({ length: 1000 }, () => Math.random()),
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("gridcell API error:", error)
    return NextResponse.json({ error: "Failed to load gridcell data" }, { status: 500 })
  }
}
