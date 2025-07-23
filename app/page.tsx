"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"

// Switzerland bounds
const SWITZERLAND_BOUNDS = {
  north: 47.8084,
  south: 45.818,
  east: 10.4922,
  west: 5.9559,
}

// Colormap functions based on matplotlib colormaps
const colormaps = {
  cividis_r: (value: number) => {
    const r = Math.round(255 * (1 - value * 0.7))
    const g = Math.round(255 * (1 - value * 0.3))
    const b = Math.round(255 * (0.4 + value * 0.6))
    return `rgba(${r}, ${g}, ${b}, 0.5)`
  },
  summer: (value: number) => {
    const r = Math.round(255 * value)
    const g = Math.round(255 * (0.5 + value * 0.5))
    const b = Math.round(255 * 0.4)
    return `rgb(${r}, ${g}, ${b}, 0.5)`
  },
  plasma: (value: number) => {
    const r = Math.round(255 * (0.2 + value * 0.8))
    const g = Math.round(255 * value * 0.7)
    const b = Math.round(255 * (0.8 - value * 0.3))
    return `rgb(${r}, ${g}, ${b}, 0.5)`
  },
  seismic: (value: number) => {
    if (value < 0.5) {
      const r = Math.round(255 * (1 - 2 * value))
      const g = Math.round(255 * (1 - 2 * value))
      const b = 255
      return `rgb(${r}, ${g}, ${b}, 0.5)`
    } else {
      const r = 255
      const g = Math.round(255 * (2 - 2 * value))
      const b = Math.round(255 * (2 - 2 * value))
      return `rgb(${r}, ${g}, ${b}, 0.5)`
    }
  },
}

interface GridCell {
  lat: number
  lng: number
  similarity?: number
}

interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

interface BackendResponse {
  boundingBox: BoundingBox
  topKCells: { lat: number; lng: number }[]
}

// Convert lat/lng to pixel coordinates
function latLngToPixel(lat: number, lng: number, bounds: any, width: number, height: number) {
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * width
  const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * height
  return { x, y }
}

// Convert meters to degrees at given latitude
function metersToDegreesAtLat(meters: number, lat: number) {
  const latDegrees = meters / 111000 // 1 degree ≈ 111km
  const lngDegrees = meters / (111000 * Math.cos((lat * Math.PI) / 180))
  return { latDegrees, lngDegrees }
}

// Tile coordinate functions
function deg2num(lat_deg: number, lon_deg: number, zoom: number) {
  const lat_rad = (lat_deg * Math.PI) / 180.0
  const n = Math.pow(2.0, zoom)
  const xtile = Math.floor(((lon_deg + 180.0) / 360.0) * n)
  const ytile = Math.floor(((1.0 - Math.asinh(Math.tan(lat_rad)) / Math.PI) / 2.0) * n)
  return { x: xtile, y: ytile }
}

function num2deg(xtile: number, ytile: number, zoom: number) {
  const n = Math.pow(2.0, zoom)
  const lon_deg = (xtile / n) * 360.0 - 180.0
  const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ytile) / n)))
  const lat_deg = (lat_rad * 180.0) / Math.PI
  return { lat: lat_deg, lng: lon_deg }
}

export default function SwitzerlandMap() {
  const [location, setLocation] = useState("")
  const [topK, setTopK] = useState("")
  const [lens, setLens] = useState("No lens selected")
  const [highlightedCells, setHighlightedCells] = useState<{ lat: number; lng: number }[]>([])
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null)
  const [gridData, setGridData] = useState<GridCell[]>([])
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(8)
  const [center, setCenter] = useState({ lat: 46.8182, lng: 8.2275 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, lat: 0, lng: 0 })
  const [loadedTiles, setLoadedTiles] = useState<Map<string, HTMLImageElement>>(new Map())

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Generate grid cells (1km x 1km) - now properly square
  const generateGrid = () => {
    const cells = []
    const cellSizeMeters = 1000

    // Calculate step size for each latitude to maintain square cells
    for (let lat = SWITZERLAND_BOUNDS.south; lat < SWITZERLAND_BOUNDS.north; ) {
      const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, lat)

      for (let lng = SWITZERLAND_BOUNDS.west; lng < SWITZERLAND_BOUNDS.east; lng += lngDegrees) {
        cells.push({ lat, lng })
      }

      lat += latDegrees
    }
    return cells
  }

  const gridCells = generateGrid()

  const getCellColor = (cell: GridCell) => {
    // Check if cell is highlighted
    const isHighlighted = highlightedCells.some(
      (hCell) => Math.abs(hCell.lat - cell.lat) < 0.01 && Math.abs(hCell.lng - cell.lng) < 0.01,
    )

    if (isHighlighted) {
      return "red"
    }

    // Apply lens coloring
    if (lens !== "No lens selected" && cell.similarity !== undefined) {
      const colormap =
        lens === "Water"
          ? colormaps.cividis_r
          : lens === "Vegetation"
            ? colormaps.summer
            : lens === "Topography"
              ? colormaps.plasma
              : lens === "Road Network"
                ? colormaps.seismic
                : null

      if (colormap) {
        return colormap(cell.similarity)
      }
    }

    return "rgba(128, 128, 128, 0.1)"
  }

  // Load map tiles
  const loadTile = (x: number, y: number, z: number): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const tileKey = `${z}/${x}/${y}`

      if (loadedTiles.has(tileKey)) {
        resolve(loadedTiles.get(tileKey)!)
        return
      }

      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        setLoadedTiles((prev) => new Map(prev).set(tileKey, img))
        resolve(img)
      }
      img.onerror = reject
      img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    })
  }

  // Draw the map
  const drawMap = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate visible tiles
    const mapWidth = canvas.width
    const mapHeight = canvas.height

    // Calculate bounds for current view
    const viewBounds = {
      north: center.lat + (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      south: center.lat - (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      east: center.lng + (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
      west: center.lng - (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
    }

    // Get tile coordinates for current view
    const topLeft = deg2num(viewBounds.north, viewBounds.west, zoom)
    const bottomRight = deg2num(viewBounds.south, viewBounds.east, zoom)

    // Draw map tiles
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        try {
          const img = await loadTile(x, y, zoom)

          // Calculate tile position on canvas
          const tileTopLeft = num2deg(x, y, zoom)
          const tileBottomRight = num2deg(x + 1, y + 1, zoom)

          const pixelTopLeft = latLngToPixel(tileTopLeft.lat, tileTopLeft.lng, viewBounds, mapWidth, mapHeight)
          const pixelBottomRight = latLngToPixel(
            tileBottomRight.lat,
            tileBottomRight.lng,
            viewBounds,
            mapWidth,
            mapHeight,
          )

          const tileWidth = pixelBottomRight.x - pixelTopLeft.x
          const tileHeight = pixelBottomRight.y - pixelTopLeft.y

          ctx.drawImage(img, pixelTopLeft.x, pixelTopLeft.y, tileWidth, tileHeight)
        } catch (error) {
          // Skip failed tiles
          console.warn(`Failed to load tile ${x}/${y}/${zoom}`)
        }
      }
    }

    // Draw grid cells (now properly square)
    const cellSizeMeters = 1000
    gridCells.forEach((cell) => {
      // Only draw cells that are visible
      if (
        cell.lat < viewBounds.south ||
        cell.lat > viewBounds.north ||
        cell.lng < viewBounds.west ||
        cell.lng > viewBounds.east
      ) {
        return
      }

      const gridCell =
        gridData.find((gCell) => Math.abs(gCell.lat - cell.lat) < 0.01 && Math.abs(gCell.lng - cell.lng) < 0.01) || cell

      // Calculate square cell dimensions at this latitude
      const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, cell.lat)

      const topLeft = latLngToPixel(cell.lat + latDegrees, cell.lng, viewBounds, mapWidth, mapHeight)
      const bottomRight = latLngToPixel(cell.lat, cell.lng + lngDegrees, viewBounds, mapWidth, mapHeight)

      const width = bottomRight.x - topLeft.x
      const height = bottomRight.y - topLeft.y

      const cellColor = getCellColor(gridCell)

      // Only draw grid if lens is selected or cell is highlighted
      if (
        lens !== "No lens selected" ||
        highlightedCells.some((hCell) => Math.abs(hCell.lat - cell.lat) < 0.01 && Math.abs(hCell.lng - cell.lng) < 0.01)
      ) {
        ctx.fillStyle = cellColor
        ctx.fillRect(topLeft.x, topLeft.y, width, height)
      }

      // Draw grid lines (very subtle)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)"
      ctx.lineWidth = 0.5
      ctx.strokeRect(topLeft.x, topLeft.y, width, height)
    })

    // Draw bounding box
    if (boundingBox) {
      const topLeft = latLngToPixel(boundingBox.north, boundingBox.west, viewBounds, mapWidth, mapHeight)
      const bottomRight = latLngToPixel(boundingBox.south, boundingBox.east, viewBounds, mapWidth, mapHeight)

      ctx.strokeStyle = "yellow"
      ctx.lineWidth = 3
      ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
    }
  }

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      lat: center.lat,
      lng: center.lng,
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y

      const canvas = canvasRef.current
      if (!canvas) return

      const sensitivity = 0.01 * Math.pow(2, 8 - zoom)
      const newLat = dragStart.lat + deltaY * sensitivity
      const newLng = dragStart.lng - deltaX * sensitivity

      // Viewport "half size" in degrees (assuming Switzerland bounds define zoom level 8 extent)
      const latSpan = (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / Math.pow(2, zoom - 8)
      const lngSpan = (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / Math.pow(2, zoom - 8)

      const latMin = SWITZERLAND_BOUNDS.south + latSpan / 2
      const latMax = SWITZERLAND_BOUNDS.north - latSpan / 2
      const lngMin = SWITZERLAND_BOUNDS.west + lngSpan / 2
      const lngMax = SWITZERLAND_BOUNDS.east - lngSpan / 2

      setCenter({
        lat: Math.max(latMin, Math.min(latMax, newLat)),
        lng: Math.max(lngMin, Math.min(lngMax, newLng)),
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1
    setZoom((prev) => Math.max(8, Math.min(14, prev + delta)))
  }

  // Backend integration - replace with your actual backend URL
  const handleSearch = async () => {
    if (!location || !topK) return

    setLoading(true)

    try {
      // Call your actual backend API
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location: location,
          topK: Number.parseInt(topK),
        }),
      })

      if (!response.ok) {
        throw new Error("Search request failed")
      }

      const data: BackendResponse = await response.json()

      setHighlightedCells(data.topKCells)
      setBoundingBox(data.boundingBox)

      // Center map on the bounding box
      if (data.boundingBox) {
        const centerLat = (data.boundingBox.north + data.boundingBox.south) / 2
        const centerLng = (data.boundingBox.east + data.boundingBox.west) / 2
        setCenter({ lat: centerLat, lng: centerLng })
        setZoom(10) // Zoom in to show the area
      }
    } catch (error) {
      console.error("Search failed:", error)
      // Fallback to mock data for demo
      const mockResponse: BackendResponse = {
        boundingBox: {
          north: 47.4,
          south: 47.3,
          east: 8.6,
          west: 8.5,
        },
        topKCells: Array.from({ length: Number.parseInt(topK) }, (_, i) => ({
          lat: 47.35 + i * 0.01,
          lng: 8.55 + i * 0.01,
        })),
      }

      setHighlightedCells(mockResponse.topKCells)
      setBoundingBox(mockResponse.boundingBox)
    } finally {
      setLoading(false)
    }
  }

  // Load parquet data for lens coloring
  const loadParquetData = async (lensType: string) => {
    try {
      const response = await fetch(`/api/parquet?lens=${lensType.toLowerCase()}`)
      if (!response.ok) {
        throw new Error("Failed to load parquet data")
      }

      const data = await response.json()

      // Process the parquet data and calculate PCA similarities
      // This is where you'd integrate with your actual parquet processing
      const processedGridData: GridCell[] = data.coordinates.map((coord: any, index: number) => ({
        lat: coord.lat,
        lng: coord.lng,
        similarity: data.similarities ? data.similarities[index] : Math.random(), // Use actual similarity or fallback
      }))

      setGridData(processedGridData)
    } catch (error) {
      console.error("Failed to load parquet data:", error)
      // Fallback to mock data
      generateMockGridData()
    }
  }

  // Generate mock grid data with PCA similarities when lens changes
  const generateMockGridData = () => {
    const mockGridData: GridCell[] = []
    const cellSizeMeters = 1000

    for (let lat = SWITZERLAND_BOUNDS.south; lat < SWITZERLAND_BOUNDS.north; ) {
      const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, lat)

      for (let lng = SWITZERLAND_BOUNDS.west; lng < SWITZERLAND_BOUNDS.east; lng += lngDegrees) {
        mockGridData.push({
          lat,
          lng,
          similarity: Math.random(),
        })
      }

      lat += latDegrees
    }

    setGridData(mockGridData)
  }

  useEffect(() => {
    if (lens !== "No lens selected") {
      loadParquetData(lens)
    } else {
      setGridData([])
    }
  }, [lens])

  // Redraw when data changes
  useEffect(() => {
    drawMap()
  }, [center, zoom, gridData, highlightedCells, boundingBox, lens])

  // Handle resize
  useEffect(() => {
    const handleResize = () => drawMap()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <div className="h-screen flex flex-col">
      {/* Top control bar */}
      <Card className="p-4 m-4 mb-0">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Enter location name..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="w-24">
            <Input type="number" placeholder="Top K" value={topK} onChange={(e) => setTopK(e.target.value)} />
          </div>

          <Button onClick={handleSearch} disabled={loading || !location || !topK}>
            {loading ? "Searching..." : "Search"}
          </Button>

          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="No lens selected">No lens selected</SelectItem>
              <SelectItem value="Water">Water</SelectItem>
              <SelectItem value="Vegetation">Vegetation</SelectItem>
              <SelectItem value="Topography">Topography</SelectItem>
              <SelectItem value="Road Network">Road Network</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((prev) => Math.min(12, prev + 1))}>
              +
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoom((prev) => Math.max(6, prev - 1))}>
              -
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setZoom(8)
                setCenter({ lat: 46.8182, lng: 8.2275 })
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {/* Map container */}
      <div className="flex-1 m-4 mt-2" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="w-full h-full border border-gray-300 cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        />
      </div>

      {/* Legend */}
      <Card className="p-4 m-4 mt-0">
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500"></div>
            <span>Top K Cells</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-yellow-500"></div>
            <span>Bounding Box</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-300 opacity-50"></div>
            <span>Grid (1km × 1km)</span>
          </div>
          {lens !== "No lens selected" && (
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 bg-gradient-to-r ${
                  lens === "Water"
                    ? "from-blue-900 to-yellow-200"
                    : lens === "Vegetation"
                    ? "from-yellow-300 to-green-700"
                    : lens === "Topography"
                    ? "from-purple-400 to-orange-500"
                    : lens === "Road Network"
                    ? "from-blue-400 to-red-600"
                    : "from-gray-300 to-gray-500"
                }`}
              />
              <span>{lens} Similarity</span>
            </div>
          )}
          <div className="text-xs text-gray-500">Zoom: {zoom} | Drag to pan, scroll to zoom</div>
        </div>
      </Card>
    </div>
  )
}
