import { type NextRequest, NextResponse } from "next/server"
import { tableFromIPC } from "apache-arrow"
import fs from "fs/promises"
import path from "path"

interface ParquetData {
  coordinates: { lat: number; lon: number }[]
  similarities: number[]
}

async function readArrowFileWithBBox(
  filename: string,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  maxSamples: number
): Promise<ParquetData> {
  const filePath = path.join(process.cwd(), "app/api/parquet", filename)
  const buffer = await fs.readFile(filePath)
  const table = tableFromIPC(buffer)

  const lat = table.getChild("lat")!.toArray()
  const lon = table.getChild("lon")!.toArray()
  const sim = table.getChild("similarity")!.toArray()

  const coordinates: { lat: number; lon: number }[] = []
  const similarities: number[] = []

  for (let i = 0; i < lat.length; i++) {
    const la = lat[i]
    const lo = lon[i]

    if (la >= bounds.minLat && la <= bounds.maxLat && lo >= bounds.minLon && lo <= bounds.maxLon) {
      coordinates.push({ lat: la, lon: lo })
      similarities.push(sim[i])
    }
  }

  // Optional: downsample if too many points
  if (coordinates.length > maxSamples) {
    const step = Math.ceil(coordinates.length / maxSamples)
    const sampledCoordinates = []
    const sampledSimilarities = []

    for (let i = 0; i < coordinates.length; i += step) {
      sampledCoordinates.push(coordinates[i])
      sampledSimilarities.push(similarities[i])
    }

    return { coordinates: sampledCoordinates, similarities: sampledSimilarities }
  }

  return { coordinates, similarities }
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
      topography: "all_terrain_embeddings.arrow",
      water: "all_water_embeddings.arrow",
      roads: null,
      vegetation: null,
    }

    const filename = fileMap[lens ?? ""] ?? null

    let data: ParquetData

    if (filename) {
      const parquetPath = path.join(process.cwd(), "app/api/parquet", filename)

      try {
        await fs.access(parquetPath)
      } catch {
        return NextResponse.json({ error: "File not found" }, { status: 404 })
      }

      data = await readArrowFileWithBBox(filename, bounds, 5000)
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
    console.error("Parquet API error:", error)
    return NextResponse.json({ error: "Failed to load parquet data" }, { status: 500 })
  }
}
